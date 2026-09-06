import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { ChartBar, Clock } from './Icons.jsx'

const fmt = (n) => (typeof n === 'number' ? n.toLocaleString() : '—')
// Compact token counter for cards/tables: 27316 -> 27.3k (exact value in title).
const fmtTok = (n) => (typeof n === 'number'
  ? (n >= 10000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : n.toLocaleString())
  : '—')
const lab = (s) => (s || s === 0 ? s : '—')
const short = (s, n = 28) => (!s ? '—' : s.length > n ? s.slice(0, n) + '…' : s)
const ts = (t) => (!t ? '—' : new Date(t * 1000).toLocaleString())

export default function UsageDashboard() {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = async () => {
    setBusy(true)
    setErr('')
    try {
      setData(await api.usage())
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => { load() }, [])

  const total = data?.total || {}
  const models = data?.by_model || []
  const providers = data?.by_provider || []
  const byDay = data?.by_day || []
  const actors = data?.by_actor || []
  const recent = data?.recent || []

  return (
    <div className="mx-auto max-w-5xl w-full p-4 sm:p-5 space-y-5">
      <header className="flex items-center justify-between">
        <h2 className="text-[16px] font-semibold text-text2 flex items-center gap-2">
          <ChartBar className="w-4 h-4 text-accent2" />
          Usage Dashboard
        </h2>
        <div className="flex items-center gap-3 text-[11px] text-muted">
          {data ? <span>since {ts(data.first_seen)}</span> : null}
          <button
            onClick={load}
            disabled={busy}
            className="px-2.5 py-1 text-[12px] rounded-lg border border-border bg-black hover:border-accent2 text-muted hover:text-text disabled:opacity-40 transition-all"
            title="Refresh"
          >
            {busy ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {err && <div className="text-[13px] text-err">{err}</div>}

      {/* Totals */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <CardStat label="Prompt tokens" value={fmtTok(total.prompt_tokens)} title={fmt(total.prompt_tokens)} />
        <CardStat label="Completion tokens" value={fmtTok(total.completion_tokens)} title={fmt(total.completion_tokens)} />
        <CardStat label="Total tokens" value={fmtTok(total.total_tokens)} title={fmt(total.total_tokens)} />
        <CardStat label="LLM calls" value={fmt(total.calls)} note="recorded in usage ledger" />
      </div>

      {/* Daily sparkline (data already comes from /api/usage by_day) */}
      {byDay.length >= 2 && (
        <Card title="Tokens · last 30 days" icon={<ChartBar className="w-4 h-4 text-accent" />}>
          <Sparkline points={byDay.slice(0, 30).reverse().map((d) => d.total_tokens || 0)} />
          <div className="flex justify-between text-[10px] text-muted">
            <span>{byDay.slice(0, 30).reverse()[0]?.date}</span>
            <span>peak {fmtTok(Math.max(...byDay.slice(0, 30).map((d) => d.total_tokens || 0)))}</span>
            <span>{byDay[0]?.date}</span>
          </div>
        </Card>
      )}

      {/* By model */}
      <Card title="Token usage by model" icon={<ChartBar className="w-4 h-4 text-accent2" />}>
        <Table
          cols={['Provider', 'Model', 'Prompt', 'Completion', 'Total', 'Calls']}
          rows={models.map((m) => [
            lab(m.provider), short(m.model, 32),
            fmtTok(m.prompt_tokens), fmtTok(m.completion_tokens),
            fmtTok(m.total_tokens), fmt(m.calls),
          ])}
          empty="No usage recorded yet."
        />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="By provider" icon={<ChartBar className="w-4 h-4 text-accent" />}>
          <Table
            cols={['Provider', 'Prompt', 'Completion', 'Total', 'Calls']}
            rows={providers.map((p) => [
              lab(p.provider), fmtTok(p.prompt_tokens), fmtTok(p.completion_tokens),
              fmtTok(p.total_tokens), fmt(p.calls),
            ])}
            empty="No usage recorded yet."
          />
        </Card>
        <Card title="Recent activity" icon={<Clock className="w-4 h-4 text-accent" />}>
          <Table
            cols={['Time', 'Provider', 'Model', 'Total']}
            rows={recent.slice(0, 12).map((r, i) => [
              ts(r.created_at), lab(r.provider), short(r.model, 24), fmtTok(r.total_tokens),
            ])}
            empty="No calls logged yet."
          />
        </Card>
      </div>

      {/* Per-person attribution (named auth tokens record who caused usage) */}
      {actors.length > 0 && (
        <Card title="By person" icon={<Clock className="w-4 h-4 text-accent2" />}>
          <Table
            cols={['Actor', 'Prompt', 'Completion', 'Total', 'Calls']}
            rows={actors.map((a) => [
              lab(a.actor), fmtTok(a.prompt_tokens), fmtTok(a.completion_tokens),
              fmtTok(a.total_tokens), fmt(a.calls),
            ])}
            empty="No usage recorded yet."
          />
        </Card>
      )}

      <div className="text-[11px] text-muted/60">
        Usage is persisted for the lifetime of the app in the phone's local SQLite
        <code className="mx-0.5 px-1 rounded bg-black text-[10px] text-text2/60">usage_ledger</code>
        — it survives chat clears and deletions. This is aggregate token accounting,
        not pricing; cloud providers still enforce their own safety filters per call.
      </div>
    </div>
  )
}

function Card({ title, icon, children }) {
  return (
    <div className="rounded-xl border border-border bg-panel2 p-4 space-y-3">
      <div className="font-semibold text-text text-[14px] flex items-center gap-2">{icon}{title}</div>
      {children}
    </div>
  )
}

function CardStat({ label, value, note, title }) {
  return (
    <div className="rounded-xl border border-border bg-panel2 p-3" title={title || undefined}>
      <div className="text-[11px] uppercase text-muted tracking-wider">{label}</div>
      <div className="text-[22px] font-medium text-text2 mt-0.5">{value}</div>
      {note && <div className="text-[10px] text-muted mt-0.5">{note}</div>}
    </div>
  )
}

// Dependency-free SVG sparkline of total tokens per day (oldest → newest).
function Sparkline({ points = [] }) {
  if (!points.length) return null
  const w = 560, h = 90, pad = 6
  const max = Math.max(...points, 1)
  const step = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0
  const coords = points.map((v, i) => [pad + i * step, h - pad - (v / max) * (h - pad * 2)])
  const path = coords.map((c, i) => `${i ? 'L' : 'M'}${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' ')
  const last = coords[coords.length - 1]
  const area = `${path} L${last[0].toFixed(1)},${h - pad} L${pad},${h - pad} Z`
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-24" preserveAspectRatio="none" role="img" aria-label="Daily token usage">
      <path d={area} fill="rgba(201,162,39,0.12)" />
      <path d={path} fill="none" stroke="#c9a227" strokeWidth="2" />
      <circle cx={last[0]} cy={last[1]} r="3" fill="#c9a227" />
    </svg>
  )
}

function Table({ cols, rows, empty }) {
  return (
    <div className="overflow-x-auto">
      {rows.length === 0 ? (
        <div className="text-[12px] text-muted">{empty}</div>
      ) : (
        <table className="w-full text-[12px]">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c} className="text-left text-[10px] font-mono uppercase text-muted pb-1 pr-2 whitespace-nowrap">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border/30">
                {r.map((c, j) => (
                  <td key={j} className="py-1 pr-2 text-text2 font-mono truncate whitespace-nowrap">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
