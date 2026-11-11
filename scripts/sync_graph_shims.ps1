# Copies backend/pb_hooks/*.pb.js into graphify-shims/*.js so graphify (which does
# not recognize the .pb.js extension) indexes the hook logic in the knowledge graph.
# Run this, then `graphify update .` (PATH: %APPDATA%\Python\Python312\Scripts).
# If this script and the previous steps are unavailable on a new device,
# install once with: python -m pip install --user graphifyy
$root = Split-Path -Parent $PSScriptRoot
$shimDir = Join-Path $root "graphify-shims"
New-Item -ItemType Directory -Force -Path $shimDir | Out-Null

# Remove the previous generated shims (and any stray .pb.js copies) first.
Get-ChildItem $shimDir -File -ErrorAction SilentlyContinue | Remove-Item -Force

Get-ChildItem (Join-Path $root "backend\pb_hooks\*.pb.js") | ForEach-Object {
    $target = Join-Path $shimDir ($_.Name -replace '\.pb\.js$', '.js')
    Copy-Item $_.FullName $target -Force
}
Write-Host "graphify-shims refreshed. Now run: graphify update ."