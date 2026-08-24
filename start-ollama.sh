#!/usr/bin/env bash
# Start the local Ollama server in user space (no sudo required).
# Ollama is bound to localhost only — the AI POC talks to it at
# http://localhost:11434/v1/chat/completions. This keeps uncensored local
# models private to this box (good for cyber research + fine-tuning data).
#
# After reboot, just run: bash start-ollama.sh
set -euo pipefail

OLLAMA_BIN="${HOME}/.local/opt/ollama/bin"
export PATH="$OLLAMA_BIN:$PATH"
export OLLAMA_HOST="127.0.0.1:11434"
export OLLAMA_MODELS="${HOME}/.ollama/models"
mkdir -p "$OLLAMA_MODELS"

# Is it already running?
if curl -sS -m 3 "http://127.0.0.1:11434/api/version" >/dev/null 2>&1; then
  echo "Ollama already running: $(curl -sS -m 3 http://127.0.0.1:11434/api/version)"
  exit 0
fi

echo "Starting Ollama server on ${OLLAMA_HOST} ..."
nohup ollama serve > "${HOME}/.ollama/serve.log" 2>&1 &
disown
# Wait for readiness
for i in $(seq 1 30); do
  if curl -sS -m 3 "http://127.0.0.1:11434/api/version" >/dev/null 2>&1; then
    echo "Ollama ready: $(curl -sS -m 3 http://127.0.0.1:11434/api/version)"
    exit 0
  fi
  sleep 1
done
echo "ERROR: Ollama did not become ready within 30s. See ${HOME}/.ollama/serve.log" >&2
exit 1
