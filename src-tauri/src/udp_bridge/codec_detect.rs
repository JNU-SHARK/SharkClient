//! Codec detection for assembled UDP frames: JPEG magic bytes and Annex B
//! NAL parsing for H.264 / H.265.
//!
//! Pure functions, no I/O, no allocations beyond the returned `FrameInfo`.

use std::time::{SystemTime, UNIX_EPOCH};

use super::FrameInfo;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AnnexBCodec {
    H264,
    H265,
}

fn find_annex_b_start_code(data: &[u8], from: usize) -> Option<(usize, usize)> {
    if data.len() < 4 || from >= data.len().saturating_sub(3) {
        return None;
    }

    let max_index = data.len().saturating_sub(3);
    let mut index = from;
    while index < max_index {
        if data[index] == 0 && data[index + 1] == 0 {
            if data[index + 2] == 1 {
                return Some((index, 3));
            }
            if index + 3 < data.len() && data[index + 2] == 0 && data[index + 3] == 1 {
                return Some((index, 4));
            }
        }
        index += 1;
    }

    None
}

fn next_annex_b_nal(data: &[u8], from: usize) -> Option<(usize, &[u8])> {
    let (start, start_code_len) = find_annex_b_start_code(data, from)?;
    let nal_start = start + start_code_len;
    if nal_start >= data.len() {
        return None;
    }

    let next_start = find_annex_b_start_code(data, nal_start)
        .map(|(index, _)| index)
        .unwrap_or(data.len());
    Some((next_start, &data[nal_start..next_start]))
}

fn parse_h265_nal_type(nal: &[u8]) -> Option<u8> {
    if nal.len() < 2 || (nal[0] & 0x80) != 0 {
        return None;
    }

    let nal_type = (nal[0] >> 1) & 0x3F;
    let layer_id = ((nal[0] & 0x01) << 5) | (nal[1] >> 3);
    let temporal_id_plus_1 = nal[1] & 0x07;

    if layer_id == 0 && temporal_id_plus_1 != 0 && nal_type <= 40 {
        Some(nal_type)
    } else {
        None
    }
}

fn parse_h264_nal_type(nal: &[u8]) -> Option<u8> {
    if nal.is_empty() || (nal[0] & 0x80) != 0 {
        return None;
    }

    let nal_type = nal[0] & 0x1F;
    if (1..24).contains(&nal_type) {
        Some(nal_type)
    } else {
        None
    }
}

fn is_h265_keyframe_type(nal_type: u8) -> bool {
    // HEVC IRAP pictures are the only frames that can safely restart decode.
    // VPS/SPS/PPS (32/33/34) are parameter sets, not displayable keyframes.
    matches!(nal_type, 16..=21)
}

fn is_h264_keyframe_type(nal_type: u8) -> bool {
    // H.264 IDR only. SPS/PPS (7/8) should not release keyframe gating.
    nal_type == 5
}

fn analyze_annex_b_frame(data: &[u8]) -> Option<(AnnexBCodec, u8, bool)> {
    let mut offset = 0usize;
    let mut first_h265 = None;
    let mut h265_keyframe = None;
    let mut first_h264 = None;
    let mut h264_keyframe = None;

    while let Some((next_offset, nal)) = next_annex_b_nal(data, offset) {
        if let Some(nal_type) = parse_h265_nal_type(nal) {
            first_h265.get_or_insert(nal_type);
            if is_h265_keyframe_type(nal_type) {
                h265_keyframe = Some(nal_type);
            }
        }

        if let Some(nal_type) = parse_h264_nal_type(nal) {
            first_h264.get_or_insert(nal_type);
            if is_h264_keyframe_type(nal_type) {
                h264_keyframe = Some(nal_type);
            }
        }

        if next_offset >= data.len() {
            break;
        }
        offset = next_offset;
    }

    if let Some(nal_type) = h265_keyframe.or(first_h265) {
        return Some((AnnexBCodec::H265, nal_type, h265_keyframe.is_some()));
    }

    if let Some(nal_type) = h264_keyframe.or(first_h264) {
        return Some((AnnexBCodec::H264, nal_type, h264_keyframe.is_some()));
    }

    None
}

/// Detect frame type by inspecting NAL unit start codes and JPEG magic bytes.
/// Operates on the assembled frame data without copying.
#[inline]
pub(super) fn detect_frame_type(data: &[u8]) -> FrameInfo {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;

    if data.len() >= 2 && data[0] == 0xFF && data[1] == 0xD8 {
        return FrameInfo {
            r#type: "jpeg".into(),
            is_keyframe: true,
            timestamp,
            nal_type: None,
        };
    }

    match analyze_annex_b_frame(data) {
        Some((AnnexBCodec::H265, nal_type, is_keyframe)) => FrameInfo {
            r#type: "h265".into(),
            is_keyframe,
            timestamp,
            nal_type: Some(nal_type),
        },
        Some((AnnexBCodec::H264, nal_type, is_keyframe)) => FrameInfo {
            r#type: "h264".into(),
            is_keyframe,
            timestamp,
            nal_type: Some(nal_type),
        },
        None => FrameInfo {
            r#type: "unknown".into(),
            is_keyframe: false,
            timestamp,
            nal_type: None,
        },
    }
}
