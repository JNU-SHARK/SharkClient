#!/usr/bin/env bash
# Package a Linux lite distribution (tarball) — mirrors scripts/package-lite.ps1.
# Output: build-lite/SharkClient-Linux[-<DISTRO_TAG>][-cpu].tar.gz
#
# Layout inside the tarball:
#   SharkClient-Linux/
#     SharkClientRustVersion             (ELF binary)
#     resources/                         (yaml configs, robot assets, fonts)
#     resources/ffmpeg/ffmpeg            (symlinked below from resources/ffmpeg-linux/ffmpeg)
#     resources/ffmpeg/lib/*.so*
#     AI Server/server/{Server.py,pipe_server.py}
#     AI Server/model/{armor.onnx,car.onnx}
#     install-env.sh                      (runtime + Python AI env installer)
#     run.sh                             (launcher: sets LD_LIBRARY_PATH)
#     README.txt                         (中文说明)
set -euo pipefail

VARIANT="${1:-gpu}"
DISTRO_TAG="${DISTRO_TAG:-}"
DISTRO_LABEL="${DISTRO_LABEL:-Ubuntu 22.04 x86_64}"
GLIBC_REQUIREMENT="${GLIBC_REQUIREMENT:-glibc >= 2.35}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

BIN_SRC="src-tauri/target/release/SharkClientRustVersion"
RESOURCES_SRC="resources"
FFMPEG_LINUX_SRC="resources/ffmpeg-linux"
PIPE_SCRIPT_SRC="scripts/detection_pipe_server.py"
ENV_INSTALL_SCRIPT_SRC="scripts/install-lite-env.sh"
AI_SERVER_PY_SRC="AI Server/server/Server.py"
AI_PIPE_SERVER_PY_SRC="AI Server/server/pipe_server.py"
AI_REQUIREMENTS_SRC="AI Server/requirements.txt"
ARMOR_MODEL_SRC="AI Server/model/armor.onnx"
CAR_MODEL_SRC="AI Server/model/car.onnx"

if [ "$VARIANT" = "cpu" ]; then
  PKG_NAME="SharkClient-Linux${DISTRO_TAG:+-$DISTRO_TAG}-cpu"
  VARIANT_ZH="纯 CPU 版"
else
  PKG_NAME="SharkClient-Linux${DISTRO_TAG:+-$DISTRO_TAG}"
  VARIANT_ZH="GPU (CUDA) 版"
fi

OUT_DIR="build-lite/$PKG_NAME"
TGZ="build-lite/$PKG_NAME.tar.gz"

[ -x "$BIN_SRC" ] || { echo "binary missing: $BIN_SRC"; exit 1; }
[ -d "$RESOURCES_SRC" ] || { echo "resources missing"; exit 1; }
[ -f "dist/index.html" ] || { echo "dist/index.html missing — run 'npm run build' first"; exit 1; }
for required in "$PIPE_SCRIPT_SRC" "$ENV_INSTALL_SCRIPT_SRC" "$AI_SERVER_PY_SRC" "$AI_PIPE_SERVER_PY_SRC" "$AI_REQUIREMENTS_SRC" "$ARMOR_MODEL_SRC" "$CAR_MODEL_SRC"; do
  [ -f "$required" ] || { echo "required packaging asset missing: $required"; exit 1; }
done
[ -x "$FFMPEG_LINUX_SRC/ffmpeg" ] || {
  echo "linux ffmpeg missing: $FFMPEG_LINUX_SRC/ffmpeg"
  echo "run scripts/build-linux-client.sh once with network access, or provide resources/ffmpeg-linux/ffmpeg"
  exit 1
}

mkdir -p build-lite
rm -rf "$OUT_DIR" "$TGZ"
mkdir -p "$OUT_DIR"
mkdir -p "$OUT_DIR/Cache"

# --- Binary
cp "$BIN_SRC" "$OUT_DIR/"
chmod +x "$OUT_DIR/SharkClientRustVersion"

# --- Resources (copy whole tree; package-lite.ps1 equivalent)
cp -a "$RESOURCES_SRC" "$OUT_DIR/resources"

# --- External AI detector assets. Keep this layout aligned with the runtime
# resolver path `AI Server`, used by Dashboard/Settings auto-start.
mkdir -p "$OUT_DIR/scripts" "$OUT_DIR/AI Server/server" "$OUT_DIR/AI Server/model"
cp "$PIPE_SCRIPT_SRC" "$OUT_DIR/scripts/detection_pipe_server.py"
cp "$ENV_INSTALL_SCRIPT_SRC" "$OUT_DIR/scripts/install-lite-env.sh"
cp "$AI_SERVER_PY_SRC" "$OUT_DIR/AI Server/server/Server.py"
cp "$AI_PIPE_SERVER_PY_SRC" "$OUT_DIR/AI Server/server/pipe_server.py"
cp "$AI_REQUIREMENTS_SRC" "$OUT_DIR/AI Server/requirements.txt"
cp "$ARMOR_MODEL_SRC" "$OUT_DIR/AI Server/model/armor.onnx"
cp "$CAR_MODEL_SRC" "$OUT_DIR/AI Server/model/car.onnx"

