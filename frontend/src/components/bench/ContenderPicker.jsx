import React, { useMemo, useState } from 'react'
import { keyOf, cleanLabel, providerHue } from './util.js'

// Pick any number of provider/model "contenders". One provider can contribute many
// models (NVIDIA NIM exposes dozens). Unconfigured providers are listed but disabled.
export default function ContenderPicker({ providers = {}, health, selected, setSelected, disabled }) {
  const [open, setOpen] = useState({})
  const [filter, setFilter] = useState({})

  const isConfigured = (pid) => health?.providers?.[pid]?.configured === true
  const rows = useMemo(() => {
    const all = Object.entries(providers).map(([pid, p]) => ({ pid, ...p, cfg: isConfigured(pid) }))
    return {
      ready: all.filter((r) => r.cfg).sort((a, b) => a.label.localeCompare(b.label)),
      missing: all.filter((r) => !r.cfg),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers, health])

  const toggle = (pid, model) => {
    const k = keyOf(pid, model)
    setSelected((s) => {
      const n = { ...s }
      if (n[k]) delete n[k]
      else n[k] = { provider: pid, model }
      return n
    })
  }
  const setMany = (pid, models, on) =>
    setSelected((s) => {
      const n = { ...s }
      models.forEach((m) => { if (on) n[keyOf(pid, m)] = { provider: pid, model: m }; else delete n[keyOf(pid, m)] })
      return n
    })
  const defaults = () =>
    setSelected(Object.fromEntries(rows.ready.map((r) => [keyOf(r.pid, r.default), { provider: r.pid, model: r.default }])))
  const count = Object.keys(selected).length

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium text-text2">Contenders</span>
        <span className={`text-[11px] px-2 py-0.5 rounded-full ${count ? 'bg-accent/20 text-accent2' : 'bg-panel2 text-muted'}`}>
          {count} selected
        </span>
        <span className="flex-1" />
        <button disabled={disabled} onClick={defaults}
          className="text-[11.5px] px-3 py-1 rounded-full bg-panel2 border border-border/60 text-muted hover:text-text hover:border-accent/50 transition-colors disabled:opacity-50">
          Default model of every provider
        </button>
        <button disabled={disabled || !count} onClick={() => setSelected({})}
          className="text-[11.5px] px-3 py-1 rounded-full bg-panel2 border border-border/60 text-muted hover:text-text transition-colors disabled:opacity-40">
          Clear
        </button>
      </div>

      <div className="rounded-2xl border border-border/60 bg-panel2/40 divide-y divide-border/50 overflow-hidden">
        {rows.ready.map((r) => {
          const models = r.models?.length ? r.models : [r.default]
          const nSel = models.filter((m) => selected[keyOf(r.pid, m)]).length
          const isOpen = !!open[r.pid]
          const f = (filter[r.pid] || '').toLowerCase()
          const shown = f ? models.filter((m) => m.toLowerCase().includes(f)) : models
          return (
            <div key={r.pid}>
              <div className="flex items-center gap-2 px-3 py-2">
                <input type="checkbox" disabled={disabled} aria-label={`${r.label} default model`}
                  checked={!!selected[keyOf(r.pid, r.default)]}
                  onChange={() => toggle(r.pid, r.default)} className="accent-[rgb(var(--color-accent))] w-4 h-4" />
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: `hsl(${providerHue(r.pid)} 55% 58%)` }} />
                <button className="flex-1 min-w-0 text-left" onClick={() => setOpen((o) => ({ ...o, [r.pid]: !o[r.pid] }))}>
                  <span className="text-[13px] text-text2">{cleanLabel(r.label)}</span>
                  <span className="ml-2 text-[11px] text-muted truncate">{r.default}</span>
                </button>
                {nSel > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-accent/20 text-accent2">{nSel}/{models.length}</span>}
                {models.length > 1 && (
                  <button onClick={() => setOpen((o) => ({ ...o, [r.pid]: !o[r.pid] }))}
                    className="text-[11px] px-2 py-1 rounded-full text-muted hover:text-text hover:bg-panel2 transition-colors">
                    {models.length} models {isOpen ? '▴' : '▾'}
                  </button>
                )}
              </div>
              {isOpen && (
                <div className="px-3 pb-3 pl-9 space-y-2">
                  <div className="flex items-center gap-2">
                    {models.length > 8 && (
                      <input value={filter[r.pid] || ''} onChange={(e) => setFilter((x) => ({ ...x, [r.pid]: e.target.value }))}
                        placeholder="Filter models…" aria-label={`Filter ${r.label} models`}
                        className="flex-1 min-w-0 bg-bg border border-border rounded-full px-3 py-1 text-[12px] outline-none focus:border-accent" />
                    )}
                    <button disabled={disabled} onClick={() => setMany(r.pid, shown, true)} className="text-[11px] text-accent2 hover:underline">all{f ? ' shown' : ''}</button>
                    <button disabled={disabled} onClick={() => setMany(r.pid, models, false)} className="text-[11px] text-muted hover:underline">none</button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {shown.map((m) => {
                      const on = !!selected[keyOf(r.pid, m)]
                      return (
                        <button key={m} disabled={disabled} onClick={() => toggle(r.pid, m)} aria-pressed={on} title={m}
                          className={`max-w-full truncate px-2.5 py-1 rounded-full border text-[11.5px] transition-colors disabled:opacity-60 ${
                            on ? 'bg-accent text-white border-accent' : 'bg-bg/60 text-muted border-border/70 hover:text-text hover:border-accent/50'}`}>
                          {m}
                        </button>
                      )
                    })}
                    {!shown.length && <span className="text-[11px] text-muted">No models match.</span>}
                  </div>
                </div>
              )}
            </div>
          )
        })}
        {!rows.ready.length && <div className="px-3 py-4 text-[12px] text-muted">No providers have an API key on this server.</div>}
      </div>
      {rows.missing.length > 0 && (
        <p className="text-[11px] text-muted/80">
          No key on server: {rows.missing.map((r) => cleanLabel(r.label)).join(', ')}.
        </p>
      )}
    </div>
  )
}
