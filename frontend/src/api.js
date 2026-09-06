// Thin client around the FastAPI backend. All keys stay server-side; the UI
// only ever sends provider/model/agent flags and an optional key override.

const BASE = ''  // same origin (FastAPI serves this built frontend)

// Thrown by every helper when the API answers 401 — App shows the lock screen.
export class AuthError extends Error {
  constructor(msg) { super(msg); this.name = 'AuthError' }
}

async function toError(r, fallback) {
  let detail = fallback
  try { const d = await r.json(); detail = d.detail || detail } catch {}
  return r.status === 401 ? new AuthError(detail) : new Error(detail)
}

async function jget(path) {
  const r = await fetch(BASE + path, { headers: { Accept: 'application/json' } })
  if (!r.ok) throw await toError(r, `GET ${path} -> ${r.status}`)
  return r.json()
}

async function jpost(path, body, opts = {}) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: JSON.stringify(body),
    ...(opts.extra || {}),
  })
  if (!r.ok) throw await toError(r, `POST ${path} -> ${r.status}`)
  return r.json()
}

async function jput(path, body) {
  const r = await fetch(BASE + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  })
  if (!r.ok) throw await toError(r, `PUT ${path} -> ${r.status}`)
  return r.json()
}

async function jdel(path) {
  const r = await fetch(BASE + path, { method: 'DELETE' })
  if (!r.ok) throw await toError(r, `DELETE ${path} -> ${r.status}`)
  return r.json()
}

export const api = {
  // models / providers
  models: () => jget('/api/models'),
  health: () => jget('/api/health'),

  // shared-passphrase auth: exchange the passphrase for a 30-day cookie
  login: async (passphrase) => {
    const r = await fetch(BASE + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase }),
    })
    if (!r.ok) throw await toError(r, `login -> ${r.status}`)
    return r.json()
  },

  // Usage dashboard: aggregate token usage from the local usage_ledger.
  // Optional filters: ?provider=.. &model=.. &days=N &recent=1
  usage: (params = {}) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v != null && v !== '') q.set(k, v)
    return jget(q.toString() ? '/api/usage?' + q.toString() : '/api/usage')
  },

  // ollama
  ollamaStatus: () => jget('/api/ollama/status'),
  ollamaLoad: () => jpost('/api/ollama/load', {}),
  ollamaUnload: () => jpost('/api/ollama/unload', {}),

  // chat
  chat: (payload, signal) => jpost('/api/chat', payload, signal ? { extra: { signal } } : {}),

  // Streaming chat (SSE from POST /api/chat/stream). handlers: {onDelta, onReasoning,
  // onDone, onError, onAbort}. Pass an AbortSignal to support a Stop button.
  // Returns nothing; all outcomes arrive through handlers.
  chatStream: async (payload, handlers = {}, signal) => {
    try {
      const r = await fetch(BASE + '/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(payload),
        signal,
      })
      if (!r.ok || !r.body) {
        if (r.status === 401) { handlers.onAuthRequired?.(); return }
        let detail = `POST /api/chat/stream -> ${r.status}`
        try { const d = await r.json(); detail = d.detail || detail } catch {}
        throw new Error(detail)
      }
      const reader = r.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      const dispatch = (raw) => {
        for (const line of raw.split('\n')) {
          if (!line.startsWith('data:')) continue
          let ev
          try { ev = JSON.parse(line.slice(5)) } catch { continue }
          if (ev.type === 'delta') handlers.onDelta?.(ev.content)
          else if (ev.type === 'reasoning') handlers.onReasoning?.(ev.content)
          else if (ev.type === 'done') handlers.onDone?.(ev)
          else if (ev.type === 'error') handlers.onError?.(ev.detail || 'stream error')
        }
      }
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let idx
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          dispatch(buf.slice(0, idx))
          buf = buf.slice(idx + 2)
        }
      }
      if (buf.trim()) dispatch(buf)
      handlers.onEnd?.()
    } catch (e) {
      if (e?.name === 'AbortError') handlers.onAbort?.()
      else handlers.onError?.(e?.message || String(e))
    }
  },

  // image generation (DALL·E via Azure Foundry)
  images: (payload) => jpost('/api/images', payload),

  // conversation history
  conversations: () => jget('/api/conversations'),
  newConversation: (body = {}) => jpost('/api/conversations', body),
  // last=N: only the most recent N messages (mobile-friendly pagination)
  getConversation: (cid, last) => jget(last ? `/api/conversations/${cid}?last=${last}` : `/api/conversations/${cid}`),
  renameConversation: (cid, title) => jput(`/api/conversations/${cid}`, { title }),
  deleteConversation: (cid) => jdel(`/api/conversations/${cid}`),
  clearConversation: (cid) => jpost(`/api/conversations/${cid}/clear`, {}),

  // multipart analyze
  analyze: async (file, { mode, model, provider, reasoning_effort, api_key }) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('mode', mode)
    if (model) fd.append('model', model)
    if (provider) fd.append('provider', provider)
    if (reasoning_effort) fd.append('reasoning_effort', reasoning_effort)
    if (api_key) fd.append('api_key', api_key)
    const r = await fetch(BASE + '/api/analyze', { method: 'POST', body: fd })
    if (!r.ok) {
      let detail = `analyze -> ${r.status}`
      try { const d = await r.json(); detail = d.error || detail } catch {}
      throw new Error(detail)
    }
    return r.json()
  },
}
