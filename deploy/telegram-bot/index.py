#!/usr/bin/env python3
"""
NOVA Telegram bot -- start/stop/status your Alibaba ECS instance from Telegram.

Runs TWO ways:
  * Alibaba Function Compute HTTP function  (entry = main.handler)
  * plain HTTP webhook server on any host   (python3 index.py ; LISTEN=8080)

Standard library ONLY (signs Alibaba OpenAPI requests with HMAC-SHA1).
Uses a scoped RAM user, NOT your main AccessKey. Env vars:
  TG_BOT_TOKEN            Telegram bot token (from @BotFather)
  ECS_INSTANCE            e.g. i-t4n6s906crezn4x97owh
  REGION                  e.g. ap-southeast-1
  ALIYUN_AK / ALIYUN_SK   Alibaba AK of a RAM user scoped to Start/Stop/Describe
                          on THIS instance only (see nova-bot-ecs-policy.json)

Telegram commands:  /up   = StartInstance
                    /down = StopInstance
                    /status = DescribeInstances
                    /help
"""
import os, json, hmac, hashlib, base64, uuid, time, urllib.request, urllib.error
from urllib.parse import quote, urlencode

AK  = os.environ["ALIYUN_AK"]
SK  = os.environ["ALIYUN_SK"]
REG = os.environ.get("REGION", "ap-southeast-1")
IID = os.environ["ECS_INSTANCE"]
BOT = os.environ["TG_BOT_TOKEN"]
DOMAIN = os.environ.get("DOMAIN", "sallaapam.duckdns.org")
ALLOWED = os.environ.get("TG_ALLOWED_CHAT_ID", "").strip()


def _pct(s):
    """RFC3986 percent-encode for Alibaba RPC signature."""
    return quote(str(s), safe="").replace("+", "%20").replace("*", "%2A").replace("%7E", "~")


def ecs(action, params=None):
    p = dict(params or {})
    p.update({"Action": action, "AccessKeyId": AK, "Format": "JSON",
              "Version": "2014-05-26", "SignatureMethod": "HMAC-SHA1",
              "SignatureVersion": "1.0", "SignatureNonce": uuid.uuid4().hex,
              "Timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
              "RegionId": REG})
    if action in ("StartInstance", "StopInstance"):
        p["InstanceId"] = IID
    ch = "&".join(f"{_pct(k)}={_pct(v)}" for k, v in sorted(p.items()))
    string = f"GET&{_pct('/')}&{_pct(ch)}"
    sig = base64.b64encode(hmac.new((SK + "&").encode(), string.encode(),
                                   hashlib.sha1).digest()).decode()
    url = f"https://ecs.{REG}.aliyuncs.com/?{ch}&Signature={_pct(sig)}"
    with urllib.request.urlopen(
            urllib.request.Request(url, headers={"User-Agent": "NOVA-BOT/1.0"}),
            timeout=25) as r:
        return json.load(r)


def tg(chat_id, text):
    u = f"https://api.telegram.org/bot{BOT}/sendMessage"
    data = urlencode({"chat_id": chat_id, "text": text}).encode()
    urllib.request.urlopen(
        urllib.request.Request(u, data=data, headers={"User-Agent": "NOVA-BOT/1.0"}),
        timeout=15)


def status():
    d = ecs("DescribeInstances")
    inst = next((i for i in d["Instances"]["Instance"] if i["InstanceId"] == IID), None)
    if not inst:
        return "instance not found"
    pub = (inst.get("PublicIp", {}).get("IpAddress") or [None])[0]
    return (f"*{IID}*\nstatus: `{inst['Status']}`\ntype: {inst['InstanceType']}"
            + (f"\npub: `{pub}`\nurl: https://{DOMAIN}" if pub else f"\nurl: https://{DOMAIN}"))


