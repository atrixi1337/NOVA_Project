import React, { useEffect, useState } from 'react'
import { api } from '../api.js'

// F19 — Scheduled prompts.
//
// Interval-driven rather than cron: the phone sleeps, reboots and loses signal,
// so "every N minutes" degrades gracefully where a cron expression would either
// miss runs or pile them up on reconnect.
//
// Each run writes into its own conversation, so results are browsable like any
// other chat.

const INTERVALS = [
  { v: 15, label: 'every 15m' },
  { v: 30, label: 'every 30m' },
  { v: 60, label: 'hourly' },
  { v: 360, label: 'every 6h' },
  { v: 1440, label: 'daily' },
]

function ago(ts) {
  if (!ts) return 'never'
  const s = Math.floor(Date.now() / 1000 - ts)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function ScheduleTab({ providers = {}, onOpenConversation }) {
  const [items, setItems] = useState([])
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [provider, setProvider] = useState('')
  const [everyMin, setEveryMin] = useState(60)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(null)
  const [loaded, setLoaded] = useState(false)

  const load = async () => {
    try {
      const res = await api.schedules()
      setItems(res.schedules || [])
      setErr('')
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoaded(true)
    }
  }

  useEffect(() => { load() }, [])

  const create = async () => {
    setErr('')
    try {
      await api.createSchedule({ name: name.trim(), prompt: prompt.trim(), provider, every_min: everyMin })
      setName('')
      setPrompt('')
      load()
    } catch (e) { setErr(e.message) }
  }

  const toggle = async (s) => {
    try {
      await api.updateSchedule(s.id, { enabled: !s.enabled })
      load()
    } catch (e) { setErr(e.message) }
  }

  const remove = async (s) => {
    try {
      await api.deleteSchedule(s.id)
      load()
    } catch (e) { setErr(e.message) }
  }

  const runNow = async (s) => {
    setBusy(s.id)
    setErr('')
    try {
      const res = await api.runSchedule(s.id)
      if (!res.ok) setErr(res.error || 'Run failed.')
      if (res.conversation_id && onOpenConversation) onOpenConversation(res.conversation_id)
      load()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(null)
    }
  }

  const configured = Object.keys(providers)

  return (
    <div className="p-4 space-y-4 max-w-3xl">
      <header>
        <h2 className="text-lg font-semibold text-text">Scheduled prompts</h2>
        <p className="text-[12px] text-muted mt-0.5">
          Run a prompt on an interval and file the answer as its own conversation.
          Requires auth to be enabled — a schedule spends tokens with nobody watching.
        </p>
      </header>

      {loaded && !items.length && !err && (
        <p className="text-[12px] text-muted">No schedules yet. Add one below.</p>
      )}

      {items.length > 0 && (
        <ul className="space-y-1.5">
          {items.map((s) => (
            <li
              key={s.id}
              className="border border-border rounded-xl p-2.5 bg-panel2/40 space-y-1"
            >
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${s.enabled ? 'bg-accent2' : 'bg-muted/40'}`} />
                <span className="text-[13px] text-text font-medium truncate flex-1">{s.name}</span>
                <span className="text-[11px] text-muted whitespace-nowrap">
                  {INTERVALS.find((i) => i.v === s.every_min)?.label || `${s.every_min}m`}
                </span>
              </div>
              <p className="text-[12px] text-muted line-clamp-2">{s.prompt}</p>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="text-muted/70">
                  {s.provider || 'default'} · last {ago(s.last_run_at)}
                </span>
                {s.last_status && (
                  <span className={s.last_status === 'ok' ? 'text-accent2' : 'text-err'}>
                    {s.last_status}
                  </span>
                )}
                <div className="ml-auto flex gap-1">
                  {s.last_conversation_id && onOpenConversation && (
                    <button
                      onClick={() => onOpenConversation(s.last_conversation_id)}
                      className="px-1.5 py-0.5 rounded border border-border text-muted hover:text-text"
                    >
                      view
                    </button>
                  )}
                  <button
                    onClick={() => runNow(s)}
                    disabled={busy === s.id}
                    className="px-1.5 py-0.5 rounded border border-border text-muted hover:text-text disabled:opacity-50"
                  >
                    {busy === s.id ? 'running…' : 'run now'}
                  </button>
                  <button
                    onClick={() => toggle(s)}
                    className="px-1.5 py-0.5 rounded border border-border text-muted hover:text-text"
                  >
                    {s.enabled ? 'pause' : 'resume'}
                  </button>
                  <button
                    onClick={() => remove(s)}
                    className="px-1.5 py-0.5 rounded border border-border text-muted hover:text-err"
                  >
                    delete
                  </button>
                </div>
              </div>
              {s.last_error && (
                <p className="text-[11px] text-err/80 truncate">{s.last_error}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-border pt-3 space-y-2">
        <h3 className="text-[13px] font-medium text-text">New schedule</h3>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (e.g. morning triage)"
          className="w-full bg-panel2 text-text text-[13px] px-2 py-1.5 rounded-lg border border-border outline-none focus:border-accent2"
        />
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={2}
          placeholder="Prompt to run"
          className="w-full bg-panel2 text-text text-[13px] px-2 py-1.5 rounded-lg border border-border outline-none focus:border-accent2"
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="bg-panel2 text-text text-[12px] px-2 py-1 rounded-lg border border-border"
          >
            <option value="">default provider</option>
            {configured.map((p) => (
              <option key={p} value={p}>{providers[p]?.label || p}</option>
            ))}
          </select>
          <select
            value={everyMin}
            onChange={(e) => setEveryMin(Number(e.target.value))}
            className="bg-panel2 text-text text-[12px] px-2 py-1 rounded-lg border border-border"
          >
            {INTERVALS.map((i) => (
              <option key={i.v} value={i.v}>{i.label}</option>
            ))}
          </select>
          <button
            onClick={create}
            disabled={!name.trim() || !prompt.trim()}
            className="px-3 py-1 text-[12px] rounded-lg bg-accent2 text-bg font-medium disabled:opacity-40"
          >
            Add
          </button>
        </div>
        {err && <p className="text-[12px] text-err">{err}</p>}
      </div>
    </div>
  )
}
