# Starts a local PocketBase (0.22.x) and runs all three test suites.
# Run:  powershell -ExecutionPolicy Bypass -File scripts\run_local_tests.ps1
$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..")
$backend = Join-Path $repo "backend"

# First-time setup on a fresh pb_data:
#   & "$backend\bin\pocketbase.exe" admin create --dir "$backend\pb_data" itadmin@fieldops.local "<REDACTED>"
# (run admin create AFTER starting the server once; on an empty dir use a temp serve)

$env:PB_URL = "http://127.0.0.1:8090"
$env:PB_ADMIN_EMAIL = "itadmin@fieldops.local"
$env:PB_ADMIN_PASSWORD = $env:FIELDOPS_ADMIN_PASSWORD

$pb = "$backend\bin\pocketbase.exe"
if (!(Test-Path $pb)) {
  Write-Error "backend\bin\pocketbase.exe missing. Download v0.22.x from https://github.com/pocketbase/pocketbase/releases (see HANDOFF.md)."
}

$p = Start-Process -FilePath $pb -ArgumentList @("serve","--http=127.0.0.1:8090","--dir=$backend\pb_data","--migrationsDir=$backend\pb_migrations","--hooksDir=$backend\pb_hooks") -RedirectStandardOutput "$backend\pb_stdout.log" -RedirectStandardError "$backend\pb_stderr.log" -PassThru
Start-Sleep -Seconds 3
try {
  node (Join-Path $repo "tests\test_e2e.js")
  node (Join-Path $repo "tests\test_integration.js")
  node (Join-Path $repo "tests\test_roaming.js")
} finally {
  if ($p -and !$p.HasExited) { Stop-Process -Id $p.Id -Force }
}
