//! Internal HEVC decoder using statically linked libavcodec.
//!
//! This is the in-process alternative to the external `ffmpeg` subprocess used
//! by the single-file distribution. It now follows the same low-latency intent:
//! prefer platform hardware decode, copy the newest decoded frame into
//! contiguous YUV420P, and let the frontend WebGL renderer do the RGB work.
#![cfg(feature = "internal-ffmpeg")]

use crate::ffmpeg_ffi as ff;
use crate::video_decoder::YuvFrame;
use std::ffi::CString;
use std::os::raw::c_int;
use std::ptr;
use tracing::{debug, info, warn};

#[derive(Clone, Copy)]
struct HwCandidate {
    name: &'static str,
    device_type: c_int,
    pix_fmt: c_int,
}

pub struct InternalDecoder {
    codec_ctx: *mut ff::AVCodecContext,
    parser: *mut ff::AVCodecParserContext,
    pkt: *mut ff::AVPacket,
    frame: *mut ff::AVFrame,
    sw_frame: *mut ff::AVFrame,
    hw_device: *mut ff::AVBufferRef,
    hw_pix_fmt: c_int,
    active_hwaccel: &'static str,
    /// Set once the first frame has been received.
    initialized: bool,
}

unsafe impl Send for InternalDecoder {}

impl InternalDecoder {
    pub fn try_new() -> Result<Self, String> {
        unsafe {
            ff::shark_ffmpeg_set_log_level_error();

            let codec = ff::avcodec_find_decoder(ff::AV_CODEC_ID_HEVC);
            if codec.is_null() {
                return Err("HEVC decoder not registered in libavcodec".into());
            }

            let mut last_hw_error: Option<String> = None;
            for candidate in hardware_candidates() {
                if ff::shark_codec_supports_hw(codec, candidate.device_type, candidate.pix_fmt) == 0
                {
                    continue;
                }

                match Self::open(codec, Some(candidate)) {
                    Ok(decoder) => return Ok(decoder),
                    Err(e) => {
                        debug!(hwaccel = %candidate.name, error = %e, "hwaccel attempt failed");
                        last_hw_error = Some(e);
                    }
                }
            }

            if let Some(e) = last_hw_error {
                warn!(
                    error = %e,
                    "hardware decode unavailable, using software"
                );
            }
            Self::open(codec, None)
        }
    }

    unsafe fn open(codec: *const ff::AVCodec, hw: Option<HwCandidate>) -> Result<Self, String> {
        unsafe {
            let codec_ctx = ff::avcodec_alloc_context3(codec);
            if codec_ctx.is_null() {
                return Err("avcodec_alloc_context3 returned NULL".into());
            }

            ff::shark_codec_set_low_delay(codec_ctx);

            let mut hw_device: *mut ff::AVBufferRef = ptr::null_mut();
            let mut hw_pix_fmt = ff::pix_fmt_yuv420p();
            let mut active_hwaccel = "internal-software";

            if let Some(candidate) = hw {
                let device_name = hw_device_name(candidate);
                let device_ptr = device_name
                    .as_ref()
                    .map(|value| value.as_ptr())
                    .unwrap_or(ptr::null());
                let rc = ff::av_hwdevice_ctx_create(
                    &mut hw_device,
                    candidate.device_type,
                    device_ptr,
                    ptr::null_mut(),
                    0,
                );
                if rc < 0 {
                    cleanup_parts(
                        codec_ctx,
                        ptr::null_mut(),
                        ptr::null_mut(),
                        ptr::null_mut(),
                        ptr::null_mut(),
                        hw_device,
                    );
                    return Err(format!("av_hwdevice_ctx_create failed: {}", ff::errstr(rc)));
                }

                let rc = ff::shark_set_hw_device(codec_ctx, hw_device);
                if rc < 0 {
                    cleanup_parts(
                        codec_ctx,
                        ptr::null_mut(),
                        ptr::null_mut(),
                        ptr::null_mut(),
                        ptr::null_mut(),
                        hw_device,
                    );
                    return Err("failed to attach hw_device_ctx to decoder".into());
                }

                let rc = ff::shark_set_hw_pixel_format(codec_ctx, candidate.pix_fmt);
                if rc < 0 {
                    cleanup_parts(
                        codec_ctx,
                        ptr::null_mut(),
                        ptr::null_mut(),
                        ptr::null_mut(),
                        ptr::null_mut(),
                        hw_device,
                    );
                    return Err("failed to install FFmpeg get_format callback".into());
                }

                hw_pix_fmt = candidate.pix_fmt;
                active_hwaccel = candidate.name;
            }

            let rc = ff::avcodec_open2(codec_ctx, codec, ptr::null_mut());
            if rc < 0 {
                cleanup_parts(
                    codec_ctx,
                    ptr::null_mut(),
                    ptr::null_mut(),
                    ptr::null_mut(),
                    ptr::null_mut(),
                    hw_device,
                );
                return Err(format!("avcodec_open2 failed: {}", ff::errstr(rc)));
            }

            let parser = ff::av_parser_init(ff::AV_CODEC_ID_HEVC);
            let pkt = ff::av_packet_alloc();
            let frame = ff::av_frame_alloc();
            let sw_frame = ff::av_frame_alloc();
            if parser.is_null() || pkt.is_null() || frame.is_null() || sw_frame.is_null() {
                cleanup_parts(codec_ctx, parser, pkt, frame, sw_frame, hw_device);
                return Err("FFmpeg parser/packet/frame allocation returned NULL".into());
            }

            info!(hwaccel = %active_hwaccel, "HEVC decoder ready (libavcodec)");

            Ok(Self {
                codec_ctx,
                parser,
                pkt,
                frame,
                sw_frame,
                hw_device,
                hw_pix_fmt,
                active_hwaccel,
                initialized: false,
            })
        }
    }

