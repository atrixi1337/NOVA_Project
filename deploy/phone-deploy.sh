#!/data/data/com.termux/files/usr/bin/bash
# phone-deploy.sh — assumes bootstrap done; copies in real .env externally.
set -uo pipefail
D="$HOME/NOVA_Project"
cd "$D" || { echo "NOVA_Project missing"; exit 1; }

echo "[deploy] venv + pip deps"
[ -x .venv/bin/python ] || python -m venv .venv
# NOTE: pinned `uvicorn[standard]==0.34.0` pulls `watchfiles` (Rust/maturin) which
# has no cp314/aarch64 wheel and no Rust toolchain on this phone -> build fails.
# backend.py was audited and uses NONE of uvloop/httptools/watchfiles/yaml (pure extras),
# so install uvicorn PLAIN (+ real deps) — all resolve to wheels.
sed 's/uvicorn\[standard\]==/uvicorn==/' requirements.txt > requirements.phone.txt
PY=".venv/bin/python"
"$PY" -m pip install --no-cache-dir -r requirements.phone.txt

echo "[deploy] .env present? $([ -f .env ] && echo yes || echo NO)"
[ -f .env ] || cp .env.example .env   # keys empty if missing

echo "[deploy] stop any old uvicorn"
pkill -f 'uvicorn backend:app' 2>/dev/null || true; sleep 1

echo "[deploy] start uvicorn :8000"
set -a; . ./.env 2>/dev/null || true; set +a
export APP_HOST=0.0.0.0 APP_PORT=8000 NOVA_HISTORY_DB="$D/nova_history.db"
nohup "$PY" -m uvicorn backend:app --host 0.0.0.0 --port 8000 > "$D/nova-app.log" 2>&1 &
for i in $(seq 1 50); do curl -sf http://localhost:8000/api/health >/dev/null 2>&1 && break; sleep 2; done
if curl -sf http://localhost:8000/api/health >/dev/null 2>&1; then echo "[deploy] uvicorn healthy"; else echo "[deploy] uvicorn NOT healthy"; tail -30 "$D/nova-app.log"; fi

echo "[deploy] cloudflared quick tunnel"
pkill -f 'cloudflared tunnel' 2>/dev/null || true; sleep 1
nohup cloudflared tunnel --url http://localhost:8000 --no-autoupdate --logfile "$D/nova-tunnel.log" > "$D/nova-tunnel.out" 2>&1 &
URL=""
for i in $(seq 1 40); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$D/nova-tunnel.log" 2>/dev/null | head -1)
  [ -n "$URL" ] && break
  sleep 1
done
[ -n "$URL" ] && echo "$URL" > "$HOME/tunnel_url.txt"

# persist so Android doesn't kill the app while idle:
termux-wake-lock 2>/dev/null || echo "[deploy] termux-wake-lock failed (grant Notification/Window permission to Termux:API)"

WLAN=$(termux-wifi-ip 2>/dev/null || (ip -4 addr show wlan0 2>/dev/null | grep -oE 'inet [0-9.]+' | cut -d' ' -f2) || hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^192\.168' | head -1)
echo "RESULT SSH=$(whoami)@${WLAN:-<unknown>}:8022"
echo "RESULT TUNNEL=${URL:-NONE}"
echo "RESULT HEALTH=${URL:+$URL/}api/health"
echo "RESULT_END"
