# Copies backend/pb_hooks/*.pb.js into graphify-shims/*.js so graphify (which does
# not recognize the .pb.js extension) indexes the hook logic in the knowledge graph.
# Run this, then `graphify update .` (PATH: %APPDATA%\Python\Python312\Scripts).
# If this script and the previous steps are unavailable on a new device,
# install once with: python -m pip install --user graphifyy
$root = Split-Path -Parent $PSScriptRoot
Copy-Item (Join-Path $root "backend\pb_hooks\*.pb.js") (Join-Path $root "graphify-shims\") -Force
Get-ChildItem (Join-Path $root "graphify-shims") | Rename-Item -NewName { $_.Name -replace '\.pb\.js$', '.js' }
Write-Host "graphify-shims refreshed. Now run: graphify update ."
