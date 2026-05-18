[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$exeName = 'SharkClientRustVersion.exe'
$miniName = 'SharkClientRustVersionMini'

$releaseExe = Join-Path $repoRoot "src-tauri\target\release\$exeName"
$resourcesDir = Join-Path $repoRoot 'resources'
$pipeScript = Join-Path $repoRoot 'scripts\detection_pipe_server.py'
$hevcInstallScript = Join-Path $repoRoot 'scripts\install-hevc-webcodecs.ps1'
$buildDir = Join-Path $repoRoot 'build-lite'
$outputDir = Join-Path $buildDir $miniName
$zipPath = Join-Path $buildDir "$miniName.zip"

if (-not (Test-Path -LiteralPath $releaseExe)) {
  throw "Release executable not found: $releaseExe. Run 'npm run build:mini' first."
}
if (-not (Test-Path -LiteralPath $resourcesDir)) {
  throw "Resources directory not found: $resourcesDir"
}
if (-not (Test-Path -LiteralPath $pipeScript)) {
  throw "Detection pipe script not found: $pipeScript"
}
if (-not (Test-Path -LiteralPath $hevcInstallScript)) {
  throw "HEVC install helper not found: $hevcInstallScript"
}
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'dist\index.html'))) {
  throw "dist/index.html is missing. Run 'npm run build:mini' first."
}

New-Item -ItemType Directory -Path $buildDir -Force | Out-Null

$buildDirResolved = (Resolve-Path -LiteralPath $buildDir).Path
if (Test-Path -LiteralPath $outputDir) {
  $outputResolved = (Resolve-Path -LiteralPath $outputDir).Path
  if (-not $outputResolved.StartsWith($buildDirResolved, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clean output outside build dir: $outputResolved"
  }
  Remove-Item -LiteralPath $outputDir -Recurse -Force
}
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

New-Item -ItemType Directory -Path $outputDir | Out-Null
New-Item -ItemType Directory -Path (Join-Path $outputDir 'Cache') | Out-Null
Copy-Item -LiteralPath $releaseExe -Destination (Join-Path $outputDir $exeName)

# Mini uses the internal libavcodec decoder compiled into the executable, so
# do not ship resources\ffmpeg\ffmpeg.exe.
$destResources = Join-Path $outputDir 'resources'
New-Item -ItemType Directory -Path $destResources | Out-Null
Get-ChildItem -LiteralPath $resourcesDir -Force |
  Where-Object { $_.Name -ne 'ffmpeg' } |
  ForEach-Object {
    if ($_.PSIsContainer) {
      Copy-Item -LiteralPath $_.FullName -Destination $destResources -Recurse -Force
    } else {
      Copy-Item -LiteralPath $_.FullName -Destination $destResources -Force
    }
  }

$scriptsOut = Join-Path $outputDir 'scripts'
New-Item -ItemType Directory -Path $scriptsOut | Out-Null
Copy-Item -LiteralPath $pipeScript -Destination (Join-Path $scriptsOut 'detection_pipe_server.py') -Force
Copy-Item -LiteralPath $hevcInstallScript -Destination (Join-Path $scriptsOut 'install-hevc-webcodecs.ps1') -Force

$launcher = @'
@echo off
pushd "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-ChildItem -LiteralPath '%~dp0' -Recurse -File | Unblock-File -ErrorAction SilentlyContinue"
set "SHARK_USE_INTERNAL_FFMPEG=1"
start "" "%~dp0SharkClientRustVersion.exe"
popd
'@
Set-Content -LiteralPath (Join-Path $outputDir 'run.bat') -Value $launcher -Encoding ASCII

$hevcLauncher = @'
@echo off
pushd "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-hevc-webcodecs.ps1"
pause
popd
'@
Set-Content -LiteralPath (Join-Path $outputDir 'install-hevc-webcodecs.bat') -Value $hevcLauncher -Encoding ASCII

$readme = @"
SharkClientRustVersion Mini
===========================

This package uses the internal FFmpeg/libavcodec decoder by default and does
not ship resources\ffmpeg\ffmpeg.exe.

HEVC WebCodecs
--------------
Windows HEVC Video Extensions are Microsoft Store media extensions, not normal
redistributable DLLs. This package therefore includes an official install
helper instead of copying the AppX package:

  install-hevc-webcodecs.bat

After installing the extension, restart the client and manually select UDP
codec: H.265 (HEVC) to test WebCodecs. Auto mode uses backend HEVC decode plus
a local MJPEG preview stream, so raw YUV frames are not sent through Tauri IPC.

Cache
-----
Runtime settings, WebView2/localStorage and logs are stored under the package
root Cache folder. Delete Cache to reset only this extracted package.
"@
Set-Content -LiteralPath (Join-Path $outputDir 'README.txt') -Value $readme -Encoding UTF8

Compress-Archive -LiteralPath $outputDir -DestinationPath $zipPath

Write-Host "Mini package created (internal FFmpeg):"
Write-Host "  Dir: $outputDir"
Write-Host "  Zip: $zipPath"
