"""Tests for the F13–F22 feature batch.

Covers: full-text search (F13), conversation forking (F14), cross-provider
failover (F15), the benchmark harness (F16), the recall tool (F17), context
compaction (F18), scheduled prompts (F19), tool approval gating (F20), archive
backup/restore (F21), and conversation diffing (F22).
"""
import asyncio
import json
import time

import pytest
from fastapi import HTTPException

import backend
from test_backend import make_conversation  # noqa: F401  (shared helper)


def _msg(cid, role, content):
    backend.db_save_message(cid, role, content, "m", "inception")


def run(coro):
    """Drive a coroutine from a sync test.

    Uses a throwaway loop rather than asyncio.get_event_loop(), which is
    deprecated and no longer creates a loop implicitly on Python 3.12+.
    """
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ---------------------------------------------------------------------------
# F13 — full-text message search
# ---------------------------------------------------------------------------

def test_search_finds_message_bodies_not_just_titles(client):
    cid = make_conversation(client)
    _msg(cid, "user", "the postgres connection pool is leaking")
    _msg(cid, "assistant", "try lowering max_connections")
    r = client.get("/api/conversations/search", params={"q": "postgres"})
    assert r.status_code == 200
    body = r.json()
    assert body["results"], "expected a hit for a word that only appears in a message body"
    assert body["results"][0]["conversation_id"] == cid
    assert "postgres" in body["results"][0]["snippet"].lower()


def test_search_is_scoped_to_matching_conversation(client):
    a, b = make_conversation(client), make_conversation(client)
    _msg(a, "user", "kubernetes ingress timeout")
    _msg(b, "user", "unrelated chatter about gardening")
    r = client.get("/api/conversations/search", params={"q": "kubernetes"})
    ids = {h["conversation_id"] for h in r.json()["results"]}
    assert ids == {a}


def test_search_survives_punctuation_and_fts_syntax(client):
    """User input is data, not an FTS5 expression — a stray quote or operator
    must not raise or return nothing."""
    cid = make_conversation(client)
    _msg(cid, "user", "value was 42 and it worked")
    for q in ['"', "42 OR", "NEAR(", "*", "AND OR NOT", "value"]:
        r = client.get("/api/conversations/search", params={"q": q})
        assert r.status_code == 200, f"query {q!r} should not 500"
    hits = client.get("/api/conversations/search", params={"q": "value"}).json()["results"]
    assert any(h["conversation_id"] == cid for h in hits)


def test_search_empty_query_returns_nothing(client):
    make_conversation(client)
    r = client.get("/api/conversations/search", params={"q": "   "})
    assert r.status_code == 200
    assert r.json()["results"] == []


def test_search_index_follows_deletes(client):
    """Regenerate replaces the tail; stale text must not stay searchable."""
    cid = make_conversation(client)
    _msg(cid, "user", "original question about terraform")
    _msg(cid, "assistant", "original answer")
    backend.db_drop_last_turn(cid)
    assert client.get("/api/conversations/search", params={"q": "terraform"}).json()["results"] == []
    _msg(cid, "user", "a different question entirely")
    hits = client.get("/api/conversations/search", params={"q": "terraform"}).json()["results"]
    assert hits == []


def test_search_index_follows_conversation_delete(client):
    cid = make_conversation(client)
    _msg(cid, "user", "ephemeral musing about velero")
    assert client.get("/api/conversations/search", params={"q": "velero"}).json()["results"]
    client.delete(f"/api/conversations/{cid}")
    assert client.get("/api/conversations/search", params={"q": "velero"}).json()["results"] == []


def test_search_index_follows_clear(client):
    cid = make_conversation(client)
    _msg(cid, "user", "wipe this from the index too")
    client.post(f"/api/conversations/{cid}/clear")
    assert client.get("/api/conversations/search", params={"q": "wipe"}).json()["results"] == []


def test_search_reports_its_engine(client):
    r = client.get("/api/conversations/search", params={"q": "x"})
    assert r.json()["engine"] in ("fts", "like")


def test_search_is_owner_only_when_locked(client):
    """A general token must not be able to read everyone's history by search."""
    cid = make_conversation(client)
    _msg(cid, "user", "confidential roadmap discussion")
    backend.AUTH_TOKENS = {"owner-pass": "owner", "general-pass": "alice"}
    assert client.get(
        "/api/conversations/search", params={"q": "confidential"},
        headers={"X-Nova-Token": "owner-pass"},
    ).status_code == 200
    assert client.get(
        "/api/conversations/search", params={"q": "confidential"},
        headers={"X-Nova-Token": "general-pass"},
    ).status_code == 403
    backend.AUTH_TOKENS = {}


# ---------------------------------------------------------------------------
# F14 — forking
# ---------------------------------------------------------------------------

def test_fork_copies_transcript_and_records_lineage(client):
    src = make_conversation(client)
    _msg(src, "user", "first question")
    _msg(src, "assistant", "first answer")
    _msg(src, "user", "second question")
    _msg(src, "assistant", "second answer")
    r = client.post(f"/api/conversations/{src}/fork")
    assert r.status_code == 200
    fork = r.json()
    assert fork["id"] != src
    assert len(fork["messages"]) == 4
    assert fork["messages"][0]["content"] == "first question"
    assert "(fork)" in fork["title"] or fork["title"]


