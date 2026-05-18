[CmdletBinding()]
param(
  # 'gpu' = external Python detector picks the best available ONNX Runtime provider.
  # 'cpu' = run.bat sets ONNX_PROVIDER=cpu so the external detector stays CPU-only.
  [ValidateSet('gpu','cpu')]
  [string]$Variant = 'gpu'
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$exeName = 'SharkClientRustVersion.exe'

$liteName = if ($Variant -eq 'cpu') { 'SharkClient-cpu' } else { 'SharkClient' }

$releaseExe = Join-Path $repoRoot "src-tauri\target\release\$exeName"
$resourcesDir = Join-Path $repoRoot 'resources'
$buildLiteDir = Join-Path $repoRoot 'build-lite'
$outputDir = Join-Path $buildLiteDir $liteName
$zipPath = Join-Path $buildLiteDir "$liteName.zip"

if (-not (Test-Path -LiteralPath $releaseExe)) {
  throw "Release executable not found: $releaseExe"
}

if (-not (Test-Path -LiteralPath $resourcesDir)) {
  throw "Resources directory not found: $resourcesDir"
}

# Sanity-check that the frontend was actually built. A missing/empty dist is
# the usual root cause of "localhost refused connection" on the released exe:
# plain `cargo build --release` does NOT run `vite build`, so tauri codegen
# embeds a stale/empty frontend and WebView2 fails to load bundled assets.
# Always use `npm run build:lite` (goes through `tauri build`) to avoid this.
$distIndex = Join-Path $repoRoot 'dist\index.html'
if (-not (Test-Path -LiteralPath $distIndex)) {
  throw "dist/index.html is missing. Run 'npm run build' (or 'npm run build:lite') before packaging."
}

function Get-FallbackArtifactPaths {
  param(
    [string]$BaseDir,
    [string]$BaseName
  )

  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $fallbackName = "$BaseName-$timestamp"

  return @{
    OutputDir = Join-Path $BaseDir $fallbackName
    ZipPath = Join-Path $BaseDir "$fallbackName.zip"
  }
}

New-Item -ItemType Directory -Path $buildLiteDir -Force | Out-Null

if (Test-Path -LiteralPath $outputDir) {
  try {
    Remove-Item -LiteralPath $outputDir -Recurse -Force
  } catch {
    $fallbackPaths = Get-FallbackArtifactPaths -BaseDir $buildLiteDir -BaseName $liteName
    $outputDir = $fallbackPaths.OutputDir
    $zipPath = $fallbackPaths.ZipPath
    Write-Warning "Default lite directory is in use, packaging to fallback path: $outputDir"
  }
}

if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

New-Item -ItemType Directory -Path $outputDir | Out-Null
New-Item -ItemType Directory -Path (Join-Path $outputDir 'Cache') | Out-Null

Copy-Item -LiteralPath $releaseExe -Destination (Join-Path $outputDir $exeName)
Copy-Item -LiteralPath $resourcesDir -Destination (Join-Path $outputDir 'resources') -Recurse

Write-Host "[lite] variant = $Variant"

# External AI detection is manual-start. Ship only the small Python bridge,
# the core DetectionServer, and the two ONNX models it needs; do not copy the
# old in-process ORT/TensorRT DLL bundle or the whole AI Server workspace.
$pipeScript = Join-Path $repoRoot 'scripts\detection_pipe_server.py'
$envInstallScript = Join-Path $repoRoot 'scripts\install-lite-env.ps1'
$hevcInstallScript = Join-Path $repoRoot 'scripts\install-hevc-webcodecs.ps1'
$aiServerPy = Join-Path $repoRoot 'AI Server\server\Server.py'
$aiPipeServerPy = Join-Path $repoRoot 'AI Server\server\pipe_server.py'
$aiRequirements = Join-Path $repoRoot 'AI Server\requirements.txt'
$armorModel = Join-Path $repoRoot 'AI Server\model\armor.onnx'
$carModel = Join-Path $repoRoot 'AI Server\model\car.onnx'
foreach ($required in @($pipeScript, $envInstallScript, $hevcInstallScript, $aiServerPy, $aiPipeServerPy, $aiRequirements, $armorModel, $carModel)) {
  if (-not (Test-Path -LiteralPath $required)) {
    throw "Required packaging asset not found: $required"
  }
}

$scriptsOut = Join-Path $outputDir 'scripts'
$aiServerOut = Join-Path $outputDir 'AI Server'
$aiServerServerOut = Join-Path $aiServerOut 'server'
$aiServerModelOut = Join-Path $aiServerOut 'model'
New-Item -ItemType Directory -Path $scriptsOut, $aiServerServerOut, $aiServerModelOut -Force | Out-Null
Copy-Item -LiteralPath $pipeScript -Destination (Join-Path $scriptsOut 'detection_pipe_server.py') -Force
Copy-Item -LiteralPath $envInstallScript -Destination (Join-Path $scriptsOut 'install-lite-env.ps1') -Force
Copy-Item -LiteralPath $hevcInstallScript -Destination (Join-Path $scriptsOut 'install-hevc-webcodecs.ps1') -Force
Copy-Item -LiteralPath $aiServerPy -Destination (Join-Path $aiServerServerOut 'Server.py') -Force
Copy-Item -LiteralPath $aiPipeServerPy -Destination (Join-Path $aiServerServerOut 'pipe_server.py') -Force
Copy-Item -LiteralPath $aiRequirements -Destination (Join-Path $aiServerOut 'requirements.txt') -Force
Copy-Item -LiteralPath $armorModel -Destination (Join-Path $aiServerModelOut 'armor.onnx') -Force
Copy-Item -LiteralPath $carModel -Destination (Join-Path $aiServerModelOut 'car.onnx') -Force

# Clear Mark-of-the-Web so extracted files don't trigger Windows
# "access denied" / SmartScreen prompts when launched from another machine.
Get-ChildItem -LiteralPath $outputDir -Recurse -File -ErrorAction SilentlyContinue |
  ForEach-Object {
    try { Unblock-File -LiteralPath $_.FullName -ErrorAction SilentlyContinue } catch {}
  }

# Drop a small launcher that strips MOTW on all files the user just
# extracted (extracted files always inherit MOTW from the .zip), then
# starts the exe. For the CPU-only bundle we force the external Python
# detector to use CPU when it is manually started from the client.
if ($Variant -eq 'cpu') {
  $launcher = @'
@echo off
pushd "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-ChildItem -LiteralPath '%~dp0' -Recurse -File | Unblock-File -ErrorAction SilentlyContinue"
set "ONNX_PROVIDER=cpu"
start "" "%~dp0SharkClientRustVersion.exe"
popd
'@
} else {
  $launcher = @'
@echo off
pushd "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-ChildItem -LiteralPath '%~dp0' -Recurse -File | Unblock-File -ErrorAction SilentlyContinue"
start "" "%~dp0SharkClientRustVersion.exe"
popd
'@
}
Set-Content -LiteralPath (Join-Path $outputDir 'run.bat') -Value $launcher -Encoding ASCII

$envInstallVariant = if ($Variant -eq 'cpu') { 'cpu' } else { 'gpu' }
$envInstallLauncher = @"
@echo off
pushd "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-lite-env.ps1" -Variant $envInstallVariant
pause
popd
"@
Set-Content -LiteralPath (Join-Path $outputDir 'install-env.bat') -Value $envInstallLauncher -Encoding ASCII

$hevcLauncher = @'
@echo off
pushd "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-hevc-webcodecs.ps1"
pause
popd
'@
Set-Content -LiteralPath (Join-Path $outputDir 'install-hevc-webcodecs.bat') -Value $hevcLauncher -Encoding ASCII

$variantLabel = if ($Variant -eq 'cpu') { '外置 AI CPU 版' } else { '外置 AI 自动 Provider 版' }
$gpuRequirement = if ($Variant -eq 'gpu') {
@'
* AI 检测默认不启动；手动启动时由 Python onnxruntime 自动选择 Provider。
* 如需 GPU 推理，请在 Python 环境中安装对应的 onnxruntime-gpu / CUDA 运行时。
'@
} else {
  '* AI 检测默认不启动；通过 run.bat 启动客户端后，外置检测脚本会强制 CPU Provider。'
}
$cpuForceHint = if ($Variant -eq 'cpu') {
  '        * 自动设置 ONNX_PROVIDER=cpu，强制外置检测脚本使用 CPU。'
} else {
  ''
}

$readme = @"
SharkClientRustVersion（轻量化发行包 · $variantLabel）
=========================================================

运行要求
--------
* Windows 10 / 11 x64
* Microsoft Edge WebView2 Runtime
    - 大多数 Win11 已经自带。
    - 如果窗口显示"localhost 拒绝访问" / 空白页 /
      "WebView2 Runtime is missing"，请从下面链接安装：
      https://developer.microsoft.com/microsoft-edge/webview2/
$gpuRequirement

首次运行步骤
------------
  1. 右键下载到的 .zip -> 属性 -> 勾选"解除锁定" -> 确定（如有此选项）。
  2. 解压压缩包。
  3. 首次使用 AI 检测前，双击 install-env.bat 安装 WebView2 / Python AI 环境。
  4. 双击 run.bat（推荐）
        * 会自动去除所有文件的 Mark-of-the-Web 标记，
          避免 Windows 因此拦截 DLL 加载。
$cpuForceHint
     或者直接运行 SharkClientRustVersion.exe。

AI 检测
-------
* AI 检测服务默认不会随客户端启动，需要在主界面或系统设置里手动点击"启动"。
* 发行包内包含：
    - scripts\detection_pipe_server.py
    - AI Server\server\Server.py
    - AI Server\server\pipe_server.py
    - AI Server\model\armor.onnx
    - AI Server\model\car.onnx
* 首次使用 AI 检测前，请双击 install-env.bat。脚本会在发行包根目录
  创建 .venv 并安装 requirements.txt 中的 Python 依赖，不写入全局 Python 环境。

缓存与配置
----------
* 客户端设置、WebView2/localStorage、日志、安装器下载缓存、Python pip 缓存
  均写入发行包根目录的 Cache\ 文件夹。
* 删除 Cache\ 可以重置当前发行包的本地状态；不会读取系统 AppData 中旧版本缓存。

常见问题排查
------------
* "localhost 拒绝访问" / 白屏：
    WebView2 Runtime 缺失或版本过旧。请安装上方微软官网的
    Evergreen Bootstrapper 安装器。
* "拒绝访问" / exe 双击后立即退出：
    由解压文件带有 Mark-of-the-Web 导致，使用 run.bat 启动即可。
* 外置 AI 启动失败：
    检查 Python、pywin32、onnxruntime、opencv-python、Pillow 等依赖是否安装。
* 需要 HEVC WebCodecs：
    运行 install-hevc-webcodecs.bat，通过 Microsoft Store/winget 安装
    HEVC Video Extensions。安装后重启客户端，并手动选择 UDP 编码类型
    H.265 (HEVC) 测试 WebCodecs；自动模式使用后端解码 + 本机 MJPEG 流，
    不再通过 Tauri IPC 发送 raw YUV 大帧。

内置依赖
--------
* ffmpeg.exe 已内置于 resources\ffmpeg\ 目录中，
  用于 H.265 GPU 硬件解码；无需单独安装或配置 PATH。
* ONNX Runtime 不再内置到客户端进程；AI 推理由手动启动的 Python 脚本负责。

环境变量（可选）
----------------
  ONNX_PROVIDER=cpu    强制外置 AI 脚本使用 CPU Provider。
  SHARK_FFMPEG_PATH=…  手动指定 ffmpeg.exe 路径（一般无需设置，
                       默认使用包内 resources\ffmpeg\ffmpeg.exe）。
"@
Set-Content -LiteralPath (Join-Path $outputDir 'README.txt') -Value $readme -Encoding UTF8

Compress-Archive -LiteralPath $outputDir -DestinationPath $zipPath

Write-Host "Lite package created ($Variant):"
Write-Host "  Dir: $outputDir"
Write-Host "  Zip: $zipPath"
