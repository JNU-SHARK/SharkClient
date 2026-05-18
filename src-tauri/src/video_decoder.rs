//! H.265/HEVC video decoder with auto GPU/CPU backend switching.
//!
//! `SmartDecoder` selects the best available backend on construction and
//! transparently falls back when one fails:
//!   1. Internal libavcodec (in-process, only when `internal-ffmpeg` feature is built).
//!   2. GPU subprocess via FFmpeg `-hwaccel` (D3D11VA / VAAPI / VideoToolbox).
//!   3. CPU libde265 software fallback.
//!
//! Submodules:
//! - [`native`] — libde265 software decoder (always available).
//! - [`gpu`]    — FFmpeg subprocess + Y4M parser.
//!
//! The optional `internal-ffmpeg` backend lives in the top-level
//! `video_decoder_internal` module under a feature gate.

mod gpu;
mod native;

use tracing::{info, warn};

use self::gpu::{describe_ffmpeg_candidates, find_ffmpeg, GpuDecoder};
use self::native::NativeDecoder;

// ==================== Decoded Frame Types ====================

/// Raw YUV420P decoded frame (planar, BT.709 limited range is assumed).
///
/// Layout in `data`:
///   [ Y (w*h) | U (w/2 * h/2) | V (w/2 * h/2) ]
///
/// Ships across IPC as-is — the frontend WebGL renderer uploads each plane
/// to a luminance texture and performs the color conversion on GPU.
#[derive(Clone)]
pub struct YuvFrame {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}

pub struct EncodedJpegFrame {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}

impl YuvFrame {
    #[inline]
    pub fn expected_size(width: u32, height: u32) -> usize {
        let w = width as usize;
        let h = height as usize;
        w * h + (w * h) / 2
    }

