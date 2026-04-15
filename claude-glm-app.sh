#!/bin/bash
# Launch Claude GLM Desktop app
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="${SCRIPT_DIR}/app"
ELECTRON="${APP_DIR}/node_modules/.bin/electron"

if [ ! -x "$ELECTRON" ]; then
  echo "Installing dependencies..."
  cd "$APP_DIR" && npm install 2>&1
fi

exec "$ELECTRON" --no-sandbox \
  --ozone-platform-hint=auto \
  --enable-features=UseOzonePlatform \
  --disable-gpu-sandbox \
  "$APP_DIR"
