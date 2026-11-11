# Builds web-client against PocketBase Cloud and deploys it to PocketBase
# Cloud frontend hosting. Live site: https://cj0jzgjbxy8nywl.pwz5.pocketbasecloud.com
# Run: powershell -ExecutionPolicy Bypass -File scripts\deploy_frontend_cloud.ps1
$ErrorActionPreference = "Stop"
$pbc = "$env:USERPROFILE\dev-tools\pbc\bin\pb.exe"
if (!(Test-Path $pbc)) { $pbc = "pb" }

$keysFile = Join-Path $PSScriptRoot "..\KEYS_AND_ACCESS.md"
$token = ((Get-Content $keysFile | Where-Object { $_ -match '^eyJ' } | Select-Object -First 1)).Trim()
if (-not $token) { throw "Paste the pbc token into KEYS_AND_ACCESS.md (line starting with eyJ)." }

$env:VITE_API_BASE_URL = "https://wzc6r4fspi7fdd2.pwz5.pocketbasecloud.com"

& $pbc login --token $token
& $pbc project use j2nnf0udodj4kuc

Push-Location (Join-Path $PSScriptRoot "..\web-client")
npm ci
npm run build
if (-not (Select-String -Path "dist\assets\*.js" -Pattern "wzc6r4fspi7fdd2" -Quiet -SimpleMatch)) {
  throw "Build did not bake the PocketBase Cloud URL (VITE_API_BASE_URL)."
}
& $pbc frontend deploy --name fieldops-web --no-input
Pop-Location

Write-Host "`nFrontend deployed: https://cj0jzgjbxy8nywl.pwz5.pocketbasecloud.com"