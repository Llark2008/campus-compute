param([Parameter(Mandatory=$true)][string]$Config)
$ErrorActionPreference = "Stop"
$projectDir = Split-Path -Parent $PSScriptRoot
Push-Location $projectDir
try {
  & node --import tsx src/worker/main.ts --config $Config
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
