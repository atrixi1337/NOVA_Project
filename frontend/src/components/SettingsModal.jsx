import React, { useState, useRef, useEffect } from 'react'
import { api } from '../api.js'

// Store API keys in localStorage (overrides server-side keys per-request)
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

// Settings modal: provider/model selection, API keys, reasoning, agent mode, ollama.
export default function SettingsModal({
  open, onClose,
  providers, defaultProvider, provider, model,
  setProvider, setModel, setAgent, setReasoning,
  agent, reasoningEffort,
  ollama, ollamaBusy, ollamaLoad, ollamaUnload,
  health,
  malayalamMode = false,
  setMalayalamMode,
}) {
  const [keys, setKeys] = useState({})
  const [saving, setSaving] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    if (open) setKeys(loadKeys())
  }, [open])

  if (!open) return null

  const cur = providers[provider] || { models: [], default: '' }
  const modelOpts = (cur.models || []).map((m) => ({ value: m, label: m }))
  modelOpts.unshift({ value: 'auto', label: cur.default ? `auto (${cur.default})` : 'auto' })

  const provOpts = Object.entries(providers).map(([id, p]) => ({
    value: id,
    label: p.label + (id === defaultProvider ? ' (default)' : ''),
  }))

  const handleKey = (pid, val) => {
    setKeys({ ...keys, [pid]: val })
  }

  const saveKeysHandler = () => {
    setSaving(true)
    saveKeys(keys)
    setTimeout(() => setSaving(false), 300)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
         onClick={onClose}>
      <div className="w-full max-w-lg bg-panel2 border border-border rounded-2xl shadow-2xl m-4 max-h-[85vh] overflow-y-auto"
           onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="font-semibold text-[15px] text-text">Settings</h3>
          <button onClick={onClose} className="p-1 text-muted hover:text-text rounded transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-5">

          {/* ── Provider & Model ── */}
          <div className="space-y-3">
            <h4 className="text-[12px] font-semibold text-muted uppercase tracking-wider">Provider & Model</h4>
            <div>
              <label className="block text-[12px] text-muted mb-1">Provider</label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                disabled={malayalamMode}
                className="w-full text-[13px] px-3 py-2 bg-black border border-border rounded-lg text-text outline-none focus:border-accent2 transition-colors disabled:opacity-60"
              >
                {provOpts.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {malayalamMode && (
                <p className="text-[11px] text-muted/60 mt-1">Locked to Gemini in Malayalam mode.</p>
              )}
            </div>
            <div>
              <label className="block text-[12px] text-muted mb-1">Model</label>
              <select
                value={model || 'auto'}
                onChange={(e) => setModel(e.target.value)}
                disabled={malayalamMode}
                className="w-full text-[13px] px-3 py-2 bg-black border border-border rounded-lg text-text outline-none focus:border-accent2 transition-colors disabled:opacity-60"
              >
                {modelOpts.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            {cur.cloud && (
              <div className="text-[11px] text-muted/60">
                Cloud provider (censored). Local Ollama is the only uncensored option.
              </div>
            )}
          </div>

          {/* ── Reasoning & Agent ── */}
          <div className="space-y-3">
            <h4 className="text-[12px] font-semibold text-muted uppercase tracking-wider">Chat Options</h4>
            <div className="flex items-center gap-3">
              <span className="text-[13px] text-muted">Agent mode</span>
              <label className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors">
                <input
                  type="checkbox"
                  checked={agent}
                  onChange={(e) => setAgent(e.target.checked)}
                  className="sr-only"
                />
                <span className={`inline-block h-5 w-9 rounded-full transition-colors ${agent ? 'bg-accent2' : 'bg-border'}`}>
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-panel2 transition-transform ${agent ? 'translate-x-5' : 'translate-x-1'}`} />
                </span>
              </label>
            </div>
            <div>
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-muted">Reasoning effort</span>
                <span className="text-text font-medium">{reasoningEffort || 'off'}</span>
              </div>
              <div className="mt-1">
                <select
                  value={reasoningEffort || ''}
                  onChange={(e) => setReasoning(e.target.value)}
                  className="w-full text-[13px] px-3 py-2 bg-black border border-border rounded-lg text-text outline-none focus:border-accent2 transition-colors"
                >
                  <option value="">Off</option>
                  <option value="low">Low</option>
                  <option value="high">High</option>
                </select>
              </div>
            </div>
          </div>

          {/* ── Language Mode (Malayalam) ── */}
          <div className="space-y-3">
            <h4 className="text-[12px] font-semibold text-muted uppercase tracking-wider">Language Mode</h4>
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-text">Malayalam mode (Gemini)</span>
              <label className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors">
                <input
                  type="checkbox"
                  checked={!!malayalamMode}
                  onChange={(e) => setMalayalamMode(e.target.checked)}
                  className="sr-only"
                />
                <span className={`inline-block h-5 w-9 rounded-full transition-colors ${malayalamMode ? 'bg-accent2' : 'bg-border'}`}>
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-panel2 transition-transform ${malayalamMode ? 'translate-x-5' : 'translate-x-1'}`} />
                </span>
              </label>
            </div>
            <p className="text-[11px] text-muted/60">
              Routes chats through Gemini and prompts it to reply only in Malayalam
              (script or Manglish, e.g. "sugamano").
            </p>
          </div>

          {/* ── Ollama ── */}
          {provider === 'ollama' && (
            <div className="space-y-3">
              <h4 className="text-[12px] font-semibold text-muted uppercase tracking-wider">Local Ollama</h4>
              <div className="flex items-center gap-2.5">
                <span className={`text-[13px] font-medium ${ollama.loaded ? 'text-ok' : 'text-muted'}`}>
                  {ollama.loaded ? `● ${ollama.model || 'loaded'}` : '○ not loaded'}
                </span>
                <button
                  onClick={ollamaLoad}
                  disabled={ollamaBusy || ollama.loaded}
                  className="text-[12px] px-3 py-1.5 rounded-lg border border-border bg-black hover:border-accent2 disabled:opacity-40 transition-all"
                >{ollamaBusy ? '...' : 'Load'}</button>
                <button
                  onClick={ollamaUnload}
                  disabled={ollamaBusy || !ollama.loaded}
                  className="text-[12px] px-3 py-1.5 rounded-lg border border-border bg-black hover:border-err disabled:opacity-40 transition-all"
                >Unload</button>
              </div>
            </div>
          )}

          {/* ── API Keys ── */}
          <div className="space-y-3">
            <h4 className="text-[12px] font-semibold text-muted uppercase tracking-wider">API Keys (optional override)</h4>
            <p className="text-[11px] text-muted/60">
              Keys entered here are saved in your browser (<code className="text-[10px] bg-black px-1 rounded">localStorage</code>)
              and sent with each request. Leave blank to use server-configured keys.
            </p>
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {Object.entries(PROVIDER_META).map(([pid, meta]) => {
                const configured = health?.providers?.[pid]?.configured
                const uiKey = keys[pid]
                return (
                  <div key={pid} className="space-y-1">
                    <div className="flex items-center justify-between text-[13px]">
                      <label className="text-text">{meta.label}</label>
                      <span className="text-[11px] text-muted/60">
                        {configured ? '✓ on server' : 'not set'}
                      </span>
                    </div>
                    {meta.key && (
                      <input
                        type="password"
                        value={uiKey || ''}
                        onChange={(e) => handleKey(pid, e.target.value)}
                        placeholder={meta.placeholder}
                        className="w-full text-[13px] px-3 py-2 bg-black border border-border rounded-lg text-text outline-none focus:border-accent2 transition-colors placeholder:text-muted/40"
                      />
                    )}
                    {meta.note && <span className="text-[11px] text-muted">{meta.note}</span>}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button onClick={onClose}
            className="px-4 py-1.5 text-[13px] text-muted hover:text-text rounded-lg transition-colors">
            Close
          </button>
          <button
            onClick={saveKeysHandler}
            disabled={saving}
            className="px-4 py-1.5 text-[13px] font-medium text-black bg-accent rounded-lg hover:brightness-90 disabled:opacity-50 transition-all"
          >
            {saving ? 'Saved' : 'Save Keys'}
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
