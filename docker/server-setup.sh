#!/usr/bin/env bash
# Puts the whole loversrock server on a fresh Ubuntu machine — an Oracle Cloud
# Always Free instance, or any other — in one go. docs/ORACLE.md walks
# through making the machine; this does everything after you can SSH in.
#
#   curl -fsSL https://raw.githubusercontent.com/s-rakim/loversrock/claude/stoic-volta-vv3b26/docker/server-setup.sh | bash
#
# or, to bring your existing photos, messages and settings across from the
# PC (made there by export-for-server.ps1 and copied up with scp):
#
#   curl -fsSL .../docker/server-setup.sh | bash -s -- --restore ~/loversrock-move.tar.gz
#
# Safe to run again: it updates the code, keeps your .env files and data,
# and rebuilds.
#
# What it does:
#   1. Docker, Node (for docker/secure-setup.mjs), git — whatever is missing.
#   2. Tailscale, and signs this machine in to your tailnet (it prints a link
#      to open, unless TS_AUTHKEY is set). The phones reach the server over
#      Tailscale exactly as they reach the PC today, so NOTHING is opened to
#      the internet: Oracle's network only lets SSH in by default, and that
#      stays the only door.
#   3. Lets Tailscale traffic past the firewall Oracle's Ubuntu image ships
#      with (it rejects everything but SSH).
#   4. The code, in ~/loversrock, on the branch the app is built from.
#   5. With --restore: your .env files, the database and the photo store
#      from the PC, before anything starts.
#   6. The relay and call-server addresses set to this machine's Tailscale
#      IP, strong secrets (docker/secure-setup.mjs), every container built
#      and started.
#
# Environment overrides: LOVERSROCK_DIR (default ~/loversrock),
# LOVERSROCK_BRANCH (default claude/stoic-volta-vv3b26), TS_AUTHKEY.
set -euo pipefail