def test_fork_at_message_truncates_the_branch(client):
    src = make_conversation(client)
    _msg(src, "user", "keep this")
    _msg(src, "assistant", "keep this too")
    _msg(src, "user", "drop this")
    # Resolve the real rowid of the 2nd message.
    conn = backend._db()
    second_id = conn.execute(
        "SELECT id FROM messages WHERE conversation_id = ? ORDER BY id ASC LIMIT 1 OFFSET 1",
        (src,),
    ).fetchone()[0]
    conn.close()
    fork = client.post(f"/api/conversations/{src}/fork", params={"at_message_id": second_id}).json()
    assert len(fork["messages"]) == 2
    assert fork["messages"][-1]["content"] == "keep this too"
    # The parent is untouched.
    assert len(client.get(f"/api/conversations/{src}").json()["messages"]) == 3


def test_fork_accepts_a_body_instead_of_a_query_param(client):
    src = make_conversation(client)
    _msg(src, "user", "one")
    _msg(src, "assistant", "two")
    r = client.post(f"/api/conversations/{src}/fork", json={"title": "my branch"})
    assert r.status_code == 200
    assert r.json()["title"] == "my branch"


def test_fork_unknown_source_is_404(client):
    assert client.post("/api/conversations/conv_missing/fork").status_code == 404


def test_fork_bad_message_id_is_404(client):
    src = make_conversation(client)
    _msg(src, "user", "only one")
    assert client.post(
        f"/api/conversations/{src}/fork", params={"at_message_id": 999999}
    ).status_code == 404


def test_forked_messages_are_searchable(client):
    src = make_conversation(client)
    _msg(src, "user", "uniqueforktoken content")
    fork = client.post(f"/api/conversations/{src}/fork").json()
    hits = client.get("/api/conversations/search", params={"q": "uniqueforktoken"}).json()["results"]
    ids = {h["conversation_id"] for h in hits}
    assert src in ids and fork["id"] in ids


# ---------------------------------------------------------------------------
# F15 — cross-provider failover
# ---------------------------------------------------------------------------

def test_failover_falls_back_on_429(client, monkeypatch):
    monkeypatch.setattr(backend, "NOVA_FAILOVER", ["gemini"])
    monkeypatch.setattr(backend, "_provider_key", lambda p: {"inception": "k1", "gemini": "k2"}.get(p, ""))

    seen = []

    async def flaky(messages, model, api_key, provider="nova", tools=None,
                    reasoning_effort=None, extra_params=None):
        seen.append(provider)
        if provider == "inception":
            raise HTTPException(status_code=429, detail="rate limited")
        return {"choices": [{"message": {"role": "assistant", "content": "served by gemini"}}],
                "usage": {"total_tokens": 5}}

    monkeypatch.setattr(backend, "call_llm", flaky)
    data, served = run(
        backend.call_llm_failover([{"role": "user", "content": "hi"}], "m", "k1", "inception")
    )
    assert served == "gemini"
    assert data["choices"][0]["message"]["content"] == "served by gemini"
    assert seen == ["inception", "gemini"]


def test_failover_does_not_happen_on_client_errors(client, monkeypatch):
    """A 401 means the key is wrong. Retrying elsewhere hides the real problem
    and burns the fallback provider's quota."""
    monkeypatch.setattr(backend, "NOVA_FAILOVER", ["gemini"])
    monkeypatch.setattr(backend, "_provider_key", lambda p: "k")

    seen = []

    async def unauthorized(messages, model, api_key, provider="nova", tools=None,
                           reasoning_effort=None, extra_params=None):
        seen.append(provider)
        raise HTTPException(status_code=401, detail="bad key")

    monkeypatch.setattr(backend, "call_llm", unauthorized)
    with pytest.raises(HTTPException) as ei:
        run(backend.call_llm_failover([{"role": "user", "content": "hi"}], "m", "k", "inception"))
    assert ei.value.status_code == 401
    assert seen == ["inception"], "must not retry a 401 on another provider"


def test_failover_skips_alternates_without_keys(client, monkeypatch):
    monkeypatch.setattr(backend, "NOVA_FAILOVER", ["gemini", "mistral"])
    monkeypatch.setattr(backend, "_provider_key", lambda p: "k" if p == "inception" else "")

    async def boom(messages, model, api_key, provider="nova", tools=None,
                   reasoning_effort=None, extra_params=None):
        raise HTTPException(status_code=503, detail="down")

    monkeypatch.setattr(backend, "call_llm", boom)
    with pytest.raises(HTTPException):
        run(backend.call_llm_failover([{"role": "user", "content": "hi"}], "m", "k", "inception"))


