"""
nova-poc backend
================
A tiny FastAPI service that:
  1. Proxies chat requests to Amazon Nova's OpenAI-compatible endpoint.
  2. Optionally runs an "agent" loop where the model can call local, safe
     tools (get_time, calculate, read_file) and the results are fed back.

This is a PROOF OF CONCEPT built for a local lab. It intentionally keeps the
Nova API key server-side only (never shipped to the browser).
"""

import json
import logging
import os
import io
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger("nova_poc")

import httpx
from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import re

# EVTX (Windows Event Log) is binary; parse it with python-evtx into compact text.
try:
    from Evtx.Evtx import Evtx
    _EVTX_AVAILABLE = True
except ImportError:  # pragma: no cover
    _EVTX_AVAILABLE = False

# ----------------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------------
NOVA_BASE_URL = os.getenv("NOVA_BASE_URL", "https://api.nova.amazon.com/v1")
NOVA_API_KEY = os.getenv("NOVA_API_KEY", "")
APP_HOST = os.getenv("APP_HOST", "0.0.0.0")
APP_PORT = int(os.getenv("APP_PORT", "8000"))
DEFAULT_MODEL = os.getenv("NOVA_MODEL", "nova-2-lite-v1")
# Directory the read_file tool is allowed to read from (keeps the demo safe).
SANDBOX_ROOT = Path(os.getenv("NOVA_SANDBOX", str(Path.home() / "Downloads"))).resolve()

# ---- file analyzer config ----
ANALYZE_MAX_CHARS = int(os.getenv("NOVA_ANALYZE_MAX_CHARS", "60000"))
NOVA_MAX_UPLOAD_MB = int(os.getenv("NOVA_MAX_UPLOAD_MB", "10"))

import tempfile

# A small "magic" prefix for EVTX files (ElfFile / ElfChnk header).
_EVTX_MAGIC = b"ElfFile"


def looks_like_evtx(data: bytes) -> bool:
    return data[:7] == _EVTX_MAGIC


def evtx_to_text(path: str) -> str:
    """Convert an EVTX file at `path` into compact, analysis-friendly text.

    Full XML is huge (a few MB for a small log), so we extract only the
    meaningful fields per record: timestamp, EventID, provider, computer,
    level, and the flattened EventData key/value pairs. This lets many more
    events fit inside Nova's context budget than dumping raw XML would.
    """
    if not _EVTX_AVAILABLE:
        raise RuntimeError("python-evtx is not installed on the server.")
    lines: List[str] = []
    with Evtx(path) as evtx:
        for rec in evtx.records():
            try:
                xml_str = rec.xml()
            except Exception:  # noqa: BLE001 - skip malformed records
                continue
            try:
                root = ET.fromstring(xml_str)
            except ET.ParseError:
                continue
            # Namespaces vary; strip them so element lookup is simple.
            def local(tag: str) -> str:
                return tag.split("}", 1)[-1] if "}" in tag else tag

            sys_el = next((c for c in root if local(c.tag) == "System"), None)
            data_el = next((c for c in root if local(c.tag) == "EventData"), None)

            event_id = time_created = provider = computer = level = ""
            if sys_el is not None:
                for child in sys_el:
                    name = local(child.tag)
                    if name == "EventID":
                        event_id = (child.text or "").strip()
                    elif name == "TimeCreated":
                        time_created = (child.attrib.get("SystemTime") or "").strip()
                    elif name == "Provider":
                        provider = (child.attrib.get("Name")
                                    or child.attrib.get("Guid") or "").strip()
                    elif name == "Computer":
                        computer = (child.text or "").strip()
                    elif name == "Level":
                        level = (child.text or "").strip()

            fields: List[str] = []
            if data_el is not None:
                for child in data_el:
                    nm = child.attrib.get("Name", local(child.tag))
                    val = (child.text or "").strip()
                    if val:
                        fields.append(f"{nm}={val}")

            header = f"[{time_created}] EventID={event_id} Level={level} Provider={provider} Computer={computer}"
            lines.append(header)
            if fields:
                lines.append("  " + " | ".join(fields))
    return "\n".join(lines)

# Models exposed in the UI picker.
AVAILABLE_MODELS = [
    "nova-2-lite-v1",
    "nova-2-pro-v1",
    "nova-3-lite-v1",
    "nova-3-pro-v1",
]

