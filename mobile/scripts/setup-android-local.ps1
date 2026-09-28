# One-time setup for building the Android app on this PC instead of on EAS.
#
# Installs what a local build needs, and nothing else:
#   - Java 17 (Microsoft's build of OpenJDK), through winget
#   - the Android SDK command-line tools, into %LOCALAPPDATA%\Android\Sdk
#   - the SDK parts this app compiles against: platform 34, build-tools 34,
#     NDK 26.1 and CMake 3.22 (what React Native 0.74 / Expo SDK 51 expect)
# and sets JAVA_HOME and ANDROID_HOME for your user.
#
# Safe to run again: anything already installed is skipped.
#
#   pwsh -ExecutionPolicy Bypass -File scripts\setup-android-local.ps1
#
# Then build with scripts\build-local.ps1.
$ErrorActionPreference = 'Stop'

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "   $text" -ForegroundColor Green }

$sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$sdkPackages = @(
  'platform-tools',
  'platforms;android-34',
  'build-tools;34.0.0',
  'ndk;26.1.10909125',
  'cmake;3.22.1'
)
# An old, fixed release of the command-line tools: Google keeps every one of
# these downloadable, and sdkmanager updates itself afterwards if it needs to.
$toolsZip = 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip'

# ---------------------------------------------------------------- Java 17
Step 'Java 17'
function Find-Jdk17 {
  $roots = @("$env:ProgramFiles\Microsoft", "$env:ProgramFiles\Eclipse Adoptium", "$env:ProgramFiles\Java")
  foreach ($root in $roots) {
    if (Test-Path $root) {
      $found = Get-ChildItem $root -Directory -Filter 'jdk-17*' -ErrorAction SilentlyContinue |
        Sort-Object Name | Select-Object -Last 1
      if ($found -and (Test-Path (Join-Path $found.FullName 'bin\java.exe'))) { return $found.FullName }
    }
  }
  return $null
}

$jdk = Find-Jdk17
if (-not $jdk) {
  Write-Host '   Installing Microsoft OpenJDK 17 (Windows may ask for permission)...'
  winget install --id Microsoft.OpenJDK.17 -e --silent --accept-source-agreements --accept-package-agreements
  $jdk = Find-Jdk17
  if (-not $jdk) { throw 'Java 17 did not install. Run: winget install --id Microsoft.OpenJDK.17 -e' }
}
$env:JAVA_HOME = $jdk
[Environment]::SetEnvironmentVariable('JAVA_HOME', $jdk, 'User')
Ok "JAVA_HOME = $jdk"

# ------------------------------------------------- Android command-line tools
Step 'Android SDK command-line tools'
$sdkmanager = Join-Path $sdk 'cmdline-tools\latest\bin\sdkmanager.bat'
if (-not (Test-Path $sdkmanager)) {
  $zip = Join-Path $env:TEMP 'android-cmdline-tools.zip'
  $unpacked = Join-Path $env:TEMP 'android-cmdline-tools'
  Write-Host '   Downloading (about 150 MB)...'
  Invoke-WebRequest $toolsZip -OutFile $zip -UseBasicParsing
  if (Test-Path $unpacked) { Remove-Item $unpacked -Recurse -Force }
  Expand-Archive $zip -DestinationPath $unpacked
  # The zip holds cmdline-tools\bin, ...; sdkmanager insists on living in
  # cmdline-tools\latest\bin, or it cannot work out where the SDK is.
  New-Item -ItemType Directory -Force (Join-Path $sdk 'cmdline-tools') | Out-Null
  Move-Item (Join-Path $unpacked 'cmdline-tools') (Join-Path $sdk 'cmdline-tools\latest')
  Remove-Item $zip, $unpacked -Recurse -Force -ErrorAction SilentlyContinue
}
$env:ANDROID_HOME = $sdk
[Environment]::SetEnvironmentVariable('ANDROID_HOME', $sdk, 'User')
Ok "ANDROID_HOME = $sdk"

# ------------------------------------------------------------- SDK packages
Step 'Android SDK licences'
# sdkmanager asks y/N for each licence; this answers yes to all of them.
((1..40 | ForEach-Object { 'y' }) -join "`n") | & $sdkmanager --sdk_root=$sdk --licenses | Out-Null
Ok 'accepted'

Step 'Android SDK packages (a few GB the first time)'
& $sdkmanager --sdk_root=$sdk @sdkPackages
if ($LASTEXITCODE -ne 0) { throw 'sdkmanager failed to install the SDK packages (see above).' }
Ok ($sdkPackages -join ', ')

# ---------------------------------------------------------- PATH for adb
Step 'adb on your PATH'
$platformTools = Join-Path $sdk 'platform-tools'
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not ($userPath -split ';' | Where-Object { $_ -eq $platformTools })) {
  [Environment]::SetEnvironmentVariable('Path', (($userPath.TrimEnd(';'), $platformTools) -join ';'), 'User')
}
Ok $platformTools

# ------------------------------------------------------------- long paths
Step 'Long file paths'
# The C++ parts of React Native build under paths that can pass Windows' old
# 260-character limit. Turning the limit off needs an administrator.
$fs = Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem'
if ($fs.LongPathsEnabled -eq 1) {
  Ok 'already on'
} else {
  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
  if ($admin) {
    Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name LongPathsEnabled -Value 1
    Ok 'turned on'
  } else {
    Write-Host '   Off. In a PowerShell opened as administrator, run once:' -ForegroundColor Yellow
    Write-Host "   Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name LongPathsEnabled -Value 1" -ForegroundColor Yellow
  }
}

$mobile = Split-Path -Parent $PSScriptRoot
Write-Host "`nDone. Close this window and open a new one, so JAVA_HOME and ANDROID_HOME apply, then run:" -ForegroundColor Green
Write-Host "   cd $mobile"
Write-Host '   pwsh -ExecutionPolicy Bypass -File scripts\build-local.ps1'
