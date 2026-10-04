import React, { useState } from 'react'
import { api } from '../api.js'

// F16 — Provider benchmark harness.
//
// Answers the lab's real question ("which of these providers is actually good
// enough, and what does it cost?") by firing a fixed prompt suite at every
// chosen provider and recording latency / tokens / cost per cell.
//
// The backend bounds concurrency, so this stays usable on a phone.

const PROVIDER_ORDER = [
  'foundry', 'gemini', 'nova', 'inception', 'infron', 'cohere', 'ollama',
  'hfrouter', 'requesty', 'cloudflare', 'mistral', 'gmi', 'upstage', 'reka',
  'nvidia', 'agnes', 'ifm',
]

function fmtMs(ms) {
  if (ms == null) return '—'
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

function fmtCost(c) {
  if (c == null) return '—'
  return c === 0 ? 'free' : `$${c.toFixed(6)}`
}

export default function BenchTab({ health = {}, providers = {} }) {
  const [suite, setSuite] = useState(
    'Reply with exactly: OK\nIn one sentence, what is a SQL injection?'
  )
  const [selected, setSelected] = useState([])
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [history, setHistory] = useState([])
  const [err, setErr] = useState('')

  const configured = PROVIDER_ORDER.filter((p) => health?.providers?.[p]?.configured)

  const toggle = (pid) => {
    setSelected((s) => (s.includes(pid) ? s.filter((x) => x !== pid) : [...s, pid]))
  }

  const loadHistory = async () => {
    try {
      const res = await api.benchHistory(50)
      setHistory(res.runs || [])
    } catch (e) { setErr(e.message) }
  }

  const run = async () => {
    setErr('')
    setResult(null)
    const prompts = suite.split('\n').map((s) => s.trim()).filter(Boolean)
    if (!prompts.length) { setErr('Add at least one prompt.'); return }
    const targets = selected.length ? selected : configured
    if (!targets.length) { setErr('No providers with a configured key.'); return }
    setRunning(true)
    try {
      const res = await api.benchRun({ suite: prompts, providers: targets })
      setResult(res)
      loadHistory()
    } catch (e) {
      setErr(e.message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="p-4 space-y-4 max-w-4xl">
      <header>
        <h2 className="text-lg font-semibold text-text">Provider benchmark</h2>
        <p className="text-[12px] text-muted mt-0.5">
          Fire a fixed prompt suite at several providers and compare latency, tokens and cost.
          This spends real quota — keep the suite short.
        </p>
      </header>

      <div className="space-y-2">
        <label className="block text-[12px] text-muted">
          Prompt suite (one per line)
        </label>
        <textarea
          value={suite}
          onChange={(e) => setSuite(e.target.value)}
          rows={4}
          className="w-full bg-panel2 text-text text-[13px] font-mono p-2 rounded-lg border border-border outline-none focus:border-accent2"
        />
        <p className="text-[11px] text-muted">
          {suite.split('\n').filter((s) => s.trim()).length} prompt(s) ×{' '}
          {(selected.length || configured.length)} provider(s) ={' '}
          {suite.split('\n').filter((s) => s.trim()).length * (selected.length || configured.length)} calls
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[12px] text-muted">Providers</label>
          <button
            onClick={() => setSelected(selected.length === configured.length ? [] : [...configured])}
            className="text-[11px] text-accent2 hover:underline"
          >
            {selected.length === configured.length ? 'Clear' : 'Select all configured'}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PROVIDER_ORDER.map((pid) => {
            const on = configured.includes(pid)
            const sel = selected.includes(pid)
            return (
              <button
                key={pid}
                disabled={!on}
                onClick={() => toggle(pid)}
                className={`px-2 py-1 text-[11px] rounded-lg border transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                  sel
                    ? 'border-accent2 bg-accent2/15 text-text'
                    : 'border-border text-muted hover:bg-panel2'
                }`}
                title={on ? providers?.[pid]?.label || pid : 'No key configured'}
              >
                {providers?.[pid]?.label || pid}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={run}
          disabled={running}
          className="px-3 py-1.5 text-[13px] rounded-lg bg-accent2 text-bg font-medium disabled:opacity-50"
        >
          {running ? 'Running…' : 'Run benchmark'}
        </button>
        <button onClick={loadHistory} className="text-[12px] text-muted hover:text-text">
          Refresh history
        </button>
        {err && <span className="text-[12px] text-err">{err}</span>}
      </div>

      {result && (
        <section className="space-y-2">
          <div className="text-[12px] text-muted">
            {result.summary.ok}/{result.summary.cells} ok · median{' '}
            {fmtMs(result.summary.median_latency_ms)} · total {fmtCost(result.summary.total_cost_usd)}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="text-muted text-left">
                <tr>
                  <th className="py-1 pr-2 font-medium">Provider</th>
                  <th className="py-1 pr-2 font-medium">Model</th>
                  <th className="py-1 pr-2 font-medium">Latency</th>
                  <th className="py-1 pr-2 font-medium">Tokens</th>
                  <th className="py-1 pr-2 font-medium">Cost</th>
                  <th className="py-1 font-medium">Result</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {(result.results || []).map((c, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td className="py-1 pr-2 text-text">{c.provider}</td>
                    <td className="py-1 pr-2 text-muted truncate max-w-[10rem]">{c.model}</td>
                    <td className="py-1 pr-2 text-muted">{fmtMs(c.latency_ms)}</td>
                    <td className="py-1 pr-2 text-muted">{c.usage?.total_tokens ?? '—'}</td>
                    <td className="py-1 pr-2 text-muted">{fmtCost(c.cost_usd)}</td>
                    <td className="py-1">
                      {c.status === 'ok' ? (
                        <span className="text-accent2 truncate block max-w-[16rem]">{c.excerpt}</span>
                      ) : (
                        <span className="text-err truncate block max-w-[16rem]">{c.error}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section className="space-y-1.5">
          <h3 className="text-[13px] font-medium text-text">Recent cells</h3>
          <div className="space-y-1">
            {history.slice(0, 25).map((h) => (
              <div
                key={h.id}
                className="flex items-center gap-2 text-[11px] font-mono text-muted border-b border-border/40 pb-1"
              >
                <span className={h.status === 'ok' ? 'text-accent2 w-8' : 'text-err w-8'}>
                  {h.status}
                </span>
                <span className="text-text w-24 truncate">{h.provider}</span>
                <span className="w-16">{fmtMs(h.latency_ms)}</span>
                <span className="w-16">{h.total_tokens ?? '—'} tok</span>
                <span className="w-20">{fmtCost(h.cost_usd)}</span>
                <span className="truncate flex-1">{h.error || h.output_excerpt}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
