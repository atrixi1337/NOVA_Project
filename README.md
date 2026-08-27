# AI POC — multi-provider AI chat & log analyzer (proof of concept)

A small local web app that proxies chat and log-analysis requests to **several
OpenAI-compatible providers** through one local FastAPI backend:

* **Local Ollama** *(default)* — uncensored local models, no API key. Ships with
  `dolphin3.0:8b` (Dolphin 3.0 Llama 3.1 8B, Q4). Runs fully offline on your GPU;
  auto-evicted from VRAM after idle. **This is the only truly uncensored provider.**
* **Azure AI Foundry** — `gpt-5-mini` (and `gpt-4o`, `gpt-4o-mini`). *(cloud, censored)*
* **Google Gemini** — `gemini-3.6-flash`, `gemini-3.5-flash` (via Gemini's OpenAI-compatible endpoint). *(cloud, censored)*
* **Amazon Nova** — `nova-lite-v1`, `nova-pro-v1`, `nova-premier-v1`, `nova-micro-v1`, `nova-2-lite-v1`. *(cloud, censored)*
* **Cohere** — `command-a-plus-05-2026`, `command-r7b-12-2024`, `command-r-plus` (native v2 chat API). *(cloud, censored)*
* **OpenRouter** — `openrouter/free` auto-router (routes to any available free model, e.g. `nvidia/nemotron-nano-9b-v2:free`). *(cloud, censored)*
* **HuggingFace Inference Providers router** — free models: `openai/gpt-oss-20b`,
  `zai-org/GLM-5.2`, `meta-models/Muse-Glimmer-30B`, `inclusionAI/Ling-3.0-flash`,
  `meta-llama/Llama-3.1-8B-Instruct`. *(cloud, censored)*
* **Requesty** — free models: `nvidia/nemotron-3.5-lightning-30b-a3b`,
  `nvidia/muse-glimmer-30b`, `novita/inclusionai/ling-3.0-tiny`. *(cloud, censored)*
* **Cloudflare Workers AI** — free 10,000 Neurons/day tier. Models:
  `@cf/qwen/qwen3.8-27b` (27B, vision+reasoning), `@cf/meta/llama-3.1-8b-instruct`,
  `@cf/meta/llama-3.2-3b-instruct`. *(cloud, censored)*
* **Mistral AI** — genuine free tier on `mistral-small-latest` (rate-limited);
  also `mistral-large-latest`, `open-mistral-7b`, `ministral-8b-latest`. *(cloud, censored)*

> **Censored vs uncensored:** every provider marked *(cloud, censored)* runs on a
> hosted service with its own safety filtering and will refuse some requests. The
> local Ollama provider is the only one with no external filter — use it for the
> authorised security-research workloads. The cloud routers are useful as a
> capability fallback when the local 8B is too weak for a task.

It now includes:

* A polished React chat UI (dark theme, mobile-friendly) with a **conversation sidebar**
  — full chat history persisted in SQLite, with rename, delete, and new-chat flows.
* A **Provider + Model** picker so you can switch backends live, markdown + code
  highlighting with copy buttons, a collapsible reasoning box, and an agent tool-trace panel.
* **Agent mode**: the model can call *safe local tools* — `get_time`, `calculate`,
  and a sandboxed `read_file` — then summarise the results.
* **Reasoning effort** control (low/medium/high) for reasoning models, with a
  collapsible "Model reasoning" box so the chain-of-thought never floods the screen.
* **File / log analyzer** tab: upload a `.log`/`.txt`/`.csv`/`.json`/`.evtx`, pick
  **Security** or **General** mode, and get a structured report. Windows Event
  Logs (`.evtx`, binary) are auto-converted to text on the server.
* **Settings modal**: store API keys in your browser's localStorage; they override
  server-side keys per-request (keys never leave your browser).
* All API keys stay **server-side only** (never shipped to the browser).

## Deploy with one command (public Cloudflare link)

Anyone can deploy this on a fresh Linux box and get a public, HTTPS-accessible
URL via a Cloudflare quick tunnel — **the only input is your provider API key(s)**.
Everything else (clone, venv, deps, systemd services, tunnel) is automated and
reboot-persistent:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/atrixi1337/NOVA_Project/master/install.sh)"
```

What it does:

1. Clones this repo into `~/NOVA_Project`.
2. Builds a Python venv and installs deps (including `python-evtx` for `.evtx` support).
3. Prompts for the API keys you have and writes them to `~/NOVA_Project/.env`
   (the only secrets, never committed).
4. Installs `cloudflared` and launches the systemd service that runs the app on `:8000`
   plus a Cloudflare quick tunnel exposing it.
5. Prints your public URL (also saved to `~/NOVA_Project/tunnel_url.txt`).

After install the app is reachable from your phone/anywhere at that URL, and it
survives reboots. Run `sudo systemctl status nova-poc nova-tunnel` to check.

> **Note on the public link:** a quick tunnel gives a *random* `*.trycloudflare.com`
> URL that changes if the tunnel restarts. Anyone with the link can use your keys
> (it's a PoC — fine for personal/mobile use, not for sharing publicly). The
> current URL is always in `~/NOVA_Project/tunnel_url.txt`. For a **fixed** URL,
> use a named Cloudflare tunnel (needs a free Cloudflare account + API token).

Optional env vars before the command: `NOVA_INSTALL_DIR` (install path,
default `~/NOVA_Project`), `NOVA_PORT` (app port, default `8000`).
Add `--no-service` to skip systemd (e.g. for containers/tests) and run the app
in the foreground instead.

## Deploy to Fly.io (cloud — free, always-on)

Get a public HTTPS URL with zero server management. Fly.io's free tier includes
1 shared CPU, 256 MB RAM, and a 1 GB persistent volume (perfect for SQLite chat history).

**One-time setup:**

1. Install `flyctl`:
   ```bash
   curl -L https://fly.io/install.sh | sh
   export PATH="$HOME/.fly/bin:$PATH"
   ```

2. Sign up at [fly.io](https://fly.io), then create a personal access token at
   [fly.io/user/personal_access_tokens](https://fly.io/user/personal_access_tokens)
   (scope: Read/Write). Export it:
   ```bash
   export FLY_API_TOKEN="<your-token>"
   ```

3. Create the app + volume (only needed once):
   ```bash
   flyctl apps create nova-poc-app --region sin    # or your nearest region
   flyctl volumes create nova_data --size 1 --region sin -y
   ```

4. Deploy (the `deploy.sh` helper does everything: build frontend, set secrets, deploy):
   ```bash
   cd NOVA_Project
   bash deploy.sh
   ```

   Or manually:
   ```bash
   cd frontend && npm run build && cd ..
   flyctl secrets set NOVA_API_KEY="..." FOUNDRIES_API_KEY="..." ...  # from your .env
   flyctl deploy
   ```

The app will be live at `https://nova-poc-app.fly.dev/`. The SQLite database
(`nova_history.db`) lives on the persistent `/data` volume, so chat history
survives restarts and redeployments.