def handle(update):
    m = update.get("message") or update.get("edited_message")
    if not m:
        return
    chat = m["chat"]["id"]
    txt = (m.get("text") or "").strip().lower()
    # Secure-by-default: until TG_ALLOWED_CHAT_ID is set, tell the first DMer
    # their chat_id (no ECS access). Once set, only that chat may control.
    if not ALLOWED:
        tg(chat, "👋 Hi. Your `chat_id` is `" + str(chat) +
           "`\nSet env `TG_ALLOWED_CHAT_ID=" + str(chat) +
           "` on the bot host to authorize this chat.\nUntil then /up /down /status are locked.")
        return
    if str(chat) != ALLOWED:
        tg(chat, "🔒 not authorized — ask the bot owner.")
        return
    try:
        if txt in ("/up", "/start"):
            ecs("StartInstance")
            tg(chat, "🟢 starting the NOVA server… it boots in ~30–60 s, "
                      "then https://" + DOMAIN)
        elif txt in ("/down", "/stop"):
            ecs("StopInstance")
            tg(chat, "🔴 stopping the NOVA server to save money. /up to restart.")
        elif txt in ("/status", "/s"):
            tg(chat, status())
        elif txt in ("/help", "/h"):
            tg(chat, "commands: `/up` `/down` `/status`")
        else:
            tg(chat, "commands: `/up` `/down` `/status` `/help`")
    except urllib.error.HTTPError as e:
        tg(chat, f"⚠️ ecs api {e.code}: {e.read().decode()[:200]}")
    except Exception as e:
        tg(chat, f"⚠️ error: {type(e).__name__}: {e}")


def _extract_body(event):
    """FC 3.0 HTTP triggers deliver either the raw body (bytes/str) or a
    request envelope {"version":"v1","rawPath":"/","headers":{...},"body":...}.
    Unwrap either form; return a JSON string (or "" )."""
    if isinstance(event, bytes):
        raw = event.decode(errors="replace")
    elif isinstance(event, str):
        raw = event
    elif isinstance(event, dict):
        raw = json.dumps(event)
    else:
        raw = ""
    if not raw:
        return ""
    try:
        obj = json.loads(raw)
    except Exception:
        return raw
    if isinstance(obj, dict):
        # FC 3.0 HTTP trigger envelope (has request metadata): unwrap the body.
        if ("headers" in obj) or ("rawPath" in obj and "version" in obj):
            for k in ("body", "bodyBytes", "payload", "requestBody", "rawBody", "data"):
                v = obj.get(k)
                if isinstance(v, str):
                    return v
            bb = obj.get("bodyBytes")
            if isinstance(bb, str):
                import base64 as _b64
                return _b64.b64decode(bb).decode(errors="replace")
            return ""
        if any(k in obj for k in ("message", "update_id", "callback_query", "edited_message")):
            return raw
    return raw if isinstance(obj, str) else json.dumps(obj)


def handler(event, context=None):
    """FC 3.0 HTTP entry point. Unwraps the HTTP request envelope, dispatches
    the Telegram update, and always returns 200 (Telegram needs a 200).
    Returns a tiny JSON body with the update_id / any error for diagnostics —
    harmless to Telegram, useful for `curl` checks."""
    body = _extract_body(event)
    out = {"ok": True}
    try:
        upd = json.loads(body or "{}")
        if isinstance(upd, dict):
            out["update_id"] = upd.get("update_id")
            handle(upd)
    except Exception as e:
        out = {"ok": False, "error": f"{type(e).__name__}: {e}"}
    return {"statusCode": 200, "headers": {"content-type": "application/json"},
            "body": json.dumps(out)}


class _H:
    def __init__(self):
        from http.server import BaseHTTPRequestHandler, HTTPServer
        self._Base, self._HTTP = BaseHTTPRequestHandler, HTTPServer
        H = self
        class BH(BaseHTTPRequestHandler):
            def _do(self, want_body):
                n = int(self.headers.get("Content-Length", 0) or 0)
                body = self.rfile.read(n).decode() if n else "{}"
                if want_body:
                    try:
                        handle(json.loads(body))
                    except Exception:
                        pass
                self.send_response(200); self.end_headers()
                self.wfile.write(b"ok")
            def do_POST(self): self._do(True)
            def do_GET(self):  self._do(False)
            def log_message(self, *a): pass
        self._BH = BH
    def serve(self):
        port = int(os.environ.get("LISTEN", "8080"))
        self._HTTP(("0.0.0.0", port), self._BH).serve_forever()


if __name__ == "__main__":
    _H().serve()
