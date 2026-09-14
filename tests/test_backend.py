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

    async def fake_call_llm(messages, model, api_key, provider="nova", tools=None, reasoning_effort=None, extra_params=None):
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
# inference gateway (/v1)
# ---------------------------------------------------------------------------

def _mint_key(client, name="test-client"):
    r = client.post("/api/gateway/keys", json={"name": name})
    assert r.status_code == 200
    return r.json()["key"]


def test_gateway_requires_key(client):
    assert client.get("/v1/models").status_code == 401
    assert client.post("/v1/chat/completions", json={"messages": []}).status_code == 401
    bad = client.get("/v1/models", headers={"Authorization": "Bearer sk-nova-wrong"})
    assert bad.status_code == 401


def test_gateway_key_crud_and_model_list(client):
    raw = _mint_key(client, "opencode")
    lst = client.get("/api/gateway/keys").json()["keys"]
    assert len(lst) == 1
    assert lst[0]["name"] == "opencode"
    assert lst[0]["prefix"].startswith("sk-nova-")
    assert raw not in json.dumps(lst)  # raw key is never listed back
    models = client.get("/v1/models", headers={"Authorization": f"Bearer {raw}"}).json()
    ids = [m["id"] for m in models["data"]]
    assert "inception/mercury-2" in ids
    assert "inception/auto" in ids
    assert "gemini/gemini-3.6-flash" in ids


def test_gateway_completion_records_usage_per_key(fake_provider, client):
    raw = _mint_key(client, "opencode")
    r = client.post("/v1/chat/completions",
        headers={"Authorization": f"Bearer {raw}"},
        json={"model": "inception/mercury-2",
              "messages": [{"role": "user", "content": "hi"}]})
    assert r.status_code == 200
    body = r.json()
    assert body["choices"][0]["message"]["content"] == "fake reply 1"
    assert body["model"] == "inception/mercury-2"
    # usage attributed to the gateway key's actor
    usage = client.get("/api/usage").json()
    assert usage["by_actor"][0]["actor"] == "gw:opencode"
    # per-key stats
    keys = client.get("/api/gateway/keys").json()["keys"]
    assert keys[0]["calls"] == 1
    assert keys[0]["total_tokens"] == 15


def test_gateway_model_routing(fake_provider, client):
    raw = _mint_key(client)
    r = client.post("/v1/chat/completions",
        headers={"Authorization": f"Bearer {raw}"},
        json={"model": "gemini/gemini-3.6-flash",
              "messages": [{"role": "user", "content": "hi"}]})
    assert r.status_code == 200
    # the fake captured the routed provider
    # (fake_provider fixture isn't used here — re-mint via its mechanism)
    r2 = client.post("/v1/chat/completions",
        headers={"Authorization": f"Bearer {raw}"},
        json={"model": "totally-unknown-model", "messages": [{"role": "user", "content": "hi"}]})
    assert r2.status_code == 200  # bare names resolve on the default provider


def test_gateway_revoke_disables_key(client):
    raw = _mint_key(client, "temp")
    prefix = raw[:14]
    assert client.delete(f"/api/gateway/keys/{prefix}").status_code == 200
    assert client.get("/v1/models", headers={"Authorization": f"Bearer {raw}"}).status_code == 401


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


# ---------------------------------------------------------------------------
# F1 cost estimate
# ---------------------------------------------------------------------------

def test_cost_usd_pricing():
    assert backend._cost_usd("nova", "nova-2-lite-v1", {"prompt_tokens": 100, "completion_tokens": 50}) == 0.018
    assert backend._cost_usd("ollama", "dolphin3.0:8b", {"prompt_tokens": 100, "completion_tokens": 50}) is None
    assert backend._cost_usd("nova", "nova-2-lite-v1", None) is None


# ---------------------------------------------------------------------------
# F3 folders / tags / pinned / archived  +  F4 per-chat persona override
# ---------------------------------------------------------------------------

