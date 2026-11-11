# Deploys backend hooks + migrations to the PocketBase Cloud instance.
# Token + ids come from KEYS_AND_ACCESS.md (committed for handoff).
# Run:  powershell -ExecutionPolicy Bypass -File scripts\deploy_backend_cloud.ps1
$ErrorActionPreference = "Stop"
$pbc = "$env:USERPROFILE\dev-tools\pbc\bin\pb.exe"
if (!(Test-Path $pbc)) { $pbc = "pb" }  # fall back to PATH

$keysFile = Join-Path $PSScriptRoot "..\KEYS_AND_ACCESS.md"
$token = ((Get-Content $keysFile | Where-Object { $_ -match '^eyJ' } | Select-Object -First 1)).Trim()
$projectId = "j2nnf0udodj4kuc"

if (-not $token) { throw "Paste the pbc token into KEYS_AND_ACCESS.md (line starting with eyJ)." }

& $pbc login --token $token
& $pbc project use $projectId

# backend/pbc.json pins PocketBase 0.22.32; pb_hooks + pb_migrations deploy from backend/
$backend = Join-Path $PSScriptRoot "..\backend"
Push-Location $backend
& $pbc pocketbase deploy --name fieldops-db --no-input
# Deploy uploads NEW hook files but may leave them inactive (blank ACTIVE in
# `pbc pocketbase hooks ls`, routes 404). Hook push activates every hook.
& $pbc pocketbase hooks push pb_hooks
& $pbc pocketbase hooks ls
Pop-Location

Write-Host "`nDeployed. Instance: https://wzc6r4fspi7fdd2.pwz5.pocketbasecloud.com"
Write-Host "If migrations changed, they apply on the restart that follows the deploy."
