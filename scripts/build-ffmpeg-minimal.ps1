
# Build a minimal static ffmpeg.exe for SharkClientRustVersion.
#
# Pipeline requirements (from src-tauri/src/video_decoder.rs):
#   - HEVC + H.264 decode
#   - d3d11va / dxva2 hardware acceleration
#   - Filters: hwdownload, format, scale
#   - Input: raw HEVC/H.264 bitstream via pipe:0
#   - Output: YUV4MPEGPIPE via pipe:1
#
# Strategy:
#   1. Install MSYS2 portable (to .msys64 inside the repo, no admin needed).
#   2. Bootstrap pacman, install MinGW64 toolchain + nasm.
#   3. Clone/download FFmpeg source.
#   4. ./configure with --disable-everything + minimal feature allowlist.
#   5. make -j && strip, copy to resources/ffmpeg/ffmpeg.exe.
#
# Expected output: ffmpeg.exe around 10-15 MB (vs 64 MB BtbN static).

[CmdletBinding()]
param(
  # Reuse existing MSYS2 install if the path exists; otherwise extract fresh.
  [string]$MsysRoot = '',
  # FFmpeg release version to download as tarball.
  [string]$FfmpegVersion = '7.1.1',
  # Skip the MSYS2 base extraction even if the directory is missing (expert mode).
  [switch]$SkipMsysInstall,
  # In addition to ffmpeg.exe, also export static libs + headers to
  # src-tauri/vendor/ffmpeg-static/win-x64/ for direct linking from Rust.
  [switch]$StaticLibs,
  # If set, skip building ffmpeg.exe (only emit static libs/headers).
  [switch]$LibsOnly
)

$ErrorActionPreference = 'Stop'
# $PSScriptRoot can be empty when the script is invoked via certain wrappers;
# use $MyInvocation as a robust fallback.
$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$repoRoot  = Split-Path -Parent $scriptDir
if ([string]::IsNullOrEmpty($MsysRoot)) {
  $MsysRoot = Join-Path $repoRoot '.msys64'
}
$destDir   = Join-Path $repoRoot 'resources\ffmpeg'
$destExe   = Join-Path $destDir  'ffmpeg.exe'

