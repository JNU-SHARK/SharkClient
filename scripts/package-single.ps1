<#
.SYNOPSIS
  Package the "Single" distribution: a self-contained build that uses the
  in-process libavcodec HEVC decoder (Cargo feature: internal-ffmpeg) and
  therefore ships WITHOUT a separate ffmpeg.exe binary.

.NOTES
  - Requires `cargo build --release --features internal-ffmpeg` to have run.
  - GPU variant ships CUDA EP plus the TensorRT EP bootstrap DLL.
  - CPU variant forces SHARK_FORCE_CPU=1 via run.bat.
#>
[CmdletBinding()]
param(
  [ValidateSet('gpu','cpu')]
  [string]$Variant = 'gpu'
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$exeName = 'SharkClientRustVersion.exe'

$singleName = if ($Variant -eq 'cpu') {
  'SharkClientRustVersion-single-cpu'
} else {
  'SharkClientRustVersion-single'
}

$releaseExe   = Join-Path $repoRoot "src-tauri\target\release\$exeName"
$resourcesDir = Join-Path $repoRoot 'resources'
$hevcInstallScript = Join-Path $repoRoot 'scripts\install-hevc-webcodecs.ps1'
$buildLiteDir = Join-Path $repoRoot 'build-lite'
$outputDir    = Join-Path $buildLiteDir $singleName
$zipPath      = Join-Path $buildLiteDir "$singleName.zip"

if (-not (Test-Path -LiteralPath $releaseExe)) {
  throw "Release executable not found: $releaseExe (did you run 'npm run build:single' first?)"
}
if (-not (Test-Path -LiteralPath $resourcesDir)) {
  throw "Resources directory not found: $resourcesDir"
}
if (-not (Test-Path -LiteralPath $hevcInstallScript)) {
  throw "HEVC install helper not found: $hevcInstallScript"
}

$distIndex = Join-Path $repoRoot 'dist\index.html'
if (-not (Test-Path -LiteralPath $distIndex)) {
  throw "dist/index.html is missing. Run 'npm run build:single' (which goes through 'tauri build')."
}

New-Item -ItemType Directory -Path $buildLiteDir -Force | Out-Null

if (Test-Path -LiteralPath $outputDir) {
  try { Remove-Item -LiteralPath $outputDir -Recurse -Force } catch {
    $ts = Get-Date -Format 'yyyyMMdd-HHmmss'
    $outputDir = Join-Path $buildLiteDir "$singleName-$ts"
    $zipPath   = Join-Path $buildLiteDir "$singleName-$ts.zip"
    Write-Warning "Default single directory busy, packaging to fallback: $outputDir"
  }
}
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }

New-Item -ItemType Directory -Path $outputDir | Out-Null
New-Item -ItemType Directory -Path (Join-Path $outputDir 'Cache') | Out-Null

Copy-Item -LiteralPath $releaseExe -Destination (Join-Path $outputDir $exeName)

# Copy resources tree EXCEPT resources\ffmpeg (that bundle is the whole point
# of the "single" variant — we no longer ship ffmpeg.exe).
$destResources = Join-Path $outputDir 'resources'
New-Item -ItemType Directory -Path $destResources | Out-Null
Get-ChildItem -LiteralPath $resourcesDir -Force | Where-Object { $_.Name -ne 'ffmpeg' } | ForEach-Object {
  if ($_.PSIsContainer) {
    Copy-Item -LiteralPath $_.FullName -Destination $destResources -Recurse -Force
  } else {
    Copy-Item -LiteralPath $_.FullName -Destination $destResources -Force
  }
}

# ONNX Runtime DLLs next to the exe.
$ortVendorLib = Join-Path -Path $repoRoot -ChildPath 'src-tauri\vendor\onnxruntime\win-x64-gpu\lib'
Write-Host "[single] variant        = $Variant"
Write-Host "[single] ORT vendor lib = $ortVendorLib"
if (-not (Test-Path -LiteralPath $ortVendorLib)) {
  throw "ONNX Runtime vendor lib not found: $ortVendorLib (run scripts/download-onnxruntime.ps1 first)."
}
$ortDlls = @('onnxruntime.dll', 'onnxruntime_providers_shared.dll')
if ($Variant -eq 'gpu') {
  $ortDlls += @('onnxruntime_providers_cuda.dll', 'onnxruntime_providers_tensorrt.dll')
}
foreach ($n in $ortDlls) {
  $src = Join-Path $ortVendorLib $n
  if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination $outputDir }
  else { Write-Warning "ORT DLL missing (skipped): $src" }
}

$scriptsOut = Join-Path $outputDir 'scripts'
New-Item -ItemType Directory -Path $scriptsOut -Force | Out-Null
Copy-Item -LiteralPath $hevcInstallScript -Destination (Join-Path $scriptsOut 'install-hevc-webcodecs.ps1') -Force

Get-ChildItem -LiteralPath $outputDir -Recurse -File -ErrorAction SilentlyContinue |
  ForEach-Object { try { Unblock-File -LiteralPath $_.FullName -ErrorAction SilentlyContinue } catch {} }

