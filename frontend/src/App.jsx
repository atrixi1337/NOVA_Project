import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { api } from './api.js'
import { getUIKey } from './components/SettingsModal.jsx'
import Sidebar from './components/Sidebar.jsx'
import Header from './components/Header.jsx'
import Message from './components/Message.jsx'
import AgentTrace from './components/AgentTrace.jsx'
import ReasoningBox from './components/ReasoningBox.jsx'
import Analyzer from './components/Analyzer.jsx'
import UsageDashboard from './components/UsageDashboard.jsx'
import SettingsModal from './components/SettingsModal.jsx'
import CommandPalette from './components/CommandPalette.jsx'
import { Sparkle, AttachmentPaperclip, Remove, SendSolid, Shield, ArrowDown } from './components/Icons.jsx'

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

// Suggested starter prompts shown in the empty state — pick up the input so the
// user can review/tweak before sending (matches the "grumpy uncle" security persona).
const QUICK_PROMPTS = [
  'Analyze this log: what are the top attack indicators?',
  'Write a Python script to detect brute-force login attempts',
  'Explain CVE-2024-3400 in plain terms',
  'Summarize these firewall rules for review',
]

// Mode-aware starter prompts: the empty state rotates these in when the
// matching mode is active, instead of always showing the SOC-English set.
const MALAYALAM_QUICK_PROMPTS = [
  'ലോഗ് ഫയൽ ഒന്ന് analyse ചെയ്യണം — എങ്ങനെ?',
  'Oru Python script brute-force detect cheyyan ezhuthoo',
  'CVE-2024-3400 enthu aanu? Ellararkkum mansilavume parayoo',
  'Firewall rules review-inu vendi summarize cheyyamo',
]
const SECURITY_QUICK_PROMPTS = [
  'Threat-model this web app: top 5 risks and mitigations',
  'Review this snippet for injection vulnerabilities',
  'Linux privesc checklist for a CTF box',
  'SIEM query to hunt lateral movement (KQL)',
]

// Tab ids (order matters for the tab bar).
const TABS = ['chat', 'analyzer', 'usage']

// Security Mode (NovaSec): swap the model instructions into a cybersecurity-expert
// persona via a per-request system message. The backend forwards `role: system`
// verbatim and skips its own default prompt when one is present, so this persona
// is applied to whichever provider is selected. Cloud providers still apply their
// own safety filters — for fully unrestricted content use Local Ollama on a host
// with enough VRAM (not feasible on this phone). Scope is bounded to authorized
// security research only.
const SECURITY_MODE_SYSTEM_PROMPT =
  'You are NovaSec, a cybersecurity-expert assistant in the Sallaapam lab chatbot. ' +
  'Help with threat modeling, vulnerability analysis & triage, penetration-testing ' +
  'methodology and reporting (for systems you own or are explicitly permitted to ' +
  'test), secure-code review, CTF challenges, defensive security, incident response, ' +
  'log/SIEM analysis, secure architecture, CVE explanation, and security-tool ' +
  'prototyping for authorized lab networks. Reply concisely: short markdown, ' +
  'copy-friendly code blocks, structured findings (severity/evidence/mitigation). ' +
  'BOUNDARIES: do NOT plan or execute unauthorized intrusions; do NOT generate ' +
  'malware, ransomware, or active-delivery attack payloads for unauthorized ' +
  'targets; do NOT assist phishing or social-engineering against uninvolved parties; ' +
  'do NOT bypass authentication/access controls on systems you do not own or lack ' +
  'written permission for. If a request is near that line, first confirm the ' +
  'target is in-scope/authorized, then answer with theory/methodology/explanation ' +
  'rather than ready-to-run hostile tooling. Treat all output as educational/' +
  'research material for authorized use. Note: cloud providers here still enforce ' +
  'their own safety filters, so some restricted content may be refused regardless.'

