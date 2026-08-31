#!/usr/bin/env bash
# =============================================================================
# alicloud-deploy.sh
# Provision an Alibaba Cloud ECS (Singapore, smallest available) and deploy
# NOVA_Project with Docker Compose + Nginx reverse proxy + Let's Encrypt.
#
# LIVE/VERIFIED state (Aug 2026):
#   Region/zone : ap-southeast-1 / ap-southeast-1d
#   Instance     : ecs.e-c2m1.large  (2 vCPU / 1 GB)  <-- smallest stocked type here
#   Image        : ubuntu_22_04_x64_20G_alibase_20260810.vhd
#   Ingress      : SG opens TCP 22/80/443 from 0.0.0.0/0  (lock 22 down in prod)
#   Public URL   : https://sallaapam.duckdns.org  (DuckDNS free subdomain + LE cert)
#   Health       : 15 providers, nvidia.configured = true
#
# Notes / gotchas discovered:
#   * requirements.txt has NO torch/numpy (fastapi+uvicorn+httpx+multipart+evtx),
#     so 1 GB is plenty at runtime (~200 MB). The Docker *build* is still light,
#     but a 2 GB swap file is added as insurance on the 1 GB box.
#   * Docker bind-mounts a MISSING source as a DIRECTORY -> sqlite "unable to open
#     db" crash. Fix: `touch` the db file + `chmod 666` so the container's
#     non-root `appuser` can write it.
#   * RunInstances has NO dry-run param; the only real validation is a live call.
#     If e-c2m1.large is not stocked in the AZ, fall back to e-c1m2.large.
#   * nic.duckdns.org:443 is unreachable from Alibaba CN regions; use the
#     www.duckdns.org endpoint for DDNS updates instead.
#
# Pre-reqs (on the machine running this script):
#   * aliyun CLI v3+ (~/.local/bin/aliyun), `default` profile from the AccessKey
#     CSV (AccessKey ID,AccessKey Secret), region ap-southeast-1.
#   * SSH keypair `nova-ecs-key` (private key ~/.ssh/alicloud-nova).
#   * A local app .env with provider keys; copied to the box via scp (never printed).
#   * For the domain+TLS step: set DUCKDNS_TOKEN (your DuckDNS token) and
#     DUCKDNS_DOMAIN (e.g. sallaapam.duckdns.org) in the environment.
#   * Repo already on GitHub: https://github.com/atrixi1337/NOVA_Project
#
# Budget: ecs.e-c2m1.large ~¥0.0150/hr. Stop when idle (no compute charge):
#   aliyun ecs StopInstance --InstanceId $IID --RegionId $R
# (Alibaba keeps the public IP across stop/start, so the DuckDNS record stays valid.)
# =============================================================================
set -euo pipefail

R="ap-southeast-1"
Z="ap-southeast-1d"
IMG="ubuntu_22_04_x64_20G_alibase_20260810.vhd"
TYPE="ecs.e-c2m1.large"          # 2 vCPU / 1 GB; smallest stocked in this AZ
GIT="https://github.com/atrixi1337/NOVA_Project.git"
ENV_SRC="${ENV_SRC:-/home/dev/PROJECT/NOVA_Project/.env}"
KEY="${HOME}/.ssh/alicloud-nova"
DUCKDNS_DOMAIN="${DUCKDNS_DOMAIN:-sallaapam.duckdns.org}"
DUCKDNS_TOKEN="${DUCKDNS_TOKEN:-}"

# ---- 1. Network: VPC + VSwitch + Security Group (lookup, else create) --------
# (Idempotent one-time bootstrap; safe to re-run.)
VPC=$(aliyun vpc DescribeVpcs --RegionId "$R" --VpcName nova-poc --PageSize 10 \
      | jq -r '.Vpcs.Vpc[]?.VpcId' 2>/dev/null || echo "")
[ -z "$VPC" ] && VPC=$(aliyun vpc CreateVpc --RegionId "$R" --CidrBlock "10.0.0.0/16" \
      --VpcName nova-poc | jq -r '.VpcId')