# ----------------------------------------------------------------------------
# Tool definitions (sent to the model so it knows what it can call)
# ----------------------------------------------------------------------------
TOOLS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "get_time",
            "description": "Return the current local date and time. Use this when the user asks about the time, date, 'today', or scheduling.",
            "parameters": {
                "type": "object",
                "properties": {
                    "timezone": {
                        "type": "string",
                        "description": "Optional IANA timezone, e.g. 'UTC' or 'America/New_York'. Defaults to the server's local time.",
                    }
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "calculate",
            "description": "Safely evaluate a basic arithmetic expression (+, -, *, /, %, parentheses, power **). No other functions or names are allowed. Use for math questions.",
            "parameters": {
                "type": "object",
                "properties": {
                    "expression": {
                        "type": "string",
                        "description": "The arithmetic expression to evaluate, e.g. '(12 * 8) / 3'.",
                    }
                },
                "required": ["expression"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read a text file from the sandbox directory. Returns the first N lines. Use when the user references a local file by name.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {
                        "type": "string",
                        "description": "Name of the file inside the allowed sandbox directory.",
                    },
                    "lines": {
                        "type": "integer",
                        "description": "Maximum number of lines to return (default 50).",
                    },
                },
                "required": ["filename"],
            },
        },
    },
]

# ----------------------------------------------------------------------------
# In-process tool implementations
# ----------------------------------------------------------------------------
def tool_get_time(timezone: Optional[str] = None) -> str:
    import datetime
    now = datetime.datetime.now()
    if timezone:
        try:
            import zoneinfo
            now = now.astimezone(zoneinfo.ZoneInfo(timezone))
        except Exception as e:  # noqa: BLE001
            return f"Could not resolve timezone '{timezone}': {e}"
    return now.strftime("%A %Y-%m-%d %H:%M:%S")


def tool_calculate(expression: str) -> str:
    # Compile + walk the AST so only arithmetic nodes are permitted.
    import ast
    import operator
    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError as e:
        return f"Invalid expression: {e}"
    ops = {
        ast.Add: operator.add,
        ast.Sub: operator.sub,
        ast.Mult: operator.mul,
        ast.Div: operator.truediv,
        ast.Pow: operator.pow,
        ast.Mod: operator.mod,
        ast.USub: operator.neg,
        ast.UAdd: operator.pos,
    }

    def ev(node):
        if isinstance(node, ast.Expression):
            return ev(node.body)
        if isinstance(node, ast.Constant):
            if isinstance(node.value, (int, float)):
                return node.value
            raise ValueError("Only numeric constants allowed")
        if isinstance(node, ast.BinOp):
            return ops[type(node.op)](ev(node.left), ev(node.right))
        if isinstance(node, ast.UnaryOp):
            return ops[type(node.op)](ev(node.operand))
        raise ValueError(f"Disallowed expression element: {type(node).__name__}")

    try:
        result = ev(tree)
    except Exception as e:  # noqa: BLE001
        return f"Could not evaluate: {e}"
    return f"{result}"


def tool_read_file(filename: str, lines: int = 50) -> str:
    target = (SANDBOX_ROOT / filename).resolve()
    if not str(target).startswith(str(SANDBOX_ROOT)):
        return f"Access denied: '{filename}' is outside the sandbox directory."
    if not target.exists():
        return f"File not found: {filename}"
    try:
        text = target.read_text(errors="replace").splitlines()
    except Exception as e:  # noqa: BLE001
        return f"Could not read file: {e}"
    head = text[: max(1, min(lines, 200))]
    return "\n".join(head)


TOOL_IMPLS = {
    "get_time": tool_get_time,
    "calculate": tool_calculate,
    "read_file": tool_read_file,
}


def run_tool(name: str, arguments: Dict[str, Any]) -> str:
    impl = TOOL_IMPLS.get(name)
    if not impl:
        return f"Unknown tool: {name}"
    try:
        return str(impl(**arguments))
    except TypeError as e:
        return f"Bad arguments for {name}: {e}"


# ----------------------------------------------------------------------------
# Request / response schemas
# ----------------------------------------------------------------------------
class ChatRequest(BaseModel):
    messages: List[Dict[str, Any]]
    model: str = Field(default=DEFAULT_MODEL)
    agent: bool = False
    api_key: Optional[str] = None  # optional override from the UI
    max_tool_rounds: int = Field(default=5, ge=1, le=10)


