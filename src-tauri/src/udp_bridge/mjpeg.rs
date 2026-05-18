//! Backend MJPEG fallback stream.
//!
//! The receive loop decodes H.265 in-process and exposes the result as a
//! `multipart/x-mixed-replace` MJPEG stream that the frontend
//! consumes via `<img>`. Keeping per-frame data off the JS-side IPC keeps
//! the UI thread responsive on 1080p streams.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex as StdMutex};
use std::thread;
use std::time::Duration;

use tracing::warn;

pub(super) const MJPEG_BOUNDARY: &str = "sharkframe";
pub(super) const MJPEG_FALLBACK_QUALITY: u8 = 48;
pub(super) const MJPEG_FALLBACK_MAX_FPS: u32 = 30;
const MAX_MJPEG_CLIENTS: usize = 4;

struct MjpegFrameState {
    seq: u64,
    width: u32,
    height: u32,
    jpeg: Vec<u8>,
}

pub(super) struct MjpegBroadcaster {
    state: StdMutex<MjpegFrameState>,
    cvar: Condvar,
}

impl MjpegBroadcaster {
    pub(super) fn new() -> Self {
        Self {
            state: StdMutex::new(MjpegFrameState {
                seq: 0,
                width: 0,
                height: 0,
                jpeg: Vec::new(),
            }),
            cvar: Condvar::new(),
        }
    }

    pub(super) fn publish(&self, jpeg: Vec<u8>, width: u32, height: u32) {
        let mut state = self.state.lock().unwrap();
        state.seq = state.seq.wrapping_add(1);
        state.width = width;
        state.height = height;
        state.jpeg = jpeg;
        self.cvar.notify_all();
    }

    pub(super) fn wait_next(
        &self,
        last_seq: u64,
        alive: &AtomicBool,
    ) -> Option<(u64, u32, u32, Vec<u8>)> {
        let mut state = self.state.lock().unwrap();
        while state.seq == last_seq && alive.load(Ordering::Relaxed) {
            let (next_state, _) = self
                .cvar
                .wait_timeout(state, Duration::from_millis(250))
                .unwrap();
            state = next_state;
        }

        if !alive.load(Ordering::Relaxed) {
            return None;
        }

        Some((state.seq, state.width, state.height, state.jpeg.clone()))
    }

    pub(super) fn latest(&self) -> Option<(u64, u32, u32, Vec<u8>)> {
        let state = self.state.lock().unwrap();
        if state.seq == 0 || state.jpeg.is_empty() {
            return None;
        }

        Some((state.seq, state.width, state.height, state.jpeg.clone()))
    }

    pub(super) fn wake_all(&self) {
        self.cvar.notify_all();
    }
}

pub(super) struct MjpegStreamServer {
    pub(super) url: String,
    addr: std::net::SocketAddr,
    alive: Arc<AtomicBool>,
    pub(super) broadcaster: Arc<MjpegBroadcaster>,
    handle: Option<thread::JoinHandle<()>>,
}

impl MjpegStreamServer {
    pub(super) fn start() -> Result<Self, String> {
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .map_err(|e| format!("Failed to bind MJPEG stream server: {}", e))?;
        listener
            .set_nonblocking(true)
            .map_err(|e| format!("Failed to set MJPEG listener nonblocking: {}", e))?;
        let addr = listener
            .local_addr()
            .map_err(|e| format!("Failed to get MJPEG listener address: {}", e))?;
        let url = format!("http://{}/udp.mjpg", addr);
        let alive = Arc::new(AtomicBool::new(true));
        let broadcaster = Arc::new(MjpegBroadcaster::new());
        let active_clients = Arc::new(AtomicUsize::new(0));
        let alive_accept = Arc::clone(&alive);
        let broadcaster_accept = Arc::clone(&broadcaster);
        let active_clients_accept = Arc::clone(&active_clients);
        let handle = thread::Builder::new()
            .name("udp-mjpeg-server".into())
            .spawn(move || {
                while alive_accept.load(Ordering::Relaxed) {
                    match listener.accept() {
                        Ok((mut stream, _peer)) => {
                            let reserved = active_clients_accept.fetch_update(
                                Ordering::AcqRel,
                                Ordering::Acquire,
                                |count| (count < MAX_MJPEG_CLIENTS).then_some(count + 1),
                            );
                            if reserved.is_err() {
                                let _ = stream.set_write_timeout(Some(Duration::from_millis(200)));
                                let _ = stream.write_all(
                                    b"HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n",
                                );
                                continue;
                            }
                            let alive_client = Arc::clone(&alive_accept);
                            let broadcaster_client = Arc::clone(&broadcaster_accept);
                            let active_clients_client = Arc::clone(&active_clients_accept);
                            if let Err(error) = thread::Builder::new()
                                .name("udp-mjpeg-client".into())
                                .spawn(move || {
                                    serve_mjpeg_client(stream, broadcaster_client, alive_client);
                                    active_clients_client.fetch_sub(1, Ordering::AcqRel);
                                })
                            {
                                active_clients_accept.fetch_sub(1, Ordering::AcqRel);
                                warn!(%error, "failed to spawn MJPEG client thread");
                            }
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                            thread::sleep(Duration::from_millis(20));
                        }
                        Err(e) => {
                            warn!(error = %e, "MJPEG accept error");
                            thread::sleep(Duration::from_millis(100));
                        }
                    }
                }
            })
            .map_err(|e| format!("Failed to spawn MJPEG server: {}", e))?;

        Ok(Self {
            url,
            addr,
            alive,
            broadcaster,
            handle: Some(handle),
        })
    }

    pub(super) fn stop(&mut self) {
        self.alive.store(false, Ordering::Relaxed);
        self.broadcaster.wake_all();
        let _ = TcpStream::connect_timeout(&self.addr, Duration::from_millis(50));
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for MjpegStreamServer {
    fn drop(&mut self) {
        self.stop();
    }
}

fn serve_mjpeg_client(
    mut stream: TcpStream,
    broadcaster: Arc<MjpegBroadcaster>,
    alive: Arc<AtomicBool>,
) {
    let _ = stream.set_read_timeout(Some(Duration::from_millis(100)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));

    // Drain the HTTP request if present. We only serve one endpoint.
    let mut request_buf = [0u8; 1024];
    let _ = stream.read(&mut request_buf);

    let header = format!(
        "HTTP/1.1 200 OK\r\n\
         Content-Type: multipart/x-mixed-replace; boundary={}\r\n\
         Cache-Control: no-cache, no-store, must-revalidate\r\n\
         Pragma: no-cache\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Connection: close\r\n\r\n",
        MJPEG_BOUNDARY
    );
    if stream.write_all(header.as_bytes()).is_err() {
        return;
    }

    let mut last_seq = 0;
    while alive.load(Ordering::Relaxed) {
        let Some((seq, width, height, jpeg)) = broadcaster.wait_next(last_seq, &alive) else {
            break;
        };
        last_seq = seq;
        if jpeg.is_empty() {
            continue;
        }

        let part = format!(
            "--{}\r\n\
             Content-Type: image/jpeg\r\n\
             Content-Length: {}\r\n\
             X-Width: {}\r\n\
             X-Height: {}\r\n\r\n",
            MJPEG_BOUNDARY,
            jpeg.len(),
            width,
            height
        );
        if stream.write_all(part.as_bytes()).is_err() {
            break;
        }
        if stream.write_all(&jpeg).is_err() {
            break;
        }
        if stream.write_all(b"\r\n").is_err() {
            break;
        }
    }
}
