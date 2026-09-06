import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from './Icons.jsx'

// Ctrl+K command palette: fuzzy-filter a flat list of items
// ({ label, hint, section, run }) with full keyboard navigation.
export default function CommandPalette({ open, onClose, items = [] }) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  useEffect(() => {
    if (open) {
      setQ('')
      setIdx(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    const base = s
      ? items.filter((i) =>
          i.label.toLowerCase().includes(s) ||
          (i.hint || '').toLowerCase().includes(s) ||
          (i.section || '').toLowerCase().includes(s))
      : items
    return base.slice(0, 20)
  }, [q, items])

  useEffect(() => { setIdx(0) }, [q])

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [idx, filtered])

  if (!open) return null

  const runItem = (item) => {
    onClose()
    try { item.run?.() } catch {}
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[idx]) runItem(filtered[idx]) }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-border bg-panel shadow-2xl overflow-hidden msg-in">
        <div className="flex items-center gap-2 px-3.5 py-3 border-b border-border">
          <Search className="w-4 h-4 text-accent2 shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type a command, chat, or provider…"
            className="w-full bg-transparent text-[14px] text-text outline-none placeholder:text-muted/60"
          />
          <kbd className="shrink-0 text-[10px] text-muted border border-border rounded px-1.5 py-0.5 bg-panel2">esc</kbd>
        </div>
        <ul ref={listRef} className="max-h-[320px] overflow-y-auto py-1.5">
          {filtered.length === 0 && (
            <li className="px-4 py-6 text-center text-[12px] text-muted">No matches.</li>
          )}
          {filtered.map((item, i) => (
            <li key={`${item.section}-${item.label}-${i}`}>
              <button
                data-active={i === idx}
                onMouseEnter={() => setIdx(i)}
                onClick={() => runItem(item)}
                className={`w-full flex items-center justify-between gap-3 px-4 py-2 text-left text-[13px] transition-colors
                  ${i === idx ? 'bg-panel2 text-text' : 'text-text2/80'}`}
              >
                <span className="truncate">{item.label}</span>
                <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted/80 small-caps">
                  {item.hint || item.section}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="px-4 py-1.5 border-t border-border text-[10px] text-muted/70 flex gap-3">
          <span>↑↓ navigate</span><span>↵ run</span><span>esc close</span>
        </div>
      </div>
    </div>
  )
}
