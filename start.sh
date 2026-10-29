#!/bin/sh
# Runs Snail Race from this folder at http://localhost:8000 (stop it with Ctrl+C).
# The first run asks for your Strava app details (optional) and saves them in .env.
cd "$(dirname "$0")" || exit 1
PORT="${PORT:-8000}"

# Find Deno even when it isn't on PATH (Homebrew, or the official installer's ~/.deno/bin).
if ! command -v deno >/dev/null 2>&1; then
  for dir in "$HOME/.deno/bin" /opt/homebrew/bin /usr/local/bin; do
    [ -x "$dir/deno" ] && PATH="$dir:$PATH" && break
  done
fi
if ! command -v deno >/dev/null 2>&1; then
  echo "Snail Race needs Deno (https://deno.com). Install it with one of these, then run this again:"
  echo "  brew install deno"
  echo "  curl -fsSL https://deno.land/install.sh | sh"
  exit 1
fi

if [ ! -f .env ]; then
  echo "First run: creating your settings file (.env)."
  printf "Strava Client ID (press Enter to skip Strava): "
  read -r STRAVA_ID
  STRAVA_SECRET=""
  if [ -n "$STRAVA_ID" ]; then
    printf "Strava Client Secret: "
    stty -echo 2>/dev/null
    read -r STRAVA_SECRET
    stty echo 2>/dev/null
    echo
  fi
  {
    echo "APP_URL=http://localhost:$PORT"
    echo "PORT=$PORT"
    if [ -n "$STRAVA_ID" ]; then
      echo "STRAVA_CLIENT_ID=$STRAVA_ID"
      echo "STRAVA_CLIENT_SECRET=$STRAVA_SECRET"
    fi
  } > .env
  chmod 600 .env
  echo "Saved. Edit .env any time to change settings (see .env.example)."
fi

echo "Starting Snail Race at http://localhost:$PORT (the first start downloads a few packages)..."
if [ -z "$NO_BROWSER" ]; then
  (sleep 4; open "http://localhost:$PORT" 2>/dev/null || xdg-open "http://localhost:$PORT" 2>/dev/null) &
fi
exec deno task start
