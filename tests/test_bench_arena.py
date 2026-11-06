"""Graded Benchmark Arena: suites, deterministic checks, judge parsing, leaderboard,
and the async job flow (providers faked - no network)."""
import time

import pytest
from fastapi import HTTPException

import backend
import bench_suites as bs


# ---------------------------------------------------------------------------
# pure helpers
# ---------------------------------------------------------------------------

def test_extract_json_handles_fences_prose_and_nesting():
    assert bs.extract_json('{"a": 1}') == {"a": 1}
    assert bs.extract_json('Sure!\n```json\n{"a": {"b": [1, 2]}}\n```') == {"a": {"b": [1, 2]}}
    assert bs.extract_json('Result: {"x": "}", "y": 2} trailing') == {"x": "}", "y": 2}
    assert bs.extract_json("no json here") is None


def test_checks_cover_each_type():
    j = '{"verdict": "true_positive", "severity": 72, "ips": ["203.0.113.77"]}'
    assert bs.run_check(j, {"type": "json_valid"})
    assert bs.run_check(j, {"type": "json_field", "path": "verdict", "in": ["true_positive"]})
    assert not bs.run_check(j, {"type": "json_field", "path": "verdict", "in": ["false_positive"]})
    assert bs.run_check(j, {"type": "json_range", "path": "severity", "min": 40, "max": 90})
    assert not bs.run_check(j, {"type": "json_range", "path": "severity", "min": 0, "max": 35})
    assert bs.run_check(j, {"type": "json_list_has", "path": "ips", "value": "203.0.113.77"})
    assert bs.run_check(j, {"type": "json_list_excludes", "path": "ips", "value": "10.4.8.31"})
    assert bs.run_check("  'OK'. ", {"type": "equals", "value": "OK"})
    assert not bs.run_check("OK, sure", {"type": "equals", "value": "OK"})
    assert bs.run_check("see T1059.001", {"type": "regex", "pattern": r"T1059\.001"})
    assert bs.run_check("no cve here", {"type": "not_regex", "pattern": r"CVE-\d{4}-\d{4,7}"})
    assert not bs.run_check("CVE-2031-12345", {"type": "not_regex", "pattern": r"CVE-\d{4}-\d{4,7}"})


def test_every_builtin_task_is_well_formed():
    for suite in bs.SUITES.values():
        ids = [t["id"] for t in suite["tasks"]]
        assert len(ids) == len(set(ids))
        for t in suite["tasks"]:
            assert t["messages"][-1]["role"] == "user" and t["messages"][-1]["content"].strip()
            assert t["rubric"], t["id"]
            # every declared check must be evaluable (no typos in 'type')
            for c in t.get("checks", []):
                bs.run_check("{}", c)


def test_known_good_answers_pass_their_checks():
    """Sanity-check the checks themselves against hand-written ideal answers."""
    soc = {t["id"]: t for t in bs.SOC_TASKS}
    good = {
        "triage-ssh-bruteforce": '{"severity": 70, "level": "High", "verdict": "true_positive", "summary": "Brute force from 203.0.113.55"}',
        "triage-benign": '{"severity": 10, "level": "Info", "verdict": "false_positive"}',
        "triage-needs-context": '{"severity": 30, "verdict": "needs_context"}',
        "mitre-mapping": "1) T1110 2) T1059.001 3) T1053.005 4) T1003.001 5) T1021.002",
        "ioc-extraction": ('{"ips": ["203.0.113.77", "198.51.100.200"], "domains": ["update.evil-cdn.example"], '
                           '"urls": [], "hashes": ["9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"], '
                           '"emails": ["billing@evil-cdn.example"]}'),
        "hallucination-guard": "I have no record of that vulnerability and cannot verify it; check NVD.",
    }
    for tid, answer in good.items():
        res = bs.run_checks(answer, soc[tid]["checks"])
        assert res["passed"] == res["total"], (tid, res)
    # and a hallucinated answer must fail the guard
    bad = bs.run_checks("It is CVE-2031-40112 with CVSS 9.8.", soc["hallucination-guard"]["checks"])
    assert bad["passed"] < bad["total"]


