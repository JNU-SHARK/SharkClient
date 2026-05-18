//! SharkClient IPC bridge: Windows Named Pipe (Unix Domain Socket on Linux).
//!
//! This module exposes two related feature sets:
//!
//! 1. **Pipe server lifecycle** (`pipe_server_*`): spawn/kill the Python
//!    `pipe_server.py` process that hosts the AI detection service over a
//!    named pipe. Mirrors `python_server.rs` but for the pipe backend and
//!    emits `pipe-server-status` events to the UI.
//!
//! 2. **Pipe client** (`shm_*`): open/close a client connection to the
//!    running pipe server and dispatch detection requests. Uses the same
//!    length-prefixed JSON framing as the Python side:
//!    `[4-byte little-endian length] [UTF-8 JSON payload]`
//!
//! 3. **Signaling server stubs** are kept as no-ops because the UI references
//!    them; WebRTC signaling is handled elsewhere.

use serde_json::{json, Map, Value};
use std::collections::VecDeque;
use std::io::Write as _;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;
use tracing::{info, warn};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};

#[cfg(windows)]
mod shared_frame {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::sync::atomic::{AtomicU64, Ordering};

    type Handle = *mut c_void;

    const INVALID_HANDLE_VALUE: Handle = -1isize as Handle;
    const PAGE_READWRITE: u32 = 0x04;
    const FILE_MAP_WRITE: u32 = 0x0002;

