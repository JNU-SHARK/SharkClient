"""CUDA INT8 PTQ via TensorRT (no onnxruntime static quantization).

流程：
  1. 直接读原始 FP16 ONNX（armor.onnx / car.onnx）。
  2. 用 TensorRT 的 ONNX parser 构建 INetworkDefinition。
  3. 注册一个 IInt8EntropyCalibrator2，在 CUDA 设备上跑前向收集激活分布。
  4. 同时开 INT8 + FP16 标志（FP16 作为 INT8 无法表达层的 fallback）。
  5. 产出两份文件：
       · armor.cache / car.cache  —— TRT native 校准缓存（可随 exe 一起嵌入，
         运行期给 ORT 的 TensorRT EP 用，EP 会在首次跑时自动构建 INT8 engine
         并写到 trt_cache/ 下，和 GPU 架构绑定）。
       · armor_int8.plan / car_int8.plan  —— 离线 engine（仅用于本机跑 benchmark，
         exe 里不嵌入，因为 .plan 与 SM 强绑定不便分发）。

校准数据：优先读 `AI Server/test_images/*.{jpg,jpeg,png,bmp}`，否则退化为
16 张均匀随机噪声（精度次优，可随时补真实截图重跑一次）。

依赖：tensorrt（项目自带 TensorRT-10.16.1.11/python 里的 wheel）、
cuda-python、numpy、Pillow（可选）。

用法：
    # 需要把 TensorRT-*/bin 放进 PATH 才能找到 nvinfer_10.dll
    $env:PATH = "$PSScriptRoot\..\TensorRT-10.16.1.11\bin;" + $env:PATH
    python scripts/quantize-tensorrt.py
"""
from __future__ import annotations

import argparse
import os
import sys
import warnings
from pathlib import Path
from typing import List, Optional

import numpy as np
import tensorrt as trt

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
warnings.filterwarnings("ignore", category=DeprecationWarning)

try:
    # cuda-python >= 12
    from cuda.bindings import runtime as cudart
except ImportError:  # fallback for older cuda-python
    from cuda import cudart  # type: ignore

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MODEL_DIR = PROJECT_ROOT / "AI Server" / "model"
DEFAULT_CALIB_DIR = PROJECT_ROOT / "AI Server" / "test_images"
TRT_LOGGER = trt.Logger(trt.Logger.WARNING)


# ───────────────────────── CUDA helpers ──────────────────────────

def _cuda_check(err) -> None:
    # cuda-python 的 no-result API 会返回 (status,) 元组；有 result 的 API 返回
    # (status, value) 我们在外面拆过再传 status 进来。这里统一兼容。
    if isinstance(err, tuple):
        err = err[0]
    if err != cudart.cudaError_t.cudaSuccess:
        raise RuntimeError(f"CUDA error: {err}")


def _cuda_malloc(nbytes: int) -> int:
    err, ptr = cudart.cudaMalloc(nbytes)
    _cuda_check(err)
    return int(ptr)


def _cuda_free(ptr: int) -> None:
    _cuda_check(cudart.cudaFree(ptr))


def _cuda_memcpy_h2d(dst: int, src: np.ndarray) -> None:
    _cuda_check(
        cudart.cudaMemcpy(
            dst,
            src.ctypes.data,
            src.nbytes,
            cudart.cudaMemcpyKind.cudaMemcpyHostToDevice,
        )
    )


# ───────────────────────── calibration data ──────────────────────

def _load_image(path: Path, w: int, h: int) -> Optional[np.ndarray]:
    try:
        from PIL import Image  # lazy import
    except ImportError:
        return None
    try:
        img = Image.open(path).convert("RGB").resize((w, h), Image.BICUBIC)
    except Exception:
        return None
    arr = np.asarray(img, dtype=np.float32) / 255.0       # HWC
    arr = np.transpose(arr, (2, 0, 1))                     # CHW
    return np.ascontiguousarray(arr[None, ...])            # NCHW


def _collect_calib_tensors(
    calib_dir: Path, n: int, w: int, h: int, rng: np.random.Generator
) -> List[np.ndarray]:
    samples: List[np.ndarray] = []
    if calib_dir.is_dir():
        exts = {".jpg", ".jpeg", ".png", ".bmp"}
        files = sorted(p for p in calib_dir.iterdir() if p.suffix.lower() in exts)
        for p in files:
            t = _load_image(p, w, h)
            if t is not None:
                samples.append(t)
            if len(samples) >= n:
                break
    if not samples:
        print(f"[calib] ! {calib_dir} 为空或不存在，使用 {n} 张均匀噪声")
    while len(samples) < n:
        samples.append(
            rng.uniform(0.0, 1.0, size=(1, 3, h, w)).astype(np.float32)
        )
    return samples[:n]


