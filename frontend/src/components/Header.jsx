import React, { useEffect, useState } from 'react'
import { Gear, Sun, Moon } from './Icons.jsx'

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

function fmtBytes(b) {
  if (b == null) return '—'
  if (b > 1024 ** 4) return `${(b / 1024 ** 4).toFixed(1)} TB`
  if (b > 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`
  if (b > 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1)} MB`
  return `${Math.round(b)} B`
}
function fmtGB(kb) {
  return kb == null ? '—' : `${(kb / 1024 / 1024).toFixed(1)} GB`
}
function fmtUptime(s) {
  if (s == null) return '—'
  const n = Math.floor(s)
  const d = Math.floor(n / 86400)
  const h = Math.floor((n % 86400) / 3600)
  const m = Math.floor((n % 3600) / 60)
  return d ? `${d}d ${h}h` : `${h}h ${m}m`
}

// Tapping the header health dot reveals this phone-host HUD (RAM / disk / CPU
// load / uptime +, when Termux:API is installed, battery % and Wi-Fi).
function HostPopover({ host, onClose }) {
  const ram = (host && host.ram_kb) || {}
  const disk = (host && host.disk) || {}
  const b = host && host.battery
  const w = host && host.wifi
  const batt = b
    ? `${b.level ?? b.percentage ?? '—'}% · ${b.status ?? '—'}`
    : '— (install the Termux:API app)'
  const wifi = w
    ? `${w.ssid ?? w.Ssid ?? '—'} (${w.rssi != null ? w.rssi : '—'})`
    : '— (install the Termux:API app)'
  const rows = [
    ['RAM', `${fmtGB(ram.memavailable_kb)} / ${fmtGB(ram.memtotal_kb)} (avail/total)`],
    ['Disk', `${fmtBytes(disk.free)} free / ${fmtBytes(disk.total)}`],
    ['Load', Array.isArray(host && host.load1_load5_load15) ? host.load1_load5_load15.join(' ') : '—'],
    ['Uptime', fmtUptime(host && host.uptime_s)],
    ['Battery', batt],
    ['Wi-Fi', wifi],
  ]
  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-end pt-14 pr-3"
      onClick={onClose}
    >
      <div
        className="w-64 max-w-[90vw] bg-panel2 border border-border rounded-lg shadow-xl text-[11px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-1.5 border-b border-border small-caps text-accent2">Phone host</div>
        <table className="w-full">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td className="px-3 py-1 text-muted">{k}</td>
                <td className="px-3 py-1 text-text2 font-mono text-right break-words">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-3 py-1 border-t border-border text-[10px] text-muted">Refreshes every 15s</div>
      </div>
    </div>
  )
}

// Health dot: green = backend reachable, amber pulsing = unknown/unreachable.
// Tap it (when unlocked and host data is loaded) to reveal the host HUD.
function HealthDot({ health, host }) {
  const ok = !!health && health.status === 'ok'
  const [pop, setPop] = useState(false)
  const hasHost = !!host
  const label = ok
    ? (hasHost ? 'Backend online — show host stats' : 'Backend online')
    : 'Backend unreachable or unknown'
  const dot = `inline-block w-2.5 h-2.5 rounded-full ${ok ? 'bg-ok' : 'bg-err animate-pulse'}`
  if (!hasHost) {
    return <span role="img" aria-label={label} title={label} className={dot} />
  }
  return (
    <div className="flex items-center">
      <button
        type="button"
        onClick={() => setPop((p) => !p)}
        aria-label={label}
        aria-expanded={pop}
        title={label}
        className="p-1.5 -m-1.5 rounded-full hover:bg-panel2 transition-colors"
      >
        <span className={dot} />
      </button>
      {pop && <HostPopover host={host} onClose={() => setPop(false)} />}
    </div>
  )
}

// Minimal top bar: section/conversation title on the left, a single model pill,
// health dot and quick actions on the right. Navigation lives in NavRail.
export default function Header({ onSettings, onMenu, title = '', providerLabel, model, providers = {}, activeProvider, onSwitchProvider, health, host }) {
  const hasProviders = onSwitchProvider && Object.keys(providers).length > 0
  const current = (activeProvider && providers[activeProvider]?.label) || providerLabel || ''
  return (
    <header className="shrink-0 flex items-center justify-between gap-3 px-3 sm:px-6 h-14">
      <div className="flex items-center gap-2 min-w-0">
        {onMenu && (
          <button onClick={onMenu} title="Conversations" aria-label="Open conversations"
            className="md:hidden p-2 -ml-1 rounded-full text-muted hover:text-text hover:bg-panel2 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7h16M4 12h10M4 17h16" />
            </svg>
          </button>
        )}
        <h1 className="text-[15px] font-semibold tracking-tight text-text2 truncate">{title}</h1>
      </div>
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <HealthDot health={health} host={host} />
        {hasProviders ? (
          <label className="relative flex items-center gap-2 min-w-0 max-w-[200px] sm:max-w-[320px] pl-3.5 pr-2.5 py-1.5 rounded-full bg-panel2/80 border border-border/60 hover:border-accent/50 transition-colors cursor-pointer">
            <span className="text-[12.5px] font-medium text-text2 truncate">{current}</span>
            {model && <span className="hidden sm:inline text-[12px] text-muted truncate">{model}</span>}
            <svg className="w-3.5 h-3.5 shrink-0 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 9l6 6 6-6" /></svg>
            <select value={activeProvider || ''} onChange={(e) => onSwitchProvider(e.target.value)}
              title="Switch provider" aria-label="Switch provider"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
              {Object.entries(providers).map(([pid, p]) => (
                <option key={pid} value={pid} className="bg-panel text-text">{p.label}</option>
              ))}
            </select>
          </label>
        ) : providerLabel ? (
          <span className="text-[12px] text-muted truncate">{providerLabel} · <span className="text-text2">{model}</span></span>
        ) : null}
        <button onClick={onSettings} title="Settings" aria-label="Settings"
          className="md:hidden p-2 -mr-1 rounded-full text-muted hover:text-text hover:bg-panel2 transition-colors">
          <Gear className="w-5 h-5" />
        </button>
      </div>
    </header>
  )
}
