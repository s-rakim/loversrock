# Packs up everything the server PC holds — the database, every photo and
# voice note, and both .env files — into one file, for moving the server to
# another machine (docs/ORACLE.md). On the server PC, from the loversrock
# folder, with Docker Desktop running:
#
#   powershell -ExecutionPolicy Bypass -File .\export-for-server.ps1
#
# It writes loversrock-move.tar.gz here and prints the two commands that put
# it on the new server. Nothing on this PC is changed or deleted, and the
# server here keeps running; anything sent after the export stays here, so
# run it right before you switch the phones over.
#
# THE FILE HOLDS YOUR SECRETS AND ALL YOUR PHOTOS. It is gitignored; copy it
# only to your own server, and delete it once the move has worked.
param(
  [string]$Out = 'loversrock-move.tar.gz'
)
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
Set-Location $root

function Step($text) { Write-Host "`n=== $text" -ForegroundColor Cyan }
function Stop-With($text) { Write-Host "`n$text" -ForegroundColor Red; exit 1 }

$dockerDir = Join-Path $root 'docker'
$compose = @('compose', '--project-directory', $dockerDir, '-f', (Join-Path $dockerDir 'docker-compose.yml'))

docker info *> $null
if ($LASTEXITCODE -ne 0) { Stop-With 'Docker is not running. Start Docker Desktop, wait for it, then run this again.' }
if (-not (Get-Command tar -ErrorAction SilentlyContinue)) { Stop-With 'tar was not found (it comes with Windows 10 1803 and later).' }

Step 'Starting the database and photo store, if they are not running'
& docker @compose up -d postgres minio
if ($LASTEXITCODE -ne 0) { Stop-With 'Could not start them (see above).' }
$ready = $false
for ($i = 0; $i -lt 40 -and -not $ready; $i++) {
  & docker @compose exec -T postgres sh -c 'pg_isready -U $POSTGRES_USER' *> $null
  $ready = ($LASTEXITCODE -eq 0)
  if (-not $ready) { Start-Sleep -Seconds 2 }
}
if (-not $ready) { Stop-With 'The database did not become ready.' }

$stage = Join-Path $env:TEMP ("loversrock-move-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $stage | Out-Null

$failed = $false
try {
  Step 'Database'
  # Written inside the container and copied out, rather than piped: Windows
  # PowerShell re-encodes piped output as text, which corrupts a binary dump.
  # No double quotes in the command: Windows PowerShell mangles them when
  # passing arguments to a program.
  & docker @compose exec -T postgres sh -c 'pg_dump -U $POSTGRES_USER -Fc -f /tmp/db.dump $POSTGRES_DB'
  if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed (see above).' }
  & docker @compose cp postgres:/tmp/db.dump (Join-Path $stage 'db.dump')
  if ($LASTEXITCODE -ne 0) { throw 'Could not copy the database dump out of the container.' }
  & docker @compose exec -T postgres rm -f /tmp/db.dump *> $null
  Write-Host ('   {0:N1} MB' -f ((Get-Item (Join-Path $stage 'db.dump')).Length / 1MB)) -ForegroundColor Green

  Step 'Photos, drawings and voice notes'
  # The photo store is paused while it is copied, so no file is caught half
  # written. Uploads fail for that minute; nothing already stored is touched.
  $minio = (& docker @compose ps -q minio | Out-String).Trim()
  if (-not $minio) { throw 'The photo store container was not found.' }
  & docker @compose stop minio | Out-Null
  & docker run --rm --volumes-from $minio -v "${stage}:/backup" alpine sh -c 'cd /data && tar -czf /backup/minio.tar.gz .'
  $copied = ($LASTEXITCODE -eq 0)
  & docker @compose start minio | Out-Null
  if (-not $copied) { throw 'Copying the photo store failed (see above). It has been started again.' }
  Write-Host ('   {0:N1} MB' -f ((Get-Item (Join-Path $stage 'minio.tar.gz')).Length / 1MB)) -ForegroundColor Green

  Step 'Settings (.env files)'
  foreach ($pair in @(@('backend\.env', 'backend.env'), @('docker\.env', 'docker.env'))) {
    $from = Join-Path $root $pair[0]
    if (Test-Path $from) {
      Copy-Item $from (Join-Path $stage $pair[1])
      Write-Host "   $($pair[0])" -ForegroundColor Green
    } else {
      Write-Host "   $($pair[0]) not found; the new server will start from the example and make new secrets" -ForegroundColor Yellow
    }
  }

  Step "Packing $Out"
  $outPath = Join-Path $root $Out
  if (Test-Path $outPath) { Remove-Item $outPath }
  tar -czf $outPath -C $stage .
  if ($LASTEXITCODE -ne 0) { throw 'Packing failed (see above).' }
  $size = (Get-Item $outPath).Length / 1MB
} catch {
  Write-Host "`n$($_.Exception.Message)" -ForegroundColor Red
  $failed = $true
} finally {
  # Always, even on failure: the staging folder holds the secrets too.
  Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
}
if ($failed) { exit 1 }

Write-Host ("`nDone: $Out ({0:N1} MB). It holds your secrets and all your photos - keep it private." -f $size) -ForegroundColor Green
Write-Host @"

Put it on the new server (your SSH key file and the server's public IP):

  scp -i C:\path\to\ssh-key.key $Out ubuntu@<PUBLIC_IP>:~

Then, on the server (ssh -i C:\path\to\ssh-key.key ubuntu@<PUBLIC_IP>):

  curl -fsSL https://raw.githubusercontent.com/s-rakim/loversrock/claude/stoic-volta-vv3b26/docker/server-setup.sh | bash -s -- --restore ~/$Out

Once the phones work against the new server, delete $Out here and on the server.
"@
