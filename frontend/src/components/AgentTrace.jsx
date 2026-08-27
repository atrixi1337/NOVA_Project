import React from 'react'

// Agent tool-trace panel: shows assistant turns, tool calls + results, usage.
export default function AgentTrace({ trace = [] }) {
  if (!trace.length) return null
  const toolCount = trace.filter((t) => t.type === 'tool').length
  return (
    <details className="collapsible mt-3 rounded-xl border border-border bg-panel2/50">
      <summary className="px-3 py-2 text-sm font-medium text-accent2 cursor-pointer flex items-center gap-2">
        <span>🛠</span>
        <span>Tool trace ({toolCount} calls)</span>
      </summary>
      <div className="px-3 pb-3 space-y-2">
        {trace.map((t, i) => {
          if (t.type === 'tool') {
            return (
              <div key={i} className="rounded-lg border border-border bg-panel/60 p-2.5 text-[13px]">
                <div className="font-mono text-accent2 mb-1">
                  ▶ {t.name}({JSON.stringify(t.arguments)})
                </div>
                <pre className="whitespace-pre-wrap text-muted text-[12px] break-all">
                  {String(t.result)}
                </pre>
              </div>
            )
          }
          if (t.type === 'assistant' && t.content) {
            return (
              <div key={i} className="rounded-lg border border-border bg-panel/60 p-2 text-[12px] text-muted">
                <span className="text-accent2">assistant:</span> {t.content.slice(0, 400)}
                {t.content.length > 400 ? '…' : ''}
              </div>
            )
          }
          if (t.type === 'usage') {
            const u = t.data || {}
            const total = u.total_tokens ?? (u.prompt_tokens ?? 0 + (u.completion_tokens ?? 0))
            return (
              <div key={i} className="text-[11px] text-muted flex gap-3">
                <span>prompt: {u.prompt_tokens ?? '?'}</span>
                <span>completion: {u.completion_tokens ?? '?'}</span>
                <span className="text-text font-medium">total: {total ?? '?'}</span>
              </div>
            )
          }
          if (t.type === 'notice') {
            return <div key={i} className="text-[12px] text-muted italic">{t.content}</div>
          }
          return null
        })}
      </div>
    </details>
  )
}