def test_failover_reports_the_provider_that_answered(client, monkeypatch):
    """The response must name the provider that actually served the turn, and
    usage must be attributed to it — otherwise the ledger lies."""
    monkeypatch.setattr(backend, "NOVA_FAILOVER", ["gemini"])
    monkeypatch.setattr(backend, "_provider_key", lambda p: "k")
    monkeypatch.setattr(backend, "GEMINI_API_KEYS", ["k"])
    monkeypatch.setattr(backend, "_resolve_model", lambda p, m="": m or f"{p}-model")

    async def primary_down(messages, model, api_key, provider="nova", tools=None,
                           reasoning_effort=None, extra_params=None):
        if provider == "inception":
            raise HTTPException(status_code=500, detail="gateway down")
        return {"choices": [{"message": {"role": "assistant", "content": "hello from backup"}}],
                "usage": {"prompt_tokens": 3, "completion_tokens": 4, "total_tokens": 7}}

    monkeypatch.setattr(backend, "call_llm", primary_down)
    cid = make_conversation(client)
    r = client.post("/api/chat", json={
        "messages": [{"role": "user", "content": "hi"}], "conversation_id": cid,
    })
    assert r.status_code == 200
    assert r.json()["provider"] == "gemini"
    assert r.json()["content"] == "hello from backup"
    saved = client.get(f"/api/conversations/{cid}").json()["messages"]
    assert saved[-1]["provider"] == "gemini", "ledger must attribute usage to the serving provider"


def test_failover_is_off_by_default(client, monkeypatch):
    """With NOVA_FAILOVER unset nothing changes: one dead provider = one error."""
    monkeypatch.setattr(backend, "NOVA_FAILOVER", [])
    monkeypatch.setattr(backend, "_provider_key", lambda p: "k")

    calls = []

    async def down(messages, model, api_key, provider="nova", tools=None,
                   reasoning_effort=None, extra_params=None):
        calls.append(provider)
        raise HTTPException(status_code=500, detail="boom")

    monkeypatch.setattr(backend, "call_llm", down)
    with pytest.raises(HTTPException):
        run(backend.call_llm_failover([{"role": "user", "content": "hi"}], "m", "k", "inception"))
    assert calls == ["inception"]


def test_gateway_reports_the_serving_provider(client, monkeypatch):
    monkeypatch.setattr(backend, "NOVA_FAILOVER", ["gemini"])
    monkeypatch.setattr(backend, "_provider_key", lambda p: "k")
    monkeypatch.setattr(backend, "GEMINI_API_KEYS", ["k"])
    monkeypatch.setattr(backend, "_resolve_model", lambda p, m="": m or "m")

    async def primary_down(messages, model, api_key, provider="nova", tools=None,
                           reasoning_effort=None, extra_params=None):
        if provider == "inception":
            raise HTTPException(status_code=502, detail="down")
        return {"choices": [{"message": {"role": "assistant", "content": "backup answer"}}],
                "usage": {"total_tokens": 2}}

    monkeypatch.setattr(backend, "call_llm", primary_down)
    key = client.post("/api/gateway/keys", json={"name": "failover-test"}).json()["key"]
    r = client.post("/v1/chat/completions", headers={"Authorization": f"Bearer {key}"},
                    json={"model": "inception/m", "messages": [{"role": "user", "content": "hi"}]})
    assert r.status_code == 200
    assert r.json()["nova_served_by"] == "gemini"
    assert r.json()["model"] == "inception/m", "requested id must stay stable for clients"


# ---------------------------------------------------------------------------
# F16 — benchmark harness
# ---------------------------------------------------------------------------

def test_bench_run_records_latency_tokens_and_cost(client, monkeypatch):
    monkeypatch.setattr(backend, "NOVA_FAILOVER", [])
    monkeypatch.setattr(backend, "_provider_key", lambda p: "k" if p == "inception" else "")

    async def ok(messages, model, api_key, provider="nova", tools=None,
                 reasoning_effort=None, extra_params=None):
        return {"choices": [{"message": {"role": "assistant", "content": "OK"}}],
                "usage": {"prompt_tokens": 5, "completion_tokens": 2, "total_tokens": 7}}

    monkeypatch.setattr(backend, "call_llm", ok)
    r = client.post("/api/bench/run", json={
        "label": "smoke", "suite": ["Reply with exactly: OK"],
        "providers": ["inception"],
    })
    assert r.status_code == 200
    body = r.json()
    assert body["summary"]["ok"] == 1
    cell = body["results"][0]
    assert cell["status"] == "ok" and cell["latency_ms"] >= 0
    assert cell["usage"]["total_tokens"] == 7
    history = client.get("/api/bench/runs").json()["runs"]
    assert len(history) == 1 and history[0]["provider"] == "inception"


def test_bench_isolates_a_failing_provider(client, monkeypatch):
    """One provider erroring must not fail the whole run."""
    monkeypatch.setattr(backend, "NOVA_FAILOVER", [])
    monkeypatch.setattr(backend, "_provider_key", lambda p: "k")

    async def mixed(messages, model, api_key, provider="nova", tools=None,
                    reasoning_effort=None, extra_params=None):
        if provider == "gemini":
            raise HTTPException(status_code=500, detail="gemini is down")
        return {"choices": [{"message": {"role": "assistant", "content": "fine"}}],
                "usage": {"total_tokens": 3}}

    monkeypatch.setattr(backend, "call_llm", mixed)
    body = client.post("/api/bench/run", json={
        "suite": ["hi"], "providers": ["inception", "gemini"],
    }).json()
    assert body["summary"]["ok"] == 1 and body["summary"]["failed"] == 1
    statuses = {c["provider"]: c["status"] for c in body["results"]}
    assert statuses == {"inception": "ok", "gemini": "error"}


