import React, { useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import Header from './components/Header.jsx'
import Message from './components/Message.jsx'
import AgentTrace from './components/AgentTrace.jsx'
import ReasoningBox from './components/ReasoningBox.jsx'
import Analyzer from './components/Analyzer.jsx'

export default function App() {
  const [tab, setTab] = useState('chat')
  const [providers, setProviders] = useState({})
  const [defaultProvider, setDefaultProvider] = useState('ollama')
  const [provider, setProvider] = useState('ollama')
  const [model, setModel] = useState('auto')
  const [agent, setAgent] = useState(false)
  const [reasoningEffort, setReasoning] = useState('')
  const [ollama, setOllama] = useState({ loaded: false, model: '' })
  const [ollamaBusy, setOllamaBusy] = useState(false)

  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const [lastMeta, setLastMeta] = useState(null) // {model, provider, reasoning, trace, usage}
  const scrollRef = useRef(null)

  useEffect(() => { loadModels() }, [])
  useEffect(() => { if (provider === 'ollama') loadOllama() }, [provider])
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [messages, busy])

  async function loadModels() {
    try {
      const m = await api.models()
      setProviders(m.providers || {})
      setDefaultProvider(m.default_provider || 'ollama')
      setProvider((p) => m.providers[p] ? p : (m.default_provider || 'ollama'))
    } catch (e) { setErr(e.message) }
  }
  async function loadOllama() {
    try { const s = await api.ollamaStatus(); setOllama({ loaded: !!s.loaded, model: s.model }) } catch {}
  }
  const ollamaLoad = async () => { setOllamaBusy(true); try { await api.ollamaLoad(); await loadOllama() } finally { setOllamaBusy(false) } }
  const ollamaUnload = async () => { setOllamaBusy(true); try { await api.ollamaUnload(); await loadOllama() } finally { setOllamaBusy(false) } }

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    setErr('')
    const next = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setInput('')
    setBusy(true)
    setLastMeta(null)
    try {
      const data = await api.chat({
        messages: next, model, agent, provider, reasoning_effort: reasoningEffort || undefined,
      })
      setMessages([...next, { role: 'assistant', content: data.content }])
      setLastMeta({ model: data.model, provider: data.provider, reasoning: data.reasoning, trace: data.trace, usage: data.usage })
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  return (
    <div className="flex flex-col h-full bg-bg">
      <Header
        state={{ providers, defaultProvider, provider, model, agent, reasoningEffort, ollama, ollamaBusy }}
        actions={{ setProvider, setModel, setAgent, setReasoning, ollamaLoad, ollamaUnload }}
      />

      <div className="flex gap-1 px-4 pt-2 border-b border-border bg-bg">
        {[['chat', 'Chat'], ['analyzer', 'Log Analyzer']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-2 text-[13px] font-semibold rounded-t-lg border-b-2 ${tab === id ? 'text-text border-accent' : 'text-muted border-transparent hover:text-text'}`}>
            {label}
          </button>
        ))}
      </div>

      {err && <div className="px-4 py-2 text-[13px] text-err bg-err/10 border-b border-err/30">{err}</div>}

      {tab === 'chat' ? (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto py-4 space-y-4">
            {messages.length === 0 && (
              <div className="h-full flex items-center justify-center text-muted text-center px-6">
                <div>
                  <div className="text-lg font-semibold text-text mb-1">NOVA POC — multi-provider lab chat</div>
                  <div className="text-[13px]">Pick a provider up top. Local Ollama is uncensored; cloud providers are censored fallbacks.</div>
                </div>
              </div>
            )}
            {messages.map((m, i) => <Message key={i} msg={m} />)}
            {busy && (
              <div className="flex justify-start px-3 sm:px-6">
                <div className="max-w-[820px] w-full flex gap-3">
                  <div className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold bg-accent2 text-[#04122b]">AI</div>
                  <div className="rounded-2xl px-4 py-3 bg-panel2 border border-border text-muted">
                    <span className="inline-flex gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce" style={{ animationDelay: '300ms' }} />
                    </span>
                  </div>
                </div>
              </div>
            )}
            {lastMeta?.reasoning && <div className="mx-3 sm:mx-6"><ReasoningBox reasoning={lastMeta.reasoning} /></div>}
            {lastMeta?.trace?.length > 0 && <div className="mx-3 sm:mx-6"><AgentTrace trace={lastMeta.trace} /></div>}
          </div>

          <div className="border-t border-border bg-panel p-3">
            <div className="mx-auto max-w-[820px] flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKey}
                rows={1}
                placeholder="Message…  (Enter to send, Shift+Enter for newline)"
                className="flex-1 resize-none bg-panel2 text-text border border-border rounded-xl px-3.5 py-2.5 text-[14px] outline-none focus:border-accent2 max-h-40"
              />
              <button onClick={send} disabled={busy || !input.trim()}
                className="px-4 py-2.5 rounded-xl bg-accent text-[#1a1000] font-semibold text-[14px] disabled:opacity-40">
                {busy ? '…' : 'Send'}
              </button>
            </div>
            {lastMeta && (
              <div className="mx-auto max-w-[820px] mt-1.5 text-[11px] text-muted">
                {lastMeta.provider} · {lastMeta.model}
                {lastMeta.usage?.total_tokens != null && ` · ${lastMeta.usage.total_tokens} tok`}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <Analyzer provider={provider} model={model} reasoningEffort={reasoningEffort} />
        </div>
      )}
    </div>
  )
}
