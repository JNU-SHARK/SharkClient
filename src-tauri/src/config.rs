use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[allow(non_snake_case)]
pub struct RobotTypeConfig {
    pub customDataProto: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[allow(dead_code)]
pub struct RobotMapping {
    pub r#type: String, // Use raw identifier for `type`
    pub team: String,
    pub number: u32,
    pub id: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")] // Ensure camelCase naming convention if necessary
#[allow(dead_code)]
pub struct RobotConfigFile {
    pub robot_types: std::collections::HashMap<String, RobotTypeConfig>,
    pub robot_mappings: std::collections::HashMap<String, RobotMapping>,
}

fn get_resource_dir(app: &tauri::AppHandle) -> PathBuf {
    let mut paths_to_try = Vec::new();

    // 1. Tauri's native resource resolver
    if let Ok(res_dir) = app.path().resource_dir() {
        paths_to_try.push(res_dir.join("_up_").join("resources"));
        paths_to_try.push(res_dir.join("resources"));
    }

    // 2. Relative to current executable (useful when running standalone exe from target/release)
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            paths_to_try.push(exe_dir.join("_up_").join("resources"));
            paths_to_try.push(exe_dir.join("resources"));
            // Try going up to repo root from target/release
            paths_to_try.push(exe_dir.join("..").join("..").join("resources"));
        }
    }

    // 3. Relative to current working directory (useful in dev mode)
    if let Ok(cwd) = std::env::current_dir() {
        paths_to_try.push(cwd.join("resources"));
        paths_to_try.push(cwd.join("..").join("resources"));
    }

    for p in paths_to_try {
        if p.exists() {
            return p;
        }
    }

    // Fallback if all else fails — return a relative path that may not exist
    // (callers are expected to handle missing resources gracefully).
    PathBuf::from("resources")
}

fn ensure_xml_filename(filename: &str) -> Result<String, String> {
    let trimmed = filename.trim();
    if trimmed.is_empty() {
        return Err("Filename cannot be empty".to_string());
    }

    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains("..") {
        return Err("Invalid filename".to_string());
    }

    if trimmed.ends_with(".xml") {
        Ok(trimmed.to_string())
    } else {
        Ok(format!("{}.xml", trimmed))
    }
}

fn escape_xml_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn emit_hud_template_changed(app: &tauri::AppHandle, event_type: &str, filename: &str) {
    let _ = app.emit(
        "hud-template-changed",
        serde_json::json!({
            "eventType": event_type,
            "filename": filename,
        }),
    );
}

fn hud_template_dir(app: &tauri::AppHandle) -> PathBuf {
    get_resource_dir(app).join("HUDPanel")
}

fn graphic_fix_dir(app: &tauri::AppHandle) -> PathBuf {
    get_resource_dir(app).join("CustomElement").join("Fix")
}

fn find_hud_template_file_by_id(
    app: &tauri::AppHandle,
    id: &str,
) -> Result<Option<(PathBuf, String)>, String> {
    let path = hud_template_dir(app);
    if !path.exists() {
        return Ok(None);
    }

    let id_pattern = format!("id=\"{}\"", id);
    let entries = std::fs::read_dir(path).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_file() {
            continue;
        }

        let file_name = entry.file_name().into_string().unwrap_or_default();
        if !file_name.ends_with(".xml") {
            continue;
        }

        let file_path = entry.path();
        let content = std::fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
        if content.contains(&id_pattern) {
            return Ok(Some((file_path, file_name)));
        }
    }

    Ok(None)
}

pub fn get_bundle_root_dir() -> PathBuf {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            return exe_dir.to_path_buf();
        }
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

pub fn get_cache_dir() -> PathBuf {
    if let Ok(cache_dir) = std::env::var("SHARK_CACHE_DIR") {
        let path = PathBuf::from(cache_dir);
        if !path.as_os_str().is_empty() {
            return path;
        }
    }
    get_bundle_root_dir().join("Cache")
}

pub fn get_webview_data_dir() -> PathBuf {
    get_cache_dir().join("WebView")
}

pub fn get_log_dir() -> PathBuf {
    get_cache_dir().join("logs")
}

