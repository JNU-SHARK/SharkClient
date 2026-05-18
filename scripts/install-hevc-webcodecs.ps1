[CmdletBinding()]
param(
  [switch]$OpenStoreOnly
)

$ErrorActionPreference = 'Stop'

$productId = '9NMZLZ57R3T7'
$storeUri = "ms-windows-store://pdp/?productid=$productId"
$storeWebUrl = "https://apps.microsoft.com/detail/$productId"
$packageNames = @(
  'Microsoft.HEVCVideoExtensions',
  'Microsoft.HEVCVideoExtension'
)

function Get-HevcExtensionPackage {
  foreach ($name in $packageNames) {
    $pkg = Get-AppxPackage -Name $name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($pkg) {
      return $pkg
    }
  }

  try {
    return Get-AppxPackage -AllUsers -ErrorAction SilentlyContinue |
      Where-Object {
        $_.Name -like 'Microsoft.HEVC*' -or
        $_.PackageFamilyName -like 'Microsoft.HEVC*'
      } |
      Select-Object -First 1
  } catch {
    return $null
  }
}

function Open-HevcStorePage {
  Write-Host "Opening Microsoft Store page for HEVC Video Extensions..."
  try {
    Start-Process $storeUri
  } catch {
    Write-Warning "Could not open Store URI. Opening web page instead: $storeWebUrl"
    Start-Process $storeWebUrl
  }
}

$existing = Get-HevcExtensionPackage
if ($existing) {
  Write-Host "HEVC Video Extensions already installed:"
  Write-Host "  Name   : $($existing.Name)"
  Write-Host "  Version: $($existing.Version)"
  Write-Host "Restart the client, then select UDP codec: H.265 (HEVC) to test WebCodecs."
  exit 0
}

Write-Host "HEVC Video Extensions are not installed."
Write-Host "Product ID: $productId"

if ($OpenStoreOnly) {
  Open-HevcStorePage
  exit 0
}

$winget = Get-Command winget -ErrorAction SilentlyContinue
if ($winget) {
  Write-Host "Trying winget install from Microsoft Store source..."
  & $winget.Source install --id $productId --source msstore --accept-source-agreements --accept-package-agreements
  $wingetExit = $LASTEXITCODE

  $existing = Get-HevcExtensionPackage
  if ($existing) {
    Write-Host "HEVC Video Extensions installed:"
    Write-Host "  Name   : $($existing.Name)"
    Write-Host "  Version: $($existing.Version)"
    Write-Host "Restart the client, then select UDP codec: H.265 (HEVC) to test WebCodecs."
    exit 0
  }

  Write-Warning "winget did not complete the HEVC install (exit code: $wingetExit)."
}

Write-Host "Falling back to the official Microsoft Store page."
Write-Host "If the Store asks for purchase/sign-in, complete it there. The codec is a Windows Store media extension and cannot be redistributed as app files."
Open-HevcStorePage
