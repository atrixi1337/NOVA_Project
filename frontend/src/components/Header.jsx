import React from 'react'

function Select({ label, value, onChange, options, disabled }) {
  return (
    <label className="flex items-center gap-2 text-[13px] text-muted">
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="bg-panel2 text-text border border-border rounded-lg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent2 disabled:opacity-50 transition-colors"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}

export default function Header({ state, actions }) {
  const {
    providers, defaultProvider, provider, model, agent, reasoningEffort,
    ollama, ollamaBusy,
  } = state
  const { setProvider, setModel, setAgent, setReasoning, ollamaLoad, ollamaUnload } = actions

  const provOpts = Object.entries(providers).map(([id, p]) => ({
    value: id,
    label: p.label + (id === defaultProvider ? ' (default)' : '')
           + (p.cloud ? ' ☁️' : ' 🟢'),
  }))
  const cur = providers[provider] || { models: [], default: '' }
  const modelOpts = (cur.models || []).map((m) => ({ value: m, label: m }))
  modelOpts.unshift({ value: 'auto', label: cur.default ? `auto (${cur.default})` : 'auto' })

  const reasoningValue = reasoningEffort === '' ? 1 : ['low', '', 'high'].indexOf(reasoningEffort)
  const reasoningLabels = ['off', 'low', 'high']

  return (
    <header className="flex flex-wrap items-center gap-3 px-4 py-2.5 bg-panel border-b border-border backdrop-blur-sm">
      <div className="font-bold text-[17px] flex items-center gap-2">
        <span className="text-accent">NOVA</span>
        <span className="text-text">Chat</span>
      </div>

      <Select label="Provider" value={provider} onChange={setProvider} options={provOpts} />
      <Select label="Model" value={model || 'auto'} onChange={setModel} options={modelOpts} />

      <label className="flex items-center gap-2 text-[13px] text-muted">
        <span>{reasoningEffort ? reasoningEffort : 'off'}</span>
        <input
          type="range" min="0" max="2" step="1"
          value={reasoningValue}
          onChange={(e) => setReasoning(reasoningEffort ? ['low', '', 'high'][+e.target.value] : ['low', '', 'high'][+e.target.value])}
          className="w-32 accent-accent2"
          title="Reasoning effort: off / low / high"
        />
      </label>

      <label className="flex items-center gap-2 text-[13px] text-muted cursor-pointer select-none">
        <input
          type="checkbox"
          checked={agent}
          onChange={(e) => setAgent(e.target.checked)}
          className="accent-accent w-4 h-4"
        />
        <span>Agent mode</span>
        <span className="text-[11px] text-accent2">• tools: get_time, calculate, read_file</span>
      </label>

      <div className="flex-1" />

      {provider === 'ollama' && (
        <div className="flex items-center gap-2.5">
          <span className={`text-[12px] font-medium ${
            ollama.loaded ? 'text-ok' : 'text-muted'
          }`}>
            {ollama.loaded ? `● ${ollama.model || 'loaded'}` : '○ unloaded'}
          </span>
          <button
            onClick={ollamaLoad}
            disabled={ollamaBusy || ollama.loaded}
            className="text-[12px] px-2.5 py-1 rounded-lg border border-border bg-panel2 hover:border-accent2 disabled:opacity-40 transition-colors"
          >
            {ollamaBusy ? '…' : 'Load'}
          </button>
          <button
            onClick={ollamaUnload}
            disabled={ollamaBusy || !ollama.loaded}
            className="text-[12px] px-2.5 py-1 rounded-lg border border-border bg-panel2 hover:border-err disabled:opacity-40 transition-colors"
          >
            Unload
          </button>
        </div>
      )}
    </header>
  )
}
