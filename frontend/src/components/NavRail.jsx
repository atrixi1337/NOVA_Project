import React from 'react'
import { Gear, Sun, Moon } from './Icons.jsx'

// Section icons (24x24, stroke). Kept local: they only exist for navigation.
const P = {
  chat: 'M21 12a8 8 0 01-11.5 7.2L4 20l1-4.6A8 8 0 1121 12z',
  arena: 'M4 5h6v14H4zM14 5h6v14h-6z',
  gateway: 'M8 7V3m8 4V3M6 7h12v4a6 6 0 01-12 0V7zm6 10v4',
  analyzer: 'M9 12h6M9 16h4M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z',
  bench: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
  schedules: 'M12 7v5l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z',
  usage: 'M5 21V10m7 11V4m7 17v-7',
  host: 'M5 4h14a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1zm0 9h14a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1v-5a1 1 0 011-1zM8 7.5h.01M8 16.5h.01',
}

function NavIcon({ id, className = 'w-[22px] h-[22px]' }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[id] || P.chat} />
    </svg>
  )
}

/**
 * Primary navigation. Desktop: a slim vertical rail. Phones: a bottom bar.
 * Replaces the old horizontal tab strip.
 */
export default function NavRail({ items, tab, onSelect, onSettings, theme, onTheme, variant }) {
  if (variant === 'bottom') {
    return (
      <nav aria-label="Sections"
        className="md:hidden shrink-0 flex items-center justify-between gap-0.5 px-2 pt-1.5 pb-[calc(0.5rem+env(safe-area-inset-bottom))] border-t border-border/60 bg-panel/80 backdrop-blur-xl">
        {items.map(([id, label]) => {
          const on = tab === id
          return (
            <button key={id} onClick={() => onSelect(id)} title={label} aria-label={label}
              aria-current={on ? 'page' : undefined}
              className={`flex-1 h-11 max-w-[52px] rounded-2xl flex items-center justify-center transition-colors ${
                on ? 'bg-accent/15 text-accent2' : 'text-muted hover:text-text'
              }`}>
              <NavIcon id={id} />
            </button>
          )
        })}
      </nav>
    )
  }
  return (
    <nav aria-label="Sections"
      className="hidden md:flex shrink-0 w-[76px] flex-col items-center py-4 gap-1.5">
      <div className="w-10 h-10 mb-3 rounded-2xl bg-gradient-to-br from-accent to-accent2 shadow-glow flex items-center justify-center text-white text-[17px] font-semibold select-none"
        aria-hidden="true">S</div>
      {items.map(([id, label]) => {
        const on = tab === id
        return (
          <button key={id} onClick={() => onSelect(id)} title={label} aria-label={label}
            aria-current={on ? 'page' : undefined}
            className={`group relative w-11 h-11 rounded-2xl flex items-center justify-center transition-all ${
              on ? 'bg-accent text-white shadow-glow' : 'text-muted hover:text-text hover:bg-panel2'
            }`}>
            <NavIcon id={id} />
            <span className="pointer-events-none absolute left-full ml-3 z-50 px-2.5 py-1 rounded-lg bg-panel2 border border-border text-[12px] text-text whitespace-nowrap opacity-0 group-hover:opacity-100 shadow-float transition-opacity">
              {label}
            </span>
          </button>
        )
      })}
      <div className="flex-1" />
      {onTheme && (
        <button onClick={onTheme} aria-label="Toggle theme" title="Toggle theme"
          className="w-11 h-11 rounded-2xl flex items-center justify-center text-muted hover:text-text hover:bg-panel2 transition-colors">
          {theme === 'dark' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
        </button>
      )}
      <button onClick={onSettings} aria-label="Settings" title="Settings"
        className="w-11 h-11 rounded-2xl flex items-center justify-center text-muted hover:text-text hover:bg-panel2 transition-colors">
        <Gear className="w-5 h-5" />
      </button>
    </nav>
  )
}