# ───────────────────────── calibrator ─────────────────────────────

class EntropyCalibrator(trt.IInt8EntropyCalibrator2):
    """IInt8EntropyCalibrator2 实现，直接把样本搬到 CUDA 设备做 PTQ 标定。"""

    def __init__(
        self,
        samples: List[np.ndarray],
        cache_path: Path,
        input_name: str,
    ) -> None:
        super().__init__()
        self._samples = samples
        self._cache_path = cache_path
        self._input_name = input_name
        self._idx = 0
        # 所有样本形状必须一致
        self._nbytes = samples[0].nbytes
        self._dptr = _cuda_malloc(self._nbytes)

    # ---- required overrides ----
    def get_batch_size(self) -> int:
        return 1

    def get_batch(self, names):  # noqa: D401
        if self._idx >= len(self._samples):
            return None
        batch = np.ascontiguousarray(self._samples[self._idx])
        _cuda_memcpy_h2d(self._dptr, batch)
        self._idx += 1
        # 对每个输入返回设备指针；本模型只有一个输入
        return [self._dptr]

    def read_calibration_cache(self):
        if self._cache_path.is_file():
            return self._cache_path.read_bytes()
        return None

    def write_calibration_cache(self, cache: bytes) -> None:
        self._cache_path.write_bytes(cache)

    def __del__(self):
        try:
            _cuda_free(self._dptr)
        except Exception:
            pass


# ───────────────────────── build & quantize ──────────────────────

def quantize_one(
    onnx_path: Path,
    cache_path: Path,
    plan_path: Optional[Path],
    calib_samples: List[np.ndarray],
    workspace_gb: int,
) -> None:
    assert onnx_path.is_file(), onnx_path
    print(f"\n[trt-int8] == {onnx_path.name} ==")

    builder = trt.Builder(TRT_LOGGER)
    network = builder.create_network(
        1 << int(trt.NetworkDefinitionCreationFlag.EXPLICIT_BATCH)
    )
    parser = trt.OnnxParser(network, TRT_LOGGER)
    with open(onnx_path, "rb") as f:
        if not parser.parse(f.read()):
            for i in range(parser.num_errors):
                print(f"  [onnx] {parser.get_error(i)}", file=sys.stderr)
            raise RuntimeError(f"parse failed: {onnx_path}")

    # 原始 ONNX 是 FP16（ultralytics half=True 导出），input dtype=float16。
    # 让 TRT 校准时用 FP32 激活分布更准，于是把输入 tensor 的 dtype 显式改成 FP32；
    # 校准样本也是 np.float32，两边对齐。
    input_tensor = network.get_input(0)
    if input_tensor.dtype != trt.DataType.FLOAT:
        print(f"  [info] 把网络输入 {input_tensor.name} 从 {input_tensor.dtype} 改为 FLOAT")
        input_tensor.dtype = trt.DataType.FLOAT

    config = builder.create_builder_config()
    ws_bytes = workspace_gb * (1024 ** 3)
    try:
        config.set_memory_pool_limit(trt.MemoryPoolType.WORKSPACE, ws_bytes)
    except AttributeError:
        config.max_workspace_size = ws_bytes

    config.set_flag(trt.BuilderFlag.INT8)
    if builder.platform_has_fast_fp16:
        config.set_flag(trt.BuilderFlag.FP16)  # INT8 无法覆盖的算子回退到 FP16

    # YOLOv5 的 Detect 头（ultralytics 里叫 model.24）对 TRT 10 的 Myelin 隐式
    # INT8 PTQ 不友好，会报 "Could not find any implementation for node
    # {ForeignNode[Quantize 0.../model.24/Concat_3]}"。解法：
    #   1) 把所有 Concat / Reshape / Shuffle / Slice 这种 layout 类算子钉死在
    #      FP16，避免 Myelin 把它们卷进 INT8 子图；
    #   2) 把整段 Detect 头（名字带 /model.24/ 的 layer）钉死 FP16；
    #   3) 开 OBEY_PRECISION_CONSTRAINTS 让 TRT 强制遵守上面两条。
    layout_types = {
        trt.LayerType.CONCATENATION,
        trt.LayerType.SHUFFLE,
        trt.LayerType.SLICE,
        trt.LayerType.RESIZE,
    }
    forced = 0
    for li in range(network.num_layers):
        layer = network.get_layer(li)
        name = layer.name or ""
        if layer.type in layout_types or "/model.24" in name:
            layer.precision = trt.DataType.HALF
            for oj in range(layer.num_outputs):
                layer.set_output_type(oj, trt.DataType.HALF)
            forced += 1
    if forced:
        print(f"  [info] 把 {forced} 个 layout / Detect-head layer 钉在 FP16")
        config.set_flag(trt.BuilderFlag.OBEY_PRECISION_CONSTRAINTS)

    # 降低 builder 优化等级，避免 Myelin 强行融合出无法生成代码的子图
    try:
        config.builder_optimization_level = 2
    except AttributeError:
        pass

    shape = tuple(input_tensor.shape)
    profile = builder.create_optimization_profile()
    profile.set_shape(input_tensor.name, shape, shape, shape)
    config.add_optimization_profile(profile)

    calibrator = EntropyCalibrator(
        samples=calib_samples,
        cache_path=cache_path,
        input_name=input_tensor.name,
    )
    # IInt8EntropyCalibrator2 在 build 时需要 profile
    try:
        config.set_calibration_profile(profile)
    except AttributeError:
        pass
    config.int8_calibrator = calibrator

    print(
        f"  [build] ws={workspace_gb}GB, INT8+FP16, "
        f"input={input_tensor.name} shape={shape} samples={len(calib_samples)}"
    )
    serialized = builder.build_serialized_network(network, config)
    if serialized is None:
        raise RuntimeError("build_serialized_network returned None")

    if not cache_path.is_file():
        raise RuntimeError(
            f"标定缓存未生成：{cache_path}（TRT 可能没有调用 write_calibration_cache）"
        )
    cache_size = cache_path.stat().st_size
    print(f"  [cache] ✅ {cache_path.relative_to(PROJECT_ROOT)} ({cache_size} B)")

    if plan_path is not None:
        plan_path.write_bytes(bytes(serialized))
        print(
            f"  [plan]  ✅ {plan_path.relative_to(PROJECT_ROOT)} "
            f"({plan_path.stat().st_size // 1024} KB) — 仅本机使用，不嵌入 exe"
        )

    # 释放引用，避免 TRT 析构顺序报 warning
    del serialized, calibrator, config, parser, network, builder


