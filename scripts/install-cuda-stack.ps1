<#
.SYNOPSIS
  Install CUDA Toolkit / cuDNN / TensorRT for ONNX Runtime 1.24.x GPU EPs.

.DESCRIPTION
  - CUDA 12.6 Toolkit: downloaded from NVIDIA (no login required) and installed silently.
  - cuDNN 9.x and TensorRT 10.x: direct download links are printed.
    After you manually download those zip files (NVIDIA developer login required,
    free registration), re-run this script with -CudnnZip / -TensorRTZip to extract
    and configure PATH.

.PARAMETER Step
  which step to run: all | cuda | cudnn | tensorrt | verify

.PARAMETER CudaVersion
  CUDA Toolkit version to install. Default 12.6.3.

.PARAMETER CudnnZip
  Path to the cuDNN windows-x86_64 zip you downloaded from developer.nvidia.com.

.PARAMETER TensorRTZip
  Path to the TensorRT windows-x86_64 zip you downloaded from developer.nvidia.com.

.PARAMETER TensorRTInstallRoot
  Where to extract TensorRT. Default: C:\Program Files\NVIDIA\TensorRT-10

.EXAMPLE
  # step 1: install CUDA toolkit silently (needs admin)
  powershell -File .\scripts\install-cuda-stack.ps1 -Step cuda

  # step 2: (after downloading cuDNN zip) merge into CUDA toolkit dir
  powershell -File .\scripts\install-cuda-stack.ps1 -Step cudnn -CudnnZip C:\Users\Me\Downloads\cudnn-windows-x86_64-9.x.x_cuda12-archive.zip

  # step 3: extract TensorRT and add to PATH
  powershell -File .\scripts\install-cuda-stack.ps1 -Step tensorrt -TensorRTZip C:\Users\Me\Downloads\TensorRT-10.x.x.x.Windows.win10.cuda-12.x.zip

  # verify everything is findable
  powershell -File .\scripts\install-cuda-stack.ps1 -Step verify
#>
[CmdletBinding()]
param(
  [ValidateSet('all','cuda','cudnn','tensorrt','verify','fix-path')]
  [string]$Step = 'verify',
  [string]$CudaVersion = '12.6.3',
  [string]$CudaInstallerUrl = 'https://developer.download.nvidia.com/compute/cuda/12.6.3/network_installers/cuda_12.6.3_windows_network.exe',
  [string]$CudnnZip,
  [string]$TensorRTZip,
  [string]$TensorRTInstallRoot = 'C:\Program Files\NVIDIA\TensorRT-10'
)

$ErrorActionPreference = 'Stop'

function Write-Section($text) {
  Write-Host ''
  Write-Host "=== $text ===" -ForegroundColor Cyan
}

function Require-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $pr = New-Object Security.Principal.WindowsPrincipal($id)
  if (-not $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'This step must run in an elevated (Administrator) PowerShell window.'
  }
}

function Get-CudaInstallPath {
  # try env first
  if ($env:CUDA_PATH -and (Test-Path $env:CUDA_PATH)) { return $env:CUDA_PATH }
  $roots = Get-ChildItem 'C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA' -Directory -ErrorAction SilentlyContinue
  if ($roots) { return ($roots | Sort-Object Name -Descending | Select-Object -First 1).FullName }
  return $null
}

function Install-Cuda {
  Write-Section "Installing CUDA Toolkit $CudaVersion"
  Require-Admin
  $cacheDir = Join-Path $PSScriptRoot '..\src-tauri\vendor\onnxruntime\.cache'
  New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
  $installer = Join-Path $cacheDir "cuda_${CudaVersion}_windows_network.exe"
  if (-not (Test-Path $installer)) {
    Write-Host "[download] $CudaInstallerUrl"
    & curl.exe -L --fail --retry 3 -o $installer $CudaInstallerUrl
    if ($LASTEXITCODE -ne 0) { throw 'CUDA installer download failed.' }
  } else {
    Write-Host "[cache] $installer"
  }

  # -s: fully silent install with default component set (recommended for ORT).
  Write-Host "[exec] $installer -s"
  $p = Start-Process -FilePath $installer -ArgumentList '-s' -Wait -PassThru
  if ($p.ExitCode -ne 0) {
    throw "CUDA installer exited with code $($p.ExitCode)."
  }
  Write-Host '[done] CUDA installed.' -ForegroundColor Green
}

