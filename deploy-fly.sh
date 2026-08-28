#!/usr/bin/env bash
# deploy-fly.sh - deploy NOVA Chat to Fly.io using FLY_API_TOKEN from .env.
# Security: the token + backend API keys are sourced from .env (gitignored).
# flyctl reads FLY_API_TOKEN from the environment, so it is NEVER typed into a
# command and NEVER printed. Only key NAMES are shown; flyctl masks values.
set -uo pipefail

export PATH="$HOME/.fly/bin:$PATH"
cd "$(cd "$(dirname "$0")" && pwd)"

# 1. Load FLY_API_TOKEN + backend keys from .env (gitignored; values stay hidden).
if [ -f .env ]; then set -a; . ./.env; set +a; fi
: "${FLY_API_TOKEN:?Add FLY_API_TOKEN=<your-fly-token> to .env first (gitignored; never paste in chat).}"
[ "${#FLY_API_TOKEN}" -ge 20 ] || { echo "FLY_API_TOKEN too short - check .env."; exit 1; }

# 2. App name: fly.toml default, or FLY_APP override if the old name is globally taken.
APP="${FLY_APP:-$(grep -E '^app' fly.toml | head -1 | sed -E "s/^app *= *//; s/^[\"']//; s/[\"']$//")}"
echo "==> target Fly app: $APP"
echo "==> authenticating via FLY_API_TOKEN env (token not printed)..."

# 3. Create the app if it doesn't exist (a new account has no apps yet).
if flyctl status --app "$APP" >/dev/null 2>&1; then
  echo "==> app $APP exists - deploying updates."
else
  echo "==> app $APP not found - creating (region=sin, volume=nova_data)."
  flyctl launch --name "$APP" --copy-config --yes --primary-region sin --no-deploy
  echo "==> app created."
fi

# Re-read app name: flyctl launch may rewrite fly.toml with a generated name.
APP="${FLY_APP:-$(grep -E '^app' fly.toml | head -1 | sed -E "s/^app *= *//; s/^[\"']//; s/[\"']$//")}"
echo "==> effective app: $APP"

# 4. Propagate backend API keys from local .env as Fly secrets (values masked by flyctl).
SECRET_VARS="AGENTROUTER_API_KEY CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_TOKEN CLOUDFLARE_BASE_URL CLOUDFLARE_MODEL CLOUDFLARE_MODELS COHERE_API_KEY FOUNDRY_API_KEY GEMINI_API_KEY GEMINI_API_KEY_BACKUP HF_TOKEN INCEPTION_API_KEY INCEPTION_BASE_URL INCEPTION_MODEL INCEPTION_MODELS MISTRAL_API_KEY NOVA_ANALYZE_MAX_CHARS NOVA_API_KEY NOVA_BASE_URL NOVA_MAX_UPLOAD_MB NOVA_MODEL NOVA_SANDBOX OLLAMA_API_KEY OLLAMA_BASE_URL OLLAMA_MODEL OPENROUTER_API_KEY OPENROUTER_BASE_URL OPENROUTER_MODELS REQUESTY_API_KEY REQUESTY_BASE_URL REQUESTY_MODELS UPSTAGE_API_KEY UPSTAGE_BASE_URL UPSTAGE_MODEL UPSTAGE_MODELS"
core="APP_HOST APP_PORT NOVA_HISTORY_DB DEFAULT_PROVIDER FLY_API_TOKEN"
arr=()
for v in $SECRET_VARS; do
  val="${!v:-}"
  if [ -n "$val" ] && ! printf '%s\n' "$core" | grep -qw "$v"; then
    arr+=("$v=$val")
  fi
done
if [ "${#arr[@]}" -gt 0 ]; then
  echo "==> setting ${#arr[@]} Fly secret(s) (names only)."
  flyctl secrets set "${arr[@]}" --app "$APP" >/tmp/fly-secrets.log 2>&1 || { echo "secrets failed (see /tmp/fly-secrets.log):"; tail -n 20 /tmp/fly-secrets.log; exit 1; }
  echo "    secrets set (values masked by flyctl)."
else
  echo "==> no backend secrets to set."
fi

# 5. Deploy: builds the Dockerfile (committed static/ + backend.py).
echo "==> deploying (builds the image; first deploy ~2-4 min)..."
flyctl deploy --app "$APP" 2>&1 | tee /tmp/fly-deploy.log | tail -40
rc=${PIPESTATUS[0]}
if [ "$rc" -ne 0 ]; then echo "deploy exited $rc (see /tmp/fly-deploy.log)"; exit "$rc"; fi

echo ""
echo "DONE - https://$APP.fly.dev"
echo "Health: https://$APP.fly.dev/api/health"
echo "Toggle Malayalam mode (Gemini) in Settings."