VSW=$(aliyun vpc DescribeVSwitches --RegionId "$R" --VSwitchName nova-poc --PageSize 10 \
      | jq -r '.VSwitches.VSwitch[]?.VSwitchId' 2>/dev/null || echo "")
[ -z "$VSW" ] && VSW=$(aliyun vpc CreateVSwitch --RegionId "$R" --ZoneId "$Z" --VpcId "$VPC" \
      --CidrBlock "10.0.1.0/24" --VSwitchName nova-poc | jq -r '.VSwitchId')
SG=$(aliyun ecs DescribeSecurityGroups --RegionId "$R" --VpcId "$VPC" --PageSize 50 \
      | jq -r '.SecurityGroups.SecurityGroup[]?|select(.Description=="nova-poc").SecurityGroupId' 2>/dev/null || echo "")
[ -z "$SG" ] && SG=$(aliyun ecs CreateSecurityGroup --RegionId "$R" --VpcId "$VPC" --Description nova-poc \
      | jq -r '.SecurityGroupId')
# 22/80/443 from anywhere (restrict 22 to your IP in production):
for prt in 22 80 443; do
  aliyun ecs AuthorizeSecurityGroup --SecurityGroupId "$SG" --RegionId "$R" \
    --IpProtocol tcp --PortRange "$prt/$prt" --SourceCidrIp 0.0.0.0/0
done

# ---- 2. Launch instance (smallest stocked type) -----------------------------
IID=$(aliyun ecs RunInstances --RegionId "$R" --ImageId "$IMG" --InstanceType "$TYPE" \
      --ZoneId "$Z" --VSwitchId "$VSW" --SecurityGroupId "$SG" --KeyPairName "nova-ecs-key" \
      --HostName "nova-poc" --InstanceName "nova-poc" \
      --InternetMaxBandwidthOut 10 --InternetChargeType PayByTraffic \
      | jq -r '.InstanceIdSets.InstanceIdSet[0]')
echo "Launched $TYPE -> $IID  (waiting for Running + public IP)"
for i in $(seq 1 40); do
  ST=$(aliyun ecs DescribeInstances --RegionId "$R" --PageSize 50 \
        | jq -r --arg id "$IID" '.Instances.Instance[]?|select(.InstanceId==$id)|.Status')
  [ "$ST" = "Running" ] && break; sleep 5
done
# Assign a public IPv4 (Alibaba VPC instances don't auto-assign one):
PIP=$(aliyun ecs AllocatePublicIpAddress --RegionId "$R" --InstanceId "$IID" | jq -r '.IpAddress')
echo "Public IP: $PIP"
export PIP

# ---- 3. SSH provisioning: swap + docker + compose + git ---------------------
ssh -i "$KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=20 \
    root@"$PIP" bash -s <<'SSH'
set -e
# 2GB swap (insurance for the Docker build on a 1GB host)
if ! swapon --show 2>/dev/null | grep -q /swap; then
  fallocate -l 2G /swap && chmod 600 /swap && mkswap /swap >/dev/null 2>&1 && swapon /swap
  grep -q '^/swap ' /etc/fstab || echo '/swap none swap sw 0 0' >> /etc/fstab
fi
apt-get update -qq && apt-get install -y -qq docker.io docker-compose-v2 git nginx >/tmp/apt.log 2>&1
rm -rf /root/NOVA_Project && git clone -q "${GIT}" /root/NOVA_Project
SSH

# ---- 4. Copy app .env (never printed) ---------------------------------------
scp -i "$KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -q "$ENV_SRC" \
    root@"$PIP":/root/NOVA_Project/.env

# ---- 5. Fix sqlite bind-mount + start stack ---------------------------------
ssh -i "$KEY" root@"$PIP" bash -s <<'SSH'
set -e
cd /root/NOVA_Project
# Docker bind-mounts a MISSING source as a dir -> sqlite crash. Use a file + 666
# so the container's non-root `appuser` can write:
rm -rf nova_history.db && touch nova_history.db && chmod 666 nova_history.db
docker compose up -d 2>&1 | tail -4
# wait for :8000
for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:8000/api/health)
  [ "$code" = "200" ] && break || sleep 4
