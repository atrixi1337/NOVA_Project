#!/usr/bin/env bash
#
# Nova POC — single-command installer
# ------------------------------------
# Clones the repo, builds a venv, drops in your Amazon Nova API key (the ONLY
# input you provide), launches the chat app, opens a Cloudflare quick tunnel,
# and makes both persistent via systemd.
#
# USAGE (fresh computer):
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/atrixi1337/NOVA_Project/main/install.sh)"
#
# That runs as your normal user; the script sudo's only the few systemd steps.
# The ONLY thing you type is your Amazon Nova API key (and, if prompted, your
# sudo password — that's just to install the system service).
#
set -euo pipefail

REPO="atrixi1337/NOVA_Project"
REPO_URL="https://github.com/${REPO}.git"
PORT="${NOVA_PORT:-8000}"
INSTALL_DIR="${NOVA_INSTALL_DIR:-}"
NO_SERVICE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --no-service) NO_SERVICE=1 ;;
    --port) PORT="$2"; shift ;;
    --dir) INSTALL_DIR="$2"; shift ;;
    *) echo "unknown arg: $1"; exit 1 ;;
  esac
  shift || true
done

# --- figure out the real (non-root) user ---
if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
  RUN_USER="$SUDO_USER"
else
  RUN_USER="$(logname 2>/dev/null || echo "${USER:-$(id -un)}")"
fi
[ "$RUN_USER" = "root" ] && RUN_USER="$(id -un)"
HOME_DIR="$(getent passwd "$RUN_USER" | cut -d: -f6)"
[ -z "$INSTALL_DIR" ] && INSTALL_DIR="$HOME_DIR/NOVA_Project"

need_root() { [ "$(id -u)" -eq 0 ]; }
run_as()  { if need_root; then sudo -u "$RUN_USER" "$@"; else "$@"; fi; }
priv()    { if need_root; then "$@"; else sudo "$@"; fi; }

echo ">>> Nova POC installer"
echo "    user : $RUN_USER"
echo "    dir  : $INSTALL_DIR"
echo "    port : $PORT"

# --- the ONLY required input ---
if [ -z "${NOVA_KEY:-}" ]; then
  read -r -s -p "Enter your Amazon Nova API key: " NOVA_KEY
  echo
fi
if [ -z "$NOVA_KEY" ]; then echo "ERROR: empty Nova key"; exit 1; fi

# --- base deps ---
command -v git  >/dev/null || { echo "git is required"; exit 1; }
command -v curl >/dev/null || { echo "curl is required"; exit 1; }

# uv (preferred venv tool); fall back to python3 -m venv
if ! command -v uv >/dev/null; then
  echo ">>> installing uv"
  curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null 2>&1 || true
  export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
fi

# --- clone (idempotent) ---
if [ ! -d "$INSTALL_DIR/.git" ]; then
  echo ">>> cloning $REPO_URL"
  run_as git clone "$REPO_URL" "$INSTALL_DIR"
else
  echo ">>> $INSTALL_DIR present; updating"
  ( cd "$INSTALL_DIR" && run_as git pull --ff-only ) || true
fi
cd "$INSTALL_DIR"

# --- venv + deps ---
if [ ! -x nova_env/bin/uvicorn ]; then
  echo ">>> creating venv + installing deps"
  # Avoid picking up any ambient VIRTUAL_ENV / uv project state.
  unset VIRTUAL_ENV
  export UV_PROJECT_ENVIRONMENT=""
  export PIP_REQUIRE_VIRTUALENV=0
  if command -v uv >/dev/null; then
    uv venv "$INSTALL_DIR/nova_env" >/dev/null
    uv pip install --python "$INSTALL_DIR/nova_env/bin/python" -r requirements.txt >/dev/null
  else
    python3 -m venv "$INSTALL_DIR/nova_env"
    "$INSTALL_DIR/nova_env/bin/pip" install -r requirements.txt >/dev/null
  fi
fi
chown -R "$RUN_USER":"$(id -gn "$RUN_USER")" nova_env 2>/dev/null || true

# --- .env (key + defaults) ---
echo ">>> writing .env"
cat > .env <<EOF
NOVA_API_KEY=$NOVA_KEY
NOVA_BASE_URL=https://api.nova.amazon.com/v1
NOVA_MODEL=nova-2-lite-v1
APP_HOST=0.0.0.0
APP_PORT=$PORT
NOVA_SANDBOX=$INSTALL_DIR
EOF
chown "$RUN_USER":"$(id -gn "$RUN_USER")" .env 2>/dev/null || true

# --- no-systemd mode (for testing / containers) ---
if [ "$NO_SERVICE" -eq 1 ]; then
  echo ">>> --no-service: launching app on :$PORT"
  # Load .env so the key/base url reach the process.
  set -a; [ -f .env ] && . ./.env; set +a
  nohup nova_env/bin/uvicorn backend:app --host 0.0.0.0 --port "$PORT" >/tmp/nova-poc.log 2>&1 &
  echo "    app pid $!"
  sleep 3
  curl -fsS "http://localhost:$PORT/api/health" || true
  echo
  echo "DONE (no systemd). App at http://localhost:$PORT"
  exit 0
fi

# --- cloudflared binary ---
if ! command -v cloudflared >/dev/null; then
  echo ">>> installing cloudflared"
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64)  CA=amd64 ;;
    aarch64|arm64) CA=arm64 ;;
    *) echo "unsupported arch: $ARCH"; exit 1 ;;
  esac
  curl -fsSL -o /tmp/cloudflared "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$CA"
  priv install -m 0755 /tmp/cloudflared /usr/local/bin/cloudflared
fi
chmod +x nova-tunnel.sh

# --- systemd units ---
echo ">>> installing systemd units"
priv tee /etc/systemd/system/nova-poc.service >/dev/null <<UNIT
[Unit]
Description=Nova POC chat app
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
Group=$(id -gn "$RUN_USER")
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=$INSTALL_DIR/nova_env/bin/uvicorn backend:app --host 0.0.0.0 --port $PORT
Restart=on-failure
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT

priv tee /etc/systemd/system/nova-tunnel.service >/dev/null <<TUNIT
[Unit]
Description=Nova POC Cloudflare tunnel
After=network-online.target nova-poc.service
Wants=network-online.target
Requires=nova-poc.service

[Service]
Type=simple
User=$RUN_USER
Group=$(id -gn "$RUN_USER")
WorkingDirectory=$INSTALL_DIR
Environment=INSTALL_DIR_OVERRIDE=$INSTALL_DIR
Environment=PORT_OVERRIDE=$PORT
ExecStart=$INSTALL_DIR/nova-tunnel.sh $INSTALL_DIR $PORT
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
TUNIT

priv systemctl daemon-reload
priv systemctl enable --now nova-poc.service
priv systemctl enable --now nova-tunnel.service

echo ">>> waiting for tunnel URL..."
URL=""
for _ in $(seq 1 20); do
  sleep 2
  [ -s "$INSTALL_DIR/tunnel_url.txt" ] && { URL="$(cat "$INSTALL_DIR/tunnel_url.txt")"; break; }
done

echo
echo "============================================================"
echo " Nova POC installed and running (persistent via systemd)."
echo " Local : http://localhost:$PORT"
echo " Mobile: ${URL:-<starting; check: cat $INSTALL_DIR/tunnel_url.txt>}"
echo " Logs  : journalctl -u nova-poc -f | journalctl -u nova-tunnel -f"
echo "============================================================"