def test_conversation_meta_folder_tags_persona(client):
    r = client.post("/api/conversations", json={
        "provider": "openai", "model": "gpt-4o",
        "folder": "research", "tags": ["a", "b"], "persona": "pers_abc",
    })
    assert r.status_code == 200
    conv = r.json()
    cid = conv["id"]
    assert conv["folder"] == "research"
    assert conv["tags"] == ["a", "b"]
    assert conv["persona_id"] == "pers_abc"
    assert conv["pinned"] is False and conv["archived"] is False

    got = client.get(f"/api/conversations/{cid}").json()
    assert got["folder"] == "research"
    assert got["tags"] == ["a", "b"]
    assert got["persona_id"] == "pers_abc"
    assert got["archived"] is False

    mine = [c for c in client.get("/api/conversations").json()["conversations"] if c["id"] == cid][0]
    assert mine["folder"] == "research" and mine["tags"] == ["a", "b"]
    assert mine["persona_id"] == "pers_abc"


def test_conversation_patch_meta_and_archive_filter(client):
    cid = client.post("/api/conversations", json={}).json()["id"]
    assert client.patch(f"/api/conversations/{cid}/meta", json={
        "pinned": True, "archived": True, "folder": "done", "tags": ["x"]
    }).status_code == 200
    got = client.get(f"/api/conversations/{cid}").json()
    assert got["pinned"] is True and got["archived"] is True
    assert got["folder"] == "done" and got["tags"] == ["x"]

    # archived conversations are hidden from the default list ...
    assert not any(c["id"] == cid for c in client.get("/api/conversations").json()["conversations"])
    # ... but present with ?archived=1
    assert any(c["id"] == cid for c in client.get("/api/conversations?archived=1").json()["conversations"])

    assert client.patch("/api/conversations/conv_doesnotexist/meta", json={"pinned": True}).status_code == 404


def test_conversation_tags_json_roundtrip(client):
    cid = client.post("/api/conversations", json={"tags": [], "folder": ""}).json()["id"]
    # empty tags parse to []
    assert client.get(f"/api/conversations/{cid}").json()["tags"] == []
    client.patch(f"/api/conversations/{cid}/meta", json={"tags": ["p3", "p4"]})
    assert client.get(f"/api/conversations/{cid}").json()["tags"] == ["p3", "p4"]


def test_conversation_tags_accept_csv_string(client):
    """A comma-separated string (or a bare string) must not be silently dropped —
    it should be coerced into a list of tags on create and on PATCH /meta."""
    # create with a CSV string
    cid = client.post(
        "/api/conversations",
        json={"title": "csv", "tags": "alpha, beta , gamma"},
    ).json()["id"]
    got = client.get(f"/api/conversations/{cid}").json()
    assert got["tags"] == ["alpha", "beta", "gamma"]

    # create with a single bare string (no comma)
    cid2 = client.post("/api/conversations", json={"title": "solo", "tags": "only"}).json()["id"]
    assert client.get(f"/api/conversations/{cid2}").json()["tags"] == ["only"]

    # PATCH accepts a CSV string too
    client.patch(f"/api/conversations/{cid}/meta", json={"tags": "delta, epsilon"})
    assert client.get(f"/api/conversations/{cid}").json()["tags"] == ["delta", "epsilon"]

    # None / empty string still normalize to []
    client.patch(f"/api/conversations/{cid}/meta", json={"tags": ""})
    assert client.get(f"/api/conversations/{cid}").json()["tags"] == []

    # lists still work as before
    client.patch(f"/api/conversations/{cid}/meta", json={"tags": ["zeta", "eta"]})
    assert client.get(f"/api/conversations/{cid}").json()["tags"] == ["zeta", "eta"]


# ---------------------------------------------------------------------------
# F6 conversation export
# ---------------------------------------------------------------------------

def test_export_conversation_markdown_and_json(fake_provider, client):
    cid = make_conversation(client)
    client.post("/api/chat", json={"messages": [{"role": "user", "content": "hello world"}], "conversation_id": cid})
    md = client.get(f"/api/conversations/{cid}/export?fmt=md")
    assert md.status_code == 200
    assert md.headers["content-type"].startswith("text/markdown")
    assert "# " in md.text and "hello world" in md.text
    js = client.get(f"/api/conversations/{cid}/export?fmt=json")
    assert js.status_code == 200
    data = js.json()
    assert data["id"] == cid
    assert any(m["role"] == "user" and m["content"] == "hello world" for m in data["messages"])
    assert client.get("/api/conversations/conv_nope/export").status_code == 404


# ---------------------------------------------------------------------------
# F7 structured web_search + citations attached to the agent response
# ---------------------------------------------------------------------------