function Write-Section($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

# ---------------------------------------------------------------------------
# 1. MSYS2 base
# ---------------------------------------------------------------------------
$needMsys = -not (Test-Path (Join-Path $MsysRoot 'usr\bin\bash.exe'))
if ($needMsys -and -not $SkipMsysInstall) {
  Write-Section "Installing MSYS2 base into $MsysRoot"

  # Use the tar.xz artifact (cleaner than sfx.exe which needs interactive extract);
  # Windows 10+ ships `tar.exe` with native xz support.
  # First check for an already-downloaded tarball in TEMP to avoid hitting
  # the GitHub API (which rate-limits unauthenticated IPs to 60/hour).
  $tarPath = $null
  $cached = Get-ChildItem -Path $env:TEMP -Filter 'msys2-base-x86_64-*.tar.xz' -ErrorAction SilentlyContinue |
              Where-Object { $_.Length -gt 30MB } |
              Sort-Object LastWriteTime -Descending |
              Select-Object -First 1
  if ($cached) {
    $tarPath = $cached.FullName
    Write-Host "Using cached tarball: $tarPath ($([int]($cached.Length/1MB)) MB)"
  } else {
    $asset = $null
    try {
      $asset = (Invoke-RestMethod 'https://api.github.com/repos/msys2/msys2-installer/releases/latest' -UseBasicParsing).assets |
                 Where-Object { $_.name -like 'msys2-base-x86_64-*.tar.xz' } |
                 Select-Object -First 1
    } catch {
      Write-Host "GitHub API unavailable ($_); falling back to well-known URL"
    }
    if (-not $asset) {
      # Known-good stable release as fallback when API is rate-limited.
      $fallbackName = 'msys2-base-x86_64-20260322.tar.xz'
      $asset = [PSCustomObject]@{
        name = $fallbackName
        browser_download_url = "https://github.com/msys2/msys2-installer/releases/download/2026-03-22/$fallbackName"
      }
    }
    $tarPath = Join-Path $env:TEMP $asset.name
    if (-not (Test-Path $tarPath) -or (Get-Item $tarPath).Length -lt 30MB) {
      Write-Host "Downloading $($asset.browser_download_url)"
      # curl handles resume + retries better than Invoke-WebRequest on flaky links.
      & curl.exe -L --retry 10 --retry-all-errors --retry-delay 3 -C - -o $tarPath $asset.browser_download_url
      if ($LASTEXITCODE -ne 0) { throw "Download failed (curl exit $LASTEXITCODE)" }
    }
  }

  $parent = Split-Path -Parent $MsysRoot
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  # Remove any incomplete leftover that would make tar fail with Permission denied.
  $extractedRoot = Join-Path $parent 'msys64'
  foreach ($p in @($MsysRoot, $extractedRoot) | Select-Object -Unique) {
    if (Test-Path $p) {
      Write-Host "Cleaning previous incomplete install: $p"
      Get-ChildItem $p -Recurse -Force -ErrorAction SilentlyContinue |
        ForEach-Object { try { $_.Attributes = 'Normal' } catch {} }
      # Retry loop: AV/indexer can hold handles briefly causing spurious
      # "directory is not empty" errors.
      for ($i = 0; $i -lt 5 -and (Test-Path $p); $i++) {
        cmd /c "rmdir /s /q `"$p`"" 2>$null | Out-Null
        if (Test-Path $p) { Start-Sleep -Milliseconds 500 }
      }
      if (Test-Path $p) { throw "Failed to remove $p (files may be locked; close MSYS2 shells and retry)" }
    }
  }
  # tar.xz -> extracts a top-level "msys64/" folder directly.
  # (bsdtar on Windows doesn't support --overwrite, so we pre-clean above.)
  Write-Host "Extracting $tarPath -> $parent"
  & tar.exe -xJf $tarPath -C $parent
  if ($LASTEXITCODE -ne 0) { throw "tar extract failed (exit $LASTEXITCODE)" }

  # Compare full paths (MsysRoot may not exist yet, so don't use Resolve-Path on it).
  $extractedFull = [System.IO.Path]::GetFullPath($extractedRoot).TrimEnd('\')
  $msysFull      = [System.IO.Path]::GetFullPath($MsysRoot).TrimEnd('\')
  if ($extractedFull -ne $msysFull) {
    # User chose a non-default MsysRoot; move the extracted tree to match.
    if (Test-Path $MsysRoot) { Remove-Item $MsysRoot -Recurse -Force }
    Move-Item $extractedRoot $MsysRoot
  }
  if (-not (Test-Path (Join-Path $MsysRoot 'usr\bin\bash.exe'))) {
    throw "MSYS2 extraction failed. Expected: $MsysRoot\usr\bin\bash.exe"
  }
}

$bash = Join-Path $MsysRoot 'usr\bin\bash.exe'
if (-not (Test-Path $bash)) { throw "bash.exe not found at $bash" }

function _WriteBashScript($script) {
  # Write to a temp .sh file with LF newlines + no BOM. Passing scripts via
  # `bash -c "$script"` is fragile on Windows (CRLF, quote escaping, argv
  # reconstruction). Executing a file is robust.
  $script = $script -replace "`r`n", "`n"
  if (-not $script.EndsWith("`n")) { $script += "`n" }
  $tmp = [System.IO.Path]::Combine($env:TEMP, "msys-run-$([guid]::NewGuid().ToString('N')).sh")
  [System.IO.File]::WriteAllText($tmp, $script, (New-Object System.Text.UTF8Encoding $false))
  return $tmp
}

function _BashPath($winPath) {
  # C:\Users\... -> /c/Users/...
  $p = $winPath -replace '\\','/'
  if ($p -match '^([A-Za-z]):(.*)$') { return "/$($Matches[1].ToLower())$($Matches[2])" }
  return $p
}

function Invoke-Msys($script) {
  $tmp = _WriteBashScript $script
  try {
    # MSYSTEM=MINGW64 activates /mingw64/bin on PATH (gcc, nasm, pkgconf).
    $prev = $env:MSYSTEM; $env:MSYSTEM = 'MINGW64'
    try { & $bash --login (_BashPath $tmp) }
    finally { if ($prev) { $env:MSYSTEM = $prev } else { Remove-Item env:MSYSTEM -ErrorAction SilentlyContinue } }
    if ($LASTEXITCODE -ne 0) { throw "MSYS2 command failed (exit $LASTEXITCODE)" }
  } finally {
    Remove-Item -Force -ErrorAction SilentlyContinue $tmp
  }
}

function Invoke-MsysTry($script) {
  # Non-throwing variant: pacman's first core-upgrade self-kills the shell,
  # making exit codes unreliable on first run. Caller is expected to re-check.
  $tmp = _WriteBashScript $script
  try {
    $prev = $env:MSYSTEM; $env:MSYSTEM = 'MINGW64'
    try { & $bash --login (_BashPath $tmp) }
    finally { if ($prev) { $env:MSYSTEM = $prev } else { Remove-Item env:MSYSTEM -ErrorAction SilentlyContinue } }
  } finally {
    Remove-Item -Force -ErrorAction SilentlyContinue $tmp
  }
}

# ---------------------------------------------------------------------------
# 2. First-run bootstrap + toolchain
# ---------------------------------------------------------------------------
Write-Section "Configuring pacman mirrors (CN mirrors first)"
# Prepend fast CN mirrors so users in the PRC don't time out on repo.msys2.org.
$msysMirrors = @"
## CN mirrors (added by build script)
Server = https://mirrors.tuna.tsinghua.edu.cn/msys2/msys/`$arch/
Server = https://mirrors.ustc.edu.cn/msys2/msys/`$arch/
Server = https://mirrors.bfsu.edu.cn/msys2/msys/`$arch/

# See https://www.msys2.org/dev/mirrors

## Primary
Server = https://mirror.msys2.org/msys/`$arch/
Server = https://repo.msys2.org/msys/`$arch/
"@
$mingwMirrors = @"
## CN mirrors (added by build script)
Server = https://mirrors.tuna.tsinghua.edu.cn/msys2/mingw/`$repo/
Server = https://mirrors.ustc.edu.cn/msys2/mingw/`$repo/
Server = https://mirrors.bfsu.edu.cn/msys2/mingw/`$repo/

# See https://www.msys2.org/dev/mirrors

## Primary
Server = https://mirror.msys2.org/mingw/`$repo/
Server = https://repo.msys2.org/mingw/`$repo/
"@
$pd = Join-Path $MsysRoot 'etc\pacman.d'
# Use ASCII (no BOM) — pacman warns "unable to recognize" on UTF-8 BOM.
Set-Content -Path (Join-Path $pd 'mirrorlist.msys')  -Value $msysMirrors  -Encoding ASCII
Set-Content -Path (Join-Path $pd 'mirrorlist.mingw') -Value $mingwMirrors -Encoding ASCII

Write-Section "Bootstrapping pacman (first run may take a while)"
# pacman-key init is idempotent.
Invoke-MsysTry 'pacman-key --init >/dev/null 2>&1; pacman-key --populate msys2 >/dev/null 2>&1; true'
# First core update: will upgrade msys2-runtime and kill itself. Expected to
# return non-zero on first run.
Invoke-MsysTry 'pacman -Syuu --noconfirm'
# Second run finishes the rest.
Invoke-Msys 'pacman -Syuu --noconfirm'

Write-Section "Installing MinGW64 toolchain + build deps"
$pkgs = @(
  'make', 'diffutils', 'pkg-config',
  'mingw-w64-x86_64-gcc',
  'mingw-w64-x86_64-binutils',
  'mingw-w64-x86_64-nasm',
  'mingw-w64-x86_64-pkgconf'
) -join ' '
Invoke-Msys "pacman -S --needed --noconfirm $pkgs"

# ---------------------------------------------------------------------------
# 3. FFmpeg source
# ---------------------------------------------------------------------------
Write-Section "Fetching FFmpeg source (v$FfmpegVersion)"
# Prefer host-side download (PowerShell) + stage into MSYS2 home. This avoids
# flaky git/curl inside MSYS2 and HTTP low-speed hangs.
$ffTar = Join-Path $env:TEMP "ffmpeg-$FfmpegVersion.tar.xz"
if (-not (Test-Path $ffTar) -or (Get-Item $ffTar).Length -lt 10MB) {
  $urls = @(
    "https://ffmpeg.org/releases/ffmpeg-$FfmpegVersion.tar.xz",
    "https://www.ffmpeg.org/releases/ffmpeg-$FfmpegVersion.tar.xz",
    "https://launchpad.net/ubuntu/+archive/primary/+sourcefiles/ffmpeg/7:$FfmpegVersion-0ubuntu1/ffmpeg_$FfmpegVersion.orig.tar.xz"
  )
  $ok = $false
  foreach ($u in $urls) {
    Write-Host "  Downloading $u"
    try {
      # Invoke-WebRequest -OutFile falls back to BITS/HttpWebRequest; honor
      # TLS12+. Use -TimeoutSec to fail fast on dead mirrors.
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
      Invoke-WebRequest -Uri $u -OutFile $ffTar -UseBasicParsing -TimeoutSec 120
      if ((Get-Item $ffTar).Length -ge 10MB) { $ok = $true; break }
    } catch {
      Write-Warning "  Failed: $($_.Exception.Message)"
    }
  }
  if (-not $ok) { throw "Could not download FFmpeg $FfmpegVersion source from any mirror." }
}
$ffTarSize = [math]::Round((Get-Item $ffTar).Length/1MB, 1)
Write-Host "  Tarball: $ffTar ($ffTarSize MB)"

# Stage into MSYS2 home and extract.
$msysHome = Join-Path $MsysRoot 'home\Administrator'
if (-not (Test-Path $msysHome)) { $msysHome = Join-Path $MsysRoot "home\$env:USERNAME" }
if (-not (Test-Path $msysHome)) { New-Item -ItemType Directory -Path $msysHome | Out-Null }
Copy-Item -Force $ffTar (Join-Path $msysHome 'ffmpeg-src.tar.xz')

$srcScript = @"
set -e
cd ~
if [ ! -d ffmpeg ]; then
  echo "Extracting ffmpeg-src.tar.xz..."
  tar -xJf ffmpeg-src.tar.xz
  mv ffmpeg-$FfmpegVersion ffmpeg
fi
rm -f ffmpeg-src.tar.xz
cd ffmpeg
echo "FFmpeg source ready: `$(head -1 RELEASE 2>/dev/null || echo $FfmpegVersion)"
"@
Invoke-Msys $srcScript

# ---------------------------------------------------------------------------
# 4. Configure + build
# ---------------------------------------------------------------------------
Write-Section "Configuring minimal FFmpeg"
# Feature allowlist tuned for our use case. Shared-object version would still
# link avfilter, so we build static: one self-contained ffmpeg.exe.
$configureFlags = @(
  '--arch=x86_64'
  '--target-os=mingw32'
  '--pkg-config-flags=--static'
  # Fully static link so ffmpeg.exe has zero DLL dependencies on the host
  # (otherwise MinGW64 libgcc_s_seh-1.dll / libwinpthread-1.dll are needed).
  '--extra-ldflags=-static'
  '--extra-cflags=-static'
  '--disable-everything'
  '--disable-autodetect'
  '--disable-doc'
  '--disable-htmlpages'
  '--disable-manpages'
  '--disable-podpages'
  '--disable-txtpages'
  '--disable-debug'
  '--disable-iconv'
  '--disable-network'
  '--disable-avdevice'
  '--disable-postproc'
  '--disable-ffplay'
  '--disable-ffprobe'
  '--enable-static'
  '--disable-shared'
  '--enable-gpl'
  '--enable-small'
  # Windows hardware accelerated decode
  '--enable-d3d11va'
  '--enable-dxva2'
  '--enable-hwaccel=hevc_d3d11va'
  '--enable-hwaccel=hevc_d3d11va2'
  '--enable-hwaccel=hevc_dxva2'
  '--enable-hwaccel=h264_d3d11va'
  '--enable-hwaccel=h264_d3d11va2'
  '--enable-hwaccel=h264_dxva2'
  # Software decoders + parsers
  '--enable-decoder=hevc'
  '--enable-decoder=h264'
  '--enable-parser=hevc'
  '--enable-parser=h264'
  # Raw-bitstream demuxers (pipe:0 input)
  '--enable-demuxer=hevc'
  '--enable-demuxer=h264'
  '--enable-bsf=hevc_mp4toannexb'
  '--enable-bsf=h264_mp4toannexb'
  # Y4M + rawvideo output (pipe:1)
  '--enable-muxer=yuv4mpegpipe'
  '--enable-muxer=rawvideo'
  '--enable-muxer=image2pipe'
  '--enable-encoder=rawvideo'
  # yuv4mpegpipe muxer requires wrapped_avframe as its default codec.
  # Without this, ffmpeg fails with "Automatic encoder selection failed" and
  # produces 0 frames. See:
  # https://trac.ffmpeg.org/ticket/9478
  '--enable-encoder=wrapped_avframe'
  # Protocols
  '--enable-protocol=pipe'
  '--enable-protocol=file'
  # Filters used in video_decoder.rs
  '--enable-filter=hwdownload'
  '--enable-filter=hwupload'
  '--enable-filter=format'
  '--enable-filter=scale'
  '--enable-filter=null'
  '--enable-filter=copy'
  '--enable-filter=setpts'
  # swscale is needed by format/scale
  '--enable-swscale'
) -join ' '

$buildScript = @"
set -e
cd ~/ffmpeg
# Only run configure if not already configured (avoids 1-min re-run on retry).
if [ ! -f ffbuild/config.mak ]; then
  ./configure --prefix=`$HOME/ffmpeg-prefix $configureFlags
fi
make -j`$(nproc)
# install static libs + headers into the prefix so we can vendor them.
make install
# configure already emits a stripped binary, but strip again to be sure.
strip ffmpeg.exe 2>/dev/null || true
ls -la ffmpeg.exe
ls -la `$HOME/ffmpeg-prefix/lib/*.a 2>/dev/null || true
"@
# Note: configure uses /mingw64 gcc (MinGW GNU C), auto-selected when
# --target-os=mingw32 is specified on an MSYS2/MINGW64 shell.

Invoke-Msys $buildScript

# ---------------------------------------------------------------------------
# 5. Copy result into repo
# ---------------------------------------------------------------------------
if (-not $LibsOnly) {
  $builtExe = Join-Path $MsysRoot 'home\*\ffmpeg\ffmpeg.exe'
  $resolved = Get-ChildItem $builtExe -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $resolved) { throw "Built ffmpeg.exe not found at $builtExe" }

  New-Item -ItemType Directory -Force -Path $destDir | Out-Null
  Copy-Item -LiteralPath $resolved.FullName -Destination $destExe -Force

  $sizeMB = [math]::Round((Get-Item $destExe).Length / 1MB, 2)
  Write-Host "Built ffmpeg.exe: $destExe"
  Write-Host "Size: $sizeMB MB"
}

# Always copy out the static libs+headers if MSYS2 ran `make install`.
# Set $StaticLibs to make this an explicit deliverable; otherwise it's a
# best-effort copy (cheap, no extra build cost).
$prefixDir = Get-ChildItem (Join-Path $MsysRoot 'home\*\ffmpeg-prefix') -ErrorAction SilentlyContinue | Select-Object -First 1
if ($prefixDir) {
  $vendorRoot = Join-Path $repoRoot 'src-tauri\vendor\ffmpeg-static\win-x64'
  Write-Section "Exporting static libs to vendor dir"
  Write-Host "  src: $($prefixDir.FullName)"
  Write-Host "  dst: $vendorRoot"
  if (Test-Path $vendorRoot) { Remove-Item -Recurse -Force $vendorRoot }
  New-Item -ItemType Directory -Force -Path $vendorRoot | Out-Null
  foreach ($sub in 'include','lib','bin') {
    $s = Join-Path $prefixDir.FullName $sub
    if (Test-Path $s) {
      Copy-Item -Recurse -Force $s $vendorRoot
    }
  }
  # Drop pkg-config files (.pc reference MSYS paths that won't resolve later).
  $pkgcfg = Join-Path $vendorRoot 'lib\pkgconfig'
  if (Test-Path $pkgcfg) { Remove-Item -Recurse -Force $pkgcfg }
  $libCount = (Get-ChildItem (Join-Path $vendorRoot 'lib\*.a') -ErrorAction SilentlyContinue).Count
  Write-Host "  exported $libCount static libs (.a)"

  # ---------------------------------------------------------------------------
  # MinGW runtime libs needed when MSVC links against MinGW-built static libs.
  # libmingwex   — __mingw_*printf/sscanf, mkstemp, sincos, gettimeofday, ...
  # libmingw32   — startup glue (mostly unused under MSVC, kept for completeness)
  # libgcc       — compiler intrinsics: __chkstk_ms, __divti3, ...
  # libucrt      — Universal CRT (provides nanosleep64, clock_gettime64, ...)
  # ---------------------------------------------------------------------------
  $mingwLib = Join-Path $MsysRoot 'mingw64\lib'
  $gccLibSearch = Get-ChildItem (Join-Path $MsysRoot 'mingw64\lib\gcc\x86_64-w64-mingw32') -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
  $gccLib = if ($gccLibSearch) { $gccLibSearch.FullName } else { $null }
  $vendorLib = Join-Path $vendorRoot 'lib'
  $rtCopied = 0
  foreach ($name in 'libmingwex.a','libmingw32.a','libwinpthread.a','libucrt.a') {
    $src = Join-Path $mingwLib $name
    if (Test-Path $src) { Copy-Item -Force $src $vendorLib; $rtCopied++ }
  }
  if ($gccLib) {
    $src = Join-Path $gccLib 'libgcc.a'
    if (Test-Path $src) { Copy-Item -Force $src $vendorLib; $rtCopied++ }
  }
  Write-Host "  bundled $rtCopied MinGW runtime archives"
}

Write-Section "Done"
