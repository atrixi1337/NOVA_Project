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

// Malayalam mode: route chats through the Gemini provider (multilingual, strong
// Malayalam) and prepend a system instruction so the model replies only in
// Malayalam — either Malayalam script (e.g. "സുഖമാണോ") or Manglish / Latin-script
// Malayalam (e.g. "sugamano"). The backend forwards system messages verbatim.
//
// Tone is deliberately a "grumpy old Malayali uncle": terse, blunt, dry-witted,
// world-weary, quietly competent underneath the sigh — NOT a cringy teen.
// Google's safety policy still applies in EVERY language (incl. Malayalam), so
// profanity / slurs / sexual / hate / harassment is refused regardless of
// language. "Grumpy uncle" = attitude, not abuse; that line is not crossed.
const MALAYALAM_SYSTEM_PROMPT =
  'You are Sallaapam, a grumpy old Malayali uncle — world-weary, blunt, dry-witted, the ' +
  'sort who has seen it all, answers with a sigh, and rolls his eyes at modern ' +
  'nonsense. The user turned on Malayalam mode, so reply ONLY in Malayalam — Malayalam ' +
  'script (e.g. "സുഖമാണോ") or Manglish (e.g. "sugamano"), matching the script the ' +
  'user wrote with. Channel that uncle voice: terse, no-nonsense sentences, a ' +
  'little blunt, a touch sarcastic, a long-suffering sigh at the user\'s sillier ' +
  'questions ("Aa karyam nokki thirichu nokkam... ennittum ithuvare oru 30 varsham "' +
  'aayi ittu; mumbu njan ..."), with dry back-in-my-day knowing and mild ' +
  'good-natured ribbing — never mean-spirited, never angry, never profanity, never ' +
  'slurs, never sexual or hateful. You stay quietly competent: you fix the thing ' +
  'without fuss, just through gritted teeth. Skip emoji, teenage slang, and ' +
  '"omg super sugam" — speak like an uncle who\'s read too much and explains too ' +
  'little. Never answer in English prose. You run inside a local proof-of-concept ' +
  'chatbot on the user\'s lab machine.'

