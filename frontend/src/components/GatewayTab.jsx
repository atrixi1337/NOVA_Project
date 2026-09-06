import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { Check, Copy, ChartBar, Remove } from './Icons.jsx'

const fmt = (n) => (typeof n === 'number' ? n.toLocaleString() : '—')
const fmtTok = (n) => (typeof n === 'number'
  ? (n >= 10000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : n.toLocaleString())
  : '—')
const relTime = (ts) => {
  if (!ts) return '—'
  const d = new Date(ts * 1000)
  const diff = Date.now() - d
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function CopyBtn({ text, label = 'copy' }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {}
      }}
      className="flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-border bg-panel text-[10px] text-muted hover:text-text hover:border-accent2/60 transition-colors shrink-0"
      title="Copy"
    >
      {copied ? <Check className="w-3 h-3 text-ok" /> : <Copy className="w-3 h-3" />}
      <span>{copied ? 'copied' : label}</span>
    </button>
  )
}

// Inference Gateway tab: mint/revoke API keys for the OpenAI-compatible /v1
// endpoints and track per-key usage — so agents (OpenCode, Aider, curl, any
// OpenAI client) can run inference through every provider.
export default function GatewayTab({ health }) {
  const [keys, setKeys] = useState([])
  const [providers, setProviders] = useState({})
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [newKey, setNewKey] = useState(null)
  const [err, setErr] = useState('')
  const [confirmRevoke, setConfirmRevoke] = useState(null)
  const origin = window.location.origin

  const load = async () => {
    setBusy(true)
    try {
      const [keyRes, modelRes] = await Promise.all([api.gatewayKeys(), api.models().catch(() => ({}))])
      setKeys(keyRes.keys || [])
      setProviders(modelRes.providers || {})
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  useEffect(() => { load() }, [])

  // model catalog grouped by provider, flagged by whether the server has a key
  const groups = useMemo(() => Object.entries(providers).map(([pid, p]) => ({
    pid,
    label: p.label || pid,
    configured: health?.providers?.[pid]?.configured !== false,
    models: p.models || [],
  })), [providers, health])
  const totalModels = groups.reduce((n, g) => n + g.models.length + 1, 0) // +1 per provider for /auto
  const configuredList = groups
    .filter((g) => g.configured)
    .flatMap((g) => ['auto', ...g.models].map((m) => `${g.pid}/${m}`))
    .join('\n')

  const create = async () => {
    if (!name.trim() || busy) return
    setBusy(true); setErr(''); setNewKey(null)
    try {
      const res = await api.createGatewayKey(name.trim())
      setNewKey(res)
      setName('')
      await load()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const revoke = async (prefix) => {
    if (confirmRevoke !== prefix) {
      setConfirmRevoke(prefix)
      setTimeout(() => setConfirmRevoke((cur) => (cur === prefix ? null : cur)), 3000)
      return
    }
    setConfirmRevoke(null)
    try { await api.revokeGatewayKey(prefix); await load() } catch (e) { setErr(e.message) }
  }

  const curlSnippet = `curl ${origin}/v1/chat/completions \\
  -H "Authorization: Bearer sk-nova-…" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "gemini/gemini-3.6-flash", "messages": [{"role": "user", "content": "hi"}]}'`

  const opencodeSnippet = JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    provider: {
      nova: {
        npm: '@ai-sdk/openai-compatible',
        name: 'Nova Gateway',
        options: { baseURL: `${origin}/v1`, apiKey: 'sk-nova-…' },
        models: {
          'gemini/gemini-3.6-flash': { name: 'Gemini Flash (web-capable)' },
          'inception/mercury-2': { name: 'Mercury-2' },
        },
      },
    },
  }, null, 2)

  return (
    <div className="flex-1 min-h-0 overflow-y-auto mx-auto max-w-4xl w-full p-4 space-y-5">
      <header className="flex items-center justify-between">
        <h2 className="text-[16px] font-semibold text-text2 flex items-center gap-2">
          <ChartBar className="w-4 h-4 text-accent2" />
          Inference Gateway
        </h2>
        <button onClick={load} disabled={busy}
          className="px-2.5 py-1 text-[12px] rounded-lg border border-border bg-black hover:border-accent2 text-muted hover:text-text disabled:opacity-40 transition-all">
          Refresh
        </button>
      </header>

      {err && <div className="text-[13px] text-err">{err}</div>}

      {/* setup guide */}
      <div className="rounded-xl border border-border bg-panel2 p-4 space-y-3">
        <div className="font-semibold text-text text-[14px]">Point any OpenAI-compatible agent here</div>
        <div className="text-[12px] text-muted">
          Base URL <code className="px-1 py-0.5 rounded bg-black text-accent">{origin}/v1</code> ·
          auth <code className="px-1 py-0.5 rounded bg-black text-text2">Authorization: Bearer sk-nova-…</code> ·
          models as <code className="px-1 py-0.5 rounded bg-black text-text2">provider/model</code>
        </div>
        <div>
          <div className="flex items-center justify-between text-[11px] text-muted mb-1">
            <span>curl</span><CopyBtn text={curlSnippet} />
          </div>
          <pre className="bg-black border border-border rounded-lg p-2.5 text-[11px] overflow-x-auto whitespace-pre">{curlSnippet}</pre>
        </div>
        <div>
          <div className="flex items-center justify-between text-[11px] text-muted mb-1">
            <span>OpenCode config (~/.config/opencode/opencode.json)</span><CopyBtn text={opencodeSnippet} />
          </div>
          <pre className="bg-black border border-border rounded-lg p-2.5 text-[11px] overflow-x-auto whitespace-pre">{opencodeSnippet}</pre>
        </div>
        <p className="text-[11px] text-muted/60">
          Every call is metered to its key below — see the Usage tab for the full ledger.
          Streaming (`"stream": true`) is supported.
        </p>
      </div>

      {/* available models catalog */}
      <div className="rounded-xl border border-border bg-panel2 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-text text-[14px]">Available models ({totalModels})</div>
          <CopyBtn text={configuredList} label="copy list" />
        </div>
        <div className="text-[11px] text-muted/60">
          Use as <code className="px-0.5 rounded bg-black text-text2">"model": "provider/model"</code> in
          requests. Greyed-out providers have no server key and will refuse inference.
          "Copy list" copies only the working ones.
        </div>
        {groups.map((g) => (
          <div key={g.pid}>
            <div className="flex items-center gap-1.5 text-[11px] text-muted mb-1">
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: g.configured ? '#3fd07a' : '#57534a' }}
                title={g.configured ? 'configured' : 'no key on server'}
              />
              <span className={g.configured ? 'text-text2' : 'text-muted/60'}>{g.label}</span>
              {!g.configured && <span className="text-err/70">· no key on server</span>}
            </div>
            <div className="flex flex-wrap gap-1">
              {['auto', ...g.models].map((m) => (
                <code
                  key={m}
                  className={`px-1.5 py-0.5 rounded bg-black border text-[10.5px] ${
                    g.configured ? 'border-border text-text2' : 'border-border/50 text-muted/50 line-through'
                  }`}
                >
                  {g.pid}/{m}
                </code>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* create key */}
      <div className="rounded-xl border border-border bg-panel2 p-4 space-y-3">
        <div className="font-semibold text-text text-[14px]">Create API key</div>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') create() }}
            placeholder="key name — e.g. opencode-laptop"
            className="flex-1 bg-black text-text text-[13px] px-3 py-2 rounded-lg border border-border outline-none focus:border-accent2 transition-colors placeholder:text-muted/40"
          />
          <button
            onClick={create}
            disabled={!name.trim() || busy}
            className="px-3 py-2 text-[12px] font-semibold rounded-lg bg-accent text-[#1a1000] hover:brightness-90 disabled:opacity-40 transition-all"
          >
            {busy ? '…' : 'Mint key'}
          </button>
        </div>
        {newKey && (
          <div className="rounded-lg border border-accent/40 bg-accent/5 p-3 space-y-2">
            <div className="text-[11px] text-accent2">
              Key for <b>{newKey.name}</b> — copy it NOW, it is shown only this once (only its hash is stored):
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-black border border-border rounded-lg px-2.5 py-2 text-[12px] text-text2 overflow-x-auto whitespace-nowrap">{newKey.key}</code>
              <CopyBtn text={newKey.key} label="copy key" />
            </div>
            <button onClick={() => setNewKey(null)} className="text-[11px] text-muted hover:text-text transition-colors">
              I've saved it — hide
            </button>
          </div>
        )}
      </div>

      {/* keys table */}
      <div className="rounded-xl border border-border bg-panel2 p-4 space-y-3">
        <div className="font-semibold text-text text-[14px]">API keys ({keys.length})</div>
        {keys.length === 0 ? (
          <div className="text-[12px] text-muted">No keys yet — mint one above.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr>
                  {['Name', 'Key', 'Created', 'Last used', 'Calls', 'Tokens today', 'Tokens total', ''].map((c) => (
                    <th key={c} className="text-left text-[10px] font-mono uppercase text-muted pb-1 pr-2 whitespace-nowrap">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.prefix} className="border-b border-border/30">
                    <td className="py-1.5 pr-2 text-text2">{k.name}</td>
                    <td className="py-1.5 pr-2 font-mono text-muted">{k.prefix}…</td>
                    <td className="py-1.5 pr-2 text-muted whitespace-nowrap">{relTime(k.created_at)}</td>
                    <td className="py-1.5 pr-2 text-muted whitespace-nowrap">{k.last_used_at ? relTime(k.last_used_at) : 'never'}</td>
                    <td className="py-1.5 pr-2 text-text2 font-mono">{fmt(k.calls)}</td>
                    <td className="py-1.5 pr-2 text-text2 font-mono">{fmtTok(k.today_tokens)}</td>
                    <td className="py-1.5 pr-2 text-text2 font-mono">{fmtTok(k.total_tokens)}</td>
                    <td className="py-1.5 text-right">
                      {k.enabled ? (
                        <button
                          onClick={() => revoke(k.prefix)}
                          className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] transition-colors ${
                            confirmRevoke === k.prefix
                              ? 'bg-err text-white font-semibold'
                              : 'text-muted hover:text-err hover:bg-panel border border-border'
                          }`}
                          title={confirmRevoke === k.prefix ? 'Tap again to revoke' : 'Revoke (tap twice)'}
                        >
                          <Remove className="w-3 h-3" />
                          <span>{confirmRevoke === k.prefix ? 'sure?' : 'revoke'}</span>
                        </button>
                      ) : (
                        <span className="text-[10px] text-muted/60">revoked</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="text-[11px] text-muted/60">
          Revoked keys stop working immediately but keep their usage history.
          Gateway calls are recorded per key in the usage ledger (actor <code className="px-0.5 rounded bg-black">gw:&lt;name&gt;</code>).
        </div>
      </div>
    </div>
  )
}
