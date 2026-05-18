//! Minimal hand-written FFI bindings for FFmpeg (libavcodec / libavformat /
//! libavutil / libswscale).
//!
//! Only the types and functions used by [`crate::video_decoder_internal`] are
//! declared here — we deliberately avoid pulling in `ffmpeg-sys-next` /
//! `bindgen` because the surface we need is small (~30 functions) and a
//! hand-written module gives us fast, deterministic builds.
//!
//! The static libraries are linked from
//! `src-tauri/vendor/ffmpeg-static/<platform>/lib/*.a` via [`build.rs`].
//!
//! Based on FFmpeg 7.1 public headers — keep field layouts in sync if the
//! pinned FFmpeg version is bumped.
#![allow(non_camel_case_types, non_snake_case, dead_code)]

use std::os::raw::{c_char, c_int, c_uint, c_void};

// ── Constants (a small subset; AVCodecID values stable since FFmpeg 4) ──
pub const AV_CODEC_ID_NONE: c_int = 0;
pub const AV_CODEC_ID_HEVC: c_int = 173;
pub const AV_CODEC_ID_H264: c_int = 27;

pub const AV_PIX_FMT_NONE: c_int = -1;
pub const AV_PIX_FMT_YUV420P: c_int = 0;
pub const AV_PIX_FMT_NV12: c_int = 23;
pub const AV_PIX_FMT_D3D11: c_int = 174;
pub const AV_PIX_FMT_VAAPI: c_int = 53;
pub const AV_PIX_FMT_CUDA: c_int = 117;

pub const AV_HWDEVICE_TYPE_NONE: c_int = 0;
pub const AV_HWDEVICE_TYPE_VDPAU: c_int = 1;
pub const AV_HWDEVICE_TYPE_CUDA: c_int = 2;
pub const AV_HWDEVICE_TYPE_VAAPI: c_int = 3;
pub const AV_HWDEVICE_TYPE_DXVA2: c_int = 4;
pub const AV_HWDEVICE_TYPE_QSV: c_int = 5;
pub const AV_HWDEVICE_TYPE_VIDEOTOOLBOX: c_int = 6;
pub const AV_HWDEVICE_TYPE_D3D11VA: c_int = 7;

pub const AVERROR_EAGAIN: c_int = -11; // -EAGAIN on Linux; 35 negated on Win — we treat both
pub const AVERROR_EOF: c_int = -0x20464F45;

// ── Opaque types ──
#[repr(C)]
pub struct AVCodec(pub [u8; 0]);
#[repr(C)]
pub struct AVCodecContext(pub [u8; 0]);
#[repr(C)]
pub struct AVCodecParserContext(pub [u8; 0]);
#[repr(C)]
pub struct AVPacket(pub [u8; 0]);
#[repr(C)]
pub struct AVFrame(pub [u8; 0]);
#[repr(C)]
pub struct AVBufferRef(pub [u8; 0]);
#[repr(C)]
pub struct SwsContext(pub [u8; 0]);

