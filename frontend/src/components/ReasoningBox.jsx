import React, { useEffect, useRef } from 'react'
import hljs from 'highlight.js/lib/common'
import { Brain, ChevronDown } from './Icons.jsx'

// Reasoning collapsible box (e.g. gpt-5 / qwen reasoning payloads).
// While `streaming`, reasoning arrives live and the panel stays open with a
// "Thinking…" label; afterwards it renders as the normal collapsed summary.
export default function ReasoningBox({ reasoning, streaming = false }) {
  const ref = useRef(null)

  useEffect(() => {
    if (!ref.current) return
    ref.current.querySelectorAll('pre code').forEach((block) => {
      try { hljs.highlightElement(block) } catch (e) {}
    })
  }, [reasoning])

  if (!reasoning) return null
  return (
    <details className="collapsible mt-3 rounded-xl border border-border bg-panel2/30" open={streaming || undefined}>
      <summary className="px-3 py-2 text-sm font-medium text-accent2 cursor-pointer flex items-center gap-2">
        <Brain className="w-4 h-4" />
        <span>{streaming ? 'Thinking…' : 'Model reasoning'}</span>
        {streaming && <span className="w-1.5 h-1.5 rounded-full bg-accent2 animate-pulse" />}
        <ChevronDown className="w-4 h-4 ml-auto summary-chevron" />
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
