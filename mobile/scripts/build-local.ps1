# Builds the Android APK on this PC: no EAS build, no monthly build limit.
#
# The APK is signed with the same key EAS signs with (downloaded once into
# credentials.json), so it installs over the app already on the phones with
# nothing lost, and EAS builds can go on installing over it later.
#
# First time only:
#   1. pwsh -ExecutionPolicy Bypass -File scripts\setup-android-local.ps1
#   2. eas credentials -p android   (see "No credentials.json" below)
#
# Every build:
#   pwsh -ExecutionPolicy Bypass -File scripts\build-local.ps1
#   ... -Install        also install it on every phone plugged in over USB
#   ... -AllAbis        build for every CPU type, not just 64-bit ARM phones
#   ... -ApiUrl http://100.x.y.z:4000   use this server address instead of
#                                       this PC's Tailscale address
param(
  [switch]$Install,
  [switch]$AllAbis,
  [string]$ApiUrl
)
$ErrorActionPreference = 'Stop'

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "   $text" -ForegroundColor Green }
function Fail($text) { Write-Host "`n$text" -ForegroundColor Red; exit 1 }

$mobile = Split-Path -Parent $PSScriptRoot
Set-Location $mobile

# ------------------------------------------------------------- the tools
Step 'Checking the tools'
foreach ($name in 'JAVA_HOME', 'ANDROID_HOME') {
  if (-not [Environment]::GetEnvironmentVariable($name, 'Process')) {
    [Environment]::SetEnvironmentVariable($name, [Environment]::GetEnvironmentVariable($name, 'User'), 'Process')
  }
}
if (-not $env:JAVA_HOME -or -not (Test-Path "$env:JAVA_HOME\bin\java.exe")) {
  Fail 'Java 17 is not set up. Run scripts\setup-android-local.ps1 first, then open a new PowerShell window.'
}
if (-not $env:ANDROID_HOME -or -not (Test-Path "$env:ANDROID_HOME\platforms\android-34")) {
  Fail 'The Android SDK is not set up. Run scripts\setup-android-local.ps1 first, then open a new PowerShell window.'
}
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"
Ok "Java:        $env:JAVA_HOME"
Ok "Android SDK: $env:ANDROID_HOME"

if (-not (Test-Path 'node_modules\expo')) { Fail 'node_modules is missing. Run: npm ci' }
if (-not (Test-Path 'google-services.json')) {
  Fail 'google-services.json is missing from the mobile folder, so push notifications would not work. See docs\NOTIFICATIONS.md.'
}

# ----------------------------------------------- native code matches runtime
Step 'Checking the native code matches its runtime version'
$check = node -e "const {fingerprint}=require('./scripts/native-fingerprint');const r=require('./runtime.json');const f=fingerprint();process.stdout.write((r[f.runtimeVersion]===f.hash?'ok ':'mismatch ')+f.runtimeVersion+' '+f.hash)"
if (-not $check.StartsWith('ok')) {
  Fail "Native code does not match its recorded runtime ($check). Run 'npm ci' and try again; if it still fails, runtimeVersion in app.json needs bumping."
}
Ok "runtime $($check.Split(' ')[1])"

# -------------------------------------------------------- the signing key
Step 'Loading the signing key'
if (-not (Test-Path 'credentials.json')) {
  Fail @'
No credentials.json. Download the signing key EAS already uses, once:

   eas credentials -p android
     -> pick the "preview" build profile
     -> "credentials.json: Upload/Download credentials between EAS servers and your local json"
     -> "Download credentials from EAS to credentials.json"

That writes credentials.json and credentials\android\keystore.jks here. Both
are private (git ignores them). Then run this script again.
'@
}
$keystore = (Get-Content 'credentials.json' -Raw | ConvertFrom-Json).android.keystore
if (-not $keystore) { Fail 'credentials.json has no android.keystore section. Download it again (see above).' }
$keystoreFile = Join-Path $mobile $keystore.keystorePath
if (-not (Test-Path $keystoreFile)) { Fail "The keystore named in credentials.json is not there: $keystoreFile" }
# prebuild --clean deletes android\. A keystore kept in there would go with it.
if ((Resolve-Path $keystoreFile).Path.StartsWith((Join-Path $mobile 'android'))) {
  New-Item -ItemType Directory -Force 'credentials\android' | Out-Null
  Copy-Item $keystoreFile 'credentials\android\keystore.jks' -Force
  $keystoreFile = Join-Path $mobile 'credentials\android\keystore.jks'
}
$keystoreFile = (Resolve-Path $keystoreFile).Path
foreach ($value in $keystore.keystorePassword, $keystore.keyAlias, $keystore.keyPassword) {
  # They go to gradlew.bat on its command line, where cmd would mangle & | ^ % < >.
  if ($value -notmatch '^[A-Za-z0-9._@-]+$') {
    Fail 'The keystore password or alias has characters this script cannot pass to Gradle safely. Build with EAS instead.'
  }
}
Ok "$keystoreFile (alias $($keystore.keyAlias))"