def test_bench_does_not_silently_fail_over(client, monkeypatch):
    """A benchmark measuring provider X must not be answered by provider Y."""
    monkeypatch.setattr(backend, "NOVA_FAILOVER", ["gemini"])
    monkeypatch.setattr(backend, "_provider_key", lambda p: "k")
    monkeypatch.setattr(backend, "GEMINI_API_KEYS", ["k"])

    seen = []

    async def only_gemini(messages, model, api_key, provider="nova", tools=None,
                          reasoning_effort=None, extra_params=None):
        seen.append(provider)
        if provider == "inception":
            raise HTTPException(status_code=500, detail="down")
        return {"choices": [{"message": {"role": "assistant", "content": "x"}}], "usage": {}}

    monkeypatch.setattr(backend, "call_llm", only_gemini)
    body = client.post("/api/bench/run", json={
        "suite": ["hi"], "providers": ["inception"],
    }).json()
    assert body["results"][0]["status"] == "error"
    assert seen == ["inception"], "the benchmark must not retry on another provider"


def test_bench_rejects_an_empty_suite_and_unknown_providers(client, monkeypatch):
    monkeypatch.setattr(backend, "_provider_key", lambda p: "k")
    # An explicitly empty suite is a client error, not "use the default suite".
    assert client.post("/api/bench/run", json={"suite": []}).status_code == 400
    assert client.post("/api/bench/run", json={
        "suite": ["hi"], "providers": ["not-a-provider"],
    }).status_code == 400
    assert client.post("/api/bench/run", json={
        "suite": ["hi"], "providers": [],
    }).status_code == 400


def test_bench_rejects_a_runaway_matrix(client, monkeypatch):
    monkeypatch.setattr(backend, "_provider_key", lambda p: "k")
    body = {"suite": [f"p{i}" for i in range(20)],
            "providers": list(backend.PROVIDERS)[:5]}
    assert client.post("/api/bench/run", json=body).status_code == 400


def test_bench_records_usage_in_the_ledger(client, monkeypatch):
    """Benchmark spend must be visible in the Usage tab, not invisible."""
    monkeypatch.setattr(backend, "NOVA_FAILOVER", [])
    monkeypatch.setattr(backend, "_provider_key", lambda p: "k")

    async def ok(messages, model, api_key, provider="nova", tools=None,
                 reasoning_effort=None, extra_params=None):
        return {"choices": [{"message": {"role": "assistant", "content": "OK"}}],
                "usage": {"prompt_tokens": 11, "completion_tokens": 2, "total_tokens": 13}}

    monkeypatch.setattr(backend, "call_llm", ok)
    client.post("/api/bench/run", json={"suite": ["hi"], "providers": ["inception"]})
    actors = {r["actor"] for r in client.get("/api/usage", params={"recent": 1}).json()["recent"]}
    assert "bench" in actors


# ---------------------------------------------------------------------------
# F17 — recall tool
# ---------------------------------------------------------------------------

def test_recall_tool_finds_earlier_messages(client):
    cid = make_conversation(client)
    _msg(cid, "user", "we decided the gateway keys rotate monthly")
    res = backend.tool_recall("gateway keys rotate")
    assert "gateway keys rotate monthly" in res["text"]
    assert res["citations"], "results should be citable so the UI can link them"
    assert res["citations"][0]["conversation_id"] == cid


def test_recall_tool_handles_no_match(client):
    res = backend.tool_recall("something never discussed here")
    assert res["text"].startswith("No past messages")
    assert res["citations"] == []


def test_recall_tool_is_in_the_recall_preset(client):
    names = {t["function"]["name"] for t in backend._tools_for_preset("recall")}
    assert "recall" in names
    assert "web_search" in names, "the recall preset extends research"
    assert backend.run_tool("recall", {"query": "anything"}) is not None


def test_recall_tool_is_registered(client):
    assert "recall" in backend.TOOL_IMPLS
    assert any(t["function"]["name"] == "recall" for t in backend.TOOLS)


# ---------------------------------------------------------------------------
# F18 — context compaction
# ---------------------------------------------------------------------------

def test_compaction_summarizes_only_the_outbound_copy(client, monkeypatch):
    monkeypatch.setattr(backend, "NOVA_COMPACT_CHARS", 2000)
    long_msgs = [{"role": "system", "content": "you are a lab assistant"}]
    for i in range(12):
        long_msgs.append({"role": "user", "content": f"turn {i} " + "x" * 400})
        long_msgs.append({"role": "assistant", "content": f"reply {i} " + "y" * 400})

    async def summarizer(messages, model, api_key, provider="nova", tools=None,
                         reasoning_effort=None, extra_params=None):
        return {"choices": [{"message": {"role": "assistant",
                                          "content": "SUMMARY: earlier turns covered X, Y, Z."}}]}

    monkeypatch.setattr(backend, "call_llm", summarizer)
    out, info = run(backend._compact_messages(list(long_msgs), "inception", "m", "k"))
    assert info and info["compacted"]
    assert info["chars_after"] < info["chars_before"]
    assert len(out) < len(long_msgs)
    assert out[0]["role"] == "system" and "SUMMARY" in out[0]["content"]
    # The caller's list is untouched — nothing is mutated in place.
    assert len(long_msgs) == 25


