# Link print-and-play art from the sibling cardgame project (art/frames/icons only).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root 'public\assets'
$src = Join-Path (Split-Path -Parent $root) 'cardgame\assets'

if (-not (Test-Path $src)) {
  Write-Error "Expected art at $src — open the main cardgame project beside cardgame_virtual."
}

function Remove-Path($path) {
  if (-not (Test-Path $path)) { return }
  cmd /c "rmdir `"$path`"" 2>$null | Out-Null
  if (Test-Path $path) { Remove-Item $path -Recurse -Force }
}

Remove-Path $dest
New-Item -ItemType Directory -Path $dest -Force | Out-Null

foreach ($name in @('art', 'frames', 'icons')) {
  $from = Join-Path $src $name
  $to = Join-Path $dest $name
  if (-not (Test-Path $from)) {
    Write-Warning "Missing $from"
    continue
  }
  cmd /c "mklink /J `"$to`" `"$from`""
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Junction failed for $name; copying…"
    Copy-Item -Path $from -Destination $to -Recurse -Force
  }
}

Write-Host "Assets ready at $dest (art, frames, icons)"
