# Every update since the call fix, in one go. On the server PC, from the
# loversrock folder:
#
#   git pull; powershell -ExecutionPolicy Bypass -File .\update.ps1
#
# 1. The server: strong secrets and passwords (docker/secure-setup.mjs), the
#    database schema, and every container rebuilt. Safe to run again.
# 2. Phones already on the runtime-13 build: the app's JavaScript, over the
#    air (npm run ship).
# 3. Phones on an older build: a new APK. Runtime 13 added native code for
#    calls and picture-in-picture, which an over-the-air update cannot carry.
#    It is built on this PC and installed on any phone plugged in over USB;
#    for the other phone, send it the file this prints.
#
#   -SkipApk    only the server and the over-the-air update
#   -SkipOta    no over-the-air update
#   -Message    the update's description
param(
  [switch]$SkipApk,
  [switch]$SkipOta,
  [string]$Message = 'Security fixes, Fable connections, Talk-style chat, tablets, calls'
)
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
Set-Location $root

function Step($text) { Write-Host "`n=== $text" -ForegroundColor Cyan }
function Stop-With($text) { Write-Host "`n$text" -ForegroundColor Red; exit 1 }

# ------------------------------------------------------------- the server
Step 'Server: secrets, passwords, containers'
node docker\secure-setup.mjs
if ($LASTEXITCODE -ne 0) { Stop-With 'The server update did not finish (see above). Is Docker Desktop running? Fix that, then run this again.' }

Step 'Server: waiting for the backend'
$up = $false
for ($i = 0; $i -lt 60 -and -not $up; $i++) {
  Start-Sleep -Seconds 3
  try { $up = (Invoke-RestMethod -Uri 'http://localhost:4000/health' -TimeoutSec 3).status -eq 'ok' } catch { }
}
if (-not $up) {
  docker compose -f docker\docker-compose.yml logs backend --tail 30
  Stop-With 'The backend did not come up (its last lines are above). The phones were not updated: the new app needs the new server.'
}
Write-Host '   backend is up' -ForegroundColor Green

# ------------------------------------------------------------- the phones
Set-Location (Join-Path $root 'mobile')
if (-not (Test-Path node_modules)) {
  Step 'App: installing packages'
  npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Stop-With 'npm install failed (see above).' }
}

if (-not $SkipOta) {
  Step 'Phones on the current build: sending the update over the air'
  # node directly rather than "npm run ship -- ...": PowerShell's npm shim
  # can swallow the "--".
  node scripts\ship-update.js $Message
  if ($LASTEXITCODE -ne 0) { Write-Host '   Not sent (see above). The APK below carries the same app.' -ForegroundColor Yellow }
}

if (-not $SkipApk) {
  Step 'Phones on an older build: building the APK'
  if (Test-Path 'credentials.json') {
    $shell = if (Get-Command pwsh -ErrorAction SilentlyContinue) { 'pwsh' } else { 'powershell' }
    & $shell -ExecutionPolicy Bypass -File scripts\build-local.ps1 -Install
    if ($LASTEXITCODE -ne 0) { Stop-With 'The APK build failed (see above).' }
  } else {
    Write-Host '   No credentials.json for a local build, so EAS builds it (one of the monthly builds).' -ForegroundColor Yellow
    eas build --platform android --profile preview
  }
}

Set-Location $root
Write-Host "`nDone. Both of you sign in again once (the sign-in secrets are new)." -ForegroundColor Green
