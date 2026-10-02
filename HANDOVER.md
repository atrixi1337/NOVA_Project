# NOVA — Project Handover

*One document, everything. Updated for HEAD `d5d8325` (master) / phone `fa1d39f`.*

---

## 1. What this is

**Sallaapam / NOVA** — a personal-lab "security + AI" proof-of-concept. One FastAPI
single-file backend (`backend.py`, ~3100 lines) that normalizes **17 AI providers**
behind an OpenAI-compatible shape, plus a Vite+React PWA frontend (`frontend/`) that
FastAPI serves from a built `static/` directory.

Design center: a **phone-first, tunnel-exposed** personal lab reachable at
`https://nova.terminalflaw.xyz`. It is explicitly **not** a hardened multi-tenant
service — see §15 (Scope/Limitations).

```
phone (Termux) ── uvicorn :8000 ── Cloudflare named tunnel ── https://nova.terminalflaw.xyz
                                  (Linux host / systemd also supported)
```

---

## 2. Repository layout

```
NOVA_Project/
├── backend.py                 # single-file FastAPI app (providers, auth, gateway, agent, history, usage)
├── requirements.txt           # server deps (pins uvicorn[standard]; see phone note in §12)
├── .env.example               # template for every env var (keys left server-side)
├── install.sh                 # Linux one-liner: venv + .env + systemd + quick-tunnel
├── static/                    # BUILT frontend (served by FastAPI): index.html, sw.js, assets/*, fonts/
│   ├── index.html            # bootstraps index-*.[js|css] (built by `npx vite build`)
│   ├── sw.js                 # service worker — app-shell cache + offline, "Add to home screen"
│   ├── assets/index-*.{js,css} # Vite build outputs (content-hashed)
│   ├── logo.png / manifest.webmanifest / usage.html / mobile.html
│   └── fonts/*               # (committed) JetBrains Mono + (src fonts live under frontend/src/fonts)
├── frontend/                  # SOURCE of truth for the UI (Vite + React + Tailwind)
│   ├── index.html, package.json, vue? no — Vite
│   ├── vite.config.js, tailwind.config.js, postcss.config.js
│   └── src/                  # React sources — see §4
├── deploy/                    # phone + Linux deployment tooling
│   ├── termux-deploy.sh, phone-deploy.sh, phone-prep.sh, phone-pip-fix.sh, termux-deploy.sh
│   ├── phone-watchdog.sh      # health-check + auto-restart + log rotation + ntfy (30s/2 fails)
│   ├── termux-boot.sh         # registers the watchdog in ~/.termux/boot + wake-lock
│   ├── phone-snapshot-db.py   # consistent SQLite snapshot for backups
│   ├── devbox-backup.sh       # pulls a dated backup into ~/NOVA_Project_backups/ (14-day prune)
│   ├── cloudflared-config.yml.tmpl, loca-tunnel.sh, alicloud-deploy.sh, laptop-setup.md
│   └── telegram-bot/          # (optional) TG <-> gateway relay
├── start-ollama.sh            # local Ollama server launcher
├── nova-poc.service           # example systemd unit
├── tests/
│   ├── conftest.py            # pytest fixtures (fakes providers so tests are offline)
│   ├── test_backend.py        # 44 tests (auth, gateway, history, streaming, personas, …)
│   └── test_ssrf_guard.py     # 7 tests (read_file sandbox + web SSRF guards)
├── README.md                  # the primary user-facing doc (this file mirrors/supersedes it)
├── README_RESTORE.md          # DR: SSD image -> same phone / fresh box
├── handover.txt               # legacy notes file
├── lates_readme_2026-09-13.md # dated progress journal (Day-4/5: auth, upload merge, Infrar live)
├── nova_history.db            # SQLite chat/usage/gateway-keys DB (WAL mode) — GITIGNORED
├── .env                       # runtime secrets — GITGITHUB-IGNORED (see §11)
├── .nova_tokens               # operator-only token copy (chmod 600) — GITIGNORED
├── __pycache__/, .pytest_cache/, frontend/node_modules/
└── .gitignore
```

> **Frontend flow:** edit `frontend/src/*` → `cd frontend && npx vite build` → outputs to `../static` → FastAPI serves immediately. **`backend.py` edits require a uvicorn restart; frontend-only edits do NOT.**