### Updating an existing deployment

Just re-run `bash deploy.sh`. It rebuilds the frontend, pushes the new image,
and performs a rolling restart — chat history is preserved.

### Local development (Docker)

```bash
cd NOVA_Project
cp .env.example .env     # fill in your keys
docker compose up -d --build
```

## Quick start (Python venv)

```bash
cd ~/NOVA_Project
python3 -m venv nova_env          # or reuse the existing one
source nova_env/bin/activate
pip install -r requirements.txt

cp .env.example .env              # then EDIT .env and paste your provider keys
nano .env

uvicorn backend:app --host 0.0.0.0 --port 8000
```

Open http://localhost:8000 (from another machine on the LAN use the box's IP).

## Quick start (Docker)

```bash
cd ~/NOVA_Project
cp .env.example .env              # fill in the provider keys you have
docker compose up -d --build
```

App is on http://localhost:8000.

## Frontend (React + Vite + Tailwind)

The UI is a single-page React app (in `frontend/`) that talks to the FastAPI
backend. `npm run build` compiles it into `static/` (which FastAPI serves), so a
normal `systemctl restart nova-poc` picks up UI changes after a build.

```bash
cd ~/NOVA_Project/frontend
npm install
npm run dev        # live dev server on :5173 (proxies API same-origin)
npm run build      # -> outputs to ../static (served by the backend on :8000)
```

Features of the UI:
* Markdown rendering with syntax-highlighted code blocks + copy buttons.
* Collapsible **🧠 Model reasoning** box (when a provider returns reasoning).
* **🛠 Tool trace** panel in Agent mode (shows each tool call + result + token usage).
* Provider + Model picker (all 10 providers, including the uncensored local Ollama default).
* Ollama **Load/Unload** controls in the header (warm/cold VRAM).
* **Log Analyzer** tab: upload `.log/.txt/.csv/.json/.evtx`, pick Security/General.

## Configuration (`.env`)

All keys are optional — only configure the providers you use. The UI defaults to
`DEFAULT_PROVIDER` (set to `ollama`).

