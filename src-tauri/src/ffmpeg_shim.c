/* FFmpeg accessor shim — exposes opaque-struct fields to the Rust FFI without
 * pinning struct layouts. Compiled by build.rs (cc::Build) only when the
 * `internal-ffmpeg` Cargo feature is enabled.
 *
 * Each function is a thin getter/setter; the C compiler resolves field
 * offsets against the vendored FFmpeg 7.x headers, so layout drift in
 * future FFmpeg versions only requires re-building the static libs and
 * shim — the Rust side stays unchanged.
 */
#include <stdint.h>
#include <libavcodec/avcodec.h>
#include <libavutil/frame.h>
#include <libavutil/buffer.h>
#include <libavutil/error.h>
#include <libavutil/hwcontext.h>
#include <libavutil/log.h>
#include <libavutil/pixfmt.h>

void shark_ffmpeg_set_log_level_error(void) {
    av_log_set_level(AV_LOG_ERROR);
}

/* AVFrame plane data pointer (0=Y, 1=U/UV, 2=V for yuv420p; 0=NV12-Y, 1=NV12-UV). */
const uint8_t* shark_frame_data(const AVFrame* f, int plane) {
    if (!f || plane < 0 || plane >= AV_NUM_DATA_POINTERS) return NULL;
    return f->data[plane];
}

int shark_frame_linesize(const AVFrame* f, int plane) {
    if (!f || plane < 0 || plane >= AV_NUM_DATA_POINTERS) return 0;
    return f->linesize[plane];
}

int shark_frame_width(const AVFrame* f)  { return f ? f->width  : 0; }
int shark_frame_height(const AVFrame* f) { return f ? f->height : 0; }
int shark_frame_format(const AVFrame* f) { return f ? f->format : -1; }

/* AVPacket helpers — the public extern set/unset path expects the caller to
 * own a packet, and we want to avoid duplicating the opaque struct layout. */
void shark_packet_set(AVPacket* pkt, uint8_t* data, int size) {
    if (!pkt) return;
    pkt->data = data;
    pkt->size = size;
}

int shark_packet_size(const AVPacket* pkt) {
    return pkt ? pkt->size : 0;
}

const uint8_t* shark_packet_data(const AVPacket* pkt) {
    return pkt ? pkt->data : NULL;
}

/* Attach a hardware-device context to a codec context (sets ctx->hw_device_ctx
 * = av_buffer_ref(device_ref)). Returns 0 on success. */
int shark_set_hw_device(AVCodecContext* ctx, AVBufferRef* device_ref) {
    if (!ctx || !device_ref) return -1;
    ctx->hw_device_ctx = av_buffer_ref(device_ref);
    return ctx->hw_device_ctx ? 0 : -1;
}

/* Return enum values from the exact FFmpeg headers used to compile the shim.
 * Rust must not hard-code AVPixelFormat values: they can move between FFmpeg
 * versions when new formats are inserted.
 */
int shark_averror_eagain(void) { return AVERROR(EAGAIN); }
int shark_averror_eof(void) { return AVERROR_EOF; }

int shark_pix_fmt_none(void) { return AV_PIX_FMT_NONE; }
int shark_pix_fmt_yuv420p(void) { return AV_PIX_FMT_YUV420P; }
int shark_pix_fmt_nv12(void) { return AV_PIX_FMT_NV12; }
int shark_pix_fmt_d3d11(void) { return AV_PIX_FMT_D3D11; }
int shark_pix_fmt_d3d11va_vld(void) { return AV_PIX_FMT_D3D11VA_VLD; }
int shark_pix_fmt_dxva2_vld(void) { return AV_PIX_FMT_DXVA2_VLD; }
int shark_pix_fmt_vaapi(void) { return AV_PIX_FMT_VAAPI; }
int shark_pix_fmt_cuda(void) { return AV_PIX_FMT_CUDA; }
int shark_pix_fmt_qsv(void) { return AV_PIX_FMT_QSV; }

int shark_hw_device_type_d3d11va(void) { return AV_HWDEVICE_TYPE_D3D11VA; }
int shark_hw_device_type_dxva2(void) { return AV_HWDEVICE_TYPE_DXVA2; }
int shark_hw_device_type_vaapi(void) { return AV_HWDEVICE_TYPE_VAAPI; }
int shark_hw_device_type_cuda(void) { return AV_HWDEVICE_TYPE_CUDA; }
int shark_hw_device_type_qsv(void) { return AV_HWDEVICE_TYPE_QSV; }

int shark_codec_supports_hw(const AVCodec* codec, int device_type, int pix_fmt) {
    if (!codec) return 0;
    for (int i = 0;; i++) {
        const AVCodecHWConfig* config = avcodec_get_hw_config(codec, i);
        if (!config) return 0;
        if (config->device_type == (enum AVHWDeviceType)device_type &&
            config->pix_fmt == (enum AVPixelFormat)pix_fmt &&
            (config->methods & AV_CODEC_HW_CONFIG_METHOD_HW_DEVICE_CTX)) {
            return 1;
        }
    }
}

static enum AVPixelFormat shark_get_hw_format(
    AVCodecContext* ctx,
    const enum AVPixelFormat* pix_fmts
) {
    enum AVPixelFormat requested = AV_PIX_FMT_NONE;
    if (ctx) {
        requested = (enum AVPixelFormat)(intptr_t)ctx->opaque;
    }

    if (!pix_fmts) return AV_PIX_FMT_NONE;
    for (const enum AVPixelFormat* p = pix_fmts; *p != AV_PIX_FMT_NONE; p++) {
        if (*p == requested) {
            return *p;
        }
    }
    return pix_fmts[0];
}

int shark_set_hw_pixel_format(AVCodecContext* ctx, int pix_fmt) {
    if (!ctx) return -1;
    ctx->opaque = (void*)(intptr_t)pix_fmt;
    ctx->get_format = shark_get_hw_format;
    return 0;
}

void shark_codec_set_low_delay(AVCodecContext* ctx) {
    if (!ctx) return;
    ctx->flags |= AV_CODEC_FLAG_LOW_DELAY;
    ctx->flags2 |= AV_CODEC_FLAG2_FAST;
    ctx->thread_count = 1;
}

/* === Compatibility stubs for symbols MSVC's CRT does not provide ===
 *
 * MinGW-built libavutil references `sincos`, a GNU libm extension absent from
 * MSVC's UCRT. We provide a trivial wrapper using the standard sin/cos.
 * Linker resolves this from our static archive before falling back elsewhere.
 */
#include <math.h>
void sincos(double x, double* s, double* c) {
    if (s) *s = sin(x);
    if (c) *c = cos(x);
}
void sincosf(float x, float* s, float* c) {
    if (s) *s = sinf(x);
    if (c) *c = cosf(x);
}