    static NEXT_ID: AtomicU64 = AtomicU64::new(1);

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateFileMappingW(
            hfile: Handle,
            attributes: *mut c_void,
            protect: u32,
            max_size_high: u32,
            max_size_low: u32,
            name: *const u16,
        ) -> Handle;
        fn MapViewOfFile(
            mapping: Handle,
            desired_access: u32,
            file_offset_high: u32,
            file_offset_low: u32,
            bytes_to_map: usize,
        ) -> *mut c_void;
        fn UnmapViewOfFile(address: *const c_void) -> i32;
        fn CloseHandle(handle: Handle) -> i32;
        fn GetLastError() -> u32;
    }

    pub struct SharedFrame {
        name: String,
        len: usize,
        handle: Handle,
    }

    // The mapping handle is only closed on drop after the awaited pipe round-trip.
    unsafe impl Send for SharedFrame {}

    impl SharedFrame {
        pub fn create(bytes: &[u8]) -> Result<Self, String> {
            if bytes.is_empty() {
                return Err("empty frame".to_string());
            }
            if bytes.len() > u32::MAX as usize {
                return Err(format!(
                    "frame too large for shared mapping: {} bytes",
                    bytes.len()
                ));
            }

            let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
            let name = format!(r"Local\SharkDetectionFrame-{}-{}", std::process::id(), id);
            let wide: Vec<u16> = std::ffi::OsStr::new(&name)
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            let len = bytes.len();

            let handle = unsafe {
                CreateFileMappingW(
                    INVALID_HANDLE_VALUE,
                    std::ptr::null_mut(),
                    PAGE_READWRITE,
                    0,
                    len as u32,
                    wide.as_ptr(),
                )
            };
            if handle.is_null() {
                let code = unsafe { GetLastError() };
                return Err(format!("CreateFileMappingW failed: {code}"));
            }

            let view = unsafe { MapViewOfFile(handle, FILE_MAP_WRITE, 0, 0, len) };
            if view.is_null() {
                let code = unsafe { GetLastError() };
                unsafe {
                    CloseHandle(handle);
                }
                return Err(format!("MapViewOfFile failed: {code}"));
            }

            unsafe {
                std::ptr::copy_nonoverlapping(bytes.as_ptr(), view.cast::<u8>(), len);
                UnmapViewOfFile(view);
            }

            Ok(Self { name, len, handle })
        }

        pub fn descriptor(&self) -> serde_json::Value {
            serde_json::json!({
                "name": self.name,
                "size": self.len,
                "format": "encoded-image",
            })
        }
    }

    impl Drop for SharedFrame {
        fn drop(&mut self) {
            if !self.handle.is_null() {
                unsafe {
                    CloseHandle(self.handle);
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

#[cfg(windows)]
const PIPE_NAME: &str = r"\\.\pipe\SharkDetectionPipe";

const READY_MARKER: &str = "[PipeServer] ready";
const PIPE_LOG_MAX_LINES: usize = 24;
const PIPE_CONNECT_RETRY_COUNT: usize = 40;
const PIPE_CONNECT_RETRY_DELAY: std::time::Duration = std::time::Duration::from_millis(150);
const PIPE_REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(8);

#[cfg(windows)]
fn pipe_endpoint() -> String {
    PIPE_NAME.to_string()
}

#[cfg(not(windows))]
fn pipe_endpoint() -> String {
    crate::config::get_cache_dir()
        .join("shark_detection.sock")
        .to_string_lossy()
        .into_owned()
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[derive(Default, Clone)]
pub struct PipeServerState {
    pub process_id: Arc<std::sync::Mutex<Option<u32>>>,
}

#[cfg(windows)]
type PipeStream = tokio::net::windows::named_pipe::NamedPipeClient;
#[cfg(not(windows))]
type PipeStream = tokio::net::UnixStream;

#[derive(Default)]
pub struct PipeClientState {
    /// Active client connection, serialized behind a mutex so concurrent
    /// detect() calls can't interleave frames.
    pub client: Arc<Mutex<Option<PipeStream>>>,
    pub metrics: std::sync::Mutex<PipeMetrics>,
}

#[derive(Default, Clone, Copy, serde::Serialize)]
pub struct PipeMetrics {
    pub requests: u64,
    pub bytes_sent: u64,
    pub bytes_recv: u64,
}

#[derive(serde::Serialize, Clone)]
struct StatusPayload {
    status: &'static str,
    message: String,
}

fn emit_status(app: &AppHandle, status: &'static str, message: impl Into<String>) {
    let _ = app.emit(
        "pipe-server-status",
        StatusPayload {
            status,
            message: message.into(),
        },
    );
}

fn pipe_server_log_path(_script: &str) -> Option<std::path::PathBuf> {
    Some(crate::config::get_log_dir().join("pipe-server.log"))
}

fn append_pipe_log(log_path: &Option<std::path::PathBuf>, line: impl AsRef<str>) {
    let Some(path) = log_path else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(file, "{}", line.as_ref());
    }
}

fn remember_pipe_output(
    recent: &Arc<std::sync::Mutex<VecDeque<String>>>,
    source: &str,
    line: &str,
    log_path: &Option<std::path::PathBuf>,
) {
    let entry = format!("[{source}] {line}");
    {
        let mut guard = recent.lock().unwrap();
        guard.push_back(entry.clone());
        while guard.len() > PIPE_LOG_MAX_LINES {
            guard.pop_front();
        }
    }
    append_pipe_log(log_path, entry);
}

fn recent_pipe_output(recent: &Arc<std::sync::Mutex<VecDeque<String>>>) -> String {
    recent
        .lock()
        .map(|lines| lines.iter().cloned().collect::<Vec<_>>().join("\n"))
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Resolve the Python script to launch
// ---------------------------------------------------------------------------

fn resolve_pipe_script(path: &str) -> Result<String, String> {
    fn script_in_dir(dir: &std::path::Path) -> Option<std::path::PathBuf> {
        for candidate in [
            "server/pipe_server.py",
            "pipe_server.py",
            "shared_memory/pipe_server.py",
        ] {
            let full = dir.join(candidate);
            if full.is_file() {
                return Some(full);
            }
        }
        None
    }

    fn push_search_roots(roots: &mut Vec<std::path::PathBuf>, root: std::path::PathBuf) {
        for ancestor in root.ancestors() {
            let candidate = ancestor.to_path_buf();
            if !roots.iter().any(|existing| existing == &candidate) {
                roots.push(candidate);
            }
        }
    }

    fn canonical_script(path: std::path::PathBuf) -> Result<String, String> {
        path.canonicalize()
            .map(|p| p.to_string_lossy().into_owned())
            .map_err(|e| format!("Invalid pipe server script '{}': {e}", path.display()))
    }

    if let Ok(env_path) = std::env::var("SHARK_AI_SERVER_PATH") {
        if !env_path.trim().is_empty() && env_path != path {
            return resolve_pipe_script(&env_path);
        }
    }

    let pb = std::path::Path::new(path);
    if pb.is_file() {
        return canonical_script(pb.to_path_buf());
    }
    if pb.is_dir() {
        if let Some(script) = script_in_dir(pb) {
            return canonical_script(script);
        }
        return Err(format!(
            "Pipe server script not found under '{}'",
            pb.display()
        ));
    }

    if pb.is_relative() {
        let mut roots = Vec::new();
        if let Ok(cwd) = std::env::current_dir() {
            push_search_roots(&mut roots, cwd);
        }
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                push_search_roots(&mut roots, dir.to_path_buf());
                push_search_roots(&mut roots, dir.join("resources"));
            }
        }
        for root in roots {
            let candidate = root.join(pb);
            if candidate.is_file() {
                return canonical_script(candidate);
            }
            if let Some(script) = script_in_dir(&candidate) {
                return canonical_script(script);
            }

            let ai_server_candidate = root.join("AI Server");
            if let Some(script) = script_in_dir(&ai_server_candidate) {
                return canonical_script(script);
            }
        }
    }

    Err(format!("Pipe server script not found: {path}"))
}

fn python_executable_name() -> &'static str {
    if cfg!(windows) {
        "python.exe"
    } else {
        "python"
    }
}

fn push_python_candidate(candidates: &mut Vec<std::path::PathBuf>, path: std::path::PathBuf) {
    if !candidates.iter().any(|existing| existing == &path) {
        candidates.push(path);
    }
}

fn push_venv_python_candidate(candidates: &mut Vec<std::path::PathBuf>, root: &std::path::Path) {
    let exe = python_executable_name();
    if cfg!(windows) {
        push_python_candidate(candidates, root.join(".venv").join("Scripts").join(exe));
        push_python_candidate(candidates, root.join("venv").join("Scripts").join(exe));
    } else {
        push_python_candidate(candidates, root.join(".venv").join("bin").join(exe));
        push_python_candidate(candidates, root.join("venv").join("bin").join(exe));
    }
}

fn is_source_tree_script(script: &str) -> bool {
    let script_path = std::path::Path::new(script);
    for ancestor in script_path.ancestors() {
        if ancestor.join("package.json").is_file() && ancestor.join("src-tauri").is_dir() {
            return true;
        }
    }
    false
}

fn resolve_python_bin(script: &str) -> Result<String, String> {
    if let Ok(explicit) = std::env::var("SHARK_PYTHON_PATH") {
        let trimmed = explicit.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            push_venv_python_candidate(&mut candidates, dir);
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        push_venv_python_candidate(&mut candidates, &cwd);
    }

    let script_path = std::path::Path::new(script);
    if let Some(script_dir) = script_path.parent() {
        push_venv_python_candidate(&mut candidates, script_dir);
        if let Some(parent) = script_dir.parent() {
            push_venv_python_candidate(&mut candidates, parent);
        }
    }

    if let Ok(ai_root) = std::env::var("SHARK_AI_SERVER_PATH") {
        let root = std::path::PathBuf::from(ai_root.trim());
        push_venv_python_candidate(&mut candidates, &root);
    }
    if let Ok(cwd) = std::env::current_dir() {
        push_venv_python_candidate(&mut candidates, &cwd.join("AI Server"));
    }

    for candidate in candidates {
        if candidate.is_file() {
            return Ok(candidate.to_string_lossy().into_owned());
        }
    }

    if is_source_tree_script(script)
        || std::env::var("SHARK_ALLOW_SYSTEM_PYTHON")
            .map(|v| v == "1")
            .unwrap_or(false)
    {
        if cfg!(windows) {
            Ok("python".to_string())
        } else {
            Ok("python3".to_string())
        }
    } else if cfg!(windows) {
        Err("AI Python environment not found. Run install-env.bat in the release folder first, or set SHARK_PYTHON_PATH to a Python executable.".to_string())
    } else {
        Err("AI Python environment not found. Run ./install-env.sh in the release folder first, or set SHARK_PYTHON_PATH to a Python executable.".to_string())
    }
}

// ---------------------------------------------------------------------------
// Pipe server lifecycle
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn pipe_server_start(
    app: AppHandle,
    state: tauri::State<'_, PipeServerState>,
    path: String,
) -> Result<Value, String> {
    {
        let guard = state.process_id.lock().unwrap();
        if guard.is_some() {
            return Ok(json!({ "success": true, "status": "running",
                              "message": "Pipe server already running" }));
        }
    }

    let script = match resolve_pipe_script(&path) {
        Ok(script) => script,
        Err(e) => {
            emit_status(&app, "error", &e);
            return Err(e);
        }
    };
    let script_dir = std::path::Path::new(&script)
        .parent()
        .map(|p| p.to_path_buf());
    info!(%script, "pipe server starting");

    emit_status(&app, "starting", format!("Starting {script}"));

    let python_bin = match resolve_python_bin(&script) {
        Ok(bin) => bin,
        Err(e) => {
            emit_status(&app, "error", &e);
            return Err(e);
        }
    };
    let mut cmd = Command::new(python_bin);
    cmd.arg(&script)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(false);
    cmd.env("PYTHONIOENCODING", "utf-8");
    cmd.env("PYTHONUNBUFFERED", "1");
    let cache_dir = crate::config::ensure_cache_dir();
    cmd.env("SHARK_CACHE_DIR", &cache_dir);
    cmd.env("PYTHONPYCACHEPREFIX", cache_dir.join("pycache"));
    cmd.env("PIP_CACHE_DIR", cache_dir.join("pip"));
    #[cfg(not(windows))]
    cmd.env("TMPDIR", &cache_dir);
    if let Some(dir) = script_dir {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    {
        // Hide python.exe's console window in release builds.
        cmd.creation_flags(0x0800_0000);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let msg = format!("Failed to spawn pipe server: {e}");
            emit_status(&app, "error", &msg);
            return Err(msg);
        }
    };

    let pid = child
        .id()
        .ok_or_else(|| "spawn succeeded but no PID".to_string())?;
    {
        let mut guard = state.process_id.lock().unwrap();
        *guard = Some(pid);
    }

    let log_path = pipe_server_log_path(&script);
    append_pipe_log(
        &log_path,
        format!("--- starting pipe server pid={pid} script={script} ---"),
    );
    let recent_output = Arc::new(std::sync::Mutex::new(VecDeque::<String>::new()));
    let ready_announced = Arc::new(AtomicBool::new(false));

    // Wire stdout: watch for the READY_MARKER to flip status to "running".
    if let Some(stdout) = child.stdout.take() {
        let app_c = app.clone();
        let recent = recent_output.clone();
        let ready = ready_announced.clone();
        let log_path = log_path.clone();
        tokio::spawn(async move {
            use tokio::io::AsyncBufReadExt;
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                info!(target: "pipe_server::stdout", "{line}");
                remember_pipe_output(&recent, "stdout", &line, &log_path);
                if !ready.load(Ordering::Relaxed) && line.contains(READY_MARKER) {
                    ready.store(true, Ordering::Relaxed);
                    emit_status(&app_c, "running", "Pipe server ready");
                }
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let recent = recent_output.clone();
        let log_path = log_path.clone();
        tokio::spawn(async move {
            use tokio::io::AsyncBufReadExt;
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                warn!(target: "pipe_server::stderr", "{line}");
                remember_pipe_output(&recent, "stderr", &line, &log_path);
            }
        });
    }

    // Exit watcher 鈥?clear PID and notify UI when the process dies.
    let app_exit = app.clone();
    let pid_slot = state.process_id.clone();
    let pid_for_watcher = pid;
    let recent = recent_output.clone();
    let ready = ready_announced.clone();
    let log_path_for_exit = log_path.clone();
    tokio::spawn(async move {
        let status = child.wait().await;
        tokio::time::sleep(std::time::Duration::from_millis(80)).await;
        let detail = recent_pipe_output(&recent);
        let log_hint = log_path_for_exit
            .as_ref()
            .map(|p| format!(" See log: {}", p.display()))
            .unwrap_or_default();
        let msg = match status {
            Ok(st) => {
                let mut base = format!("Pipe server (PID {pid_for_watcher}) exited: {st}.");
                if !detail.trim().is_empty() {
                    base.push_str("\nLast output:\n");
                    base.push_str(&detail);
                }
                base.push_str(&log_hint);
                base
            }
            Err(e) => format!("Pipe server wait error: {e}.{log_hint}"),
        };
        append_pipe_log(&log_path_for_exit, &msg);
        // Only clear the slot if it still refers to *this* PID 鈥?otherwise a
        // newer start has already taken over.
        {
            let mut guard = pid_slot.lock().unwrap();
            if guard.as_ref() == Some(&pid_for_watcher) {
                *guard = None;
            }
        }
        info!("{msg}");
        let exit_status = if ready.load(Ordering::Relaxed) {
            "stopped"
        } else {
            "error"
        };
        emit_status(&app_exit, exit_status, msg);
    });

    Ok(json!({
        "success": true,
        "status": "starting",
        "pid": pid,
        "pipe": pipe_endpoint(),
    }))
}

#[tauri::command]
pub async fn pipe_server_stop(
    app: AppHandle,
    state: tauri::State<'_, PipeServerState>,
) -> Result<bool, String> {
    let pid = {
        let mut guard = state.process_id.lock().unwrap();
        guard.take()
    };
    match pid {
        Some(pid) => {
            #[cfg(windows)]
            {
                let _ = std::process::Command::new("taskkill")
                    .args(["/PID", &pid.to_string(), "/T", "/F"])
                    .output();
            }
            #[cfg(not(windows))]
            {
                let _ = std::process::Command::new("kill")
                    .args(["-TERM", &pid.to_string()])
                    .output();
            }
            emit_status(&app, "stopped", format!("Stopped pipe server (PID: {pid})"));
            Ok(true)
        }
        None => {
            emit_status(&app, "stopped", "Pipe server not running");
            Ok(false)
        }
    }
}

#[tauri::command]
pub fn pipe_server_get_status(state: tauri::State<'_, PipeServerState>) -> Value {
    let pid = *state.process_id.lock().unwrap();
    json!({
        "running": pid.is_some(),
        "pid": pid,
        "pipe": pipe_endpoint(),
    })
}

// ---------------------------------------------------------------------------
// Pipe client (shm_*)
// ---------------------------------------------------------------------------

#[cfg(windows)]
async fn connect_pipe() -> Result<PipeStream, String> {
    use tokio::net::windows::named_pipe::ClientOptions;
    // Retry a few times in case the server is still coming up.
    let mut last_err = String::from("no attempt");
    for _ in 0..PIPE_CONNECT_RETRY_COUNT {
        match ClientOptions::new().open(PIPE_NAME) {
            Ok(c) => return Ok(c),
            Err(e) => {
                last_err = e.to_string();
                tokio::time::sleep(PIPE_CONNECT_RETRY_DELAY).await;
            }
        }
    }
    Err(format!("Failed to connect to pipe {PIPE_NAME}: {last_err}"))
}

#[cfg(not(windows))]
async fn connect_pipe() -> Result<PipeStream, String> {
    let pipe = pipe_endpoint();
    let mut last_err = String::from("no attempt");
    for _ in 0..PIPE_CONNECT_RETRY_COUNT {
        match tokio::net::UnixStream::connect(&pipe).await {
            Ok(c) => return Ok(c),
            Err(e) => {
                last_err = e.to_string();
                tokio::time::sleep(PIPE_CONNECT_RETRY_DELAY).await;
            }
        }
    }
    Err(format!("Failed to connect to socket {pipe}: {last_err}"))
}

#[tauri::command]
pub async fn shm_connect(state: tauri::State<'_, PipeClientState>) -> Result<bool, String> {
    let mut guard = state.client.lock().await;
    if guard.is_some() {
        return Ok(true);
    }
    let client = connect_pipe().await?;
    *guard = Some(client);
    info!(pipe = %pipe_endpoint(), "pipe client connected");
    Ok(true)
}

#[tauri::command]
pub async fn shm_disconnect(state: tauri::State<'_, PipeClientState>) -> Result<bool, String> {
    let mut guard = state.client.lock().await;
    let was_connected = guard.is_some();
    *guard = None;
    if was_connected {
        info!("pipe client disconnected");
    }
    Ok(was_connected)
}

#[tauri::command]
pub async fn shm_status(state: tauri::State<'_, PipeClientState>) -> Result<Value, String> {
    let connected = state.client.lock().await.is_some();
    let m = *state.metrics.lock().unwrap();
    Ok(json!({
        "connected": connected,
        "pipe": pipe_endpoint(),
        "metrics": {
            "requests": m.requests,
            "bytesSent": m.bytes_sent,
            "bytesRecv": m.bytes_recv,
        }
    }))
}

#[cfg(windows)]
fn request_with_shared_frame(
    data: &Value,
) -> Result<(Value, Option<shared_frame::SharedFrame>), String> {
    let image_b64 = data
        .get("image")
        .and_then(Value::as_str)
        .or_else(|| data.get("image_b64").and_then(Value::as_str));
    let Some(image_b64) = image_b64 else {
        return Ok((data.clone(), None));
    };

    let encoded = image_b64
        .split_once(',')
        .map(|(_, tail)| tail)
        .unwrap_or(image_b64);
    let image_bytes = BASE64_STANDARD
        .decode(encoded)
        .map_err(|e| format!("base64 decode for shared frame: {e}"))?;

    let frame = shared_frame::SharedFrame::create(&image_bytes)?;
    let mut request = data.clone();
    if let Some(obj) = request.as_object_mut() {
        obj.remove("image");
        obj.remove("image_b64");
        obj.insert("transport".to_string(), json!("shared_memory"));
        obj.insert("image_shm".to_string(), frame.descriptor());
    }

    Ok((request, Some(frame)))
}

#[cfg(windows)]
fn request_with_shared_image_bytes(
    mut request: Map<String, Value>,
    image_bytes: &[u8],
) -> Result<(Value, Option<shared_frame::SharedFrame>), String> {
    let frame = shared_frame::SharedFrame::create(image_bytes)?;
    request.remove("image");
    request.remove("image_b64");
    request.insert("transport".to_string(), json!("shared_memory"));
    request.insert("image_shm".to_string(), frame.descriptor());
    Ok((Value::Object(request), Some(frame)))
}

#[cfg(not(windows))]
fn request_with_shared_frame(data: &Value) -> Result<(Value, Option<()>), String> {
    Ok((data.clone(), None))
}

#[cfg(not(windows))]
fn request_with_shared_image_bytes(
    mut request: Map<String, Value>,
    image_bytes: &[u8],
) -> Result<(Value, Option<()>), String> {
    request.remove("image");
    request.remove("image_b64");
    request.insert("transport".to_string(), json!("pipe_base64"));
    request.insert(
        "image".to_string(),
        json!(BASE64_STANDARD.encode(image_bytes)),
    );
    Ok((Value::Object(request), None))
}

async fn send_pipe_request(
    state: tauri::State<'_, PipeClientState>,
    request_data: Value,
) -> Result<Value, String> {
    let mut guard = state.client.lock().await;
    if guard.is_none() {
        *guard = Some(connect_pipe().await?);
    }
    let stream = guard.as_mut().ok_or("no pipe client")?;

    let body = serde_json::to_vec(&request_data).map_err(|e| e.to_string())?;
    let len = body.len() as u32;
    let header = len.to_le_bytes();

    let resp_buf = match tokio::time::timeout(PIPE_REQUEST_TIMEOUT, async {
        stream
            .write_all(&header)
            .await
            .map_err(|e| format!("write header: {e}"))?;
        stream
            .write_all(&body)
            .await
            .map_err(|e| format!("write body: {e}"))?;
        stream.flush().await.map_err(|e| format!("flush: {e}"))?;

        let mut resp_header = [0u8; 4];
        stream
            .read_exact(&mut resp_header)
            .await
            .map_err(|e| format!("read header: {e}"))?;
        let resp_len = u32::from_le_bytes(resp_header) as usize;
        if resp_len == 0 || resp_len > 64 * 1024 * 1024 {
            return Err(format!("bad response length: {resp_len}"));
        }
        let mut resp_buf = vec![0u8; resp_len];
        stream
            .read_exact(&mut resp_buf)
            .await
            .map_err(|e| format!("read body: {e}"))?;
        Ok::<Vec<u8>, String>(resp_buf)
    })
    .await
    {
        Ok(Ok(buf)) => buf,
        Ok(Err(error)) => {
            *guard = None;
            return Err(error);
        }
        Err(_) => {
            *guard = None;
            return Err(format!(
                "pipe request timed out after {}ms",
                PIPE_REQUEST_TIMEOUT.as_millis()
            ));
        }
    };
    let resp_len = resp_buf.len();

    {
        let mut m = state.metrics.lock().unwrap();
        m.requests = m.requests.saturating_add(1);
        m.bytes_sent = m.bytes_sent.saturating_add((4 + body.len()) as u64);
        m.bytes_recv = m.bytes_recv.saturating_add((4 + resp_len) as u64);
    }

    serde_json::from_slice(&resp_buf).map_err(|e| format!("decode response: {e}"))
}

/// Send a JSON request frame and wait for one JSON response frame.
/// `data` is the inner JSON value, e.g. `{"op":"detect", "image":"..."}`.
#[tauri::command]
pub async fn shm_detect(
    state: tauri::State<'_, PipeClientState>,
    data: Value,
) -> Result<Value, String> {
    let (request_data, _shared_frame_guard) = request_with_shared_frame(&data)?;
    send_pipe_request(state, request_data).await
}

#[tauri::command]
pub async fn shm_detect_latest_mjpeg(
    pipe_state: tauri::State<'_, PipeClientState>,
    udp_state: tauri::State<'_, crate::udp_bridge::UdpBridgeState>,
    data: Value,
) -> Result<Value, String> {
    let Some((_seq, width, height, jpeg)) = udp_state.latest_mjpeg_frame_bytes() else {
        return Ok(json!({
            "success": false,
            "error": "no backend MJPEG frame available",
            "detections": []
        }));
    };

    let mut request = match data {
        Value::Object(map) => map,
        _ => return Err("detect request must be a JSON object".into()),
    };
    request.insert("op".to_string(), json!("detect"));
    request.insert(
        "frame_size".to_string(),
        json!({ "width": width, "height": height }),
    );

    let (request_data, _shared_frame_guard) = request_with_shared_image_bytes(request, &jpeg)?;
    send_pipe_request(pipe_state, request_data).await
}

// ---------------------------------------------------------------------------
// Signaling stubs (kept for UI compatibility)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn start_signaling_server() -> Result<bool, String> {
    info!("WebRTC signaling server started (stub)");
    Ok(true)
}

#[tauri::command]
pub async fn stop_signaling_server() -> Result<bool, String> {
    info!("WebRTC signaling server stopped (stub)");
    Ok(true)
}
