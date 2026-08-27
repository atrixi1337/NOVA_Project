import React, { useEffect, useRef } from 'react'
import hljs from 'highlight.js/lib/common'

// Reasoning collapsible box (e.g. gpt-5 / qwen reasoning payloads).
export default function ReasoningBox({ reasoning }) {
  const ref = useRef(null)

  useEffect(() => {
    if (!ref.current) return
    ref.current.querySelectorAll('pre code').forEach((block) => {
      try { hljs.highlightElement(block) } catch (e) {}
    })
  }, [reasoning])

  if (!reasoning) return null
  return (
    <details className="collapsible mt-3 rounded-xl border border-border bg-panel2/30">
      <summary className="px-3 py-2 text-sm font-medium text-accent2 cursor-pointer flex items-center gap-2">
        <span>🧠</span>
        <span>Model reasoning</span>
      </summary>
      <div
        className="px-3 pb-3 text-[13px] text-muted"
        ref={ref}
        style={{ whiteSpace: 'pre-wrap' }}
        dangerouslySetInnerHTML={{ __html: reasoning }}
      />
    </details>
  )
}
