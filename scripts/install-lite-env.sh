#!/usr/bin/env bash
set -euo pipefail

VARIANT="${1:-auto}" # auto | gpu | cpu
SKIP_SYSTEM="${SKIP_SYSTEM:-0}"
PIP_INDEX_URL="${PIP_INDEX_URL:-}"
APT_UPDATED="${APT_UPDATED:-0}"

log() { printf '[install-env] %s\n' "$*"; }
warn() { printf '\033[33m[install-env] WARN: %s\033[0m\n' "$*" >&2; }
die() { printf '\033[31m[install-env] ERR : %s\033[0m\n' "$*" >&2; exit 1; }

run_as_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    die "Root permission is required. Please install sudo or run this script as root."
  fi
}

apt_install() {
  command -v apt-get >/dev/null 2>&1 || return 1
  if [[ "$APT_UPDATED" != "1" ]]; then
    log "apt update"
    run_as_root apt-get update
    APT_UPDATED=1
  fi
  log "apt install: $*"
  run_as_root apt-get install -y --no-install-recommends "$@"
}

ensure_python3() {
  if command -v python3 >/dev/null 2>&1; then
    return
  fi
  if command -v apt-get >/dev/null 2>&1; then
    apt_install python3 python3-venv python3-pip
  fi
  command -v python3 >/dev/null 2>&1 || die "python3 not found and automatic install failed."
}

ensure_runtime_packages() {
  command -v apt-get >/dev/null 2>&1 || {
    warn "apt-get not found; please install WebKitGTK, GTK, ffmpeg, python3-venv and python3-pip manually."
    return
  }

  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    source /etc/os-release
    if [[ "${ID:-}" == "ubuntu" ]] && command -v dpkg >/dev/null 2>&1; then
      if dpkg --compare-versions "${VERSION_ID:-0}" lt 22.04; then
        die "This Linux package requires Ubuntu 22.04+ (WebKitGTK 4.1/libsoup3). Ubuntu ${VERSION_ID:-unknown} needs a separate compatibility build."
      fi
    fi
  fi

  local packages=(
    libwebkit2gtk-4.1-0
    libgtk-3-0
    libayatana-appindicator3-1
    librsvg2-2
    ffmpeg
    python3
    python3-venv
    python3-pip
    ca-certificates
  )

  if ! apt_install "${packages[@]}"; then
    die "Failed to install runtime packages. This build needs libwebkit2gtk-4.1-0 and libsoup3; WebKitGTK 4.0 is not compatible with the current Tauri build."
  fi
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -d "$script_dir/AI Server" ]]; then
  bundle_root="$script_dir"
else
  bundle_root="$(cd "$script_dir/.." && pwd)"
fi

ai_root="$bundle_root/AI Server"
requirements="$ai_root/requirements.txt"
venv_dir="$bundle_root/.venv"
venv_python="$venv_dir/bin/python"
cache_dir="$bundle_root/Cache"
install_cache_dir="$cache_dir/install"
mkdir -p "$install_cache_dir"
export SHARK_CACHE_DIR="$cache_dir"
export TMPDIR="$install_cache_dir"
export PIP_CACHE_DIR="$cache_dir/pip"
export PYTHONPYCACHEPREFIX="$cache_dir/pycache"

if [[ "$VARIANT" == "auto" ]]; then
  if [[ "${ONNX_PROVIDER:-}" == "cpu" ]]; then
    resolved_variant="cpu"
  else
    resolved_variant="gpu"
  fi
else
  resolved_variant="$VARIANT"
fi

case "$resolved_variant" in
  gpu|cpu) ;;
  *) echo "Usage: $0 {auto|gpu|cpu}" >&2; exit 2 ;;
esac

[[ -f "$requirements" ]] || { echo "requirements.txt not found: $requirements" >&2; exit 1; }

log "root=$bundle_root"
log "variant=$resolved_variant"
log "cache=$cache_dir"

if [[ "$SKIP_SYSTEM" != "1" ]]; then
  ensure_runtime_packages
fi

ensure_python3

if [[ ! -x "$venv_python" ]]; then
  log "creating venv: $venv_dir"
  if ! python3 -m venv "$venv_dir"; then
    if command -v apt-get >/dev/null 2>&1; then
      apt_install python3-venv
      python3 -m venv "$venv_dir"
    else
      die "Failed to create Python virtual environment."
    fi
  fi
else
  log "using existing venv: $venv_dir"
fi

log "installing Python packages"
if ! "$venv_python" -m pip install --upgrade pip setuptools wheel; then
  warn "pip upgrade failed, retrying with Tsinghua PyPI mirror..."
  "$venv_python" -m pip install --upgrade pip setuptools wheel -i https://pypi.tuna.tsinghua.edu.cn/simple
fi

tmp_req="$(mktemp)"
trap 'rm -f "$tmp_req"' EXIT
if [[ "$resolved_variant" == "cpu" ]]; then
  awk '
    /^[[:space:]]*onnxruntime-gpu[[:space:]=<>!~]*/ { print "onnxruntime==1.23.2"; next }
    { print }
  ' "$requirements" > "$tmp_req"
else
  cp "$requirements" "$tmp_req"
fi

pip_args=(-m pip install -r "$tmp_req")
if [[ -n "$PIP_INDEX_URL" ]]; then
  pip_args+=(-i "$PIP_INDEX_URL")
fi
if ! "$venv_python" "${pip_args[@]}"; then
  if [[ -z "$PIP_INDEX_URL" ]]; then
    warn "pip install failed, retrying with Tsinghua PyPI mirror..."
    "$venv_python" "${pip_args[@]}" -i https://pypi.tuna.tsinghua.edu.cn/simple
  else
    die "Failed to install Python dependencies."
  fi
fi

log "verifying Python dependencies"
"$venv_python" - <<'PY'
import numpy
import cv2
import PIL
import onnxruntime as ort
print("onnxruntime providers:", ort.get_available_providers())
PY

chmod +x "$bundle_root/run.sh" "$bundle_root/SharkClientRustVersion" 2>/dev/null || true
chmod +x "$bundle_root/resources/ffmpeg/ffmpeg" 2>/dev/null || true

log "done. Start the client with ./run.sh"