    /// Encode YUV420P → JPEG using BT.601 color conversion.
    /// Returns JPEG bytes at the given quality (0–100).
    ///
    /// Hot path: uses fixed-point integer arithmetic (no per-pixel floats) and
    /// shares one (u, v) pair across 2×2 luma blocks, which is ~4–6× faster than
    /// the naive float implementation in debug builds.
    #[allow(dead_code)]
    pub fn to_jpeg(&self, quality: u8) -> EncodedJpegFrame {
        use image::{codecs::jpeg::JpegEncoder, ColorType};
        use std::sync::OnceLock;

        static MJPEG_MAX_HEIGHT: OnceLock<u32> = OnceLock::new();

        let w = self.width as usize;
        let h = self.height as usize;
        let uv_w = w / 2;
        let uv_size = uv_w * (h / 2);
        let y_plane = &self.data[..w * h];
        let u_plane = &self.data[w * h..w * h + uv_size];
        let v_plane = &self.data[w * h + uv_size..];
        let max_height = *MJPEG_MAX_HEIGHT.get_or_init(|| {
            std::env::var("SHARK_MJPEG_MAX_HEIGHT")
                .ok()
                .and_then(|value| {
                    let value = value.trim().to_ascii_lowercase();
                    if value == "0" || value == "none" {
                        Some(0)
                    } else {
                        value.parse::<u32>().ok()
                    }
                })
                .unwrap_or(720)
        });

        fn even_at_least_2(value: usize) -> usize {
            value.max(2) & !1
        }

        let (out_w, out_h) = if max_height > 0 && self.height > max_height {
            let out_h = even_at_least_2(max_height as usize).min(h);
            let out_w = even_at_least_2((w * out_h) / h).min(w);
            (out_w, out_h)
        } else {
            (w, h)
        };

        // BT.601 in Q15 fixed point.
        //   R = Y + 1.402   * (V-128)
        //   G = Y - 0.344136*(U-128) - 0.714136*(V-128)
        //   B = Y + 1.772   * (U-128)
        const R_V: i32 = 45940; // 1.402   << 15
        const G_U: i32 = 11276; // 0.344136<<15
        const G_V: i32 = 23401; // 0.714136<<15
        const B_U: i32 = 58065; // 1.772   << 15

        #[inline(always)]
        fn clamp_u8(v: i32) -> u8 {
            if v < 0 {
                0
            } else if v > 255 {
                255
            } else {
                v as u8
            }
        }

        let mut rgb = vec![0u8; out_w * out_h * 3];
        if out_w == w && out_h == h {
            for row in 0..h {
                let y_row = row * w;
                let uv_row = (row / 2) * uv_w;
                let out_row = row * w * 3;
                for col_pair in 0..(w / 2) {
                    let col = col_pair * 2;
                    let u = u_plane[uv_row + col_pair] as i32 - 128;
                    let v = v_plane[uv_row + col_pair] as i32 - 128;
                    let r_off = R_V * v;
                    let g_off = G_U * u + G_V * v;
                    let b_off = B_U * u;

                    // Pixel 0
                    let y0 = y_plane[y_row + col] as i32;
                    let i0 = out_row + col * 3;
                    rgb[i0] = clamp_u8(y0 + (r_off >> 15));
                    rgb[i0 + 1] = clamp_u8(y0 - (g_off >> 15));
                    rgb[i0 + 2] = clamp_u8(y0 + (b_off >> 15));

                    // Pixel 1
                    let y1 = y_plane[y_row + col + 1] as i32;
                    let i1 = i0 + 3;
                    rgb[i1] = clamp_u8(y1 + (r_off >> 15));
                    rgb[i1 + 1] = clamp_u8(y1 - (g_off >> 15));
                    rgb[i1 + 2] = clamp_u8(y1 + (b_off >> 15));
                }
            }
        } else {
            for out_y in 0..out_h {
                let src_y = out_y * h / out_h;
                let y_row = src_y * w;
                let uv_row = (src_y / 2) * uv_w;
                let out_row = out_y * out_w * 3;

                for out_x in 0..out_w {
                    let src_x = out_x * w / out_w;
                    let uv_col = src_x / 2;
                    let u = u_plane[uv_row + uv_col] as i32 - 128;
                    let v = v_plane[uv_row + uv_col] as i32 - 128;
                    let r_off = R_V * v;
                    let g_off = G_U * u + G_V * v;
                    let b_off = B_U * u;
                    let y = y_plane[y_row + src_x] as i32;
                    let out_idx = out_row + out_x * 3;

                    rgb[out_idx] = clamp_u8(y + (r_off >> 15));
                    rgb[out_idx + 1] = clamp_u8(y - (g_off >> 15));
                    rgb[out_idx + 2] = clamp_u8(y + (b_off >> 15));
                }
            }
        }

        let mut out = Vec::with_capacity(out_w * out_h / 8);
        JpegEncoder::new_with_quality(&mut out, quality)
            .encode(&rgb, out_w as u32, out_h as u32, ColorType::Rgb8.into())
            .expect("JPEG encode failed");
        EncodedJpegFrame {
            width: out_w as u32,
            height: out_h as u32,
            data: out,
        }
    }
}

// ==================== Smart Decoder (Auto GPU/CPU Switch) ====================

/// Decoder backend selection.
enum DecoderBackend {
    #[cfg(feature = "internal-ffmpeg")]
    Internal(crate::video_decoder_internal::InternalDecoder),
    Gpu(GpuDecoder),
    Cpu(NativeDecoder),
}

/// Smart decoder that automatically selects the best available backend.
///
/// Priority order:
///   1. Internal libavcodec (in-process, only when `internal-ffmpeg` feature is built in).
///   2. GPU subprocess via FFmpeg hwaccel (D3D11VA / VAAPI / VideoToolbox).
///   3. CPU libde265 software fallback.
pub struct SmartDecoder {
    backend: DecoderBackend,
}

unsafe impl Send for SmartDecoder {}

