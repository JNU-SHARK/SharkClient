//! UDP frame assembly: zero-allocation reordering buffer + buffer pool.
//!
//! Each multi-fragment frame is assembled into a single pre-allocated buffer
//! (no per-fragment Vec allocation). When fragments arrive in order — the
//! common case on LAN — finalize is zero-copy. Out-of-order arrival pays a
//! one-time reorder on completion.

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use super::stats::AtomicStats;

/// Maximum fragments per frame.
///
/// 1080p H.265 keyframes can briefly spike well above the average bitrate.
/// Keep the UDP packet protocol unchanged, but allow the receiver to track
/// enough fragments for large IDR frames instead of timing them out.
pub(super) const MAX_FRAGMENTS: usize = 16 * 1024;

/// Fragment metadata stored in the assembly tracking array.
struct FragEntry {
    offset: u32, // Byte offset in the assembly buffer
    len: u16,    // Fragment payload length
}

/// High-performance frame assembler.
///
/// Design principles:
/// 1. **Single pre-allocated buffer** per frame — no per-fragment Vec allocation.
/// 2. **Sequential write, lazy reorder** — fragments are appended in arrival order.
///    When all fragments arrive in-order (common on LAN), finalize is zero-copy.
///    Out-of-order arrival triggers a one-time reorder on completion.
/// 3. **Bounded fragment metadata** — heap allocated so 1080p-sized frames do
///    not inflate the receive loop stack.
pub(super) struct FrameAssembly {
    #[allow(dead_code)]
    frame_number: u16,
    pub(super) total_size: u32,
    buffer: Vec<u8>,
    payload_offset: usize,
    first_seen: Instant,

    // Fragment tracking: indexed by fragment_index.
    entries: Vec<Option<FragEntry>>,
    fragment_count: u16, // Number of fragments received
    received_bytes: u32,

    // In-order tracking: if all fragments arrived sequentially, finalize is O(0)
    in_order: bool,
    next_expected_index: u16,
}

impl FrameAssembly {
    pub(super) fn new(
        frame_number: u16,
        total_size: u32,
        mut buffer: Vec<u8>,
        payload_offset: usize,
    ) -> Self {
        let required_len = payload_offset + total_size as usize;
        if buffer.len() < required_len {
            buffer.resize(required_len, 0);
        }

        Self {
            frame_number,
            total_size,
            buffer,
            payload_offset,
            first_seen: Instant::now(),
            entries: Vec::new(),
            fragment_count: 0,
            received_bytes: 0,
            in_order: true,
            next_expected_index: 0,
        }
    }

    /// Write a fragment's payload directly into the assembly buffer.
    /// Returns `true` if the frame is now complete (all bytes received).
    #[inline]
    pub(super) fn write_fragment(&mut self, fragment_index: u16, payload: &[u8]) -> bool {
        let idx = fragment_index as usize;
        if idx >= MAX_FRAGMENTS {
            return false;
        }
        if idx >= self.entries.len() {
            self.entries.resize_with(idx + 1, || None);
        }

        // Duplicate fragment — skip
        if self.entries[idx].is_some() {
            return false;
        }

        let payload_len = payload.len();
        let write_offset = self.received_bytes;

        // Direct copy into pre-allocated buffer — no intermediate Vec!
        let start = self.payload_offset + write_offset as usize;
        let payload_limit = self.payload_offset + self.total_size as usize;
        let end = (start + payload_len)
            .min(payload_limit)
            .min(self.buffer.len());
        if end <= start {
            return self.received_bytes >= self.total_size;
        }
        let copy_len = end - start;
        self.buffer[start..end].copy_from_slice(&payload[..copy_len]);

        // Record this fragment's position
        self.entries[idx] = Some(FragEntry {
            offset: write_offset,
            len: copy_len as u16,
        });
        self.fragment_count += 1;
        self.received_bytes += copy_len as u32;

        // Track in-order arrival
        if fragment_index != self.next_expected_index {
            self.in_order = false;
        }
        self.next_expected_index = fragment_index + 1;

        self.received_bytes >= self.total_size
    }

    #[inline]
    pub(super) fn is_stale(&self, now: Instant, timeout: Duration) -> bool {
        now.duration_since(self.first_seen) >= timeout
    }

    #[inline]
    pub(super) fn payload(&self) -> &[u8] {
        let payload_len = self.received_bytes.min(self.total_size) as usize;
        let end = self.payload_offset + payload_len;
        &self.buffer[self.payload_offset..end]
    }

