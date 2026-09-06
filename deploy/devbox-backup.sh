#!/usr/bin/env bash
# Nightly Nova backup (run ON THE DEV BOX — it already has SSH access to the phone)
# =================================================================================
# Pulls a consistent snapshot of the phone's nova_history.db plus its .env into
# ~/NOVA_Project_backups/<date>/ and keeps the last KEEP_DAYS daily folders.
#
#   deploy/devbox-backup.sh            # one backup run
#   deploy/devbox-backup.sh --loop     # stay running; back up when >22h since last
#
# Cron line (preferred): see the schedule printed at the end of a run.
# NOTE: the backup folder contains the phone's SECRET .env — keep it private.

set -uo pipefail

PHONE_USER="u0_a318"
PHONE_HOST="192.168.0.6"
PHONE_PORT="8022"
KEY="$HOME/.ssh/nova_phone_key"
KH="$HOME/.ssh/nova_phone_known_hosts"
BACKUP_ROOT="$HOME/NOVA_Project_backups"
KEEP_DAYS=14
MIN_GAP_HOURS=22   # loop mode: minimum hours between backups

SSH_OPTS=(-i "$KEY" -p "$PHONE_PORT" -o "UserKnownHostsFile=$KH" -o "StrictHostKeyChecking=accept-new" -o "ConnectTimeout=15")
SSH_CMD=(ssh "${SSH_OPTS[@]}" "$PHONE_USER@$PHONE_HOST")
SCP_CMD=(scp -P "$PHONE_PORT" -i "$KEY" -o "UserKnownHostsFile=$KH" -o "StrictHostKeyChecking=accept-new")

STAMP_FILE="$BACKUP_ROOT/.last-backup"

do_backup() {
  local date dir
  date="$(date +%F)"
  dir="$BACKUP_ROOT/$date"
  mkdir -p "$dir"

  echo "[$(date '+%F %T')] snapshotting DB on the phone..."
  if ! "${SSH_CMD[@]}" 'python "$HOME/NOVA_Project/deploy/phone-snapshot-db.py"'; then
    echo "[$(date '+%F %T')] ERROR: snapshot failed"; return 1
  fi

  echo "[$(date '+%F %T')] pulling snapshot + .env..."
  if ! "${SCP_CMD[@]}" "$PHONE_USER@$PHONE_HOST:nova_db_snapshot.db" "$dir/nova_history.db"; then
    echo "[$(date '+%F %T')] ERROR: scp DB failed"; return 1
  fi
  if ! "${SCP_CMD[@]}" "$PHONE_USER@$PHONE_HOST:NOVA_Project/.env" "$dir/.env"; then
    echo "[$(date '+%F %T')] ERROR: scp .env failed"; return 1
  fi
  "${SSH_CMD[@]}" 'rm -f "$HOME/nova_db_snapshot.db"'

  chmod 700 "$dir"
  chmod 600 "$dir/nova_history.db" "$dir/.env"
  date +%s > "$STAMP_FILE"

  # rotate old folders
  ls -1d "$BACKUP_ROOT"/2* 2>/dev/null | sort | head -n -"$KEEP_DAYS" | while read -r old; do
    rm -rf "$old"
    echo "[$(date '+%F %T')] pruned $old"
  done

  echo "[$(date '+%F %T')] backup complete: $dir ($(du -sh "$dir" | cut -f1))"
  echo "cron suggestion: 15 4 * * * $PWD/deploy/devbox-backup.sh >> $BACKUP_ROOT/backup.log 2>&1"
}

mkdir -p "$BACKUP_ROOT"

if [ "${1:-}" = "--loop" ]; then
  echo "[$(date '+%F %T')] backup loop started (min gap ${MIN_GAP_HOURS}h)"
  while true; do
    last=0
    [ -f "$STAMP_FILE" ] && last="$(cat "$STAMP_FILE" 2>/dev/null || echo 0)"
    now="$(date +%s)"
    gap=$(( (now - last) / 3600 ))
    if [ "$gap" -ge "$MIN_GAP_HOURS" ]; then
      do_backup || true
    fi
    sleep 1800
  done
else
  do_backup
fi