impl SmartDecoder {
    /// Create a new SmartDecoder. Picks the first backend that initializes.
    pub fn new() -> Self {
        #[cfg(feature = "internal-ffmpeg")]
        {
            // Prefer the in-process decoder whenever the internal FFmpeg feature is built.
            match crate::video_decoder_internal::InternalDecoder::try_new() {
                Ok(d) => {
                    info!(hwaccel = %d.active_hwaccel(), "using internal libavcodec decoder");
                    return Self {
                        backend: DecoderBackend::Internal(d),
                    };
                }
                Err(e) => {
                    warn!(error = %e, "internal decoder init failed");
                }
            }
        }

        match GpuDecoder::try_new() {
            Ok(gpu) => {
                info!(hwaccel = %gpu.active_hwaccel(), "using GPU hardware decode");
                Self {
                    backend: DecoderBackend::Gpu(gpu),
                }
            }
            Err(e) => {
                info!(
                    error = %e,
                    candidates = %describe_ffmpeg_candidates(),
                    "GPU unavailable, using CPU (libde265)"
                );
                let cpu = NativeDecoder::new().expect("Failed to create libde265 decoder");
                Self {
                    backend: DecoderBackend::Cpu(cpu),
                }
            }
        }
    }

    /// Decode H.265 data to raw YUV420P. Auto-switches backend on failure.
    pub fn decode_to_yuv(&mut self, h265_data: &[u8]) -> Result<Option<YuvFrame>, String> {
        match &mut self.backend {
            #[cfg(feature = "internal-ffmpeg")]
            DecoderBackend::Internal(d) => match d.decode_to_yuv(h265_data) {
                Ok(r) => Ok(r),
                Err(e) => {
                    warn!(error = %e, "internal decode error, switching to CPU");
                    self.switch_to_cpu();
                    self.decode_to_yuv(h265_data)
                }
            },
            DecoderBackend::Gpu(gpu) => {
                // Check if FFmpeg process died
                if !gpu.is_alive() {
                    warn!("FFmpeg process died, switching to CPU");
                    self.switch_to_cpu();
                    return self.decode_to_yuv(h265_data);
                }

                match gpu.decode_to_yuv(h265_data) {
                    Ok(result) => Ok(result),
                    Err(e) => {
                        warn!(error = %e, "GPU decode error, switching to CPU");
                        self.switch_to_cpu();
                        self.decode_to_yuv(h265_data)
                    }
                }
            }
            DecoderBackend::Cpu(cpu) => cpu.decode_to_yuv(h265_data),
        }
    }

    /// Switch from GPU to CPU backend.
    fn switch_to_cpu(&mut self) {
        info!("falling back to CPU (libde265)");
        let cpu = NativeDecoder::new().expect("Failed to create libde265 decoder");
        self.backend = DecoderBackend::Cpu(cpu);
    }

    /// Get the current backend name.
    pub fn backend_name(&self) -> &'static str {
        match &self.backend {
            #[cfg(feature = "internal-ffmpeg")]
            DecoderBackend::Internal(_) => "internal (libavcodec, in-process)",
            DecoderBackend::Gpu(_) => "gpu (ffmpeg hwaccel)",
            DecoderBackend::Cpu(_) => "cpu (libde265)",
        }
    }
}

// ==================== Capability Query ====================

/// Tauri command: query decode capabilities for the frontend.
#[tauri::command]
pub fn get_decode_capabilities() -> serde_json::Value {
    let internal_available = cfg!(feature = "internal-ffmpeg");
    let gpu_available = find_ffmpeg().is_some();
    let strategy = if internal_available {
        "Internal FFmpeg first, auto-fallback to CPU"
    } else {
        "GPU first, auto-fallback to CPU"
    };
    serde_json::json!({
        "nativeDecodeAvailable": true,
        "gpuDecodeAvailable": gpu_available,
        "backendFfmpegAvailable": gpu_available,
        "internalFfmpegAvailable": internal_available,
        "supportedCodecs": ["h265", "mjpeg"],
        "backends": {
            "internal": {
                "available": internal_available,
                "description": "in-process libavcodec decoder"
            },
            "gpu": {
                "available": gpu_available,
                "description": "FFmpeg hwaccel (D3D11VA/DXVA2/VAAPI/VideoToolbox)"
            },
            "cpu": {
                "available": true,
                "description": "libde265 software decode (WPP multi-threaded)"
            }
        },
        "strategy": strategy
    })
}
