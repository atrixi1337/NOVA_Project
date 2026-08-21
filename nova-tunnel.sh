#!/usr/bin/env bash
# nova-tunnel.sh — Cloudflare quick-tunnel wrapper.
# Exposes the local Nova POC app at a public *.trycloudflare.com URL and
# writes that URL to $INSTALL_DIR/tunnel_url.txt as soon as it's assigned
# (and again on every reconnect), so the user can always find "the endpoint".
set -euo pipefail

INSTALL_DIR="${1:-${INSTALL_DIR_OVERRIDE:-$HOME}}"
PORT="${2:-${PORT_OVERRIDE:-8000}}"
LOG="$INSTALL_DIR/nova-tunnel.log"
URLFILE="$INSTALL_DIR/tunnel_url.txt"

: > "$LOG"

# Watch the log and capture the assigned URL.
( tail -n0 -F "$LOG" 2>/dev/null | while read -r line; do
    u="$(printf '%s' "$line" | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' || true)"
    [ -n "$u" ] && printf '%s\n' "$u" > "$URLFILE"
  done ) &
WATCHER=$!

cloudflared tunnel --url "http://localhost:$PORT" --no-autoupdate --logfile "$LOG"
kill "$WATCHER" 2>/dev/null || true
