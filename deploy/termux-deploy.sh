#!/usr/bin/env bash
# termux-deploy.sh
# ---------------------------------------------------------------------------
# Deploy the NOVA POC to an Android phone running Termux (e.g. an unused
# Galaxy Flip / S2x). Those phones have 8 GB RAM and a Snapdragon 888 /
# Exynos 2100 (aarch64) — plenty for Nova, whose FastAPI runtime is ~200 MB and
# whose deps are just fastapi+uvicorn+httpx+multipart+evtx (no torch/numpy).
#
# Public exposure modes:
#   quick (DEFAULT) -> free https://<random>.trycloudflare.com URL via a
#     Cloudflare quick tunnel. No Cloudflare account and no custom domain
#     required. This is the exact mechanism proven end-to-end by the local
#     PoC (docker compose + cloudflared -> public HTTPS 200 with 15 providers).
#   named (--domain) -> your own domain through a Cloudflare named tunnel
#     (needs CF_ACCOUNT_ID + CF_API_TOKEN + a domain in your Cloudflare zone,
#      same flow as deploy/deploy-laptop.sh).
#   none (--no-tunnel) -> run on localhost only (no public URL).
#
# Secrets hygiene: the automation NEVER touches API keys. They live in
# ~/NOVA_Project/.env, supplied by the human owner. The script refuses to start
# the app unless .env exists (it will create one from .env.example and exit).
#
# Usage:
#   ./deploy/termux-deploy.sh                       # quick tunnel, ~/NOVA_Project
#   ./deploy/termux-deploy.sh --domain app.me.com \
#        --cf-account <id> --cf-token <token>       # named tunnel to a domain
#   ./deploy/termux-deploy.sh --no-tunnel           # run only, no public URL
#   ./deploy/termux-deploy.sh --help
# ---------------------------------------------------------------------------
set -euo pipefail

# --- args -------------------------------------------------------------------
DEST="${HOME}/NOVA_Project"
REPO_URL="https://github.com/atrixi1337/NOVA_Project.git"
DOMAIN=""
CF_ACCOUNT=""
CF_TOKEN=""
TUNNEL_MODE="quick"          # quick | named | none
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dest)       DEST="$2"; shift 2;;
    --repo)       REPO_URL="$2"; shift 2;;
    --domain)     DOMAIN="$2"; TUNNEL_MODE="named"; shift 2;;
    --cf-account) CF_ACCOUNT="$2"; shift 2;;
    --cf-token)   CF_TOKEN="$2"; shift 2;;
    --no-tunnel)  TUNNEL_MODE="none"; shift;;
    -h|--help)    grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0;;
    *) echo "ERROR: unknown arg: $1" >&2; exit 2;;
  esac
done

# --- must run inside Termux -------------------------------------------------
if [[ -z "${PREFIX:-}" ]]; then
  echo "ERROR: this script must run INSIDE Termux (install Termux from F-Droid first)." >&2
  exit 1
fi
PKG="${PREFIX}/bin/pkg"
HAVE() { command -v "$1" >/dev/null 2>&1; }
ARCH="$(uname -m)"          # aarch64 on the Flip 3 (Snapdragon 888 / Exynos 2100)
echo "==> running under Termux on $ARCH ($PREFIX)"

echo "==> [1/7] Prerequisite packages"
for p in python git curl termux-api; do
  if ! HAVE "$p"; then echo "    installing $p ..."; "$PKG" install -y "$p" >/dev/null; fi
done
if ! HAVE cloudflared; then
  echo "    installing cloudflared ..."
  "$PKG" install -y cloudflared >/dev/null || {
    echo "    'cloudflared' pkg unavailable; downloading static aarch64 build"
    curl -L --fail \
      "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}" \
      -o "${PREFIX}/bin/cloudflared"; chmod +x "${PREFIX}/bin/cloudflared"
  }
fi
echo "    python, git, curl, termux-api, cloudflared: OK"

