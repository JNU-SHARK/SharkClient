[CmdletBinding()]
param(
  [ValidateSet('auto','gpu','cpu')]
  [string]$Variant = 'auto',
  [switch]$SkipSystem,
  [string]$PipIndexUrl,
  [string]$PythonVersion = '3.12.10',
  [string]$PythonInstallerUrl,
  [string]$WebView2BootstrapperUrl = 'https://go.microsoft.com/fwlink/p/?LinkId=2124703',
  [string]$VcRedistUrl = 'https://aka.ms/vs/17/release/vc_redist.x64.exe'
)

$ErrorActionPreference = 'Stop'

$script:BundleRoot = $null
$script:CacheDir = $null

function Write-Section {
  param([string]$Text)
  Write-Host ''
  Write-Host "=== $Text ===" -ForegroundColor Cyan
}

function Write-Step {
  param([string]$Text)
  Write-Host "[install-env] $Text"
}

function Get-BundleRoot {
  if ($script:BundleRoot) {
    return $script:BundleRoot
  }
  $scriptDir = Split-Path -Parent $PSCommandPath
  if (Test-Path -LiteralPath (Join-Path $scriptDir 'AI Server')) {
    $script:BundleRoot = $scriptDir
    return $script:BundleRoot
  }
  $script:BundleRoot = (Split-Path -Parent $scriptDir)
  return $script:BundleRoot
}

function Get-CacheDir {
  if ($script:CacheDir) {
    return $script:CacheDir
  }
  $script:CacheDir = Join-Path (Get-BundleRoot) 'Cache'
  New-Item -ItemType Directory -Force -Path $script:CacheDir | Out-Null
  return $script:CacheDir
}

function Get-InstallCacheDir {
  $path = Join-Path (Get-CacheDir) 'install'
  New-Item -ItemType Directory -Force -Path $path | Out-Null
  return $path
}

function Invoke-WingetInstall {
  param(
    [string]$Id,
    [string]$Name
  )

  if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
    Write-Warning "winget is not available; falling back to direct installer for $Name when possible."
    return $false
  }

  Write-Host "[winget] $Name"
  & winget.exe install -e --id $Id --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "winget could not install $Name. It may already be installed, or it may require manual installation."
    return $false
  }
  return $true
}

function Save-Url {
  param(
    [string]$Url,
    [string]$OutFile
  )

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutFile) | Out-Null
  Write-Step "download: $Url"
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $OutFile
    return
  } catch {
    if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
      & curl.exe -L --fail --retry 3 -o $OutFile $Url
      if ($LASTEXITCODE -eq 0) {
        return
      }
    }
    throw "Download failed: $Url"
  }
}

function Invoke-Installer {
  param(
    [string]$Path,
    [string[]]$Arguments,
    [string]$Name
  )

  Write-Step "installing $Name"
  $proc = Start-Process -FilePath $Path -ArgumentList $Arguments -Wait -PassThru
  if ($proc.ExitCode -ne 0 -and $proc.ExitCode -ne 3010) {
    throw "$Name installer exited with code $($proc.ExitCode)."
  }
}

function Test-WebView2Runtime {
  $clientGuid = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
  $keys = @(
    "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$clientGuid",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$clientGuid",
    "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$clientGuid"
  )
  foreach ($key in $keys) {
    try {
      $pv = (Get-ItemProperty -LiteralPath $key -ErrorAction Stop).pv
      if ($pv) { return $true }
    } catch {}
  }
  return $false
}

function Install-WebView2Runtime {
  if (Test-WebView2Runtime) {
    Write-Step 'WebView2 Runtime already installed'
    return
  }

  $installedByWinget = Invoke-WingetInstall -Id 'Microsoft.EdgeWebView2Runtime' -Name 'Microsoft Edge WebView2 Runtime'
  if ($installedByWinget -and (Test-WebView2Runtime)) {
    return
  }

  $cacheDir = Get-InstallCacheDir
  $installer = Join-Path $cacheDir 'MicrosoftEdgeWebview2Setup.exe'
  Save-Url -Url $WebView2BootstrapperUrl -OutFile $installer
  Invoke-Installer -Path $installer -Arguments @('/silent', '/install') -Name 'Microsoft Edge WebView2 Runtime'
}

