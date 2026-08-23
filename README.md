# AI POC — multi-provider AI chat & log analyzer (proof of concept)

A small local web app that proxies chat and log-analysis requests to **any of
three OpenAI-compatible providers** through one local FastAPI backend:

* **Azure AI Foundry** — `gpt-5-mini` (and `gpt-4o`, `gpt-4o-mini`). Default provider.
* **Google Gemini** — `gemini-3.6-flash`, `gemini-3.5-flash` (via Gemini's OpenAI-compatible endpoint).
* **Amazon Nova** — `nova-lite-v1`, `nova-pro-v1`, `nova-premier-v1`, `nova-micro-v1`, `nova-2-lite-v1`.

It demonstrates:

* A clean dark chat UI with a **Provider + Model** picker so you can switch backends live.
* **Agent mode**: the model can call *safe local tools* — `get_time`, `calculate`,
  and a sandboxed `read_file` — then summarise the results.
* **Reasoning effort** control (low/medium/high) for reasoning models, with a
  collapsible "Model reasoning" box so the chain-of-thought never floods the screen.
* **File / log analyzer** tab: upload a `.log`/`.txt`/`.csv`/`.json`/`.evtx`, pick
  **Security** or **General** mode, and get a structured report. Windows Event
  Logs (`.evtx`, binary) are auto-converted to text on the server.
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

## Configuration (`.env`)

All keys are optional — only configure the providers you use. The UI defaults to
`DEFAULT_PROVIDER` (set to `foundry`).

```ini
# Which provider the UI loads by default: foundry | gemini | nova
DEFAULT_PROVIDER=foundry

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

# server / sandbox
APP_HOST=0.0.0.0
APP_PORT=8000
NOVA_SANDBOX=/home/dev/PROJECT/NOVA_Project   # read_file tool is confined here
```

## Using it

* Pick a **Provider** from the top dropdown (Azure Foundry / Google Gemini / Amazon
  Nova). The **Model** list repopulates for that provider automatically.
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
* `read_file` is confined to `NOVA_SANDBOX` (default `~/Downloads`) so the agent
  can't read arbitrary system files.
* `calculate` only permits arithmetic via an AST allow-list (no code exec).
* The reasoning box populates only when the selected model/endpoint actually
  returns a reasoning payload (e.g. Foundry's gpt-5 may not surface it on the
  OpenAI-compatible route — the wiring is in place regardless).
* Provider auth headers: Nova/Gemini use `Authorization: Bearer`; Foundry uses
  `api-key`.
