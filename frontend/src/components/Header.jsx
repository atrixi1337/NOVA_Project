import React, { useEffect, useState } from 'react'
import { Gear } from './Icons.jsx'

function Clock() {
  const [t, setT] = useState(() => new Date())
  useEffect(() => {
    // Tick every second, but skip re-renders while the tab is hidden (the
    // app lives on a phone host — no point burning battery in the background).
    const id = setInterval(() => {
      if (!document.hidden) setT(new Date())
    }, 1000)
    return () => clearInterval(id)
  }, [])
  const hh = String(t.getHours()).padStart(2, '0')
  const mm = String(t.getMinutes()).padStart(2, '0')
  const ss = String(t.getSeconds()).padStart(2, '0')
  return (
    <span className="text-[11px] font-mono text-accent tabular-nums small-caps">{hh}:{mm}:{ss}</span>
  )
}

// Health dot: green = backend reachable, amber pulsing = unknown/unreachable.
function HealthDot({ health }) {
  const ok = !!health && health.status === 'ok'
  return (
    <span
      title={ok ? 'Backend online' : 'Backend unreachable / unknown'}
      className={`inline-block w-2 h-2 rounded-full ${ok ? 'bg-ok' : 'bg-err animate-pulse'}`}
    />
  )
}

// melancholic "SOC night shift" header — warm raised bar, amber wordmark with a
// blinking indicator, a backend health dot, a provider quick-switch dropdown,
// and a small-caps model read-out. Desktop also gets a live clock; on phones
// the bar stays lean (no logo/clock) so nothing overlaps or clips.
export default function Header({ onSettings, onMenu, providerLabel, model, providers = {}, activeProvider, onSwitchProvider, health }) {
  const hasProviders = onSwitchProvider && Object.keys(providers).length > 0
  return (
    <header className="shrink-0 flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 bg-panel border-b border-border">
      <div className="flex items-center gap-2 min-w-0">
        {onMenu && (
          <button
            onClick={onMenu}
            className="md:hidden p-1.5 -ml-1 rounded-lg text-muted hover:text-accent hover:bg-panel2 transition-colors"
            title="Open conversations"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}
        <span className="font-serif text-[15px] text-text2 whitespace-nowrap">
          Sallaapam<span className="text-accent animate-blink">●</span>
        </span>
      </div>
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <HealthDot health={health} />
        <span className="hidden sm:inline"><Clock /></span>
        {hasProviders ? (
          <select
            value={activeProvider || ''}
            onChange={(e) => onSwitchProvider(e.target.value)}
            title="Switch provider"
            className="min-w-0 max-w-[128px] sm:max-w-[240px] bg-panel border border-border rounded-lg pl-2 pr-1 py-1 text-[11px] small-caps text-text2 outline-none cursor-pointer hover:border-accent2 truncate"
          >
            {Object.entries(providers).map(([pid, p]) => (
              <option key={pid} value={pid} className="bg-panel text-text normal-case">
                {p.label}
              </option>
            ))}
          </select>
        ) : providerLabel ? (
          <span className="text-[12px] text-muted small-caps truncate">
            {providerLabel} · <span className="text-text2">{model}</span>
          </span>
        ) : null}
        {hasProviders && (
          <span className="hidden md:inline text-[11px] text-muted small-caps">
            <span className="text-text2">{model}</span>
          </span>
        )}
        <button
          onClick={onSettings}
          className="p-1.5 -mr-1 rounded-lg text-muted hover:text-accent hover:bg-panel2 transition-colors"
          title="Settings"
        >
          <Gear className="w-5 h-5" />
        </button>
      </div>
    </header>
  )
}
