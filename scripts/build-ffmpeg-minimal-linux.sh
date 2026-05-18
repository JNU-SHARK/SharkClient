#!/usr/bin/env bash
# Build a minimal static FFmpeg (HEVC/H.264 decode + VAAPI/CUDA hwaccel)
# for SharkClientRustVersion on Linux x64.
#
# Output:
#   - ffmpeg              -> resources/ffmpeg/ffmpeg              (CLI binary, optional)
#   - libav*.a + headers  -> src-tauri/vendor/ffmpeg-static/linux-x64/{lib,include}
#                            (consumed by ffmpeg-next at compile time)
#
# Required system packages (Debian/Ubuntu):
#   sudo apt install -y build-essential nasm yasm pkg-config \
#                       libva-dev libdrm-dev
#
# Usage:
#   ./scripts/build-ffmpeg-minimal-linux.sh           # full build (libs + ffmpeg)
#   ./scripts/build-ffmpeg-minimal-linux.sh --libs    # static libs only

set -euo pipefail

LIBS_ONLY=0
FFMPEG_VERSION="${FFMPEG_VERSION:-7.1.1}"
for arg in "$@"; do
  case "$arg" in
    --libs|--libs-only) LIBS_ONLY=1 ;;
    --version=*) FFMPEG_VERSION="${arg#*=}" ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
WORK_DIR="${REPO_ROOT}/.ffmpeg-build-linux"
PREFIX="${WORK_DIR}/prefix"
SRC_DIR="${WORK_DIR}/ffmpeg-${FFMPEG_VERSION}"
TARBALL="${WORK_DIR}/ffmpeg-${FFMPEG_VERSION}.tar.xz"

VENDOR_DIR="${REPO_ROOT}/src-tauri/vendor/ffmpeg-static/linux-x64"
RES_DIR="${REPO_ROOT}/resources/ffmpeg"

mkdir -p "$WORK_DIR" "$PREFIX"

# ---------------------------------------------------------------------------
# 1. Source
# ---------------------------------------------------------------------------
if [ ! -f "$TARBALL" ]; then
  echo "==> Downloading FFmpeg ${FFMPEG_VERSION} source"
  for url in \
      "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" \
      "https://www.ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz"; do
    if curl -fL --retry 5 --retry-all-errors -o "$TARBALL" "$url"; then
      break
    fi
    rm -f "$TARBALL"
  done
  [ -s "$TARBALL" ] || { echo "Failed to download FFmpeg source"; exit 1; }
fi

if [ ! -d "$SRC_DIR" ]; then
  echo "==> Extracting"
  tar -xJf "$TARBALL" -C "$WORK_DIR"
fi

# ---------------------------------------------------------------------------
# 2. Configure
# ---------------------------------------------------------------------------
cd "$SRC_DIR"

CONFIGURE_FLAGS=(
  --prefix="${PREFIX}"
  --pkg-config-flags="--static"
  --extra-cflags="-fPIC"
  --disable-everything
  --disable-autodetect
  --disable-doc
  --disable-htmlpages
  --disable-manpages
  --disable-podpages
  --disable-txtpages
  --disable-debug
  --disable-iconv
  --disable-network
  --disable-avdevice
  --disable-postproc
  --disable-ffplay
  --disable-ffprobe
  --enable-static
  --disable-shared
  --enable-gpl
  --enable-small
  # Linux hardware-accelerated decode
  --enable-vaapi
  --enable-hwaccel=hevc_vaapi
  --enable-hwaccel=h264_vaapi
  # Software decoders + parsers
  --enable-decoder=hevc
  --enable-decoder=h264
  --enable-parser=hevc
  --enable-parser=h264
  # Raw bitstream IO
  --enable-demuxer=hevc
  --enable-demuxer=h264
  --enable-bsf=hevc_mp4toannexb
  --enable-bsf=h264_mp4toannexb
  # Y4M output (only needed if also building ffmpeg CLI)
  --enable-muxer=yuv4mpegpipe
  --enable-muxer=rawvideo
  --enable-encoder=rawvideo
  --enable-encoder=wrapped_avframe
  --enable-protocol=pipe
  --enable-protocol=file
  --enable-filter=hwdownload
  --enable-filter=hwupload
  --enable-filter=format
  --enable-filter=scale
  --enable-filter=null
  --enable-filter=copy
  --enable-filter=setpts
  --enable-swscale
)

if [ $LIBS_ONLY -eq 1 ]; then
  CONFIGURE_FLAGS+=(--disable-programs)
fi

if [ ! -f ffbuild/config.mak ] || [ ! -f .last-configure ] || \
   [ "$(cat .last-configure 2>/dev/null)" != "${CONFIGURE_FLAGS[*]}" ]; then
  echo "==> Running configure"
  ./configure "${CONFIGURE_FLAGS[@]}"
  echo "${CONFIGURE_FLAGS[*]}" > .last-configure
else
  echo "==> Reusing existing configure (delete $SRC_DIR to force re-config)"
fi

# ---------------------------------------------------------------------------
# 3. Build + install
# ---------------------------------------------------------------------------
echo "==> Building (this can take a few minutes)"
make -j"$(nproc)"
make install

# ---------------------------------------------------------------------------
# 4. Export
# ---------------------------------------------------------------------------
echo "==> Exporting static libs to $VENDOR_DIR"
rm -rf "$VENDOR_DIR"
mkdir -p "$VENDOR_DIR"
cp -r "$PREFIX/include" "$VENDOR_DIR/"
cp -r "$PREFIX/lib"     "$VENDOR_DIR/"
# Strip pkg-config (paths reference build host).
rm -rf "$VENDOR_DIR/lib/pkgconfig"
LIB_COUNT=$(ls "$VENDOR_DIR/lib/"*.a 2>/dev/null | wc -l)
echo "  exported $LIB_COUNT static libs (.a)"

if [ $LIBS_ONLY -eq 0 ]; then
  echo "==> Installing ffmpeg CLI -> $RES_DIR/ffmpeg"
  mkdir -p "$RES_DIR"
  cp -f "$PREFIX/bin/ffmpeg" "$RES_DIR/ffmpeg"
  strip "$RES_DIR/ffmpeg" 2>/dev/null || true
  ls -lh "$RES_DIR/ffmpeg"
fi

echo "==> Done."
