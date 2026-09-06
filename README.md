# Sallaapam / NOVA — multi-provider AI chat, arena & security lab (proof of concept)

A single-file FastAPI backend that normalizes **17 AI providers** into one
OpenAI-style interface, plus a polished Vite+React SPA — with streaming replies,
a provider **Arena**, a sandboxed **agent** with web-research tools, image
generation, a log/EVTX analyzer, lifetime token accounting, and shared-passphrase
auth. Built to run on an Android phone in Termux and exposed through a Cloudflare
tunnel; also happy on any Linux box or behind systemd.

```
Termux phone ── uvicorn :8000 ── Cloudflare named tunnel ── https://you.example.com
                                   (or any Linux host / systemd / venv)
```

## Feature tour

**Chat**
- **Token streaming** via SSE (`/api/chat/stream`) with a blinking caret, a
  **Stop** button (aborts provider-side too), and an **80 ms throttled renderer**
  so long replies stay smooth on phones.
- **Regenerate (↺)** any reply and **edit-and-resend (✎)** your last message —
  both *replace* the old turn in history instead of duplicating it.
- **Live reasoning view** — reasoning models (IFM K2, gpt-5, Upstage…) stream
  their thinking into an auto-opened "Thinking…" panel while they deliberate.
- Markdown + GFM tables, syntax-highlighted code blocks with language header and
  copy button (warm custom highlight.js theme), per-message copy, image
  attachments (paste / drag-drop / picker), per-conversation input drafts,
  smart auto-scroll with jump-to-latest, IME-safe Enter handling.
- Conversation sidebar with **search filter**, date grouping
  (Today/Yesterday/This week/Earlier), per-provider color dots, inline rename,
  two-tap delete confirm.

**Arena** — pick up to 4 providers, ask once, answers stream in side-by-side
columns with latency, token counts and a "⚡ first" badge. Ephemeral by design
(nothing saved to history). Runs through the same streaming endpoint.

**Personas** (applied in chat *and* Arena)
- **Malayalam mode** — routes via Gemini and replies only in Malayalam/Manglish,
  as a grumpy old Malayali uncle.
- **NovaSec** — cybersecurity-expert persona (bounded to authorized security
  work) that also auto-selects the **Recon** agent-tool preset.
- **🌐 Web toggle** — gives normal chat a 2-round search loop (search → answer).
  While on, the default model switches to a function-calling one
  (Amazon Nova `nova-2-lite-v1`) until you explicitly pick a provider; models
  without function calling automatically degrade to answering without search.

**Agent mode** — safe local + web tools with named presets
(`NOVA_… ChatRequest.tools_preset`):
| Preset | Tools |
|---|---|
| Core | `get_time`, `calculate` (AST allow-list), `read_file` (sandboxed to `NOVA_SANDBOX`) |
| Research | Core + `web_search` (DuckDuckGo, no key), `web_fetch` |
| Recon / NovaSec | Research + `http_headers` (passive security-header probe) |

**Image generation** — `/api/images` auto-routes through the first configured
provider: **Gemini** (`gemini-2.5-flash-image`, key failover) → **Cloudflare
Workers AI** (`flux-1-schnell`) → legacy Azure Foundry DALL·E. Placeholder
credentials are detected and skipped honestly.

**Log analyzer** — upload `.log/.txt/.csv/.json/.evtx` (Windows Event Logs are
converted server-side), Security or General mode, objective pre-stats computed
before the LLM call.

**Usage accounting** — every assistant turn lands in a `usage_ledger` that
survives chat deletion: totals, by-model, by-provider, **by-person** (see auth),
by-day sparkline, recent activity. Rendered in the app's **Usage** tab and on a
standalone `/usage` page. Latency-friendly: `/api/usage` accepts
`?provider=&model=&days=&recent=1`.

**Auth (shared passphrase)** — when `NOVA_AUTH_PASSPHRASE` is set, all of
`/api/*` locks:
- Browser: one passphrase at the lock screen → **signed 30-day HttpOnly cookie**
  (stateless HMAC — no session store). Each device unlocks once.
- Scripts/bots: send the secret as `X-Nova-Token: <secret>`.
- **Named tokens** (`owner:pass1,alex:pass2`) stamp every usage-ledger row with
  the actor → the Usage tab shows *who* burned what. Rotate the passphrase to
  revoke every device.
- `/api/health` and `/api/auth/login` stay public; logins rate-limited
  (5/min/IP); wildcard CORS removed (the SPA is same-origin). With auth on,
  chat endpoints also get a **per-actor rate limit**
  (`NOVA_RATE_LIMIT_PER_MIN`, default 60/min) and an optional **daily token
  cap** (`NOVA_DAILY_TOKEN_CAP`, 0 = off) so one tester's runaway loop can't
  burn the keys.

## Providers (17)

| id | label | notes |
|---|---|---|
| `foundry` | Azure AI Foundry | gpt-5-mini / gpt-4o family, `api-key` header |
| `gemini` | Google Gemini | OpenAI-compat route, **backup-key failover**, image gen |
| `nova` | Amazon Nova | nova-2/lite/pro/micro |
| `cohere` | Cohere | native v2 API, normalized to OpenAI shape |
| `ollama` | Local Ollama | uncensored, VRAM idle-unload watchdog (not viable on the phone) |
| `openrouter` / `hfrouter` / `requesty` / `cloudflare` / `mistral` | free cloud tiers | censored |
| `gmi` / `inception` / `upstage` / `reka` / `nvidia` / `agnes` / `ifm` | GPU-cloud & specialty | IFM K2 gets 180 s reasoning timeouts + thinking-trace replay |