# ----------------------------------------------------------------------------
# App
# ----------------------------------------------------------------------------
app = FastAPI(title="Nova POC", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = Path(__file__).parent / "static"


def nova_headers(api_key: str) -> Dict[str, str]:
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }


async def call_nova(
    messages: List[Dict[str, Any]],
    model: str,
    api_key: str,
    tools: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": False,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"

    last_err: Optional[str] = None
    async with httpx.AsyncClient(timeout=60.0) as client:
        for attempt in range(2):  # one retry for transient gateway 5xx
            try:
                resp = await client.post(
                    f"{NOVA_BASE_URL}/chat/completions",
                    headers=nova_headers(api_key),
                    json=payload,
                )
            except httpx.HTTPError as e:  # network-level failure
                last_err = f"Network error contacting Nova: {e}"
                logger.warning(last_err)
                continue

            # Surface auth / quota / bad-request errors with a clean message.
            if resp.status_code in (401, 403, 429):
                detail = _clean_error(resp)
                raise HTTPException(status_code=resp.status_code, detail=detail)
            if resp.status_code >= 500:
                last_err = f"Nova gateway {resp.status_code} (transient)"
                logger.warning("%s — retrying", last_err)
                continue

            # Any non-2xx: extract a useful message and raise (no retry needed).
            if resp.status_code >= 400:
                detail = _clean_error(resp)
                raise HTTPException(status_code=resp.status_code, detail=detail)

            body = resp.text
            # Nova returns JSON on success; sometimes Amazon's CloudFront front
            # returns an HTML error page instead of JSON. Treat that as an error.
            if not body.lstrip().startswith("{"):
                last_err = (
                    "Nova returned a non-JSON (HTML) error page from its gateway. "
                    "This is intermittent on Amazon's side — try resending."
                )
                logger.warning("Non-JSON Nova response: %.200s", body)
                continue

            try:
                parsed = resp.json()
            except json.JSONDecodeError:
                last_err = "Nova response was not valid JSON."
                continue
            # Nova must return a choices[] array; guard against empty/odd shapes.
            if not isinstance(parsed, dict) or "choices" not in parsed:
                last_err = (
                    "Nova returned an unexpected response shape (no choices). "
                    + str(parsed)[:200]
                )
                logger.warning("Unexpected Nova shape: %.200s", str(parsed))
                continue
            return parsed

    # Out of attempts: report the last observed problem cleanly.
    raise HTTPException(status_code=502, detail=last_err or "Nova request failed.")


def _clean_error(resp: httpx.Response) -> str:
    """Map Nova HTTP errors to a short, human-readable message."""
    map_ = {
        401: "Nova rejected the API key (401). Check NOVA_API_KEY.",
        403: "Nova rejected the request (403) — likely the key or the prompt was blocked.",
        429: "Nova rate limit hit (429). Slow down and retry.",
    }
    msg = map_.get(resp.status_code, f"Nova API error ({resp.status_code}).")
    snippet = resp.text.strip()
    if snippet and not snippet.lower().startswith("<!doctype") and "<html" not in snippet.lower():
        msg += f" {snippet[:200]}"
    return msg


@app.get("/api/models")
async def get_models():
    return {"models": AVAILABLE_MODELS, "default": DEFAULT_MODEL}


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "nova_configured": bool(NOVA_API_KEY),
        "sandbox_root": str(SANDBOX_ROOT),
        "endpoint": f"{NOVA_BASE_URL}/chat/completions",
    }