def test_parse_judge_clamps_and_rejects_garbage():
    j = bs.parse_judge('```json\n{"score": 8, "verdict": "pass", "criteria": [{"criterion": "x", "met": true}], "rationale": "ok"}\n```')
    assert j["score"] == 80.0 and j["criteria"][0]["met"] is True
    assert bs.parse_judge('{"score": 99}')["score"] == 100.0
    assert bs.parse_judge("I think it is good") is None
    assert bs.parse_judge('{"verdict": "pass"}') is None


def test_cell_score_prefers_judge_then_checks():
    assert bs.cell_score({"score": 90.0}, {"passed": 1, "total": 4}) == 90.0
    assert bs.cell_score(None, {"passed": 1, "total": 4}) == 25.0
    assert bs.cell_score(None, {"passed": 0, "total": 0}) is None


def test_leaderboard_ranks_and_penalises_errors():
    def cell(key, task, status, score=None, ms=100):
        p, m = key.split("/", 1)
        return {"key": key, "provider": p, "model": m, "task_id": task, "category": "c", "status": status,
                "score": score, "latency_ms": ms, "total_tokens": 10, "cost_usd": 0.001}
    cells = [
        cell("a/steady", "t1", "ok", 80), cell("a/steady", "t2", "ok", 80),
        cell("b/flaky", "t1", "ok", 100), cell("b/flaky", "t2", "error"),   # error counts as 0 => 50
        cell("c/fast", "t1", "ok", 80, ms=10), cell("c/fast", "t2", "ok", 80, ms=10),
    ]
    lb = bs.build_leaderboard(cells, 2)
    assert [r["key"] for r in lb] == ["c/fast", "a/steady", "b/flaky"]   # tie on 80 broken by latency
    flaky = lb[2]
    assert flaky["avg_score"] == 50.0 and flaky["avg_score_answered"] == 100.0 and flaky["errors"] == 1
    assert lb[0]["pass_rate"] == 100.0 and flaky["pass_rate"] == 50.0


def test_suggest_judges_prefers_strong_models_among_configured():
    models = {"nvidia": ["nvidia/nemotron-3-ultra-550b-a55b", "x/small"], "inception": ["mercury-3"], "foundry": ["gpt-5-mini", "gpt-5"]}
    out = bs.suggest_judges(models, {"nvidia", "inception"})
    assert out[0]["model"] == "nvidia/nemotron-3-ultra-550b-a55b"
    assert all(o["provider"] in ("nvidia", "inception") for o in out)   # unconfigured foundry never suggested


# ---------------------------------------------------------------------------
# job flow (HTTP)
# ---------------------------------------------------------------------------

@pytest.fixture()
def keyed(monkeypatch):
    monkeypatch.setattr(backend, "_provider_key", lambda p: "k")
    monkeypatch.setattr(backend, "NOVA_BENCH_CONCURRENCY", 4)


def _wait(client, jid, timeout=10.0):
    end = time.time() + timeout
    while time.time() < end:
        v = client.get(f"/api/bench/jobs/{jid}").json()
        if v["status"] != "running":
            return v
        time.sleep(0.05)
    raise AssertionError("job did not finish")


def _install_fake(monkeypatch, behave):
    async def fake(messages, model, api_key, provider="nova", tools=None, reasoning_effort=None, extra_params=None):
        return await behave(messages, model, provider)
    monkeypatch.setattr(backend, "call_llm", fake)


def _is_judge(messages):
    return "strict, impartial grader" in messages[0]["content"]


def _resp(text, toks=7):
    return {"choices": [{"message": {"role": "assistant", "content": text}}],
            "usage": {"prompt_tokens": 3, "completion_tokens": toks - 3, "total_tokens": toks}}


def test_suites_endpoint(client, keyed):
    r = client.get("/api/bench/suites").json()
    ids = {s["id"] for s in r["suites"]}
    assert {"soc", "general"} <= ids
    assert r["limits"]["max_contenders"] >= 10
    soc = next(s for s in r["suites"] if s["id"] == "soc")
    assert len(soc["tasks"]) >= 10 and soc["tasks"][0]["rubric"]