def test_web_search_returns_structured_citations(monkeypatch):
    monkeypatch.setattr(backend, "YOU_API_KEY", "fake-key")

    class FakeResp:
        status_code = 200

        def json(self):
            return {"hits": [
                {"title": "Nova Docs", "url": "https://nova.example/docs", "snippets": ["A page about Nova."]}
            ]}

    monkeypatch.setattr(backend.httpx, "get", lambda *a, **k: FakeResp())
    res = backend.tool_web_search("nova chat")
    assert isinstance(res, dict)
    assert res["citations"] == [{"title": "Nova Docs", "url": "https://nova.example/docs", "snippet": "A page about Nova."}]
    assert "Nova Docs" in res["text"]
    assert "https://nova.example/docs" in res["text"]


def test_agent_chat_attaches_citations(client, monkeypatch):
    state = {"turn": 0}

    async def fake_call_llm(messages, model, api_key, provider="nova", tools=None,
                            reasoning_effort=None, extra_params=None):
        state["turn"] += 1
        if state["turn"] == 1:
            return {"id": "cm-1", "model": model, "choices": [{"message": {
                "role": "assistant", "content": "",
                "tool_calls": [{"id": "t1", "type": "function", "function": {
                    "name": "web_search", "arguments": json.dumps({"query": "nova chat"})
                }}],
            }}]}
        return {"id": "cm-2", "model": model,
                "choices": [{"message": {"role": "assistant", "content": "Nova is a chat app."}}]}

    monkeypatch.setattr(backend, "call_llm", fake_call_llm)
    monkeypatch.setitem(backend.TOOL_IMPLS, "web_search",
                        lambda query, max_results=5: {
                            "text": "Nova docs result",
                            "citations": [{"title": "Nova", "url": "https://nova.example", "snippet": "docs"}]})
    r = client.post("/api/chat", json={
        "messages": [{"role": "user", "content": "tell me about nova"}],
        "provider": "openai", "model": "gpt-4o", "agent": True,
        "api_key": "fake", "max_tool_rounds": 5,
    })
    assert r.status_code == 200
    body = r.json()
    assert body["agent"] is True
    assert body["content"] == "Nova is a chat app."
    assert body["citations"] == [{"title": "Nova", "url": "https://nova.example", "snippet": "docs"}]
    assert any(t["type"] == "tool" and t["name"] == "web_search" for t in body["trace"])


# ---------------------------------------------------------------------------
# F7b agent workspace: write_file / list_workspace with path containment
# ---------------------------------------------------------------------------

def test_workspace_write_list_and_containment(tmp_path, monkeypatch):
    monkeypatch.setattr(backend, "WORKSPACE_ROOT", tmp_path)
    assert "Wrote" in backend.tool_write_file("notes.txt", "hello workspace")
    assert "notes.txt" in backend.tool_list_workspace()
    # path-traversal escapes are rejected (realpath, not prefix) ...
    assert backend.tool_write_file("../../etc/evil.txt", "pwned").startswith("Access denied")
    # ... and absolute paths outside the workspace too.
    assert backend.tool_write_file("/etc/passwd", "x").startswith("Access denied")


# ---------------------------------------------------------------------------
# F8 custom personas CRUD + owner gating
# ---------------------------------------------------------------------------

def test_personas_crud(client):
    assert client.get("/api/personas").json()["personas"] == []
    r = client.post("/api/personas", json={"name": "Coder", "system_prompt": "You are helpful."})
    assert r.status_code == 200
    pid = r.json()["id"]
    ps = client.get("/api/personas").json()["personas"]
    assert any(p["id"] == pid and p["name"] == "Coder" and p["system_prompt"] == "You are helpful." for p in ps)
    assert client.put(f"/api/personas/{pid}", json={"name": "Coder2", "system_prompt": "updated"}).status_code == 200
    assert client.get("/api/personas").json()["personas"][0]["name"] == "Coder2"
    assert client.delete(f"/api/personas/{pid}").status_code == 200
    assert not any(p["id"] == pid for p in client.get("/api/personas").json()["personas"])
    assert client.put("/api/personas/nope", json={"name": "x"}).status_code == 404
    assert client.delete("/api/personas/nope").status_code == 404


