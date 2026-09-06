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
# Optional push: set WATCHDOG_NTFY=https://ntfy.sh/your-secret-topic in .env
NTFY_URL="${WATCHDOG_NTFY:-}"
LOG_ROTATE_BYTES=$((5 * 1024 * 1024))   # rotate app/tunnel logs past 5 MB
ROTATE_CHECK_INTERVAL=3600              # check sizes once an hour

# --- single instance ---
if [ -f "$LOCK" ] && kill -0 "$(cat "$LOCK")" 2>/dev/null; then
  echo "watchdog already running (pid $(cat "$LOCK"))"
  exit 0
fi
echo $$ > "$LOCK"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }
notify() {
  # push an event if ntfy is configured (also leaves a copy in the log)
  [ -n "$1" ] && log "notify: $1"
  if [ -n "$NTFY_URL" ]; then
    curl -sf --max-time 10 -d "$1" "$NTFY_URL" >/dev/null 2>&1 || true
  fi
}

# copytruncate rotation: the running server keeps its fd, we snapshot then
# truncate in place — no restart needed, no lost lines beyond the race window.
rotate_logs() {
  local f size
  for f in "$APP_DIR/nova-app.log" "$APP_DIR/nova-tunnel.log"; do
    [ -f "$f" ] || continue
    size=$(stat -c%s "$f" 2>/dev/null || echo 0)
    if [ "$size" -gt "$LOG_ROTATE_BYTES" ]; then
      cp "$f" "$f.1" 2>/dev/null || true
      : > "$f"
      log "rotated $f ($((size / 1024 / 1024)) MB) -> $f.1"
    fi
  done
}
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
last_rotate=0
while true; do
  now=$(date +%s)
  if [ $((now - last_rotate)) -ge "$ROTATE_CHECK_INTERVAL" ]; then
    last_rotate=$now
    rotate_logs
  fi
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
        notify "Nova: uvicorn was down, watchdog restarted it OK"
      else
        log "restart FAILED — will retry next cycle"
        notify "Nova: WATCHDOG RESTART FAILED — site may be down"
      fi
      fails=0
    fi
  fi
  sleep "$CHECK_INTERVAL"
done
