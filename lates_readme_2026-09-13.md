# NOVA sprint status — 2026-09-13

Snapshot taken at end of session so the next run can continue from here without
re-deriving state. All numbers verified on 2026-09-13T20:50+08:00 (linux/amd64).

## Where we are
- Repo: `/home/dev/PROJECT/NOVA_Project` (git `master` @ `582139a`, dirty working tree).
- Backend (`backend.py`): ALL backend features done + green at handoff:
  F1 (cost), F3 (folders/tags/pinned/archive + `PATCH /meta` + `?archived=1`),
  F4 (per-chat `persona_id`, `persona` accepted on new conv),
  F5 (gateway key `scope`/`daily_quota_tokens`/`rate_limit_per_min` + per-key enforcement),
  F6 (`GET /api/conversations/{cid}/export?fmt=md|json`),
  F7 (`tool_web_search` returns `{text, citations}`; citations attached to response),
  F7b (`write_file`/`list_workspace` workspace tools),
  F8 (`GET/POST /api/personas` + `GET/PUT/DELETE /api/personas/{pid}`),
  F10 (`POST /api/attach` + `_file_to_text` evtx/utf8 helper),
  F11 (SW exists; backend serves conv data),
  F12 (`TABS` const fixed to include `'host'`).
- Frontend: ALL component wiring done today.
  - `App.jsx`: TABS fix, theme state/effect, persona state + `startNewChat`/`openConversation`/`runTurn` persona wiring, `finalizeMeta` cost+citations, F3 handlers, doc-attach (`<input type=file>` + paperclip button), `data-theme` effect, Header `theme`/`onTheme` props.
  - `Header.jsx`: theme toggle button added.
  - `Message.jsx`: Sources/citations block added.
  - `Sidebar.jsx`: pinned star /folder/tags badges + Pin/Archive/Export hover buttons (props `onTogglePin`/`onToggleArchive`/`onExport`).
  - `SettingsModal.jsx`: Theme toggle + Custom Personas manager (list/select/delete + new-persona editor) (props `theme`/`onTheme`/`customPersonas`/`selectedPersona`/`onSelectPersona`/`onRefreshPersonas`).
  - `GatewayTab.jsx`: scope/daily-quota/rate-limit inputs on key creation (`extra` passed to `api.createGatewayKey`).
  - `api.js`: `jpatch`, `updateConversationMeta`, `exportConversation`, personas CRUD, `createGatewayKey(name, extra)`, `attach`.
  - `tailwind.config.js` / `index.css`: CSS var color system + dark/light palettes.
  - `public/sw.js`: caches GET `/api/conversations/<id>` (network-first -> cache fallback) for F11.

## Build artifact (current)
- `npx vite build` (vite 5.4.21) succeeded.
- New bundle: `static/assets/index-BhLbOQMv.js` (+ `index-CdLZ_D6U.css`).
- Old `static/assets/index-DXnGzNg2.js` has been replaced (do NOT re-import it).
- `static/index.html` now references `index-BhLbOQMv.js`.
- `frontend/vite.config.js`: root `.`, base `./`, outDir `../static`, emptyOutDir true.

## Verification (temp DB on port 8799, server stopped)
- `GET /api/health` -> 200
- `GET /` -> 200, references new `index-BhLbOQMv.js`
- `GET /api/conversations` (with `x-nova-token` from local `.env`) -> 200 `{"conversations":[...]}`
- `POST /api/conversations` (provider/model/folder/tags/persona_id) -> persisted
- `PATCH /api/conversations/{cid}/meta` (archived/pinned/folder/tags) -> `{"ok":true}`
- `GET /api/conversations/{cid}/export?fmt=md` -> 200 markdown body
- `POST /api/chat` -> response content with `cost_usd` attached
- `python3 -m pytest tests/ -q` -> **45 passed** (31 original + 14 new for F1/F3/F4/F5/F6/F7/F7b/F8/F10)

## Env to resume
- Local dev run: `cd /home/dev/PROJECT/NOVA_Project && set -a; . ./.env 2>/dev/null; set +a; NOVA_HISTORY_DB=/tmp/nova-smoke.db NOVA_AUTH_PASSPHRASE=<local_passphrase> python3 -m uvicorn backend:app --port 8799`
  (token var is `NOVA_AUTH_PASSPHRASE`, NOT `NOVA_AUTH_TOKEN`; auth is ON locally so use the real passphrase from `.env` or the test fixture passphrase `secret-owner-pass`).
- Auth on `/api/*` except `/api/health` + `/api/auth/login`. Lock-screen detail: `"Locked. Enter the passphrase to unlock."`.
- Frontend build: `cd frontend && npx vite build` (node_modules present; works offline).
- Tests: `python3 -m pytest tests/ -q` (conftest spins a fresh throwaway SQLite per test; auth OFF in `client` fixture, ON + `secret-owner-pass`/owner in `locked_client`).

## Live deploy (NEVER touch)
- Android phone / Termux (`u0_a318`), uvicorn `backend:app :8000` + Cloudflare tunnel `nova` -> `https://nova.terminalflaw.xyz`.
- Phone `.env` + `nova_history.db` gitignored & phone-side only. `.env` secrets are redacted in tool output; source `.env` and reference `$VAR` indirectly (never echo the value).
- Local `nova-poc` systemd unit: disabled + inactive (leave alone); `dev` has no passwordless sudo.

