# Builds the debug APK. Output: app\android\app\build\outputs\apk\debug\app-debug.apk
# (copy to repo root with the second command if you want it committed.)
$ErrorActionPreference = "Stop"
$env:JAVA_HOME = if ($env:JAVA_HOME) { $env:JAVA_HOME } else { "C:\Users\$env:USERNAME\dev-tools\jdk-17" }
$env:ANDROID_HOME = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "C:\Users\$env:USERNAME\dev-tools\android-sdk" }
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME

$gradle = "$env:USERPROFILE\dev-tools\gradle-8.7\bin\gradle.bat"
$androidDir = Join-Path $PSScriptRoot "..\app\android"
$dist = Join-Path $PSScriptRoot "..\web-client\dist"
$portal = Join-Path $androidDir "app\src\main\assets\portal"

# Bundled offline fallback must match the latest web-client build.
if (Test-Path $dist) {
  if (Test-Path $portal) { Remove-Item $portal -Recurse -Force }
  New-Item -ItemType Directory -Path $portal | Out-Null
  Copy-Item (Join-Path $dist "*") $portal -Recurse -Force
  Write-Host "Bundled web-client\dist -> assets\portal"
} else {
  Write-Warning "web-client\dist not found; run 'npm run build' in web-client first."
}

$apk = Join-Path $androidDir "app\build\outputs\apk\debug\app-debug.apk"
if (Test-Path $apk) { Remove-Item $apk -Force }

# -p is required: the caller's working directory is the repo root, not app\android.
if (Test-Path (Join-Path $androidDir "gradlew.bat")) {
  & (Join-Path $androidDir "gradlew.bat") -p $androidDir assembleDebug --no-daemon
} else {
  & $gradle -p $androidDir assembleDebug --no-daemon
}
if ($LASTEXITCODE -ne 0) { throw "Gradle build failed with exit code $LASTEXITCODE" }

if (Test-Path $apk) {
  Copy-Item $apk (Join-Path $PSScriptRoot "..\FieldOps-v2.2.0-debug.apk") -Force
  Write-Host "`nAPK copied to repo root: FieldOps-v2.2.0-debug.apk"
  Write-Host "Install: adb install -r FieldOps-v2.2.0-debug.apk"
}

