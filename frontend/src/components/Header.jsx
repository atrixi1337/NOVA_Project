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
  const toggle = hasHost ? () => setPop((p) => !p) : undefined
  return (
    <>
      <span
        onClick={toggle}
        title={ok ? 'Backend online — tap for host stats' : 'Backend unreachable / unknown'}
        className={`inline-block w-2.5 h-2.5 rounded-full ${hasHost ? 'cursor-pointer' : ''} ${ok ? 'bg-ok' : 'bg-err animate-pulse'}`}
      />
      {pop && hasHost && <HostPopover host={host} onClose={() => setPop(false)} />}
    </>
  )
}

// melancholic "SOC night shift" header — warm raised bar, amber wordmark with a
// blinking indicator, a backend health dot, a provider quick-switch dropdown,
// and a small-caps model read-out. Desktop also gets a live clock; on phones
// the bar stays lean (no logo/clock) so nothing overlaps or clips.
export default function Header({ onSettings, onMenu, providerLabel, model, providers = {}, activeProvider, onSwitchProvider, health, host }) {
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
        <HealthDot health={health} host={host} />
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
