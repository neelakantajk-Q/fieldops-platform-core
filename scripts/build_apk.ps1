# Builds the debug APK. Output: app\android\app\build\outputs\apk\debug\app-debug.apk
# (copy to repo root with the second command if you want it committed.)
$ErrorActionPreference = "Stop"
$env:JAVA_HOME = if ($env:JAVA_HOME) { $env:JAVA_HOME } else { "C:\Users\$env:USERNAME\dev-tools\jdk-17" }
$env:ANDROID_HOME = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "C:\Users\$env:USERNAME\dev-tools\android-sdk" }
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME

$gradle = "$env:USERPROFILE\dev-tools\gradle-8.7\bin\gradle.bat"
$androidDir = Join-Path $PSScriptRoot "..\app\android"

if (Test-Path (Join-Path $androidDir "gradlew.bat")) {
  & (Join-Path $androidDir "gradlew.bat") assembleDebug --no-daemon
} else {
  & $gradle assembleDebug --no-daemon
}

$apk = Join-Path $androidDir "app\build\outputs\apk\debug\app-debug.apk"
if (Test-Path $apk) {
  Copy-Item $apk (Join-Path $PSScriptRoot "..\FieldOps-v2.0.0-debug.apk") -Force
  Write-Host "`nAPK copied to repo root: FieldOps-v2.0.0-debug.apk"
  Write-Host "Install: adb install -r FieldOps-v2.0.0-debug.apk"
}