function Install-Cudnn {
  Write-Section 'Merging cuDNN into CUDA toolkit'
  if (-not $CudnnZip -or -not (Test-Path $CudnnZip)) {
    Write-Host "cuDNN 9.x zip not provided. Download it from:"
    Write-Host "  https://developer.nvidia.com/cudnn-downloads"
    Write-Host "Pick: 'Local Installer for Windows (Zip)' for cuDNN 9.x / CUDA 12."
    Write-Host "Then rerun: -Step cudnn -CudnnZip <path-to-zip>"
    return
  }
  $cuda = Get-CudaInstallPath
  if (-not $cuda) { throw 'CUDA install not found. Run -Step cuda first.' }
  Write-Host "[cuda] $cuda"
  $tmp = Join-Path $env:TEMP ('cudnn_' + [IO.Path]::GetRandomFileName())
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  Expand-Archive -Path $CudnnZip -DestinationPath $tmp -Force
  $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
  if (-not $inner) { throw 'Unexpected cuDNN zip layout.' }
  foreach ($sub in 'bin','include','lib') {
    $src = Join-Path $inner.FullName $sub
    if (Test-Path $src) {
      $dst = Join-Path $cuda $sub
      Write-Host "[copy] $src -> $dst"
      Copy-Item -Path (Join-Path $src '*') -Destination $dst -Recurse -Force
    }
  }
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host '[done] cuDNN merged into CUDA toolkit.' -ForegroundColor Green
}

function Install-TensorRT {
  Write-Section 'Extracting TensorRT'
  if (-not $TensorRTZip -or -not (Test-Path $TensorRTZip)) {
    Write-Host "TensorRT 10.x zip not provided. Download it from:"
    Write-Host "  https://developer.nvidia.com/tensorrt/download"
    Write-Host "Pick: TensorRT 10.x GA for Windows 10/11 / CUDA 12.x (ZIP)."
    Write-Host "Then rerun: -Step tensorrt -TensorRTZip <path-to-zip>"
    return
  }
  New-Item -ItemType Directory -Force -Path $TensorRTInstallRoot | Out-Null
  $parent = Split-Path $TensorRTInstallRoot -Parent
  Write-Host "[extract] $TensorRTZip -> $parent"
  Expand-Archive -Path $TensorRTZip -DestinationPath $parent -Force
  # find extracted TensorRT-XX.Y.Z dir and rename / symlink to TensorRTInstallRoot
  $extracted = Get-ChildItem $parent -Directory -Filter 'TensorRT-10*' | Sort-Object Name -Descending | Select-Object -First 1
  if (-not $extracted) { throw 'Could not locate extracted TensorRT-10* directory.' }
  if ($extracted.FullName -ne $TensorRTInstallRoot) {
    if (Test-Path $TensorRTInstallRoot) { Remove-Item $TensorRTInstallRoot -Recurse -Force }
    Rename-Item $extracted.FullName $TensorRTInstallRoot
  }
  $trtBin = Join-Path $TensorRTInstallRoot 'lib'
  # add to user PATH (persistent)
  $userPath = [Environment]::GetEnvironmentVariable('Path','User')
  if ($userPath -notlike "*${trtBin}*") {
    $newPath = if ([string]::IsNullOrEmpty($userPath)) { $trtBin } else { "$userPath;$trtBin" }
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    Write-Host "[env] appended to user PATH: $trtBin"
  }
  Write-Host '[done] TensorRT extracted to ' $TensorRTInstallRoot -ForegroundColor Green
}

function Get-CudaMajor {
  $cuda = Get-CudaInstallPath
  if (-not $cuda) { return $null }
  # dir name looks like 'v12.8' -> major 12
  if ((Split-Path $cuda -Leaf) -match 'v(\d+)\.(\d+)') { return [int]$Matches[1] }
  return $null
}

