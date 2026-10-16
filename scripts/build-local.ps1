# Local-only build script (NOT tracked: see .gitignore).
# Generic build: npm install && npx tsc -p tsconfig.json   (or scripts/build.sh)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$checkout = if ($env:DSH_CHECKOUT) { $env:DSH_CHECKOUT } else { 'C:\Users\Kilometer\dsh-harness' }
$tsc = Join-Path $checkout 'node_modules\.bin\tsc.cmd'
if (-not (Test-Path $tsc)) { throw "tsc not found: $tsc (set DSH_CHECKOUT)" }
Push-Location $root
try {
  & $tsc -p tsconfig.json
  if ($LASTEXITCODE -ne 0) { throw "tsc failed (exit $LASTEXITCODE)" }
  Write-Host "built: $root\lib"
} finally { Pop-Location }
