import React, { useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import { Markdown } from './Message.jsx'
import { composePersonaMessages } from '../personas.js'
import { SendSolid, Remove, Check, Copy } from './Icons.jsx'

const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`)
const shortModel = (m) => (m ? (m.length > 26 ? m.slice(0, 26) + '…' : m) : '…')

// Provider hue matching the sidebar dots.
function providerHue(provider) {
  const s = provider || ''
  let h = 7
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
  return h
}

// Arena / compare mode: fire one prompt at 2-4 providers simultaneously and
// watch the answers stream in side-by-side with latency + token counts.
// Runs are ephemeral (no conversation_id) — nothing is saved to history.
export default function Arena({ providers = {}, health, malayalamMode = false, securityMode = false }) {
  const [prompt, setPrompt] = useState('')
  const [selected, setSelected] = useState([])
  const [runs, setRuns] = useState([]) // {provider, status, content, model, usage, ms, error}
  const abortsRef = useRef([])
  const inputRef = useRef(null)

  const isConfigured = (pid) => health?.providers?.[pid]?.configured !== false && !!providers[pid]

  const toggle = (pid) => {
    setSelected((s) => {
      if (s.includes(pid)) return s.filter((x) => x !== pid)
      if (s.length >= 4) return s // cap at 4 columns
      return [...s, pid]
    })
  }

  const running = runs.some((r) => r.status === 'streaming')
  const firstDoneMs = useMemo(
    () => runs.filter((r) => r.status === 'done').reduce((m, r) => Math.min(m, r.ms ?? Infinity), Infinity),
    [runs]
  )

  const stopAll = () => {
    abortsRef.current.forEach((a) => a())
    abortsRef.current = []
  }

  const run = () => {
    const text = prompt.trim()
    if (!text || !selected.length || running) return
    stopAll()
    abortsRef.current = []

    // Personas apply here too — Malayalam uncle vs NovaSec (default model,
    // so each provider uses its own strength).
    const sendMessages = composePersonaMessages([{ role: 'user', content: text }], { malayalamMode, securityMode })

    setRuns(selected.map((pid) => ({ provider: pid, status: 'streaming', content: '', ms: 0 })))
    selected.forEach((pid) => {
      const started = performance.now()
      let acc = ''
      const patch = (fields) =>
        setRuns((rs) => rs.map((r) => (r.provider === pid ? { ...r, ...fields, ms: performance.now() - started } : r)))
      const abort = api.chatStream(
        { messages: sendMessages, provider: pid, model: 'auto' },
        {
          onDelta: (c) => { acc += c; patch({ content: acc }) },
          onDone: (ev) => patch({ status: 'done', content: ev.content || acc, model: ev.model, usage: ev.usage }),
          onError: (m) => patch({ status: 'error', content: acc, error: m }),
          onAbort: () => patch({ status: 'done', content: acc + ' …[stopped]' }),
        }
      )
      abortsRef.current.push(abort)
    })
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); run() }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* prompt bar */}
      <div className="border-b border-border bg-panel p-3">
        <div className="mx-auto max-w-[1100px] space-y-2">
          <div className="flex items-center justify-between text-[11px] text-muted small-caps">
            <span>Arena — same prompt, up to 4 providers, live side-by-side</span>
            <span>{selected.length}/4 selected · not saved to history</span>
          </div>
          <textarea
            ref={inputRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder="Ask every contender at once… (Enter to run, Shift+Enter for newline)"
            className="w-full resize-none bg-panel text-text border border-border rounded-xl px-3 py-2 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 transition-colors placeholder:text-muted/50"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            {Object.entries(providers).map(([pid, p]) => {
              const on = selected.includes(pid)
              const cfg = isConfigured(pid)
              return (
                <button
                  key={pid}
                  onClick={() => toggle(pid)}
                  disabled={running}
                  title={cfg ? p.label : `${p.label} — no key on server`}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-full border text-[11px] transition-colors disabled:opacity-60
                    ${on ? 'bg-accent text-[#1a1000] border-accent font-medium' : cfg ? 'bg-panel2 text-muted border-border hover:text-text' : 'bg-panel2 text-muted/40 border-border'}`}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: cfg ? `hsl(${providerHue(pid)} 45% 55%)` : '#3a372f' }}
                  />
                  {p.label.replace(/\s*\((free[^)]*|cloud[^)]*)\)\s*/gi, '')}
                </button>
              )
            })}
            <span className="flex-1" />
            {running ? (
              <button
                onClick={stopAll}
                className="px-3 py-1.5 text-[12px] rounded-lg bg-err text-white font-medium hover:brightness-110 transition-all"
              >
                ■ Stop all
              </button>
            ) : (
              <button
                onClick={run}
                disabled={!prompt.trim() || selected.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-lg bg-accent text-[#1a1000] hover:brightness-105 disabled:opacity-40 transition-all"
              >
                <SendSolid className="w-3.5 h-3.5" /> Run {selected.length > 1 ? selected.length : ''}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* results */}
      <div className="flex-1 overflow-y-auto p-3">
        {runs.length === 0 ? (
          <div className="h-full flex items-center justify-center text-center px-6">
            <div className="space-y-2 max-w-sm">
              <div className="text-[14px] text-text2">Pick 2–4 providers, ask once.</div>
              <p className="text-[12px] text-muted">
                Answers stream in side-by-side with latency and token counts — a quick gut check
                of who reasons best, who's fastest, and who refuses.
              </p>
            </div>
          </div>
        ) : (
          <div className={`mx-auto max-w-[1100px] grid gap-3 ${runs.length === 1 ? 'grid-cols-1' : 'lg:grid-cols-2'}`}>
            {runs.map((r) => {
              const p = providers[r.provider] || {}
              const isFastest = r.status === 'done' && r.ms != null && r.ms <= firstDoneMs + 30
              return (
                <div key={r.provider} className="rounded-xl border border-border bg-panel2 flex flex-col overflow-hidden">
                  <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-panel">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: `hsl(${providerHue(r.provider)} 45% 55%)` }}
                      />
                      <span className="text-[12px] font-medium text-text2 truncate">{p.label || r.provider}</span>
                      {isFastest && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/30 shrink-0">⚡ first</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-muted shrink-0 font-mono">
                      {r.model && <span title={r.model}>{shortModel(r.model)}</span>}
                      <span className={r.status === 'streaming' ? 'text-accent' : ''}>
                        {r.status === 'streaming' ? '…streaming' : r.ms ? fmtMs(r.ms) : ''}
                      </span>
                    </div>
                  </div>
                  <div className="p-3 text-[13px] leading-relaxed flex-1">
                    {r.status === 'error' && !r.content ? (
                      <div className="text-[12px] text-err">{r.error}</div>
                    ) : r.content ? (
                      <Markdown content={r.content} streaming={r.status === 'streaming'} />
                    ) : (
                      <div className="text-muted italic text-[12px]">waiting for {p.label || r.provider}…</div>
                    )}
                    {r.status === 'error' && r.content && (
                      <div className="mt-2 text-[11px] text-err">stream error: {r.error}</div>
                    )}
                  </div>
                  <div className="flex items-center justify-between px-3 py-1.5 border-t border-border text-[10px] text-muted">
                    <span>
                      {r.usage?.total_tokens != null ? `${r.usage.total_tokens.toLocaleString()} tok` : ''}
                      {r.usage?.completion_tokens != null ? ` · ${r.usage.completion_tokens} out` : ''}
                    </span>
                    <ArenaCopy content={r.content} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function ArenaCopy({ content }) {
  const [copied, setCopied] = useState(false)
  if (!content) return null
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(content)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {}
      }}
      className="flex items-center gap-1 hover:text-text transition-colors"
      title="Copy this answer"
    >
      {copied ? <Check className="w-3 h-3 text-ok" /> : <Copy className="w-3 h-3" />} copy
    </button>
  )
}
