import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { AuthError } from '../api.js'

// ---- formatters -----------------------------------------------------------
const fmt = (n) => (typeof n === 'number' ? n.toLocaleString() : '—')
const toGiB = (bytes) =>
  typeof bytes === 'number' && bytes >= 0
    ? (bytes / (1024 ** 3)).toFixed(1) + ' GB'
    : '—'
// /proc/meminfo reports RAM in KiB (kB), not bytes — never divide by 1024^3.
const kibToGiB = (kib) =>
  typeof kib === 'number' && kib >= 0
    ? (kib / (1024 ** 2)).toFixed(1) + ' GB'
    : '—'
const pctOf = (used, total) =>
  typeof used === 'number' && typeof total === 'number' && total > 0
    ? Math.round((used / total) * 100)
    : null
const dur = (s) => {
  if (typeof s !== 'number') return '—'
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${d > 0 ? d + 'd ' : ''}${h}h ${m}m`
}
const dBm = (v) => (typeof v === 'number' ? v + ' dBm' : '—')

// A stat card with a usage bar (RAM / Disk).
function UsageBar({ label, used, total, kib }) {
  const fmt = kib ? kibToGiB : toGiB
  const p = pctOf(used, total)
  const barPct = p === null ? 0 : p
  const hue =
    p === null ? 'text-muted'
    : p > 85 ? 'text-err'
    : p > 70 ? 'text-amber-400'
    : 'text-accent2'
  return (
    <div className="rounded-xl border border-border bg-panel2 p-3 flex flex-col gap-2">
      <div className="text-[10px] uppercase text-muted tracking-wider">{label}</div>
      <div className={`text-[19px] font-medium ${hue}`}>
        {used != null ? fmt(used) : '—'}<span className="text-[12px] text-muted"> / {total != null ? fmt(total) : '—'}</span>
      </div>
      <div className="h-2 rounded bg-black/35 overflow-hidden">
        <div
          className="h-full rounded transition-all"
          style={{
            width: (p === null ? 0 : barPct) + '%',
            background: p === null ? 'transparent' : 'var(--accent2)',
          }}
        />
      </div>
    </div>
  )
}

// A plain stat card (Load / Uptime / Battery / WiFi).
function Stat({ label, value, sub, muted }) {
  return (
    <div className="rounded-xl border border-border bg-panel2 p-3 flex flex-col gap-1.5">
      <div className="text-[10px] uppercase text-muted tracking-wider">{label}</div>
      <div className="text-[19px] font-medium text-text2">{value}</div>
      {sub && (
        <div className={`text-[11px] ${muted ? 'text-muted/60' : 'text-muted'}`}>{sub}</div>
      )}
    </div>
  )
}

export default function HostHealthTab() {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [stamp, setStamp] = useState(null)

  const load = async () => {
    setBusy(true)
    setErr('')
    try {
      setData(await api.host())
      setStamp(Date.now())
    } catch (e) {
      if (e instanceof AuthError)
        setErr('Locked — open the app and enter the passphrase to unlock.')
      else setErr(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    load()
    const id = setInterval(load, 15000) // match the header HUD cadence
    return () => clearInterval(id)
  }, [])

  const ram = data?.ram_kb ?? {}
  const disk = data?.disk ?? {}
  const loadavg = data?.load1_load5_load15
  const up = data?.uptime_s
  const bat = data?.battery ?? {}
  const wf = data?.wifi ?? null

  return (
    <div className="mx-auto max-w-5xl w-full p-4 sm:p-5 space-y-5">
      <header className="flex items-center justify-between">
        <h2 className="text-[16px] font-semibold text-text2 flex items-center gap-2">
          <svg className="w-4 h-4 text-accent2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 9h.01M12 9h.01M16 9h.01M8 13h.01M12 13h.01M16 13h.01M3 5l2-2M19 5l2-2M3 19l2 2M19 19l2 2"
            />
          </svg>
          Host Health
        </h2>
        <div className="flex items-center gap-3 text-[11px] text-muted">
          {stamp && <span>updated {new Date(stamp).toLocaleTimeString()}</span>}
          <button
            onClick={load}
            disabled={busy}
            className="px-2.5 py-1 text-[12px] rounded-lg border border-border bg-black hover:border-accent2 text-muted hover:text-text disabled:opacity-40 transition-all"
            title="Refresh"
          >
            {busy ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {err && <div className="text-[13px] text-err">{err}</div>}

      {!data && !busy ? (
        <div className="text-[13px] text-muted">Loading host stats…</div>
      ) : data ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <UsageBar
            label="RAM used"
            used={ram.memtotal && ram.memavailable ? ram.memtotal - ram.memavailable : null}
            total={ram.memtotal}
            kib
          />
          <UsageBar label="Disk used" used={disk.used} total={disk.total} />
          <Stat
            label="Load avg (1 / 5 / 15 m)"
            value={loadavg?.length === 3 ? loadavg.join(' / ') : '—'}
            sub={
              loadavg?.length === 3
                ? null
                : 'null — Android restricts /proc/loadavg and no uptime binary is available'
            }
            muted
          />
          <Stat
            label="Phone uptime"
            value={dur(up)}
            sub={typeof up === 'number' ? null : 'null — Android restricts /proc/uptime and no uptime binary is available'}
            muted
          />
          <Stat
            label="Battery"
            value={bat?.percentage != null ? `${bat.percentage}%` : '—'}
            sub={
              bat?.status
                ? `${bat.status}${bat.temperature ? ` · ${bat.temperature}°C` : ''}`
                : ''
            }
          />
          <Stat
            label="Wi-Fi"
            value={wf?.ssid ?? '—'}
            sub={
              wf?.rssi != null
                ? `${dBm(wf.rssi)} · ${wf.ip ?? ''} · ${wf.link_speed_mbps ?? ''} Mbps`
                : ''
            }
          />
        </div>
      ) : null}

      {data?.note && (
        <div className="text-[11px] text-muted/60">• {data.note}</div>
      )}
    </div>
  )
}
