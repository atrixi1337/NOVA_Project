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
      <button className="copy-btn" onClick={copy} title="Copy code">
        {copied ? '✓ copied' : 'copy'}
      </button>
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
      btn.title = 'Copy code'
      btn.onclick = () => {
        navigator.clipboard?.writeText(pre.innerText.replace(/copy$/i, '').replace(/✓ copied/i, ''))
        btn.textContent = '✓ copied'
        setTimeout(() => (btn.textContent = 'copy'), 1200)
      }
      pre.appendChild(btn)
    })
  }, [html])
  return <div className="md" ref={ref} dangerouslySetInnerHTML={{ __html: html }} />
}

// Renders a message content. Handles markdown for assistant messages,
// plain text for user messages, and thinking state. Also supports
// multi-modal user messages whose `content` is a list of content blocks
// (text + image_url blocks from image/file uploads).
function UserContent({ content }) {
  if (Array.isArray(content)) {
    return (
      <div className="flex flex-col gap-2">
        {content.map((block, i) => {
          if (block?.type === 'text')
            return <div key={i} className="whitespace-pre-wrap">{block.text || ''}</div>
          if (block?.type === 'image_url')
            return (
              <img
                key={i}
                src={block.image_url?.url || ''}
                alt="attachment"
                className="max-w-[260px] max-h-[260px] object-contain rounded-lg border border-border"
              />
            )
          return null
        })}
      </div>
    )
  }
  return <div className="whitespace-pre-wrap">{content}</div>
}

export default function Message({ msg }) {
  const isUser = msg.role === 'user'
  const hasContent = msg.content && (
    typeof msg.content === 'string'
      ? msg.content.trim()
      : Array.isArray(msg.content) && msg.content.length > 0
  )

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} px-3 sm:px-6`}>
      <div
        className={`max-w-[820px] w-full flex gap-3 items-start ${
          isUser ? 'flex-row-reverse' : ''
        }`}
      >
        <div
          className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0 ${
            isUser
              ? 'bg-accent text-[#1a1000]'
              : 'bg-accent2 text-[#04122b]'
          }`}
        >
          {isUser ? 'You' : 'AI'}
        </div>
        <div
          className={`rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${
            isUser
              ? 'bg-accent/10 border border-accent/20'
              : 'bg-panel2 border border-border'
          }`}
        >
          {isUser ? (
            <UserContent content={msg.content} />
          ) : hasContent ? (
            <Markdown content={msg.content} />
          ) : (
            <div className="text-muted italic">…thinking</div>
          )}
        </div>
      </div>
    </div>
  )
}
