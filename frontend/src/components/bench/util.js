// Small shared helpers for the Benchmark Arena UI.
export const fmtMs = (ms) => (ms == null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`)
export const fmtCost = (c) => (c == null ? '—' : c === 0 ? 'free' : c < 0.01 ? `$${c.toFixed(5)}` : `$${c.toFixed(3)}`)
export const fmtTok = (n) => (n == null ? '—' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
export const keyOf = (provider, model) => `${provider}/${model}`
export const cleanLabel = (l = '') => l.replace(/\s*\((free[^)]*|cloud[^)]*)\)\s*/gi, '').trim()

export function providerHue(provider) {
  let h = 7
  for (let i = 0; i < (provider || '').length; i++) h = (h * 31 + provider.charCodeAt(i)) % 360
  return h
}

// 0 -> red, 100 -> green; null -> neutral. Returned as inline style so it works in both themes.
export function scoreStyle(score) {
  if (score == null) return {}
  const hue = Math.max(0, Math.min(120, score * 1.2))
  return { background: `hsl(${hue} 60% 42% / 0.30)`, boxShadow: `inset 0 0 0 1px hsl(${hue} 60% 50% / 0.35)` }
}

export function downloadFile(name, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const csvCell = (v) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