    /// Feed raw HEVC bitstream bytes (Annex-B NALs) and try to read one
    /// decoded YUV420P frame. Returns the newest available frame, dropping any
    /// decoder backlog so display latency stays bounded.
    pub fn decode_to_yuv(&mut self, h265_data: &[u8]) -> Result<Option<YuvFrame>, String> {
        unsafe {
            let mut newest: Option<YuvFrame> = None;
            while let Some(f) = self.try_receive_frame()? {
                newest = Some(f);
            }

            let mut input_ptr = h265_data.as_ptr();
            let mut input_size = h265_data.len() as i32;

            loop {
                let mut out_buf: *mut u8 = ptr::null_mut();
                let mut out_size: i32 = 0;
                let consumed = ff::av_parser_parse2(
                    self.parser,
                    self.codec_ctx,
                    &mut out_buf,
                    &mut out_size,
                    input_ptr,
                    input_size,
                    0,
                    0,
                    0,
                );
                if consumed < 0 {
                    return Err(format!("av_parser_parse2 failed: {}", ff::errstr(consumed)));
                }
                if consumed == 0 && out_size == 0 {
                    // Malformed/truncated input should not spin forever in the parser loop.
                    break;
                }
                input_ptr = input_ptr.add(consumed as usize);
                input_size -= consumed;

                if out_size > 0 {
                    ff::shark_packet_set(self.pkt, out_buf, out_size);
                    let send_rc = ff::avcodec_send_packet(self.codec_ctx, self.pkt);
                    if send_rc < 0 && !ff::is_eagain(send_rc) {
                        warn!(error = %ff::errstr(send_rc), "avcodec_send_packet failed");
                    }
                    while let Some(f) = self.try_receive_frame()? {
                        newest = Some(f);
                    }
                }

                if input_size <= 0 {
                    break;
                }
            }

            Ok(newest)
        }
    }

    unsafe fn try_receive_frame(&mut self) -> Result<Option<YuvFrame>, String> {
        unsafe {
            let rc = ff::avcodec_receive_frame(self.codec_ctx, self.frame);
            if ff::is_eagain(rc) || ff::is_eof(rc) {
                return Ok(None);
            }
            if rc < 0 {
                return Err(format!("avcodec_receive_frame failed: {}", ff::errstr(rc)));
            }

            let w = ff::shark_frame_width(self.frame);
            let h = ff::shark_frame_height(self.frame);
            if w <= 0 || h <= 0 {
                ff::av_frame_unref(self.frame);
                return Ok(None);
            }

            let yuv_result = self.copy_received_frame(w, h);
            ff::av_frame_unref(self.frame);
            ff::av_frame_unref(self.sw_frame);

            let yuv = yuv_result?;
            if !self.initialized {
                info!(
                    width = yuv.width,
                    height = yuv.height,
                    hwaccel = %self.active_hwaccel,
                    "first decoded frame (yuv420p)"
                );
                self.initialized = true;
            }
            Ok(Some(yuv))
        }
    }

