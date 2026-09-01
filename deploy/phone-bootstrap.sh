#!/data/data/com.termux/files/usr/bin/bash
# phone-bootstrap.sh (v2) — corrected: logs to $HOME (Termux /tmp is read-only to the app).
# Run over KEY auth once the agent key has been authorized.
set -uo pipefail

echo "[bootstrap] pkg install: openssh termux-api python git build-essential cloudflared iproute2 curl"
pkg install -y openssh termux-api python git build-essential cloudflared iproute2 curl >"$HOME/pkg.log" 2>&1 \
  || { echo "[bootstrap] pkg install FAILED — see $HOME/pkg.log"; tail -25 "$HOME/pkg.log"; }
echo "[bootstrap] pkg exit=$?"

echo "[bootstrap] verify tools"
for t in python git cloudflared termux-wake-lock ip curl; do
  command -v "$t" >/dev/null 2>&1 && echo "  $t: OK" || echo "  $t: MISSING"
done

echo "[bootstrap] clone / pull NOVA_Project"
if [ -d ~/NOVA_Project/.git ]; then
  (cd ~/NOVA_Project && git pull --ff-only)
else
  git clone https://github.com/atrixi1337/NOVA_Project.git ~/NOVA_Project
fi
ls ~/NOVA_Project/backend.py && echo "[bootstrap] clone OK" || echo "[bootstrap] clone MISSING backend.py"
echo "BOOTSTRAP_DONE_V2"