# ------------------------------------------------------ the server address
Step 'Server address'
if (-not $ApiUrl) {
  $tailscale = "$env:ProgramFiles\Tailscale\tailscale.exe"
  if (-not (Test-Path $tailscale)) { Fail 'Tailscale is not installed here. Pass the address: -ApiUrl http://100.x.y.z:4000' }
  $ip = (& $tailscale ip -4 | Select-Object -First 1).Trim()
  if ($ip -notmatch '^100\.') { Fail "Tailscale did not give an address ($ip). Is it connected? Or pass -ApiUrl." }
  $ApiUrl = "http://${ip}:4000"
}
Ok 'from Tailscale (baked into the app, never written to a file)'

# ------------------------------------------------------------------ build
$commit = (git rev-parse HEAD).Trim()
$version = node -p "require('./app.json').expo.version"
$abis = if ($AllAbis) { 'armeabi-v7a,arm64-v8a,x86,x86_64' } else { 'arm64-v8a' }

$saved = @{}
$buildEnv = @{
  EXPO_PUBLIC_API_URL = $ApiUrl
  # Shown on the Diagnostics screen, as an EAS build would show it.
  EAS_BUILD_GIT_COMMIT_HASH = $commit
  # Lets `npm run ship` updates reach this build (see app.config.js).
  LOVERSROCK_UPDATE_CHANNEL = 'preview'
  NODE_ENV = 'production'
  CI = '1'
  EXPO_NO_GIT_STATUS = '1'
}
foreach ($k in $buildEnv.Keys) {
  $saved[$k] = [Environment]::GetEnvironmentVariable($k, 'Process')
  [Environment]::SetEnvironmentVariable($k, $buildEnv[$k], 'Process')
}

try {
  Step 'Generating the Android project (expo prebuild)'
  npx expo prebuild --platform android --clean --no-install
  if ($LASTEXITCODE -ne 0) { Fail 'expo prebuild failed (see above).' }

  Step "Compiling ($abis). The first build takes 15-30 minutes; later ones are much faster"
  Push-Location android
  try {
    .\gradlew.bat assembleRelease --no-daemon `
      "-PreactNativeArchitectures=$abis" `
      "-Pandroid.injected.signing.store.file=$keystoreFile" `
      "-Pandroid.injected.signing.store.password=$($keystore.keystorePassword)" `
      "-Pandroid.injected.signing.key.alias=$($keystore.keyAlias)" `
      "-Pandroid.injected.signing.key.password=$($keystore.keyPassword)"
    if ($LASTEXITCODE -ne 0) { Fail 'The Gradle build failed (see above).' }
  } finally {
    Pop-Location
  }
} finally {
  foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k], 'Process') }
}

$built = 'android\app\build\outputs\apk\release\app-release.apk'
if (-not (Test-Path $built)) { Fail "The build finished but there is no APK at $built." }

# -------------------------------------------- signed with the right key?
Step 'Checking the APK is signed with the EAS key'
# If it were not, Android would refuse to install it over the app on the
# phones, or you would have to uninstall and lose what the app has saved.
$keyInfo = & "$env:JAVA_HOME\bin\keytool.exe" -list -v -keystore $keystoreFile -alias $keystore.keyAlias `
  -storepass $keystore.keystorePassword | Select-String 'SHA256:\s*([0-9A-Fa-f:]+)' | Select-Object -First 1
$buildTools = Get-ChildItem "$env:ANDROID_HOME\build-tools" -Directory | Sort-Object Name | Select-Object -Last 1
$apkInfo = & (Join-Path $buildTools.FullName 'apksigner.bat') verify --print-certs $built |
  Select-String 'SHA-256 digest:\s*([0-9a-f]+)' | Select-Object -First 1
if (-not $keyInfo -or -not $apkInfo) { Fail 'Could not read the signing fingerprints to compare. Do not install this APK over the existing app.' }
$want = $keyInfo.Matches[0].Groups[1].Value
$got = $apkInfo.Matches[0].Groups[1].Value
if (($want -replace ':', '').ToLower() -ne $got.ToLower()) {
  Fail "The APK is NOT signed with the EAS key (APK $got, key $want). Do not install it over the existing app."
}
Ok 'yes'

New-Item -ItemType Directory -Force 'dist' | Out-Null
$apk = Join-Path $mobile "dist\loversrock-$version-$($commit.Substring(0, 7)).apk"
Copy-Item $built $apk -Force
Write-Host "`nBuilt: $apk" -ForegroundColor Green
Write-Host '   Copy it to each phone and open it, or plug a phone in and run this again with -Install.'

# ---------------------------------------------------------------- install
if ($Install) {
  Step 'Installing on connected phones'
  $devices = adb devices | Select-String '^(\S+)\s+device$' | ForEach-Object { $_.Matches[0].Groups[1].Value }
  if (-not $devices) {
    Write-Host '   No phone found. Plug it in with USB debugging on and accept the prompt on the phone.' -ForegroundColor Yellow
  }
  foreach ($d in $devices) {
    adb -s $d install -r $apk
    if ($LASTEXITCODE -eq 0) { Ok "installed on $d" } else { Write-Host "   failed on $d" -ForegroundColor Red }
  }
}
