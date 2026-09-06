import React, { useState } from 'react'
import { Shield } from './Icons.jsx'

// Full-screen passphrase prompt shown when the API answers 401. The backend
// sets a signed 30-day HttpOnly cookie on success, so each device/browser
// unlocks once and stays unlocked.
export default function LockScreen({ onUnlock, busy = false, error = '' }) {
  const [pw, setPw] = useState('')
  const submit = (e) => {
    e.preventDefault()
    if (pw.trim() && !busy) onUnlock(pw.trim())
  }
  return (
    <form onSubmit={submit} className="w-full max-w-xs space-y-5 text-center">
      <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto">
        <Shield className="w-7 h-7 text-accent" />
      </div>
      <div>
        <h1 className="font-serif text-[22px] text-text2">Sallaapam</h1>
        <p className="text-[12px] text-muted mt-1 small-caps">node locked · passphrase required</p>
      </div>
      <input
        type="password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        placeholder="passphrase"
        autoFocus
        autoComplete="current-password"
        className="w-full bg-panel text-text text-center border border-border rounded-xl px-3 py-2.5 text-[14px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 transition-colors placeholder:text-muted/50"
      />
      {error && <div className="text-[12px] text-err">{error}</div>}
      <button
        type="submit"
        disabled={!pw.trim() || busy}
        className="w-full py-2.5 rounded-xl bg-accent text-[#1a1000] font-semibold text-[13px] hover:brightness-90 disabled:opacity-40 transition-all"
      >
        {busy ? 'Unlocking…' : 'Unlock'}
      </button>
      <p className="text-[11px] text-muted/60">
        One passphrase per device — this browser stays unlocked for 30 days.
      </p>
    </form>
  )
}
