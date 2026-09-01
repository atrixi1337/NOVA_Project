#!/data/data/com/termin/files/usr/bin/bash
# Termux:Boot autostart for the NOVA phone deploy (Cloudflare-only).
# Install Termux:Boot (F-Droid), grant Storage+Run-at-startup, then on every
# reboot Termux runs ~/.termux/boot/*.sh: re-launches uvicorn + the Cloudflare
# quick tunnel and re-holds a wake lock. Keys must already be staged at
# ~/.ssh/authorized_keys + ~/NOVA_Project/.env (run deploy/phone-bootstrap.sh +
# deploy/phone-deploy.sh once manually first).
set -uo pipefail
termux-wake-lock 2>/dev/null || true
sleep 3

D="$HOME/NOVA_Project"
cd "$D" || exit 1
[ -f ./.env ] || cp .env.example .env   # keys must be staged beforehand
set -a; . ./.env 2>/dev/null || true; set +a
export APP_HOST=0.0.0.0 APP_PORT=8000 NOVA_HISTORY_DB="$D/nova_history.db"

# one instance only
pkill -f 'uvicorn backend:app'  2>/dev/null || true
pkill -f 'cloudflared tunnel'   2>/dev/null || true
sleep 1

nohup ./.venv/bin/python -m uvicorn backend:app --host 0.0.0.0 --port 8000 > "$D/nova-app.log" 2>&1 &
nohup cloudflared tunnel --url http://localhost:8000 --no-autoupdate --logfile "$D/nova-tunnel.log" > "$D/nova-tunnel.out" 2>&1 &

# surface the public URL when ready (quick tunnels regenerate this on each start)
for i in $(seq 1 40); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$D/nova-tunnel.log" 2>/dev/null | head -1)
  [ -n "$URL" ] && { echo "$URL" > "$HOME/tunnel_url.txt"; break; }
  sleep 1
done
echo "$(date): NOVA boot-start done; tunnel=${URL:-pending}" > "$D/boot-start.log"
