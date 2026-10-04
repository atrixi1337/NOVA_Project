# NOVA — Feature build F13 → F22

Sprint plan for the next batch of features, continuing the existing F1–F12
numbering (see `lates_readme_2026-09-13.md`). Every feature is additive and
idempotent; nothing existing changes behaviour unless its env knob is set.

## Env knobs (all default to "off" / backwards-compatible)

| Var | Default | Feature |
|---|---|---|
| `NOVA_FAILOVER` | `""` (off) | F15 ordered fallback provider ids |
| `NOVA_COMPACT_CHARS` | `0` (off) | F18 outbound context compaction threshold |
| `NOVA_APPROVAL_TOOLS` | `write_file` | F20 tools needing human approval |
| `NOVA_SEARCH_FTS` | `1` | F13 use FTS5, else LIKE fallback |
| `NOVA_BENCH_CONCURRENCY` | `3` | F16 max parallel provider calls |
| `NOVA_SCHED_TICK_S` | `60` | F19 scheduler poll interval |

## HTTP surface added

| Route | Auth | What |
|---|---|---|
| `GET /api/conversations/search?q=&limit=` | **owner** | F13 full-text search; returns `engine: fts\|like` |
| `POST /api/conversations/{cid}/fork` | passphrase | F14 branch at `?at_message_id=N`, body `{title}` |
| `GET /api/conversations/{cid}/diff/{other}` | passphrase | F22 shared prefix + diverging tails |
| `POST /api/bench/run` | passphrase | F16 `{label, suite[], providers[], models{}}` |
| `GET /api/bench/runs?limit=` | passphrase | F16 recorded cells, newest first |
| `GET/POST /api/schedules` | passphrase (**403 if auth disabled**) | F19 list / create |
| `PATCH/DELETE /api/schedules/{sid}` | passphrase | F19 update / delete |
| `POST /api/schedules/{sid}/run` | passphrase | F19 fire now, returns the new `conversation_id` |
| `GET /api/backup/export?include_usage=` | **owner** | F21 whole archive as JSON |
| `POST /api/backup/import` | **owner** | F21 `mode=merge\|replace` |

`ChatRequest` gains `compact` (F18), `require_approval` + `approved_tools` (F20).
`/api/chat` gains a `status: "awaiting_approval"` response carrying
`pending_tools`, and echoes `compaction` on normal replies.
`/v1/chat/completions` gains `nova_served_by` so a caller can tell a fallback
happened without parsing the model id.

## Features

### F13 — Full-text message search
- `messages_fts` FTS5 virtual table (`content`, `conversation_id`, `role`),
  synced explicitly from Python at the four message write/delete sites.
- `GET /api/conversations/search?q=&limit=` → grouped hits with snippets.
- Owner-gated (matches `GET /api/conversations`).
- Graceful LIKE fallback if the SQLite build lacks FTS5.

### F14 — Fork / branch a conversation
- `conversations.parent_id` + `forked_at_message_id` (idempotent ALTER).
- `POST /api/conversations/{cid}/fork?at_message_id=N&title=…` copies every
  message up to N into a fresh conversation and returns it.

### F15 — Cross-provider failover
- `_failover_chain(provider)` → ordered alternates from `NOVA_FAILOVER` that
  actually have keys configured.
- `call_llm_failover(...)` retries only on *transient* failures (429, 5xx,
  network); 400/401 surface immediately — they are config errors, not outages.
- The response reports which provider actually served, so the UI is honest.

### F16 — Provider benchmark harness
- `bench_runs` table. `POST /api/bench/run` fires a prompt suite at N providers
  concurrently (semaphore-bounded, so a phone doesn't melt) and records latency,
  tokens and cost per cell. `GET /api/bench/runs` lists history.
- Owner-only: it spends the operator's keys.

### F17 — Recall tool (history RAG)
- `tool_recall(query, limit)` searches `messages_fts` and returns
  `{text, citations}` so results render in the existing Sources block.
- Added to the `research` preset.

### F18 — Context auto-compaction
- `_maybe_compact()` collapses the oldest turns into a summary system message
  once the outbound payload exceeds `NOVA_COMPACT_CHARS`. Compacts a *copy* —
  the stored transcript is never rewritten. Returns a marker the UI can render.

### F19 — Scheduled prompts
- `schedules` table + background asyncio ticker. `GET/POST/PATCH/DELETE
  /api/schedules`, `POST /api/schedules/{id}/run` for a manual fire.
- Results land in a dedicated conversation so they're browsable like any chat.

### F20 — Human-in-the-loop tool approval
- `ChatRequest.require_approval`; tools in `NOVA_APPROVAL_TOOLS` halt the loop
  and return `status: "awaiting_approval"` with the pending calls instead of
  executing. Client re-posts with `approved_tools` to let them run.

### F21 — Whole-archive backup
- `GET /api/backup/export` (conversations + messages + personas, optional
  usage ledger) and `POST /api/backup/import` with `merge`/`replace` modes.

### F22 — Conversation diff
- `GET /api/conversations/{cid}/diff/{other}` → shared prefix length plus the
  diverging tail of each side, so a fork can be compared against its parent.

## Verification gates (every phase)
1. `python3 -c "import backend"`
2. `python3 -m pytest tests/ -q` — **116 passed** (51 pre-existing + 65 new in
   `tests/test_features.py`)
3. `cd frontend && npx vite build` after any frontend change

## UI

Two new tabs (`bench`, `schedules`), plus:

- **Sidebar** — debounced full-text search with match snippets; `⑂` fork button
  and `⇄` compare button per conversation; a Backup section (admin-only) with
  Export all / Restore.
- **Settings** — `recall` tool preset; "Ask before risky tools" (F20) and
  "Compact long conversations" (F18) toggles, both persisted in localStorage.
- **Chat** — compaction notice, and an approve/deny card when the agent halts
  on a risky tool; fork-vs-parent diff panel.

## Deploy note
Backend changes need a uvicorn restart on the phone; the tunnel, `.env` and
`nova_history.db` are untouched. Every new table/column is created by the
idempotent `init_db()` migration path.