import React, { useMemo, useState } from 'react'
import { Markdown } from '../Message.jsx'
import { fmtMs, fmtCost, fmtTok, scoreStyle, cleanLabel, providerHue, downloadFile, csvCell, keyOf } from './util.js'

function ScoreBar({ v }) {
  if (v == null) return <span className="text-muted">—</span>
  return (
    <div className="flex items-center gap-2 min-w-[96px]">
      <div className="flex-1 h-1.5 rounded-full bg-border/60 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.max(2, v)}%`, background: `hsl(${Math.min(120, v * 1.2)} 60% 50%)` }} />
      </div>
      <span className="text-[12px] tabular-nums text-text2 w-9 text-right">{v.toFixed(0)}</span>
    </div>
  )
}

function ModelName({ row }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: `hsl(${providerHue(row.provider)} 55% 58%)` }} />
        <span className="text-[12.5px] text-text2 truncate max-w-[260px]" title={row.model}>{row.model}</span>
        {row.self_judged && <span title="This model also acted as the judge — self-grading tends to inflate scores" className="text-[10px] px-1.5 rounded-full bg-accent/20 text-accent2">self-judged</span>}
      </div>
      <div className="text-[10.5px] text-muted pl-3.5">{row.provider}</div>
    </div>
  )
}

function Detail({ cell, onClose }) {
  if (!cell) return null
  const j = cell.judge
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Cell detail" onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-2xl max-h-[88vh] overflow-y-auto bg-panel2 border border-border/70 rounded-t-3xl sm:rounded-3xl shadow-float">
        <div className="sticky top-0 bg-panel2/95 backdrop-blur flex items-start gap-3 px-5 pt-4 pb-3 border-b border-border/60">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-text2 truncate">{cell.model}</div>
            <div className="text-[11.5px] text-muted truncate">{cell.provider} · {cell.title}</div>
          </div>
          <div className="text-[18px] font-semibold tabular-nums px-3 py-0.5 rounded-xl" style={scoreStyle(cell.score)}>
            {cell.score == null ? '—' : cell.score.toFixed(0)}
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-full text-muted hover:text-text hover:bg-bg/40">✕</button>
        </div>
        <div className="p-5 space-y-4 text-[13px]">
          {cell.status === 'error' && <div className="rounded-xl border border-err/40 bg-err/10 p-3 text-err">{cell.error}</div>}
          <div className="flex flex-wrap gap-2 text-[11.5px] text-muted">
            <span className="px-2 py-0.5 rounded-full bg-bg/50">{fmtMs(cell.latency_ms)}</span>
            <span className="px-2 py-0.5 rounded-full bg-bg/50">{fmtTok(cell.total_tokens)} tok</span>
            <span className="px-2 py-0.5 rounded-full bg-bg/50">{fmtCost(cell.cost_usd)}</span>
            <span className="px-2 py-0.5 rounded-full bg-bg/50">{cell.category}</span>
          </div>
          {j && (
            <div className="rounded-2xl bg-bg/40 border border-border/50 p-3 space-y-2">
              <div className="text-[11px] uppercase tracking-wide text-muted">Judge · {j.verdict || 'graded'}</div>
              <p className="text-text">{j.rationale}</p>
              {j.criteria?.length > 0 && (
                <ul className="space-y-1">
                  {j.criteria.map((c, i) => (
                    <li key={i} className="flex gap-2 text-[12px]"><span className={c.met ? 'text-ok' : 'text-err'}>{c.met ? '✓' : '✗'}</span><span className="text-text/90">{c.criterion}</span></li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {cell.judge_error && <div className="text-[12px] text-accent2">Judge note: {cell.judge_error}</div>}
          {cell.det?.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted mb-1">Automatic checks · {cell.det_passed}/{cell.det_total}</div>
              <div className="flex flex-wrap gap-1.5">
                {cell.det.map((d, i) => (
                  <span key={i} className={`text-[11px] px-2 py-0.5 rounded-full ${d.ok ? 'bg-ok/15 text-ok' : 'bg-err/15 text-err'}`}>{d.ok ? '✓' : '✗'} {d.label}</span>
                ))}
              </div>
            </div>
          )}
          {cell.status === 'ok' && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted mb-1">
                Answer{cell.output_len > (cell.output || '').length ? ` (first ${(cell.output || '').length} of ${cell.output_len} chars — open again once the run finishes for the full text)` : ''}
              </div>
              <div className="rounded-2xl bg-bg/40 border border-border/50 p-3 max-h-[320px] overflow-y-auto"><Markdown content={cell.output || ''} /></div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Results({ view, onDelete }) {
  const [detail, setDetail] = useState(null)
  const lb = view.leaderboard || []
  const tasks = view.tasks || []
  const cellMap = useMemo(() => {
    const m = {}
    ;(view.cells || []).forEach((c) => { m[`${c.key}|${c.task_id}`] = c })
    return m
  }, [view.cells])
  const cats = useMemo(() => [...new Set(tasks.map((t) => t.category))], [tasks])
  const running = view.status === 'running'

  // SOC-lab recommendation: best model for the alert-triage category (what triage-agent actually does).
  const triage = useMemo(() => {
    const rows = lb.filter((r) => r.categories?.['Alert triage'] != null && r.errors < r.tasks)
    return rows.sort((a, b) => b.categories['Alert triage'] - a.categories['Alert triage'] || (b.avg_score ?? 0) - (a.avg_score ?? 0) || (a.median_latency_ms ?? 1e9) - (b.median_latency_ms ?? 1e9)).slice(0, 3)
  }, [lb])
  const [copied, setCopied] = useState('')
  const copy = (txt) => { try { navigator.clipboard.writeText(txt); setCopied(txt); setTimeout(() => setCopied(''), 1500) } catch {} }

  const exportCsv = () => {
    const head = ['rank', 'provider', 'model', 'avg_score', 'pass_rate', 'check_pass', 'errors', 'median_latency_ms', 'tokens', 'cost_usd', ...cats.map((c) => `cat:${c}`)]
    const lines = [head.join(',')].concat(lb.map((r) => [r.rank, r.provider, r.model, r.avg_score, r.pass_rate, r.check_pass, r.errors, r.median_latency_ms, r.tokens, r.cost_usd, ...cats.map((c) => r.categories?.[c])].map(csvCell).join(',')))
    downloadFile(`benchmark-${view.id}.csv`, lines.join('\n'), 'text/csv')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[14px] font-semibold text-text2">Leaderboard</h3>
        <span className="text-[11.5px] text-muted">
          {view.judge ? <>judged by <b className="text-text2">{view.judge.model}</b></> : 'no judge — deterministic checks only'}
          {' · '}pass ≥ {view.pass_score}
        </span>
        <span className="flex-1" />
        <button onClick={exportCsv} className="text-[11.5px] px-3 py-1 rounded-full bg-panel2 border border-border/60 text-muted hover:text-text">CSV</button>
        <button onClick={() => downloadFile(`benchmark-${view.id}.json`, JSON.stringify(view, null, 2), 'application/json')}
          className="text-[11.5px] px-3 py-1 rounded-full bg-panel2 border border-border/60 text-muted hover:text-text">JSON</button>
        {!running && onDelete && <button onClick={onDelete} className="text-[11.5px] px-3 py-1 rounded-full text-err/80 hover:bg-err/10">Delete run</button>}
      </div>

      {view.suite_id === 'soc' && triage.length > 0 && (
        <div className="rounded-2xl border border-accent/30 bg-accent/10 p-4 space-y-2">
          <div className="text-[13px] font-semibold text-text2">Best for your SOC triage agent</div>
          <p className="text-[11.5px] text-muted">
            Ranked on the “Alert triage” tasks — the job <code className="font-mono">triage-agent</code> does (strict-JSON verdicts on Wazuh alerts). The id below is the NOVA gateway model name.
          </p>
          <ul className="space-y-1.5">
            {triage.map((r, i) => {
              const gw = keyOf(r.provider, r.model)
              return (
                <li key={r.key} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                  <span className="w-5 text-muted">#{i + 1}</span>
                  <code className="font-mono text-text2 break-all">{gw}</code>
                  <span className="text-muted">triage {r.categories['Alert triage'].toFixed(0)} · overall {r.avg_score?.toFixed(0)} · {fmtMs(r.median_latency_ms)}</span>
                  <span className="flex-1" />
                  <button onClick={() => copy(`TRIAGE_LLM_MODEL=${gw}`)} className="text-[11px] px-2.5 py-0.5 rounded-full bg-bg/50 border border-border/60 text-muted hover:text-text">
                    {copied === `TRIAGE_LLM_MODEL=${gw}` ? 'copied' : 'copy TRIAGE_LLM_MODEL'}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-border/60 bg-panel2/40">
        <table className="w-full text-[12px] min-w-[760px]">
          <thead>
            <tr className="text-left text-muted text-[10.5px] uppercase tracking-wide">
              <th className="px-3 py-2 w-8">#</th><th className="px-2 py-2">Model</th><th className="px-2 py-2">Score</th>
              <th className="px-2 py-2 text-right">Pass</th><th className="px-2 py-2 text-right" title="Deterministic checks passed">Checks</th>
              <th className="px-2 py-2 text-right">Errors</th><th className="px-2 py-2 text-right">Median</th>
              <th className="px-2 py-2 text-right">Tokens</th><th className="px-3 py-2 text-right">Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {lb.map((r) => (
              <tr key={r.key} className="hover:bg-bg/30">
                <td className="px-3 py-2 text-muted tabular-nums">{r.rank}</td>
                <td className="px-2 py-2"><ModelName row={r} /></td>
                <td className="px-2 py-2"><ScoreBar v={r.avg_score} /></td>
                <td className="px-2 py-2 text-right tabular-nums">{r.pass_rate == null ? '—' : `${r.pass_rate.toFixed(0)}%`}</td>
                <td className="px-2 py-2 text-right tabular-nums">{r.check_pass == null ? '—' : `${r.check_pass.toFixed(0)}%`}</td>
                <td className={`px-2 py-2 text-right tabular-nums ${r.errors ? 'text-err' : 'text-muted'}`}>{r.errors}/{r.done}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtMs(r.median_latency_ms)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtTok(r.tokens)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtCost(r.cost_usd)}</td>
              </tr>
            ))}
            {!lb.length && <tr><td colSpan={9} className="px-3 py-6 text-center text-muted">Waiting for the first answers…</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted/80">
        A failed or timed-out task counts as 0, so a model can’t rank well by only answering the easy ones.
      </p>

      {cats.length > 1 && (
        <div className="overflow-x-auto rounded-2xl border border-border/60 bg-panel2/40">
          <table className="w-full text-[11.5px]" style={{ minWidth: 200 + cats.length * 96 }}>
            <thead><tr className="text-left text-muted text-[10.5px] uppercase tracking-wide">
              <th className="px-3 py-2">By category</th>{cats.map((c) => <th key={c} className="px-2 py-2 text-center">{c}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-border/40">
              {lb.map((r) => (
                <tr key={r.key}>
                  <td className="px-3 py-1.5 text-text2 truncate max-w-[220px]" title={r.model}>{r.model}</td>
                  {cats.map((c) => (
                    <td key={c} className="px-1.5 py-1 text-center"><span className="inline-block min-w-[40px] px-1.5 py-0.5 rounded-lg tabular-nums" style={scoreStyle(r.categories?.[c])}>{r.categories?.[c] == null ? '—' : r.categories[c].toFixed(0)}</span></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <h3 className="text-[14px] font-semibold text-text2 mb-2">Task matrix <span className="text-[11.5px] font-normal text-muted">— click a cell for the answer and the judge’s reasoning</span></h3>
        <div className="overflow-x-auto rounded-2xl border border-border/60 bg-panel2/40">
          <table className="text-[11.5px]" style={{ minWidth: 220 + tasks.length * 64 }}>
            <thead><tr className="text-muted text-[10px] uppercase tracking-wide">
              <th className="px-3 py-2 text-left sticky left-0 bg-panel2/95">Model</th>
              {tasks.map((t) => <th key={t.id} className="px-1 py-2 font-medium w-16 align-bottom" title={`${t.category}: ${t.title}`}><div className="h-20 flex items-end justify-center"><span className="[writing-mode:vertical-rl] rotate-180 max-h-20 overflow-hidden text-ellipsis whitespace-nowrap normal-case tracking-normal text-[10.5px]">{t.title}</span></div></th>)}
            </tr></thead>
            <tbody>
              {lb.map((r) => (
                <tr key={r.key} className="border-t border-border/40">
                  <td className="px-3 py-1.5 sticky left-0 bg-panel2/95 text-text2 truncate max-w-[210px]" title={r.model}>{r.model}</td>
                  {tasks.map((t) => {
                    const c = cellMap[`${r.key}|${t.id}`]
                    const st = c?.status
                    return (
                      <td key={t.id} className="px-1 py-1 text-center">
                        <button disabled={!c || st === 'queued'} onClick={() => setDetail(c)} title={c ? `${c.title}: ${st}` : ''}
                          className="w-12 h-8 rounded-lg tabular-nums disabled:cursor-default hover:ring-1 hover:ring-accent/60 transition"
                          style={st === 'ok' ? scoreStyle(c.score) : {}}>
                          {st === 'ok' ? (c.score == null ? '·' : c.score.toFixed(0)) : st === 'error' ? <span className="text-err">✕</span> : st === 'running' ? <span className="text-accent2 animate-pulse">●</span> : st === 'cancelled' ? <span className="text-muted">–</span> : <span className="text-muted/50">·</span>}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Detail cell={detail} onClose={() => setDetail(null)} />
    </div>
  )
}
