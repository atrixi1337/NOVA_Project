# NOVA Telegram bot

A stdlib-only Telegram bot (`/up`/`/down`/`/status`) that starts/stops your
Alibaba ECS instance `i-t4n6s906crezn4x97owh`.

**Principle:** it uses a dedicated **scoped RAM user** (`nova-bot`) whose
policy only allows `ecs:DescribeInstances` (on `instance/*`) and
`ecs:StartInstance`/`ecs:StopInstance` (on this one instance). It never uses
your main Alibaba AccessKey.

## 1. Get a bot token + authorize your Telegram id
1. Open Telegram → talk to **@BotFather** → `/newbot` → copy the token.
2. Start a DM with your bot → send `/start`. Because `TG_ALLOWED_CHAT_ID` is
   not set yet, the bot replies with **your own `chat_id`** (and does **not**
   touch ECS) e.g. `Your chat_id is 123456… — set TG_ALLOWED_CHAT_ID=123456…`
   *(no command line; read it from the DM).*
3. Harden it: set `TG_ALLOWED_CHAT_ID=<that id>` on the host and update
   (so only your Telegram account can run `/up`/`/down`/`/status`) — see
   "Lock it to your id" below. The bot enforces `TG_ALLOWED_CHAT_ID` whenever it
   is set; until then it only ever echoes the chat_id (never stops the server).

## 2. Create the scoped RAM user + policy
The policy is in `nova-bot-ecs-policy.json` (Describe on `instance/*`,
Start/Stop on `i-t4n6s906crezn4x97owh` only):
```bash
AK=5242187308518885  # your account id
IID=i-t4n6s906crezn4x97owh
REG=ap-southeast-1

# 1) policy
aliyun ram CreatePolicy --PolicyName nova-bot-ecs \
  --PolicyDocument file://nova-bot-ecs-policy.json \
  --Description "NOVA bot: describe(all) + start/stop(one)"

# 2) user + password-less access key (only Start/Stop/Describe)
aliyun ram CreateUser --UserName nova-bot
aliyun ram CreateAccessKey --UserName nova-bot   # -> AccessKeyId / AccessKeySecret
aliyun ram AttachPolicyToUser --UserName nova-bot --PolicyName nova-bot-ecs --PolicyType Custom

# 3) verify (replace env with the scoped AK, never the root AK):
export ALIYUN_AK=<scoped-id>
export ALIYUN_SK=<scoped-secret>
env ALIYUN_AK="$ALIYUN_AK" ALIYUN_SK="$ALIYUN_SK" \
  python3 -c "import os,sys; sys.argv=['x']; exec(open('index.py').read().split('AK  =')[0]); print(ecs('DescribeInstances')['Instances']['Instance'][0]['Status'])"
```

## 3. Run it (pick one)

### Option A — host it yourself (always-on box / $5 VM / rPI)
```bash
sudo mkdir -p /opt/nova-bot && sudo cp index.py /opt/nova-bot/
sudo cp nova-poc-bot.service /etc/systemd/system/
sudo tee /etc/nova-bot.env >/dev/null 600 <<EOF
TG_BOT_TOKEN=<token-from-botfather>
ECS_INSTANCE=i-t4n6s906crezn4x97owh
REGION=ap-southeast-1
ALIYUN_AK=<scoped-nova-bot-id>
ALIYUN_SK=<scoped-nova-bot-secret>
LISTEN=8080
EOF
sudo chmod 600 /etc/nova-bot.env
sudo systemctl daemon-reload && sudo systemctl enable --now nova-poc-bot
# expose port 8080 behind nginx (TLS) and set the webhook (see Option C)
```
Then point the Telegram webhook at your nginx path (Option C).

### Option B — Alibaba Function Compute (serverless, no host for you)
The bot already ships an FC HTTP handler (`main.handler`). Deploy:
```bash
# zip + base64 the code
cd …/deploy/telegram-bot
pip install -q -t . alibabacloud-fc 2>/dev/null || true   # not needed: stdlib only
CODE_B64=$(base64 -w0 index.py.zip)

aliyun fc CreateFunction --body "{
  \"functionName\": \"nova-poc-bot\",
  \"runtime\": \"python3.10\",
  \"code\": {\"zipFile\": \"$CODE_B64\"},
  \"handler\": \"main.handler\",
  \"timeout\": 30, \"memorySize\": 128,
  \"environment\": {\"value\": {
      \"TG_BOT_TOKEN\": \"<token>\",
      \"ECS_INSTANCE\": \"i-t4n6s906crezn4x97owh\",
      \"REGION\": \"ap-southeast-1\",
      \"ALIYUN_AK\": \"<scoped-id>\",
      \"ALIYUN_SK\": \"<scoped-secret>\"
  }}
}"
# HTTP trigger + webhook
aliyun fc CreateTrigger --functionName nova-poc-bot --body \
  "{\"triggerName\":\"webhook\",\"triggerType\":\"http\",\"triggerConfig\":{\"authType\":\"anonymous\"}}"
URL=$(aliyun fc GetTrigger --functionName nova-poc-bot --triggerName webhook | jq -r '.httpTrigger.url')   # fill in when supported
curl -X POST "$URL" -d '{"message":{"chat":{"id":<your-chat>},"text":"/status"}}'   # test
curl "https://api.telegram.org/bot<token>/setWebhook?url=$URL"
```
(FC 3.0 HTTP-trigger URL extraction varies by account; the manual host route in
Option A is the most predictable if you hit friction.)

### Option C — set the Telegram webhook (after Option A or B)
```
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://sallaapam.duckdns.org/bot"
```
Your nginx (behind the Let's Encrypt cert) proxies `/bot` → `127.0.0.1:8080`:
```
location /bot { proxy_pass http://127.0.0.1:8080; proxy_read_timeout 300s; }
```

## Security
- Only the scoped `nova-bot` RAM user (id/secret) reaches ECS — revoke it any
  time with `aliyun ram DeleteAccessKey`.
- Lock the bot to your Telegram id (recommended): once you have your `chat_id`
  from step 1, set it as the `TG_ALLOWED_CHAT_ID` env var:
  - **FC:** `aliyun fc UpdateFunction --functionName nova-poc-bot --body
    '"{\"environmentVariables\":{\"TG_ALLOWED_CHAT_ID\":\"<id>\"}}"' `
    (use `null` / omit to go back to open setup mode).
  - **Host:** add `TG_ALLOWED_CHAT_ID=<id>` to `/etc/nova-bot.env` +
    `systemctl restart nova-poc-bot`.
  - Until set, the bot only ever echoes your chat_id — it never stops the ECS.
- Never commit `/etc/nova-bot.env` or the CSV to git (secrets are redacted here).