@app.post("/api/chat")
async def chat(req: ChatRequest):
    api_key = req.api_key or NOVA_API_KEY
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="No Nova API key configured. Set NOVA_API_KEY in the .env file (server-side).",
        )

    messages = list(req.messages)
    # Prepend a lightweight system prompt so Nova reads as a local PoC demo
    # (softens its "I can't discuss my capabilities" refusals for the lab).
    if not any(m.get("role") == "system" for m in messages):
        messages.insert(0, {
            "role": "system",
            "content": (
                "You are Nova, running inside a local proof-of-concept chat app "
                "on the user's own lab machine. Be helpful, concise, and direct. "
                "You may discuss your capabilities, write code, and use tools when "
                "agent mode is enabled. This is an authorized lab/demo environment."
            ),
        })
    trace: List[Dict[str, Any]] = []
    model = req.model or DEFAULT_MODEL

    # Agent loop: let the model call tools, feed results back, repeat.
    if req.agent:
        tools = TOOLS
        for _ in range(req.max_tool_rounds):
            data = await call_nova(messages, model, api_key, tools)
            choice = data["choices"][0]
            msg = choice["message"]

            # Surface usage for the UI.
            if "usage" in data:
                trace.append({"type": "usage", "data": data["usage"]})

            # The model may emit one or more tool calls.
            tool_calls = msg.get("tool_calls")
            if not tool_calls:
                messages.append(msg)
                break

            # Record the assistant turn (must include tool_calls for the API).
            messages.append(msg)
            trace.append({"type": "assistant", "content": msg.get("content", "")})

            for tc in tool_calls:
                fn = tc.get("function", {})
                name = fn.get("name")
                try:
                    args = json.loads(fn.get("arguments", "{}"))
                except json.JSONDecodeError:
                    args = {}
                result = run_tool(name, args)
                trace.append({
                    "type": "tool",
                    "name": name,
                    "arguments": args,
                    "result": result,
                })
                # Tool result message back to the model.
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.get("id"),
                    "content": result,
                })
        else:
            # Hit the round cap without a final answer.
            trace.append({
                "type": "notice",
                "content": "Reached maximum tool rounds; returning last model output.",
            })
        # Final answer pass (no tools) to let the model summarise.
        data = await call_nova(messages, model, api_key)
        final_msg = data["choices"][0]["message"]
        messages.append(final_msg)
        if "usage" in data:
            trace.append({"type": "usage", "data": data["usage"]})
        return JSONResponse({
            "id": data.get("id"),
            "model": data.get("model", model),
            "content": final_msg.get("content", ""),
            "usage": data.get("usage"),
            "trace": trace,
            "agent": True,
        })
    else:
        data = await call_nova(messages, model, api_key)
        msg = data["choices"][0]["message"]
        return JSONResponse({
            "id": data.get("id"),
            "model": data.get("model", model),
            "content": msg.get("content", ""),
            "usage": data.get("usage"),
            "trace": [],
            "agent": False,
        })


# ----------------------------------------------------------------------------
# File analyzer
# ----------------------------------------------------------------------------
# Cheap, server-side pre-processing so Nova only has to do the *thinking*,
# and so the UI can show objective numbers even before the LLM answers.
_IPV4_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
_LEVEL_RE = re.compile(r"\b(ERROR|FATAL|CRITICAL|WARN|WARNING|INFO|DEBUG|NOTICE)\b", re.I)


def quick_stats(text: str) -> Dict[str, Any]:
    lines = text.splitlines()
    n = len(lines)
    levels: Dict[str, int] = {}
    ips: Dict[str, int] = {}
    for ln in lines:
        m = _LEVEL_RE.search(ln)
        if m:
            levels[m.group(1).upper()] = levels.get(m.group(1).upper(), 0) + 1
        for im in _IPV4_RE.findall(ln):
            # skip obvious non-routable noise like 0.0.0.0
            if im == "0.0.0.0":
                continue
            ips[im] = ips.get(im, 0) + 1
    top_ips = sorted(ips.items(), key=lambda kv: kv[1], reverse=True)[:10]
    return {
        "lines": n,
        "bytes": len(text.encode("utf-8", "replace")),
        "level_counts": levels,
        "top_ips": top_ips,
        "unique_ips": len(ips),
    }


