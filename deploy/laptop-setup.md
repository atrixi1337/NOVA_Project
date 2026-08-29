# Sallaapam — Laptop-as-a-Server (Cloudflare Tunnel)

Run the Sallaapam backend + frontend **on your laptop**, then expose it on a real
HTTPS domain via a **Cloudflare Tunnel** — no router port-forwarding, no public
IP, free TLS. The whole thing is reproducible by a script/agent.

> Chosen path = your **Option A**. Docker Compose on the laptop
> (`localhost:8000`), and `cloudflared tunnel` in front of it publishing
> `https://app.<your-domain>`.

---

## 0. What you need beforehand

1. A **domain you control** that is **added to a Cloudflare account**
   (either bought via Cloudflare Registrar, or any registrar with nameservers
   pointed at Cloudflare). Example subdomain: `app.example.com`.
2. The **API keys** you want to use — these live in `/opt/sallaapam/.env` on
   the laptop and are supplied **by you** (the human). The agent never sees them.
   Minimum to use the features you asked for:
   - `GEMINI_API_KEY` **or** `NOVA_API_KEY` — image input (Reka/Inception are
     text-only, see research notes).
   - `FOUNDRY_API_KEY` + `FOUNDRY_IMAGE_MODEL` — image generation (DALL·E).
   - Any others you like (Reka, Mistral, OpenRouter, …). See `.env.example`.

> ⚠️ **Secrets rule**: never paste keys into chat. The script only ever copies
> `.env.example` → `.env` and then **stops** for you to fill in keys.

---

## 1. Prerequisites (on the laptop)

- **Docker** + the **compose plugin** (`docker compose version`)
- **git**
- **Node 20+** + **npm** (only needed to build the frontend bundle once; the
  shipped Dockerfile consumes the pre-built `static/`).
- **cloudflared** (Cloudflare's tunnel client)

```bash
# Debian/Ubuntu-ish
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2 git nodejs npm curl
# cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
sudo chmod +x /usr/local/bin/cloudflared
cloudflared --version
```

> On macOS: `brew install cloudflare/cloudflare/cloudflared docker node git`.

---

## 2. One-shot automation (recommended)

The script does everything except (a) supply your keys and (b) complete the
browser OAuth login.

```bash
cd /path/to/NOVA_Project
./deploy/deploy-laptop.sh --domain app.example.com \
    --repo https://github.com/atrixi1337/NOVA_Project.git \
    --dest /opt/sallaapam
```

What it does, step by step (mirrors the manual flow below):

| Step | Action |
|------|--------|
| 1 | Verifies `docker`, `git`, `node`, `npm`, `cloudflared` are present. |
| 2 | `git clone` into `/opt/sallaapam` (reuses if already there). |
| 3 | If no `.env` → copies `.env.example` → `.env` and **exits** ("go fill your keys, re-run"). Your keys are never in the script. |
| 4 | `cd frontend && npm install && npm run build` → regenerates `../static` (the Dockerfile `COPY`s this in). |
| 5 | `docker compose up -d --build` → app on `http://localhost:8000`; health-checks `/api/health`. |
| 6 | `cloudflared tunnel login` → opens your browser to authenticate against Cloudflare. |
| 7 | `cloudflared tunnel create sallaapam` → tunnel id + credentials file `~/.cloudflared/<id>.json`. |
| 8 | Writes `~/.cloudflared/config.yml` mapping `app.example.com → http://localhost:8000`. |
| 9 | `cloudflared tunnel route dns sallaapam app.example.com` (adds the CNAME in Cloudflare DNS) + `cloudflared service install` + `systemctl enable --now cloudflared` (auto-start on boot). |

---

## 3. Manual fallback (if you don't want the script)

```bash
# 1. App
git clone https://github.com/atrixi1337/NOVA_Project.git /opt/sallaapam
cd /opt/sallaapam
cp .env.example .env                 # EDIT .env — put your real keys here
cd frontend && npm install && npm run build   # -> ../static
cd /opt/sallaapam
docker compose up -d --build
curl -s http://localhost:8000/api/health      # should print JSON

# 2. Tunnel  (D = your subdomain, already in your Cloudflare zone)
cloudflared tunnel login
TUAL=$(cloudflared tunnel create sallaapam | grep -oE '[0-9a-f-]{36}' | head -1)
mkdir -p ~/.cloudflared
cat > ~/.cloudflared/config.yml <<EOF
tunnel: $TUAL
credentials-file: ~/.cloudflared/$TUAL.json
ingress:
  - hostname: app.example.com
    service: http://localhost:8000
  - service: http_status:404
EOF
cloudflared tunnel route dns sallaapam app.example.com
cloudflared service install
systemctl enable --now cloudflared
```

---

## 4. Verification

```bash
curl -s https://app.example.com/api/health     # 14 providers, reka configured
curl -s https://app.example.com/               # the Sallaapam UI (orange logo)
# image input (pick Gemini or Nova in the provider dropdown, attach an image, chat)
# image gen (Settings modal → "Image Generation" → prompt → Generate)
```

Expected: `https://<DOMAIN>/api/health` returns JSON with 14 providers;
`https://<DOMAIN>/` serves the UI; image input via Gemini/Nova returns a
description; `/api/images` (DALL·E) returns an image URL.

> On this **offline** machine Foundry DNS fails, so `/api/images` returns a
> clean `502` here — it works once the laptop has normal internet.

---

## 5. Persistence

- Chat history is SQLite. `docker-compose.yml` bind-mounts
  `./nova_history.db:/app/nova_history.db`, so conversations survive container
  rebuilds/restarts.
- `cloudflared` runs as a **systemd service** → tunnel auto-restarts on boot.
- The container uses `restart: unless-stopped` → app auto-restarts on boot
  (if Docker is enabled: `sudo systemctl enable docker`).

If you hit a permission error on `nova_history.db`:
```bash
chmod 666 /opt/sallaapam/nova_history.db   # then docker compose restart
```

---

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| `502` from `https://<DOMAIN>/api/...` but `localhost:8000/api/health` works | Tunnel still starting (~20s); `systemctl status cloudflared` |
| `curl: (6) Could not resolve host` on `cloudflared tunnel route dns` | Domain isn't in your Cloudflare zone — add it first |
| `permission denied on nova_history.db` | `chmod 666` the file (see §5) |
| Docker build fails: `COPY static ./static: not found` | Frontend wasn't built — run `cd frontend && npm run build` first |
| Image input returns "text only" | You selected Reka/Inception/Cohere/HF — switch to **Nova** or **Gemini** (the only vision providers) |
| Headless box (no browser for `cloudflared tunnel login`) | Create a Cloudflare **Service Token** (Account → API Tokens → "Edit zone DNS") and set `CF_API_TOKEN` instead |

---

## 7. Research recap (why this design)

- **Inception Labs Mercury 2** — text-only (docs: `Supported Formats: Text`).
- **Reka** — text-only at `/chat/completions` (tested: `400 …unsupported content
  type 'image_url'`).
- **Google Gemini + Amazon Nova** — the **working image-input** providers
  (tested: both described an image with "TEST 123" + a red circle).
- Puter/Perplexity via Puter.js — client-side/per-user OAuth, **no server key**,
  image-understanding only, **no audio / no image-gen** → **skipped** (not worth
  the architecture mismatch), as you decided.

So: image input flows through **Gemini/Nova** (your `image_url` blocks are
forwarded verbatim by `call_llm`), and image generation flows through
**Foundry DALL·E** (`POST /api/images` → `/images/generations`).
