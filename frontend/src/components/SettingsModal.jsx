import React, { useState, useEffect } from 'react'

// Settings modal: shows provider status + lets users paste API keys.
// Keys entered here are stored in localStorage and sent per-request
// (the backend also reads them from env — UI keys override).
const KEY_STORAGE = 'nova_api_keys'

const PROVIDER_META = {
  nova:        { label: 'Amazon Nova',          key: 'NOVA_API_KEY',          placeholder: 'Amazon Nova API key' },
  foundry:     { label: 'Azure AI Foundry',     key: 'FOUNDRY_API_KEY',       placeholder: 'Azure Foundry API key' },
  gemini:      { label: 'Google Gemini',        key: 'GEMINI_API_KEY',        placeholder: 'Google Gemini API key' },
  cohere:      { label: 'Cohere',               key: 'COHERE_API_KEY',        placeholder: 'Cohere API key' },
  ollama:      { label: 'Local Ollama',         key: null,                    placeholder: null, note: 'Local — no key needed' },
  openrouter:  { label: 'OpenRouter',           key: 'OPENROUTER_API_KEY',    placeholder: 'sk-or-…' },
  hfrouter:    { label: 'HuggingFace Router',   key: 'HF_TOKEN',              placeholder: 'hf_…' },
  requesty:    { label: 'Requesty',             key: 'REQUESTY_API_KEY',      placeholder: 'rqsty-sk-…' },
  cloudflare:  { label: 'Cloudflare Workers AI', key: 'CLOUDFLARE_API_TOKEN', placeholder: 'Cloudflare API token' },
  mistral:     { label: 'Mistral AI',           key: 'MISTRAL_API_KEY',       placeholder: 'Mistral API key' },
}

function loadKeys() {
  try { return JSON.parse(localStorage.getItem(KEY_STORAGE) || '{}') } catch { return {} }
}
function saveKeys(keys) {
  localStorage.setItem(KEY_STORAGE, JSON.stringify(keys))
}

export default function SettingsModal({ open, onClose, health }) {
  const [keys, setKeys] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setKeys(loadKeys())
  }, [open])

  if (!open) return null
  const mask = (v) => (v ? '•'.repeat(8) + v.slice(-4) : '')

  const handleKey = (pid, val) => {
    setKeys({ ...keys, [pid]: val })
  }

  const save = () => {
    setSaving(true)
    saveKeys(keys)
    setTimeout(() => setSaving(false), 300)
  }

  const hasUICKey = (pid) => {
    const k = keys[pid]
    if (!k) return false
    // Masked placeholder check — if it's the masked display, it's not a real stored key
    return k !== mask(k)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
         onClick={onClose}>
      <div className="w-full max-w-2xl bg-panel border border-border rounded-2xl shadow-2xl m-4"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="font-semibold text-[15px] text-text">Provider Settings</h3>
          <button onClick={onClose} className="p-1 text-muted hover:text-text rounded transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-4 space-y-3 max-h-[500px] overflow-y-auto">
          <p className="text-[12px] text-muted mb-2">
            Keys you enter here are saved in your browser (<code className="text-[11px] bg-panel2 px-1 rounded">localStorage</code>)
            and sent with each request. They never touch the server's own env. Local Ollama needs no key.
          </p>
          {Object.entries(PROVIDER_META).map(([pid, meta]) => {
            const configured = health?.providers?.[pid]?.configured
            const uiKey = keys[pid]
            return (
              <div key={pid} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[13px] font-medium text-text">{meta.label}</label>
                  <span className="text-[11px] text-muted">
                    {configured ? '✓ configured on server' : 'not configured on server'}
                  </span>
                </div>
                {meta.key && (
                  <input
                    type="password"
                    value={uiKey ? mask(uiKey) : ''}
                    onChange={(e) => handleKey(pid, e.target.value)}
                    placeholder={meta.placeholder}
                    readOnly={uiKey ? true : false}
                    className="w-full text-[13px] px-3 py-2 bg-panel2 border border-border rounded-lg text-text outline-none focus:border-accent2"
                  />
                )}
                {meta.note && <span className="text-[11px] text-muted">{meta.note}</span>}
              </div>
            )
          })}
        </div>
        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button onClick={onClose}
            className="px-4 py-1.5 text-[13px] text-muted hover:text-text rounded-lg transition-colors">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-1.5 text-[13px] font-medium text-[#1a1000] bg-accent rounded-lg hover:brightness-105 disabled:opacity-50 transition-all"
          >
            {saving ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Helper to retrieve a UI key for a provider when sending requests.
export function getUIKey(provider) {
  try {
    const k = JSON.parse(localStorage.getItem(KEY_STORAGE) || '{}')
    return k[provider] || ''
  } catch { return '' }
}
export function getUIKeys() {
  try { return JSON.parse(localStorage.getItem(KEY_STORAGE) || '{}') } catch { return {} }
}
