# Nova POC — local Amazon Nova chat app (proof of concept)

A small local web app that talks to Amazon Nova's OpenAI-compatible chat
endpoint (`https://api.nova.amazon.com/v1/chat/completions`). It demonstrates:

* A clean dark chat UI proxied through a local FastAPI backend.
* **Agent mode**: Nova can call *safe local tools* — `get_time`, `calculate`,
  and a sandboxed `read_file` — to answer questions, then summarise the
  results. This mirrors the "agentic with tool access" idea from the Nova
  conversation that inspired this PoC.

The Nova API key is kept **server-side only** (never shipped to the browser).

## Deploy with one command (public Cloudflare link)

Anyone can deploy this on a fresh Linux box and get a public, HTTPS-accessible
URL via a Cloudflare quick tunnel — **the only input is your Amazon Nova API
key**. Everything else (clone, venv, deps, systemd services, tunnel) is
automated and reboot-persistent:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/atrixi1337/NOVA_Project/master/install.sh)"
```

What it does:

1. Clones this repo into `~/NOVA_Project`.
2. Builds a Python venv and installs deps.
3. Prompts **once** for your `NOVA_API_KEY` and writes it to `~/NOVA_Project/.env`
   (the only secret, never committed).
4. Installs `cloudflared` and launches two systemd services:
   * `nova-poc.service` — the app on `:8000`.
   * `nova-tunnel.service` — a Cloudflare quick tunnel exposing the app.
5. Prints your public URL (also saved to `~/NOVA_Project/tunnel_url.txt`).

After install the app is reachable from your phone/anywhere at that URL, and it
survives reboots. Run `sudo systemctl status nova-poc nova-tunnel` to check.

> **Note on the public link:** a quick tunnel gives a *random* `*.trycloudflare.com`
> URL that changes if the tunnel restarts. Anyone with the link can use your Nova
> key (it's a PoC — fine for personal/mobile use, not for sharing publicly). The
> current URL is always in `~/NOVA_Project/tunnel_url.txt`. For a **fixed** URL,
> use a named Cloudflare tunnel (needs a free Cloudflare account + API token).

Optional env vars before the command: `NOVA_INSTALL_DIR` (install path,
default `~/NOVA_Project`), `NOVA_PORT` (app port, default `8000`).
Add `--no-service` to skip systemd (e.g. for containers/tests) and run the app
in the foreground instead.

## Quick start (Python venv)

```bash
cd ~/Downloads/nova-poc
python3 -m venv nova_env          # or reuse the existing one
source nova_env/bin/activate
pip install -r requirements.txt

cp .env.example .env              # then EDIT .env and paste your NOVA_API_KEY
nano .env

uvicorn backend:app --host 0.0.0.0 --port 8000
```

Open http://localhost:8000 (from another machine on the LAN use the box's IP).

## Quick start (Docker)

```bash
cd ~/Downloads/nova-poc
cp .env.example .env              # fill in NOVA_API_KEY
docker compose up -d --build
```

App is on http://localhost:8000.

## Using it

* Pick a model from the dropdown (default `nova-2-lite-v1`).
* Type a message and hit Enter.
* Flip **Agent mode** to let Nova use tools. Try:
  * "What time is it?"
  * "Calculate (42 * 17) / 3"
  * "Read the file env.example"
* The agent shows a tool-trace panel (what it called, with what args, and the
  result) so the tool access is visible — useful for a PoC/demo.

You can also paste a key directly in the UI's "Key (optional)" box instead of
putting it in `.env` (it still never leaves the server).

## Notes / scope

* This is a **PoC for a local lab**. No auth, no rate limiting, no production
  hardening. Don't expose it to the public internet as-is.
* `read_file` is confined to `NOVA_SANDBOX` (default `~/Downloads`) so the
  agent can't read arbitrary system files.
* `calculate` only permits arithmetic via an AST allow-list (no code exec).
