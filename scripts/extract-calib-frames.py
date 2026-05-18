"""Extract calibration frames from project video source.

从 UDP-MQTT Server/VideoSource/*.mp4 里等距抽帧，保存到
AI Server/test_images/calib_XXX.jpg，供 scripts/quantize-tensorrt.py 使用。

没有真实比赛截图时这是最可靠的替代：视频里的光照、背景、对比度分布和
真实场景最接近，INT8 标定比均匀噪声靠谱得多。

用法：
    python scripts/extract-calib-frames.py --count 32
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_VIDEO_DIR = PROJECT_ROOT / "UDP-MQTT Server" / "VideoSource"
DEFAULT_OUT_DIR = PROJECT_ROOT / "AI Server" / "test_images"


def extract(video_path: Path, out_dir: Path, count: int, width: int, height: int) -> int:
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        print(f"[extract] ! 打不开 {video_path}")
        return 0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total <= 0:
        print(f"[extract] ! {video_path.name} 报告 0 帧，尝试顺序读取")
        total = 0
    print(f"[extract] {video_path.name}  总帧数={total or '?'}  目标={count} 张")

    out_dir.mkdir(parents=True, exist_ok=True)
    saved = 0
    if total > 0:
        # 等距抽帧
        step = max(1, total // (count + 1))
        for i in range(count):
            frame_idx = min(total - 1, (i + 1) * step)
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ok, frame = cap.read()
            if not ok or frame is None:
                continue
            # 按目标分辨率直接缩放（校准 tensor 形状就是 640x640）
            resized = cv2.resize(frame, (width, height), interpolation=cv2.INTER_CUBIC)
            out_path = out_dir / f"calib_{saved:03d}.jpg"
            cv2.imwrite(str(out_path), resized, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
            saved += 1
    else:
        # 顺序读取到第 N 张
        idx = 0
        while saved < count:
            ok, frame = cap.read()
            if not ok or frame is None:
                break
            if idx % 30 == 0:  # 大约 1 秒一张
                resized = cv2.resize(frame, (width, height), interpolation=cv2.INTER_CUBIC)
                cv2.imwrite(str(out_dir / f"calib_{saved:03d}.jpg"), resized)
                saved += 1
            idx += 1
    cap.release()
    print(f"[extract] 保存 {saved} 张到 {out_dir}")
    return saved


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video-dir", type=Path, default=DEFAULT_VIDEO_DIR)
    ap.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    ap.add_argument("--count", type=int, default=32, help="总抽帧数（所有视频平摊）")
    ap.add_argument("--width", type=int, default=640)
    ap.add_argument("--height", type=int, default=640)
    ap.add_argument("--clear", action="store_true", help="清空 out-dir 已有 calib_*.jpg")
    args = ap.parse_args()

    videos = sorted(
        p for p in args.video_dir.glob("*") if p.suffix.lower() in {".mp4", ".mkv", ".avi", ".mov"}
    )
    if not videos:
        print(f"[extract] ! {args.video_dir} 下找不到 mp4/mkv/avi/mov")
        return 1

    if args.clear:
        for old in args.out_dir.glob("calib_*.jpg"):
            old.unlink()

    per_video = max(1, args.count // len(videos))
    total_saved = 0
    for v in videos:
        total_saved += extract(v, args.out_dir, per_video, args.width, args.height)

    if total_saved == 0:
        print("[extract] ! 没抽到任何帧")
        return 2
    print(f"[extract] 完成，共 {total_saved} 张 → 可运行 scripts/quantize-tensorrt.py 重跑标定")
    return 0


if __name__ == "__main__":
    sys.exit(main())