export default function App() {
  const [tab, setTab] = useState('chat')
  // ── conversation state ──
  const [conversations, setConversations] = useState([])
  const [currentId, setCurrentId] = useState(null)
  const [conversationsLoaded, setConversationsLoaded] = useState(false)

  // ── provider / model / mode state ──
  const [providers, setProviders] = useState({})
  const [defaultProvider, setDefaultProvider] = useState('inception')
  const [provider, setProvider] = useState('inception')
  const [model, setModel] = useState('auto')
  const [agent, setAgent] = useState(false)
  const [reasoningEffort, setReasoning] = useState('')
  const [ollama, setOllama] = useState({ loaded: false, model: '' })
  const [ollamaBusy, setOllamaBusy] = useState(false)

  // ── chat state ──
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [attachedImages, setAttachedImages] = useState([]) // image_url blocks
  const fileInputRef = useRef(null)
  const onAttachFiles = (e) => {
    const files = Array.from(e.target.files || []).filter((f) => f.type.startsWith('image/'))
    if (!files.length) return
    // NVIDIA NIM's public vision models are provisioned with limit-mm-per-prompt=1,
    // so a multi-image request bounces back as an opaque 400 ("At most 1 image may
    // be provided"). Cap it here instead, with a clear message, when NIM is selected.
    if (provider === 'nvidia' && files.length > 1) {
      setErr('NVIDIA NIM allows only 1 image per request; using the first image.')
      files.splice(1)
    }
    files.forEach((file) => {
      const r = new FileReader()
      r.onload = () =>
        setAttachedImages((as) => [...as, { id: `${file.name}-${Date.now()}`, dataUrl: r.result }])
      r.readAsDataURL(file)
    })
    e.target.value = '' // allow re-selecting the same file
  }
  const removeImage = (id) => setAttachedImages((as) => as.filter((a) => a.id !== id))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [lastMeta, setLastMeta] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [malayalamMode, setMalayalamMode] = useState(() => {
    try { return localStorage.getItem('nova_malayalam_mode') === 'true' } catch { return false }
  })
  const [health, setHealth] = useState(null)

  const scrollRef = useRef(null)

  // ── data loading ──
  useEffect(() => { loadModels() }, [])
  useEffect(() => { if (provider === 'ollama') loadOllama() }, [provider])
  useEffect(() => { scrollToBottom() }, [messages, busy])

  // Persist Malayalam-mode preference across reloads.
  useEffect(() => {
    try { localStorage.setItem('nova_malayalam_mode', String(malayalamMode)) } catch {}
  }, [malayalamMode])

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
      const conv = await api.newConversation({ provider: activeProvider, model: activeModel || 'auto' })
      setCurrentId(conv.id)
      setMessages([])
      setInput('')
      setErr('')
      setLastMeta(null)
      setConversations((cs) => [conv, ...cs])
    } catch (e) {
      setErr(e.message)
    }
  }, [busy, provider, model, malayalamMode])

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
    if ((!text && attachedImages.length === 0) || busy) return

    let cid = currentId
    if (!cid) {
      try {
        const conv = await api.newConversation({ provider: activeProvider, model: activeModel || 'auto' })
        cid = conv.id
        setCurrentId(cid)
        setConversations((cs) => [conv, ...cs])
      } catch (e) {
        setErr(e.message)
        return
      }
    }

    setErr('')
    const userContent = attachedImages.length
      ? [
          ...(text ? [{ type: 'text', text }] : []),
          ...attachedImages.map((img) => ({
            type: 'image_url',
            image_url: { url: img.dataUrl },
          })),
        ]
      : text
    const next = [...messages, { role: 'user', content: userContent }]
    setMessages(next)
    setInput('')
    setAttachedImages([])
    setBusy(true)
    setLastMeta(null)
    // In Malayalam mode, route the chat through the Gemini provider and prepend a
    // language instruction. The backend forwards system messages verbatim and
    // skips its own system prompt when one is already present.
    const sendMessages = malayalamMode
      ? [{ role: 'system', content: MALAYALAM_SYSTEM_PROMPT }, ...next]
      : next
    try {
      const data = await api.chat({
        messages: sendMessages,
        model: activeModel,
        agent,
        provider: activeProvider,
        reasoning_effort: reasoningEffort || undefined,
        conversation_id: cid,
        api_key: getUIKey(activeProvider) || undefined,
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
  // In Malayalam mode the chat is routed through the Gemini provider (multilingual,
  // strong Malayalam), so the header reflects that effective provider/model.
  const activeProvider = malayalamMode ? 'gemini' : provider
  const activeModel = malayalamMode ? 'auto' : model
  const providerLabel = (providers[activeProvider]?.label || activeProvider) || 'Sallaapam'
  const displayModel = activeModel === 'auto' || !activeModel
    ? (providers[activeProvider]?.default || '')
    : activeModel

  return (
    <div className="flex h-[100dvh] bg-bg text-text font-sans overflow-hidden">
      {/* Mobile drawer backdrop (visible only on small screens when sidebar is open) */}
      <div
        className={`fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden transition-opacity duration-200 ease-in-out ${
          sidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar: inline on desktop, off-canvas drawer on mobile */}
      <Sidebar
        conversations={conversations}
        currentId={currentId}
        onNew={startNewChat}
        onSelect={openConversation}
        onRename={renameConversation}
        onDelete={deleteConversation}
        onSettings={() => setShowSettings(true)}
        loading={{ new: busy }}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* ── Main ── */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <Header
          onSettings={() => setShowSettings(true)}
          onMenu={() => setSidebarOpen(true)}
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
                    <h2 className="text-lg font-medium text-text">Sallaapam</h2>
                    <p className="text-sm text-muted">
                      Ask me anything — analyze logs, write code, research threats, or just chat.
                    </p>
                    <div className="flex flex-wrap gap-1.5 justify-center text-[11px] text-muted">
                      <span className="px-2 py-1 bg-panel2 rounded-full">Agent mode</span>
                      <span className="px-2 py-1 bg-panel2 rounded-full">{Object.keys(providers).length} providers</span>
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
            <div className="border-t border-border bg-panel p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              <div className="mx-auto max-w-[820px]">
                <div className="relative">
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    ref={fileInputRef}
                    onChange={onAttachFiles}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={busy}
                    className="absolute left-2 bottom-2.5 p-1.5 rounded-lg text-muted hover:text-text hover:bg-panel2 transition-colors z-10"
                    title="Attach image"
                  >
                    📎
                  </button>
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={onKeyDownInput}
                    rows={1}
                    placeholder="Message Sallaapam…  (Enter to send, Shift+Enter for newline)"
                    className="w-full resize-none bg-black text-text border border-border rounded-2xl pl-10 pr-4 py-3 text-[14px] outline-none focus:border-accent2 transition-colors placeholder:text-muted/50 min-h-[44px] max-h-40"
                  />
                  <button
                    onClick={send}
                    disabled={busy || (!input.trim() && attachedImages.length === 0)}
                    className="absolute right-2 bottom-2.5 px-3.5 py-1.5 rounded-xl bg-accent text-black font-semibold text-[13px] disabled:opacity-40 hover:brightness-90 transition-all"
                  >
                    {busy ? '…' : 'Send'}
                  </button>
                </div>
                {attachedImages.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {attachedImages.map((img) => (
                      <div key={img.id} className="relative w-16 h-16 rounded-lg overflow-hidden border border-border">
                        <img src={img.dataUrl} alt="attach" className="w-full h-full object-cover" />
                        <button
                          onClick={() => removeImage(img.id)}
                          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-err text-white flex items-center justify-center text-[10px]"
                          title="Remove"
                        >✕</button>
                      </div>
                    ))}
                  </div>
                )}
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
        provider={activeProvider}
        model={activeModel}
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
        malayalamMode={malayalamMode}
        setMalayalamMode={setMalayalamMode}
      />
    </div>
  )
}
