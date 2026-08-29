#!/usr/bin/env bash
# deploy-laptop.sh
# ---------------------------------------------------------------------------
# Run Sallaapam on a laptop (Docker Compose) and expose it publicly through a
# Cloudflare Tunnel at <DOMAIN>. Designed to be handed to an automation agent;
# the agent does NOT touch any API keys (those live in ~/.env on the laptop,
# supplied by the human owner).
#
# Usage:
#   ./deploy/deploy-laptop.sh --domain app.example.com \
#       [--repo https://github.com/atrixi1337/NOVA_Project.git] \
#       [--dest /opt/sallaapam]
#
# Prerequisites (verified before anything runs):
#   docker, docker compose, git, node, npm, cloudflared
# ---------------------------------------------------------------------------
set -euo pipefail

DOMAIN=""
REPO_URL="https://github.com/atrixi1337/NOVA_Project.git"
DEST="/opt/sallaapam"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2;;
    --repo)   REPO_URL="$2"; shift 2;;
    --dest)   DEST="$2"; shift 2;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0;;
    *) echo "ERROR: unknown arg: $1" >&2; exit 2;;
  esac
done

if [[ -z "$DOMAIN" ]]; then
  echo "ERROR: --domain <subdomain> is required (e.g. app.example.com)." >&2
  echo "       The domain must already be in your Cloudflare account (zone)." >&2
  exit 2
fi

echo "==> [1/9] Checking prerequisites"
for c in docker git node npm cloudflared; do
  command -v "$c" >/dev/null 2>&1 || { echo "MISSING: $c — install it first."; exit 1; }
done
docker compose version >/dev/null 2>&1 || { echo "MISSING: docker compose plugin (v2) — install it."; exit 1; }
echo "    docker, git, node, npm, cloudflared: OK"

echo "==> [2/9] Cloning repo -> $DEST"
mkdir -p "$(dirname "$DEST")"
if [[ -d "$DEST/.git" ]]; then
  echo "    already a checkout — pulling latest"
  (cd "$DEST" && git pull --ff-only)
else
  rm -rf "$DEST"
  git clone "$REPO_URL" "$DEST"
fi
cd "$DEST"

echo "==> [3/9] Ensuring .env (secrets are NEVER managed by this script)"
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "    Created .env from .env.example."
  echo "    !!! STOP — the human owner must edit  $DEST/.env  and fill in real API keys,"
  echo "    then re-run this script. Minimum for the features you asked for:"
  echo "      - GEMINI_API_KEY or NOVA_API_KEY  (image input; Reka/Inception are text-only)"
  echo "      - FOUNDRY_API_KEY + FOUNDRY_IMAGE_MODEL (image generation)"
  exit 0
fi
echo "    .env present (keys left untouched)."

echo "==> [4/9] Building the frontend bundle (-> ../static)"
( cd frontend && npm install --prefer-offline && npm run build )

echo "==> [5/9] Building + starting the app (docker compose, port 8000)"
docker compose up -d --build
echo "    waiting for /api/health ..."
ok=0
for _ in $(seq 1 40); do
  if curl -sf http://localhost:8000/api/health >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
if [[ "$ok" != 1 ]]; then
  echo "    ERROR: app did not become healthy on :8000"
  docker compose logs --tail=40 nova-poc || true
  exit 1
fi
echo "    /api/health OK"

echo "==> [6/9] Cloudflare Tunnel: login (opens a browser)"
# `cloudflared tunnel login` authenticates against your Cloudflare account via
# the browser. Head-less boxes can instead create a Service Token in the
# Cloudflare dashboard and set CF_API_TOKEN + CF_ACCOUNT_ID env vars.
cloudflared tunnel login

echo "==> [7/9] Create (or reuse) a named tunnel: sallaapam"
TUAL=""
if cloudflared tunnel list 2>/dev/null | awk 'NR==1{next} $1=="sallaapam"{print $3}' | grep -q .; then
  TUAL=$(cloudflared tunnel list 2>/dev/null | awk 'NR==1{next} $1=="sallaapam"{print $2}')
  echo "    reusing existing tunnel: $TUAL"
else
  OUT=$(cloudflared tunnel create sallaapam)
  # tunnel id looks like 11111111-2222-3333-4444-555555555555
  TUAL=$(echo "$OUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -n1)
  echo "    created tunnel: $TUAL"
fi
[[ -z "$TUAL" ]] && { echo "    ERROR: could not read tunnel id"; exit 1; }
CREDS="$HOME/.cloudflared/$TUAL.json"
[[ -f "$CREDS" ]] || { echo "    ERROR: credentials file missing: $CREDS"; exit 1; }

echo "==> [8/9] Writing tunnel config (~/.cloudflared/config.yml)"
mkdir -p "$HOME/.cloudflared"
cat > "$HOME/.cloudflared/config.yml" <<EOF
tunnel: $TUAL
credentials-file: $CREDS
ingress:
  - hostname: $DOMAIN
    service: http://localhost:8000
  - service: http_status:404
EOF
echo "    configured: https://$DOMAIN  ->  http://localhost:8000"

echo "==> Route DNS: $DOMAIN -> tunnel (domain must be in your Cloudflare zone)"
cloudflared tunnel route dns sallaapam "$DOMAIN"

echo "==> [9/9] Installing cloudflared as a systemd service (auto-start on boot)"
cloudflared service install
systemctl daemon-reload 2>/dev/null || true
systemctl enable --now cloudflared 2>/dev/null \
  || echo "    WARN: could not enable systemd (no systemctl). Start manually: cloudflared tunnel run sallaapam"

echo
echo "==> DONE. Verify the public endpoint:"
echo "    curl -s https://$DOMAIN/api/health"
curl -sf "https://$DOMAIN/api/health" && echo " <- public /api/health OK" \
  || echo "    (WARN: public check failed — the tunnel may still be starting; retry in ~20s)"
echo
echo "    App:        https://$DOMAIN"
echo "    Health:     https://$DOMAIN/api/health"
echo "    History DB: $DEST/nova_history.db (bind-mounted into the container)"
