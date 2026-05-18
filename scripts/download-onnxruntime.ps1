# download-onnxruntime.ps1
# ------------------------------------------------------------
# Pre-download ONNX Runtime dynamic libraries into
#   src-tauri/vendor/onnxruntime/<platform>/
# so the Rust side can load them via `load-dynamic`.
#
# Usage:
#   PS> ./scripts/download-onnxruntime.ps1
#   PS> ./scripts/download-onnxruntime.ps1 -Platform win-x64-gpu
#   PS> ./scripts/download-onnxruntime.ps1 -Version 1.24.4 -Force
#
# Notes:
#   - ort 2.0.0-rc.12 targets ONNX Runtime 1.24.x (default 1.24.4).
#   - GPU variant requires NVIDIA driver >= 525 (CUDA 12) + cuDNN.
#   - For CPU-only / non-NVIDIA machines, pass -Platform win-x64
#     (falls back to DirectML / CPU at runtime).
# ------------------------------------------------------------

[CmdletBinding()]
param(
    [string]$Version = "1.24.4",
    [string]$Platform = "",
    [string]$Mirror = "",   # e.g. https://ghfast.top/ or https://mirror.ghproxy.com/
    [switch]$Force
)

$ErrorActionPreference = "Stop"

if (-not $Platform) {
    if ($env:OS -eq "Windows_NT") {
        $Platform = "win-x64-gpu"
    } elseif ($IsLinux) {
        $arch = (& uname -m).Trim()
        $Platform = if ($arch -eq "aarch64") { "linux-aarch64" } else { "linux-x64-gpu" }
    } elseif ($IsMacOS) {
        $arch = (& uname -m).Trim()
        $Platform = if ($arch -eq "arm64") { "osx-arm64" } else { "osx-x64" }
    } else {
        throw "Cannot auto-detect OS. Pass -Platform explicitly."
    }
}

$archiveMap = @{
    "win-x64-gpu"   = @{ name = "onnxruntime-win-x64-gpu-$Version.zip";     isZip = $true  }
    "win-x64"       = @{ name = "onnxruntime-win-x64-$Version.zip";         isZip = $true  }
    "linux-x64-gpu" = @{ name = "onnxruntime-linux-x64-gpu-$Version.tgz";   isZip = $false }
    "linux-x64"     = @{ name = "onnxruntime-linux-x64-$Version.tgz";       isZip = $false }
    "linux-aarch64" = @{ name = "onnxruntime-linux-aarch64-$Version.tgz";   isZip = $false }
    "osx-arm64"     = @{ name = "onnxruntime-osx-arm64-$Version.tgz";       isZip = $false }
    "osx-x64"       = @{ name = "onnxruntime-osx-x64-$Version.tgz";         isZip = $false }
}

if (-not $archiveMap.ContainsKey($Platform)) {
    throw "Unsupported platform: $Platform. Valid: $($archiveMap.Keys -join ', ')"
}

$repoRoot   = Resolve-Path (Join-Path $PSScriptRoot "..")
$vendorRoot = Join-Path $repoRoot "src-tauri/vendor/onnxruntime"
$targetDir  = Join-Path $vendorRoot $Platform
$archive    = $archiveMap[$Platform]
$baseUrl    = "https://github.com/microsoft/onnxruntime/releases/download/v$Version/$($archive.name)"
if ($Mirror) {
    $m = $Mirror.TrimEnd('/')
    $archiveUrl = "$m/$baseUrl"
} else {
    $archiveUrl = $baseUrl
}

$existing = @(
    Join-Path $targetDir "lib/onnxruntime.dll"
    Join-Path $targetDir "lib/libonnxruntime.so"
    Join-Path $targetDir "lib/libonnxruntime.dylib"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($existing -and -not $Force) {
    Write-Host ("[OK] already exists: " + $existing)
    Write-Host "     Use -Force to re-download."
    exit 0
}

New-Item -ItemType Directory -Force -Path $vendorRoot | Out-Null
$cacheDir = Join-Path $vendorRoot ".cache"
New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
$archivePath = Join-Path $cacheDir $archive.name

if (-not (Test-Path $archivePath) -or $Force) {
    Write-Host ("[download] " + $archiveUrl)
    # Prefer curl.exe (Windows 10+/Win11 builtin) — much faster than Invoke-WebRequest.
    # Fall back to Invoke-WebRequest only if curl.exe is unavailable.
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    try {
        if ($curl) {
            & curl.exe -L --fail --retry 3 --retry-delay 2 -o $archivePath $archiveUrl
            if ($LASTEXITCODE -ne 0) { throw "curl.exe exit code $LASTEXITCODE" }
        } else {
            $ProgressPreference = 'SilentlyContinue'
            Invoke-WebRequest -Uri $archiveUrl -OutFile $archivePath -UseBasicParsing
        }
    } catch {
        Write-Error ("Download failed: " + $_ + [Environment]::NewLine + "Manual fallback: download " + $archiveUrl + " and place at " + $archivePath + ", then re-run this script.")
        exit 1
    }
} else {
    Write-Host ("[cache] " + $archivePath)
}

if (Test-Path $targetDir) { Remove-Item -Recurse -Force $targetDir }
$tmpDir = Join-Path $cacheDir ("extract-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

Write-Host ("[extract] -> " + $targetDir)
if ($archive.isZip) {
    Expand-Archive -Path $archivePath -DestinationPath $tmpDir -Force
} else {
    & tar -xzf $archivePath -C $tmpDir
    if ($LASTEXITCODE -ne 0) { throw "tar extraction failed" }
}

$inner = Get-ChildItem -Directory $tmpDir | Select-Object -First 1
if (-not $inner) { throw ("Archive layout unexpected: " + $archivePath) }
Move-Item -Path $inner.FullName -Destination $targetDir
Remove-Item -Recurse -Force $tmpDir

$found = @(
    Join-Path $targetDir "lib/onnxruntime.dll"
    Join-Path $targetDir "lib/libonnxruntime.so"
    Join-Path $targetDir "lib/libonnxruntime.dylib"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $found) { throw ("ONNX Runtime dylib not found in " + $targetDir) }

Write-Host ""
Write-Host ("[done] platform : " + $Platform)
Write-Host ("       version  : " + $Version)
Write-Host ("       dylib    : " + $found)
Write-Host ""
Write-Host "You can now run cargo build / npm run tauri dev without network access for ONNX Runtime."
