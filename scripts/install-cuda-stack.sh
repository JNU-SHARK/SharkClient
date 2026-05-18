#!/usr/bin/env bash
# install-cuda-stack.sh
# ------------------------------------------------------------
# Linux 端 GPU 依赖栈安装 / 验证脚本（对应 install-cuda-stack.ps1）。
#
# 覆盖：NVIDIA 驱动 / CUDA 12.x / cuDNN 9.x / TensorRT 10.x
#
# 用法：
#   ./scripts/install-cuda-stack.sh verify          # 仅检查
#   ./scripts/install-cuda-stack.sh install-cuda    # 打印官方安装指引（不自动 apt，避免误动系统）
#   ./scripts/install-cuda-stack.sh install-cudnn
#   ./scripts/install-cuda-stack.sh install-trt
#   ./scripts/install-cuda-stack.sh all             # 打印全部指引
#
# 设计原则：
#   - 对生产环境，驱动/CUDA 安装过于敏感，脚本默认只做检测 + 指引，
#     不代替用户执行 apt/dnf 安装（避免把工作机打坏）。
#   - 如需全自动，设置 SHARK_AUTO_APT=1 后脚本会尝试 apt 安装。
# ------------------------------------------------------------
set -euo pipefail

STEP="${1:-verify}"
AUTO_APT="${SHARK_AUTO_APT:-0}"

log()   { printf '[install-cuda-stack] %s\n' "$*"; }
warn()  { printf '\033[33m[install-cuda-stack] WARN: %s\033[0m\n' "$*" >&2; }
err()   { printf '\033[31m[install-cuda-stack] ERR : %s\033[0m\n' "$*" >&2; }

detect_distro() {
    if [[ -f /etc/os-release ]]; then
        . /etc/os-release
        echo "${ID:-unknown}"
    else
        echo unknown
    fi
}

verify_driver() {
    if command -v nvidia-smi >/dev/null 2>&1; then
        local ver
        ver=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader | head -n1 | tr -d ' \r')
        log "NVIDIA driver  : OK (${ver})"
        return 0
    fi
    warn "NVIDIA driver  : not found (nvidia-smi missing)"
    return 1
}

verify_cuda() {
    local nvcc
    nvcc=$(command -v nvcc || true)
    if [[ -z "$nvcc" && -x /usr/local/cuda/bin/nvcc ]]; then
        nvcc=/usr/local/cuda/bin/nvcc
    fi
    if [[ -n "$nvcc" ]]; then
        local ver
        ver=$("$nvcc" --version | grep -oE 'release [0-9]+\.[0-9]+' | head -n1 | awk '{print $2}')
        log "CUDA toolkit   : OK (${ver}, ${nvcc})"
        return 0
    fi
    warn "CUDA toolkit   : not found (nvcc missing, checked /usr/local/cuda)"
    return 1
}

verify_cudnn() {
    local hits
    hits=$(ldconfig -p 2>/dev/null | awk '/libcudnn\.so(\.[0-9]+)?$/ {print $NF}' | sort -u || true)
    if [[ -z "$hits" ]]; then
        hits=$(find /usr/lib /usr/local -maxdepth 5 -name 'libcudnn.so*' 2>/dev/null | head -n5 || true)
    fi
    if [[ -n "$hits" ]]; then
        log "cuDNN          : OK"
        printf '%s\n' "$hits" | sed 's/^/                 /'
        return 0
    fi
    warn "cuDNN          : not found (searched ldconfig cache + /usr/{lib,local})"
    return 1
}

verify_tensorrt() {
    local hits
    hits=$(ldconfig -p 2>/dev/null | awk '/libnvinfer\.so(\.[0-9]+)?$/ {print $NF}' | sort -u || true)
    if [[ -z "$hits" ]]; then
        hits=$(find /usr/lib /usr/local /opt -maxdepth 6 -name 'libnvinfer.so*' 2>/dev/null | head -n5 || true)
    fi
    if [[ -n "$hits" ]]; then
        log "TensorRT       : OK"
        printf '%s\n' "$hits" | sed 's/^/                 /'
        return 0
    fi
    warn "TensorRT       : not found (libnvinfer.so missing)"
    return 1
}

