mod config;
mod mqtt_client;
mod shm_bridge;
mod udp_bridge;
mod video_decoder;

use tracing::info;

// Embedded FFmpeg HEVC decoder — only compiled when the `internal-ffmpeg`
// feature is enabled and the static libs in `vendor/ffmpeg-static/<plat>/`
// have been built (see `scripts/build-ffmpeg-minimal.ps1 -StaticLibs`).
#[cfg(feature = "internal-ffmpeg")]
mod ffmpeg_ffi;
#[cfg(feature = "internal-ffmpeg")]
mod video_decoder_internal;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn select_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let folder_path = app.dialog().file().blocking_pick_folder();
    Ok(folder_path.map(|p| p.to_string()))
}

#[tauri::command]
async fn select_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let file_path = app.dialog().file().blocking_pick_file();
    Ok(file_path.map(|p| p.to_string()))
}

/// Toggle fullscreen on the main window. Returns the new fullscreen state.
#[tauri::command]
async fn toggle_fullscreen(app: tauri::AppHandle) -> Result<bool, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let current = window.is_fullscreen().map_err(|e| e.to_string())?;
    let next = !current;
    window.set_fullscreen(next).map_err(|e| e.to_string())?;
    Ok(next)
}

/// Explicitly set fullscreen state (true/false).
#[tauri::command]
async fn set_fullscreen(app: tauri::AppHandle, fullscreen: bool) -> Result<bool, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    window
        .set_fullscreen(fullscreen)
        .map_err(|e| e.to_string())?;
    Ok(fullscreen)
}

/// Close the main window (and exit the app).
#[tauri::command]
async fn app_close(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    window.close().map_err(|e| e.to_string())?;
    Ok(())
}

/// Minimize the main window.
#[tauri::command]
async fn window_minimize(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    window.minimize().map_err(|e| e.to_string())?;
    Ok(())
}

/// Toggle maximize state.
#[tauri::command]
async fn window_toggle_maximize(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let maximized = window.is_maximized().map_err(|e| e.to_string())?;
    if maximized {
        window.unmaximize().map_err(|e| e.to_string())?;
    } else {
        window.maximize().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Open devtools (compiled in via `tauri/devtools`).
#[tauri::command]
async fn open_devtools(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    window.open_devtools();
    Ok(())
}

use tauri::Listener;
use tauri::Manager;

fn create_main_window(app: &mut tauri::App) -> tauri::Result<tauri::WebviewWindow> {
    let config = app.config().app.windows.first().cloned().unwrap_or_default();
    tauri::WebviewWindowBuilder::from_config(app, &config)?
        .data_directory(config::get_webview_data_dir())
        .build()
}

/// 安装一个 panic hook，吞掉 "failed printing to stdout/stderr" 类型的 panic，
/// 避免 Windows 下父进程管道关闭后每次 eprintln!/println! 都级联触发 panic，
/// 并让 tokio::spawn_blocking 里的任务直接返回 Err 而不是把这一串 panic
/// 反复抛到前端。
fn install_stdio_panic_swallower() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let msg = info
            .payload()
            .downcast_ref::<String>()
            .map(|s| s.as_str())
            .or_else(|| info.payload().downcast_ref::<&str>().copied())
            .unwrap_or("");
        if msg.starts_with("failed printing to stdout")
            || msg.starts_with("failed printing to stderr")
        {
            // Silently swallow — stderr/stdout pipe has been closed by the
            // tauri-cli/cargo-watch parent; continuing to print would panic
            // recursively.
            return;
        }
        default_hook(info);
    }));
}

/// Initialize the global `tracing` subscriber.
///
/// Reads `SHARK_LOG` (and falls back to `RUST_LOG`) for level filtering.
/// Default filter: `info` everywhere. Set `SHARK_LOG=debug` for the full
/// per-frame diagnostics, or `SHARK_LOG=shark_client_rust_version_lib::udp_bridge=debug`
/// to scope to a single submodule.
fn init_tracing() {
    use tracing_subscriber::{fmt, prelude::*, EnvFilter};

    let env_filter = EnvFilter::try_from_env("SHARK_LOG")
        .or_else(|_| EnvFilter::try_from_default_env())
        .unwrap_or_else(|_| EnvFilter::new("info"));

    let _ = tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt::layer().with_target(true))
        .try_init();
}