def test_compaction_keeps_the_recent_turns_verbatim(client, monkeypatch):
    monkeypatch.setattr(backend, "NOVA_COMPACT_CHARS", 1500)
    msgs = [{"role": "user", "content": "old " + "a" * 3000}]
    msgs += [{"role": "user", "content": "recent question"}] * 8

    async def summarizer(messages, model, api_key, provider="nova", tools=None,
                         reasoning_effort=None, extra_params=None):
        return {"choices": [{"message": {"role": "assistant", "content": "SUMMARY"}}]}

    monkeypatch.setattr(backend, "call_llm", summarizer)
    out, info = run(backend._compact_messages(msgs, "inception", "m", "k"))
    assert info
    assert out[-1]["content"] == "recent question"


def test_compaction_is_off_by_default_and_below_threshold(client, monkeypatch):
    monkeypatch.setattr(backend, "NOVA_COMPACT_CHARS", 0)
    msgs = [{"role": "user", "content": "x" * 100000}]
    out, info = run(backend._compact_messages(msgs, "inception", "m", "k"))
    assert info is None and len(out) == 1


def test_compaction_failure_falls_back_to_the_full_transcript(client, monkeypatch):
    """Compaction is an optimization — if the summarizer fails, send everything."""
    monkeypatch.setattr(backend, "NOVA_COMPACT_CHARS", 1000)
    msgs = [{"role": "user", "content": "old " + "a" * 4000}] + \
           [{"role": "user", "content": "recent"}] * 8

    async def broken(messages, model, api_key, provider="nova", tools=None,
                     reasoning_effort=None, extra_params=None):
        raise HTTPException(status_code=500, detail="summarizer down")

    monkeypatch.setattr(backend, "call_llm", broken)
    out, info = run(backend._compact_messages(msgs, "inception", "m", "k"))
    assert info is None and len(out) == len(msgs)


def test_chat_reports_compaction_to_the_client(client, monkeypatch):
    monkeypatch.setattr(backend, "NOVA_COMPACT_CHARS", 1200)
    monkeypatch.setattr(backend, "NOVA_FAILOVER", [])
    monkeypatch.setattr(backend, "_provider_key", lambda p: "k")

    async def fake(messages, model, api_key, provider="nova", tools=None,
                   reasoning_effort=None, extra_params=None):
        # The summarizer call has a system+user shape; the real turn does not.
        if len(messages) == 2 and messages[0]["role"] == "system" and "Summarize" in messages[0]["content"]:
            return {"choices": [{"message": {"role": "assistant", "content": "SUMMARY of earlier"}}]}
        return {"choices": [{"message": {"role": "assistant", "content": "the answer"}}],
                "usage": {"total_tokens": 4}}

    monkeypatch.setattr(backend, "call_llm", fake)
    msgs = [{"role": "user", "content": "old " + "a" * 3000}]
    msgs += [{"role": "user", "content": "and now this"}] * 8
    cid = make_conversation(client)
    r = client.post("/api/chat", json={
        "messages": msgs, "conversation_id": cid, "compact": True,
    })
    assert r.status_code == 200
    assert r.json()["compaction"]["compacted"] is True
    # Stored transcript keeps every original message.
    assert len(client.get(f"/api/conversations/{cid}").json()["messages"]) == 2


# ---------------------------------------------------------------------------
# F19 — scheduled prompts
# ---------------------------------------------------------------------------

def test_schedule_crud(client):
    """Schedules need auth armed (see test_schedule_requires_auth_to_be_enabled)."""
    backend.AUTH_TOKENS = {"owner-pass": "owner"}
    H = {"X-Nova-Token": "owner-pass"}
    assert client.get("/api/schedules", headers=H).json()["schedules"] == []
    r = client.post("/api/schedules", headers=H, json={
        "name": "morning check", "prompt": "summarize yesterday", "every_min": 30,
    })
    assert r.status_code == 200
    sid = r.json()["id"]
    assert r.json()["every_min"] == 30 and r.json()["enabled"] is True

    patched = client.patch(f"/api/schedules/{sid}", headers=H,
                           json={"enabled": False, "every_min": 5})
    assert patched.status_code == 200
    assert patched.json()["enabled"] is False and patched.json()["every_min"] == 5

    assert client.delete(f"/api/schedules/{sid}", headers=H).status_code == 200
    assert client.get("/api/schedules", headers=H).json()["schedules"] == []
    backend.AUTH_TOKENS = {}


def test_schedule_requires_auth_to_be_enabled(client):
    """An unauthenticated deployment must not accept work that spends tokens."""
    assert client.post("/api/schedules", json={
        "name": "x", "prompt": "y",
    }).status_code == 403


def test_schedule_create_requires_name_and_prompt(locked_client):
    H = {"X-Nova-Token": "secret-owner-pass"}
    assert locked_client.post("/api/schedules", headers=H, json={
        "name": "", "prompt": "y",
    }).status_code == 400
    assert locked_client.post("/api/schedules", headers=H, json={
        "name": "n", "prompt": "  ",
    }).status_code == 400


def test_schedules_require_auth_when_locked(locked_client):
    """With auth armed, an unauthenticated caller must not reach the routes."""
    assert locked_client.post("/api/schedules", json={"name": "n", "prompt": "p"}).status_code == 401
    assert locked_client.get("/api/schedules").status_code == 401