pub fn ensure_cache_dir() -> PathBuf {
    let cache_dir = get_cache_dir();
    let _ = fs::create_dir_all(&cache_dir);
    cache_dir
}

pub fn get_settings_path(_app: &AppHandle) -> PathBuf {
    get_cache_dir().join("settings.json")
}

#[tauri::command]
pub fn get_setting(app: AppHandle, key: String) -> Result<serde_json::Value, String> {
    let path = get_settings_path(&app);
    if path.exists() {
        let content = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read settings file: {}", e))?;
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(val) = json.get(&key) {
                return Ok(val.clone());
            }
        }
    }
    // Return null if not found
    Ok(serde_json::Value::Null)
}

#[tauri::command]
pub fn save_setting(app: AppHandle, key: String, value: serde_json::Value) -> Result<bool, String> {
    let path = get_settings_path(&app);

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let mut settings = if path.exists() {
        let content = fs::read_to_string(&path).unwrap_or_else(|_| "{}".to_string());
        serde_json::from_str::<serde_json::Value>(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    if let Some(obj) = settings.as_object_mut() {
        obj.insert(key, value);
    }

    let buf = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Serialization error: {}", e))?;

    fs::write(&path, buf).map_err(|e| format!("Write error: {}", e))?;

    Ok(true)
}

#[tauri::command]
pub fn read_yaml_config(app: AppHandle, filename: String) -> Result<serde_yaml::Value, String> {
    let target_path = get_resource_dir(&app).join(&filename);

    if !target_path.exists() {
        return Err(format!("YAML file not found: {:?}", target_path));
    }

    let content =
        fs::read_to_string(&target_path).map_err(|e| format!("Failed to read YAML file: {}", e))?;

    let yaml: serde_yaml::Value =
        serde_yaml::from_str(&content).map_err(|e| format!("Parse error: {}", e))?;

    Ok(yaml)
}

#[tauri::command]
pub async fn dashboard_config_list(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let mut path = get_resource_dir(&app);
    path.push("DashboardConfig");

    if !path.exists() {
        return Ok(serde_json::json!({ "success": true, "configs": [] }));
    }

    let mut configs = Vec::new();
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Ok(file_type) = entry.file_type() {
                if file_type.is_file() {
                    let file_name = entry.file_name().into_string().unwrap_or_default();
                    if file_name.ends_with(".xml") {
                        if let Ok(content) = std::fs::read_to_string(entry.path()) {
                            let name = if let Some(start) = content.find("<name>") {
                                if let Some(end) = content[start + 6..].find("</name>") {
                                    content[start + 6..start + 6 + end].to_string()
                                } else {
                                    file_name.replace(".xml", "")
                                }
                            } else {
                                file_name.replace(".xml", "")
                            };

                            // To avoid humantime crate dependency, just use a dummy date for now
                            configs.push(serde_json::json!({
                                "filename": file_name,
                                "name": name,
                                "modifiedAt": "2026-01-01T00:00:00Z"
                            }));
                        }
                    }
                }
            }
        }
    }
    Ok(serde_json::json!({ "success": true, "configs": configs }))
}

#[tauri::command]
pub async fn dashboard_config_load(
    app: tauri::AppHandle,
    filename: String,
) -> Result<serde_json::Value, String> {
    let mut filename = filename;
    if !filename.ends_with(".xml") {
        filename.push_str(".xml");
    }
    let mut path = get_resource_dir(&app);
    path.push("DashboardConfig");
    path.push(filename);

    if !path.exists() {
        return Ok(serde_json::json!({ "success": false, "error": "Config file not found" }));
    }

    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "success": true, "content": content }))
}

#[tauri::command]
pub async fn dashboard_config_save(
    app: tauri::AppHandle,
    filename: String,
    content: String,
) -> Result<serde_json::Value, String> {
    let mut filename = filename;
    if !filename.ends_with(".xml") {
        filename.push_str(".xml");
    }
    let mut path = get_resource_dir(&app);
    path.push("DashboardConfig");

    let _ = std::fs::create_dir_all(&path);
    path.push(filename);

    std::fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "success": true }))
}

