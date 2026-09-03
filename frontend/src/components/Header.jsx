import React, { useEffect, useState } from 'react'

function Clock() {
  const [t, setT] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const hh = String(t.getHours()).padStart(2, '0')
  const mm = String(t.getMinutes()).padStart(2, '0')
  const ss = String(t.getSeconds()).padStart(2, '0')
  return (
    <span className="text-[11px] font-mono text-accent tabular-nums small-caps">{hh}:{mm}:{ss}</span>
  )
}

// melancholic "SOC night shift" header — warm raised bar, amber wordmark with a
// blinking indicator, a live clock, and a small-caps provider/model read-out.
export default function Header({ onSettings, onMenu, providerLabel, model }) {
  return (
    <header className="flex items-center justify-between px-4 py-2.5 bg-panel border-b border-border">
      <div className="flex items-center gap-2">
        {onMenu && (
          <button
            onClick={onMenu}
            className="md:hidden p-1.5 rounded-lg text-muted hover:text-accent hover:bg-panel2 transition-colors"
            title="Open conversations"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="Sallaapam" className="h-6 w-6 object-contain" />
          <span className="font-serif text-[15px] text-text2">
            Sallaapam<span className="text-accent animate-blink">●</span>
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Clock />
        {providerLabel && (
          <span className="text-[12px] text-muted small-caps">
            {providerLabel} · <span className="text-text2">{model}</span>
          </span>
        )}
        <button
          onClick={onSettings}
          className="p-1.5 rounded-lg text-muted hover:text-accent hover:bg-panel2 transition-colors"
          title="Settings"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 5v14m7-7H5" />
          </svg>
        </button>
      </div>
    </header>
  )
}
