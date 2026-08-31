#!/usr/bin/env bash
# =============================================================================
# alicloud-deploy.sh
# Provision an Alibaba Cloud ECS (Singapore, smallest-fit) and deploy NOVA_Project
# on it: Docker Compose backend + Nginx :80 -> :8000 reverse proxy.
#
# Region/zone:  ap-southeast-1 / ap-southeast-1d
# Instance:     ecs.e-c1m4.large  (2 vCPU / 8 GB)  -- smallest type offered in this zone
# Image:        ubuntu_22_04_x64_20G_alibase_20260810.vhd
# Ingress:      SG allows TCP 22/80/443 from 0.0.0.0/0
# Result:       http://<PUBLIC_IP>/api/health  -> 15 providers, nvidia configured:true
#
# Pre-reqs (run on the machine executing this script):
#   * aliyun CLI v3+  (~/.local/bin/aliyun) with `default` profile configured from
#     the AccessKey CSV (header: AccessKey ID,AccessKey Secret), region ap-southeast-1.
#   * SSH keypair  nova-ecs-key  with private key at  ~/.ssh/alicloud-nova
#   * A local app .env with all provider keys (NVIM_API_KEY, GEMINI_API_KEYS, ...).
#       It is copied to the box with scp -- its values are never printed.
#   * The NOVA_Project repo already pushed to GitHub: https://github.com/atrixi1337/NOVA_Project
#
# Budget guardrail: ecs.e-c1m4.large is billed shared-benefits (~¥0.03/hr).
#   Stop it when not in use:  aliyun ecs StopInstance --InstanceId $IID --RegionId $R
#   (stopped => no compute charge; only the system disk ~¥0.3/mo continues).
# =============================================================================
set -euo pipefail

R="ap-southeast-1"
Z="ap-southeast-1d"
IID=""          # instance id, populated when created
GIT="https://github.com/atrixi1337/NOVA_Project.git"
ENV_SRC="${ENV_SRC:-/home/dev/PROJECT/NOVA_Project/.env}"

# ---- 1. Network: VPC + VSwitch + Security Group (idempotent by name tags) ----
# (One-time bootstrap; skip if already created.)
ZONE_CIDR="10.0.1.0/24"
SG_NAME="nova-poc-sg"
VPC=$(aliyun vpc CreateVpc --RegionId "$R" --CidrBlock "10.0.0.0/16" --VpcName nova-poc \
        | jq -r '.VpcId' --arg name nova-poc 2>/dev/null || echo "")
VSW=$(aliyun vpc CreateVSwitch --RegionId "$R" --ZoneId "$Z" --VpcId "$VPC" \
        --CidrBlock "$ZONE_CIDR" --ZoneId "$Z" --VSwitchName nova-poc \
        | jq -r '.VSwitchId' 2>/dev/null || echo "")
SG=$(aliyun ecs CreateSecurityGroup --RegionId "$R" --VpcId "$VPC" --Description nova-poc \
        | jq -r '.SecurityGroupId' 2>/dev/null || echo "")
# Open 22/80/443 from anywhere (production should restrict 22 to your IP).
aliyun ecs AuthorizeSecurityGroup --SecurityGroupId "$SG" --RegionId "$R" \
        --IpProtocol tcp --PortRange 22/22 --SourceCidrIp 0.0.0.0/0
aliyun ecs AuthorizeSecurityGroup --SecurityGroupId "$SG" --RegionId "$R" \
        --IpProtocol tcp --PortRange 80/80 --SourceCidrIp 0.0.0.0/0
aliyun ecs AuthorizeSecurityGroup --SecurityGroupId "$SG" --RegionId "$R" \
        --IpProtocol tcp --PortRange 443/443 --SourceCidrIp 0.0.0.0/0

# ---- 2. Key pair (import existing public key) ----
#   Public key already imported as `nova-ecs-key`; private key at ~/.ssh/alicloud-nova

# ---- 3. Launch instance (smallest type available in this zone) ----
IMG="ubuntu_22_04_x64_20G_alibase_20260810.vhd"
IID=$(aliyun ecs RunInstances --RegionId "$R" \
        --ImageId "$IMG" --InstanceType "ecs.e-c1m4.large" --ZoneId "$Z" \
        --VSwitchId "$VSW" --SecurityGroupId "$SG" --KeyPairName "nova-ecs-key" \
        --HostName "nova-poc" --InstanceName "nova-poc" \
        --InternetMaxBandwidthOut 10 --InternetChargeType PayByTraffic \
        | jq -r '.InstanceIdSets.InstanceIdSet[0]')

