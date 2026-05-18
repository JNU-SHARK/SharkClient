pub mod local_broker;

use rumqttc::{AsyncClient, Event, Incoming, LastWill, MqttOptions, QoS};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;
use tokio::sync::Notify;
use tokio::task::JoinHandle;
use tracing::{info, warn};

const MQTT_MESSAGE_BATCH_MAX_LEN: usize = 64;
const MQTT_MESSAGE_BATCH_INTERVAL_MS: u64 = 16;

// ==================== Payload Types ====================

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MqttStatusPayload {
    pub status: String,
    pub connected: bool,
    pub reconnect_attempt: u32,
}

#[derive(Serialize, Clone)]
pub struct MqttMessagePayload {
    pub topic: String,
    pub payload: Vec<u8>,
}

// ==================== Config ====================

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LastWillConfig {
    pub topic: String,
    pub payload: Vec<u8>,
    pub qos: Option<u8>,
    pub retain: Option<bool>,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MqttConfig {
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    pub client_id: Option<String>,
    pub topics: Option<Vec<String>>,
    /// MQTT keep-alive interval (seconds). Default: 10.
    pub keep_alive_secs: Option<u16>,
    /// Clean session flag. Default: true.
    pub clean_session: Option<bool>,
    /// Enable automatic reconnect on unexpected disconnect. Default: true.
    pub auto_reconnect: Option<bool>,
    /// Initial reconnect delay (ms). Default: 1000. Doubles with each failed attempt up to 30s.
    pub reconnect_initial_ms: Option<u64>,
    /// Default subscription QoS (0/1/2). Default: 1.
    pub subscribe_qos: Option<u8>,
    /// Last-will and testament message published by the broker on unexpected disconnect.
    pub last_will: Option<LastWillConfig>,
}

// ==================== State ====================

#[derive(Default)]
pub struct MqttStats {
    pub messages_received: AtomicU64,
    pub messages_sent: AtomicU64,
    pub bytes_received: AtomicU64,
    pub bytes_sent: AtomicU64,
    pub reconnect_attempts: AtomicU64,
}

pub struct MqttState {
    pub client: Arc<Mutex<Option<AsyncClient>>>,
    pub is_connected: Arc<Mutex<bool>>,
    pub status: Arc<Mutex<String>>,
    pub subscriptions: Arc<Mutex<BTreeSet<String>>>,
    pub listen_task: Arc<Mutex<Option<JoinHandle<()>>>>,
    pub abort_handle: Arc<Notify>,
    pub stats: Arc<MqttStats>,
}

impl Default for MqttState {
    fn default() -> Self {
        Self {
            client: Arc::new(Mutex::new(None)),
            is_connected: Arc::new(Mutex::new(false)),
            status: Arc::new(Mutex::new("disconnected".to_string())),
            subscriptions: Arc::new(Mutex::new(BTreeSet::new())),
            listen_task: Arc::new(Mutex::new(None)),
            abort_handle: Arc::new(Notify::new()),
            stats: Arc::new(MqttStats::default()),
        }
    }
}

// ==================== Helpers ====================

fn qos_from_u8(value: u8) -> QoS {
    match value {
        2 => QoS::ExactlyOnce,
        0 => QoS::AtMostOnce,
        _ => QoS::AtLeastOnce,
    }
}

fn set_status(
    app: &AppHandle,
    status: &Arc<Mutex<String>>,
    is_connected: &Arc<Mutex<bool>>,
    next_status: &str,
    reconnect_attempt: u32,
) {
    let connected = next_status == "connected";
    *status.lock().unwrap() = next_status.to_string();
    *is_connected.lock().unwrap() = connected;

    let _ = app.emit(
        "mqtt-status",
        MqttStatusPayload {
            status: next_status.to_string(),
            connected,
            reconnect_attempt,
        },
    );
}

fn emit_mqtt_message_batch(app: &AppHandle, pending_messages: &mut Vec<MqttMessagePayload>) {
    if pending_messages.is_empty() {
        return;
    }

    let batch: Vec<MqttMessagePayload> = pending_messages.drain(..).collect();
    let _ = app.emit("mqtt-message-batch", batch);
}

async fn stop_existing_connection(state: &tauri::State<'_, MqttState>) {
    state.abort_handle.notify_waiters();

    let client_opt = state.client.lock().unwrap().take();
    if let Some(client) = client_opt {
        let _ = client.disconnect().await;
    }

    let old_task = state.listen_task.lock().unwrap().take();
    if let Some(task) = old_task {
        task.abort();
    }
}

fn build_mqtt_options(config: &MqttConfig, client_id: &str) -> MqttOptions {
    let mut opts = MqttOptions::new(client_id, &config.host, config.port);
    opts.set_keep_alive(std::time::Duration::from_secs(
        config.keep_alive_secs.unwrap_or(10) as u64,
    ));
    opts.set_clean_session(config.clean_session.unwrap_or(true));

    if let (Some(username), Some(password)) = (&config.username, &config.password) {
        opts.set_credentials(username.clone(), password.clone());
    }

    if let Some(lw) = &config.last_will {
        let will = LastWill::new(
            lw.topic.clone(),
            lw.payload.clone(),
            qos_from_u8(lw.qos.unwrap_or(1)),
            lw.retain.unwrap_or(false),
        );
        opts.set_last_will(will);
    }

    opts
}

// ==================== Commands ====================

#[tauri::command]
pub async fn mqtt_connect(
    app: AppHandle,
    state: tauri::State<'_, MqttState>,
    config: MqttConfig,
) -> Result<bool, String> {
    stop_existing_connection(&state).await;

    let subscribed_topics = config.topics.clone().unwrap_or_default();
    {
        let mut topics = state.subscriptions.lock().unwrap();
        topics.clear();
        topics.extend(
            subscribed_topics
                .into_iter()
                .map(|topic| topic.trim().to_string())
                .filter(|topic| !topic.is_empty()),
        );
    }

    set_status(&app, &state.status, &state.is_connected, "connecting", 0);

    let client_id = config.client_id.clone().unwrap_or_else(|| {
        format!(
            "shark_client_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs()
        )
    });

    let subscribe_qos = qos_from_u8(config.subscribe_qos.unwrap_or(1));
    let auto_reconnect = config.auto_reconnect.unwrap_or(true);
    let reconnect_initial_ms = config.reconnect_initial_ms.unwrap_or(1000).max(100);
    const RECONNECT_MAX_MS: u64 = 30_000;

    let mqttoptions = build_mqtt_options(&config, &client_id);
    let (client, mut eventloop) = AsyncClient::new(mqttoptions, 50);
    let (initial_connect_tx, initial_connect_rx) = oneshot::channel::<Result<(), String>>();

    {
        *state.client.lock().unwrap() = Some(client.clone());
    }

    let abort_notify = state.abort_handle.clone();
    let app_handle = app.clone();
    let status_state = state.status.clone();
    let connected_state = state.is_connected.clone();
    let subscription_state = state.subscriptions.clone();
    let stats = state.stats.clone();
    let client_container = state.client.clone();
    let config_for_task = config.clone();
    let client_id_for_task = client_id.clone();
    let mut initial_connect_tx = Some(initial_connect_tx);

    let handle = tokio::spawn(async move {
        let mut has_connected_once = false;
        let mut reconnect_attempt: u32 = 0;
        let mut reconnect_delay_ms = reconnect_initial_ms;
        let mut active_client = client;
        let mut pending_messages = Vec::with_capacity(MQTT_MESSAGE_BATCH_MAX_LEN);
        let mut message_batch_interval = tokio::time::interval(std::time::Duration::from_millis(
            MQTT_MESSAGE_BATCH_INTERVAL_MS,
        ));
        message_batch_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        'outer: loop {
            loop {
                tokio::select! {
                    _ = abort_notify.notified() => {
                        info!("aborting MQTT event loop");
                        emit_mqtt_message_batch(&app_handle, &mut pending_messages);
                        break 'outer;
                    }
                    _ = message_batch_interval.tick() => {
                        emit_mqtt_message_batch(&app_handle, &mut pending_messages);
                    }
                    notification = eventloop.poll() => {
                        match notification {
                            Ok(Event::Incoming(Incoming::ConnAck(_))) => {
                                has_connected_once = true;
                                reconnect_attempt = 0;
                                reconnect_delay_ms = reconnect_initial_ms;

                                if let Some(tx) = initial_connect_tx.take() {
                                    let _ = tx.send(Ok(()));
                                }

                                set_status(&app_handle, &status_state, &connected_state, "connected", 0);

                                let topics: Vec<String> = subscription_state
                                    .lock()
                                    .unwrap()
                                    .iter()
                                    .cloned()
                                    .collect();

                                for topic in topics {
                                    if let Err(error) = active_client.subscribe(topic.clone(), subscribe_qos).await {
                                        warn!(%topic, %error, "failed to subscribe");
                                    }
                                }
                            }
                            Ok(Event::Incoming(Incoming::Publish(packet))) => {
                                stats.messages_received.fetch_add(1, Ordering::Relaxed);
                                stats.bytes_received.fetch_add(packet.payload.len() as u64, Ordering::Relaxed);
                                pending_messages.push(MqttMessagePayload {
                                    topic: packet.topic,
                                    payload: packet.payload.to_vec(),
                                });
                                if pending_messages.len() >= MQTT_MESSAGE_BATCH_MAX_LEN {
                                    emit_mqtt_message_batch(&app_handle, &mut pending_messages);
                                }
                            }
                            Ok(Event::Incoming(Incoming::Disconnect)) => {
                                warn!("broker disconnected the client");
                                set_status(&app_handle, &status_state, &connected_state, "disconnected", reconnect_attempt);

                                if !has_connected_once {
                                    if let Some(tx) = initial_connect_tx.take() {
                                        let _ = tx.send(Err("Broker disconnected before the MQTT connection was established.".to_string()));
                                    }
                                    break 'outer;
                                }

                                break; // fall through to reconnect logic
                            }
                            Ok(_) => {}
                            Err(error) => {
                                warn!(%error, "event loop error");

                                if !has_connected_once {
                                    set_status(&app_handle, &status_state, &connected_state, "error", reconnect_attempt);
                                    if let Some(tx) = initial_connect_tx.take() {
                                        let _ = tx.send(Err(format!("MQTT connection failed: {error}")));
                                    }
                                    break 'outer;
                                }

                                set_status(&app_handle, &status_state, &connected_state, "reconnecting", reconnect_attempt);
                                break; // fall through to reconnect logic
                            }
                        }
                    }
                }
            }

            if !auto_reconnect {
                break 'outer;
            }

            // === Reconnect with exponential backoff ===
            reconnect_attempt += 1;
            stats.reconnect_attempts.fetch_add(1, Ordering::Relaxed);
            set_status(
                &app_handle,
                &status_state,
                &connected_state,
                "reconnecting",
                reconnect_attempt,
            );

            let wait = std::time::Duration::from_millis(reconnect_delay_ms);
            tokio::select! {
                _ = abort_notify.notified() => { break 'outer; }
                _ = tokio::time::sleep(wait) => {}
            }
            reconnect_delay_ms = (reconnect_delay_ms.saturating_mul(2)).min(RECONNECT_MAX_MS);

            // Rebuild the event loop & client
            let new_opts = build_mqtt_options(&config_for_task, &client_id_for_task);
            let (new_client, new_eventloop) = AsyncClient::new(new_opts, 50);
            eventloop = new_eventloop;
            active_client = new_client.clone();
            *client_container.lock().unwrap() = Some(new_client);
        }

        emit_mqtt_message_batch(&app_handle, &mut pending_messages);

        // Clean exit: clear client reference
        *client_container.lock().unwrap() = None;
    });

    {
        *state.listen_task.lock().unwrap() = Some(handle);
    }

    let initial_connect_result =
        tokio::time::timeout(tokio::time::Duration::from_secs(5), initial_connect_rx).await;

    match initial_connect_result {
        Ok(Ok(Ok(()))) => Ok(true),
        Ok(Ok(Err(error_message))) => {
            stop_existing_connection(&state).await;
            set_status(&app, &state.status, &state.is_connected, "error", 0);
            Err(error_message)
        }
        Ok(Err(_)) => {
            stop_existing_connection(&state).await;
            set_status(&app, &state.status, &state.is_connected, "error", 0);
            Err(
                "MQTT connection attempt ended before the broker confirmed the session."
                    .to_string(),
            )
        }
        Err(_) => {
            stop_existing_connection(&state).await;
            set_status(&app, &state.status, &state.is_connected, "error", 0);
            Err("MQTT connection timed out while waiting for broker acknowledgement.".to_string())
        }
    }
}

#[tauri::command]
pub async fn mqtt_disconnect(
    app: AppHandle,
    state: tauri::State<'_, MqttState>,
) -> Result<bool, String> {
    stop_existing_connection(&state).await;
    set_status(&app, &state.status, &state.is_connected, "disconnected", 0);
    Ok(true)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MqttPublishArgs {
    pub topic: String,
    pub payload: Vec<u8>,
    pub qos: Option<u8>,
    pub retain: Option<bool>,
}

async fn publish_internal(
    state: &tauri::State<'_, MqttState>,
    data: MqttPublishArgs,
) -> Result<bool, String> {
    let client = {
        let lock = state.client.lock().unwrap();
        if let Some(client) = &*lock {
            client.clone()
        } else {
            return Err("MQTT client not connected".into());
        }
    };

    let qos = qos_from_u8(data.qos.unwrap_or(1));
    let payload_len = data.payload.len() as u64;

    client
        .publish(data.topic, qos, data.retain.unwrap_or(false), data.payload)
        .await
        .map_err(|error| format!("Publish failed: {error}"))?;

    state.stats.messages_sent.fetch_add(1, Ordering::Relaxed);
    state
        .stats
        .bytes_sent
        .fetch_add(payload_len, Ordering::Relaxed);

    Ok(true)
}

#[tauri::command]
pub async fn mqtt_publish(
    state: tauri::State<'_, MqttState>,
    data: MqttPublishArgs,
) -> Result<bool, String> {
    publish_internal(&state, data).await
}

/// Raw publish — identical to `mqtt_publish` but semantically reserved for payloads
/// that the frontend has already serialized (e.g., pre-encoded protobuf or JSON).
/// Exposed separately so callers can bypass frontend encoding helpers.
#[tauri::command]
pub async fn mqtt_publish_raw(
    state: tauri::State<'_, MqttState>,
    data: MqttPublishArgs,
) -> Result<bool, String> {
    publish_internal(&state, data).await
}

#[tauri::command]
pub async fn mqtt_subscribe(
    state: tauri::State<'_, MqttState>,
    topics: Vec<String>,
) -> Result<bool, String> {
    let normalized_topics: Vec<String> = topics
        .into_iter()
        .map(|topic| topic.trim().to_string())
        .filter(|topic| !topic.is_empty())
        .collect();

    let topics_to_subscribe = {
        let mut stored_topics = state.subscriptions.lock().unwrap();
        let mut delta = Vec::new();

        for topic in normalized_topics {
            if stored_topics.insert(topic.clone()) {
                delta.push(topic);
            }
        }

        delta
    };

    let client = state.client.lock().unwrap().clone();
    if let Some(client) = client {
        for topic in topics_to_subscribe {
            client
                .subscribe(topic.clone(), QoS::AtLeastOnce)
                .await
                .map_err(|error| format!("Subscribe failed for {topic}: {error}"))?;
        }
    }

    Ok(true)
}

#[tauri::command]
pub async fn mqtt_unsubscribe(
    state: tauri::State<'_, MqttState>,
    topics: Vec<String>,
) -> Result<bool, String> {
    let normalized_topics: Vec<String> = topics
        .into_iter()
        .map(|topic| topic.trim().to_string())
        .filter(|topic| !topic.is_empty())
        .collect();

    {
        let mut stored_topics = state.subscriptions.lock().unwrap();
        for topic in &normalized_topics {
            stored_topics.remove(topic);
        }
    }

    let client = state.client.lock().unwrap().clone();
    if let Some(client) = client {
        for topic in normalized_topics {
            client
                .unsubscribe(topic.clone())
                .await
                .map_err(|error| format!("Unsubscribe failed for {topic}: {error}"))?;
        }
    }

    Ok(true)
}

#[tauri::command]
pub async fn mqtt_get_status(
    state: tauri::State<'_, MqttState>,
) -> Result<serde_json::Value, String> {
    let connected = *state.is_connected.lock().unwrap();
    let status = state.status.lock().unwrap().clone();

    Ok(serde_json::json!({
        "connected": connected,
        "status": status,
    }))
}

#[tauri::command]
pub async fn mqtt_get_stats(
    state: tauri::State<'_, MqttState>,
) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "messagesReceived": state.stats.messages_received.load(Ordering::Relaxed),
        "messagesSent": state.stats.messages_sent.load(Ordering::Relaxed),
        "bytesReceived": state.stats.bytes_received.load(Ordering::Relaxed),
        "bytesSent": state.stats.bytes_sent.load(Ordering::Relaxed),
        "reconnectAttempts": state.stats.reconnect_attempts.load(Ordering::Relaxed),
    }))
}

#[tauri::command]
pub async fn mqtt_reset_stats(state: tauri::State<'_, MqttState>) -> Result<bool, String> {
    state.stats.messages_received.store(0, Ordering::Relaxed);
    state.stats.messages_sent.store(0, Ordering::Relaxed);
    state.stats.bytes_received.store(0, Ordering::Relaxed);
    state.stats.bytes_sent.store(0, Ordering::Relaxed);
    state.stats.reconnect_attempts.store(0, Ordering::Relaxed);
    Ok(true)
}
