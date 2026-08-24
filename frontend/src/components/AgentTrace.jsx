import React from 'react'

// Agent tool-trace panel: shows assistant turns, tool calls + results, usage.
export default function AgentTrace({ trace = [] }) {
  if (!trace.length) return null
  return (
    <details className="collapsible mt-3 rounded-xl border border-toolborder bg-tool/40">
      <summary className="px-3 py-2 text-sm font-semibold text-ok">
        🛠 Tool trace ({trace.filter((t) => t.type === 'tool').length} calls)
      </summary>
      <div className="px-3 pb-3 space-y-2">
        {trace.map((t, i) => {
          if (t.type === 'tool') {
            return (
              <div key={i} className="rounded-lg border border-toolborder bg-panel/60 p-2 text-[13px]">
                <div className="font-mono text-accent2">▶ {t.name}({JSON.stringify(t.arguments)})</div>
                <pre className="mt-1 whitespace-pre-wrap text-muted">{String(t.result)}</pre>
              </div>
            )
          }
          if (t.type === 'assistant' && t.content) {
            return (
              <div key={i} className="rounded-lg border border-border bg-panel/60 p-2 text-[13px] text-muted">
                <span className="text-accent2">assistant:</span> {t.content.slice(0, 400)}
                {t.content.length > 400 ? '…' : ''}
              </div>
            )
          }
          if (t.type === 'usage') {
            const u = t.data || {}
            return (
              <div key={i} className="text-[12px] text-muted">
                tokens — prompt {u.prompt_tokens ?? '?'} · completion {u.completion_tokens ?? '?'} · total {u.total_tokens ?? '?'}
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
