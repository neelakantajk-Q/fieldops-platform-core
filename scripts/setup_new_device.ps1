# Installs the APK build toolchain on a fresh Windows machine (no admin rights).
# Mirrors the setup used to build FieldOps v2.0.0: JDK 17, Android SDK 34, Gradle 8.7, pbc CLI.
# Run:  powershell -ExecutionPolicy Bypass -File scripts\setup_new_device.ps1
$ErrorActionPreference = "Stop"
$root = "C:\Users\$env:USERNAME\dev-tools"
New-Item -ItemType Directory -Force -Path "$root\downloads" | Out-Null
Write-Host "Installing toolchain into $root ..."

# ---- JDK 17 (Adoptium, portable) ----
if (!(Test-Path "$root\jdk-17\bin\java.exe")) {
  curl.exe -sSL -o "$root\downloads\jdk17.zip" "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse"
  Expand-Archive "$root\downloads\jdk17.zip" "$root" -Force
  $jdk = Get-ChildItem "$root" -Directory -Filter "jdk-17*"; Rename-Item $jdk.FullName "jdk-17"
  Write-Host "JDK 17 installed."
} else { Write-Host "JDK 17 present." }

# ---- Android cmdline-tools + SDK packages ----
$sdk = "$root\android-sdk"
if (!(Test-Path "$sdk\build-tools\34.0.0\aapt2.exe")) {
  New-Item -ItemType Directory -Force -Path "$sdk\cmdline-tools" | Out-Null
  curl.exe -sSL -o "$root\downloads\cmdtools.zip" "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"
  Expand-Archive "$root\downloads\cmdtools.zip" "$root\tmp-cmdtools" -Force
  Move-Item "$root\tmp-cmdtools\cmdline-tools" "$sdk\cmdline-tools\latest" -Force
  Remove-Item "$root\tmp-cmdtools" -Recurse -Force
  $env:JAVA_HOME = "$root\jdk-17"
  $y = 1..20 | ForEach-Object { "y" }
  $y | & "$sdk\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root=$sdk --licenses *> $null
  & "$sdk\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root=$sdk "platform-tools" "platforms;android-34" "build-tools;34.0.0" *> $null
  Write-Host "Android SDK packages installed."
} else { Write-Host "Android SDK present." }

# ---- Gradle 8.7 ----
if (!(Test-Path "$root\gradle-8.7\bin\gradle.bat")) {
  curl.exe -sSL -o "$root\downloads\gradle.zip" "https://services.gradle.org/distributions/gradle-8.7-bin.zip"
  Expand-Archive "$root\downloads\gradle.zip" "$root" -Force
  Write-Host "Gradle 8.7 installed."
} else { Write-Host "Gradle present." }

# ---- pbc CLI (PocketBase Cloud) ----
if (!(Test-Path "$root\pbc\bin\pb.exe")) {
  New-Item -ItemType Directory -Force -Path "$root\pbc\bin" | Out-Null
  curl.exe -sSL -o "$root\pbc\pbc.zip" "https://github.com/pocketbasecloud/cli/releases/download/v0.9.9/pb_0.9.9_win32_x64.zip"
  curl.exe -sSL -o "$root\pbc\checksums.txt" "https://github.com/pocketbasecloud/cli/releases/download/v0.9.9/checksums.txt"
  $expected = (Get-Content "$root\pbc\checksums.txt" | Select-String "win32_x64").ToString().Split(' ')[0]
  $actual = (Get-FileHash "$root\pbc\pbc.zip" -Algorithm SHA256).Hash.ToLower()
  if ($expected -ne $actual) { throw "pbc checksum mismatch" }
  Expand-Archive "$root\pbc\pbc.zip" "$root\pbc\bin" -Force
  Remove-Item "$root\pbc\pbc.zip" -Force
  Write-Host "pbc CLI installed."
} else { Write-Host "pbc CLI present." }

# ---- Persist user env vars (new terminals) ----
[Environment]::SetEnvironmentVariable("JAVA_HOME", "$root\jdk-17", "User")
[Environment]::SetEnvironmentVariable("ANDROID_HOME", $sdk, "User")
[Environment]::SetEnvironmentVariable("ANDROID_SDK_ROOT", $sdk, "User")
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
foreach ($p in @("$root\jdk-17\bin","$sdk\platform-tools","$sdk\cmdline-tools\latest\bin","$root\gradle-8.7\bin","$root\pbc\bin")) {
  if ($userPath -notlike "*$p*") { $userPath = "$userPath;$p" }
}
[Environment]::SetEnvironmentVariable("Path", $userPath, "User")

# local.properties points AGP at the SDK (gitignored)
$lp = Join-Path $PSScriptRoot "..\app\android\local.properties"
"sdk.dir=$($sdk -replace '\\','\\\\')" | Set-Content $lp

Write-Host "`nDone. Open a NEW terminal so PATH/JAVA_HOME/ANDROID_HOME take effect."
Write-Host "Then: scripts\build_apk.ps1   |   scripts\deploy_backend_cloud.ps1   |   scripts\run_local_tests.ps1"