function Install-VcRedist {
  $installedByWinget = Invoke-WingetInstall -Id 'Microsoft.VCRedist.2015+.x64' -Name 'Microsoft Visual C++ Runtime'
  if ($installedByWinget) {
    return
  }

  $cacheDir = Get-InstallCacheDir
  $installer = Join-Path $cacheDir 'vc_redist.x64.exe'
  try {
    Save-Url -Url $VcRedistUrl -OutFile $installer
    Invoke-Installer -Path $installer -Arguments @('/install', '/quiet', '/norestart') -Name 'Microsoft Visual C++ Runtime'
  } catch {
    Write-Warning "VC++ Runtime auto-install failed: $_"
  }
}

function Get-PythonInstallerUrl {
  if ($PythonInstallerUrl) {
    return $PythonInstallerUrl
  }

  switch ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()) {
    'Arm64' { return "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-arm64.exe" }
    'X86'   { return "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion.exe" }
    default { return "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-amd64.exe" }
  }
}

function Get-KnownPythonCandidates {
  $paths = @()
  if ($env:LOCALAPPDATA) {
    $paths += Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'
  }
  if ($env:ProgramFiles) {
    $paths += Join-Path $env:ProgramFiles 'Python312\python.exe'
  }
  $programFilesX86 = ${env:ProgramFiles(x86)}
  if ($programFilesX86) {
    $paths += Join-Path $programFilesX86 'Python312-32\python.exe'
  }
  return $paths
}

function Set-PythonCommand {
  $candidates = @()
  foreach ($path in Get-KnownPythonCandidates) {
    $candidates += @{ Exe = $path; Args = @() }
  }
  $candidates += @(
    @{ Exe = 'py.exe'; Args = @('-3.12') },
    @{ Exe = 'py.exe'; Args = @('-3') },
    @{ Exe = 'python.exe'; Args = @() },
    @{ Exe = 'python'; Args = @() }
  )

  foreach ($candidate in $candidates) {
    $isPath = [IO.Path]::IsPathRooted($candidate.Exe)
    if ($isPath) {
      if (-not (Test-Path -LiteralPath $candidate.Exe)) { continue }
    } elseif (-not (Get-Command $candidate.Exe -ErrorAction SilentlyContinue)) {
      continue
    }
    try {
      & $candidate.Exe @($candidate.Args) --version *> $null
      if ($LASTEXITCODE -eq 0) {
        $script:PythonExe = $candidate.Exe
        $script:PythonArgs = @($candidate.Args)
        return $true
      }
    } catch {
      continue
    }
  }
  return $false
}

function Install-Python {
  if (Set-PythonCommand) {
    return
  }

  $installedByWinget = Invoke-WingetInstall -Id 'Python.Python.3.12' -Name 'Python 3.12'
  if ($installedByWinget -and (Set-PythonCommand)) {
    return
  }

  $cacheDir = Get-InstallCacheDir
  $installer = Join-Path $cacheDir ("python-$PythonVersion-installer.exe")
  Save-Url -Url (Get-PythonInstallerUrl) -OutFile $installer
  Invoke-Installer -Path $installer -Arguments @(
    '/quiet',
    'InstallAllUsers=0',
    'PrependPath=0',
    'Include_pip=1',
    'Include_launcher=1',
    'Include_test=0',
    'Include_doc=0',
    'Include_tcltk=0'
  ) -Name "Python $PythonVersion"

  if (-not (Set-PythonCommand)) {
    throw 'Python was installed but could not be located. Please restart this terminal and run install-env.bat again.'
  }
}

function Invoke-HostPython {
  param([string[]]$Arguments)
  $allArgs = @($script:PythonArgs) + @($Arguments)
  & $script:PythonExe @allArgs
}