unsafe extern "C" {
    // === libavcodec ===
    pub fn avcodec_find_decoder(id: c_int) -> *const AVCodec;
    pub fn avcodec_alloc_context3(codec: *const AVCodec) -> *mut AVCodecContext;
    pub fn avcodec_free_context(ctx: *mut *mut AVCodecContext);
    pub fn avcodec_open2(
        ctx: *mut AVCodecContext,
        codec: *const AVCodec,
        options: *mut c_void,
    ) -> c_int;
    pub fn avcodec_send_packet(ctx: *mut AVCodecContext, pkt: *const AVPacket) -> c_int;
    pub fn avcodec_receive_frame(ctx: *mut AVCodecContext, frame: *mut AVFrame) -> c_int;
    pub fn avcodec_flush_buffers(ctx: *mut AVCodecContext);

    pub fn av_parser_init(codec_id: c_int) -> *mut AVCodecParserContext;
    pub fn av_parser_close(parser: *mut AVCodecParserContext);
    pub fn av_parser_parse2(
        parser: *mut AVCodecParserContext,
        ctx: *mut AVCodecContext,
        poutbuf: *mut *mut u8,
        poutbuf_size: *mut c_int,
        buf: *const u8,
        buf_size: c_int,
        pts: i64,
        dts: i64,
        pos: i64,
    ) -> c_int;

    pub fn av_packet_alloc() -> *mut AVPacket;
    pub fn av_packet_free(pkt: *mut *mut AVPacket);
    pub fn av_new_packet(pkt: *mut AVPacket, size: c_int) -> c_int;
    pub fn av_packet_unref(pkt: *mut AVPacket);

    // === libavutil ===
    pub fn av_frame_alloc() -> *mut AVFrame;
    pub fn av_frame_free(frame: *mut *mut AVFrame);
    pub fn av_frame_unref(frame: *mut AVFrame);

    pub fn av_hwdevice_ctx_create(
        device_ctx: *mut *mut AVBufferRef,
        type_: c_int,
        device: *const c_char,
        opts: *mut c_void,
        flags: c_int,
    ) -> c_int;
    pub fn av_buffer_ref(buf: *mut AVBufferRef) -> *mut AVBufferRef;
    pub fn av_buffer_unref(buf: *mut *mut AVBufferRef);

    pub fn av_hwframe_transfer_data(dst: *mut AVFrame, src: *const AVFrame, flags: c_int) -> c_int;

    pub fn av_strerror(errnum: c_int, errbuf: *mut c_char, errbuf_size: usize) -> c_int;

    // === libswscale ===
    pub fn sws_getContext(
        srcW: c_int,
        srcH: c_int,
        srcFormat: c_int,
        dstW: c_int,
        dstH: c_int,
        dstFormat: c_int,
        flags: c_int,
        srcFilter: *mut c_void,
        dstFilter: *mut c_void,
        param: *const f64,
    ) -> *mut SwsContext;
    pub fn sws_freeContext(ctx: *mut SwsContext);
    pub fn sws_scale(
        ctx: *mut SwsContext,
        src_slice: *const *const u8,
        src_stride: *const c_int,
        src_y: c_int,
        src_h: c_int,
        dst: *const *mut u8,
        dst_stride: *const c_int,
    ) -> c_int;
}

// ── Shim functions (defined in src/ffmpeg_shim.c, compiled by build.rs) ──
unsafe extern "C" {
    pub fn shark_ffmpeg_set_log_level_error();
    pub fn shark_frame_data(f: *const AVFrame, plane: c_int) -> *const u8;
    pub fn shark_frame_linesize(f: *const AVFrame, plane: c_int) -> c_int;
    pub fn shark_frame_width(f: *const AVFrame) -> c_int;
    pub fn shark_frame_height(f: *const AVFrame) -> c_int;
    pub fn shark_frame_format(f: *const AVFrame) -> c_int;
    pub fn shark_packet_set(pkt: *mut AVPacket, data: *mut u8, size: c_int);
    pub fn shark_packet_size(pkt: *const AVPacket) -> c_int;
    pub fn shark_packet_data(pkt: *const AVPacket) -> *const u8;
    pub fn shark_set_hw_device(ctx: *mut AVCodecContext, device_ref: *mut AVBufferRef) -> c_int;
    pub fn shark_set_hw_pixel_format(ctx: *mut AVCodecContext, pix_fmt: c_int) -> c_int;
    pub fn shark_codec_set_low_delay(ctx: *mut AVCodecContext);
    pub fn shark_codec_supports_hw(
        codec: *const AVCodec,
        device_type: c_int,
        pix_fmt: c_int,
    ) -> c_int;

    pub fn shark_averror_eagain() -> c_int;
    pub fn shark_averror_eof() -> c_int;

    pub fn shark_pix_fmt_none() -> c_int;
    pub fn shark_pix_fmt_yuv420p() -> c_int;
    pub fn shark_pix_fmt_nv12() -> c_int;
    pub fn shark_pix_fmt_d3d11() -> c_int;
    pub fn shark_pix_fmt_d3d11va_vld() -> c_int;
    pub fn shark_pix_fmt_dxva2_vld() -> c_int;
    pub fn shark_pix_fmt_vaapi() -> c_int;
    pub fn shark_pix_fmt_cuda() -> c_int;
    pub fn shark_pix_fmt_qsv() -> c_int;

    pub fn shark_hw_device_type_d3d11va() -> c_int;
    pub fn shark_hw_device_type_dxva2() -> c_int;
    pub fn shark_hw_device_type_vaapi() -> c_int;
    pub fn shark_hw_device_type_cuda() -> c_int;
    pub fn shark_hw_device_type_qsv() -> c_int;
}

