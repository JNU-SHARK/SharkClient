[CmdletBinding()]
param(
  [int]$Samples = 32,
  [int]$WorkspaceGb = 2,
  [int]$Width = 640,
  [int]$Height = 640,
  [switch]$SkipPlan
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$env:PYTHONUTF8 = '1'

$trtDir = Get-ChildItem -LiteralPath $repoRoot -Directory -Filter 'TensorRT-*' -ErrorAction SilentlyContinue |
  Sort-Object Name -Descending |
  Select-Object -First 1
if ($trtDir) {
  $trtBin = Join-Path $trtDir.FullName 'bin'
  if (Test-Path -LiteralPath $trtBin) {
    $env:PATH = "$trtBin;$env:PATH"
  }
}

$scriptPath = Join-Path $PSScriptRoot 'quantize-tensorrt.py'
$argsList = @(
  $scriptPath,
  '--samples', $Samples,
  '--workspace-gb', $WorkspaceGb,
  '--width', $Width,
  '--height', $Height
)

if ($SkipPlan) {
  $argsList += '--skip-plan'
}

python @argsList
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
