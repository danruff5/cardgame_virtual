# Prefer optimized WebP copies. Falls back to junction if optimize hasn't been run.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root 'public\assets'
$report = Join-Path $dest 'optimize-report.txt'
$src = Join-Path (Split-Path -Parent $root) 'cardgame\assets'

if (Test-Path $report) {
  Write-Host "Optimized assets already present at $dest"
  exit 0
}

Write-Host "No optimized assets yet — running npm run optimize-assets…"
Push-Location $root
try {
  node ./scripts/optimize-assets.mjs
} finally {
  Pop-Location
}

if (-not (Test-Path $report)) {
  Write-Error "optimize-assets failed and no report at $report (source expected at $src)"
}