Every provider is OpenAI-compatible except Cohere (special-cased). Add one by
appending to `PROVIDERS` in `backend.py` — defaults are overridable via
`<PROVIDER>_API_KEY/_BASE_URL/_MODEL/_MODELS` in `.env` (see `.env.example`).

## Run it

### Python venv (any Linux/macOS)

```bash
pip install -r requirements.txt        # phone: see requirements.phone.txt note below
cp .env.example .env                   # fill in the keys you have
uvicorn backend:app --host 0.0.0.0 --port 8000
```

Open http://localhost:8000. Run the stability tests (no network needed —
providers are faked):

```bash
python3 -m pytest tests/ -q
```

To rebuild the UI after changing `frontend/src`:

```bash
cd frontend && npm install && npx vite build   # outputs to ../static
```

FastAPI serves `static/` from disk per request — **frontend-only changes need no
server restart; `backend.py` changes do.** The SPA is an installable **PWA**:
service worker (`public/sw.js`) caches the app shell for offline loads and the
manifest enables "Add to home screen".

### Android phone (Termux) — the primary deployment

```bash
bash deploy/termux-deploy.sh     # deps, venv, .env check, uvicorn, tunnel, wake-lock
```

Resilience (already wired in the live deployment):

```bash
nohup bash ~/NOVA_Project/deploy/phone-watchdog.sh >/dev/null 2>&1 &   # auto-restart
```

The watchdog checks `/api/health` every 30 s and restarts uvicorn after 2
consecutive failures (pid-locked, safe in `~/.termux/boot/start-nova.sh`). It
also **rotates the app/tunnel logs** past 5 MB (copytruncate) and — if
`WATCHDOG_NTFY=https://ntfy.sh/<topic>` is set in the phone's `.env` — pushes
a notification whenever it has to intervene.

### Nightly backups (from a machine with SSH access to the phone)

```bash
deploy/devbox-backup.sh              # one run now
# cron: 15 4 * * * ~/PROJECT/NOVA_Project/deploy/devbox-backup.sh >> ~/NOVA_Project_backups/backup.log 2>&1
```

Pulls a consistent SQLite snapshot (`deploy/phone-snapshot-db.py`) + the phone's
`.env` into `~/NOVA_Project_backups/<date>/`, pruned to 14 days.

### Linux one-liner (systemd + Cloudflare quick tunnel)

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/atrixi1337/NOVA_Project/master/install.sh)"
```

## Configuration essentials (`.env`)

```ini
DEFAULT_PROVIDER=inception            # UI default (any provider id above)
NOVA_SANDBOX=/path/allowed/for/read_file

# auth (leave NOVA_AUTH_PASSPHRASE unset to disable auth entirely)
NOVA_AUTH_PASSPHRASE=owner:pass1,alex:pass2     # or one bare passphrase
NOVA_AUTH_SECRET=<random string>                # signs the session cookie

# providers: <ID>_API_KEY / _BASE_URL / _MODEL / _MODELS  (see .env.example)
GEMINI_API_KEY=...                    # + GEMINI_API_KEY_BACKUP for failover
CLOUDFLARE_ACCOUNT_ID=...             # real values unlock flux image gen
NOVA_IMAGE_MODEL=gemini-2.5-flash-image
```

`requirements.txt` pins `uvicorn[standard]`, which fails to build on Termux
(aarch64, no `watchfiles` wheel) — `deploy/termux-deploy.sh` rewrites it to
plain `uvicorn` (see `requirements.phone.txt`).

## HTTP surface

| Route | What |
|---|---|
| `POST /api/chat` | non-streaming chat + agent tool loop |
| `POST /api/chat/stream` | SSE streaming chat (agent mode stays on `/api/chat`) |
| `POST /api/auth/login` | passphrase → 30-day cookie (public) |
| `POST /api/admin/restart` | owner-token bounce; the watchdog restores service (≤90 s) |
| `GET /api/health` | liveness + provider config (public) |
| `GET /api/models` | provider registry + model lists |
| `GET /api/usage` | lifetime ledger aggregates (`?provider=&days=&recent=1`) |
| `POST /api/images` | text→image (gemini → cloudflare → foundry) |
| `POST /api/analyze` | log/EVTX analysis (multipart) |
| `GET/POST/PUT/DELETE /api/conversations…` | history CRUD + clear; `GET …/{cid}?last=N` paginates the most recent N messages (adds `total_messages`/`has_more` — the mobile-app-friendly shape) |
| `GET/POST /api/ollama/*` | local Ollama status/load/unload |
| `/`, `/usage`, `/mobile` | SPA, standalone dashboard, phone status page |

## Notes & scope

* **Proof of concept** for a personal lab. One shared passphrase — not multi-user
  account management. Rotate `NOVA_AUTH_PASSPHRASE` to revoke access.
* Cloud providers apply their own safety filters regardless of system prompts;
  NovaSec is a bounded expert persona, not an uncensor. Only local Ollama is
  uncensored, and it needs more RAM than a phone can give.
* `read_file` is confined to `NOVA_SANDBOX` via real path containment;
  `calculate` is an AST allow-list (no code execution); web tools are
  read-only http(s) with short timeouts.
* Phone deployment realities: ~8 GB RAM, no local LLMs; `termux-wake-lock` on;
  named tunnel preferred over quick tunnels (stable URL); don't restart the
  tunnel casually — quick tunnels rotate URLs.
* Disaster recovery: see `README_RESTORE.md` (SSD backup → same phone, fresh
  Termux, or fresh Linux box).