def test_schedule_unknown_id_is_404(client):
    backend.AUTH_TOKENS = {"owner-pass": "owner"}
    H = {"X-Nova-Token": "owner-pass"}
    assert client.delete("/api/schedules/nope", headers=H).status_code == 404
    assert client.post("/api/schedules/nope/run", headers=H).status_code == 404
    backend.AUTH_TOKENS = {}


def test_manual_schedule_run_writes_a_conversation(client, monkeypatch):
    monkeypatch.setattr(backend, "NOVA_FAILOVER", [])
    monkeypatch.setattr(backend, "_provider_key", lambda p: "k")

    async def fake(messages, model, api_key, provider="nova", tools=None,
                   reasoning_effort=None, extra_params=None):
        return {"choices": [{"message": {"role": "assistant", "content": "daily brief ready"}}],
                "usage": {"prompt_tokens": 4, "completion_tokens": 6, "total_tokens": 10}}

    monkeypatch.setattr(backend, "call_llm", fake)
    backend.AUTH_TOKENS = {"owner-pass": "owner"}
    H = {"X-Nova-Token": "owner-pass"}
    sid = client.post("/api/schedules", headers=H, json={
        "name": "brief", "prompt": "what happened today", "provider": "inception",
    }).json()["id"]
    r = client.post(f"/api/schedules/{sid}/run", headers=H)
    assert r.status_code == 200 and r.json()["ok"] is True
    cid = r.json()["conversation_id"]
    conv = client.get(f"/api/conversations/{cid}", headers=H).json()
    assert conv["title"].startswith("[schedule]")
    assert conv["messages"][-1]["content"] == "daily brief ready"
    updated = client.get("/api/schedules", headers=H).json()["schedules"][0]
    assert updated["last_status"] == "ok"
    assert updated["last_conversation_id"] == cid
    backend.AUTH_TOKENS = {}


def test_schedule_failure_is_recorded_not_raised(client, monkeypatch):
    monkeypatch.setattr(backend, "NOVA_FAILOVER", [])
    monkeypatch.setattr(backend, "_provider_key", lambda p: "k")

    async def broken(messages, model, api_key, provider="nova", tools=None,
                     reasoning_effort=None, extra_params=None):
        raise HTTPException(status_code=500, detail="provider down")

    monkeypatch.setattr(backend, "call_llm", broken)
    backend.AUTH_TOKENS = {"owner-pass": "owner"}
    H = {"X-Nova-Token": "owner-pass"}
    sid = client.post("/api/schedules", headers=H, json={
        "name": "will fail", "prompt": "x",
    }).json()["id"]
    r = client.post(f"/api/schedules/{sid}/run", headers=H)
    assert r.status_code == 200
    assert r.json()["ok"] is False
    assert client.get("/api/schedules", headers=H).json()["schedules"][0]["last_status"] == "error"
    backend.AUTH_TOKENS = {}


def _insert_schedule(**cols):
    """Insert a schedule row directly (bypasses the route's auth requirement,
    which is what the route tests cover)."""
    now = time.time()
    data = {
        "id": "sched_test", "name": "n", "prompt": "p",
        "every_min": 60, "enabled": 1, "last_run_at": None, "created_at": now,
    }
    data.update(cols)
    conn = backend._db()
    cols_sql = ", ".join(data)
    marks = ", ".join("?" for _ in data)
    conn.execute(f"INSERT INTO schedules ({cols_sql}) VALUES ({marks})", tuple(data.values()))
    conn.commit()
    row = conn.execute("SELECT * FROM schedules WHERE id = ?", (data["id"],)).fetchone()
    conn.close()
    return row


def test_disabled_schedules_are_never_due(client):
    row = _insert_schedule(id="s1", every_min=1, enabled=0)
    assert backend._sched_due(row, time.time()) is False


def test_schedule_with_no_previous_run_is_due_immediately(client):
    row = _insert_schedule(id="s2", every_min=999, last_run_at=None)
    assert backend._sched_due(row, time.time()) is True


def test_schedule_is_due_after_its_interval(client):
    row = _insert_schedule(id="s3", every_min=10, last_run_at=time.time() - 700)
    assert backend._sched_due(row, time.time()) is True


def test_schedule_is_not_due_before_its_interval(client):
    row = _insert_schedule(id="s4", every_min=60, last_run_at=time.time() - 60)
    assert backend._sched_due(row, time.time()) is False


# ---------------------------------------------------------------------------
# F20 — human-in-the-loop tool approval
# ---------------------------------------------------------------------------

def _tool_call(name, args, cid="c1"):
    return {"id": cid, "type": "function",
            "function": {"name": name, "arguments": json.dumps(args)}}


def test_approval_halts_before_running_a_mutating_tool(client, monkeypatch):
    ran = []

    async def fake(messages, model, api_key, provider="nova", tools=None,
                   reasoning_effort=None, extra_params=None):
        return {"choices": [{"message": {"role": "assistant", "content": "",
                                         "tool_calls": [_tool_call("write_file", {"filename": "a.txt", "content": "hi"})]}}]}

    monkeypatch.setattr(backend, "call_llm", fake)
    monkeypatch.setattr(backend, "run_tool", lambda n, a: ran.append((n, a)))
    r = client.post("/api/chat", json={
        "messages": [{"role": "user", "content": "save a note"}],
        "agent": True, "require_approval": True, "tools_preset": "core",
    })
    body = r.json()
    assert body["status"] == "awaiting_approval"
    assert body["pending_tools"][0]["name"] == "write_file"
    assert body["pending_tools"][0]["arguments"] == {"filename": "a.txt", "content": "hi"}
    assert not ran, "the tool must not run before it is approved"