    unsafe fn copy_received_frame(
        &mut self,
        width: c_int,
        height: c_int,
    ) -> Result<YuvFrame, String> {
        unsafe {
            let mut src = self.frame;
            let mut src_width = width;
            let mut src_height = height;
            let mut fmt = ff::shark_frame_format(self.frame);

            if is_hw_pixel_format(fmt) {
                ff::av_frame_unref(self.sw_frame);
                let rc = ff::av_hwframe_transfer_data(self.sw_frame, self.frame, 0);
                if rc < 0 {
                    return Err(format!(
                        "av_hwframe_transfer_data failed: {}",
                        ff::errstr(rc)
                    ));
                }
                src = self.sw_frame;
                let sw_width = ff::shark_frame_width(src);
                let sw_height = ff::shark_frame_height(src);
                src_width = if sw_width > 0 { sw_width } else { width };
                src_height = if sw_height > 0 { sw_height } else { height };
                fmt = ff::shark_frame_format(src);
            }

            if fmt == ff::pix_fmt_yuv420p() {
                copy_yuv420p(src, src_width as u32, src_height as u32)
            } else if fmt == ff::pix_fmt_nv12() {
                copy_nv12_to_yuv420p(src, src_width as u32, src_height as u32)
            } else {
                Err(format!(
                    "unsupported decoded pixel format {} (hw_pix_fmt={}, backend={})",
                    fmt, self.hw_pix_fmt, self.active_hwaccel
                ))
            }
        }
    }

    #[allow(dead_code)]
    pub fn is_alive(&self) -> bool {
        true
    }

    pub fn active_hwaccel(&self) -> &'static str {
        self.active_hwaccel
    }
}

fn hardware_candidates() -> Vec<HwCandidate> {
    let mut candidates = Vec::new();
    if cfg!(target_os = "windows") {
        candidates.push(HwCandidate {
            name: "d3d11va",
            device_type: ff::hw_device_type_d3d11va(),
            pix_fmt: ff::pix_fmt_d3d11(),
        });
        candidates.push(HwCandidate {
            name: "d3d11va-vld",
            device_type: ff::hw_device_type_d3d11va(),
            pix_fmt: ff::pix_fmt_d3d11va_vld(),
        });
        candidates.push(HwCandidate {
            name: "dxva2",
            device_type: ff::hw_device_type_dxva2(),
            pix_fmt: ff::pix_fmt_dxva2_vld(),
        });
    } else if cfg!(target_os = "linux") {
        candidates.push(HwCandidate {
            name: "vaapi",
            device_type: ff::hw_device_type_vaapi(),
            pix_fmt: ff::pix_fmt_vaapi(),
        });
    }
    candidates
}

fn hw_device_name(candidate: HwCandidate) -> Option<CString> {
    if candidate.name != "vaapi" {
        return None;
    }

    let device =
        std::env::var("SHARK_VAAPI_DEVICE").unwrap_or_else(|_| "/dev/dri/renderD128".to_string());
    let trimmed = device.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("auto") {
        None
    } else {
        CString::new(trimmed).ok()
    }
}

fn is_hw_pixel_format(fmt: c_int) -> bool {
    fmt == ff::pix_fmt_d3d11()
        || fmt == ff::pix_fmt_d3d11va_vld()
        || fmt == ff::pix_fmt_dxva2_vld()
        || fmt == ff::pix_fmt_vaapi()
        || fmt == ff::pix_fmt_cuda()
        || fmt == ff::pix_fmt_qsv()
}