#[inline]
pub fn is_eagain(code: c_int) -> bool {
    code == unsafe { shark_averror_eagain() }
}

#[inline]
pub fn is_eof(code: c_int) -> bool {
    code == unsafe { shark_averror_eof() }
}

#[inline]
pub fn pix_fmt_yuv420p() -> c_int {
    unsafe { shark_pix_fmt_yuv420p() }
}
#[inline]
pub fn pix_fmt_nv12() -> c_int {
    unsafe { shark_pix_fmt_nv12() }
}
#[inline]
pub fn pix_fmt_d3d11() -> c_int {
    unsafe { shark_pix_fmt_d3d11() }
}
#[inline]
pub fn pix_fmt_d3d11va_vld() -> c_int {
    unsafe { shark_pix_fmt_d3d11va_vld() }
}
#[inline]
pub fn pix_fmt_dxva2_vld() -> c_int {
    unsafe { shark_pix_fmt_dxva2_vld() }
}
#[inline]
pub fn pix_fmt_vaapi() -> c_int {
    unsafe { shark_pix_fmt_vaapi() }
}
#[inline]
pub fn pix_fmt_cuda() -> c_int {
    unsafe { shark_pix_fmt_cuda() }
}
#[inline]
pub fn pix_fmt_qsv() -> c_int {
    unsafe { shark_pix_fmt_qsv() }
}

#[inline]
pub fn hw_device_type_d3d11va() -> c_int {
    unsafe { shark_hw_device_type_d3d11va() }
}
#[inline]
pub fn hw_device_type_dxva2() -> c_int {
    unsafe { shark_hw_device_type_dxva2() }
}
#[inline]
pub fn hw_device_type_vaapi() -> c_int {
    unsafe { shark_hw_device_type_vaapi() }
}
#[inline]
pub fn hw_device_type_cuda() -> c_int {
    unsafe { shark_hw_device_type_cuda() }
}
#[inline]
pub fn hw_device_type_qsv() -> c_int {
    unsafe { shark_hw_device_type_qsv() }
}

/// Helper: format an FFmpeg negative error code as a Rust `String`.
pub fn errstr(code: c_int) -> String {
    let mut buf = [0i8; 256];
    unsafe {
        av_strerror(code, buf.as_mut_ptr() as *mut c_char, buf.len());
    }
    let cstr = unsafe { std::ffi::CStr::from_ptr(buf.as_ptr() as *const c_char) };
    cstr.to_string_lossy().into_owned()
}

/// Convenience: cargo-cfg gate for whether the internal-ffmpeg feature
/// (and therefore this FFI layer) is compiled in.
pub const FEATURE_ENABLED: bool = cfg!(feature = "internal-ffmpeg");

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(feature = "internal-ffmpeg")]
    #[test]
    fn hevc_decoder_exists() {
        // Sanity-check we linked against libavcodec correctly.
        let codec = unsafe { avcodec_find_decoder(AV_CODEC_ID_HEVC) };
        assert!(
            !codec.is_null(),
            "HEVC decoder missing — check linker flags"
        );
    }
}

// Suppress "unused" warnings when feature is disabled — the consts and
// extern block still need to type-check.
const _: c_uint = c_uint::MIN;