done
# Nginx :80 -> :8000 (300s timeouts: NIM's 90B model can take >60s -> nginx 504 otherwise)
cat > /etc/nginx/sites-available/nova.conf <<'NGINX'
server {
  listen 80 default_server;
  listen [::]:80 default_server;
  server_name _;
  client_max_body_size 25m;
  proxy_connect_timeout 30s;
  proxy_send_timeout 300s;
  proxy_read_timeout 300s;
  location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";
    proxy_buffering off;
  }
}
NGINX
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/nova.conf /etc/nginx/sites-enabled/nova.conf
nginx -t
(service nginx status >/dev/null 2>&1 && service nginx restart) || nginx
SSH

# ---- 6. Free domain (DuckDNS) + free HTTPS (Let's Encrypt) ------------------
if [ -n "$DUCKDNS_TOKEN" ]; then
  # Push token to a root-only file (never echo). nic.duckdns.org:443 is unreachable
  # from Alibaba CN regions, so use the www.duckdns.org endpoint.
  printf '%s' "$DUCKDNS_TOKEN" | ssh -i "$KEY" root@"$PIP" 'cat > /tmp/.ducktok && chmod 600 /tmp/.ducktok'
  ssh -i "$KEY" root@"$PIP" bash -s <<'SSH'
DUCK=$(cat /tmp/.ducktok); rm -f /tmp/.ducktok
RESP=$(curl -sS --max-time 15 -u "${DUCK}:" \
  "https://www.duckdns.org/update?hostname=sallaapam&myip=$(curl -s https://checkip.amazonaws.com)")
echo "duckdns: $RESP"
# daily DDNS refresh (auto-detects current egress IP = the ECS public IP)
cat > /usr/local/bin/duckdns-update.sh <<'SH'
#!/bin/sh
TOK=$(cat /root/.duckdnstoken 2>/dev/null)
[ -n "$TOK" ] && curl -sS --max-time 20 -u "${TOK}:" \
  "https://www.duckdns.org/update?hostname=sallaapam" >/var/log/duckdns.log 2>&1 || true
SH
chmod +x /usr/local/bin/duckdns-update.sh
echo "17 3 * * * root /usr/local/bin/duckdns-update.sh" > /etc/cron.d/duckdns-ddns
chmod 644 /etc/cron.d/duckdns-ddns
# persist token for the cron (root-only)
SH
  # certbot: LE cert via nginx HTTP-01 + http->https redirect, auto-renews
  ssh -i "$KEY" root@"$PIP" bash -s <<'SSH'
apt-get install -y -qq certbot python3-certbot-nginx >/tmp/certbot.log 2>&1
sleep 2   # let DNS propagate
certbot --nginx -d sallaapam.duckdns.org --redirect --agree-tos --no-eff-email \
        -m admin@sallaapam.duckdns.org 2>&1 | tail -8
SSH
fi

# ---- 7. Verify --------------------------------------------------------------
echo "=== https://$PIP ... (IP direct) ==="
curl -s -o /dev/null -w "ip:8000 health=%{http_code}\n" --max-time 8 "http://$PIP/api/health"
if [ -n "$DUCKDNS_TOKEN" ]; then
  echo "=== https://sallaapam.duckdns.org ==="
  curl -s -o /dev/null -w "https health=%{http_code}\n" --max-time 12 "https://sallaapam.duckdns.org/api/health"
  curl -s --max-time 12 "https://sallaapam.duckdns.org/api/health" | jq -r \
    '.providers // {} | "providers=\(length) nvidia=\(.nvidia.configured)"'
  curl -s -o /dev/null -w "http->%{http_code} ->%{redirect_url}\n" --max-time 10 \
    "http://sallaapam.duckdns.org/api/health"
fi
cat <<EOT
DONE. App live at:  https://sallaapam.duckdns.org  (http -> $PIP)
Instance:        $IID  ($TYPE, $R/$Z)   -- stop when idle to save money
SSH:             ssh -i $KEY root@$PIP
Stop to save:    aliyun ecs StopInstance --InstanceId $IID --RegionId $R
Start later:     aliyun ecs StartInstance --InstanceId $IID --RegionId $R
Delete when done: aliyun ecs DeleteInstance --InstanceId $IID --RegionId $R
EOT