---

## 3. Live deployment state (the phone)

| Item | Value |
|---|---|
| Host | Termux `u0_a318@192.168.0.6` (SSH port 22 → forwarded on 8022) |
| SSH key | `~/.ssh/nova_phone_key` (local dev box → phone) |
| Venv | `~/NOVA_Project/.venv` (plain `uvicorn`, NOT `uvicorn[standard]` — see §12) |
| Server | `uvicorn backend:app --host 0.0.0.0 --port 8000`; pid **14582** |
| Public URL | `https://nova.terminalflaw.xyz` (Cloudflare **named** tunnel — do not restart casually) |
| Repo | `~/NOVA_Project`, origin `https://github.com/atrixi1337/NOVA_Project.git` (master), HEAD `fa1d39f` (app code) / `d5d8325` (master, +gitignore) |
| App log | `~/NOVA_Project/nova-app.log` |
| History DB | `~/NOVA_Project/nova_history.db` (SQLite, WAL; **do not edit while uvicorn runs** — snapshots via `phone-snapshot-db.py` only) |
| Default provider | `inception` (`DEFAULT_PROVIDER=inception`; model `mercury-2`) |
| Live Infrar key | `INFRON_API_KEY=51 chars`, provider id `infron`, model `qwen/qwen3.8-27b:free` |
| Auth | `NOVA_AUTH_PASSPHRASE` holds named tokens: `owner:<ADMIN>`, `alice:<ALICE>`, plus the operator's pre-existing entries |
| Tokens file | `~/NOVA_Project/.nova_tokens` (chmod 600) contains `ADMIN=<owner/admin>` and `ALICE=<general>` — retrieve via `ssh … 'cat ~/.nova_tokens'`; values are redacted in this agent's view but visible in your own terminal |
| `.env` hygiene | Lines 69–70 of the phone `.env` are two inert bare tokens (no `VAR=` → `command not found` on source, set nothing). Left untouched per "do not touch live .env secrets"; safe for the operator to delete if desired. |

**Restart the phone server (after a code or `.env` change):**
```bash
ssh -i ~/.ssh/nova_phone_key -p 8022 u0_a318@192.168.0.6
cd ~/NOVA_Project
git pull --ff-only origin master
pkill -f 'uvicorn backend:app --host 0.0.0.0 --port 8000'; sleep 1
set -a; . ./.env; set +a
export APP_HOST=0.0.0.0 APP_PORT=8000 NOVA_HISTORY_DB="$HOME/NOVA_Project/nova_history.db"
nohup .venv/bin/python -m uvicorn backend:app --host 0.0.0.0 --port 8000 > nova-app.log 2>&1 &
```
The background `phone-watchdog.sh` will also auto-restart uvicorn (30s interval, 2 failures) and rotate logs past 5 MB — so a manual restart is rarely needed.

**Health gate you can run remotely (admin token):**
```bash
ssh -i ~/.ssh/nova_phone_key -p 8022 u0_a318@192.168.0.6 \
  'cd ~/NOVA_Project && . .nova_tokens && \
   curl -s https://nova.terminalflaw.xyz/api/health -H "x-nova-token: $ADMIN" | .venv/bin/python -m json.tool | head'
```

---

## 4. Frontend architecture (`frontend/src/`)

- `main.jsx` → mounts `<App />` (React 18, strict mode).
- `App.jsx` — root: provider selection, chat state, conversation history load, upload handling, admin/RBAC flag wiring to Sidebar/GatewayTab. **Single upload button** (old paperclip style) + merged `onAttachAll`: images → image attach; docs (.txt/.pdf/.csv/.json/.log/.md/.text, ≤10 MB) → context block via `/api/attach`.
- `api.js` — fetch wrapper; exposes `toError` (attaches `err.status` for 403 vs 401 handling). Calls `/api/chat`, `/api/chat/stream`, `/api/conversations*`, `/api/gateway/keys`, `/api/health`.
- `components/`:
  - `Header.jsx` — top bar (provider picker, model, settings, lock).
  - `Sidebar.jsx` — conversation list + search + date grouping; renders "History is admin-only" when a general token hits 403 on `/api/conversations`.
  - `Message.jsx` — per-message render: markdown (GFM tables), code blocks (highlight), copy, reasoning/thinking panel, image previews.
  - `GatewayTab.jsx` — mint/revoke/list gateway keys; **hidden behind `health.is_admin`** (non-admins see a LockedSection). Key list never leaks names.
  - `SettingsModal.jsx` — provider/api_key/localStorage config; provider-key fields are `type=password` (browser-local storage in `nova_api_keys`), never sent to server.
  - `ChatInput.jsx` / `Arena.jsx` / `Analyzer.jsx` / `AgentTrace.jsx` / `UsageDashboard.jsx` / `HostHealthTab.jsx` / `CommandPalette.jsx` / `Icons.jsx` / `LockScreen.jsx` / `ReasoningBox.jsx` / `markdown.jsx`.
  - `personas.js` — `MALAYALAM_SYSTEM_PROMPT` (grumpy Malayali uncle, Malayalam/Manglish) and `SECURITY_MODE_SYSTEM_PROMPT` (NovaSec). `composePersonaMessages()` injects them; backend forwards `role:system` verbatim and skips its own default when one is present.
