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
      const r = api.analyze(file, { mode, provider, model, reasoning_effort })
      const res = await r
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
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="text-[13px] text-muted file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-accent2 file:text-[#04122b] file:font-semibold" />
          <label className="flex items-center gap-2 text-[13px] text-muted">
            Mode
            <select value={mode} onChange={(e) => setMode(e.target.value)}
              className="bg-panel text-text border border-border rounded-lg px-2.5 py-1.5 text-[13px]">
              <option value="security">Security</option>
              <option value="general">General</option>
            </select>
          </label>
          <button onClick={run} disabled={busy || !file}
            className="ml-auto px-4 py-1.5 rounded-lg bg-accent text-[#1a1000] font-semibold text-[13px] disabled:opacity-40">
            {busy ? 'Analyzing…' : 'Analyze'}
          </button>
        </div>
        {file && <div className="text-[12px] text-muted">selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)</div>}
        {err && <div className="text-[13px] text-err">{err}</div>}
      </div>

      {stats && (
        <div className="rounded-xl border border-border bg-panel2 p-4 text-[13px]">
          <div className="font-semibold text-text mb-2">Pre-stats (server-side)</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-muted">
            <div>lines: <span className="text-text">{stats.lines}</span></div>
            <div>bytes: <span className="text-text">{stats.bytes?.toLocaleString()}</span></div>
            <div>type: <span className="text-text">{stats.file_type}</span></div>
            {stats.evtx_records != null && <div>evtx recs: <span className="text-text">{stats.evtx_records}</span></div>}
          </div>
          {stats.level_counts && Object.keys(stats.level_counts).length > 0 && (
            <div className="mt-2">levels: {Object.entries(stats.level_counts).map(([k, v]) => (
              <span key={k} className="mr-2"><span className="text-text">{k}</span> {v}</span>
            ))}</div>
          )}
          {stats.top_ips?.length > 0 && (
            <div className="mt-2">top IPs: {stats.top_ips.slice(0, 6).map(([ip, n]) => (
              <span key={ip} className="mr-2"><span className="text-text">{ip}</span> {n}</span>
            ))}</div>
          )}
        </div>
      )}

      {result?.report && (
        <div className="rounded-xl border border-border bg-panel2 p-4">
          <div className="md text-[14px]" dangerouslySetInnerHTML={{ __html: renderMarkdown(result.report) }} />
        </div>
      )}
    </div>
  )
}
