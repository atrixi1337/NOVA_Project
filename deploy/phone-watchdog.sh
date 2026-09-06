#!/data/data/com.termux/files/usr/bin/bash
# Sallaapam watchdog (run on the phone, Termux)
# =============================================
# Checks /api/health every CHECK_INTERVAL seconds; after FAIL_THRESHOLD
# consecutive failures it restarts uvicorn (same start block as the handover).
# Android kills Termux processes silently — this turns that from "site down
# until someone notices" into "site down for a minute".
#
# Start it:
#   nohup bash ~/NOVA_Project/deploy/phone-watchdog.sh >/dev/null 2>&1 &
# (single-instance via pid lock; safe to re-run, safe from Termux:Boot)

APP_DIR="$HOME/NOVA_Project"
LOG="$APP_DIR/watchdog.log"
LOCK="$APP_DIR/.watchdog.pid"
HEALTH_URL="http://localhost:8000/api/health"
CHECK_INTERVAL="${WATCHDOG_INTERVAL:-30}"
FAIL_THRESHOLD="${WATCHDOG_THRESHOLD:-2}"

# --- single instance ---
if [ -f "$LOCK" ] && kill -0 "$(cat "$LOCK")" 2>/dev/null; then
  echo "watchdog already running (pid $(cat "$LOCK"))"
  exit 0
fi
echo $$ > "$LOCK"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }
log "watchdog started (pid $$, interval ${CHECK_INTERVAL}s, threshold ${FAIL_THRESHOLD})"

start_uvicorn() (
  cd "$APP_DIR" || return 1
  set -a
  # shellcheck disable=SC1091
  . ./.env 2>/dev/null
  set +a
  export APP_HOST=0.0.0.0 APP_PORT=8000
  export NOVA_HISTORY_DB="$APP_DIR/nova_history.db"
  nohup "$APP_DIR/.venv/bin/python" -m uvicorn backend:app \
    --host 0.0.0.0 --port 8000 < /dev/null >> "$APP_DIR/nova-app.log" 2>&1 &
)

fails=0
while true; do
  if curl -sf --max-time 10 "$HEALTH_URL" >/dev/null 2>&1; then
    fails=0
  else
    fails=$((fails + 1))
    log "health check failed ($fails/$FAIL_THRESHOLD)"
    if [ "$fails" -ge "$FAIL_THRESHOLD" ]; then
      log "restarting uvicorn"
      # bracket pattern so pkill can't match this script's own cmdline
      pkill -f '[u]vicorn backend:app' 2>/dev/null
      sleep 2
      start_uvicorn
      ok=0
      for _ in $(seq 1 30); do
        sleep 2
        if curl -sf --max-time 10 "$HEALTH_URL" >/dev/null 2>&1; then ok=1; break; fi
      done
      if [ "$ok" = 1 ]; then
        log "restart OK"
      else
        log "restart FAILED — will retry next cycle"
      fi
      fails=0
    fi
  fi
  sleep "$CHECK_INTERVAL"
done
