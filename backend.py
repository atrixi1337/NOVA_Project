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
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger("nova_poc")

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

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
                return resp.json()
            except json.JSONDecodeError:
                last_err = "Nova response was not valid JSON."
                continue

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


# Serve the static frontend; mount at the end so /api/* isn't shadowed.
@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=APP_HOST, port=APP_PORT)