verify_all() {
    local ok=0 fail=0
    for fn in verify_driver verify_cuda verify_cudnn verify_tensorrt; do
        if $fn; then ok=$((ok+1)); else fail=$((fail+1)); fi
    done
    echo
    log "Summary: ${ok} ok / ${fail} missing"
    if [[ $fail -gt 0 ]]; then
        echo
        log "下一步建议："
        log "  缺 driver/CUDA : ./scripts/install-cuda-stack.sh install-cuda"
        log "  缺 cuDNN       : ./scripts/install-cuda-stack.sh install-cudnn"
        log "  缺 TensorRT    : ./scripts/install-cuda-stack.sh install-trt"
        return 1
    fi
    return 0
}

print_cuda_guide() {
    local distro; distro=$(detect_distro)
    cat <<EOF

===== CUDA 12.x 安装指引（distro=${distro}）=====

推荐使用 NVIDIA 官方源（比发行版自带更新、更稳）：
  https://developer.nvidia.com/cuda-downloads

【Ubuntu 22.04 / 24.04】
  wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu\$(lsb_release -rs | tr -d .)/x86_64/cuda-keyring_1.1-1_all.deb
  sudo dpkg -i cuda-keyring_1.1-1_all.deb
  sudo apt update
  sudo apt install -y cuda-toolkit-12-8 nvidia-driver-575-open

【RHEL / Rocky / CentOS Stream 9】
  sudo dnf config-manager --add-repo https://developer.download.nvidia.com/compute/cuda/repos/rhel9/x86_64/cuda-rhel9.repo
  sudo dnf install -y cuda-toolkit-12-8

安装完成后：
  echo 'export PATH=/usr/local/cuda/bin:\$PATH' >> ~/.bashrc
  echo 'export LD_LIBRARY_PATH=/usr/local/cuda/lib64:\$LD_LIBRARY_PATH' >> ~/.bashrc

EOF
}

print_cudnn_guide() {
    cat <<'EOF'

===== cuDNN 9.x 安装指引 =====

必须与 CUDA 主版本匹配（CUDA 12.x -> cuDNN 9.x-cuda12）。

【Ubuntu】
  sudo apt install -y libcudnn9-cuda-12 libcudnn9-dev-cuda-12

【RHEL / Rocky】
  sudo dnf install -y libcudnn9-cuda-12 libcudnn9-devel-cuda-12

手动下载（需 NVIDIA 开发者账号）：
  https://developer.nvidia.com/cudnn-downloads

验证：
  ldconfig -p | grep libcudnn

EOF
}

print_trt_guide() {
    cat <<'EOF'

===== TensorRT 10.x 安装指引 =====

【Ubuntu 官方源（推荐）】
  sudo apt install -y tensorrt libnvinfer10 libnvinfer-plugin10

【tar 包方式（适合离线 / 精确版本）】
  1. 从 https://developer.nvidia.com/tensorrt 下载 TensorRT-10.x.tar.gz（需账号）
  2. tar -xzf TensorRT-10.*.tar.gz -C /opt
  3. echo 'export LD_LIBRARY_PATH=/opt/TensorRT-10.x/lib:$LD_LIBRARY_PATH' >> ~/.bashrc
  4. echo 'export PATH=/opt/TensorRT-10.x/bin:$PATH' >> ~/.bashrc

验证：
  ldconfig -p | grep libnvinfer
  trtexec --help 2>&1 | head

EOF
}

auto_apt_install_cuda() {
    if [[ "$AUTO_APT" != "1" ]]; then
        print_cuda_guide
        return 0
    fi
    local distro; distro=$(detect_distro)
    case "$distro" in
        ubuntu|debian)
            log "Auto apt install (SHARK_AUTO_APT=1) ..."
            sudo apt update
            sudo apt install -y nvidia-cuda-toolkit
            ;;
        *) warn "Auto-install only supports Ubuntu/Debian. distro=${distro}"; print_cuda_guide ;;
    esac
}

case "$STEP" in
    verify)        verify_all ;;
    install-cuda)  auto_apt_install_cuda ;;
    install-cudnn) print_cudnn_guide ;;
    install-trt)   print_trt_guide ;;
    all)
        print_cuda_guide
        print_cudnn_guide
        print_trt_guide
        ;;
    -h|--help)
        grep '^# ' "$0" | sed 's/^# \{0,1\}//'
        ;;
    *)
        err "Unknown step: $STEP"
        echo "Usage: $0 {verify|install-cuda|install-cudnn|install-trt|all}"
        exit 2
        ;;
esac