    /// Finalize the frame into a contiguous byte buffer.
    /// - **In-order path**: zero-copy, just truncate the buffer. O(1).
    /// - **Out-of-order path**: reorder fragments into a new buffer. O(n).
    pub(super) fn finalize(mut self) -> Vec<u8> {
        if self.in_order && self.payload_offset == 0 {
            // Fast path: fragments arrived in order, buffer is already correct
            self.buffer.truncate(self.total_size as usize);
            return self.buffer;
        }

        let mut result = Vec::with_capacity(self.total_size as usize);
        self.extend_payload_into(&mut result);
        result
    }

    /// Finalize into `[prefix, payload...]`.
    pub(super) fn finalize_prefixed(mut self, prefix: &[u8]) -> Vec<u8> {
        if self.in_order && self.payload_offset == prefix.len() {
            self.buffer[..prefix.len()].copy_from_slice(prefix);
            self.buffer
                .truncate(prefix.len() + self.total_size as usize);
            return self.buffer;
        }

        let mut result = Vec::with_capacity(prefix.len() + self.total_size as usize);
        result.extend_from_slice(prefix);
        self.extend_payload_into(&mut result);
        result
    }

    fn extend_payload_into(&self, out: &mut Vec<u8>) {
        if self.in_order {
            let start = self.payload_offset;
            let end = start + self.total_size as usize;
            out.extend_from_slice(&self.buffer[start..end]);
            return;
        }

        // Slow path: reorder fragments by index
        for entry in self.entries.iter().flatten() {
            let start = self.payload_offset + entry.offset as usize;
            let end = start + entry.len as usize;
            out.extend_from_slice(&self.buffer[start..end]);
        }
    }

    /// Return the buffer to the pool (for reuse).
    pub(super) fn recycle_buffer(mut self) -> Vec<u8> {
        self.buffer.clear();
        self.buffer
    }
}

/// Object pool for frame buffers. Reuses heap allocations across frames
/// to avoid repeated malloc/free on the hot path.
pub(super) struct FramePool {
    buffers: Vec<Vec<u8>>,
    max_pool_size: usize,
}

impl FramePool {
    pub(super) fn new(max_pool_size: usize) -> Self {
        Self {
            buffers: Vec::with_capacity(max_pool_size),
            max_pool_size,
        }
    }

    /// Acquire a buffer with at least `capacity` bytes.
    /// Reuses a pooled buffer if available, otherwise allocates.
    pub(super) fn acquire(&mut self, capacity: usize) -> Vec<u8> {
        if let Some(mut buf) = self.buffers.pop() {
            if buf.capacity() >= capacity {
                // Reuse existing allocation — resize without zeroing
                unsafe {
                    buf.set_len(capacity);
                }
                return buf;
            }
            // Buffer too small, drop it and allocate new
        }
        vec![0u8; capacity]
    }

    /// Return a buffer to the pool for future reuse.
    pub(super) fn release(&mut self, buf: Vec<u8>) {
        if self.buffers.len() < self.max_pool_size {
            self.buffers.push(buf);
        }
        // Otherwise drop — pool is full
    }
}

pub(super) fn drop_in_flight_frame(
    assemblies: &mut HashMap<u16, FrameAssembly>,
    frame_order: &mut VecDeque<u16>,
    frame_number: u16,
    pool: &mut FramePool,
    stats: &AtomicStats,
) {
    if let Some(frame) = assemblies.remove(&frame_number) {
        stats.dropped_frames.fetch_add(1, Ordering::Relaxed);
        pool.release(frame.recycle_buffer());
    }
    frame_order.retain(|value| *value != frame_number);
}

pub(super) fn drop_stale_in_flight_frames(
    assemblies: &mut HashMap<u16, FrameAssembly>,
    frame_order: &mut VecDeque<u16>,
    pool: &mut FramePool,
    stats: &AtomicStats,
    timeout: Duration,
) {
    let now = Instant::now();
    let stale_frames: Vec<u16> = frame_order
        .iter()
        .copied()
        .filter(|frame_number| {
            assemblies
                .get(frame_number)
                .map(|frame| frame.is_stale(now, timeout))
                .unwrap_or(false)
        })
        .collect();

    for frame_number in stale_frames {
        stats.dropped_old_frames.fetch_add(1, Ordering::Relaxed);
        drop_in_flight_frame(assemblies, frame_order, frame_number, pool, stats);
    }
}