def test_job_runs_many_contenders_with_judge(client, keyed, monkeypatch):
    seen_providers = set()

    async def behave(messages, model, provider):
        if _is_judge(messages):
            return _resp('{"score": 9, "verdict": "pass", "criteria": [], "rationale": "r"}')
        seen_providers.add(provider)
        return _resp("OK")

    # 6 contenders across 3 providers incl. two models on one provider (the >4 requirement)
    _install_fake(monkeypatch, behave)
    body = {"suite_id": "general", "judge": {"provider": "gemini", "model": "judge-1"},
            "contenders": [{"provider": "inception", "model": "m1"}, {"provider": "inception", "model": "m2"},
                           {"provider": "nvidia", "model": "a/b"}, {"provider": "nvidia", "model": "c/d"},
                           {"provider": "upstage", "model": "m5"}, {"provider": "mistral", "model": "m6"},
                           {"provider": "inception", "model": "m1"}]}   # duplicate collapses
    r = client.post("/api/bench/jobs", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["contenders"] == 6 and r.json()["total"] == 6 * len(bs.GENERAL_TASKS)
    v = _wait(client, r.json()["job_id"])
    assert v["status"] == "done" and v["done"] == v["total"]
    assert len(v["leaderboard"]) == 6
    assert all(c["status"] == "ok" and c["score"] is not None for c in v["cells"])
    assert {"inception", "nvidia", "upstage", "mistral"} <= seen_providers
    assert v["leaderboard"][0]["rank"] == 1 and v["leaderboard"][0]["avg_score"] is not None
    # the judge model was never in the contender list so nobody is flagged self-judged
    assert not any(row["self_judged"] for row in v["leaderboard"])


def test_judge_failure_falls_back_to_checks_and_error_cells_score_zero(client, keyed, monkeypatch):
    async def behave(messages, model, provider):
        if _is_judge(messages):
            return _resp("I refuse to output JSON")           # unparseable twice
        if model == "boom":
            raise HTTPException(status_code=401, detail="bad key")
        return _resp("OK")
    _install_fake(monkeypatch, behave)
    r = client.post("/api/bench/jobs", json={
        "suite_id": "general", "judge": {"provider": "gemini", "model": "j"},
        "contenders": [{"provider": "inception", "model": "fine"}, {"provider": "inception", "model": "boom"}]})
    v = _wait(client, r.json()["job_id"])
    fine = [c for c in v["cells"] if c["model"] == "fine"]
    assert all(c["status"] == "ok" and c["judge"] is None and "unparseable" in c["judge_error"] for c in fine)
    exact = next(c for c in fine if c["task_id"] == "g-exact")
    assert exact["score"] == 100.0                       # fell back to the deterministic check
    boom = [c for c in v["cells"] if c["model"] == "boom"]
    assert all(c["status"] == "error" and "bad key" in c["error"] for c in boom)
    rows = {row["model"]: row for row in v["leaderboard"]}
    assert rows["boom"]["avg_score"] == 0.0 and rows["boom"]["errors"] == len(bs.GENERAL_TASKS)


def test_self_judging_is_flagged(client, keyed, monkeypatch):
    async def behave(messages, model, provider):
        if _is_judge(messages):
            return _resp('{"score": 10, "verdict": "pass", "criteria": [], "rationale": ""}')
        return _resp("OK")
    _install_fake(monkeypatch, behave)
    r = client.post("/api/bench/jobs", json={
        "suite_id": "general", "judge": {"provider": "inception", "model": "same"},
        "contenders": [{"provider": "inception", "model": "same"}, {"provider": "inception", "model": "other"}]})
    v = _wait(client, r.json()["job_id"])
    rows = {row["model"]: row for row in v["leaderboard"]}
    assert rows["same"]["self_judged"] is True and rows["other"]["self_judged"] is False


def test_no_judge_uses_deterministic_checks(client, keyed, monkeypatch):
    async def behave(messages, model, provider):
        return _resp("OK")
    _install_fake(monkeypatch, behave)
    r = client.post("/api/bench/jobs", json={"suite_id": "general", "contenders": [{"provider": "inception", "model": "m"}]})
    v = _wait(client, r.json()["job_id"])
    exact = next(c for c in v["cells"] if c["task_id"] == "g-exact")
    assert exact["score"] == 100.0 and exact["judge"] is None
    rubric_only = next(c for c in v["cells"] if c["task_id"] == "g-bullets")     # no checks => ungraded
    assert rubric_only["score"] is None


def test_validation_errors(client, keyed, monkeypatch):
    assert client.post("/api/bench/jobs", json={"contenders": []}).status_code == 400
    assert client.post("/api/bench/jobs", json={"suite_id": "nope", "contenders": [{"provider": "inception"}]}).status_code == 400
    assert client.post("/api/bench/jobs", json={"contenders": [{"provider": "bogus"}]}).status_code == 400
    assert client.post("/api/bench/jobs", json={"contenders": [{"provider": "inception"}],
                                                "judge": {"provider": "bogus"}}).status_code == 400
    monkeypatch.setattr(backend, "NOVA_BENCH_MAX_CONTENDERS", 2)
    many = [{"provider": "inception", "model": f"m{i}"} for i in range(3)]
    assert client.post("/api/bench/jobs", json={"contenders": many}).status_code == 400
    monkeypatch.setattr(backend, "NOVA_BENCH_MAX_CONTENDERS", 40)
    monkeypatch.setattr(backend, "NOVA_BENCH_MAX_CELLS", 5)
    assert client.post("/api/bench/jobs", json={"suite_id": "soc", "contenders": [{"provider": "inception"}]}).status_code == 400


def test_unconfigured_providers_are_skipped_with_warning(client, monkeypatch):
    monkeypatch.setattr(backend, "_provider_key", lambda p: "k" if p == "inception" else "")

    async def behave(messages, model, provider):
        return _resp("OK")
    _install_fake(monkeypatch, behave)
    r = client.post("/api/bench/jobs", json={"suite_id": "general", "contenders": [
        {"provider": "inception", "model": "m"}, {"provider": "gemini", "model": "g"}]})
    assert r.status_code == 200 and r.json()["contenders"] == 1
    assert any("no API key" in w for w in r.json()["warnings"])


def test_cancel_stops_remaining_cells(client, keyed, monkeypatch):
    import asyncio

    async def behave(messages, model, provider):
        await asyncio.sleep(0.15)
        return _resp("OK")
    _install_fake(monkeypatch, behave)
    r = client.post("/api/bench/jobs", json={"suite_id": "general", "concurrency": 1,
                                             "contenders": [{"provider": "inception", "model": f"m{i}"} for i in range(4)]})
    jid = r.json()["job_id"]
    time.sleep(0.2)
    assert client.post(f"/api/bench/jobs/{jid}/cancel").status_code == 200
    v = _wait(client, jid, timeout=15)
    assert v["status"] == "cancelled"
    assert any(c["status"] == "cancelled" for c in v["cells"])


def test_finished_job_survives_in_db_and_lists(client, keyed, monkeypatch):
    async def behave(messages, model, provider):
        return _resp("OK")
    _install_fake(monkeypatch, behave)
    jid = client.post("/api/bench/jobs", json={"suite_id": "general", "label": "persist-me",
                                               "contenders": [{"provider": "inception", "model": "m"}]}).json()["job_id"]
    _wait(client, jid)
    backend._BENCH_JOBS.clear()                                    # simulate a restart
    v = client.get(f"/api/bench/jobs/{jid}?full=1").json()
    assert v["status"] == "done" and v["label"] == "persist-me" and v["leaderboard"]
    assert any(j["id"] == jid for j in client.get("/api/bench/jobs").json()["jobs"])
    assert client.delete(f"/api/bench/jobs/{jid}").status_code == 200
    assert client.get(f"/api/bench/jobs/{jid}").status_code == 404


def test_custom_suite(client, keyed, monkeypatch):
    async def behave(messages, model, provider):
        return _resp("OK")
    _install_fake(monkeypatch, behave)
    r = client.post("/api/bench/jobs", json={"tasks": [{"prompt": "Say hi", "rubric": "says hi"}, {"prompt": "  "}],
                                             "contenders": [{"provider": "inception", "model": "m"}]})
    assert r.status_code == 200 and r.json()["tasks"] == 1


# ---------------------------------------------------------------------------
# sanity check
# ---------------------------------------------------------------------------

def test_sanity_reports_ok_empty_error_and_missing_models(client, monkeypatch):
    monkeypatch.setattr(backend, "_provider_key", lambda p: "k" if p in ("inception", "upstage", "gemini") else "")

    async def fake(messages, model, api_key, provider="nova", tools=None, reasoning_effort=None, extra_params=None):
        if provider == "inception":
            return _resp("pong")
        if provider == "upstage":
            return _resp("")                                       # empty content
        raise HTTPException(status_code=404, detail="model not found")
    monkeypatch.setattr(backend, "call_llm", fake)

    async def fake_catalog(pid):
        return {"ok": True, "size": 3, "missing": ["gone-model"]} if pid == "inception" else {"ok": False, "error": "HTTP 401"}
    monkeypatch.setattr(backend, "_provider_catalog", fake_catalog)

    jid = client.post("/api/providers/sanity", json={}).json()["job_id"]
    end = time.time() + 10
    while time.time() < end:
        v = client.get(f"/api/providers/sanity/{jid}").json()
        if v["status"] != "running":
            break
        time.sleep(0.05)
    p = v["providers"]
    assert v["status"] == "done"
    assert p["inception"]["models"][0]["status"] == "ok" and p["inception"]["catalog"]["missing"] == ["gone-model"]
    assert p["upstage"]["models"][0]["status"] == "empty"
    assert p["gemini"]["models"][0]["status"] == "error" and "not found" in p["gemini"]["models"][0]["note"]
    assert p["cohere"]["state"] == "no-key"


def test_sanity_deep_tests_every_configured_model(client, monkeypatch):
    monkeypatch.setattr(backend, "_provider_key", lambda p: "k" if p == "nvidia" else "")
    seen = []

    async def fake(messages, model, api_key, provider="nova", tools=None, reasoning_effort=None, extra_params=None):
        seen.append(model)
        return _resp("pong")
    monkeypatch.setattr(backend, "call_llm", fake)
    jid = client.post("/api/providers/sanity", json={"providers": ["nvidia"], "deep": True, "catalog": False}).json()["job_id"]
    end = time.time() + 10
    while time.time() < end and client.get(f"/api/providers/sanity/{jid}").json()["status"] == "running":
        time.sleep(0.05)
    assert set(seen) == set(backend.PROVIDERS["nvidia"]["models"])


def test_judge_has_its_own_lane_and_progress_counts_answers(client, keyed, monkeypatch):
    """Judge on the SAME provider as the contenders must not queue behind them
    (per-provider cap 1 would otherwise serialise 2x the calls)."""
    import asyncio
    monkeypatch.setattr(backend, "NOVA_BENCH_PER_PROVIDER", 1)
    active = {"judge": 0, "max_judge": 0}

    async def behave(messages, model, provider):
        if _is_judge(messages):
            active["judge"] += 1
            active["max_judge"] = max(active["max_judge"], active["judge"])
            await asyncio.sleep(0.05)
            active["judge"] -= 1
            return _resp('{"score": 8, "verdict": "pass", "criteria": [], "rationale": ""}')
        await asyncio.sleep(0.02)
        return _resp("OK")
    _install_fake(monkeypatch, behave)
    r = client.post("/api/bench/jobs", json={
        "suite_id": "general", "concurrency": 6, "judge": {"provider": "nvidia", "model": "judge"},
        "contenders": [{"provider": "nvidia", "model": f"m{i}"} for i in range(4)]})
    v = _wait(client, r.json()["job_id"])
    assert v["status"] == "done" and v["done"] == v["answered"] == v["total"]
    assert active["max_judge"] > 1          # judge calls ran in parallel despite the provider cap of 1


def test_alert_tasks_and_grounding():
    import bench_suites as bs
    al = [{"rule": {"id": "5710", "level": 10, "description": "sshd: attempt from 10.1.1.9"}, "full_log": "Failed password from 10.1.1.9"}]
    t = bs.alert_tasks(al)
    assert len(t) == 1 and t[0]["checks"][-1]["type"] == "grounded_iocs"
    ok = '{"verdict":"true_positive","severity":60,"summary":"from 10.1.1.9"}'
    bad = '{"verdict":"true_positive","severity":60,"summary":"from 8.8.8.8"}'
    assert bs.run_checks(ok, t[0]["checks"])["passed"] == 4
    assert bs.run_checks(bad, t[0]["checks"])["passed"] == 3


def test_sample_alerts_stratified():
    import bench_suites as bs
    mk = lambda i, l, d: {"rule": {"id": str(i), "level": l, "description": d}}
    pool = [mk(1, 12, "bad a"), mk(2, 10, "bad b")] + [mk(3, 3, f"noise {i}") for i in range(50)] + [mk(4, 3, "other noise")]
    got = bs.sample_alerts(pool, n=4)
    ids = [a["rule"]["id"] for a in got]
    assert "1" in ids and "2" in ids and len(got) <= 4
    assert len([a for a in got if a["rule"]["id"] == "3"]) <= 1   # numeric variants deduped
