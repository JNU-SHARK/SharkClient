#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# One-shot setup + build for SharkClientRustVersion on Ubuntu 22.04.
# Produces:
#   src-tauri/target/release/SharkClientRustVersion     (Linux ELF binary)
#   dist/                                               (compiled frontend)
#   build-lite/SharkClient-Linux*.tar.gz                 (packaged distribution)
#
# Usage:
#   bash scripts/build-linux-client.sh                  # full build + package (GPU)
#   VARIANT=cpu bash scripts/build-linux-client.sh      # CPU-only variant
#   SKIP_DEPS=1 bash scripts/build-linux-client.sh      # skip apt install step
#
# Assumes Ubuntu 22.04 (Jammy). On WSL this works out of the box; on a CI
# box ensure sudo is available (apt install requires root).
# ---------------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

VARIANT="${VARIANT:-gpu}"                       # gpu | cpu
SKIP_DEPS="${SKIP_DEPS:-0}"
FFMPEG_URL_LINUX="https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-linux64-gpl-shared.tar.xz"

echo "[linux] variant=$VARIANT"

# ---------------------------------------------------------------------------
# 1. System dependencies (Tauri 2 + WebKitGTK 4.1 on Jammy)
# ---------------------------------------------------------------------------
if [ "$SKIP_DEPS" != "1" ]; then
  echo "[linux] installing apt packages (sudo required)"
  sudo apt-get update
  sudo apt-get install -y --no-install-recommends \
      build-essential curl wget file pkg-config xz-utils tar \
      libssl-dev libayatana-appindicator3-dev \
      libwebkit2gtk-4.1-dev libsoup-3.0-dev \
      libjavascriptcoregtk-4.1-dev \
      librsvg2-dev libgtk-3-dev libglib2.0-dev \
      ca-certificates git
fi

# ---------------------------------------------------------------------------
# 2. Rust toolchain
# ---------------------------------------------------------------------------
if ! command -v cargo >/dev/null 2>&1; then
  echo "[linux] installing rustup"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi
export PATH="$HOME/.cargo/bin:$PATH"
rustc --version
cargo --version

# ---------------------------------------------------------------------------
# 3. Node toolchain (Tauri needs npm for beforeBuildCommand)
# ---------------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "[linux] installing node 20.x"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node --version
npm --version

# ---------------------------------------------------------------------------
# 4. Download Linux ffmpeg shared build (mirror Windows resources layout)
# ---------------------------------------------------------------------------
LINUX_FFMPEG_DIR="resources/ffmpeg-linux"
if [ ! -x "$LINUX_FFMPEG_DIR/ffmpeg" ]; then
  echo "[linux] downloading ffmpeg shared"
  TMP_XZ="/tmp/ffmpeg-linux.tar.xz"
  wget -q -O "$TMP_XZ" "$FFMPEG_URL_LINUX"
  TMP_EXTRACT="/tmp/ffmpeg-linux-extract"
  rm -rf "$TMP_EXTRACT"; mkdir -p "$TMP_EXTRACT"
  tar -xJf "$TMP_XZ" -C "$TMP_EXTRACT"
  FFMPEG_ROOT="$(find "$TMP_EXTRACT" -maxdepth 1 -mindepth 1 -type d | head -1)"
  rm -rf "$LINUX_FFMPEG_DIR"
  mkdir -p "$LINUX_FFMPEG_DIR/bin" "$LINUX_FFMPEG_DIR/lib"
  cp "$FFMPEG_ROOT/bin/ffmpeg" "$LINUX_FFMPEG_DIR/ffmpeg"
  # BtbN Linux shared build uses RPATH=$ORIGIN/../lib, so *.so.* must live at
  # LINUX_FFMPEG_DIR/lib relative to the ffmpeg binary. We keep the binary at
  # repo root of the ffmpeg dir for compatibility with Linux candidate search.
  cp -a "$FFMPEG_ROOT/lib/"*.so* "$LINUX_FFMPEG_DIR/lib/" 2>/dev/null || true
  chmod +x "$LINUX_FFMPEG_DIR/ffmpeg"
  # Patch runpath so the binary finds sibling DLLs regardless of install dir.
  if command -v patchelf >/dev/null 2>&1; then
    patchelf --set-rpath '$ORIGIN/lib' "$LINUX_FFMPEG_DIR/ffmpeg" || true
  fi
fi

# ---------------------------------------------------------------------------
# 5. Frontend + Rust release build (Tauri)
# ---------------------------------------------------------------------------
echo "[linux] npm ci"
npm ci --no-audit --no-fund

echo "[linux] tauri build (release, features=lite, --no-bundle)"
# --no-bundle skips .deb/.rpm/.AppImage generation (we do our own tarball below)
CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$REPO_ROOT/src-tauri/target}" \
  npm run tauri -- build --no-bundle --features lite

BIN="$REPO_ROOT/src-tauri/target/release/SharkClientRustVersion"
if [ ! -x "$BIN" ]; then
  echo "[linux] ERROR: binary not found at $BIN" >&2
  exit 1
fi
ls -la "$BIN"

# ---------------------------------------------------------------------------
# 6. Package
# ---------------------------------------------------------------------------
bash "$REPO_ROOT/scripts/package-lite-linux.sh" "$VARIANT"