- `tailwind.config.js`, `index.css`, `vite.config.js`.
- Build: `npx vite build` → `../static`.

**Rebuild command:** `cd /home/dev/PROJECT/NOVA_Project/frontend && npx vite build && cd ..` (then push + phone-pull — no server restart needed for frontend-only changes).

---

## 5. Backend architecture (`backend.py`)

FastAPI, single file. Key sections (current line refs):

| Lines | Area |
|---|---|
| ~100–500 | env loading, global config, `PROVIDERS` dict (17 providers) |
| ~524 | `TOOLS:` agent-tool list (see §6) |
| ~1054 | `ChatRequest` Pydantic model |
| ~1084 | `AUTH_TOKENS` dict (runtime: parsed from `NOVA_AUTH_PASSPHRASE`) |
| ~1128 | `auth_middleware` (FastAPI middleware) — attaches `request.state.actor` + `token`; `/api/health` + `/api/auth/login` are **public** (attach actor w/o requiring auth) |
| ~1188 | `POST /api/admin/restart` (owner) |
| ~1213 | `POST /api/auth/login` (public — passphrase → 30-day cookie; tokens usable as `X-Nova-Token` header) |
| ~1248–1395 | gateway key helpers + `POST/GET/DELETE /api/gateway/keys…` (owner for list/revoke) |
| ~1396–1470 | `GET /v1/models` + `POST /v1/chat/completions` (OpenAI-compat gateway) |
| ~1794 | `GET /api/models` (provider registry + model lists) |
| ~1807 | `GET /api/health` → `actor` + `is_admin` + per-provider `configured` |
| ~1948–1990 | `/api/host`, `/api/ollama/status|load|unload` |
| ~2048–2445 | SQLite: `_db()`, `db_create/ get/ update/ delete conversation`, `db_save_message`, `db_drop_last_turn` (schema §7) |
| ~2445–2630 | usage ledger: `db_record_usage`, `db_usage_summary`, `db_usage_recent` |
| ~2621–2730 | conversation CRUD routes |
| ~2739–2819 | personas CRUD + `GET /api/usage` |
| ~2820–2900 | `_prepare_chat` — **provider resolution, key lookup, default/uncensored system prompt injection, reasoning backfill, model resolution** |
| ~2889–3066 | `POST /api/chat` (non-streaming + agent tool loop, Stop/Regenerate/Edit) |
| ~3066–3160 | `POST /api/chat/stream` (SSE) |
| ~3160–3210 | `POST /api/images`, `POST /api/analyze`, `POST /api/attach` |
| ~3250+ | `GET /`, `/mobile`, `/usage` (static SPA) |

**Auth/RBAC model (owner = admin):**
- `_auth_enabled()` = truthy `NOVA_AUTH_PASSPHRASE`. When unset → auth disabled (dev).
- `NOVA_AUTH_PASSPHRASE` format:
  - Single bare value `some-long-passphrase` → actor `owner`.
  - Named: `owner:<t1>,alex:<t2>,sam:<t3>` → each name is an **actor**; `owner` is special = **admin/is_admin=True**.
  - Token sent as `Authorization: Bearer <tok>`, `X-Nova-Token` header, or the 30-day cookie from `/api/auth/login`.
