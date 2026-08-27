import React from 'react'

// Minimal header — just the app name and a settings (hamburger) button.
// All provider/model/reasoning/agent settings live in the SettingsModal.
export default function Header({ onSettings, providerLabel, model }) {
  return (
    <header className="flex items-center justify-between px-4 py-2.5 bg-black border-b border-border">
      <div className="font-semibold text-[15px] text-text">
        <span className="text-accent">NOVA</span> Chat
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
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M12 5v14m7-7H5" />
          </svg>
        </button>
      </div>
    </header>
  )
}
