import React, { useEffect, useRef, useState, useCallback } from 'react'
import { api } from './api.js'
import { getUIKey } from './components/SettingsModal.jsx'
import Sidebar from './components/Sidebar.jsx'
import Header from './components/Header.jsx'
import Message from './components/Message.jsx'
import AgentTrace from './components/AgentTrace.jsx'
import ReasoningBox from './components/ReasoningBox.jsx'
import Analyzer from './components/Analyzer.jsx'
import SettingsModal from './components/SettingsModal.jsx'

export default function App() {
  const [tab, setTab] = useState('chat')
  // ── conversation state ──
  const [conversations, setConversations] = useState([])
  const [currentId, setCurrentId] = useState(null)
  const [conversationsLoaded, setConversationsLoaded] = useState(false)

  // ── provider / model / mode state ──
  const [providers, setProviders] = useState({})
  const [defaultProvider, setDefaultProvider] = useState('foundry')
  const [provider, setProvider] = useState('foundry')
  const [model, setModel] = useState('auto')
  const [agent, setAgent] = useState(false)
  const [reasoningEffort, setReasoning] = useState('')
  const [ollama, setOllama] = useState({ loaded: false, model: '' })
  const [ollamaBusy, setOllamaBusy] = useState(false)

  // ── chat state ──
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [lastMeta, setLastMeta] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [health, setHealth] = useState(null)

  const scrollRef = useRef(null)

  // ── data loading ──
  useEffect(() => { loadModels() }, [])
  useEffect(() => { if (provider === 'ollama') loadOllama() }, [provider])
  useEffect(() => { scrollToBottom() }, [messages, busy])

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    })
  }

  async function loadModels() {
    try {
      const m = await api.models()
      setProviders(m.providers || {})
      setDefaultProvider(m.default_provider || 'foundry')
      setProvider((p) => m.providers[p] ? p : (m.default_provider || 'foundry'))
      try { setHealth(await api.health()) } catch {}
      loadConversations()
    } catch (e) {
      loadConversations()
    }
  }

  async function loadConversations() {
    setConversationsLoaded(false)
    try {
      const data = await api.conversations()
      setConversations(data.conversations || [])
    } catch (e) {
      console.error('Failed to load conversations', e)
    } finally {
      setConversationsLoaded(true)
    }
  }

  async function loadOllama() {
    try {
      const s = await api.ollamaStatus()
      setOllama({ loaded: !!s.loaded, model: s.model })
    } catch {}
  }

  const ollamaLoad = async () => { setOllamaBusy(true); try { await api.ollamaLoad(); await loadOllama() } finally { setOllamaBusy(false) } }
  const ollamaUnload = async () => { setOllamaBusy(true); try { await api.ollamaUnload(); await loadOllama() } finally { setOllamaBusy(false) } }

  // ── conversation actions ──
  const startNewChat = useCallback(async () => {
    if (busy) return
    try {
      const conv = await api.newConversation({ provider, model: model || 'auto' })
      setCurrentId(conv.id)
      setMessages([])
      setInput('')
      setErr('')
      setLastMeta(null)
      setConversations((cs) => [conv, ...cs])
    } catch (e) {
      setErr(e.message)
    }
  }, [busy, provider, model])

  const openConversation = useCallback(async (cid) => {
    if (busy) return
    setBusy(true)
    try {
      const conv = await api.getConversation(cid)
      setCurrentId(conv.id)
      setMessages(conv.messages || [])
      setErr('')
      setLastMeta(null)
      if (conv.provider && providers[conv.provider]) setProvider(conv.provider)
      if (conv.model) setModel(conv.model)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }, [busy, providers])

  const renameConversation = async (cid, title) => {
    try {
      await api.renameConversation(cid, title)
      setConversations((cs) => cs.map((c) => (c.id === cid ? { ...c, title } : c)))
    } catch (e) {
      setErr(e.message)
    }
  }

  const deleteConversation = async (cid) => {
    try {
      await api.deleteConversation(cid)
      setConversations((cs) => cs.filter((c) => c.id !== cid))
      if (cid === currentId) {
        setCurrentId(null)
        setMessages([])
        setLastMeta(null)
        setErr('')
      }
    } catch (e) {
      setErr(e.message)
    }
  }

  // ── chat ──
  const send = async () => {
    const text = input.trim()
    if (!text || busy) return

    let cid = currentId
    if (!cid) {
      try {
        const conv = await api.newConversation({ provider, model: model || 'auto' })
        cid = conv.id
        setCurrentId(cid)
        setConversations((cs) => [conv, ...cs])
      } catch (e) {
        setErr(e.message)
        return
      }
    }

    setErr('')
    const next = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setInput('')
    setBusy(true)
    setLastMeta(null)
    try {
      const data = await api.chat({
        messages: next,
        model,
        agent,
        provider,
        reasoning_effort: reasoningEffort || undefined,
        conversation_id: cid,
        api_key: getUIKey(provider) || undefined,
      })
      setMessages([...next, { role: 'assistant', content: data.content }])
      setLastMeta({
        model: data.model,
        provider: data.provider,
        reasoning: data.reasoning,
        trace: data.trace,
        usage: data.usage,
      })
      setConversations((cs) => cs.map((c) =>
        c.id === cid ? { ...c, preview: data.content || '' } : c
      ))
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const onKeyDownInput = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  // ── provider/model label for header display ──
  const providerLabel = (providers[provider]?.label || provider) || 'NOVA'
  const displayModel = model === 'auto' || !model
    ? (providers[provider]?.default || '')
    : model

  return (
    <div className="flex h-screen bg-bg text-text font-sans overflow-hidden">
      {/* ── Sidebar ── */}
      <Sidebar
        conversations={conversations}
        currentId={currentId}
        onNew={startNewChat}
        onSelect={openConversation}
        onRename={renameConversation}
        onDelete={deleteConversation}
        onSettings={() => setShowSettings(true)}
        loading={{ new: busy }}
      />

      {/* ── Main ── */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <Header
          onSettings={() => setShowSettings(true)}
          providerLabel={providerLabel}
          model={displayModel}
        />

        {/* Tabs */}
        <div className="flex gap-1 px-4 pt-2 border-b border-border bg-panel">
          {[['chat', 'Chat'], ['analyzer', 'Log Analyzer']].map(([id, label]) => (
            <button
              key={id}
              onClick={() => { setTab(id); setErr(''); setLastMeta(null) }}
              className={`px-4 py-1.5 text-[13px] font-medium rounded-t-lg border-b-2 transition-colors
                ${tab === id ? 'text-accent2 border-accent2' : 'text-muted border-transparent hover:text-text'}`}>
              {label}
            </button>
          ))}
        </div>

        {err && (
          <div className="px-4 py-2 text-[13px] text-err bg-err/10 border-b border-err/30 flex items-center gap-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 8.25v4.257a2.25 2.25 0 00.659 1.581l3.5 3.5a1 1 0 001.414-1.414l-3.159-3.159A.75.75 0 0112 10.5H7.5a.75.75 0 010-1.5h4.5v-1a.75.75 0 011.5 0z" />
            </svg>
            <span>{err}</span>
          </div>
        )}

        {tab === 'chat' ? (
          <>
            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto py-5 space-y-3">
              {messages.length === 0 && (
                <div className="h-full flex items-center justify-center text-center px-6">
                  <div className="space-y-4 max-w-md">
                    <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto">
                      <span className="text-2xl">✨</span>
                    </div>
                    <h2 className="text-lg font-medium text-text">NOVA Chat</h2>
                    <p className="text-sm text-muted">
                      Ask me anything — analyze logs, write code, research threats, or just chat.
                    </p>
                    <div className="flex flex-wrap gap-1.5 justify-center text-[11px] text-muted">
                      <span className="px-2 py-1 bg-panel2 rounded-full">Agent mode</span>
                      <span className="px-2 py-1 bg-panel2 rounded-full">10 providers</span>
                      <span className="px-2 py-1 bg-panel2 rounded-full">History saved</span>
                    </div>
                  </div>
                </div>
              )}
              {messages.map((m, i) => <Message key={i} msg={m} />)}

              {busy && (
                <div className="flex justify-start px-3 sm:px-6">
                  <div className="max-w-[820px] w-full flex gap-3">
                    <div className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold bg-accent2 text-black">AI</div>
                    <div className="rounded-2xl px-4 py-3.5 bg-panel2 border border-border">
                      <span className="inline-flex items-end gap-1">
                        <span className="text-[10px] uppercase text-muted/60 tracking-wider">thinking</span>
                        <span className="w-1.5 h-1.5 rounded-full bg-accent2 animate-pulse" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-accent2 animate-pulse" style={{ animationDelay: '200ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-accent2 animate-pulse" style={{ animationDelay: '400ms' }} />
                                           </span>
                    </div>
                  </div>
                </div>
              )}

              {lastMeta?.reasoning && <div className="mx-3 sm:mx-6"><ReasoningBox reasoning={lastMeta.reasoning} /></div>}
              {lastMeta?.trace?.length > 0 && <div className="mx-3 sm:mx-6"><AgentTrace trace={lastMeta.trace} /></div>}
            </div>

            {/* Input */}
            <div className="border-t border-border bg-panel p-4">
              <div className="mx-auto max-w-[820px]">
                <div className="relative">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={onKeyDownInput}
                    rows={1}
                    placeholder="Message NOVA…  (Enter to send, Shift+Enter for newline)"
                    className="w-full resize-none bg-black text-text border border-border rounded-2xl px-4 py-3 text-[14px] outline-none focus:border-accent2 transition-colors placeholder:text-muted/50 min-h-[44px] max-h-40"
                  />
                  <button
                    onClick={send}
                    disabled={busy || !input.trim()}
                    className="absolute right-2 bottom-2.5 px-3.5 py-1.5 rounded-xl bg-accent text-black font-semibold text-[13px] disabled:opacity-40 hover:brightness-90 transition-all"
                  >
                    {busy ? '…' : 'Send'}
                  </button>
                </div>
                {lastMeta && (
                  <div className="mt-1.5 text-[11px] text-muted flex items-center gap-2">
                    <span>{lastMeta.provider}</span>
                    <span>·</span>
                    <span>{lastMeta.model}</span>
                    {lastMeta.usage?.total_tokens != null && (
                      <>
                        <span>·</span>
                        <span>{lastMeta.usage.total_tokens} tok</span>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <Analyzer provider={provider} model={model} reasoningEffort={reasoningEffort} />
          </div>
        )}
      </main>

      {/* Settings Modal */}
      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        providers={providers}
        defaultProvider={defaultProvider}
        provider={provider}
        model={model}
        setProvider={setProvider}
        setModel={setModel}
        agent={agent}
        setAgent={setAgent}
        reasoningEffort={reasoningEffort}
        setReasoning={setReasoning}
        ollama={ollama}
        ollamaBusy={ollamaBusy}
        ollamaLoad={ollamaLoad}
        ollamaUnload={ollamaUnload}
        health={health}
      />
    </div>
  )
}
