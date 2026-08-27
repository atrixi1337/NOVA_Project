// Thin client around the FastAPI backend. All keys stay server-side; the UI
// only ever sends provider/model/agent flags and an optional key override.

const BASE = ''  // same origin (FastAPI serves this built frontend)

async function jget(path) {
  const r = await fetch(BASE + path, { headers: { Accept: 'application/json' } })
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`)
  return r.json()
}

async function jpost(path, body, opts = {}) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: JSON.stringify(body),
    ...(opts.extra || {}),
  })
  if (!r.ok) {
    let detail = `POST ${path} -> ${r.status}`
    try { const d = await r.json(); detail = d.detail || detail } catch {}
    throw new Error(detail)
  }
  return r.json()
}

async function jput(path, body) {
  const r = await fetch(BASE + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  })
  if (!r.ok) {
    let detail = `PUT ${path} -> ${r.status}`
    try { const d = await r.json(); detail = d.detail || detail } catch {}
    throw new Error(detail)
  }
  return r.json()
}

async function jdel(path) {
  const r = await fetch(BASE + path, { method: 'DELETE' })
  if (!r.ok) {
    let detail = `DELETE ${path} -> ${r.status}`
    try { const d = await r.json(); detail = d.detail || detail } catch {}
    throw new Error(detail)
  }
  return r.json()
}

export const api = {
  // models / providers
  models: () => jget('/api/models'),
  health: () => jget('/api/health'),

  // ollama
  ollamaStatus: () => jget('/api/ollama/status'),
  ollamaLoad: () => jpost('/api/ollama/load', {}),
  ollamaUnload: () => jpost('/api/ollama/unload', {}),

  // chat
  chat: (payload) => jpost('/api/chat', payload),

  // conversation history
  conversations: () => jget('/api/conversations'),
  newConversation: (body = {}) => jpost('/api/conversations', body),
  getConversation: (cid) => jget(`/api/conversations/${cid}`),
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