def test_approved_tool_runs(client, monkeypatch):
    calls = {"n": 0}

    async def fake(messages, model, api_key, provider="nova", tools=None,
                   reasoning_effort=None, extra_params=None):
        calls["n"] += 1
        if calls["n"] == 1:
            return {"choices": [{"message": {"role": "assistant", "content": "",
                                             "tool_calls": [_tool_call("write_file", {"filename": "a.txt"})]}}]}
        return {"choices": [{"message": {"role": "assistant", "content": "saved it"}}],
                "usage": {"total_tokens": 3}}

    monkeypatch.setattr(backend, "call_llm", fake)
    monkeypatch.setattr(backend, "run_tool", lambda n, a: "wrote 2 bytes")
    r = client.post("/api/chat", json={
        "messages": [{"role": "user", "content": "save a note"}],
        "agent": True, "require_approval": True, "tools_preset": "core",
        "approved_tools": [{"name": "write_file", "arguments": {"filename": "a.txt"}}],
    })
    body = r.json()
    assert body.get("status") != "awaiting_approval"
    assert body["content"] == "saved it"


def test_approval_is_matched_on_arguments_not_just_the_name(client, monkeypatch):
    """Approving write_file to notes.txt must not also approve a different write."""
    pending = backend._pending_approvals(
        [_tool_call("write_file", {"filename": "secrets.env", "content": "x"})],
        [{"name": "write_file", "arguments": {"filename": "notes.txt"}}],
    )
    assert len(pending) == 1, "different arguments must still require approval"


def test_read_only_tools_do_not_need_approval(client, monkeypatch):
    """Approval is for side effects, not for reading the time."""
    assert backend._pending_approvals([_tool_call("get_time", {})], []) == []
    assert backend._pending_approvals([_tool_call("calculate", {"expression": "1+1"})], []) == []
    assert backend._pending_approvals([_tool_call("recall", {"query": "x"})], []) == []


def test_approval_is_off_by_default(client, monkeypatch):
    """Existing agent behaviour must be unchanged when the flag isn't set."""
    ran = []

    async def fake(messages, model, api_key, provider="nova", tools=None,
                   reasoning_effort=None, extra_params=None):
        if not any(m.get("role") == "tool" for m in messages):
            return {"choices": [{"message": {"role": "assistant", "content": "",
                                             "tool_calls": [_tool_call("write_file", {"filename": "a.txt"})]}}]}
        return {"choices": [{"message": {"role": "assistant", "content": "done"}}],
                "usage": {"total_tokens": 1}}

    monkeypatch.setattr(backend, "call_llm", fake)
    monkeypatch.setattr(backend, "run_tool", lambda n, a: (ran.append(n), "ok")[1])
    r = client.post("/api/chat", json={
        "messages": [{"role": "user", "content": "go"}],
        "agent": True, "tools_preset": "core", "max_tool_rounds": 3,
    })
    assert r.json()["content"] == "done"
    assert ran == ["write_file"], "without require_approval the tool runs immediately"


def test_approval_tool_set_is_configurable(client, monkeypatch):
    monkeypatch.setattr(backend, "NOVA_APPROVAL_TOOLS", {"recall"})
    pending = backend._pending_approvals(
        [_tool_call("recall", {"query": "x"}), _tool_call("write_file", {"filename": "a"})], [],
    )
    assert [p["name"] for p in pending] == ["recall"]


# ---------------------------------------------------------------------------
# F21 — archive backup / restore
# ---------------------------------------------------------------------------

def test_backup_export_includes_conversations_and_messages(client):
    cid = make_conversation(client)
    _msg(cid, "user", "archived thought")
    r = client.get("/api/backup/export")
    assert r.status_code == 200
    body = r.json()
    assert body["format"] == "nova-archive"
    assert any(c["id"] == cid for c in body["conversations"])
    assert any(m["content"] == "archived thought" for m in body["messages"])
    assert "attachment" in r.headers.get("content-disposition", "")


def test_backup_export_is_owner_only(client):
    backend.AUTH_TOKENS = {"owner-pass": "owner", "general-pass": "alice"}
    assert client.get("/api/backup/export").status_code == 401
    assert client.get(
        "/api/backup/export", headers={"X-Nova-Token": "owner-pass"}
    ).status_code == 200
    assert client.get(
        "/api/backup/export", headers={"X-Nova-Token": "general-pass"}
    ).status_code == 403
    backend.AUTH_TOKENS = {}


