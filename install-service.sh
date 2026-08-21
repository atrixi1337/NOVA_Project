#!/usr/bin/env bash
# Installs the Nova POC as a systemd service so it survives reboots.
# Run as root (sudo). This script just stages the unit + enables/starts it.
set -euo pipefail

SRC_DIR=/home/dev/Downloads/nova-poc
UNIT_SRC="$SRC_DIR/nova-poc.service"
UNIT_DST=/etc/systemd/system/nova-poc.service

if [ ! -f "$UNIT_SRC" ]; then
  echo "Missing unit file: $UNIT_SRC" >&2
  exit 1
fi

echo "Stopping any loose uvicorn on :8000 (so the service can bind)..."
# Kill processes currently holding port 8000 (best-effort).
fuser -k 8000/tcp 2>/dev/null || true
sleep 1

echo "Installing unit -> $UNIT_DST"
install -m 0644 "$UNIT_SRC" "$UNIT_DST"

echo "Reloading systemd and enabling/starting nova-poc..."
systemctl daemon-reload
systemctl enable --now nova-poc

echo "Done. Status:"
systemctl status nova-poc --no-pager || true
