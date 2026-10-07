#!/bin/sh
# Starts the room with a token, making one the first time if none was given.
set -e
mkdir -p /data /secret
if [ -z "$ESPRITS_TOKEN" ]; then
  if [ ! -s /secret/token ]; then
    # 24 random bytes as hex: the room's password, for the backend and for
    # signing in to the web pages (docker compose exec esprits cat /secret/token).
    od -An -tx1 -N24 /dev/urandom | tr -d ' \n' > /secret/token
    chmod 644 /secret/token
  fi
  ESPRITS_TOKEN="$(cat /secret/token)"
else
  printf '%s' "$ESPRITS_TOKEN" > /secret/token
  chmod 644 /secret/token
fi
export ESPRITS_TOKEN
exec node --disable-warning=ExperimentalWarning src/bin/serve.js
