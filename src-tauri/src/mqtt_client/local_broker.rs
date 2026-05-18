//! Local MQTT broker stubs.
//!
//! The Rust client build does not host an in-process MQTT broker — the UI
//! still calls these commands so we keep them as `Ok(false/stopped)` stubs.
//! If a real broker is ever needed, replace the function bodies here.

use serde::Serialize;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LocalBrokerStatusPayload {
    status: String,
    port: u16,
}

#[tauri::command]
pub async fn mqtt_start_local_broker(_port: u16) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "success": false,
        "error": "Local broker is disabled in the Rust client build.",
    }))
}

#[tauri::command]
pub async fn mqtt_stop_local_broker() -> Result<bool, String> {
    Ok(true)
}

#[tauri::command]
pub async fn mqtt_get_local_broker_status() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!(LocalBrokerStatusPayload {
        status: "stopped".to_string(),
        port: 3333,
    }))
}
