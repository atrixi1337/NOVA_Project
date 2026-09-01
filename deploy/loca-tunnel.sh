#!/data/data/com/termux/files/usr/bin/bash
# loca-tunnel.sh — free, fixed-subdomain tunnel via localtunnel (no domain needed).
cd "$HOME/NOVA_Project" || exit 1
pkill -f 'lt --port' 2>/dev/null || true
sleep 1
# try a few candidate subdomains; localtunnel errors fast if taken
for sub in nova novafl3 novaapp nova1337 novaflip; do
  log="$HOME/nova-lt.log"
  nohup lt --port 8000 --subdomain "$sub" --no-open > "$log" 2>&1 &
  pid=$!
  for i in $(seq 1 14); do
    sleep 1
    if grep -q "your url is" "$log" 2>/dev/null; then
      URL=$(grep -oE 'https://[a-z0-9-]+\.loca\.lt' "$log" | head -1)
      [ -n "$URL" ] && { echo "$URL" > "$HOME/nova-loca-url.txt"; echo "CHOSEN sub=$sub URL=$URL PID=$pid"; exit 0; }
    fi
    kill -0 "$pid" 2>/dev/null || { echo "sub=$sub unavailable"; break; }
  done
  kill "$pid" 2>/dev/null || true
done
echo "NO_SUBDOMAIN_WORKED"; exit 2
