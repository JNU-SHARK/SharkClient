#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

APP_ID="com.jnushark.SharkClient"
RUNTIME="org.gnome.Platform"
SDK="org.gnome.Sdk"
RUNTIME_VERSION="${FLATPAK_RUNTIME_VERSION:-50}"
MANIFEST="flatpak/$APP_ID.yml"
GENERATED_MANIFEST="flatpak/$APP_ID.generated.yml"
BUILD_DIR="build-flatpak/build"
REPO_DIR="build-flatpak/repo"
BUNDLE="build-flatpak/SharkClient-Linux-Flatpak.flatpak"
LITE_TGZ="build-lite/SharkClient-Linux-Ubuntu22.04.tar.gz"

if ! command -v flatpak >/dev/null 2>&1; then
  echo "flatpak is required. On Ubuntu: sudo apt install flatpak flatpak-builder" >&2
  exit 1
fi

if ! command -v flatpak-builder >/dev/null 2>&1; then
  echo "flatpak-builder is required. On Ubuntu: sudo apt install flatpak-builder" >&2
  exit 1
fi

if ! flatpak remotes --system | awk '{print $1}' | grep -qx flathub; then
  flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
fi

if ! flatpak info "$RUNTIME//$RUNTIME_VERSION" >/dev/null 2>&1; then
  flatpak install -y --noninteractive --no-related flathub "$RUNTIME//$RUNTIME_VERSION"
fi

if ! flatpak info "$SDK//$RUNTIME_VERSION" >/dev/null 2>&1; then
  flatpak install -y --noninteractive --no-related flathub "$SDK//$RUNTIME_VERSION"
fi

if [ ! -f "$LITE_TGZ" ]; then
  echo "[flatpak] lite tarball missing, building Ubuntu 22.04 package first"
  SKIP_DEPS="${SKIP_DEPS:-1}" \
    DISTRO_TAG=Ubuntu22.04 \
    DISTRO_LABEL="Ubuntu 22.04 x86_64" \
    GLIBC_REQUIREMENT="glibc >= 2.35" \
    VARIANT=gpu \
    bash scripts/build-linux-client.sh
fi

rm -rf "$BUILD_DIR"
mkdir -p build-flatpak
sed "s/^runtime-version:.*/runtime-version: \"$RUNTIME_VERSION\"/" "$MANIFEST" > "$GENERATED_MANIFEST"

flatpak-builder \
  --force-clean \
  --repo="$REPO_DIR" \
  "$BUILD_DIR" \
  "$GENERATED_MANIFEST"

flatpak build-bundle "$REPO_DIR" "$BUNDLE" "$APP_ID"

echo "Flatpak bundle created:"
echo "  $BUNDLE"
du -sh "$BUNDLE" 2>/dev/null || true
