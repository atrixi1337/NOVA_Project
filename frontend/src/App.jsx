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
import Arena from './components/Arena.jsx'
import GatewayTab from './components/GatewayTab.jsx'
import LockScreen from './components/LockScreen.jsx'
import { composePersonaMessages } from './personas.js'
import { Sparkle, AttachmentPaperclip, Remove, SendSolid, Shield, ArrowDown, Globe } from './components/Icons.jsx'

// Persona system prompts (Malayalam "grumpy uncle" / NovaSec) live in
// personas.js — shared between the chat and the Arena tab.

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
const TABS = ['chat', 'arena', 'gateway', 'analyzer', 'usage']

// NovaSec persona prompt also lives in personas.js.

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
  // Agent tool preset: core | research | security. NovaSec overrides to
  // 'security' at send time (persona-aware tools).
  const [toolsPreset, setToolsPreset] = useState(() => {
    try {
      const t = localStorage.getItem('nova_tools_preset')
      return ['core', 'research', 'security'].includes(t) ? t : 'research'
    } catch { return 'research' }
  })
  // Web search toggle: gives the model the research tools in normal chat by
  // running a mini tool loop (search → answer, 2 rounds max). Needs a model
  // with function calling; unsupported models just answer without searching.
  const [webSearch, setWebSearch] = useState(() => {
    try { return localStorage.getItem('nova_web_search') === 'true' } catch { return false }
  })
  // Web mode swaps the default to a function-calling model (Nova nova-2-lite-v1)
  // until the user explicitly picks a provider themselves.
  const [providerTouched, setProviderTouched] = useState(false)
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
  const [host, setHost] = useState(null)

  // Shared-passphrase auth: the API 401s until this browser logs in once.
  const [locked, setLocked] = useState(false)
  const [authBusy, setAuthBusy] = useState(false)
  const [authErr, setAuthErr] = useState('')

  // UI state: drag-over highlight, thinking elapsed seconds, scroll-follow,
  // command palette, textarea auto-grow.
  const [dragOver, setDragOver] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [atBottom, setAtBottom] = useState(true)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const textareaRef = useRef(null)
  const scrollRef = useRef(null)
  const abortRef = useRef(null) // active chat request (stream or agent call)

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
  useEffect(() => {
    try { localStorage.setItem('nova_tools_preset', String(toolsPreset)) } catch {}
  }, [toolsPreset])
  useEffect(() => {
    try { localStorage.setItem('nova_web_search', String(webSearch)) } catch {}
  }, [webSearch])

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

  // Phone-host stats (RAM/disk/load/uptime + battery/WiFi via Termux:API) power
  // the header HUD. /api/host is auth-gated, so only poll once unlocked and stop
  // while the lock screen is up.
  useEffect(() => {
    if (locked) return
    const probe = () => api.host().then(setHost).catch(() => setHost(null))
    probe()
    const id = setInterval(probe, 15000)
    return () => clearInterval(id)
  }, [locked])

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
      if (e?.name === 'AuthError') setLocked(true)
      loadConversations()
    }
  }

  async function loadConversations() {
    setConversationsLoaded(false)
    try {
      const data = await api.conversations()
      setConversations(data.conversations || [])
    } catch (e) {
      if (e?.name === 'AuthError') setLocked(true)
      else console.error('Failed to load conversations', e)
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
      const conv = await api.getConversation(cid, 200)
      setCurrentId(conv.id)
      setMessages(conv.messages || [])
      setErr('')
      setLastMeta(null)
      setLiveReasoning('')
      pendingRegenRef.current = false
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
  // Throttled live flush: streaming deltas and reasoning arrive faster than we
  // want to re-render markdown, so buffer and paint at most every ~80ms.
  const streamBufRef = useRef({ content: '', reasoning: '', timer: null })
  const [liveReasoning, setLiveReasoning] = useState('')
  // Edit-and-resend: when set, the next send replaces the old turn in history
  // (backend regenerate flag) instead of appending a duplicate.
  const pendingRegenRef = useRef(false)

  const runTurn = async (baseMessages, cid, { regenerate = false } = {}) => {
    setErr('')
    setBusy(true)
    setLastMeta(null)
    setLiveReasoning('')
    streamBufRef.current = { content: '', reasoning: '', timer: null }
    setAtBottom(true)
    const assistantIdx = baseMessages.length
    setMessages([...baseMessages, { role: 'assistant', content: '' }])
    // Web toggle = same tool loop as agent mode, capped at 2 rounds
    // (search → answer). NovaSec upgrades the preset to Recon.
    const useAgent = agent || webSearch
    // Personas compose as a per-request system message (Malayalam takes
    // precedence and routes to Gemini); the backend forwards them verbatim.
    const payload = {
      messages: composePersonaMessages(baseMessages, { malayalamMode, securityMode }),
      model: activeModel,
      agent: useAgent,
      provider: activeProvider,
      reasoning_effort: reasoningEffort || undefined,
      conversation_id: cid,
      api_key: getUIKey(activeProvider) || undefined,
      max_tool_rounds: useAgent && !agent ? 2 : undefined,
      // Persona-aware agent tools (NovaSec → recon set with the HTTP header probe).
      tools_preset: useAgent ? (securityMode ? 'security' : (agent ? toolsPreset : 'research')) : undefined,
      regenerate: regenerate || undefined,
    }
    const finalizeMeta = (ev) => {
      setLastMeta({
        model: ev.model,
        provider: ev.provider,
        reasoning: ev.reasoning,
        trace: ev.trace || [],
        usage: ev.usage,
      })
      setConversations((cs) => cs.map((c) =>
        c.id === cid ? { ...c, preview: ev.content || '', title: ev.title || c.title } : c
      ))
    }
    const clearStreamBuf = () => {
      if (streamBufRef.current.timer) { clearTimeout(streamBufRef.current.timer); streamBufRef.current.timer = null }
      streamBufRef.current = { content: '', reasoning: '', timer: null }
    }
    const flushLive = () => {
      streamBufRef.current.timer = null
      const buf = streamBufRef.current
      setMessages((prev) => {
        if (prev.length - 1 !== assistantIdx || prev[assistantIdx]?.role !== 'assistant') return prev
        const cp = [...prev]
        cp[assistantIdx] = { role: 'assistant', content: buf.content }
        return cp
      })
      setLiveReasoning(buf.reasoning)
    }
    const scheduleFlush = () => {
      if (streamBufRef.current.timer) return
      streamBufRef.current.timer = setTimeout(flushLive, 80)
    }

    if (!useAgent) {
      // Streaming path: token-by-token into a live assistant bubble, with the
      // model's reasoning streaming into a live "Thinking…" panel. The Stop
      // button aborts the fetch, which cancels the server-side generator
      // before persistence — partial turns are not saved.
      const ctl = new AbortController()
      abortRef.current = ctl
      await api.chatStream(
        payload,
        {
          onDelta: (c) => { streamBufRef.current.content += c; scheduleFlush() },
          onReasoning: (r) => { streamBufRef.current.reasoning += r; scheduleFlush() },
          onDone: (ev) => {
            clearStreamBuf()
            setLiveReasoning('')
            // Empty post-tool replies (a Gemini quirk) shouldn't render as a
            // silent bubble — nudge text pairs with the backend's retry.
            const finalContent = (ev.content || '').trim()
              ? ev.content
              : '(the model returned an empty reply — tap retry)'
            setMessages([...baseMessages, { role: 'assistant', content: finalContent, reasoning: ev.reasoning }])
            finalizeMeta(ev)
            setBusy(false)
            abortRef.current = null
          },
          onAuthRequired: () => {
            clearStreamBuf()
            setLocked(true)
            setBusy(false)
            abortRef.current = null
          },
          onError: (msg) => {
            const acc = streamBufRef.current.content
            clearStreamBuf()
            setErr(msg)
            setMessages(acc ? [...baseMessages, { role: 'assistant', content: acc }] : baseMessages)
            setLiveReasoning('')
            setBusy(false)
            abortRef.current = null
          },
          onAbort: () => {
            const acc = streamBufRef.current.content
            clearStreamBuf()
            setMessages([...baseMessages, { role: 'assistant', content: acc + ' …[stopped]' }])
            setLiveReasoning('')
            setBusy(false)
            abortRef.current = null
          },
        },
        ctl.signal
      )
      return
    }

    // Agent mode keeps the non-streaming multi-round tool endpoint (also
    // abortable now via the same Stop button).
    try {
      const ctl = new AbortController()
      abortRef.current = ctl
      const data = await api.chat(payload, ctl.signal)
      setMessages([...baseMessages, { role: 'assistant', content: data.content, reasoning: data.reasoning }])
      finalizeMeta(data)
      setLastMeta((m) => ({ ...m, trace: data.trace || [] }))
    } catch (e) {
      if (e?.name === 'AbortError') setMessages(baseMessages)
      else if (e?.name === 'AuthError') setLocked(true)
      else {
        setErr(e.message)
        // drop the empty assistant placeholder on failure so no orphan
        // "…thinking" bubble lingers after an error
        setMessages((prev) => (
          prev.length - 1 === assistantIdx && !(prev[assistantIdx]?.content || '').trim()
            ? prev.slice(0, -1)
            : prev
        ))
      }
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

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
    const isRegen = pendingRegenRef.current
    pendingRegenRef.current = false
    await runTurn(next, cid, { regenerate: isRegen })
  }

  // Re-run the last exchange: drop the trailing reply from view and ask the
  // backend to replace the old turn in history instead of duplicating it.
  const regenerateLast = async () => {
    if (busy || !currentId) return
    const msgs = [...messages]
    while (msgs.length && msgs[msgs.length - 1].role === 'assistant') msgs.pop()
    if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return
    setMessages(msgs)
    await runTurn(msgs, currentId, { regenerate: true })
  }

  // Edit-and-resend: only the most recent user message is editable (the
  // backend replace logic drops history from the last user turn onward).
  const editMessage = (idx) => {
    if (busy) return
    const m = messages[idx]
    if (!m || m.role !== 'user') return
    const text = typeof m.content === 'string'
      ? m.content
      : (Array.isArray(m.content)
        ? m.content.filter((b) => b?.type === 'text').map((b) => b.text || '').join('\n')
        : '')
    updateInput(text)
    setMessages(messages.slice(0, idx))
    pendingRegenRef.current = true
    try { textareaRef.current?.focus() } catch {}
  }

  const stopGenerating = () => {
    abortRef.current?.abort()
  }

  // Exchange the passphrase for the 30-day cookie, then boot the app data.
  const doLogin = async (passphrase) => {
    setAuthBusy(true)
    setAuthErr('')
    try {
      await api.login(passphrase)
      setLocked(false)
      loadModels()
    } catch (e) {
      setAuthErr(e.message || 'Login failed')
    } finally {
      setAuthBusy(false)
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
    setProviderTouched(true) // explicit choice wins over the web-mode default
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
    ;[['chat', 'Chat'], ['arena', 'Arena'], ['gateway', 'Gateway'], ['analyzer', 'Log Analyzer'], ['usage', 'Usage']].forEach(([id, label]) =>
      items.push({ section: 'Navigate', hint: 'tab', label: `Go to ${label}`, run: () => setTab(id) }))
    Object.entries(providers).forEach(([pid, p]) =>
      items.push({ section: 'Providers', hint: 'switch', label: `Provider: ${p.label}`, run: () => switchProvider(pid) }))
    conversations.slice(0, 30).forEach((c) =>
      items.push({ section: 'Conversations', hint: c.provider || '', label: c.title || 'Untitled', run: () => openConversation(c.id) }))
    return items
  }, [conversations, providers, securityMode, malayalamMode, startNewChat, openConversation, switchProvider])

  // ── provider/model label for header display ──
  // Precedence: Malayalam mode routes through Gemini (multilingual, strong
  // Malayalam); Web mode swaps the default to a function-calling model
  // (Nova nova-2-lite-v1) until the user explicitly picks a provider.
  const activeProvider = malayalamMode
    ? 'gemini'
    : (webSearch && !providerTouched ? 'nova' : provider)
  const activeModel = malayalamMode
    ? 'auto'
    : (webSearch && !providerTouched ? 'auto' : model)
  const providerLabel = (providers[activeProvider]?.label || activeProvider) || 'Sallaapam'
  const displayModel = activeModel === 'auto' || !activeModel
    ? (providers[activeProvider]?.default || '')
    : activeModel
  // Index of the most recent user message (edit-and-resend target).
  let lastUserIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') { lastUserIdx = i; break }
  }

  // Lock gate: render only the passphrase prompt until the API lets us in.
  if (locked) {
    return (
      <div className="h-[100dvh] bg-bg text-text font-sans overflow-hidden flex items-center justify-center">
        <LockScreen onUnlock={doLogin} busy={authBusy} error={authErr} />
      </div>
    )
  }

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
          host={host}
        />

        {/* Tabs (shrink-0: a tall tab body must never squash the bar to zero) */}
        <div className="shrink-0 flex gap-0.5 sm:gap-1 px-2 sm:px-4 pt-2 border-b border-border bg-panel overflow-x-auto">
          {[['chat', 'Chat'], ['arena', 'Arena'], ['gateway', 'Gateway'], ['analyzer', 'Log Analyzer'], ['usage', 'Usage']].map(([id, label]) => (
            <button
              key={id}
              onClick={() => { setTab(id); setErr(''); setLastMeta(null) }}
              className={`whitespace-nowrap px-2.5 sm:px-4 py-2 text-[12px] sm:text-[13px] font-medium rounded-t-lg border-b-2 transition-all
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
              {messages.map((m, i) => (
                <Message
                  key={i}
                  msg={m}
                  streaming={busy && i === messages.length - 1 && m.role === 'assistant'}
                  onEdit={m.role === 'user' && i === lastUserIdx && !busy ? () => editMessage(i) : undefined}
                  onRegenerate={m.role === 'assistant' && i === messages.length - 1 && !busy ? regenerateLast : undefined}
                />
              ))}

              {busy && messages[messages.length - 1]?.role !== 'assistant' && (
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

              {/* live reasoning panel while a slow model is still thinking */}
              {busy && liveReasoning && (
                <div className="mx-3 sm:mx-6"><ReasoningBox reasoning={liveReasoning} streaming /></div>
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
                  <button
                    onClick={() => setWebSearch((w) => !w)}
                    title="Let the model search the web (needs a function-calling model; others just answer without it)"
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] transition-colors ${
                      webSearch ? 'bg-accent2/15 text-accent2 border-accent2/40' : 'bg-panel2 text-muted border-border hover:text-text'
                    }`}
                  >
                    <Globe className="w-3 h-3" /> Web
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
                    placeholder="Message Sallaapam…"
                    className={`w-full resize-none bg-panel text-text border rounded-2xl pl-10 pr-[76px] py-3 text-[14px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 transition-colors placeholder:text-muted/50 min-h-[44px] max-h-40 ${
                      dragOver ? 'border-accent/60' : 'border-border'
                    }`}
                  />
                  {busy ? (
                    <button
                      onClick={stopGenerating}
                      title="Stop generating"
                      className="absolute right-2 bottom-2.5 px-3.5 py-1.5 rounded-xl bg-err text-white font-semibold text-[13px] hover:brightness-110 transition-all flex items-center justify-center gap-1.5"
                    >
                      <span className="text-[10px] leading-none">■</span>
                      <span>Stop</span>
                    </button>
                  ) : (
                    <button
                      onClick={send}
                      disabled={!input.trim() && attachedImages.length === 0}
                      className="absolute right-2 bottom-2.5 px-3.5 py-1.5 rounded-xl bg-accent text-[#1a1000] font-semibold text-[13px] disabled:opacity-40 hover:brightness-90 transition-all flex items-center justify-center gap-1.5"
                    >
                      <SendSolid className="w-4 h-4" />
                      <span>Send</span>
                    </button>
                  )}
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
        ) : tab === 'arena' ? (
          <Arena
            providers={providers}
            health={health}
            malayalamMode={malayalamMode}
            securityMode={securityMode}
          />
        ) : tab === 'gateway' ? (
          <GatewayTab health={health} />
        ) : tab === 'usage' ? (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <UsageDashboard />
          </div>
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
        setProvider={(pid) => { setProvider(pid); setProviderTouched(true) }}
        setModel={setModel}
        agent={agent}
        setAgent={setAgent}
        reasoningEffort={reasoningEffort}
        setReasoning={setReasoning}
        toolsPreset={toolsPreset}
        setToolsPreset={setToolsPreset}
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
