"""Stability tests for the Nova backend: auth, sandbox containment, safe
calculate, regenerate history replacement, usage ledger attribution, and
conversation pagination. Provider calls are faked — no network needed.
"""
import json
import time

import pytest

import backend


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def fake_llm_response(content="ok"):
    return {
        "id": "chatcmpl-test",
        "model": "test-model",
        "choices": [{"message": {"role": "assistant", "content": content}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
    }


@pytest.fixture()
def fake_provider(monkeypatch):
    """Replace call_llm with a deterministic fake (records its inputs)."""
    calls = []

    async def fake_call_llm(messages, model, api_key, provider="nova", tools=None, reasoning_effort=None):
        calls.append({"messages": [dict(m) for m in messages], "provider": provider, "tools": tools})
        return fake_llm_response(f"fake reply {len(calls)}")

    monkeypatch.setattr(backend, "call_llm", fake_call_llm)
    return calls


def make_conversation(client):
    return client.post("/api/conversations", json={}).json()["id"]


# ---------------------------------------------------------------------------
# auth
# ---------------------------------------------------------------------------

def test_health_is_public(locked_client):
    assert locked_client.get("/api/health").status_code == 200


def test_api_locked_without_credentials(locked_client):
    assert locked_client.get("/api/models").status_code == 401
    assert locked_client.get("/api/conversations").status_code == 401
    assert locked_client.post("/api/chat", json={"messages": []}).status_code == 401


def test_login_sets_cookie_and_unlocks(locked_client):
    r = locked_client.post("/api/auth/login", json={"passphrase": "secret-owner-pass"})
    assert r.status_code == 200
    assert r.json()["actor"] == "owner"
    assert locked_client.get("/api/models").status_code == 200


def test_wrong_passphrase_rejected(locked_client):
    r = locked_client.post("/api/auth/login", json={"passphrase": "nope"})
    assert r.status_code == 401
    assert locked_client.get("/api/models").status_code == 401


def test_header_token_works_for_scripts(locked_client):
    r = locked_client.get("/api/models", headers={"X-Nova-Token": "secret-owner-pass"})
    assert r.status_code == 200
    bad = locked_client.get("/api/models", headers={"X-Nova-Token": "wrong"})
    assert bad.status_code == 401


def test_auth_disabled_when_unset(client):
    # conftest clears NOVA_AUTH_PASSPHRASE -> everything open
    assert client.get("/api/models").status_code == 200


# ---------------------------------------------------------------------------
# tools: sandbox containment + safe calculate
# ---------------------------------------------------------------------------

def test_read_file_confined_to_sandbox(tmp_path, monkeypatch):
    monkeypatch.setattr(backend, "SANDBOX_ROOT", tmp_path)
    (tmp_path / "hello.txt").write_text("hello world")
    # inside the sandbox: fine
    assert "hello world" in backend.tool_read_file("hello.txt")
    # traversal attempts: blocked
    assert "denied" in backend.tool_read_file("../../etc/passwd")
    assert "denied" in backend.tool_read_file(f"{tmp_path}/../outside.txt")
    # missing file: clean message, no crash
    assert "not found" in backend.tool_read_file("nope.txt").lower()


def test_calculate_allows_math_only():
    assert backend.tool_calculate("(2 + 3) * 4") == "20"
    assert backend.tool_calculate("2 ** 8") == "256"
    for evil in ["__import__('os').system('true')", "open('/etc/passwd')", "().__class__"]:
        out = backend.tool_calculate(evil)
        assert "Could not evaluate" in out or "Invalid" in out


# ---------------------------------------------------------------------------
# chat + regenerate
# ---------------------------------------------------------------------------

def test_chat_persists_turn(fake_provider, client):
    cid = make_conversation(client)
    r = client.post("/api/chat", json={
        "messages": [{"role": "user", "content": "hello"}],
        "conversation_id": cid,
    })
    assert r.status_code == 200
    conv = client.get(f"/api/conversations/{cid}").json()
    assert [m["role"] for m in conv["messages"]] == ["user", "assistant"]
    assert conv["messages"][1]["content"] == "fake reply 1"
    # title auto-generated from first user message
    assert conv["title"].startswith("hello")


def test_regenerate_replaces_history(fake_provider, client):
    cid = make_conversation(client)
    client.post("/api/chat", json={
        "messages": [{"role": "user", "content": "say A"}], "conversation_id": cid,
    })
    r = client.post("/api/chat", json={
        "messages": [{"role": "user", "content": "say B instead"}],
        "conversation_id": cid, "regenerate": True,
    })
    assert r.status_code == 200
    conv = client.get(f"/api/conversations/{cid}").json()
    contents = [(m["role"], m["content"]) for m in conv["messages"]]
    assert contents == [("user", "say B instead"), ("assistant", "fake reply 2")]


def test_normal_send_appends_does_not_replace(fake_provider, client):
    cid = make_conversation(client)
    for text in ("one", "two"):
        client.post("/api/chat", json={
            "messages": [{"role": "user", "content": text}], "conversation_id": cid,
        })
    conv = client.get(f"/api/conversations/{cid}").json()
    assert len(conv["messages"]) == 4  # two full turns


def test_system_prompt_injected_once(fake_provider, client):
    cid = make_conversation(client)
    client.post("/api/chat", json={
        "messages": [{"role": "user", "content": "hi"}], "conversation_id": cid,
    })
    sent = fake_provider[0]["messages"]
    assert sent[0]["role"] == "system"
    assert sum(1 for m in sent if m["role"] == "system") == 1


def test_client_system_prompt_not_duplicated(fake_provider, client):
    cid = make_conversation(client)
    client.post("/api/chat", json={
        "messages": [
            {"role": "system", "content": "custom persona"},
            {"role": "user", "content": "hi"},
        ],
        "conversation_id": cid,
    })
    sent = fake_provider[0]["messages"]
    assert [m["content"] for m in sent if m["role"] == "system"] == ["custom persona"]


def test_stream_rejects_agent_mode(client):
    r = client.post("/api/chat/stream", json={
        "messages": [{"role": "user", "content": "hi"}], "agent": True,
    })
    assert r.status_code == 400


def test_call_llm_retries_without_tools_on_tool_400(monkeypatch):
    """Models that reject the tools parameter get a clean retry without them
    (web search degrades to a normal answer instead of erroring)."""
    import asyncio
    import httpx

    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        has_tools = "tools" in body
        seen.append(has_tools)
        if has_tools:
            return httpx.Response(400, json={"error": {"message": "tools is not supported by this model"}})
        return httpx.Response(200, json=fake_llm_response("answered without tools"))

    real_client = backend.httpx.AsyncClient

    def patched_client(**kw):
        kw["transport"] = httpx.MockTransport(handler)
        return real_client(**kw)

    monkeypatch.setattr(backend.httpx, "AsyncClient", patched_client)

    resp = asyncio.run(backend.call_llm(
        [{"role": "user", "content": "search something"}],
        "test-model", "k", "gemini", backend.TOOLS, None,
    ))
    assert resp["choices"][0]["message"]["content"] == "answered without tools"
    assert seen == [True, False]  # first with tools, then without


def test_empty_reply_after_tools_triggers_nudge(monkeypatch, client):
    """Gemini quirk: empty message right after tool results must trigger one
    nudge pass so the user gets the actual answer, not a blank bubble."""
    seq = [
        # round 1: model calls get_time
        {"choices": [{"message": {"role": "assistant", "content": "", "tool_calls": [
            {"id": "c1", "type": "function", "function": {"name": "get_time", "arguments": "{}"}},
        ]}}], "usage": {"prompt_tokens": 5, "completion_tokens": 2, "total_tokens": 7}},
        # round 2: model returns EMPTY content after the tool result
        {"choices": [{"message": {"role": "assistant", "content": ""}}], "usage": {}},
        # nudge pass: model finally answers
        {"choices": [{"message": {"role": "assistant", "content": "the actual answer"}}],
         "usage": {"prompt_tokens": 9, "completion_tokens": 3, "total_tokens": 12}},
    ]
    calls = []

    async def fake_llm(messages, model, api_key, provider="nova", tools=None, reasoning_effort=None):
        calls.append([dict(m) for m in messages])
        return seq[min(len(calls) - 1, len(seq) - 1)]

    monkeypatch.setattr(backend, "call_llm", fake_llm)
    cid = make_conversation(client)
    r = client.post("/api/chat", json={
        "messages": [{"role": "user", "content": "what time is it?"}],
        "conversation_id": cid, "agent": True, "max_tool_rounds": 3,
    })
    assert r.status_code == 200
    assert r.json()["content"] == "the actual answer"
    assert len(calls) == 3
    # the nudge message is the last user turn of the final call
    assert calls[2][-1]["content"].startswith("Answer now")


# ---------------------------------------------------------------------------
# usage ledger + actor attribution + pagination
# ---------------------------------------------------------------------------

def test_usage_ledger_and_actor(fake_provider, client):
    actor_rows = []

    orig_save = backend.db_save_message

    def save_with_actor(*a, **kw):
        kw["actor"] = "alice"  # simulate a named-token request
        actor_rows.append(kw["actor"])
        return orig_save(*a, **kw)

    backend.db_save_message = save_with_actor
    try:
        cid = make_conversation(client)
        client.post("/api/chat", json={
            "messages": [{"role": "user", "content": "hello"}], "conversation_id": cid,
        })
    finally:
        backend.db_save_message = orig_save

    usage = client.get("/api/usage").json()
    assert usage["total"]["total_tokens"] == 15
    assert usage["total"]["calls"] == 1
    assert len(usage["by_model"]) == 1 and usage["by_model"][0]["calls"] == 1
    assert usage["by_actor"] and usage["by_actor"][0]["actor"] == "alice"


def test_conversation_pagination(fake_provider, client):
    cid = make_conversation(client)
    for i in range(6):
        client.post("/api/chat", json={
            "messages": [{"role": "user", "content": f"msg {i}"}], "conversation_id": cid,
        })
    full = client.get(f"/api/conversations/{cid}").json()
    assert len(full["messages"]) == 12

    page = client.get(f"/api/conversations/{cid}?last=4").json()
    assert page["total_messages"] == 12
    assert page["has_more"] is True
    assert len(page["messages"]) == 4
    # returns the LAST 4 messages, oldest-first within the page:
    # [user msg 4, fake reply 5, user msg 5, fake reply 6]
    assert (page["messages"][0]["role"], page["messages"][0]["content"]) == ("user", "msg 4")
    assert page["messages"][1]["content"] == "fake reply 5"
    assert page["messages"][-1]["content"] == "fake reply 6"

    page2 = client.get(f"/api/conversations/{cid}?last=999").json()
    assert page2["has_more"] is False
    assert len(page2["messages"]) == 12


# ---------------------------------------------------------------------------
# misc endpoint sanity
# ---------------------------------------------------------------------------

def test_conversation_crud(fake_provider, client):
    cid = make_conversation(client)
    r = client.put(f"/api/conversations/{cid}", json={"title": "renamed"})
    assert r.status_code == 200
    assert client.get(f"/api/conversations/{cid}").json()["title"] == "renamed"
    assert client.delete(f"/api/conversations/{cid}").status_code == 200
    assert client.get(f"/api/conversations/{cid}").status_code == 404
