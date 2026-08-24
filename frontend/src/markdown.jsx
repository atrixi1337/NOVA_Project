import { marked } from 'marked'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/common'

marked.setOptions({ breaks: true, gfm: true })

// Render markdown to sanitized HTML and highlight code blocks.
export function renderMarkdown(src) {
  if (!src) return ''
  const raw = marked.parse(src)
  const clean = DOMPurify.sanitize(raw)
  // highlight after sanitize (sanitize strips nothing we need; hljs adds spans)
  const tmp = document.createElement('div')
  tmp.innerHTML = clean
  tmp.querySelectorAll('pre code').forEach((block) => {
    try { hljs.highlightElement(block) } catch {}
  })
  return tmp.innerHTML
}