unsafe fn copy_yuv420p(
    frame: *const ff::AVFrame,
    width: u32,
    height: u32,
) -> Result<YuvFrame, String> {
    unsafe {
        let w = width as usize;
        let h = height as usize;
        let cw = w / 2;
        let ch = h / 2;
        let total = w * h + cw * ch * 2;
        let mut data: Vec<u8> = Vec::with_capacity(total);

        let y_src = ff::shark_frame_data(frame, 0);
        let u_src = ff::shark_frame_data(frame, 1);
        let v_src = ff::shark_frame_data(frame, 2);
        if y_src.is_null() || u_src.is_null() || v_src.is_null() {
            return Err("decoded yuv420p frame has a null plane".into());
        }

        let y_stride = ff::shark_frame_linesize(frame, 0);
        let u_stride = ff::shark_frame_linesize(frame, 1);
        let v_stride = ff::shark_frame_linesize(frame, 2);
        if y_stride < w as c_int || u_stride < cw as c_int || v_stride < cw as c_int {
            return Err("decoded yuv420p frame has an invalid stride".into());
        }

        let y_stride = y_stride as usize;
        for row in 0..h {
            let line = std::slice::from_raw_parts(y_src.add(row * y_stride), w);
            data.extend_from_slice(line);
        }

        let u_stride = u_stride as usize;
        for row in 0..ch {
            let line = std::slice::from_raw_parts(u_src.add(row * u_stride), cw);
            data.extend_from_slice(line);
        }

        let v_stride = v_stride as usize;
        for row in 0..ch {
            let line = std::slice::from_raw_parts(v_src.add(row * v_stride), cw);
            data.extend_from_slice(line);
        }

        Ok(YuvFrame {
            width,
            height,
            data,
        })
    }
}

unsafe fn copy_nv12_to_yuv420p(
    frame: *const ff::AVFrame,
    width: u32,
    height: u32,
) -> Result<YuvFrame, String> {
    unsafe {
        let w = width as usize;
        let h = height as usize;
        let cw = w / 2;
        let ch = h / 2;
        let total = w * h + cw * ch * 2;
        let mut data = Vec::with_capacity(total);

        let y_src = ff::shark_frame_data(frame, 0);
        let uv_src = ff::shark_frame_data(frame, 1);
        if y_src.is_null() || uv_src.is_null() {
            return Err("decoded nv12 frame has a null plane".into());
        }

        let y_stride = ff::shark_frame_linesize(frame, 0);
        let uv_stride = ff::shark_frame_linesize(frame, 1);
        if y_stride < w as c_int || uv_stride < (cw * 2) as c_int {
            return Err("decoded nv12 frame has an invalid stride".into());
        }

        let y_stride = y_stride as usize;
        for row in 0..h {
            let line = std::slice::from_raw_parts(y_src.add(row * y_stride), w);
            data.extend_from_slice(line);
        }

        let uv_stride = uv_stride as usize;
        let u_plane_start = data.len();
        data.resize(u_plane_start + cw * ch, 0);
        let v_plane_start = data.len();
        data.resize(v_plane_start + cw * ch, 0);

        for row in 0..ch {
            let uv = std::slice::from_raw_parts(uv_src.add(row * uv_stride), cw * 2);
            let u_row = u_plane_start + row * cw;
            let v_row = v_plane_start + row * cw;
            for col in 0..cw {
                data[u_row + col] = uv[col * 2];
                data[v_row + col] = uv[col * 2 + 1];
            }
        }

        Ok(YuvFrame {
            width,
            height,
            data,
        })
    }
}

unsafe fn cleanup_parts(
    mut codec_ctx: *mut ff::AVCodecContext,
    parser: *mut ff::AVCodecParserContext,
    mut pkt: *mut ff::AVPacket,
    mut frame: *mut ff::AVFrame,
    mut sw_frame: *mut ff::AVFrame,
    mut hw_device: *mut ff::AVBufferRef,
) {
    unsafe {
        if !sw_frame.is_null() {
            ff::av_frame_free(&mut sw_frame);
        }
        if !frame.is_null() {
            ff::av_frame_free(&mut frame);
        }
        if !pkt.is_null() {
            ff::av_packet_free(&mut pkt);
        }
        if !parser.is_null() {
            ff::av_parser_close(parser);
        }
        if !codec_ctx.is_null() {
            ff::avcodec_free_context(&mut codec_ctx);
        }
        if !hw_device.is_null() {
            ff::av_buffer_unref(&mut hw_device);
        }
    }
}

impl Drop for InternalDecoder {
    fn drop(&mut self) {
        unsafe {
            cleanup_parts(
                self.codec_ctx,
                self.parser,
                self.pkt,
                self.frame,
                self.sw_frame,
                self.hw_device,
            );
            self.codec_ctx = ptr::null_mut();
            self.parser = ptr::null_mut();
            self.pkt = ptr::null_mut();
            self.frame = ptr::null_mut();
            self.sw_frame = ptr::null_mut();
            self.hw_device = ptr::null_mut();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decoder_constructs_and_drops() {
        let _d = InternalDecoder::try_new().expect("HEVC decoder available");
    }
}