def build_analyzer_prompt(text: str, mode: str, max_chars: int) -> str:
    if len(text) > max_chars:
        text = (
            text[:max_chars]
            + f"\n\n[… truncated: analysis ran on the first {max_chars} characters "
            f"of {len(text)} total …]"
        )
    if mode == "security":
        system = (
            "You are a security log analyst in an authorized SOC lab. The user has "
            "uploaded a log file. Analyze it ONLY for security-relevant signal. "
            "Give a concise but thorough report with these sections:\n"
            "1. SUMMARY — what kind of log this is and the overall risk impression.\n"
            "2. KEY FINDINGS — bullet list of concrete security observations "
            "(failed/auth logins, brute-force patterns, suspicious source IPs, "
            "privilege changes, unusual times, error storms, recon/scan signatures, "
            "malware/IOC strings, data exfil indicators).\n"
            "3. SUSPICIOUS ENTITIES — a short table of IPs / accounts / hosts that "
            "warrant follow-up, with the reason and a rough frequency.\n"
            "4. RECOMMENDED ACTIONS — what a responder should do next.\n"
            "Be specific and cite line-style evidence where you can (do not invent "
            "line numbers). If the log shows no clear malicious activity, say so. "
            "This is an authorized defensive lab exercise."
        )
    else:  # general
        system = (
            "You are a log triage assistant. The user has uploaded a log file. "
            "Produce a concise, practical report with these sections:\n"
            "1. SUMMARY — what the log is (service/source) and its general health.\n"
            "2. ERRORS & WARNINGS — the most significant errors/warnings and any "
            "recurring failure patterns.\n"
            "3. TOP PATTERNS — notable repeated events, hotspots, or anomalies.\n"
            "4. TIMELINE — a short ordered sense of when events happened / peaks.\n"
            "5. SUGGESTIONS — what to look at or fix next.\n"
            "Be specific and base claims on the content. Do not invent data."
        )
    return (
        f"{system}\n\n"
        "=== LOG CONTENT (begin) ===\n"
        f"{text}\n"
        "=== LOG CONTENT (end) ==="
    )


@app.post("/api/analyze")
async def analyze(
    file: UploadFile = File(...),
    mode: str = Form("security"),
    model: str = Form(""),
    api_key: str = Form(""),
):
    key = api_key.strip() or NOVA_API_KEY
    if not key:
        raise HTTPException(
            status_code=400,
            detail="No Nova API key configured. Set NOVA_API_KEY in the .env file (server-side).",
        )
    if mode not in ("security", "general"):
        mode = "security"
    # Size guard (pre-read; multipart gives length via the spooled file).
    data = await file.read()
    if len(data) > NOVA_MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Max {NOVA_MAX_UPLOAD_MB} MB.",
        )
    # Windows Event Logs are binary EVTX — convert to compact text first.
    is_evtx = looks_like_evtx(data)
    if is_evtx:
        # python-evtx needs a file path; write bytes to a secure temp file.
        tmp = tempfile.NamedTemporaryFile(suffix=".evtx", delete=False)
        try:
            tmp.write(data)
            tmp.close()
            try:
                text = evtx_to_text(tmp.name)
            except RuntimeError as e:
                raise HTTPException(status_code=500, detail=str(e))
            except Exception as e:  # noqa: BLE001
                raise HTTPException(status_code=400, detail=f"Could not parse EVTX file: {e}")
        finally:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass
        if not text.strip():
            raise HTTPException(status_code=400, detail="EVTX file produced no readable records.")
    else:
        try:
            text = data.decode("utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            raise HTTPException(status_code=400, detail="Could not decode file as text/log.")
    if not text.strip():
        raise HTTPException(status_code=400, detail="File appears empty.")

    stats = quick_stats(text)
    if is_evtx:
        # Each record we extracted starts with "[timestamp] EventID=" on its own line.
        stats["evtx_records"] = sum(1 for ln in text.splitlines() if ln.startswith("["))
        stats["file_type"] = "evtx"
    else:
        stats["file_type"] = "text"
    prompt = build_analyzer_prompt(text, mode, ANALYZE_MAX_CHARS)
    use_model = model or DEFAULT_MODEL

    # Nova's OpenAI-compatible endpoint requires a non-empty user message,
    # so the analysis instruction goes in `user` and a short system role steers tone.
    system_role = (
        "You are a precise log-analysis assistant for an authorized defensive lab. "
        "Follow the user's instructions exactly and structure the report as requested."
    )
    try:
        data_ = await call_nova(
            [
                {"role": "system", "content": system_role},
                {"role": "user", "content": prompt},
            ],
            use_model,
            key,
        )
    except HTTPException as e:
        # Still hand back the objective stats so the UI isn't empty.
        return JSONResponse(
            status_code=e.status_code,
            content={"error": e.detail, "stats": stats, "model": use_model},
        )
    msg = data_["choices"][0]["message"]
    return JSONResponse({
        "content": msg.get("content", ""),
        "stats": stats,
        "mode": mode,
        "model": data_.get("model", use_model),
        "usage": data_.get("usage"),
        "filename": file.filename,
    })


# Serve the static frontend; mount at the end so /api/* isn't shadowed.
@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=APP_HOST, port=APP_PORT)
