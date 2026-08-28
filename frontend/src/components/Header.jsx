import React from 'react'

// Minimal header — app name + hamburger (opens the mobile conversation drawer)
// + a settings button. All provider/model/language controls live in the
// SettingsModal, keeping the header uncluttered on small screens.
export default function Header({ onSettings, onMenu, providerLabel, model }) {
  return (
    <header className="flex items-center justify-between px-4 py-2.5 bg-black border-b border-border">
      <div className="flex items-center gap-2">
        {onMenu && (
          <button
            onClick={onMenu}
            className="md:hidden p-1.5 rounded-lg text-muted hover:text-text hover:bg-panel2 transition-colors"
            title="Open conversations"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="Sallaapam" className="h-6 w-auto object-contain" />
          <span className="font-semibold text-[15px] text-accent">Sallaapam</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {providerLabel && (
          <span className="text-[12px] text-muted">
            {providerLabel} · <span className="text-text/60">{model}</span>
          </span>
        )}
        <button
          onClick={onSettings}
          className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-panel2 transition-colors"
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
