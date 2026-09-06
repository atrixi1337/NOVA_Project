# NOVA Project — Restore / Re-Host Guide

This is the **disaster-recovery backup** of the Sallaapam/NOVA chat app. It is the
complete, phone-hosted deployment that is currently live at
`https://nova.terminalflaw.xyz` (Cloudflare named tunnel `nova` → phone `:8000`).
Use this to bring it back to life on the same phone or on a fresh Linux box.

## What's in this backup
| Item | Notes |
|---|---|
| `backend.py` | FastAPI app + all providers (OpenAI-compatible). |
| `static/` | **Prebuilt** frontend bundle (`index-*.js`). No Node.js needed to *serve*. |
| `frontend/` | Source + `package.json`. Needed only to *rebuild* the bundle (`npx vite build`). |
| `requirements.txt` | Python deps. |
| `.venv/` | Prebuilt Termux/aarch64 virtualenv. Restore faster with it; else `pip install -r requirements.txt`. |
| `.env` | **YOUR real API keys + runtime vars. Gitignored → lives ONLY here in the backup.** Treat as a secret; do not commit. |
| `nova_history.db` | SQLite chat history + `usage_ledger`. |
| `deploy/termux-deploy.sh`, `deploy/phone-deploy.sh`, `nova-tunnel.sh` | Deployment + tunnel helpers. |
| `README.md` | The app's own project readme. |

## Prerequisites (the phone host)
- Android phone, **Termux** (from F-Droid), `aarch64` (Snapdragon 8 Gen 1, SM8350). 8 GB RAM, no GPU.
- Termux packages: `pkg install python git curl termux-api cloudflared`.
- Cloudflare Tunnel **credentials** for the named tunnel `nova`:
  `~/.cloudflared/d9ec149a-3b54-497a-b915-925c09496b9e.json`
  with `~/.cloudflared/config.yml` routing `nova` → `http://localhost:8000`.
- Your API keys live in `.env` (already in this backup).

## Quick restore to the same phone
1. `mkdir -p ~/NOVA_Project && cd ~/NOVA_Project`
2. Copy the contents of this backup here (overwrite; **keep the included `.env`**).
3. Start the app (pick either):
   ```bash
   source .env
   nohup ./.venv/bin/python -m uvicorn backend:app --host 0.0.0.0 --port 8000 > nova-app.log 2>&1 &
   #  —or— re-run: bash deploy/termux-deploy.sh   (also starts the cloudflared tunnel)
   ```
4. Verify: `curl http://localhost:8000/api/health` → `200`.
5. Public: `curl https://nova.terminalflaw.xyz/api/health` → `200` (tunnel already bound; don't restart it).

## Rebuild the frontend (only if you changed `frontend/src/`)
```bash
cd frontend && npm install && npx vite build   # writes static/index-*.js
```
FastAPI serves `static/` from disk per-request, so **frontend-only changes need no
server restart** — a `git pull` (or file copy) updates the UI immediately.

## Restart policy
- **Frontend-only change** → just redeploy `static/` (no restart).
- **Backend change** (`backend.py`) → restart uvicorn:
  `pkill -f 'uvicorn backend:app'` then relaunch (step 3). The cloudflared tunnel
  is a separate process and survives; it reconnects to `:8000`.
- Do **not** restart the Cloudflare named tunnel unless you must — restarting a
  *quick* tunnel changes the public URL. Use the stable named tunnel `nova`.

## Hosting notes
- Local Ollama is the only uncensored provider and needs ~2.7–4 B params of VRAM
  (not feasible on this phone's SoC). All other providers are **cloud + censored**
  and still apply safety filters regardless of system prompt.
- `.env` and `nova_history.db*` are gitignored — they are NOT in git; they are
  restored from this backup. Keep `.env` secret.

## Restore to a fresh Linux box (systemd + Cloudflare quick tunnel)
```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/atrixi1337/NOVA_Project/master/install.sh)"
```
It prompts for an Amazon Nova API key (or reuse this backup's `.env`) and sets up
systemd + a Cloudflare quick tunnel. Adapt `nova-poc.service` if your paths differ.

## Troubleshooting
| Symptom | Fix |
|---|---|
| `502 Bad Gateway` from the tunnel | uvicorn isn't running → restart it (Quick restore step 3). |
| `No X API key configured` | `.env` is missing/stale → copy this backup's `.env`. |
| Stale UI / old bundle | `curl https://nova.terminalflaw.xyz/ \| grep index-` should match `static/index.html`'s bundle. If not, re-pull/rebuild `static/`. |
| Cloud provider returns 401/429 | Key exhausted/quota — check the provider's dashboard. |
