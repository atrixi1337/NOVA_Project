import React, { useEffect, useRef, useState } from 'react'
import { api } from '../../api.js'
import { fmtMs, cleanLabel } from './util.js'

const CHIP = {
  ok: 'bg-ok/15 text-ok', empty: 'bg-accent/20 text-accent2', error: 'bg-err/15 text-err',
  'no-key': 'bg-panel2 text-muted', running: 'bg-panel2 text-muted', queued: 'bg-panel2 text-muted', done: 'bg-panel2 text-muted',
}

// One real chat ping per provider (and optionally per configured model), plus a live
// catalog lookup so stale/deprecated model ids (e.g. a retired mercury-2) are flagged.
export default function SanityPanel() {
  const [open, setOpen] = useState(false)
  const [deep, setDeep] = useState(false)
  const [job, setJob] = useState(null)
  const [err, setErr] = useState('')
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  const poll = async (id) => {
    try {
      const v = await api.sanityGet(id)
      setJob(v)
      if (v.status === 'running') timer.current = setTimeout(() => poll(id), 1500)
    } catch (e) { setErr(e.message) }
  }
  const start = async () => {
    setErr(''); setJob(null); clearTimeout(timer.current)
    try { const { job_id } = await api.sanityStart({ deep, catalog: true }); poll(job_id) } catch (e) { setErr(e.message) }
  }
  const running = job?.status === 'running'
  const entries = job ? Object.entries(job.providers) : []
  const summary = entries.reduce((a, [, p]) => {
    if (p.state === 'no-key') a.nokey++
    else p.models.forEach((m) => { a[m.status] = (a[m.status] || 0) + 1 })
    return a
  }, { ok: 0, empty: 0, error: 0, nokey: 0 })

  return (
    <div className="rounded-2xl border border-border/60 bg-panel2/40">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-4 py-3 text-left">
        <span className="text-[13px] font-medium text-text2">Provider sanity check</span>
        <span className="text-[11.5px] text-muted flex-1">real ping to every provider + stale-model detection</span>
        <span className="text-muted text-[11px]">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={start} disabled={running}
              className="px-4 py-1.5 rounded-full bg-accent text-white text-[12.5px] font-medium disabled:opacity-50 hover:brightness-110">
              {running ? 'Checking…' : 'Run sanity check'}
            </button>
            <label className="flex items-center gap-1.5 text-[12px] text-muted cursor-pointer">
              <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} className="accent-[rgb(var(--color-accent))]" disabled={running} />
              test every configured model (slower, more quota)
            </label>
            {job && <span className="text-[11.5px] text-muted">{summary.ok} ok · {summary.empty} empty · {summary.error} failing · {summary.nokey} no key</span>}
          </div>
          {err && <div className="text-[12px] text-err">{err}</div>}
          {entries.length > 0 && (
            <div className="space-y-1.5">
              {entries.map(([pid, p]) => (
                <div key={pid} className="rounded-xl bg-bg/40 border border-border/40 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12.5px] text-text2">{cleanLabel(p.label)}</span>
                    <span className={`text-[10.5px] px-2 py-0.5 rounded-full ${CHIP[p.state] || CHIP.queued}`}>{p.state === 'no-key' ? 'no key on server' : p.state}</span>
                    {p.catalog && (p.catalog.ok
                      ? <span className="text-[10.5px] text-muted">catalog: {p.catalog.size} models</span>
                      : <span className="text-[10.5px] text-muted/70" title={p.catalog.error}>catalog n/a</span>)}
                  </div>
                  {p.catalog?.ok && p.catalog.missing?.length > 0 && (
                    <div className="mt-1 text-[11.5px] text-accent2">⚠ configured but not in the provider's catalog: {p.catalog.missing.join(', ')}</div>
                  )}
                  {p.models.map((m) => (
                    <div key={m.model} className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px]">
                      <span className={`px-2 py-0.5 rounded-full ${CHIP[m.status]}`}>{m.status}</span>
                      <code className="font-mono text-text/90 break-all">{m.model}</code>
                      <span className="text-muted">{fmtMs(m.ms)}</span>
                      {m.note && <span className="text-muted/80 break-all">{m.note}</span>}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