# Launcher: also export SHARK_USE_INTERNAL_FFMPEG=1 so SmartDecoder picks
# the in-process decoder even if a stray ffmpeg.exe sits on PATH.
if ($Variant -eq 'cpu') {
  $launcher = @'
@echo off
pushd "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-ChildItem -LiteralPath '%~dp0' -Recurse -File | Unblock-File -ErrorAction SilentlyContinue"
set "SHARK_USE_INTERNAL_FFMPEG=1"
set "SHARK_FORCE_CPU=1"
start "" "%~dp0SharkClientRustVersion.exe"
popd
'@
} else {
  $launcher = @'
@echo off
pushd "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-ChildItem -LiteralPath '%~dp0' -Recurse -File | Unblock-File -ErrorAction SilentlyContinue"
set "SHARK_USE_INTERNAL_FFMPEG=1"
start "" "%~dp0SharkClientRustVersion.exe"
popd
'@
}
Set-Content -LiteralPath (Join-Path $outputDir 'run.bat') -Value $launcher -Encoding ASCII

$hevcLauncher = @'
@echo off
pushd "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-hevc-webcodecs.ps1"
pause
popd
'@
Set-Content -LiteralPath (Join-Path $outputDir 'install-hevc-webcodecs.bat') -Value $hevcLauncher -Encoding ASCII

if ($Variant -eq 'gpu') {
  $trtLauncher = @'
@echo off
pushd "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-ChildItem -LiteralPath '%~dp0' -Recurse -File | Unblock-File -ErrorAction SilentlyContinue"
set "SHARK_USE_INTERNAL_FFMPEG=1"
set "SHARK_ENABLE_TRT=1"
set "SHARK_TRT_DISABLE_INT8=1"
start "" "%~dp0SharkClientRustVersion.exe"
popd
'@
  Set-Content -LiteralPath (Join-Path $outputDir 'run-trt-fp32.bat') -Value $trtLauncher -Encoding ASCII

  $trtInt8Launcher = @'
@echo off
pushd "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-ChildItem -LiteralPath '%~dp0' -Recurse -File | Unblock-File -ErrorAction SilentlyContinue"
set "SHARK_USE_INTERNAL_FFMPEG=1"
set "SHARK_ENABLE_TRT=1"
set "SHARK_TRT_INT8=1"
start "" "%~dp0SharkClientRustVersion.exe"
popd
'@
  Set-Content -LiteralPath (Join-Path $outputDir 'run-trt-int8-experimental.bat') -Value $trtInt8Launcher -Encoding ASCII
}

$variantLabel = if ($Variant -eq 'cpu') { '纯 CPU 版' } else { 'GPU (CUDA) 版' }
$gpuRequirement = if ($Variant -eq 'gpu') {
@'
* NVIDIA 显卡 + CUDA 12.x 运行时 + cuDNN 9（CUDA EP 所需）。
* 如需 TensorRT 实验：额外安装匹配的 TensorRT 10.x 运行时。
'@
} else {
  '* 无需独立显卡，推理在 CPU 上运行。'
}
$trtLauncherHint = if ($Variant -eq 'gpu') {
@'
     默认 run.bat 走 CUDA，当前实测识别更稳、帧率也更高。
     run-trt-fp32.bat 仅用于 TensorRT FP32 对比测试。
     run-trt-int8-experimental.bat 仅用于 INT8 实验，当前模型可能漏检车辆。
'@
} else {
  ''
}
$trtEnvHint = if ($Variant -eq 'gpu') {
@'
  SHARK_ENABLE_TRT=1            启用 TensorRT EP（默认不启用 INT8）。
  SHARK_TRT_INT8=1              在 TensorRT EP 上启用 INT8 calibration cache；
                                当前模型可能漏检车辆，仅建议测试使用。
  SHARK_TRT_DISABLE_INT8=1      启用 TensorRT 但关闭 INT8 标定缓存。
'@
} else {
  ''
}

$readme = @"
SharkClientRustVersion（Single 单文件发行包 · $variantLabel）
=========================================================

与 lite 版的区别
----------------
* 不再附带 resources\ffmpeg\ffmpeg.exe（节省 ~3 MB）。
* 视频解码完全在进程内由静态链接的 libavcodec 完成
  （Cargo feature: internal-ffmpeg, FFmpeg 7.1.1 软件 HEVC 解码）。
* run.bat 自动设置 SHARK_USE_INTERNAL_FFMPEG=1。

运行要求
--------
* Windows 10 / 11 x64
* Microsoft Edge WebView2 Runtime
    https://developer.microsoft.com/microsoft-edge/webview2/
$gpuRequirement
* 可选：HEVC Video Extensions（仅当手动选择 H.265 WebCodecs 时需要）。
    运行 install-hevc-webcodecs.bat 可通过 Microsoft Store/winget 安装。

首次运行步骤
------------
  1. 解压压缩包。
  2. 双击 run.bat（推荐，会去除 Mark-of-the-Web 并设置环境变量）。
$trtLauncherHint
     或者直接运行 SharkClientRustVersion.exe。

缓存与配置
----------
* 客户端设置、WebView2/localStorage、日志和运行时缓存均写入发行包根目录的 Cache\ 文件夹。
* 删除 Cache\ 可以重置当前发行包的本地状态；不会读取系统 AppData 中旧版本缓存。

环境变量
--------
  SHARK_USE_INTERNAL_FFMPEG=1   强制使用内置 libavcodec 解码器（run.bat 默认开启）。
  SHARK_FORCE_CPU=1             强制 CPU 推理（CPU 版默认开启）。
$trtEnvHint
  ORT_DYLIB_PATH=...            手动指定 onnxruntime.dll 路径。
"@
Set-Content -LiteralPath (Join-Path $outputDir 'README.txt') -Value $readme -Encoding UTF8

Compress-Archive -LiteralPath $outputDir -DestinationPath $zipPath

Write-Host "Single package created ($Variant):"
Write-Host "  Dir: $outputDir"
Write-Host "  Zip: $zipPath"
