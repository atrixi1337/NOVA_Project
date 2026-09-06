import React, { useEffect, useRef, useState } from 'react'
import { renderMarkdown } from '../markdown.jsx'

// SVG markup for inline copy buttons injected into rendered <pre> blocks.
// Both icons are stacked; the active one is toggled via the `.copied` class so
// the clip reads the code's text directly (SVG icons contribute nothing to
// innerText, so no fragile text-stripping is required).
const COPY_ICON =
  '<svg class="copy-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
  '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" ' +
  'd="M8 5V3.5a2.5 2.5 0 012.5-2.5h7A2.5 2.5 0 0120 3.5V18a2.5 2.5 0 01-2.5 2.5H10m-2 0a2.5 2.5 0 01-2.5-2.5V9.5A2.5 2.5 0 017.5 7h7a2.5 2.5 0 0 1 2.5 2.5v8.5a2.5 2.5 0 01-2.5 2.5h-7A2.5 2.5 0 015 18z" />' +
  '</svg>'

const CHECK_ICON =
  '<svg class="check-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
  '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
  'd="M5 13l4 4L19 7" />' +
  '</svg>'

// Renders markdown for assistant messages, attaching a copy-to-clipboard button
// to every <pre><code> block. The button is injected after first paint via a
// ref effect (React can't manage children rendered through dangerouslySetInnerHTML).
function Markdown({ content }) {
  const html = renderMarkdown(content)
  const ref = useRef(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return
    root.querySelectorAll('pre').forEach((pre) => {
      if (pre.querySelector('.copy-btn')) return
      const btn = document.createElement('button')
      btn.className = 'copy-btn'
      btn.title = 'Copy code'
      btn.innerHTML = COPY_ICON + CHECK_ICON
      btn.onclick = () => {
        const code = pre.querySelector('code')
        navigator.clipboard?.writeText((code ? code.innerText : pre.innerText) || '')
        btn.classList.add('copied')
        setTimeout(() => btn.classList.remove('copied'), 2000)
      }
      pre.appendChild(btn)
    })
  }, [html])

  return <div className="md" ref={ref} dangerouslySetInnerHTML={{ __html: html }} />
}

// Renders message content. Handles markdown for assistant messages, plain text
// for user messages, and multi-modal user messages whose `content` is a list of
// content blocks (text + image_url blocks from image/file uploads).
function UserContent({ content }) {
  if (Array.isArray(content)) {
    return (
      <div className="flex flex-col gap-2">
        {content.map((block, i) => {
          if (block?.type === 'text')
            return <div key={i} className="whitespace-pre-wrap overflow-wrap-anywhere">{block.text || ''}</div>
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
  return <div className="whitespace-pre-wrap overflow-wrap-anywhere">{content}</div>
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
        className={`max-w-[820px] w-full flex gap-3 items-start ${isUser ? 'flex-row-reverse' : ''}`}
      >
        <div
          className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0 ${
            isUser ? 'bg-accent text-[#1a1000]' : 'bg-accent2 text-[#04122b]'
          }`}
        >
          {isUser ? 'You' : 'AI'}
        </div>
        <div
          className={`rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${
            isUser ? 'bg-accent/10 border border-accent/20' : 'bg-panel2 border border-border'
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