/// Log platform diagnostics on startup.
/// Non-fatal: best-effort only.
fn print_startup_diagnostics() {
    let cache_dir = config::ensure_cache_dir();
    info!("========== SharkClientRust startup ==========");
    info!(target: "diag", "OS        : {}", std::env::consts::OS);
    info!(target: "diag", "Arch      : {}", std::env::consts::ARCH);
    info!(target: "diag", "Family    : {}", std::env::consts::FAMILY);
    info!(
        target: "diag",
        "ExePath   : {}",
        std::env::current_exe()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|_| "<unknown>".into())
    );
    info!(
        target: "diag",
        "Cwd       : {}",
        std::env::current_dir()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|_| "<unknown>".into())
    );
    info!(target: "diag", "AI backend: external Python script (manual start)");
    if let Ok(v) = std::env::var("SHARK_AI_SERVER_PATH") {
        info!(target: "diag", "AI path   : (env override) {}", v);
    }
    info!(target: "diag", "CacheDir  : {}", cache_dir.display());
    info!("=============================================");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_stdio_panic_swallower();
    init_tracing();
    print_startup_diagnostics();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(udp_bridge::UdpBridgeState::default())
        .manage(mqtt_client::MqttState::default())
        .manage(shm_bridge::PipeServerState::default())
        .manage(shm_bridge::PipeClientState::default())
        .setup(|app| {
            let window = create_main_window(app)?;
            let _ = window.set_fullscreen(true);

            // Delay showing the window until the frontend signals it has mounted,
            // eliminating the initial white flash. If the frontend never sends
            // the signal (e.g., JS error), fall back to showing after 2 seconds.
            let show_window = window.clone();
            app.listen("frontend-ready", move |_| {
                let _ = show_window.show();
                let _ = show_window.set_focus();
            });

            let fallback_window = window.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(2000)).await;
                if !fallback_window.is_visible().unwrap_or(false) {
                    let _ = fallback_window.show();
                    let _ = fallback_window.set_focus();
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            select_directory,
            select_file,
            config::get_setting,
            config::save_setting,
            config::get_robot_config,
            config::get_robot_types,
            config::read_yaml_config,
            config::dashboard_config_list,
            config::dashboard_config_load,
            config::dashboard_config_save,
            config::dashboard_config_delete,
            config::dashboard_config_check_panel_usage,
            config::get_model_path,
            config::hud_get_templates,
            config::hud_save_template,
            config::hud_update_template_title,
            config::hud_delete_template,
            config::graphic_get_all_categories,
            config::graphic_get_list,
            config::graphic_save,
            config::graphic_delete,
            config::graphic_rename,
            toggle_fullscreen,
            set_fullscreen,
            app_close,
            window_minimize,
            window_toggle_maximize,
            open_devtools,
            udp_bridge::udp_stream_start,
            udp_bridge::udp_stream_stop,
            udp_bridge::udp_stream_get_status,
            udp_bridge::udp_stream_get_latest_mjpeg_frame,
            mqtt_client::mqtt_connect,
            mqtt_client::mqtt_disconnect,
            mqtt_client::mqtt_publish,
            mqtt_client::mqtt_publish_raw,
            mqtt_client::mqtt_subscribe,
            mqtt_client::mqtt_unsubscribe,
            mqtt_client::mqtt_get_status,
            mqtt_client::mqtt_get_stats,
            mqtt_client::mqtt_reset_stats,
            mqtt_client::local_broker::mqtt_start_local_broker,
            mqtt_client::local_broker::mqtt_stop_local_broker,
            mqtt_client::local_broker::mqtt_get_local_broker_status,
            shm_bridge::shm_connect,
            shm_bridge::shm_disconnect,
            shm_bridge::shm_status,
            shm_bridge::shm_detect,
            shm_bridge::shm_detect_latest_mjpeg,
            shm_bridge::pipe_server_start,
            shm_bridge::pipe_server_stop,
            shm_bridge::pipe_server_get_status,
            shm_bridge::start_signaling_server,
            shm_bridge::stop_signaling_server,
            video_decoder::get_decode_capabilities
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if window.label() == "main" {
                    info!("main window destroyed, exiting");
                    std::process::exit(0);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
