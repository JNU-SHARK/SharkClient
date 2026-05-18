//! CPU H.265 decoder backed by libde265 (linked statically via build.rs).
//!
//! Always available, no external runtime dependency. Used as the universal
//! fallback when GPU / internal FFmpeg backends are unavailable or fail.

use std::os::raw::{c_int, c_void};

use tracing::{info, warn};

use super::YuvFrame;

// ==================== libde265 FFI Bindings ====================

mod ffi {
    use std::os::raw::{c_int, c_void};

    pub const DE265_OK: c_int = 0;
    #[allow(dead_code)]
    pub const DE265_ERROR_WAITING_FOR_INPUT_DATA: c_int = 13;
    #[allow(dead_code)]
    pub const DE265_ERROR_IMAGE_BUFFER_FULL: c_int = 9;

    // de265_param enum values
    pub const DE265_DECODER_PARAM_SUPPRESS_FAULTY_PICTURES: c_int = 6;

    extern "C" {
        pub fn de265_new_decoder() -> *mut c_void;
        pub fn de265_free_decoder(ctx: *mut c_void) -> c_int;
        pub fn de265_start_worker_threads(ctx: *mut c_void, number_of_threads: c_int) -> c_int;
        pub fn de265_set_parameter_bool(ctx: *mut c_void, param: c_int, value: c_int);

        pub fn de265_push_data(
            ctx: *mut c_void,
            data: *const u8,
            length: c_int,
            pts: i64,
            user_data: *mut c_void,
        ) -> c_int;
        pub fn de265_push_end_of_frame(ctx: *mut c_void);
        #[allow(dead_code)]
        pub fn de265_flush_data(ctx: *mut c_void) -> c_int;
        pub fn de265_decode(ctx: *mut c_void, more: *mut c_int) -> c_int;
        pub fn de265_get_next_picture(ctx: *mut c_void) -> *const c_void;
        #[allow(dead_code)]
        pub fn de265_release_next_picture(ctx: *mut c_void);

        pub fn de265_get_image_width(img: *const c_void, channel: c_int) -> c_int;
        pub fn de265_get_image_height(img: *const c_void, channel: c_int) -> c_int;
        pub fn de265_get_image_plane(
            img: *const c_void,
            channel: c_int,
            out_stride: *mut c_int,
        ) -> *const u8;

        pub fn de265_get_error_text(err: c_int) -> *const i8;
        pub fn de265_reset(ctx: *mut c_void);
    }
}

/// Get error text from libde265 error code.
fn de265_error_text(err: c_int) -> String {
    unsafe {
        let ptr = ffi::de265_get_error_text(err);
        if ptr.is_null() {
            return format!("unknown error ({})", err);
        }
        std::ffi::CStr::from_ptr(ptr).to_string_lossy().into_owned()
    }
}

/// Native H.265→YUV decoder wrapping libde265.
///
/// NOT Send/Sync — holds a raw pointer to the decoder context.
/// Must live on a single tokio task (the UDP receive loop).
pub(super) struct NativeDecoder {
    ctx: *mut c_void,
    frame_count: u64,
    width: u32,
    height: u32,
}

// Safety: The de265 decoder context is only accessed from a single tokio task
// (the UDP receive loop). Worker threads are internal to libde265 and don't
// expose the context pointer across threads.
unsafe impl Send for NativeDecoder {}

impl NativeDecoder {
    /// Create a new H.265 decoder with WPP multi-threaded decoding.
    pub(super) fn new() -> Result<Self, String> {
        let ctx = unsafe { ffi::de265_new_decoder() };
        if ctx.is_null() {
            return Err("de265_new_decoder() returned null".into());
        }

        // Suppress faulty pictures — don't output corrupt frames
        unsafe {
            ffi::de265_set_parameter_bool(
                ctx,
                ffi::DE265_DECODER_PARAM_SUPPRESS_FAULTY_PICTURES,
                1,
            );
        }

        // Start worker threads for WPP parallel decoding
        let num_threads = std::thread::available_parallelism()
            .map(|n| n.get().min(4) as c_int)
            .unwrap_or(2);

        let err = unsafe { ffi::de265_start_worker_threads(ctx, num_threads) };
        if err != ffi::DE265_OK {
            unsafe {
                ffi::de265_free_decoder(ctx);
            }
            return Err(format!(
                "Failed to start worker threads: {}",
                de265_error_text(err)
            ));
        }

        info!(
            threads = num_threads,
            "libde265 H.265 decoder created (output=YUV420P)"
        );

        Ok(Self {
            ctx,
            frame_count: 0,
            width: 0,
            height: 0,
        })
    }