- `_is_admin(request)` = `_auth_enabled() and getattr(request.state, "actor", "") == "owner"`.
- `/api/health` is **public** but returns `actor` + `is_admin` of whichever token (if any) is present — frontend uses `health.is_admin` to gate UI.
- **Admin-only (403 otherwise):** `GET /api/gateway/keys` (list), `DELETE /api/gateway/keys/{prefix}` (revoke), `POST /api/gateway/keys` (mint), `POST /api/admin/restart`.
- `GET /api/conversations` (list-all history) is **403 for non-owners** when auth is enabled → general tokens still `POST /api/chat` (chat in a new conv) but can't enumerate history.
- `/v1/*` gateway access is per-minted-key (`sk-nova-*`), separate from the passphrase actors; calls metered as `gw:<key-name>` in usage.
- Rate/limits (per actor, when auth enabled): `NOVA_RATE_LIMIT_PER_MIN` (default 60/min), `NOVA_DAILY_TOKEN_CAP` (default 0=off).

Current token state on the phone: `owner:<ADMIN>` (admin), `alice:<ALICE>` (general), plus the operator's own pre-existing entry. **If the operator's pre-existing entry is bare or `owner:`-named, it is also admin — rename it to a general name (e.g. `me:<tok>`) so `owner:<ADMIN>` is the sole admin.** See §14.

---

## 6. Agent tools

`TOOLS` (line ~524). Three presets via `ChatRequest.tools_preset`:

| Preset | Tools |
|---|---|
| **Core** | `get_time` (tz-aware), `calculate` (arithmetic AST allow-list), `read_file` (sandboxed to `NOVA_SANDBOX` via realpath containment) |
| **Research** | Core + `web_search` (DuckDuckGo; you.com if `YOU_API_KEY`), `web_fetch` (read-only http(s), short timeout) |
| **Recon / NovaSec** | Research + `http_headers` (passive security-header probe) |

Notes: `web_*` are read-only; `read_file` is path-contained; `calculate` is an AST allow-list (no exec). All tool calls surface as assistant `tool` messages + `tool_result` in history. Persona + tools compose: NovaSec auto-selects the Recon preset.

---

## 7. Data model (SQLite, `NOVA_HISTORY_DB`, WAL, foreign_keys ON)

```
conversations(id PK, title, provider, model, created_at, updated_at,
  folder, tags, pinned, archived, persona_id)   -- feature-sprint cols; idempotent ALTER migrations
messages(id AI PK, conversation_id FK->conversations ON DELETE CASCADE,
  role, content, model, provider, reasoning, usage_json, created_at)
  indexes: idx_messages_cid(cid, created_at), idx_conv_updated(updated_at DESC)
usage_ledger(id AI PK, conversation_id, role, provider, model,
  prompt_tokens, completion_tokens, total_tokens, reasoning_tokens, raw_usage,
  created_at, actor, cost_usd)
  -- NO FK to conversations: survives delete/clear. One row per assistant turn w/ usage.
  indexes: idx_usage_model, idx_usage_provider, idx_usage_created
gateway_keys(key_hash PK -- SHA-256, name, key_prefix, created_at, last_used_at, enabled,
  scope, daily_quota_tokens, rate_limit_per_min)
personas(id PK, name, system_prompt, provider, model, tools_preset, created_at)
```
- `usage_ledger.actor` (nullable) = passphrase name for chat calls, `gw:<key-name>` for gateway calls.
- `GET /api/conversations/{cid}?last=N` paginates the most recent N messages, returns `total_messages`/`has_more` (mobile-friendly).

---

## 8. HTTP surface