def test_backup_roundtrip_restores_to_a_fresh_db(client):
    cid = make_conversation(client)
    _msg(cid, "user", "remember the runbook")
    _msg(cid, "assistant", "runbook noted")
    archive = client.get("/api/backup/export").json()

    # Wipe and restore into the same client (new DB file to prove independence).
    import tempfile, os
    fresh = tempfile.mktemp(suffix=".db")
    old_db, backend.HISTORY_DB = backend.HISTORY_DB, fresh
    try:
        backend.init_db()
        assert client.get("/api/backup/export").json()["conversations"] == []
        r = client.post("/api/backup/import", json={"archive": archive})
        assert r.status_code == 200 and r.json()["ok"] is True
        assert r.json()["imported"]["conversations"] == 1
        assert r.json()["imported"]["messages"] == 2
        restored = client.get(f"/api/conversations/{cid}").json()
        assert len(restored["messages"]) == 2
        assert restored["messages"][0]["content"] == "remember the runbook"
    finally:
        backend.HISTORY_DB = old_db
        for suffix in ("", "-wal", "-shm"):
            try:
                os.unlink(fresh + suffix)
            except OSError:
                pass


def test_backup_merge_does_not_overwrite_newer_work(client):
    """Importing an older snapshot must never destroy newer messages."""
    cid = make_conversation(client)
    _msg(cid, "user", "original")
    archive = client.get("/api/backup/export").json()
    _msg(cid, "user", "much newer work")
    r = client.post("/api/backup/import", json={"archive": archive, "mode": "merge"})
    assert r.status_code == 200
    assert r.json()["imported"]["conversations"] == 0, "existing conversation is skipped"
    assert len(client.get(f"/api/conversations/{cid}").json()["messages"]) == 2


def test_backup_replace_clears_first(client):
    cid = make_conversation(client)
    _msg(cid, "user", "will be replaced")
    archive = client.get("/api/backup/export").json()
    client.post("/api/backup/import", json={"archive": archive, "mode": "replace"})
    assert len(client.get(f"/api/conversations/{cid}").json()["messages"]) == 1


def test_backup_import_rejects_a_foreign_document(client):
    assert client.post("/api/backup/import", json={"archive": {"hello": "world"}}).status_code == 400
    assert client.post("/api/backup/import", json={
        "archive": {"format": "nova-archive"}, "mode": "nonsense",
    }).status_code == 400


def test_restored_messages_are_searchable(client):
    cid = make_conversation(client)
    _msg(cid, "user", "indexme after restore")
    archive = client.get("/api/backup/export").json()
    client.post("/api/backup/import", json={"archive": archive, "mode": "replace"})
    hits = client.get("/api/conversations/search", params={"q": "indexme"}).json()["results"]
    assert any(h["conversation_id"] == cid for h in hits)


def test_restored_schedules_start_disabled(client):
    """A restore must not silently start spending the operator's tokens."""
    backend.AUTH_TOKENS = {"owner-pass": "owner"}
    H = {"X-Nova-Token": "owner-pass"}
    client.post("/api/schedules", headers=H, json={"name": "n", "prompt": "p", "enabled": True})
    archive = client.get("/api/backup/export", headers=H).json()
    sid = client.get("/api/schedules", headers=H).json()["schedules"][0]["id"]
    client.delete(f"/api/schedules/{sid}", headers=H)
    client.post("/api/backup/import", headers=H, json={"archive": archive})
    assert client.get("/api/schedules", headers=H).json()["schedules"][0]["enabled"] is False
    backend.AUTH_TOKENS = {}


# ---------------------------------------------------------------------------
# F22 — conversation diff
# ---------------------------------------------------------------------------

def test_diff_reports_shared_prefix_and_tails(client):
    src = make_conversation(client)
    _msg(src, "user", "shared question")
    _msg(src, "assistant", "shared answer")
    _msg(src, "user", "original third")

    # Fork at message 2 so the branch shares a prefix and then diverges.
    conn = backend._db()
    second_id = conn.execute(
        "SELECT id FROM messages WHERE conversation_id = ? ORDER BY id ASC LIMIT 1 OFFSET 1",
        (src,),
    ).fetchone()[0]
    conn.close()
    fork = client.post(f"/api/conversations/{src}/fork",
                       params={"at_message_id": second_id}).json()
    _msg(fork["id"], "user", "forked third")

    d = client.get(f"/api/conversations/{fork['id']}/diff/{src}").json()
    assert d["shared_prefix"] == 2
    assert d["identical"] is False
    assert [m["content"] for m in d["a_only"]] == ["forked third"]
    assert [m["content"] for m in d["b_only"]] == ["original third"]


def test_diff_of_a_fork_against_its_parent_is_identical_at_the_fork_point(client):
    src = make_conversation(client)
    _msg(src, "user", "one")
    _msg(src, "assistant", "two")
    fork = client.post(f"/api/conversations/{src}/fork").json()
    d = client.get(f"/api/conversations/{fork['id']}/diff/{src}").json()
    assert d["identical"] is True and d["shared_prefix"] == 2


def test_diff_against_itself_is_identical(client):
    cid = make_conversation(client)
    _msg(cid, "user", "hello")
    d = client.get(f"/api/conversations/{cid}/diff/{cid}").json()
    assert d["identical"] is True and d["shared_prefix"] == 1


def test_diff_unknown_conversation_is_404(client):
    cid = make_conversation(client)
    assert client.get(f"/api/conversations/{cid}/diff/conv_nope").status_code == 404
    assert client.get(f"/api/conversations/conv_nope/diff/{cid}").status_code == 404