function Get-ResolvedVariant {
  param([string]$Requested)
  if ($Requested -ne 'auto') {
    return $Requested
  }
  if ($env:ONNX_PROVIDER -and $env:ONNX_PROVIDER.ToLowerInvariant() -eq 'cpu') {
    return 'cpu'
  }
  return 'gpu'
}

function New-ResolvedRequirements {
  param(
    [string]$Source,
    [string]$Provider
  )

  $target = Join-Path (Get-InstallCacheDir) ("shark-ai-requirements-{0}-{1}.txt" -f $Provider, [Guid]::NewGuid().ToString('N'))
  $lines = Get-Content -LiteralPath $Source
  $resolved = foreach ($line in $lines) {
    if ($Provider -eq 'cpu' -and $line -match '^\s*onnxruntime-gpu\b') {
      'onnxruntime==1.23.2'
    } else {
      $line
    }
  }
  Set-Content -LiteralPath $target -Value $resolved -Encoding UTF8
  return $target
}

$bundleRoot = Get-BundleRoot
$aiRoot = Join-Path $bundleRoot 'AI Server'
$requirements = Join-Path $aiRoot 'requirements.txt'
$venvDir = Join-Path $bundleRoot '.venv'
$venvPython = Join-Path $venvDir 'Scripts\python.exe'
$resolvedVariant = Get-ResolvedVariant -Requested $Variant
$cacheDir = Get-CacheDir
$installCacheDir = Get-InstallCacheDir
$env:SHARK_CACHE_DIR = $cacheDir
$env:PIP_CACHE_DIR = Join-Path $cacheDir 'pip'
$env:PYTHONPYCACHEPREFIX = Join-Path $cacheDir 'pycache'
$env:TEMP = $installCacheDir
$env:TMP = $installCacheDir

Write-Section 'SharkClient environment'
Write-Host "[root]    $bundleRoot"
Write-Host "[variant] $resolvedVariant"
Write-Host "[cache]   $cacheDir"

if (-not (Test-Path -LiteralPath $requirements)) {
  throw "requirements.txt not found: $requirements"
}

if (-not $SkipSystem) {
  Write-Section 'System runtime'
  Install-WebView2Runtime
  Install-VcRedist
  Install-Python
}

Install-Python

Write-Section 'Python virtual environment'
if (-not (Test-Path -LiteralPath $venvPython)) {
  Write-Host "[venv] creating $venvDir"
  Invoke-HostPython -Arguments @('-m', 'venv', $venvDir)
  if ($LASTEXITCODE -ne 0) {
    throw 'Failed to create Python virtual environment.'
  }
} else {
  Write-Host "[venv] using existing $venvDir"
}

Write-Section 'Python packages'
& $venvPython -m pip install --upgrade pip setuptools wheel
if ($LASTEXITCODE -ne 0) {
  throw 'Failed to upgrade pip.'
}

$resolvedRequirements = New-ResolvedRequirements -Source $requirements -Provider $resolvedVariant
try {
  $pipArgs = @('-m', 'pip', 'install', '-r', $resolvedRequirements)
  if ($PipIndexUrl) {
    $pipArgs += @('-i', $PipIndexUrl)
  }
  & $venvPython @pipArgs
  if ($LASTEXITCODE -ne 0 -and -not $PipIndexUrl) {
    Write-Warning 'pip install failed, retrying with Tsinghua PyPI mirror...'
    & $venvPython @pipArgs -i 'https://pypi.tuna.tsinghua.edu.cn/simple'
  }
  if ($LASTEXITCODE -ne 0) {
    throw 'Failed to install AI Python dependencies.'
  }
} finally {
  Remove-Item -LiteralPath $resolvedRequirements -Force -ErrorAction SilentlyContinue
}

Write-Section 'Verify'
& $venvPython -c "import numpy, cv2, PIL, onnxruntime as ort; print('onnxruntime providers:', ort.get_available_providers())"
if ($LASTEXITCODE -ne 0) {
  throw 'Python dependency verification failed.'
}

Write-Host ''
Write-Host '[done] Environment is ready. Start the client with run.bat.' -ForegroundColor Green