#[tauri::command]
pub async fn dashboard_config_delete(
    app: tauri::AppHandle,
    filename: String,
) -> Result<serde_json::Value, String> {
    let mut filename = filename;
    if !filename.ends_with(".xml") {
        filename.push_str(".xml");
    }
    let mut path = get_resource_dir(&app);
    path.push("DashboardConfig");
    path.push(filename);

    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(serde_json::json!({ "success": true }))
}

#[tauri::command]
pub async fn dashboard_config_check_panel_usage(
    app: tauri::AppHandle,
    panel_id: String,
) -> Result<serde_json::Value, String> {
    let mut path = get_resource_dir(&app);
    path.push("DashboardConfig");

    if !path.exists() {
        return Ok(serde_json::json!({ "success": true, "usedBy": [] }));
    }

    let mut used_by = Vec::new();
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Ok(file_type) = entry.file_type() {
                if file_type.is_file() {
                    let file_name = entry.file_name().into_string().unwrap_or_default();
                    if file_name.ends_with(".xml") {
                        if let Ok(content) = std::fs::read_to_string(entry.path()) {
                            let pattern1 = format!("id=\"{}\"", panel_id);
                            let pattern2 = format!("panelId=\"{}\"", panel_id);
                            if content.contains(&pattern1) || content.contains(&pattern2) {
                                let name = if let Some(start) = content.find("<name>") {
                                    if let Some(end) = content[start + 6..].find("</name>") {
                                        content[start + 6..start + 6 + end].to_string()
                                    } else {
                                        file_name.replace(".xml", "")
                                    }
                                } else {
                                    file_name.replace(".xml", "")
                                };
                                used_by.push(serde_json::json!({
                                    "filename": file_name,
                                    "name": name
                                }));
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(serde_json::json!({ "success": true, "usedBy": used_by }))
}

#[tauri::command]
pub async fn get_model_path(
    app: tauri::AppHandle,
    relative_path: String,
) -> Result<Option<String>, String> {
    let mut path = get_resource_dir(&app);
    for part in relative_path.split('/') {
        path.push(part);
    }
    if path.exists() {
        Ok(Some(format!("app://{}", relative_path)))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn hud_get_templates(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let mut path = get_resource_dir(&app);
    path.push("HUDPanel");

    let mut templates = Vec::new();
    if path.exists() {
        if let Ok(entries) = std::fs::read_dir(path) {
            for entry in entries.flatten() {
                if let Ok(file_type) = entry.file_type() {
                    if file_type.is_file() {
                        let file_name = entry.file_name().into_string().unwrap_or_default();
                        if file_name.ends_with(".xml") {
                            if let Ok(content) = std::fs::read_to_string(entry.path()) {
                                templates.push(serde_json::json!({
                                    "filename": file_name,
                                    "content": content
                                }));
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(serde_json::Value::Array(templates))
}

#[tauri::command]
pub async fn hud_save_template(
    app: tauri::AppHandle,
    filename: String,
    content: String,
) -> Result<bool, String> {
    let filename = ensure_xml_filename(&filename)?;
    let dir = hud_template_dir(&app);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let path = dir.join(&filename);
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    emit_hud_template_changed(&app, "save", &filename);
    Ok(true)
}

#[tauri::command]
pub async fn hud_update_template_title(
    app: tauri::AppHandle,
    id: String,
    title: String,
) -> Result<bool, String> {
    let id = id.trim();
    if id.is_empty() {
        return Err("Template id cannot be empty".to_string());
    }

    let Some((path, filename)) = find_hud_template_file_by_id(&app, id)? else {
        return Err(format!("HUD template not found: {}", id));
    };

    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let escaped_title = escape_xml_text(&title);
    let updated = if let Some(start) = content.find("<title>") {
        if let Some(end_offset) = content[start + 7..].find("</title>") {
            let end = start + 7 + end_offset;
            format!("{}{}{}", &content[..start + 7], escaped_title, &content[end..])
        } else {
            return Err("Malformed HUD template title tag".to_string());
        }
    } else {
        content.replacen('>', &format!(">\n  <title>{}</title>", escaped_title), 1)
    };

    std::fs::write(&path, updated).map_err(|e| e.to_string())?;
    emit_hud_template_changed(&app, "update", &filename);
    Ok(true)
}

#[tauri::command]
pub async fn hud_delete_template(app: tauri::AppHandle, id: String) -> Result<bool, String> {
    let id = id.trim();
    if id.is_empty() {
        return Err("Template id cannot be empty".to_string());
    }

    let Some((path, filename)) = find_hud_template_file_by_id(&app, id)? else {
        return Ok(false);
    };

    std::fs::remove_file(path).map_err(|e| e.to_string())?;
    emit_hud_template_changed(&app, "delete", &filename);
    Ok(true)
}

#[tauri::command]
pub async fn graphic_get_all_categories(
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    let mut base_path = get_resource_dir(&app);
    base_path.push("CustomElement");

    let mut categories = serde_json::Map::new();

    for category in &["Basic", "Dynamic", "Fix"] {
        let mut path = base_path.clone();
        path.push(category);

        let mut items = Vec::new();
        if path.exists() {
            if let Ok(entries) = std::fs::read_dir(path) {
                for entry in entries.flatten() {
                    if let Ok(file_type) = entry.file_type() {
                        let file_name = entry.file_name().into_string().unwrap_or_default();
                        if file_type.is_file() && file_name.ends_with(".xml") {
                            if let Ok(content) = std::fs::read_to_string(entry.path()) {
                                items.push(serde_json::json!({
                                    "filename": file_name.replace(".xml", ""),
                                    "content": content
                                }));
                            }
                        }
                    }
                }
            }
        }
        categories.insert(category.to_lowercase(), serde_json::Value::Array(items));
    }

    Ok(serde_json::Value::Object(categories))
}

#[tauri::command]
pub async fn graphic_get_list(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let mut path = get_resource_dir(&app);
    path.push("CustomElement");
    path.push("Fix");

    let mut items = Vec::new();
    if path.exists() {
        if let Ok(entries) = std::fs::read_dir(path) {
            for entry in entries.flatten() {
                if let Ok(file_type) = entry.file_type() {
                    let file_name = entry.file_name().into_string().unwrap_or_default();
                    if file_type.is_file() && file_name.ends_with(".xml") {
                        if let Ok(content) = std::fs::read_to_string(entry.path()) {
                            items.push(serde_json::json!({
                                "filename": file_name,
                                "content": content
                            }));
                        }
                    }
                }
            }
        }
    }
    Ok(serde_json::Value::Array(items))
}

#[tauri::command]
pub async fn graphic_save(
    app: tauri::AppHandle,
    filename: String,
    content: String,
) -> Result<bool, String> {
    let filename = ensure_xml_filename(&filename)?;
    let dir = graphic_fix_dir(&app);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(filename), content).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn graphic_delete(app: tauri::AppHandle, filename: String) -> Result<bool, String> {
    let filename = ensure_xml_filename(&filename)?;
    let path = graphic_fix_dir(&app).join(filename);
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(true)
}

#[tauri::command]
pub async fn graphic_rename(
    app: tauri::AppHandle,
    old_name: String,
    new_name: String,
) -> Result<bool, String> {
    let old_name = ensure_xml_filename(&old_name)?;
    let new_name = ensure_xml_filename(&new_name)?;
    let dir = graphic_fix_dir(&app);
    let old_path = dir.join(old_name);
    let new_path = dir.join(new_name);

    if !old_path.exists() {
        return Err("Graphic template not found".to_string());
    }
    if new_path.exists() {
        return Err("Target graphic template already exists".to_string());
    }

    std::fs::rename(old_path, new_path).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn get_robot_config(app: AppHandle) -> Result<serde_yaml::Value, String> {
    read_yaml_config(app, "RobotConfig.yaml".to_string())
}

#[tauri::command]
pub fn get_robot_types(app: AppHandle) -> Result<serde_yaml::Value, String> {
    read_yaml_config(app, "RoboSelect.yaml".to_string())
}

// More specific configurations can be added here
