import React, { useEffect, useRef, useState } from 'react'
import { renderMarkdown } from '../markdown.jsx'

function CodeBlock({ html }) {
  const ref = useRef(null)
  const [copied, setCopied] = useState(false)
  const copy = () => {
    const code = ref.current?.innerText || ''
    navigator.clipboard?.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }
  return (
    <pre>
      <button className="copy-btn" onClick={copy}>{copied ? 'copied' : 'copy'}</button>
      <code ref={ref} dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  )
}

// Renders markdown but lifts <pre><code> out so we can attach copy buttons.
function Markdown({ content }) {
  const html = renderMarkdown(content)
  const ref = useRef(null)
  useEffect(() => {
    const root = ref.current
    if (!root) return
    root.querySelectorAll('pre').forEach((pre) => {
      if (pre.querySelector('.copy-btn')) return
      const code = pre.querySelector('code')
      const btn = document.createElement('button')
      btn.className = 'copy-btn'
      btn.textContent = 'copy'
      btn.onclick = () => {
        navigator.clipboard?.writeText(pre.innerText.replace(/copy$/, ''))
        btn.textContent = 'copied'
        setTimeout(() => (btn.textContent = 'copy'), 1200)
      }
      pre.appendChild(btn)
    })
  }, [html])
  return <div className="md" ref={ref} dangerouslySetInnerHTML={{ __html: html }} />
}

export default function Message({ msg }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} px-3 sm:px-6`}>
      <div className={`max-w-[820px] w-full flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
        <div className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${isUser ? 'bg-accent text-[#1a1000]' : 'bg-accent2 text-[#04122b]'}`}>
          {isUser ? 'You' : 'AI'}
        </div>
        <div className={`rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${isUser ? 'bg-user border border-border' : 'bg-panel2 border border-border'}`}>
          {isUser ? (
            <div className="whitespace-pre-wrap">{msg.content}</div>
          ) : msg.content ? (
            <Markdown content={msg.content} />
          ) : (
            <div className="text-muted italic">…thinking</div>
          )}
        </div>
      </div>
    </div>
  )
}