export default function App() {
  // Last active tab persists across reloads.
  const [tab, setTabState] = useState(() => {
    try {
      const t = localStorage.getItem('nova_tab')
      return TABS.includes(t) ? t : 'chat'
    } catch { return 'chat' }
  })
  const setTab = (t) => {
    setTabState(t)
    try { localStorage.setItem('nova_tab', t) } catch {}
  }
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
  const addFiles = (fileList) => {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'))
    if (!files.length) return false
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
    return true
  }
  const onAttachFiles = (e) => {
    addFiles(e.target.files)
    e.target.value = '' // allow re-selecting the same file
  }
  // Screenshots can also be pasted (Ctrl/Cmd+V) or dragged onto the chat.
  const onPasteInto = (e) => {
    if (addFiles(e.clipboardData?.files)) e.preventDefault()
  }
  const onDropFiles = (e) => {
    e.preventDefault()
    setDragOver(false)
    addFiles(e.dataTransfer?.files)
  }
  const removeImage = (id) => setAttachedImages((as) => as.filter((a) => a.id !== id))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [lastMeta, setLastMeta] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [malayalamMode, setMalayalamMode] = useState(() => {
    try { return localStorage.getItem('nova_malayalam_mode') === 'true' } catch { return false }
  })
  const [securityMode, setSecurityMode] = useState(() => {
    try { return localStorage.getItem('nova_security_mode') === 'true' } catch { return false }
  })
  const [health, setHealth] = useState(null)

  // UI state: drag-over highlight, thinking elapsed seconds, scroll-follow,
  // command palette, textarea auto-grow.
  const [dragOver, setDragOver] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [atBottom, setAtBottom] = useState(true)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const textareaRef = useRef(null)
  const scrollRef = useRef(null)

  // ── data loading ──
  useEffect(() => { loadModels() }, [])
  useEffect(() => { if (provider === 'ollama') loadOllama() }, [provider])
  // Follow new messages only while the user is already at the bottom; when
  // they've scrolled up to read, the jump-to-latest pill appears instead.
  useEffect(() => { if (atBottom) scrollToBottom() }, [messages, busy, atBottom])

  // Persist Malayalam-mode and Security-mode preferences across reloads.
  useEffect(() => {
    try { localStorage.setItem('nova_malayalam_mode', String(malayalamMode)) } catch {}
  }, [malayalamMode])
  useEffect(() => {
    try { localStorage.setItem('nova_security_mode', String(securityMode)) } catch {}
  }, [securityMode])

  // Keep the browser tab title in sync with the open conversation.
  useEffect(() => {
    const conv = conversations.find((c) => c.id === currentId)
    document.title = conv?.title ? `${conv.title} · Sallaapam` : 'Sallaapam — Multi-Provider AI Assistant'
  }, [conversations, currentId])

  // Re-probe backend health every 30s (drives the header status dot — useful
  // when the phone host or the tunnel drops silently).
  useEffect(() => {
    const id = setInterval(() => {
      api.health().then(setHealth).catch(() => setHealth(null))
    }, 30000)
    return () => clearInterval(id)
  }, [])

  // Elapsed-seconds counter shown in the "thinking" indicator.
  useEffect(() => {
    if (!busy) return
    const t0 = Date.now()
    setElapsed(0)
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000)
    return () => clearInterval(id)
  }, [busy])

  // Grow the textarea with its content (capped, like modern chat UIs).
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [input])

  // Ctrl/Cmd+K toggles the command palette.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Per-conversation input drafts: switching chats never loses typed text.
  const draftKey = `nova_draft_${currentId || 'new'}`
  useEffect(() => {
    try { setInput(localStorage.getItem(draftKey) || '') } catch {}
    // draftKey is a pure localStorage lookup — safe to run on key change only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey])
  const updateInput = (v) => {
    setInput(v)
    try { localStorage.setItem(draftKey, v) } catch {}
  }

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    })
  }

  const onScrollMessages = (e) => {
    const el = e.currentTarget
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
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
    updateInput('')
    setAttachedImages([])
    setAtBottom(true)
    setBusy(true)
    setLastMeta(null)
    // Compose outgoing messages. The backend forwards any `role: system` message
    // verbatim and skips its own default prompt when one is present, so each mode
    // swaps in its persona as a per-request system instruction. Malayalam mode
    // takes precedence (it also routes to the Gemini provider).
    const sendMessages = []
    if (malayalamMode) {
      sendMessages.push({ role: 'system', content: MALAYALAM_SYSTEM_PROMPT })
    } else if (securityMode) {
      sendMessages.push({ role: 'system', content: SECURITY_MODE_SYSTEM_PROMPT })
    }
    sendMessages.push(...next)
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
      setMessages([...next, { role: 'assistant', content: data.content, reasoning: data.reasoning }])
      setLastMeta({
        model: data.model,
        provider: data.provider,
        reasoning: data.reasoning,
        trace: data.trace,
        usage: data.usage,
      })
      setConversations((cs) => cs.map((c) =>
        c.id === cid ? { ...c, preview: data.content || '', title: data.title || c.title } : c
      ))
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const onKeyDownInput = (e) => {
    // isComposing guard: don't send mid-IME-composition (Malayalam
    // transliteration / CJK input fires Enter to commit candidates).
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
  }

  // ── provider quick-switch (header dropdown + Ctrl+K palette) ──
  const switchProvider = useCallback((pid) => {
    if (!providers[pid]) return
    setProvider(pid)
    setModel('auto') // let the new provider apply its default model
  }, [providers])

  // Compact token counter: 27316 -> 27.3k (exact value kept in tooltips).
  const fmtTok = (n) => (typeof n === 'number'
    ? (n >= 10000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : n.toLocaleString())
    : '—')

  const paletteItems = useMemo(() => {
    const items = []
    items.push({ section: 'Actions', hint: 'new', label: 'New chat', run: () => { startNewChat() } })
    items.push({ section: 'Modes', hint: securityMode ? 'on' : 'off', label: securityMode ? 'Disable NovaSec' : 'Enable NovaSec', run: () => setSecurityMode((s) => !s) })
    items.push({ section: 'Modes', hint: malayalamMode ? 'on' : 'off', label: malayalamMode ? 'Disable Malayalam mode' : 'Enable Malayalam mode', run: () => setMalayalamMode((m) => !m) })
    ;[['chat', 'Chat'], ['analyzer', 'Log Analyzer'], ['usage', 'Usage']].forEach(([id, label]) =>
      items.push({ section: 'Navigate', hint: 'tab', label: `Go to ${label}`, run: () => setTab(id) }))
    Object.entries(providers).forEach(([pid, p]) =>
      items.push({ section: 'Providers', hint: 'switch', label: `Provider: ${p.label}`, run: () => switchProvider(pid) }))
    conversations.slice(0, 30).forEach((c) =>
      items.push({ section: 'Conversations', hint: c.provider || '', label: c.title || 'Untitled', run: () => openConversation(c.id) }))
    return items
  }, [conversations, providers, securityMode, malayalamMode, startNewChat, openConversation, switchProvider])

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
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
      />

      {/* ── Main ── */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <Header
          onSettings={() => setShowSettings(true)}
          onMenu={() => setSidebarOpen(true)}
          providerLabel={providerLabel}
          model={displayModel}
          providers={providers}
          activeProvider={activeProvider}
          onSwitchProvider={switchProvider}
          health={health}
        />

        {/* Tabs */}
        <div className="flex gap-1 px-4 pt-2 border-b border-border bg-panel">
          {[['chat', 'Chat'], ['analyzer', 'Log Analyzer'], ['usage', 'Usage']].map(([id, label]) => (
            <button
              key={id}
              onClick={() => { setTab(id); setErr(''); setLastMeta(null) }}
              className={`px-4 py-2 text-[13px] font-medium rounded-t-lg border-b-2 transition-all
                ${tab === id
                  ? 'text-accent2 border-accent2 bg-panel2'
                  : 'text-muted border-transparent hover:text-text hover:bg-panel2/60'}`}>
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
            {/* Messages — wrapper is relative so the jump-to-latest pill and
                the drag-drop overlay can float above the scroll area */}
            <div
              className="relative flex-1 min-h-0"
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false) }}
              onDrop={onDropFiles}
            >
            <div ref={scrollRef} onScroll={onScrollMessages} className="absolute inset-0 overflow-y-auto py-5 space-y-3">
              {messages.length === 0 && (
                <div className="h-full flex items-center justify-center text-center px-6">
                  <div className="space-y-6 max-w-md">
                    <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto">
                      <Sparkle className="w-7 h-7 text-accent" />
                    </div>
                    <h2 className="text-lg font-medium text-text2">Sallaapam</h2>
                    <p className="text-sm text-muted max-w-xs mx-auto">
                      Ask me anything — analyze logs, write code, research threats, or just chat.
                    </p>

                    {/* Suggested starter prompts */}
                    <div className="flex flex-col gap-2 pt-2">
                      {(malayalamMode ? MALAYALAM_QUICK_PROMPTS : securityMode ? SECURITY_QUICK_PROMPTS : QUICK_PROMPTS).map((p) => (
                        <button
                          key={p}
                          onClick={() => setInput(p)}
                          className="text-left text-[13px] px-3.5 py-2 rounded-xl bg-panel2 border border-border text-muted hover:text-text hover:border-accent2/40 hover:bg-panel transition-colors text-balance"
                        >
                          {p}
                        </button>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-1.5 justify-center text-[11px] text-muted pt-1">
                      <span className="px-2.5 py-1 bg-panel2 rounded-full">Agent mode</span>
                      <span className="px-2.5 py-1 bg-panel2 rounded-full">{Object.keys(providers).length} providers</span>
                      <span className="px-2.5 py-1 bg-panel2 rounded-full">History saved</span>
                      {securityMode && !malayalamMode && (
                        <span className="px-2.5 py-1 bg-accent2/15 text-accent2 rounded-full">NovaSec</span>
                      )}
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
                        <span className="text-[10px] uppercase text-muted/60 tracking-wider">
                        thinking{elapsed >= 3 ? ` · ${providerLabel.toLowerCase()} · ${elapsed}s` : ''}
                      </span>
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
            {/* jump to latest (shown only when scrolled away from the bottom) */}
            {!atBottom && messages.length > 0 && (
              <button
                onClick={() => { setAtBottom(true); scrollToBottom() }}
                title="Jump to latest"
                className="absolute bottom-4 right-4 z-10 p-2 rounded-full bg-panel2 border border-border text-muted hover:text-accent hover:border-accent2 shadow-lg transition-colors"
              >
                <ArrowDown className="w-4 h-4" />
              </button>
            )}
            {dragOver && (
              <div className="absolute inset-3 z-10 pointer-events-none rounded-2xl border-2 border-dashed border-accent/60 bg-accent/5 flex items-center justify-center">
                <span className="text-[13px] text-accent">Drop images to attach</span>
              </div>
            )}
            </div>

            {/* Input */}
            <div className="border-t border-border bg-panel p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              <div
                className="mx-auto max-w-[820px]"
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false) }}
                onDrop={onDropFiles}
              >
                {/* quick mode toggles — one tap to NovaSec / Malayalam without
                    digging through Settings */}
                <div className="flex items-center gap-1.5 mb-2">
                  <button
                    onClick={() => setSecurityMode((s) => !s)}
                    title="Security Mode (NovaSec)"
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] transition-colors ${
                      securityMode ? 'bg-accent2/15 text-accent2 border-accent2/40' : 'bg-panel2 text-muted border-border hover:text-text'
                    }`}
                  >
                    <Shield className="w-3 h-3" /> NovaSec
                  </button>
                  <button
                    onClick={() => setMalayalamMode((m) => !m)}
                    title="Malayalam mode (routes via Gemini)"
                    className={`px-2 py-0.5 rounded-full border text-[10px] transition-colors ${
                      malayalamMode ? 'bg-accent2/15 text-accent2 border-accent2/40' : 'bg-panel2 text-muted border-border hover:text-text'
                    }`}
                  >
                    അ Malayalam
                  </button>
                  {malayalamMode && <span className="text-[10px] text-muted/70">→ gemini</span>}
                </div>
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
                    <AttachmentPaperclip className="w-5 h-5" />
                  </button>
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => updateInput(e.target.value)}
                    onKeyDown={onKeyDownInput}
                    onPaste={onPasteInto}
                    rows={1}
                    placeholder="Message Sallaapam…  (Enter to send, Shift+Enter for newline)"
                    className={`w-full resize-none bg-panel text-text border rounded-2xl pl-10 pr-[76px] py-3 text-[14px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 transition-colors placeholder:text-muted/50 min-h-[44px] max-h-40 ${
                      dragOver ? 'border-accent/60' : 'border-border'
                    }`}
                  />
                  <button
                    onClick={send}
                    disabled={busy || (!input.trim() && attachedImages.length === 0)}
                    className="absolute right-2 bottom-2.5 px-3.5 py-1.5 rounded-xl bg-accent text-[#1a1000] font-semibold text-[13px] disabled:opacity-40 hover:brightness-90 transition-all flex items-center justify-center gap-1.5"
                  >
                    {busy ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                          <path className="opacity-75" fill="currentColor" d="M2 12a10 10 0 0114.83-8.83A1 1 0 0118 4v10a1 1 0 01-1 1H5a1 1 0 01-.83-1.55A10 10 0 002 12z" />
                        </svg>
                        <span>…</span>
                      </>
                    ) : (
                      <>
                        <SendSolid className="w-4 h-4" />
                        <span>Send</span>
                      </>
                    )}
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
                        ><Remove className="w-2.5 h-2.5" /></button>
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
                        <span title={`${lastMeta.usage.total_tokens.toLocaleString()} tokens`}>
                          {fmtTok(lastMeta.usage.total_tokens)} tok
                        </span>
                      </>
                    )}
                  </div>
                )}
                {securityMode && !malayalamMode && (
                  <div className="mt-1 text-[11px] flex items-center gap-2 text-accent2">
                    <Shield className="w-3.5 h-3.5" />
                    <span>NovaSec — cybersecurity-expert mode active</span>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : tab === 'usage' ? (
          <UsageDashboard />
        ) : (
          <div className="flex-1 overflow-y-auto">
            <Analyzer provider={provider} model={model} reasoningEffort={reasoningEffort} />
          </div>
        )}
      </main>

      {/* Command palette (Ctrl/Cmd+K) */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={paletteItems} />

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
        securityMode={securityMode}
        setSecurityMode={setSecurityMode}
      />
    </div>
  )
}