echo "Launched instance: $IID  -- waiting for Running + public IP ..."
for i in $(seq 1 40); do
  D=$(aliyun ecs DescribeInstances --RegionId "$R" --PageSize 50 \
        | jq -r --arg id "$IID" '.Instances.Instance[]?|select(.InstanceId==$id)|{Status:.Status,Ip:(.PublicIp.IpAddress[]?)}')
  ST=$(echo "$D" | jq -r '.Status')
  PIP=$(echo "$D" | jq -r '.Ip')
  if [ "$ST" = "Running" ] && [ -n "$PIP" ]; then break; fi
  sleep 6
done
PIP=$(aliyun ecs DescribeInstances --RegionId "$R" --PageSize 50 \
        | jq -r --arg id "$IID" '.Instances.Instance[]?|select(.InstanceId==$id)|.PublicIp.IpAddress[]?' | head -1)
[ -z "$PIP" ] && { echo "ERROR: no public IP allocated"; exit 1; }
echo "Public IP: $PIP"
export PIP

# If AllocatePublicIpAddress wasn't used, assign one:
#   aliyun ecs AllocatePublicIpAddress --InstanceId "$IID" --RegionId "$R"
# (Allocate an EIP only if you need a static, re-attachable address.)

# ---- 4. SSH provisioning: Docker + compose + repo clone ----
KEY="${HOME}/.ssh/alicloud-nova"
ssh -i "$KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=20 root@"$PIP" bash -s <<'SSH'
set -e
echo "===> install docker + compose + git"
apt-get update -qq && apt-get install -y -qq docker.io docker-compose-v2 git curl >/tmp/apt.log 2>&1
echo "===> clone repo"
rm -rf /root/NOVA_Project && git clone "${GIT}" /root/NOVA_Project
SSH

# ---- 5. Copy the app .env (secret values never printed) ----
scp -i "$KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -q "$ENV_SRC" \
    root@"$PIP":/root/NOVA_Project/.env && echo ".env copied (line count only: $(ssh -i "$KEY" root@"$PIP" 'wc -l < /root/NOVA_Project/.env'))"

# ---- 6. Fix the SQLite bind-mount (docker turns a missing source path into a dir,
#       which sqlite cannot open) + start the stack ----
ssh -i "$KEY" root@"$PIP" bash -s <<'SSH'
set -e
cd /root/NOVA_Project
rm -rf nova_history.db && touch nova_history.db && chmod 666 nova_history.db   # writable by the container's appuser
docker compose down 2>/dev/null || true
docker compose up -d
echo "===> waiting for backend :8000 ..."
for i in $(seq 1 15); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:8000/api/health)
  [ "$code" = "200" ] && break || sleep 3
done
# ---- 7. Nginx reverse proxy :80 -> 127.0.0.1:8000 (clean public URL, SSE-friendly) ----
apt-get install -y -qq nginx >/tmp/nginx.log 2>&1
cat > /etc/nginx/sites-available/nova.conf <<'NGINX'
server {
  listen 80 default_server;
  listen [::]:80 default_server;
  server_name _;
  client_max_body_size 25m;
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
nginx -t && ((service nginx status >/dev/null 2>&1 && service nginx restart) || nginx)
SSH

# ---- 8. Verify ----
echo "===> public health: http://$PIP/api/health"
curl -s --max-time 12 "http://$PIP/api/health" \
  | jq -r '.providers // {} | "providers=\(length) nvidia=\(.nvidia.configured)"'
echo "===> public frontend: http://$PIP/"
curl -s -o /dev/null -w "frontend=%{http_code} bytes=%{size_download}\n" --max-time 12 "http://$PIP/"

cat <<EOT
DONE. App live at:  http://$PIP
Instance:          $IID  ($R/$Z, ecs.e-c1m4.large 2vCPU/8GB)
SSH:               ssh -i $KEY root@$PIP
Stop to save money: aliyun ecs StopInstance --InstanceId $IID --RegionId $R
EOT
