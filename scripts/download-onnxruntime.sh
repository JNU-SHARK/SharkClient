#!/usr/bin/env bash
# download-onnxruntime.sh
# ------------------------------------------------------------
# 预先下载 ONNX Runtime 动态库到 src-tauri/vendor/onnxruntime/<platform>/
# 供 Rust 端以 load-dynamic 方式加载（Linux / macOS）。
#
# 用法：
#   ./scripts/download-onnxruntime.sh                           # 自动识别
#   ./scripts/download-onnxruntime.sh --platform linux-x64-gpu
#   ./scripts/download-onnxruntime.sh --version 1.24.4
#
# 说明：
#   - ort 2.0.0-rc.12 对应 ONNX Runtime 1.24.x（默认 1.24.4）
#   - GPU 版需 NVIDIA 驱动 >= 525 (CUDA 12) 与对应 cuDNN
#   - 非 GPU 环境可改用 linux-x64 / osx-x64 等 CPU 版
# ------------------------------------------------------------
set -euo pipefail

VERSION="1.24.4"
PLATFORM=""
FORCE=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --version) VERSION="$2"; shift 2 ;;
        --platform) PLATFORM="$2"; shift 2 ;;
        --force) FORCE=1; shift ;;
        -h|--help)
            grep '^# ' "$0" | sed 's/^# \{0,1\}//'
            exit 0 ;;
        *) echo "未知参数：$1" >&2; exit 1 ;;
    esac
done

# 自动识别平台
if [[ -z "$PLATFORM" ]]; then
    uname_s=$(uname -s)
    uname_m=$(uname -m)
    case "$uname_s" in
        Linux)
            case "$uname_m" in
                x86_64|amd64) PLATFORM="linux-x64-gpu" ;;
                aarch64|arm64) PLATFORM="linux-aarch64" ;;
                *) echo "未知 Linux 架构：$uname_m" >&2; exit 1 ;;
            esac ;;
        Darwin)
            case "$uname_m" in
                arm64) PLATFORM="osx-arm64" ;;
                x86_64) PLATFORM="osx-x64" ;;
                *) echo "未知 macOS 架构：$uname_m" >&2; exit 1 ;;
            esac ;;
        MINGW*|MSYS*|CYGWIN*)
            PLATFORM="win-x64-gpu" ;;
        *) echo "未知系统：$uname_s（请用 -platform 指定）" >&2; exit 1 ;;
    esac
fi

# 平台 -> 压缩包文件名
case "$PLATFORM" in
    win-x64-gpu)   ARCHIVE="onnxruntime-win-x64-gpu-${VERSION}.zip";   IS_ZIP=1 ;;
    win-x64)       ARCHIVE="onnxruntime-win-x64-${VERSION}.zip";       IS_ZIP=1 ;;
    linux-x64-gpu) ARCHIVE="onnxruntime-linux-x64-gpu-${VERSION}.tgz"; IS_ZIP=0 ;;
    linux-x64)     ARCHIVE="onnxruntime-linux-x64-${VERSION}.tgz";     IS_ZIP=0 ;;
    linux-aarch64) ARCHIVE="onnxruntime-linux-aarch64-${VERSION}.tgz"; IS_ZIP=0 ;;
    osx-arm64)     ARCHIVE="onnxruntime-osx-arm64-${VERSION}.tgz";     IS_ZIP=0 ;;
    osx-x64)       ARCHIVE="onnxruntime-osx-x64-${VERSION}.tgz";       IS_ZIP=0 ;;
    *) echo "不支持的平台：$PLATFORM" >&2; exit 1 ;;
esac

URL="https://github.com/microsoft/onnxruntime/releases/download/v${VERSION}/${ARCHIVE}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
VENDOR_ROOT="${REPO_ROOT}/src-tauri/vendor/onnxruntime"
TARGET_DIR="${VENDOR_ROOT}/${PLATFORM}"
CACHE_DIR="${VENDOR_ROOT}/.cache"

# 幂等检查
for f in "${TARGET_DIR}/lib/libonnxruntime.so" \
         "${TARGET_DIR}/lib/libonnxruntime.dylib" \
         "${TARGET_DIR}/lib/onnxruntime.dll"; do
    if [[ -f "$f" && "$FORCE" -eq 0 ]]; then
        echo "[OK] 已存在：$f"
        echo "     如需重新下载，请加 --force 参数。"
        exit 0
    fi
done

mkdir -p "$CACHE_DIR"
ARCHIVE_PATH="${CACHE_DIR}/${ARCHIVE}"

if [[ ! -f "$ARCHIVE_PATH" || "$FORCE" -eq 1 ]]; then
    echo "[下载] $URL"
    if command -v curl >/dev/null; then
        curl -fL --retry 3 -o "$ARCHIVE_PATH" "$URL"
    elif command -v wget >/dev/null; then
        wget -O "$ARCHIVE_PATH" "$URL"
    else
        echo "需要 curl 或 wget" >&2; exit 1
    fi
else
    echo "[缓存] $ARCHIVE_PATH"
fi

# 解压
rm -rf "$TARGET_DIR"
TMP_DIR="${CACHE_DIR}/extract-$$"
mkdir -p "$TMP_DIR"
echo "[解压] -> $TARGET_DIR"
if [[ "$IS_ZIP" -eq 1 ]]; then
    if command -v unzip >/dev/null; then
        unzip -q "$ARCHIVE_PATH" -d "$TMP_DIR"
    else
        echo "需要 unzip" >&2; exit 1
    fi
else
    tar -xzf "$ARCHIVE_PATH" -C "$TMP_DIR"
fi

INNER=$(find "$TMP_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)
if [[ -z "$INNER" ]]; then
    echo "压缩包结构异常" >&2; exit 1
fi
mkdir -p "$(dirname "$TARGET_DIR")"
mv "$INNER" "$TARGET_DIR"
rm -rf "$TMP_DIR"

# 验证
FOUND=""
for f in "${TARGET_DIR}/lib/libonnxruntime.so" \
         "${TARGET_DIR}/lib/libonnxruntime.dylib" \
         "${TARGET_DIR}/lib/onnxruntime.dll"; do
    [[ -f "$f" ]] && FOUND="$f" && break
done
if [[ -z "$FOUND" ]]; then
    echo "解压后未找到 ONNX Runtime 动态库" >&2; exit 1
fi

echo
echo "[完成] 平台 : $PLATFORM"
echo "       版本 : $VERSION"
echo "       路径 : $FOUND"
