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

export const api = {
  models: () => jget('/api/models'),
  health: () => jget('/api/health'),
  ollamaStatus: () => jget('/api/ollama/status'),
  ollamaLoad: () => jpost('/api/ollama/load', {}),
  ollamaUnload: () => jpost('/api/ollama/unload', {}),
  chat: (payload) => jpost('/api/chat', payload),
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
