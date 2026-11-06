import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api.js'
import Arena from '../Arena.jsx'
import ContenderPicker from './ContenderPicker.jsx'
import Results from './Results.jsx'
import SanityPanel from './SanityPanel.jsx'
import { cleanLabel, keyOf } from './util.js'

// Benchmark Arena: pick many provider/model contenders, run a task suite, let a stronger
// "judge" model grade every answer against a rubric, and read a ranked leaderboard.
// "Live compare" keeps the original side-by-side streaming view for ad-hoc prompts.

const parseCustom = (text) =>
  text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [prompt, rubric] = l.split('||').map((s) => s.trim())
    return { prompt, rubric: rubric || '' }
  })

export default function BenchArena({ providers = {}, health, malayalamMode, securityMode }) {
  const [mode, setMode] = useState('bench')
  const [meta, setMeta] = useState(null)             // suites + judge suggestions + limits
  const [suiteId, setSuiteId] = useState('soc')
  const [custom, setCustom] = useState('')
  const [selected, setSelected] = useState({})
  const [judgeKey, setJudgeKey] = useState(null)     // null = not chosen yet, '' = no judge
  const [label, setLabel] = useState('')
  const [conc, setConc] = useState(4)
  const [maxTok, setMaxTok] = useState('')
  const [showTasks, setShowTasks] = useState(false)
  const [jobId, setJobId] = useState(null)
  const [view, setView] = useState(null)
  const [history, setHistory] = useState([])
  const [err, setErr] = useState('')
  const [starting, setStarting] = useState(false)
  const timer = useRef(null)
  const viewRef = useRef(null)
  viewRef.current = view

  const configured = useMemo(
    () => Object.entries(providers).filter(([pid]) => health?.providers?.[pid]?.configured === true),
    [providers, health])

  const loadHistory = useCallback(() => api.benchJobs(20).then((r) => setHistory(r.jobs || [])).catch(() => {}), [])
  useEffect(() => {
    api.benchSuites().then((m) => {
      setMeta(m)
      setConc(m.limits?.default_concurrency || 4)
    }).catch((e) => setErr(e.message))
    loadHistory()
    return () => clearTimeout(timer.current)
  }, [loadHistory])

  // default judge = the strongest configured model we can identify
  useEffect(() => {
    if (judgeKey === null && meta) {
      const s = meta.judge_suggestions?.[0]
      setJudgeKey(s ? keyOf(s.provider, s.model) : '')
    }
  }, [meta, judgeKey])

  const suite = meta?.suites?.find((s) => s.id === suiteId)
  const customTasks = useMemo(() => (suiteId === 'custom' ? parseCustom(custom) : []), [suiteId, custom])
  const nTasks = suiteId === 'custom' ? customTasks.length : suite?.tasks?.length || 0
  const nContenders = Object.keys(selected).length
  const judgeOn = !!judgeKey
  const calls = nContenders * nTasks * (judgeOn ? 2 : 1)
  const judgeInSelection = judgeOn && !!selected[judgeKey]
  const running = view?.status === 'running'

  const poll = useCallback(async (id) => {
    try {
      const v = await api.benchJob(id)
      setView(v)
      if (v.status === 'running') {
        timer.current = setTimeout(() => poll(id), 1500)
      } else {
        const full = await api.benchJob(id, true)   // full answers once the run is over
        setView(full)
        loadHistory()
      }
    } catch (e) { setErr(e.message) }
  }, [loadHistory])

  const start = async () => {
    setErr(''); setStarting(true); clearTimeout(timer.current)
    try {
      const [jp, ...rest] = (judgeKey || '').split('/')
      const body = {
        label: label.trim(),
        contenders: Object.values(selected),
        judge: judgeKey ? { provider: jp, model: rest.join('/') } : null,
        concurrency: Number(conc) || undefined,
        max_tokens: Number(maxTok) || undefined,
      }
      if (suiteId === 'custom') body.tasks = customTasks
      else body.suite_id = suiteId
      const r = await api.benchJobCreate(body)
      setJobId(r.job_id); setView(null)
      poll(r.job_id)
    } catch (e) { setErr(e.message) } finally { setStarting(false) }
  }
  const cancel = () => jobId && api.benchJobCancel(jobId).catch((e) => setErr(e.message))
  const openRun = (id) => { clearTimeout(timer.current); setErr(''); setJobId(id); setView(null); poll(id) }
  const deleteRun = async () => {
    if (!jobId) return
    try { await api.benchJobDelete(jobId); setView(null); setJobId(null); loadHistory() } catch (e) { setErr(e.message) }
  }

  const canRun = nContenders > 0 && nTasks > 0 && !running && !starting
  const pct = view?.total ? Math.round((100 * view.done) / view.total) : 0

  const seg = (id, text) => (
    <button onClick={() => setMode(id)} aria-pressed={mode === id}
      className={`px-4 py-1.5 rounded-full text-[12.5px] font-medium transition-all ${mode === id ? 'bg-accent text-white shadow-glow' : 'text-muted hover:text-text'}`}>
      {text}
    </button>
  )

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="shrink-0 px-3 sm:px-6 pb-2 flex items-center gap-2">
        <div className="inline-flex p-1 rounded-full bg-panel2/70 border border-border/60">
          {seg('bench', 'Graded benchmark')}{seg('live', 'Live compare')}
        </div>
      </div>

      {mode === 'live' ? (
        <Arena providers={providers} health={health} malayalamMode={malayalamMode} securityMode={securityMode} />
      ) : (
        <div className="flex-1 overflow-y-auto px-3 sm:px-6 pb-8">
          <div className="mx-auto max-w-[1100px] space-y-5">
            <p className="text-[12.5px] text-muted max-w-3xl">
              Run a task suite against any number of provider/model pairs. A stronger <b className="text-text2">judge</b> model grades each
              answer against a rubric; deterministic checks (JSON validity, ATT&amp;CK IDs, rule syntax…) add hard evidence. Results are ranked,
              exportable, and tuned for the <b className="text-text2">SOC lab</b> — pick the best model for your triage agent.
            </p>

            <SanityPanel />

            {/* 1 — contenders */}
            <section className="rounded-3xl border border-border/60 bg-panel/60 p-4 sm:p-5 space-y-3">
              <ContenderPicker providers={providers} health={health} selected={selected} setSelected={setSelected} disabled={running} />
              {meta && nContenders > (meta.limits?.max_contenders || 40) && (
                <p className="text-[12px] text-err">Too many contenders (max {meta.limits.max_contenders}).</p>
              )}
            </section>

            {/* 2 — suite + judge */}
            <section className="rounded-3xl border border-border/60 bg-panel/60 p-4 sm:p-5 grid gap-5 lg:grid-cols-2">
              <div className="space-y-2">
                <div className="text-[13px] font-medium text-text2">Task suite</div>
                <div className="flex flex-wrap gap-1.5">
                  {(meta?.suites || []).map((s) => (
                    <button key={s.id} disabled={running} onClick={() => setSuiteId(s.id)} aria-pressed={suiteId === s.id}
                      className={`px-3 py-1.5 rounded-full border text-[12px] transition-colors ${suiteId === s.id ? 'bg-accent text-white border-accent' : 'bg-panel2 text-muted border-border/60 hover:text-text'}`}>
                      {s.name} <span className="opacity-70">· {s.tasks.length}</span>
                    </button>
                  ))}
                  <button disabled={running} onClick={() => setSuiteId('custom')} aria-pressed={suiteId === 'custom'}
                    className={`px-3 py-1.5 rounded-full border text-[12px] transition-colors ${suiteId === 'custom' ? 'bg-accent text-white border-accent' : 'bg-panel2 text-muted border-border/60 hover:text-text'}`}>
                    Custom
                  </button>
                </div>
                {suiteId === 'custom' ? (
                  <div className="space-y-1">
                    <textarea value={custom} onChange={(e) => setCustom(e.target.value)} rows={5} disabled={running}
                      placeholder={'One task per line. Optional rubric after ||\nExplain DNS tunnelling in 3 sentences || mentions covert channel, long TXT queries, detection via entropy'}
                      className="w-full resize-y bg-bg border border-border rounded-2xl px-3 py-2 text-[12.5px] outline-none focus:border-accent" />
                    <p className="text-[11px] text-muted">{customTasks.length} task(s). Without a rubric the judge scores correctness, completeness and honesty.</p>
                  </div>
                ) : suite && (
                  <>
                    <p className="text-[11.5px] text-muted">{suite.description}</p>
                    <button onClick={() => setShowTasks((s) => !s)} className="text-[11.5px] text-accent2 hover:underline">
                      {showTasks ? 'Hide' : 'Show'} the {suite.tasks.length} tasks
                    </button>
                    {showTasks && (
                      <ul className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                        {suite.tasks.map((t) => (
                          <li key={t.id} className="rounded-xl bg-bg/40 border border-border/40 px-3 py-2">
                            <div className="text-[12px] text-text2">{t.title} <span className="text-[10.5px] text-muted">· {t.category}</span></div>
                            <div className="text-[11px] text-muted mt-0.5">{t.rubric.length} rubric points{t.checks.length ? ` · ${t.checks.length} auto-checks` : ''}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>

              <div className="space-y-2">
                <div className="text-[13px] font-medium text-text2">Judge model <span className="text-[11px] font-normal text-muted">— use something stronger than the contenders</span></div>
                {meta?.judge_suggestions?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {meta.judge_suggestions.map((s) => {
                      const k = keyOf(s.provider, s.model)
                      return (
                        <button key={k} disabled={running} onClick={() => setJudgeKey(k)} aria-pressed={judgeKey === k} title={k}
                          className={`max-w-full truncate px-2.5 py-1 rounded-full border text-[11.5px] transition-colors ${judgeKey === k ? 'bg-accent/20 border-accent text-accent2' : 'bg-panel2 border-border/60 text-muted hover:text-text'}`}>
                          ★ {s.model}
                        </button>
                      )
                    })}
                  </div>
                )}
                <select value={judgeKey ?? ''} onChange={(e) => setJudgeKey(e.target.value)} disabled={running} aria-label="Judge model"
                  className="w-full bg-bg border border-border rounded-full px-4 py-2 text-[12.5px] outline-none focus:border-accent">
                  <option value="">No judge — deterministic checks only</option>
                  {configured.map(([pid, p]) => (
                    <optgroup key={pid} label={cleanLabel(p.label)}>
                      {(p.models?.length ? p.models : [p.default]).map((m) => <option key={m} value={keyOf(pid, m)}>{m}</option>)}
                    </optgroup>
                  ))}
                </select>
                {judgeInSelection && (
                  <p className="text-[11.5px] text-accent2">The judge is also a contender. Its own scores will be flagged “self-judged” — models tend to grade themselves generously.</p>
                )}
                {!judgeOn && <p className="text-[11.5px] text-muted">Without a judge only tasks that have automatic checks get a score.</p>}
                <div className="grid grid-cols-3 gap-2 pt-1">
                  <label className="text-[11px] text-muted space-y-1"><span>Run name</span>
                    <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="optional" disabled={running}
                      className="w-full bg-bg border border-border rounded-full px-3 py-1.5 text-[12px] outline-none focus:border-accent" /></label>
                  <label className="text-[11px] text-muted space-y-1"><span>Parallel calls</span>
                    <input type="number" min={1} max={8} value={conc} onChange={(e) => setConc(e.target.value)} disabled={running}
                      className="w-full bg-bg border border-border rounded-full px-3 py-1.5 text-[12px] outline-none focus:border-accent" /></label>
                  <label className="text-[11px] text-muted space-y-1"><span>Max answer tokens</span>
                    <input type="number" min={16} value={maxTok} onChange={(e) => setMaxTok(e.target.value)} placeholder="default" disabled={running}
                      className="w-full bg-bg border border-border rounded-full px-3 py-1.5 text-[12px] outline-none focus:border-accent" /></label>
                </div>
              </div>
            </section>

            {/* run bar */}
            <section className="flex flex-wrap items-center gap-3 rounded-3xl border border-border/60 bg-panel/60 px-4 sm:px-5 py-3">
              <div className="text-[12px] text-muted flex-1 min-w-[220px]">
                {nContenders} contender{nContenders === 1 ? '' : 's'} × {nTasks} task{nTasks === 1 ? '' : 's'}
                {judgeOn ? ' + judging' : ''} ≈ <b className="text-text2">{calls}</b> model calls
                {calls > 150 && <span className="text-accent2"> — that’s a lot for a phone host; expect several minutes and real quota use.</span>}
              </div>
              {running ? (
                <button onClick={cancel} className="px-5 py-2 rounded-full bg-err text-white text-[13px] font-medium hover:brightness-110">■ Cancel run</button>
              ) : (
                <button onClick={start} disabled={!canRun}
                  className="px-6 py-2 rounded-full bg-accent text-white text-[13px] font-semibold shadow-glow disabled:bg-border disabled:text-muted disabled:shadow-none disabled:cursor-not-allowed hover:brightness-110">
                  {starting ? 'Starting…' : 'Run benchmark'}
                </button>
              )}
            </section>
            {err && <div className="rounded-2xl border border-err/40 bg-err/10 px-4 py-2 text-[12.5px] text-err">{err}</div>}
            {view?.warnings?.length > 0 && <div className="rounded-2xl border border-accent/30 bg-accent/10 px-4 py-2 text-[12px] text-accent2">Skipped: {view.warnings.join('; ')}</div>}

            {/* progress */}
            {view && (
              <section className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-2 rounded-full bg-border/50 overflow-hidden"><div className="relative h-full"><div className="absolute inset-y-0 left-0 bg-accent/40 transition-all" style={{ width: `${view.total ? Math.round((100 * (view.answered ?? view.done)) / view.total) : 0}%` }} /><div className="absolute inset-y-0 left-0 bg-accent transition-all" style={{ width: `${pct}%` }} /></div></div>
                  <span className="text-[12px] text-muted tabular-nums">answered {view.answered ?? view.done}/{view.total}{view.judge ? ` · graded ${view.done}` : ''} · {view.status}{view.label ? ` · ${view.label}` : ''}</span>
                </div>
                <Results view={view} onDelete={deleteRun} />
              </section>
            )}

            {/* history */}
            {history.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-[13px] font-medium text-text2">Past runs</h3>
                <div className="flex flex-col gap-1.5">
                  {history.map((h) => (
                    <button key={h.id} onClick={() => openRun(h.id)}
                      className={`flex flex-wrap items-center gap-2 text-left rounded-2xl px-4 py-2 border transition-colors ${h.id === jobId ? 'bg-accent/10 border-accent/40' : 'bg-panel2/40 border-border/50 hover:border-accent/40'}`}>
                      <span className="text-[12.5px] text-text2">{h.label || h.suite_id}</span>
                      <span className="text-[11px] text-muted">{new Date(h.created_at * 1000).toLocaleString()}</span>
                      <span className="text-[11px] text-muted">{h.total} cells{h.judge ? ` · judge ${h.judge.model}` : ''}</span>
                      <span className="flex-1" />
                      <span className={`text-[10.5px] px-2 py-0.5 rounded-full ${h.status === 'done' ? 'bg-ok/15 text-ok' : h.status === 'running' ? 'bg-accent/20 text-accent2' : 'bg-panel2 text-muted'}`}>{h.status}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