echo "==> [2/7] Clone / update repo -> $DEST"
mkdir -p "$(dirname "$DEST")"
if [[ -d "$DEST/.git" ]]; then
  echo "    checkout exists — pulling latest"
  (cd "$DEST" && git pull --ff-only)
else
  git clone "$REPO_URL" "$DEST"
fi
cd "$DEST"

echo "==> [3/7] Install Python deps (fastapi, uvicorn, httpx, multipart, evtx)"
# Termux is PEP-668 (externally-managed) on recent Android — use an isolated
# venv rather than --break-system-packages so Nova's deps don't fight system Python.
if [[ ! -x "$DEST/.venv/bin/python" ]]; then
  python -m venv "$DEST/.venv"
fi
"$DEST/.venv/bin/pip" install --upgrade pip >/dev/null 2>&1 || true
if HAVE uv; then
  uv pip install --python "$DEST/.venv/bin/python" -r requirements.txt
else
  "$DEST/.venv/bin/pip" install --no-cache-dir -r requirements.txt
fi
echo "    deps installed into $DEST/.venv"

echo "==> [4/7] Ensure .env (secrets are NEVER managed by this script)"
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "    Created .env from .env.example."
  echo "    !!! STOP — the human owner must edit  $DEST/.env  with real API keys, then re-run."
  echo "        Minimum for a useful POC: GEMINI_API_KEY or NOVA_API_KEY."
  exit 0
fi
echo "    .env present (keys left untouched)."

echo "==> [5/7] Register a Termux service for the app"
# Termux has no systemd — use the termux-services `sv` supervisor if present,
# else a plain nohup fallback. The history DB lives in Termux home storage.
mkdir -p "$HOME/.termux/services/nova"
cat > "$HOME/.termux/services/nova/run" <<'SVC'
#!/data/data/com.termux/files/usr/bin/sh
cd "$HOME/NOVA_Project"
# backend.py reads keys via os.getenv() — it does NOT call load_dotenv(),
# so source .env into the environment ourselves (same role as docker's env_file).
set -a; . "$HOME/NOVA_Project/.env" 2>/dev/null || true; set +a
export APP_HOST=0.0.0.0 APP_PORT=8000
export NOVA_HISTORY_DB="$HOME/NOVA_Project/nova_history.db"
exec "$HOME/NOVA_Project/.venv/bin/python" -m uvicorn backend:app --host 0.0.0.0 --port 8000
SVC
chmod +x "$HOME/.termux/services/nova/run"

APPLOG="$DEST/nova-app.log"
start_app_nohup() {
  # Sources .env + uses the venv python (see comment in the service run script).
  nohup sh -c 'set -e; cd "$1"; set -a; . "$1/.env" 2>/dev/null || true; set +a; \
    export APP_HOST=0.0.0.0 APP_PORT=8000 NOVA_HISTORY_DB="$1/nova_history.db"; \
    exec "$1/.venv/bin/python" -m uvicorn backend:app --host 0.0.0.0 --port 8000' \
    _ "$DEST" > "$APPLOG" 2>&1 &
}
if HAVE sv && command -v sv >/dev/null 2>&1; then
  sv down nova 2>/dev/null || true
  sv up nova 2>/dev/null || true
  if ! curl -sf http://localhost:8000/api/health >/dev/null 2>&1; then
    echo "    sv did not start the app; using nohup fallback"; start_app_nohup
  fi
else
  start_app_nohup
fi

# wait for /api/health
for _ in $(seq 1 40); do
  curl -sf http://localhost:8000/api/health >/dev/null 2>&1 && break
  sleep 2
done
if ! curl -sf http://localhost:8000/api/health >/dev/null 2>&1; then
  echo "    ERROR: app did not become healthy on :8000" >&2
  echo "    log: $APPLOG"; exit 1
fi
echo "    /api/health OK (local http://localhost:8000)"

echo "==> [6/7] Keep the CPU awake while the screen is off (phone idle)"
if HAVE termux-wake-lock; then
  termux-wake-lock
  echo "    wake-lock acquired (clear later with: termux-wake-lock -r)"
