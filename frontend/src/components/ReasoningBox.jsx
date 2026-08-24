import React, { useEffect, useRef } from 'react'

// Reasoning collapsible box (e.g. gpt-5 / qwen reasoning payloads).
export default function ReasoningBox({ reasoning }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!ref.current) return
    ref.current.querySelectorAll('pre code').forEach((b) => {
      try { import('highlight.js/lib/common').then((hljs) => hljs.default.highlightElement(b)) } catch {}
    })
  }, [reasoning])
  if (!reasoning) return null
  return (
    <details className="collapsible mt-3 rounded-xl border border-border bg-panel/50">
      <summary className="px-3 py-2 text-sm font-semibold text-accent2">🧠 Model reasoning</summary>
      <div className="md px-3 pb-3 text-[13px] text-muted" ref={ref} style={{ whiteSpace: 'pre-wrap' }}>
        {reasoning}
      </div>
    </details>
  )
}