function Get-CudnnInstallPath {
  # New independent installer layout: C:\Program Files\NVIDIA\CUDNN\vX.Y\bin\<cuda-major.minor>\x64
  # Pick the bin\<ver> subdir matching the installed CUDA major version.
  $cudaMajor = Get-CudaMajor
  $roots = Get-ChildItem 'C:\Program Files\NVIDIA\CUDNN' -Directory -ErrorAction SilentlyContinue |
           Sort-Object Name -Descending
  foreach ($r in $roots) {
    $binSubs = Get-ChildItem (Join-Path $r.FullName 'bin') -Directory -ErrorAction SilentlyContinue
    # split to matching-major vs others, sort each descending
    $matching = @(); $other = @()
    foreach ($b in $binSubs) {
      if ($cudaMajor -and $b.Name -match '^(\d+)\.\d+$' -and [int]$Matches[1] -eq $cudaMajor) {
        $matching += $b
      } else {
        $other += $b
      }
    }
    $sorted = @($matching | Sort-Object Name -Descending) + @($other | Sort-Object Name -Descending)
    foreach ($b in $sorted) {
      $x64 = Join-Path $b.FullName 'x64'
      if (Test-Path (Join-Path $x64 'cudnn64_9.dll')) {
        return [PSCustomObject]@{ Root=$r.FullName; BinDir=$x64; Version=$r.Name; CudaLabel=$b.Name }
      }
      if (Test-Path (Join-Path $b.FullName 'cudnn64_9.dll')) {
        return [PSCustomObject]@{ Root=$r.FullName; BinDir=$b.FullName; Version=$r.Name; CudaLabel=$b.Name }
      }
    }
    if (Test-Path (Join-Path $r.FullName 'bin\cudnn64_9.dll')) {
      return [PSCustomObject]@{ Root=$r.FullName; BinDir=(Join-Path $r.FullName 'bin'); Version=$r.Name; CudaLabel='' }
    }
  }
  return $null
}

function Get-TensorRTInstallPath {
  # search order: param, standard dir, workspace dir
  $candidates = @()
  if ($TensorRTInstallRoot) { $candidates += $TensorRTInstallRoot }
  $candidates += (Get-ChildItem 'C:\Program Files\NVIDIA\TensorRT-*' -Directory -ErrorAction SilentlyContinue |
                  Sort-Object Name -Descending | ForEach-Object FullName)
  $candidates += (Get-ChildItem (Join-Path $PSScriptRoot '..') -Directory -Filter 'TensorRT-*' -ErrorAction SilentlyContinue |
                  Sort-Object Name -Descending | ForEach-Object FullName)
  foreach ($c in $candidates) {
    if (-not $c) { continue }
    # TRT 10.x: DLLs are in bin\; older: lib\
    $dllBin = Join-Path $c 'bin\nvinfer_10.dll'
    $dllLib = Join-Path $c 'lib\nvinfer_10.dll'
    if (Test-Path $dllBin) {
      return [PSCustomObject]@{ Root=$c; DllDir=(Join-Path $c 'bin'); LibDir=(Join-Path $c 'lib') }
    }
    if (Test-Path $dllLib) {
      return [PSCustomObject]@{ Root=$c; DllDir=(Join-Path $c 'lib'); LibDir=(Join-Path $c 'lib') }
    }
  }
  return $null
}