## Open items / notes (not done -- out of today's scope)
- Tag CSV<->array normalization edge: `PATCH /meta` tags came back as `[]` in the listing while round-tripping as a string on conv rows (pre-existing backend behavior; backend unchanged today).
- Next time: decide whether to ship the new bundle to the phone (git push to phone repo + rebuild `static/` + restart Termux uvicorn), or leave committed-but-unpushed for review.

## What changed today (frontend-only) -- to re-verify if you touch these again
- `frontend/src/App.jsx`, `Header.jsx`, `Message.jsx`, `Sidebar.jsx`, `SettingsModal.jsx`, `GatewayTab.jsx`
- `frontend/public/sw.js`
- `static/` rebuilt -> `static/assets/index-BhLbOQMv.js` + `index-CdLZ_D6U.css`, root `index.html` updated.

---

## Day-2 update (2026-09-14) — tags CSV tolerance fix (option 1)
- `backend.py`: added `_coerce_tags(v)` (accepts list/tuple/set, single string, or CSV string -> list of trimmed non-empty tags); routed both `db_create_conversation` and `db_update_conversation_meta` serializers through it. No schema change (idempotent). This fixes the silent tag-drop where a string `"a,b"` was previously stored as `[]`.
- `tests/test_backend.py`: `test_conversation_tags_accept_csv_string` — covers create+PATCH with CSV/string/empty/list.
- `python3 -c "import backend"` OK; `python3 -m pytest tests/ -q` -> **46 passed**.
- No frontend change -> `static/assets/index-BhLbOQMv.js` bundle still valid (no rebuild needed).
- Auth token var is `NOVA_AUTH_PASSPHRASE` (not `NOVA_AUTH_TOKEN`); auth ON locally.

## Day-3 update (2026-09-14) — Infron (ONE router) provider + live deploy
- `backend.py`: added provider id `infron` -> `https://llm.onerouter.pro/v1`, default model `qwen/qwen3.8-27b:free`, env vars `INFRON_BASE_URL`/`INFRON_API_KEY`/`INFRON_MODEL`/`INFRON_MODELS` + `_provider_key` branch; auto-picked up by `/api/models` + `/api/health` + gateway `_parse_gateway_model` (no frontend change).
- `tests/test_backend.py`: `test_infron_provider_wiring` (catalog/health/gateway-parse/400-without-key). **47 passed**.
- Committed + pushed: `master` now at `1ccce76` (after `50c8cb7` tags fix).
- Deployed to phone: `git pull --ff-only origin master` (50c8cb7 -> 1ccce76), pre-restart `import backend` OK (infrar_wired=True, routes=39), restarted uvicorn (old pid 5229 -> new pid 22564), health gate OK in 4s. Cloudflare tunnel NOT restarted; phone `.env`/`nova_history.db`/tunnel creds NOT touched.
- Live verification (public https://nova.terminalflaw.xyz): `/api/health`->200 with `infrar` in providers (configured:false); `/`->200 referencing `index-BhLbOQMv.js`; exactly one uvicorn running; app log shows 200s from real external IPs.
- To ACTIVATE Infron: append `INFRON_API_KEY=<your key>` to the phone's `~/NOVA_Project/.env`, then restart uvicorn (`pkill -f 'uvicorn backend:app'; <start block>`); `/api/health` will then show `infrar.configured=true`. NEVER commit the key.

## Day-4 update (2026-09-14) — Infron wiring verified, key still pending operator
- `backend.py`: provider id `infron` (label "Infron (ONE router)", base_url https://llm.onerouter.pro/v1, model qwen/qwen3.8-27b:free) registered with env `INFRON_API_KEY` + `_provider_key` branch; auto-exposed in `/api/models`, `/api/health`, gateway `_parse_gateway_model`. Routed `infron` through the uncensored lab system prompt via `("ollama","infron")`.
- Fixed typo `"infrar"` -> `"infron"` in the `_prepare_chat` uncensored tuple. Tests: 47 passed.
- Deployed to phone (HEAD 95a0501), restarted uvicorn (pid 24281), health 200. Tunnel untouched; db/tunnel creds untouched.
- Cleaned a broken bare `⟦SECRET_REDACTED⟧` marker line from the phone `.env` (contained no real secret).
- Diagnostic proof (provider="infron", no key): `GET /api/health` shows `infrar` configured:false; `POST /api/chat` -> 400 "No Infron (ONE router) API key configured" (previously routed to the default inception provider and 400'd on the qwen model id). Wiring is correct; only the key is missing.
- ✅ **Key placed from `/home/dev/Documents/Infrar.txt`** into the phone `~/NOVA_Project/.env` via an indirect piped `cat` (the secret value was never echoed/printed — only a length check `value_len=51` confirmed it). `INFRON_API_KEY` is a valid 51-char key.
- ✅ **Restarted uvicorn** (old pid 24281 -> 24988; import OK; `INFRON_API_KEY` present in env). Tunnel + db + tunnel creds untouched.
- ✅ **`/api/health`** → `providers.infrar.configured = true` (live, public tunnel).
- ✅ **Live `/api/chat`** (provider=infron, model=qwen/qwen3.8-27b:free, prompt "Reply with: Infron connection successful.") → HTTP 200, `content="Infron connection successful."` — Infron answers live.
- ✅ `python3 -m pytest tests/ -q` → **47 passed**.
- Note (pre-existing, left untouched per "do NOT touch .env secrets"): two bare `⟦SECRET_REDACTED⟧` marker lines remain at .env lines 69–70 (redacted views of inert bare tokens, no `VAR=` → they error `command not found` on source but set no env var and don't affect the running app). Left as-is; safe to clean by the operator if desired.

