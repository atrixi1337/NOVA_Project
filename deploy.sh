#!/usr/bin/env bash
# deploy.sh — Build frontend + deploy to Fly.io
# Prerequisites: flyctl installed and authenticated
#   Install: curl -L https://fly.io/install.sh | sh
#   Auth:    export FLY_API_TOKEN="<your-flyio-personal-access-token>"
#            (or run: flyctl auth login)
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR"
APP_NAME="${FLY_APP:-nova-poc-app}"

echo ">>> Building frontend..."
(cd frontend && npm run build)

echo ">>> Importing secrets from .env (values never printed)..."
if [ -f .env ]; then
  SECRETS=""
  while IFS='=' read -r key val; do
    key=$(echo "$key" | xargs)
    [ -z "$key" ] && continue
    case "$key" in \#*) continue ;; esac
    val=$(echo "$val" | xargs)
    [ -z "$val" ] && continue
    SECRETS="$SECRETS $key=$val"
  done < .env
  if [ -n "$SECRETS" ]; then
    flyctl secrets set $SECRETS --app "$APP_NAME" 2>/dev/null || \
      flyctl secrets set $SECRETS 2>/dev/null || true
  fi
fi

echo ">>> Deploying to Fly.io ($APP_NAME)..."
flyctl deploy --app "$APP_NAME" --config fly.toml

echo ""
echo ">>> Deploy complete!"
echo ">>> App URL: https://$APP_NAME.fly.dev"
echo ">>> Check health: curl https://$APP_NAME.fly.dev/api/health"
echo ">>> Check status: flyctl status --app $APP_NAME"