function Invoke-Verify {
  Write-Section 'Verifying GPU stack'
  $ok = $true

  $driver = (& nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>$null) -join ''
  if ($driver) { Write-Host "[ok] NVIDIA driver: $driver" -ForegroundColor Green } else { Write-Host '[fail] nvidia-smi not found.' -ForegroundColor Red; $ok = $false }

  $cuda = Get-CudaInstallPath
  if ($cuda) {
    Write-Host "[ok] CUDA: $cuda" -ForegroundColor Green
    $nvcc = Join-Path $cuda 'bin\nvcc.exe'
    if (Test-Path $nvcc) {
      $v = & $nvcc --version | Select-String 'release'
      Write-Host "      $v"
    }
  } else { Write-Host '[fail] CUDA Toolkit not found.' -ForegroundColor Red; $ok = $false }

  # cuDNN: prefer legacy (merged into CUDA\bin); fall back to independent installer layout
  $cudnnLegacy = if ($cuda) { Get-ChildItem (Join-Path $cuda 'bin\cudnn*.dll') -ErrorAction SilentlyContinue } else { $null }
  if ($cudnnLegacy) {
    Write-Host "[ok] cuDNN (merged): $($cudnnLegacy.Count) dlls in $cuda\bin" -ForegroundColor Green
  } else {
    $cudnn = Get-CudnnInstallPath
    if ($cudnn) {
      Write-Host "[ok] cuDNN $($cudnn.Version): $($cudnn.BinDir)" -ForegroundColor Green
    } else {
      Write-Host '[fail] cuDNN not found. ORT CUDA EP will fail.' -ForegroundColor Red
      $ok = $false
    }
  }

  $trt = Get-TensorRTInstallPath
  if ($trt) {
    Write-Host "[ok] TensorRT: $($trt.Root)" -ForegroundColor Green
    Write-Host "      DLL dir: $($trt.DllDir)"
  } else {
    Write-Host '[warn] TensorRT not found. ORT will fall back to CUDA / DirectML / CPU.' -ForegroundColor Yellow
  }

  # PATH hints
  Write-Section 'Runtime PATH'
  $combinedPath = ([Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User'))
  $needPaths = @()
  if ($cuda) { $needPaths += (Join-Path $cuda 'bin') }
  $cudnnNow = Get-CudnnInstallPath
  if ($cudnnNow) { $needPaths += $cudnnNow.BinDir }
  if ($trt) { $needPaths += $trt.DllDir }
  foreach ($p in $needPaths) {
    if ($combinedPath -split ';' -contains $p) {
      Write-Host "[ok] on PATH: $p" -ForegroundColor Green
    } else {
      Write-Host "[miss] NOT on PATH: $p" -ForegroundColor Yellow
      Write-Host "       fix: .\\scripts\\install-cuda-stack.ps1 -Step fix-path" -ForegroundColor DarkGray
    }
  }

  if ($ok) { Write-Host "`nAll required components present." -ForegroundColor Green }
  else { Write-Host "`nSome components missing. See messages above." -ForegroundColor Yellow }
}

function Invoke-FixPath {
  Write-Section 'Appending cuDNN / TensorRT to user PATH'
  $cudnn = Get-CudnnInstallPath
  $trt = Get-TensorRTInstallPath
  $userPath = [Environment]::GetEnvironmentVariable('Path','User')
  $parts = if ([string]::IsNullOrEmpty($userPath)) { @() } else { $userPath -split ';' }
  $added = @()
  $targets = @()
  if ($cudnn) { $targets += $cudnn.BinDir }
  if ($trt) { $targets += $trt.DllDir }
  foreach ($dir in $targets) {
    if ($dir -and (Test-Path $dir) -and ($parts -notcontains $dir)) {
      $parts += $dir
      $added += $dir
    }
  }
  if ($added.Count -gt 0) {
    $new = ($parts | Where-Object { $_ }) -join ';'
    [Environment]::SetEnvironmentVariable('Path', $new, 'User')
    foreach ($d in $added) { Write-Host "[env] appended: $d" -ForegroundColor Green }
    Write-Host '(restart terminals / apps to pick up)' -ForegroundColor Yellow
  } else {
    Write-Host '[ok] nothing to add.' -ForegroundColor Green
  }
}

switch ($Step) {
  'cuda'     { Install-Cuda }
  'cudnn'    { Install-Cudnn }
  'tensorrt' { Install-TensorRT }
  'verify'   { Invoke-Verify }
  'fix-path' { Invoke-FixPath }
  'all'      { Install-Cuda; Install-Cudnn; Install-TensorRT; Invoke-Verify }
}