# ───────────────────────── main ──────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description="TensorRT INT8 PTQ (CUDA-based)")
    ap.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL_DIR)
    ap.add_argument("--calib-dir", type=Path, default=DEFAULT_CALIB_DIR)
    ap.add_argument("--samples", type=int, default=16)
    ap.add_argument("--width", type=int, default=640)
    ap.add_argument("--height", type=int, default=640)
    ap.add_argument("--workspace-gb", type=int, default=2)
    ap.add_argument(
        "--skip-plan",
        action="store_true",
        help="只产出 .cache，不构建本机 .plan（默认两者都产）",
    )
    ap.add_argument("--seed", type=int, default=1234)
    args = ap.parse_args()

    rng = np.random.default_rng(args.seed)
    samples = _collect_calib_tensors(
        args.calib_dir, args.samples, args.width, args.height, rng
    )
    print(
        f"[calib] {len(samples)} 样本，shape=[1,3,{args.height},{args.width}]，"
        f"来源={'real+synthetic' if args.calib_dir.is_dir() else 'synthetic'}"
    )

    targets = [
        # 用 FP32 版本作为 TRT 输入：原始 armor.onnx / car.onnx 是 FP16 导出，
        # TRT 10 parser 会给 FP16 子图塞 Dequantize 节点，和我们手动开的 INT8
        # flag 冲突，导致 build 失败。armor_fp32.onnx 由 scripts/convert-fp16-to-fp32
        # 一次性产出，TRT 直接吃 FP32 能稳定走 implicit INT8 标定。
        ("armor_fp32.onnx", "armor.cache", "armor_int8.plan"),
        ("car_fp32.onnx", "car.cache", "car_int8.plan"),
    ]

    for onnx_name, cache_name, plan_name in targets:
        onnx_path = args.model_dir / onnx_name
        cache_path = args.model_dir / cache_name
        plan_path = None if args.skip_plan else args.model_dir / plan_name
        # 每个模型独立校准，删掉旧缓存以免跳过本次重跑
        if cache_path.is_file():
            cache_path.unlink()
        quantize_one(
            onnx_path=onnx_path,
            cache_path=cache_path,
            plan_path=plan_path,
            calib_samples=samples,
            workspace_gb=args.workspace_gb,
        )

    print(
        "\n[trt-int8] 全部完成。接下来：\n"
        "  · 把 armor.cache / car.cache 留在 AI Server/model/ 下由 Rust include_bytes! 嵌入；\n"
        "  · cargo build --release 重新打包；\n"
        "  · 运行时设 SHARK_ENABLE_TRT=1，TRT EP 会读标定缓存在本机 GPU 上构建 INT8 engine。\n"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