```ini
# Which provider the UI loads by default:
#   ollama | foundry | gemini | nova | cohere | openrouter | hfrouter | requesty
DEFAULT_PROVIDER=ollama

# Local Ollama (uncensored local models, no API key) — default provider
OLLAMA_API_KEY=ollama          # ignored by Ollama, shown for parity only
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_MODEL=dolphin3.0:8b
OLLAMA_MODELS=dolphin3.0:8b
OLLAMA_IDLE_UNLOAD=300          # seconds of inactivity before VRAM eviction (0 = never)

# Amazon Nova (optional)
NOVA_API_KEY=your-nova-key-here
NOVA_BASE_URL=https://api.nova.amazon.com/v1
NOVA_MODEL=nova-2-lite-v1

# Azure AI Foundry (optional) — default provider
FOUNDRY_API_KEY=your-foundry-key-here
FOUNDRY_BASE_URL=https://your-resource.services.ai.azure.com/openai/v1
FOUNDRY_MODEL=gpt-5-mini
FOUNDRY_MODELS=gpt-5-mini,gpt-4o,gpt-4o-mini

# Google Gemini via OpenAI-compatible endpoint (optional)
GEMINI_API_KEY=your-gemini-key-here
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
GEMINI_MODEL=gemini-3.6-flash
GEMINI_MODELS=gemini-3.6-flash,gemini-3.5-flash

# Cohere (optional) — native v2 chat API
COHERE_API_KEY=your-cohere-key-here
COHERE_BASE_URL=https://api.cohere.ai/v2
COHERE_MODEL=command-a-plus-05-2026
COHERE_MODELS=command-a-plus-05-2026,command-r7b-12-2024,command-r-plus

# OpenRouter (optional) — free auto-router; openrouter/free routes to any free model
OPENROUTER_API_KEY=your-openrouter-key-here
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=openrouter/free
OPENROUTER_MODELS=openrouter/free

# HuggingFace Inference Providers router (optional) — uses your HF token
HF_TOKEN=your-huggingface-token-here
HFROUTER_BASE_URL=https://router.huggingface.co/v1
HFROUTER_MODEL=openai/gpt-oss-20b
HFROUTER_MODELS=openai/gpt-oss-20b,zai-org/GLM-5.2,meta-models/Muse-Glimmer-30B,inclusionAI/Ling-3.0-flash,meta-llama/Llama-3.1-8B-Instruct

# Requesty (optional) — free models, 200 req/day, no card
REQUESTY_API_KEY=your-requesty-key-here
REQUESTY_BASE_URL=https://router.requesty.ai/v1
REQUESTY_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b
REQUESTY_MODELS=nvidia/nemotron-3.5-lightning-30b-a3b,nvidia/muse-glimmer-30b,novita/inclusionai/ling-3.0-tiny

# Cloudflare Workers AI (optional) — free 10k Neurons/day; needs account ID + token
CLOUDFLARE_ACCOUNT_ID=your-cloudflare-account-id
CLOUDFLARE_API_TOKEN=your-cloudflare-api-token
CLOUDFLARE_BASE_URL=https://api.cloudflare.com/client/v4/accounts/your-cloudflare-account-id/ai/v1
CLOUDFLARE_MODEL=@cf/qwen/qwen3.8-27b
CLOUDFLARE_MODELS=@cf/qwen/qwen3.8-27b,@cf/meta/llama-3.1-8b-instruct,@cf/meta/llama-3.2-3b-instruct

# Mistral AI (optional) — genuine free tier on mistral-small-latest (rate-limited)
MISTRAL_API_KEY=your-mistral-key-here
MISTRAL_BASE_URL=https://api.mistral.ai/v1
MISTRAL_MODEL=mistral-small-latest
MISTRAL_MODELS=mistral-small-latest,mistral-large-latest,open-mistral-7b,ministral-8b-latest

# server / sandbox
APP_HOST=0.0.0.0
APP_PORT=8000
NOVA_SANDBOX=/home/dev/PROJECT/NOVA_Project   # read_file tool is confined here
```

## Using it

* Pick a **Provider** from the top dropdown (Local Ollama / Azure Foundry / Google
  Gemini / Amazon Nova / Cohere / OpenRouter / HuggingFace Router / Requesty /
  Cloudflare Workers AI / Mistral AI). The **Model** list repopulates for that
  provider automatically. Cloud providers are tagged so you know they're censored;
  Ollama is the uncensored local default.
* Pick a **Reasoning** level (low/medium/high) when using a reasoning model — the
  model's thinking is shown in a collapsed "🧠 Model reasoning" box.
* Type a message and hit Enter. Flip **Agent mode** to let the model use tools:
  * "What time is it?"
  * "Calculate (42 * 17) / 3"
  * "Read the file env.example"
* The agent shows a tool-trace panel (what it called, with what args, and the
  result) so the tool access is visible — useful for a PoC/demo.

### Analyzer tab

* Upload a log file (`.log`, `.txt`, `.csv`, `.json`, or `.evtx`).
* Choose **Security** (threat-focused) or **General** (triage/summary) mode.
* Server-side pre-stats (line count, error/warn counts, top source IPs, EVTX
  record count) are computed before the LLM so the UI has hard numbers even if
  the model call fails.
* For `.evtx` (binary Windows Event Logs), the file is converted to compact text
  on the server (no EVTX left on disk) — up to ~60k chars are sent to the model.
* You can paste a key directly in the UI's "Key (optional)" box instead of putting
  it in `.env` (it still never leaves the server).

## Notes / scope

* This is a **PoC for a local lab**. No auth, no rate limiting, no production
  hardening. Don't expose it to the public internet as-is.
* `read_file` is confined to `NOVA_SANDBOX` (default `/home/dev/PROJECT/NOVA_Project`) so the agent
  can't read arbitrary system files.
* `calculate` only permits arithmetic via an AST allow-list (no code exec).
* The reasoning box populates only when the selected model/endpoint actually
  returns a reasoning payload (e.g. Foundry's gpt-5 may not surface it on the
  OpenAI-compatible route — the wiring is in place regardless).
* Provider auth headers: Nova/Gemini/Cohere use `Authorization: Bearer`; Foundry uses
  `api-key`.