| Route | Auth | What |
|---|---|---|
| `POST /api/chat` | passphrase or gateway key | non-streaming chat + agent tool loop |
| `POST /api/chat/stream` | passphrase or gateway key | SSE streaming (agent mode stays non-stream) |
| `POST /api/auth/login` | **public** | passphrase → 30-day signed cookie |
| `GET /api/health` | **public** (actor attached if token present) | liveness + provider `configured` flags + `actor`/`is_admin` |
| `GET /api/models` | none | provider registry + model lists (for UI) |
| `GET /api/usage` | passphrase | lifetime ledger aggregates `?provider=&days=&recent=1` (by person incl. `gw:<key>`) |
| `POST /api/images` | passphrase | text→image: gemini → cloudflare → foundry |
| `POST /api/analyze` | passphrase | log/EVTX analyzer (multipart) |
| `POST /api/attach` | passphrase | doc→context block (txt/pdf/csv/json/log/md) |
| `GET/POST/PUT/DELETE /api/conversations…` | passphrase (owner for some) | history CRUD + clear; `?last=N` pagination |
| `GET /api/conversations` | **owner** else 403 | list ALL conversations (admin-only — see §5) |
| `POST/GET/DELETE /api/gateway/keys…` | **owner** | mint (show raw `sk-nova-…` once, then hash) / list / revoke |
| `GET /v1/models` | gateway key | OpenAI-format `provider/model` ids |
| `POST /v1/chat/completions` | gateway key | OpenAI completions (stream + non-stream), temp/max_tokens/top_p passthrough; rate limit per key |
| `/api/ollama/status|load|unload` | passphrase (owner) | local Ollama control |
| `/`, `/mobile`, `/usage` | none | SPA / phone status / standalone dashboard |

Provider resolution (`_prepare_chat`, line ~2825): `provider = req.provider if req.provider in PROVIDERS else DEFAULT_PROVIDER`. **Unknown/bare provider ids fall back to `DEFAULT_PROVIDER`** (=`inception` on the phone). Model: `_resolve_model` uses the provider's `default_model` when `model` is empty/`auto`/`default`.

---

## 9. Providers (17) — exact id spelling

| id | label | key env var | notes |
|---|---|---|---|
| `foundry` | Azure AI Foundry | `FOUNDRY_API_KEY` | gpt-5-mini/gpt-4o, `api-key` header |
| `gemini` | Google Gemini | `GEMINI_API_KEY` (+`_BACKUP`) | OpenAI route, backup-key failover, image gen |
| `nova` | Amazon Nova | `NOVA_API_KEY` | nova-2/lite/pro/micro |
| `inception` | Inception Labs | `INCEPTION_API_KEY` | `mercury-2` (phone default) |
| `infron` | **Infron (ONE router)** | **`INFRON_API_KEY`** | qwen/qwen3.8-27b:free — id is **`infron`** not `infrar` |
| `cohere` | Cohere | `COHERE_API_KEY` | native v2, normalized |
| `ollama` | Local Ollama | `OLLAMA_API_KEY` | uncensored local; idle-unload watchdog; not viable on phone |
| `hfrouter` | HuggingFace Router | `HF_TOKEN` | cloud, censored |
| `requesty` | Requesty | `REQUESTY_API_KEY` | cloud, censored |
| `cloudflare` | Cloudflare Workers AI | `CLOUDFLARE_API_TOKEN` | 10k neurons/day, image gen fallback |
| `mistral` | Mistral AI | `MISTRAL_API_KEY` | free tier |
| `gmi` | GMI Cloud | `GMI_API_KEY` | MiniMax M-series |
| `upstage` | Upstage AI | `UPSTAGE_API_KEY` | reasoning effort support |
| `reka` | Reka AI | `REKA_API_KEY` | X-Api-Key header |
| `nvidia` | NVIDIA NIM | `NVIM_API_KEY` | vision-capable, `nvapi-` |
| `agnes` | Agnes AI | `AGNES_API_KEY` | Bearer auth |
| `ifm` | IFM AI K2 Horizon | `IFM_API_KEY` | 180s reasoning timeouts + thinking-trace replay |

OpenRouter is currently commented out in `PROVIDERS` (env vars/ branch kept). New providers: append a `PROVIDERS` entry + a `_provider_key` branch; env overrides are `<ID>_API_KEY/_BASE_URL/_MODEL/_MODELS`. The uncensored system prompt is applied only to `("ollama", "infron")` (line ~2841).

---

## 10. Configuration (`.env`)

Copy `.env.example` → `.env`. **Keys are server-side only — never sent to the browser.**
Essential knobs (full list in `.env.example`):

