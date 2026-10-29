#!/bin/sh
# Container entrypoint. Starts as root only long enough to make the data folder
# writable for PUID:PGID (Unraid uses 99:100), then runs the app as that user.
set -e

PUID="${PUID:-1993}"
PGID="${PGID:-1993}"
DATA="${DATA_DIR:-/data}"
UPLOADS="${UPLOAD_DIR:-$DATA/uploads}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA" "$UPLOADS"
  # Only walk the folder when ownership is actually wrong, so restarts stay fast.
  if [ "$(stat -c %u "$DATA")" != "$PUID" ] || [ "$(stat -c %g "$DATA")" != "$PGID" ] \
    || [ -n "$(find "$DATA" \( ! -user "$PUID" -o ! -group "$PGID" \) -print -quit)" ]; then
    echo "[entrypoint] giving $DATA to $PUID:$PGID"
    chown -R "$PUID:$PGID" "$DATA" "$UPLOADS"
  fi
  if command -v setpriv >/dev/null 2>&1; then
    exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups "$@"
  fi
  echo "[entrypoint] setpriv not found; running as root"
fi

exec "$@"