else
  echo "    WARN: termux-wake-lock unavailable — install the termux-api pkg."
fi

echo "==> [7/7] Expose publicly via Cloudflare Tunnel"
TUAL=""
case "$TUNNEL_MODE" in
  none)
    echo "    skipping tunnel (--no-tunnel). App is on http://localhost:8000"
    ;;
  quick)
    # Free public HTTPS URL, no Cloudflare account required.
    if [[ -x "$DEST/nova-tunnel.sh" ]]; then
      nohup bash "$DEST/nova-tunnel.sh" "$HOME" 8000 \
        > "$DEST/nova-tunnel.log" 2>&1 &
    else
      nohup cloudflared tunnel --url http://localhost:8000 \
        --no-autoupdate --logfile "$DEST/nova-tunnel.log" \
        > "$DEST/nova-tunnel.out" 2>&1 &
    fi
    ;;
  named)
    [[ -n "$CF_ACCOUNT" && -n "$CF_TOKEN" && -n "$DOMAIN" ]] || {
      echo "ERROR: --domain requires --cf-account and --cf-token" >&2; exit 2; }
    export CF_API_TOKEN="$CF_TOKEN" CF_ACCOUNT_ID="$CF_ACCOUNT"
    cloudflared tunnel login
    cloudflared tunnel create nova 2>/dev/null || true
    TUAL=$(cloudflared tunnel list 2>/dev/null | awk 'NR==1{next} $1=="nova"{print $2}')
    mkdir -p "$HOME/.cloudflared"
    cat > "$HOME/.cloudflared/config.yml" <<EOF
tunnel: $TUAL
credentials-file: $HOME/.cloudflared/$TUAL.json
ingress:
  - hostname: $DOMAIN
    service: http://localhost:8000
  - service: http_status:404
EOF
    cloudflared tunnel route dns nova "$DOMAIN"
    nohup cloudflared tunnel --config "$HOME/.cloudflared/config.yml" \
      --no-autoupdate > "$DEST/nova-tunnel.log" 2>&1 &
    ;;
esac

echo
echo "==> DONE."
curl -sf http://localhost:8000/api/health >/dev/null \
  && echo "    local  http://localhost:8000/api/health OK" \
  || echo "    WARN: local health check failed"

# Capture the public URL (quick tunnel prints it to the log).
PUBURL=""
if [[ "$TUNNEL_MODE" == "quick" ]]; then
  for _ in $(seq 1 15); do
    PUBURL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$DEST/nova-tunnel.log" 2>/dev/null | head -n1)
    [[ -n "$PUBURL" ]] && break
    sleep 1
  done
  [[ -n "$PUBURL" ]] && echo "$PUBURL" > "$HOME/tunnel_url.txt"
elif [[ "$TUNNEL_MODE" == "named" && -n "$DOMAIN" ]]; then
  PUBURL="https://$DOMAIN"
  echo "$PUBURL" > "$HOME/tunnel_url.txt"
fi

echo
echo "    Public URL: ${PUBURL:-(none; running with --no-tunnel)}"
echo "    App:        ${PUBURL:-http://localhost:8000}"
echo "    Health:     ${PUBURL:+$PUBURL/}api/health"
echo "    History DB: $DEST/nova_history.db"
echo "    App log:    $APPLOG"
echo "    Tunnel log: $DEST/nova-tunnel.log"
echo "    Tunnel URL: $HOME/tunnel_url.txt"
echo
echo "    Keep it alive (do these once in Android Settings so the phone"
echo "    doesn't kill the app when idle):"
echo "      - Apps > Termux > Battery > 'Unrestricted' (disable Doze/kill)"
echo "      - Install 'Termux:Boot' from F-Droid to auto-start on reboot"
echo "      - (optional) set up a Termux:Boot script that runs: nohup bash $DEST/../deploy/termux-deploy.sh --no-tunnel &"
echo "      - Wake-lock already held; clear later: termux-wake-lock -r"
