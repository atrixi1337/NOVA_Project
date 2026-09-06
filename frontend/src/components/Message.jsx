import React, { useEffect, useRef, useState } from 'react'
import { renderMarkdown } from '../markdown.jsx'
import { Copy, Check, Pencil, Refresh } from './Icons.jsx'

// SVG markup for the copy button in code block headers.
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

// Wrap every rendered <pre> in a .codeblock with a header bar showing the
// detected language + an always-visible copy button. React can't manage
// children rendered through dangerouslySetInnerHTML, so this DOM surgery runs
// after each render of new markdown (same pattern as the old inline copy btn).
function enhanceCodeBlocks(root) {
  root.querySelectorAll('pre').forEach((pre) => {
    if (pre.parentElement?.classList.contains('codeblock')) return
    const code = pre.querySelector('code')
    let lang = ''
    if (code) {
      const m = (code.className || '').match(/language-([\w+#.-]+)/)
      if (m) lang = m[1]
    }
    const wrap = document.createElement('div')
    wrap.className = 'codeblock'

    const head = document.createElement('div')
    head.className = 'codeblock-head'

    const label = document.createElement('span')
    label.className = 'codeblock-lang'
    label.textContent = lang || 'code'

    const btn = document.createElement('button')
    btn.className = 'copy-btn'
    btn.title = 'Copy code'
    btn.innerHTML = COPY_ICON + CHECK_ICON
    btn.onclick = () => {
      navigator.clipboard?.writeText((code ? code.innerText : pre.innerText) || '')
      btn.classList.add('copied')
      setTimeout(() => btn.classList.remove('copied'), 2000)
    }

    head.appendChild(label)
    head.appendChild(btn)
    pre.replaceWith(wrap)
    wrap.appendChild(head)
    wrap.appendChild(pre)
  })
}

// Renders markdown for assistant messages, then attaches the code-block
// header bars (language + copy) via the effect below. Exported for reuse
// (Arena columns render provider outputs with the same pipeline). While
// `streaming`, a blinking caret trails the reply.
export function Markdown({ content, streaming = false }) {
  const html = renderMarkdown(content)
  const ref = useRef(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return
    enhanceCodeBlocks(root)
  }, [html])

  return (
    <div className={streaming ? 'md md-streaming' : 'md'}>
      <div ref={ref} dangerouslySetInnerHTML={{ __html: html }} />
      {streaming && <span className="stream-caret" aria-hidden="true">▍</span>}
    </div>
  )
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

// Flatten any message content shape to plain text (for the copy action).
function messageText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b) => b?.type === 'text')
      .map((b) => b.text || '')
      .join('\n')
  }
  return ''
}

export default function Message({ msg, streaming = false, onEdit, onRegenerate }) {
  const isUser = msg.role === 'user'
  const hasContent = msg.content && (
    typeof msg.content === 'string'
      ? msg.content.trim()
      : Array.isArray(msg.content) && msg.content.length > 0
  )
  const [copied, setCopied] = useState(false)

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(messageText(msg.content))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  return (
    <div className={`group relative flex ${isUser ? 'justify-end' : 'justify-start'} px-3 sm:px-6 msg-in`}>
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
        <div className="relative min-w-0">
          {/* hover actions: copy always; edit on user msgs; retry on assistant */}
          <div
            className={`absolute -top-3 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity ${
              isUser ? 'left-2' : 'right-2'
            }`}
          >
            {isUser && onEdit && (
              <button
                onClick={onEdit}
                title="Edit and resend"
                className="flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-border bg-panel text-[10px] text-muted hover:text-text hover:border-accent2/60 transition-colors"
              >
                <Pencil className="w-3 h-3" />
                <span>edit</span>
              </button>
            )}
            {!isUser && onRegenerate && (
              <button
                onClick={onRegenerate}
                title="Regenerate reply"
                className="flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-border bg-panel text-[10px] text-muted hover:text-text hover:border-accent2/60 transition-colors"
              >
                <Refresh className="w-3 h-3" />
                <span>retry</span>
              </button>
            )}
            <button
              onClick={copyMessage}
              title="Copy message"
              className="flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-border bg-panel text-[10px] text-muted hover:text-text hover:border-accent2/60 transition-colors"
            >
              {copied ? <Check className="w-3 h-3 text-ok" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? 'copied' : 'copy'}</span>
            </button>
          </div>
          <div
            className={`rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${
              isUser ? 'bg-accent/10 border border-accent/20' : 'bg-panel2 border border-border'
            }`}
          >
            {isUser ? (
              <UserContent content={msg.content} />
            ) : hasContent ? (
              <Markdown content={msg.content} streaming={streaming && !isUser} />
            ) : (
              <div className="text-muted italic">…thinking</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
