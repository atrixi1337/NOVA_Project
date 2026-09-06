import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { ChartBar, Clock } from './Icons.jsx'

const fmt = (n) => (typeof n === 'number' ? n.toLocaleString() : '—')
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
        <CardStat label="Prompt tokens" value={fmt(total.prompt_tokens)} />
        <CardStat label="Completion tokens" value={fmt(total.completion_tokens)} />
        <CardStat label="Total tokens" value={fmt(total.total_tokens)} />
        <CardStat label="LLM calls" value={fmt(total.calls)} note="recorded in usage ledger" />
      </div>

      {/* By model */}
      <Card title="Token usage by model" icon={<ChartBar className="w-4 h-4 text-accent2" />}>
        <Table
          cols={['Provider', 'Model', 'Prompt', 'Completion', 'Total', 'Calls']}
          rows={models.map((m) => [
            lab(m.provider), short(m.model, 32),
            fmt(m.prompt_tokens), fmt(m.completion_tokens),
            fmt(m.total_tokens), fmt(m.calls),
          ])}
          empty="No usage recorded yet."
        />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="By provider" icon={<ChartBar className="w-4 h-4 text-accent" />}>
          <Table
            cols={['Provider', 'Prompt', 'Completion', 'Total', 'Calls']}
            rows={providers.map((p) => [
              lab(p.provider), fmt(p.prompt_tokens), fmt(p.completion_tokens),
              fmt(p.total_tokens), fmt(p.calls),
            ])}
            empty="No usage recorded yet."
          />
        </Card>
        <Card title="Recent activity" icon={<Clock className="w-4 h-4 text-accent" />}>
          <Table
            cols={['Time', 'Provider', 'Model', 'Total']}
            rows={recent.slice(0, 12).map((r, i) => [
              ts(r.created_at), lab(r.provider), short(r.model, 24), fmt(r.total_tokens),
            ])}
            empty="No calls logged yet."
          />
        </Card>
      </div>

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

function CardStat({ label, value, note }) {
  return (
    <div className="rounded-xl border border-border bg-panel2 p-3">
      <div className="text-[11px] uppercase text-muted tracking-wider">{label}</div>
      <div className="text-[22px] font-medium text-text2 mt-0.5">{value}</div>
      {note && <div className="text-[10px] text-muted mt-0.5">{note}</div>}
    </div>
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