```ini
DEFAULT_PROVIDER=inception          # UI default provider id
NOVA_SANDBOX=/home/dev/PROJECT/NOVA_Project   # read_file jail
NOVA_AUTH_PASSPHRASE=owner:<ADMIN>,alice:<ALICE>   # named tokens; owner=admin
NOVA_AUTH_SECRET=<random>          # cookie signer (falls back to first passphrase)
NOVA_HISTORY_DB=/home/dev/PROJECT/NOVA_Project/nova_history.db
NOVA_PUBLIC_URL=https://nova.terminalflaw.xyz   # advertised in Gateway snippets
NOVA_RATE_LIMIT_PER_MIN=60       # per-actor chat limit (0=off)
NOVA_DAILY_TOKEN_CAP=0           # per-actor 24h token cap (0=off)
NOVA_MAX_UPLOAD_MB=10
GEMINI_API_KEY=… ; GEMINI_API_KEY_BACKUP=…     # failover
CLOUDFLARE_ACCOUNT_ID=…          # unlocks flux image gen
INFRON_API_KEY=… ; INFRON_MODEL=qwen/qwen3.8-27b:free
YOU_API_KEY=…                    # web search (else DuckDuckGo)
```

`.env` is gitignored (`git check-ignore .env` → ignored). The phone loads it with `set -a; . ./.env; set +a` before starting uvicorn.

---

## 11. Auth & RBAC — precise rules

- **Owner token (admin):** any passphrase entry named `owner`, *or* the single bare passphrase `NOVA_AUTH_PASSPHRASE` (actor=`owner`). → `is_admin=True`.
- **General token:** any other named entry (e.g. `alice:<tok>`). → `is_admin=False`.
- **General tokens can:** chat (new or existing convos), mint their own usage rows, use `/v1/*` gateway if given a minted key. **Cannot:** list all conversations or list/revoke gateway keys (403).
- **Owner can:** everything (history list, mint/revoke keys, restart, ollama control if wired).
- **Frontend gating:** `App.jsx` reads `is_admin` from `/api/health`; `GatewayTab` hides mint/revoke/keys for non-admins; `Sidebar` shows "History is admin-only" on 403; `api.js` distinguishes 403/401 via `err.status`.

Token transport: `Authorization: Bearer <tok>` header, `X-Nova-Token` header, or the 30-day cookie from `/api/auth/login`. Browsers hit the lock screen once → 30-day cookie; `x-nova-token` is the scriptable path. Rotate `NOVA_AUTH_PASSPHRASE` to revoke all devices.

---

## 12. Deployment recipes

**Linux one-liner (systemd + Cloudflare quick tunnel):**
```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/atrixi1337/NOVA_Project/master/install.sh)"
```

**Linux venv manual:**
```bash
pip install -r requirements.txt
cp .env.example .env   # fill keys
uvicorn backend:app --host 0.0.0.0 --port 8000
```

**Phone (primary), after any backend change:**
```bash
ssh -i ~/.ssh/nova_phone_key -p 8022 u0_a318@192.168.0.6
cd ~/NOVA_Project
git pull --ff-only origin master
pkill -f 'uvicorn backend:app --host 0.0.0.0 --port 8000'; sleep 1
set -a; . ./.env; set +a
export APP_HOST=0.0.0.0 APP_PORT=8000 NOVA_HISTORY_DB="$HOME/NOVA_Project/nova_history.db"
nohup .venv/bin/python -m uvicorn backend:app --host 0.0.0.0 --port 8000 > nova-app.log 2>&1 &
```
Resilience (already live): `nohup bash ~/NOVA_Project/deploy/phone-watchdog.sh >/dev/null 2>&1 &` (30s, 2 fails, pid-locked, log rotation @5 MB, optional `WATCHDOG_NTFY=`). Registered in `~/.termux/boot/start-nova.sh` + wake-lock.

**Phone Python deps:** `requirements.txt` pins `uvicorn[standard]`, which fails to build on Termux/aarch64 (no `watchfiles` wheel). The deploy path strips it to plain `uvicorn` — see `requirements.phone.txt` (generated on-device). Do **not** blindly `pip install -r requirements.txt` on the phone.

**Frontend rebuild:**
```bash
cd ~/NOVA_Project/frontend && npx vite build   # -> ../static  (no server restart)
```

**Backups:** `deploy/devbox-backup.sh` pulls a consistent SQLite snapshot (via `phone-snapshot-db.py`) + `.env` into `~/NOVA_Project_backups/<date>/`, 14-day prune. cron `15 4 * * *`. DR in `README_RESTORE.md`.

---

## 13. Operations / smoke checks