REPO_URL="https://github.com/s-rakim/loversrock.git"
BRANCH="${LOVERSROCK_BRANCH:-claude/stoic-volta-vv3b26}"
RESTORE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --restore) RESTORE="${2:-}"; shift 2 ;;
    --restore=*) RESTORE="${1#*=}"; shift ;;
    -h|--help) sed -n '2,32p' "$0" 2>/dev/null || true; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1;36m=== %s\033[0m\n' "$*"; }
ok()   { printf '   \033[32m%s\033[0m\n' "$*"; }
warn() { printf '   \033[33m%s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m%s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] && die "Run this as your normal user (ubuntu), not root: it uses sudo where it needs to."
command -v apt-get >/dev/null || die "This script is for Ubuntu or Debian (apt-get was not found)."
sudo -v || die "This needs sudo."

if [ -n "$RESTORE" ]; then
  RESTORE="$(readlink -f "$RESTORE" 2>/dev/null || echo "$RESTORE")"
  [ -f "$RESTORE" ] || die "--restore: no file at $RESTORE. Copy it up first (docs/ORACLE.md, step 5)."
fi

# ------------------------------------------------------------------ swap
# Oracle's other free shape (VM.Standard.E2.1.Micro) has 1 GB of memory,
# which is not enough to build the backend and the call server. The Ampere
# shape (24 GB) never gets here.
mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
if [ "$mem_kb" -lt 3500000 ] && ! swapon --show | grep -q .; then
  step "Adding 2 GB of swap (this machine has $((mem_kb / 1024)) MB of memory)"
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  ok "swap on"
fi

# -------------------------------------------------------------- packages
step "Packages: git, curl, Node"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git curl ca-certificates nodejs >/dev/null
# docker/secure-setup.mjs needs Node 18 or later: Ubuntu 24.04 has it,
# older releases do not.
node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$node_major" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - >/dev/null
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs >/dev/null
fi
ok "node $(node --version)"

if ! command -v docker >/dev/null; then
  step "Docker"
  curl -fsSL https://get.docker.com | sudo sh >/dev/null
  sudo usermod -aG docker "$USER"
  ok "installed"
fi
# Container logs grow without limit by default; months of them fill the
# disk. Capped, before any container exists, so every one is covered.
if [ ! -f /etc/docker/daemon.json ]; then
  echo '{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }' \
    | sudo tee /etc/docker/daemon.json >/dev/null
  sudo systemctl restart docker
fi
sudo systemctl enable --now docker >/dev/null 2>&1 || true
sudo docker compose version >/dev/null || die "Docker is installed but 'docker compose' is not. Install the docker-compose-plugin package and run this again."

# ------------------------------------------------------------- tailscale
step "Tailscale"
if ! command -v tailscale >/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh >/dev/null
fi
sudo systemctl enable --now tailscaled >/dev/null 2>&1 || true
if ! sudo tailscale ip -4 >/dev/null 2>&1; then
  if [ -n "${TS_AUTHKEY:-}" ]; then
    sudo tailscale up --authkey "$TS_AUTHKEY" --hostname loversrock
  else
    echo "   Open the link below and sign in with the same account the phones use."
    sudo tailscale up --hostname loversrock
  fi
fi
TS_IP="$(sudo tailscale ip -4 | head -n1)"
[ -n "$TS_IP" ] || die "Tailscale did not give this machine an address. Run 'sudo tailscale up' and then this script again."
ok "this server is $TS_IP on your tailnet"

# -------------------------------------------------------------- firewall
# Oracle's Ubuntu image keeps its own iptables rules in /etc/iptables/rules.v4:
# SSH in, everything else rejected. Tailscale traffic is let in by interface
# — only the tailnet, never the internet — both now and at every boot.
# Docker's published ports are forwarded, not delivered to INPUT, and Docker
# puts its own rules ahead of Oracle's, so they need nothing here.
if sudo iptables -C INPUT -i tailscale0 -j ACCEPT 2>/dev/null; then
  :
else
  sudo iptables -I INPUT 1 -i tailscale0 -j ACCEPT
fi
# Tailscale's direct (not relayed) connections, so calls are not bounced
# through a relay server on the far side of the world.
sudo iptables -C INPUT -p udp --dport 41641 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 2 -p udp --dport 41641 -j ACCEPT
if [ -f /etc/iptables/rules.v4 ] && ! sudo grep -q -- '-i tailscale0 -j ACCEPT' /etc/iptables/rules.v4; then
  # Edited in place rather than with `netfilter-persistent save`: a save now
  # would also capture Docker's rules, which it rebuilds itself at boot.
  sudo cp /etc/iptables/rules.v4 /etc/iptables/rules.v4.before-loversrock
  sudo sed -i '0,/^-A INPUT/s//-A INPUT -i tailscale0 -j ACCEPT\n-A INPUT -p udp --dport 41641 -j ACCEPT\n&/' /etc/iptables/rules.v4
  ok "Tailscale let in (kept across reboots; the original is rules.v4.before-loversrock)"
else
  ok "Tailscale let in"
fi

# ------------------------------------------------------------------ code
step "The code"
here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
if [ -n "$here" ] && [ -f "$here/docker-compose.yml" ] && [ -f "$here/../backend/package.json" ]; then
  ROOT="$(cd "$here/.." && pwd)"
else
  ROOT="${LOVERSROCK_DIR:-$HOME/loversrock}"
fi
if [ -d "$ROOT/.git" ]; then
  if [ -z "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ]; then
    git -C "$ROOT" fetch -q origin "$BRANCH" && git -C "$ROOT" checkout -q "$BRANCH" && git -C "$ROOT" merge -q --ff-only "origin/$BRANCH" \
      && ok "updated $ROOT" || warn "could not update $ROOT; carrying on with what is there"
  else
    warn "$ROOT has local changes; left as it is"
  fi
else
  git clone -q -b "$BRANCH" "$REPO_URL" "$ROOT"
  ok "cloned into $ROOT"
fi
cd "$ROOT"
DOCKER_DIR="$ROOT/docker"
compose() { sudo docker compose --project-directory "$DOCKER_DIR" -f "$DOCKER_DIR/docker-compose.yml" "$@"; }

# Sets KEY=value in an env file, adding the line if it is not there.
set_env() {
  local file="$1" key="$2" value="$3"
  if grep -qE "^[[:space:]]*${key}=" "$file"; then
    sed -i -E "s|^[[:space:]]*${key}=.*|${key}=${value}|" "$file"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$file"
  fi
}

# Sets this machine's address, and makes sure Compose can read the file at
# all: it refuses to start ANY service while TURN_SECRET is unset, and the
# restore below starts two of them before docker/secure-setup.mjs has run.
apply_settings() {
  [ -f backend/.env ] || cp backend/.env.example backend/.env
  [ -f docker/.env ] || cp docker/.env.example docker/.env
  # The phones send call audio and video to this address; on the PC it was
  # the PC's Tailscale IP, and here it has to be this machine's.
  set_env docker/.env TURN_PUBLIC_IP "$TS_IP"
  set_env docker/.env CALLS_PUBLIC_IP "$TS_IP"
  set_env backend/.env TURN_PUBLIC_IP "$TS_IP"
  if ! grep -qE '^TURN_SECRET=.{16,}' docker/.env; then
    # secure-setup.mjs keeps any strong value, so this is the one it keeps.
    set_env docker/.env TURN_SECRET "$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi
}

step "Settings"
apply_settings
ok "relay and call server at $TS_IP"

# --------------------------------------------------------------- restore
WORK=""
cleanup() { [ -n "$WORK" ] && rm -rf "$WORK"; }
trap cleanup EXIT

if [ -n "$RESTORE" ]; then
  step "Bringing your data across from $RESTORE"
  WORK="$(mktemp -d)"
  tar -xzf "$RESTORE" -C "$WORK"
  src="$WORK"
  [ -f "$src/db.dump" ] || src="$(dirname "$(find "$WORK" -name db.dump | head -n1)")"
  [ -f "$src/db.dump" ] && [ -f "$src/minio.tar.gz" ] || die "That file is not an export from export-for-server.ps1 (no db.dump / minio.tar.gz in it)."

  for pair in "backend.env:backend/.env" "docker.env:docker/.env"; do
    from="$src/${pair%%:*}"; to="$ROOT/${pair#*:}"
    [ -f "$from" ] || continue
    [ -f "$to" ] && cp "$to" "$to.before-restore"
    # Written on Windows: CRLF line endings would leave a \r on every value.
    sed 's/\r$//' "$from" > "$to"
  done
  apply_settings
  ok "settings (.env files) restored, with this machine's address"

  # Started empty, so the volumes and containers exist; MinIO is filled
  # while stopped, Postgres while running.
  compose up -d postgres minio
  minio_id="$(compose ps -q minio)"
  compose stop minio >/dev/null
  sudo docker run --rm --volumes-from "$minio_id" -v "$src:/backup:ro" alpine \
    sh -c 'find /data -mindepth 1 -delete && cd /data && tar -xzf /backup/minio.tar.gz'
  compose start minio >/dev/null
  ok "photos and recordings restored"

  for _ in $(seq 1 60); do
    compose exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER"' >/dev/null 2>&1 && break
    sleep 2
  done
  compose cp "$src/db.dump" postgres:/tmp/db.dump
  # --clean --if-exists: replaces whatever an empty database starts with.
  # A warning or two on a fresh database is normal; the backend re-applies
  # its schema on start either way.
  if compose exec -T postgres sh -c 'pg_restore --clean --if-exists --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB" /tmp/db.dump' 2>"$WORK/restore.log"; then
    ok "database restored"
  else
    warn "database restored with $(grep -c 'error' "$WORK/restore.log" || true) warning(s) — usually harmless on a fresh database:"
    tail -n 5 "$WORK/restore.log" | sed 's/^/      /'
  fi
  compose exec -T postgres rm -f /tmp/db.dump >/dev/null 2>&1 || true
fi


# Strong secrets for anything still on an example value, then every
# container built and started (this is the slow part the first time: the
# backend and the call server are compiled here, about 5–15 minutes).
step "Secrets, then building and starting everything"
sudo node docker/secure-setup.mjs
sudo chown "$(id -u):$(id -g)" backend/.env docker/.env

step "Waiting for the backend"
up=""
for _ in $(seq 1 100); do
  if curl -fsS --max-time 3 http://localhost:4000/health 2>/dev/null | grep -q '"ok"'; then up=1; break; fi
  sleep 3
done
if [ -z "$up" ]; then
  compose logs backend --tail 30
  die "The backend did not come up (its last lines are above). Fix what they say, then run this again."
fi
ok "backend is up"

cat <<EOF

$(printf '\033[1;32m')All set.$(printf '\033[0m')

  Server address for the app:   http://$TS_IP:4000

  On each phone:
    1. Tailscale on (same account as this server).
    2. loversrock → Settings → Server address → http://$TS_IP:4000
    3. Sign in again if it asks (it will if the secrets were new).

  Then switch the PC's server off so the two don't drift apart
  (on the PC, in PowerShell, in the loversrock\docker folder):
    docker compose down

  Later updates, on this server:
    cd $ROOT && bash docker/server-setup.sh

  Logs:   sudo docker compose -f $DOCKER_DIR/docker-compose.yml logs backend --tail 50
EOF
