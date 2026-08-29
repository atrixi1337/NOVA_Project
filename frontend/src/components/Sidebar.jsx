import React, { useState, useRef, useEffect } from 'react'

function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  const now = new Date()
  const diff = now - d
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (diff < 60000) return 'Just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function truncate(text, n) {
  if (!text) return ''
  const t = text.replace(/\n+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

// Conversation list sidebar with new-chat, rename, delete, and settings.
export default function Sidebar({
  conversations,
  currentId,
  onNew,
  onSelect,
  onRename,
  onDelete,
  onSettings,
  loading,
  open = false,
  onClose,
}) {
  const [hovered, setHovered] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [draft, setDraft] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [renaming])

  const startRename = (cid, title) => {
    setRenaming(cid)
    setDraft(title)
  }

  const confirmRename = async (cid) => {
    const t = draft.trim()
    setRenaming(null)
    if (t && t !== conversations.find((c) => c.id === cid)?.title) {
      await onRename(cid, t)
    }
  }

  const sorted = [...conversations].sort((a, b) => b.updated_at - a.updated_at)

  return (
    <aside className={`fixed inset-y-0 left-0 z-40 flex flex-col w-64 min-w-[240px] max-w-80 border-r border-border bg-sidebar overflow-hidden -translate-x-full md:static md:translate-x-0 transition-transform duration-200 ease-in-out ${open ? 'translate-x-0' : '-translate-x-full'}`}>
      {/* top: brand + new chat */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between px-1 py-1">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="Sallaapam" className="w-7 h-7 object-contain" />
            <span className="font-semibold text-[16px] text-text">Sallaapam</span>
          </div>
          <button
            onClick={() => { onSettings(); onClose?.() }}
            className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-panel2 transition-colors"
            title="Settings"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M11.983  .063a1 1 0 01.033 1.987L11 3v1l.016 1.02a6.009 6.009 0 01.968 2.796l.016.104v1.877a.75.75 0 00.75.75h1a.75.75 0 010 1.5h-1a2.25 2.25 0 01-.456-.083 1 1 0 01-.544-.544 1 1 0 01.083-.456V7.81a4.014 4.014 0 00-.63-3.756A4.004 4.004 0 0012 1.944V3a1 1 0 011.987-.033 1 1 0 01-.033 1.987L13 5v1a4.014 4.014 0 01-3.756.63 1 1 0 01-.544.544v.007a1 1 0 01-.083-.456 1 1 0 01.544-.544 1 1 0 01.456.083 2.001 2.001 0 001.5-.517V5a1 1 0 011.987-.033l.016-1.04A1 1 0 0112 2v1zm4.95 10.05a5 5 0 00-7 0L4.5 13.1V15a1 1 0 001 1h2.59l1-1h1.83l1 1H17.5a1 1 0 001-1v-1.9l-1.45-1.45zM12 12a4.5 4.5 0 110 9 4.5 4.5 0 010-9z" />
            </svg>
          </button>
        </div>
        <button
          onClick={() => { onNew(); onClose?.() }}
          disabled={loading.new}
          className="mt-1 w-full flex items-center justify-center gap-2 px-3 py-2 text-[13px] font-medium text-[#1a1000] bg-accent rounded-xl hover:brightness-105 disabled:opacity-50 transition-all"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 4.5v15m7.5-7.5H4.5" />
          </svg>
          New chat
        </button>
      </div>

      {/* conversation list */}
      <nav className="flex-1 overflow-y-auto py-2">
        {sorted.length === 0 ? (
          <div className="px-4 py-6 text-center text-[13px] text-muted">
            <div className="w-12 h-12 rounded-full bg-panel2 flex items-center justify-center mx-auto mb-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M8 10h.01M12 10h.01M16 10h.01M9 14h.01M13 14h.01M17 14h.01M21 8a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h14a2 2 0 002-2V8z" />
              </svg>
            </div>
            <p className="text-sm text-muted">No conversations yet.</p>
            <p className="text-[12px] text-muted/60 mt-1">Start a new chat to begin.</p>
          </div>
        ) : (
          <ul className="space-y-1 px-2">
            {sorted.map((c) => {
              const active = c.id === currentId
              const isRenaming = renaming === c.id
              return (
                <li
                  key={c.id}
                  className={`group relative rounded-xl mx-1 ${
                    active ? 'bg-panel2' : 'hover:bg-panel2/50'
                  } transition-colors`}
                  onMouseEnter={() => setHovered(c.id)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <button
                    onClick={() => { if (!isRenaming) { onSelect(c.id); onClose?.() } }}
                    className="w-full text-left p-3 rounded-xl focus:outline-none"
                  >
                    {isRenaming ? (
                      <input
                        ref={inputRef}
                        className="w-full bg-panel2 text-text text-[13px] px-2 py-1 rounded-lg border border-border outline-none focus:border-accent2"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => confirmRename(c.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') confirmRename(c.id)
                          if (e.key === 'Escape') { setRenaming(null); setDraft(c.title) }
                        }}
                      />
                    ) : (
                      <>
                        <div className="font-medium text-[13px] text-text truncate mb-0.5">
                          {c.title}
                        </div>
                        {c.preview ? (
                          <div className="text-[12px] text-muted truncate mb-1">
                            {truncate(c.preview, 48)}
                          </div>
                        ) : null}
                        <div className="flex items-center justify-between text-[11px] text-muted/60">
                          <span>{formatTime(c.updated_at)}</span>
                          {c.msg_count != null && <span>• {c.msg_count} msgs</span>}
                        </div>
                      </>
                    )}
                  </button>

                  {/* hover actions (only for non-active, non-renaming) */}
                  {!isRenaming && (
                    <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => startRename(c.id, c.title)}
                        className="p-1 rounded-md text-muted hover:text-text hover:bg-panel transition-colors"
                        title="Rename"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-5-9l-7 7v3h3l7-7m-3-1l3-3m0 0l2.5-2.5M17 2l5 5-3 3-5-5 3-3z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => onDelete(c.id)}
                        className="p-1 rounded-md text-muted hover:text-err hover:bg-panel transition-colors"
                        title="Delete"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M19 7l-.867 12.133A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.867L5 7m5 5v5m4-5v5M4 7h16M4 7l1-3h14l1 3M4 7l1-3h14l1 3M9 11l3 3 3-3" />
                        </svg>
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </nav>

      {/* bottom */}
      <div className="p-2 border-t border-border">
        <button
          onClick={() => { onSettings(); onClose?.() }}
          className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-muted hover:text-text hover:bg-panel2 rounded-xl transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M11.983 2.017a1 1 0 011.414 0l.03.031L19 8.05l4 4-6 6-4-4-4-4 6-6a1 1 0 011-1l.032.003.082.003 3.918-.933zM4 20h16a2 2 0 012 2H2a2 2 0 012-2z" />
          </svg>
          Settings
        </button>
      </div>
    </aside>
  )
}
