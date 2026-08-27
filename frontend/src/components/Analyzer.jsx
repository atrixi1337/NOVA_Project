import React, { useState } from 'react'
import { api } from '../api.js'
import { renderMarkdown } from '../markdown.jsx'

export default function Analyzer({ provider, model, reasoningEffort }) {
  const [file, setFile] = useState(null)
  const [mode, setMode] = useState('security')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState(null)

  const run = async () => {
    if (!file) return setErr('Choose a log file first.')
    setBusy(true); setErr(''); setResult(null)
    try {
      const res = await api.analyze(file, { mode, provider, model, reasoning_effort: reasoningEffort })
      setResult(res)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const stats = result?.stats

  return (
    <div className="mx-auto max-w-3xl w-full p-5 space-y-4">
      <div className="rounded-xl border border-border bg-panel2 p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex-1 text-[13px] text-muted file:cursor-pointer">
            <input type="file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="hidden"
            />
            <span className="inline-block px-3 py-1.5 rounded-lg bg-accent2 text-[#04122b] font-semibold text-[13px]">
              {file ? file.name : 'Choose a log file…'}
            </span>
          </label>

          <label className="flex items-center gap-2 text-[13px] text-muted">
            Mode
            <select value={mode} onChange={(e) => setMode(e.target.value)}
              className="bg-panel text-text border border-border rounded-lg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent2 transition-colors">
              <option value="security">Security</option>
              <option value="general">General</option>
            </select>
          </label>

          <button
            onClick={run}
            disabled={busy || !file}
            className="px-4 py-1.5 rounded-lg bg-accent text-[#1a1000] font-semibold text-[13px] disabled:opacity-40 hover:brightness-105 transition-all"
          >
            {busy ? 'Analyzing…' : 'Analyze'}
          </button>
        </div>

        {file && (
          <div className="text-[12px] text-muted">
            selected: {file.name} · {(file.size / 1024).toFixed(1)} KB · mode: {mode}
          </div>
        )}
        {err && <div className="text-[13px] text-err">{err}</div>}
      </div>

      {stats && (
        <div className="rounded-xl border border-border bg-panel2 p-4 text-[13px] space-y-3">
          <div className="font-semibold text-text text-[14px] flex items-center gap-2">
            <span className="w-5 h-5 rounded bg-panel flex items-center justify-center text-accent2">📊</span>
            Pre-analysis stats (server-side)
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-muted">
            <div>lines: <span className="text-text font-medium">{stats.lines}</span></div>
            <div>bytes: <span className="text-text font-medium">{stats.bytes?.toLocaleString()}</span></div>
            <div>type: <span className="text-text font-medium">{stats.file_type}</span></div>
            {stats.evtx_records != null && (
              <div>evtx recs: <span className="text-text font-medium">{stats.evtx_records}</span></div>
            )}
          </div>
          {stats.level_counts && Object.keys(stats.level_counts).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(stats.level_counts).map(([k, v]) => (
                <span key={k} className="px-2 py-0.5 text-[11px] bg-panel border border-border rounded">
                  <span className="text-text">{k}</span> <span className="text-muted">{v}</span>
                </span>
              ))}
            </div>
          )}
          {stats.top_ips?.length > 0 && (
            <div>
              <span className="text-muted text-[12px]">top source IPs:</span>
              <div className="flex flex-wrap gap-2 mt-1">
                {stats.top_ips.slice(0, 6).map(([ip, n]) => (
                  <span key={ip} className="px-2 py-0.5 text-[11px] bg-panel border border-border rounded">
                    <span className="text-accent2">{ip}</span> <span className="text-muted">{n}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {result?.report && (
        <div className="rounded-xl border border-border bg-panel2 p-5">
          <div className="md text-[14px]" dangerouslySetInnerHTML={{ __html: renderMarkdown(result.report) }} />
        </div>
      )}

      {result && !result.report && !err && !busy && (
        <div className="text-muted text-[13px]">No report generated. Try a different provider.</div>
      )}
    </div>
  )
}