- **Tests (offline, no network):** `cd /home/dev/PROJECT/NOVA_Project && python3 -m pytest tests/ -q` → **51 passed** (44 backend + 7 ssrf). Providers are faked in `conftest.py`.
- **Lint/import sanity:** `python3 -c "import backend"` must succeed (no `AttributeError: … has no attribute '_is_admin'` etc.) before restarting.
- **Live health (public, no token):** `curl -s https://nova.terminalflaw.xyz/api/health` → 200, `providers.<p>.configured`.
- **Admin path:** with `X-Nova-Token: <ADMIN>` → `/api/health` `is_admin:true`, `GET /api/conversations` 200, `GET /api/gateway/keys` 200, `POST /api/chat` (provider `infron`, model `qwen/qwen3.8-27b:free`) → 200 `"Infron connection successful."`.
- **General path:** with `X-Nova-Token: <ALICE>` → `/api/conversations` 403, `/api/gateway/keys` 403, `/api/health` `is_admin:false`, but `POST /api/chat` still 200.

Recent git log (master):
```
d5d8325 chore: gitignore .nova_tokens (operator token file)
fa1d39f feat(auth/upload): combine upload button; admin-only key+history gating; is_admin in health
5e3f755 readme: mark Infrar live, 47 tests green
```

---

## 14. Secrets — how to (not) do things

- **Tokens live in two places** on the phone: (1) appended to `.env`'s `NOVA_AUTH_PASSPHRASE` (runtime), (2) `~/NOVA_Project/.nova_tokens` (chmod 600) **for operator retrieval only**. The raw values are **redacted in this agent's tool outputs** — I never saw them.
- **To retrieve your tokens** (run in **your own** terminal — they're visible there, not to me):
  ```bash
  ssh -i ~/.ssh/nova_phone_key -p 8022 u0_a318@192.168.0.6 'cat ~/NOVA_Project/.nova_tokens'
  ```
  Then store them safely and `rm ~/NOVA_Project/.nova_tokens` (the values are already in `.env`).
- **Making your current token "general":** if your pre-existing passphrase entry is bare or named `owner`, rename it to a general name so `owner:<ADMIN>` is the sole admin:
  ```bash
  # on the phone, YOUR terminal (you'll see the real values):
  sed -i 's/^NOVA_AUTH_PASSPHRASE=.../NOVA_AUTH_PASSPHRASE=me:<your-current-token>,owner:<ADMIN>,alice:<ALICE>/' .env
  ```
  i.e. prefix your old token with `me:` (a non-owner actor). I can't do this for you without seeing the value, so do it from your terminal, then restart uvicorn.
- **Never** print `.env` / `.nova_tokens` contents through me — they're redacted and useless when echoed.
- **`.env` git:** `git check-ignore .env` → ignored. `.nova_tokens` is now gitignored too. Committed `.env.example` contains only placeholders.

---

## 15. Scope & limitations

- **POC for a personal lab.** One shared passphrase — not multi-user account management. Rotate `NOVA_AUTH_PASSPHRASE` to revoke access.
- **Admin ≠ fine-grained RBAC.** "Owner" = full admin; there's no per-user roles beyond that. Per-user conversation ownership (general users see only their own chats instead of a blanket 403 on `/api/conversations`) is **out of scope** — would need an `actor` column on `conversations` + a schema migration.
- Cloud providers apply their own safety filters regardless of system prompts. NovaSec (and the uncensored prompt) are bounded expert personas, not an uncensor. Only local Ollama is truly uncensored and needs more RAM than a phone can give.
- **Infron id is `infron`** (i-n-f-r-o-n). Older scratch notes/logs may show `infrar` (a typo) — those are stale; the code is `infron` and the live path is verified with `infron`. Unknown provider ids silently fall back to `DEFAULT_PROVIDER` (so a stray `infrar` still routes today, but is not the registered id).
- `read_file` is confined to `NOVA_SANDBOX` (realpath containment); `calculate` is an AST allow-list (no exec); web tools are read-only http(s) with short timeouts.
- Phone realities: ~8 GB RAM, no local LLMs, `termux-wake-lock` on, named tunnel (stable URL) preferred; don't restart the tunnel casually.

---

*End of handover. Repo root, `git pull` for code. Phone: `git pull --ff-only origin master` + uvicorn restart (or let the watchdog do it).*