# The Windows tree carries resources/ffmpeg/ffmpeg.exe. For Linux we prefer
# the shared-library BtbN build which lives at resources/ffmpeg-linux. Move
# it into the canonical candidate path resources/ffmpeg/ inside the bundle.
if [ -d "$OUT_DIR/resources/ffmpeg-linux" ]; then
  rm -rf "$OUT_DIR/resources/ffmpeg"
  mv "$OUT_DIR/resources/ffmpeg-linux" "$OUT_DIR/resources/ffmpeg"
elif [ -d "$FFMPEG_LINUX_SRC" ]; then
  rm -rf "$OUT_DIR/resources/ffmpeg"
  cp -a "$FFMPEG_LINUX_SRC" "$OUT_DIR/resources/ffmpeg"
fi

# --- Launcher
if [ "$VARIANT" = "cpu" ]; then
  FORCE_CPU_LINE='export ONNX_PROVIDER=cpu'
  CPU_HINT='  * 已自动设置 ONNX_PROVIDER=cpu，强制外置 AI 检测脚本使用 CPU Provider。'
else
  FORCE_CPU_LINE=''
  CPU_HINT=''
fi

cat > "$OUT_DIR/run.sh" <<EOF
#!/usr/bin/env bash
# Launcher for SharkClientRustVersion (Linux lite).
# - Prepends bundled ffmpeg libraries to LD_LIBRARY_PATH.
# - AI inference runs in the external Python service under AI Server/.

set -eu
HERE="\$(cd "\$(dirname "\$0")" && pwd)"
export LD_LIBRARY_PATH="\$HERE:\$HERE/resources/ffmpeg/lib:\${LD_LIBRARY_PATH:-}"
export SHARK_CACHE_DIR="\$HERE/Cache"
export TMPDIR="\$HERE/Cache"
$FORCE_CPU_LINE
exec "\$HERE/SharkClientRustVersion" "\$@"
EOF
chmod +x "$OUT_DIR/run.sh"

cat > "$OUT_DIR/install-env.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
HERE="\$(cd "\$(dirname "\$0")" && pwd)"
bash "\$HERE/scripts/install-lite-env.sh" "$VARIANT"
EOF
chmod +x "$OUT_DIR/install-env.sh" "$OUT_DIR/scripts/install-lite-env.sh"

# --- README (中文)
cat > "$OUT_DIR/README.txt" <<EOF
SharkClientRustVersion（轻量化发行包 · Linux · $VARIANT_ZH）
===============================================================

运行要求
--------
* $DISTRO_LABEL（或兼容的 $GLIBC_REQUIREMENT 发行版）
* libwebkit2gtk-4.1-0, libgtk-3-0, libayatana-appindicator3-1, ffmpeg
  安装命令：
    sudo apt update
    sudo apt install -y libwebkit2gtk-4.1-0 libgtk-3-0 \\
        libayatana-appindicator3-1 librsvg2-2 ffmpeg
* GPU 版额外需要：
    如需 GPU AI 推理，请在 Python 环境中安装匹配驱动的
    onnxruntime-gpu / CUDA / cuDNN 依赖。

首次运行
--------
  1. 解压：  tar -xzf $PKG_NAME.tar.gz
  2. 进入：  cd $PKG_NAME
  3. 首次使用前安装运行环境：  ./install-env.sh
  4. 启动：  ./run.sh
$CPU_HINT

AI 检测
-------
* AI 检测服务默认不会随客户端启动；主界面启用 AI 检测时会自动启动
  AI Server/server/pipe_server.py，也可在设置页手动启动。
* 发行包内包含：
    - scripts/detection_pipe_server.py
    - AI Server/server/Server.py
    - AI Server/server/pipe_server.py
    - AI Server/model/armor.onnx
    - AI Server/model/car.onnx
* 首次使用 AI 检测前，请运行 ./install-env.sh。脚本会安装 Ubuntu 运行库、
  在发行包根目录创建 .venv，并安装 requirements.txt 中的 Python 依赖，
  不写入全局 Python 环境。

内置依赖
--------
* ffmpeg 启动器位于 resources/ffmpeg/ffmpeg；Ubuntu 22 版使用系统
  ffmpeg 共享库依赖，若提示缺少 libav*.so，请安装上方 ffmpeg 包。
* AI 推理由外置 Python 脚本负责，客户端进程不再内置 ONNX Runtime。

环境变量（可选）
----------------
  ONNX_PROVIDER=cpu    强制外置 AI 检测脚本使用 CPU Provider。
  SHARK_FFMPEG_PATH=…  覆盖 ffmpeg 路径（默认使用包内 resources/ffmpeg/ffmpeg）。
EOF

cat >> "$OUT_DIR/README.txt" <<'EOF'

Cache
-----
Runtime settings, WebKit/localStorage, logs and install caches are stored under
the package root Cache/ folder. Delete Cache/ to reset only this extracted
package; old system cache directories are not used.
EOF

# --- Archive (tar.gz; users extract anywhere and run ./run.sh)
tar -czf "$TGZ" -C "build-lite" "$PKG_NAME"

echo "Lite package created ($VARIANT, linux):"
echo "  Dir: $OUT_DIR"
echo "  Tgz: $TGZ"
du -sh "$OUT_DIR" "$TGZ" 2>/dev/null || true