def test_personas_owner_gate_when_locked(locked_client):
    # unauthenticated -> 401 (auth middleware) ...
    assert locked_client.post("/api/personas", json={"name": "x", "system_prompt": "y"}).status_code == 401
    # ... owned once logged in.
    assert locked_client.post("/api/auth/login", json={"passphrase": "secret-owner-pass"}).status_code == 200
    r = locked_client.post("/api/personas", json={"name": "x", "system_prompt": "y"})
    assert r.status_code == 200
    assert "id" in r.json()


# ---------------------------------------------------------------------------
# F5 gateway key scopes + per-key rate limit (429)
# ---------------------------------------------------------------------------

def test_gateway_key_scopes_and_quota(fake_provider, client):
    r = client.post("/api/gateway/keys", json={
        "name": "scoped", "scope": "inception",
        "daily_quota_tokens": 1000, "rate_limit_per_min": 2,
    })
    assert r.status_code == 200
    raw = r.json()["key"]
    keys = client.get("/api/gateway/keys").json()["keys"]
    sk = next(k for k in keys if k["name"] == "scoped")
    assert sk["scope"] == "inception" and sk["daily_quota_tokens"] == 1000 and sk["rate_limit_per_min"] == 2

    h = {"Authorization": f"Bearer {raw}"}
    b = {"model": "gemini/gemini-3.6-flash", "messages": [{"role": "user", "content": "hi"}]}
    assert client.post("/v1/chat/completions", headers=h, json=b).status_code == 403  # out of scope

    ok = client.post("/v1/chat/completions", headers=h, json={
        "model": "inception/mercury-2", "messages": [{"role": "user", "content": "hi"}]})
    assert ok.status_code == 200
    assert ok.json()["choices"][0]["message"]["content"] == "fake reply 1"


def test_gateway_rate_limit_429(fake_provider, client, monkeypatch):
    monkeypatch.setattr(backend, "_ACTOR_HITS", {})
    r = client.post("/api/gateway/keys", json={"name": "rl", "rate_limit_per_min": 1})
    raw = r.json()["key"]
    h = {"Authorization": f"Bearer {raw}"}
    b = {"model": "inception/mercury-2", "messages": [{"role": "user", "content": "hi"}]}
    assert client.post("/v1/chat/completions", headers=h, json=b).status_code == 200
    over = client.post("/v1/chat/completions", headers=h, json=b)
    assert over.status_code == 429


# ---------------------------------------------------------------------------
# F10 doc-as-context attach
# ---------------------------------------------------------------------------

def test_attach_extracts_text(client):
    from io import BytesIO
    r = client.post("/api/attach", files={"file": ("notes.txt", BytesIO(b"hello attach world"), "text/plain")})
    assert r.status_code == 200
    body = r.json()
    assert body["filename"] == "notes.txt"
    assert "hello attach world" in body["content"]


def test_attach_rejects_oversize(client, monkeypatch):
    monkeypatch.setattr(backend, "NOVA_MAX_UPLOAD_MB", 0)
    from io import BytesIO
    r = client.post("/api/attach", files={"file": ("big.txt", BytesIO(b"x" * 1024), "text/plain")})
    assert r.status_code == 413


# ---------------------------------------------------------------------------
# Infron (ONE router) provider wiring
# ---------------------------------------------------------------------------
def test_infron_provider_wiring(client):
    """infron is exposed in the model catalog + health, resolves through the
    gateway model parser, and 400s cleanly when its key is unconfigured."""
    models = client.get("/api/models").json()
    prov = models["providers"]["infron"]
    assert prov["label"] == "Infron (ONE router)"
    assert prov["models"] == ["qwen/qwen3.8-27b:free"]
    assert prov["default"] == "qwen/qwen3.8-27b:free"

    # /api/health also surfaces the provider namespace
    assert "infron" in client.get("/api/health").json()["providers"]

    # gateway "provider/model" parsing resolves the new namespace
    assert backend._parse_gateway_model("infron/qwen/qwen3.8-27b:free") == ("infron", "qwen/qwen3.8-27b:free")
    # bare model (no provider/) resolves on the default provider, not infrar
    assert backend._parse_gateway_model("qwen/qwen3.8-27b:free")[0] == backend.DEFAULT_PROVIDER

    # without INFRON_API_KEY configured, /api/chat 400s with a key error
    r = client.post("/api/chat", json={
        "provider": "infron", "model": "qwen/qwen3.8-27b:free",
        "messages": [{"role": "user", "content": "hi"}],
    })
    assert r.status_code == 400
    assert "Infron" in r.json()["detail"]