    /// Decode one H.265 access unit (NAL units with start codes) into a raw YUV420P frame.
    ///
    /// Returns:
    /// - `Ok(Some(yuv))` — decoded frame
    /// - `Ok(None)` — decoder needs more input data (buffering)
    /// - `Err(msg)` — decode error (non-fatal, caller should continue)
    pub(super) fn decode_to_yuv(&mut self, h265_data: &[u8]) -> Result<Option<YuvFrame>, String> {
        // Push raw H.265 data (with start codes) into decoder
        let err = unsafe {
            ffi::de265_push_data(
                self.ctx,
                h265_data.as_ptr(),
                h265_data.len() as c_int,
                self.frame_count as i64,
                std::ptr::null_mut(),
            )
        };
        if err != ffi::DE265_OK {
            return Err(format!("de265_push_data failed: {}", de265_error_text(err)));
        }

        // Signal end of frame
        unsafe {
            ffi::de265_push_end_of_frame(self.ctx);
        }

        // Run decoder — loop until it needs more data or produces output
        let mut more: c_int = 1;
        while more != 0 {
            let err = unsafe { ffi::de265_decode(self.ctx, &mut more) };
            if err != ffi::DE265_OK && err != ffi::DE265_ERROR_WAITING_FOR_INPUT_DATA {
                // Non-fatal: log and break
                if self.frame_count > 0 {
                    warn!(detail = %de265_error_text(err), "decode warning");
                }
                break;
            }

            // Try to get a decoded picture
            let img = unsafe { ffi::de265_get_next_picture(self.ctx) };
            if !img.is_null() {
                self.frame_count += 1;
                return self.image_to_yuv(img).map(Some);
            }

            if err == ffi::DE265_ERROR_WAITING_FOR_INPUT_DATA {
                break;
            }
        }

        Ok(None)
    }

    /// Copy a decoded de265_image YUV420P picture into a contiguous YuvFrame.
    fn image_to_yuv(&mut self, img: *const c_void) -> Result<YuvFrame, String> {
        let w = unsafe { ffi::de265_get_image_width(img, 0) } as u32;
        let h = unsafe { ffi::de265_get_image_height(img, 0) } as u32;

        if w == 0 || h == 0 {
            return Err("decoded image has zero dimensions".into());
        }

        // Log resolution changes
        if w != self.width || h != self.height {
            self.width = w;
            self.height = h;
            info!(width = w, height = h, "resolution change");
        }

        // Get YUV420 planes
        let mut y_stride: c_int = 0;
        let mut u_stride: c_int = 0;
        let mut v_stride: c_int = 0;

        let y_ptr = unsafe { ffi::de265_get_image_plane(img, 0, &mut y_stride) };
        let u_ptr = unsafe { ffi::de265_get_image_plane(img, 1, &mut u_stride) };
        let v_ptr = unsafe { ffi::de265_get_image_plane(img, 2, &mut v_stride) };

        if y_ptr.is_null() || u_ptr.is_null() || v_ptr.is_null() {
            return Err("null image plane pointer".into());
        }

        let y_stride = y_stride as usize;
        let u_stride = u_stride as usize;
        let v_stride = v_stride as usize;
        let w_usize = w as usize;
        let h_usize = h as usize;
        let uv_w = w_usize / 2;
        let uv_h = h_usize / 2;

        // Allocate the contiguous [Y | U | V] buffer.
        let expected = YuvFrame::expected_size(w, h);
        let mut data = Vec::with_capacity(expected);

        // Copy Y plane row-by-row to strip stride padding.
        let y_plane = unsafe { std::slice::from_raw_parts(y_ptr, y_stride * h_usize) };
        for row in 0..h_usize {
            let start = row * y_stride;
            data.extend_from_slice(&y_plane[start..start + w_usize]);
        }

        let u_plane = unsafe { std::slice::from_raw_parts(u_ptr, u_stride * uv_h) };
        for row in 0..uv_h {
            let start = row * u_stride;
            data.extend_from_slice(&u_plane[start..start + uv_w]);
        }

        let v_plane = unsafe { std::slice::from_raw_parts(v_ptr, v_stride * uv_h) };
        for row in 0..uv_h {
            let start = row * v_stride;
            data.extend_from_slice(&v_plane[start..start + uv_w]);
        }

        debug_assert_eq!(data.len(), expected);

        Ok(YuvFrame {
            width: w,
            height: h,
            data,
        })
    }

    /// Reset decoder state (e.g., on stream discontinuity).
    #[allow(dead_code)]
    pub(super) fn reset(&mut self) {
        unsafe {
            ffi::de265_reset(self.ctx);
        }
        self.frame_count = 0;
    }
}

impl Drop for NativeDecoder {
    fn drop(&mut self) {
        if !self.ctx.is_null() {
            unsafe {
                ffi::de265_free_decoder(self.ctx);
            }
            self.ctx = std::ptr::null_mut();
        }
    }
}
