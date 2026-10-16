#!/bin/sh
# Prepare the state volume, then drop privileges and run the server.
#
# Runs as root only long enough to create and chown the directories on the
# mounted volume, which Docker hands over owned by root. Everything after
# su-exec runs as the unprivileged `ym` user.
set -eu

STATE_DIR="${YM_STATE_DIR:-/data}"
SEED_ANNOTATIONS="/app/seed/annotations/clauses.json"

mkdir -p "$STATE_DIR/auth" "$STATE_DIR/annotations"

# Seed the annotations ONCE. After first boot the volume's copy carries real
# reviewer approvals and must never be overwritten by the image's copy — that
# would silently revert every eligibility decision a reviewer has made.
if [ ! -f "$STATE_DIR/annotations/clauses.json" ] && [ -f "$SEED_ANNOTATIONS" ]; then
  echo "[entrypoint] seeding annotations into $STATE_DIR/annotations/"
  cp "$SEED_ANNOTATIONS" "$STATE_DIR/annotations/clauses.json"
else
  echo "[entrypoint] annotations already present in $STATE_DIR — leaving them alone"
fi

# Account files hold password hashes; nothing but the app should read them.
chmod 700 "$STATE_DIR/auth" 2>/dev/null || true

if [ "$(id -u)" = "0" ]; then
  chown -R ym:ym "$STATE_DIR" 2>/dev/null || true
  exec su-exec ym "$@"
fi

exec "$@"
