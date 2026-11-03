import { marked } from 'marked'
import DOMPurify from 'dompurify'

// Content is read through the existing authenticated, fixed-version file APIs.
// This policy only governs how those untrusted bytes are displayed in the browser.
export const richDocumentKind = (mime, filename = '') => {
  const type = String(mime || '').split(';', 1)[0].trim().toLowerCase()
  if (type === 'text/html') return 'html'
  if (['text/markdown', 'text/x-markdown'].includes(type)) return 'markdown'
  if (['', 'text/plain', 'application/octet-stream'].includes(type)) {
    if (/\.html?$/i.test(filename)) return 'html'
    if (/\.(md|markdown)$/i.test(filename)) return 'markdown'
  }
  return ''
}

export const RICH_DOCUMENT_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"

export function richDocumentSource (text, kind) {
  const raw = kind === 'markdown' ? marked.parse(String(text || ''), { gfm: true, async: false }) : String(text || '')
  const clean = DOMPurify.sanitize(raw, {
    WHOLE_DOCUMENT: true,
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'link', 'base', 'meta', 'form', 'input', 'button', 'textarea', 'select', 'video', 'audio'],
    FORBID_ATTR: ['href', 'srcset', 'action', 'formaction', 'target', 'download', 'autofocus']
  })
  const doc = new DOMParser().parseFromString(clean, 'text/html')
  for (const image of doc.querySelectorAll('img')) {
    if (!/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(image.getAttribute('src') || '')) image.removeAttribute('src')
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${RICH_DOCUMENT_CSP}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:16px;color:#293d36;font:15px/1.65 system-ui,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}pre{overflow:auto;padding:12px;background:#f4f4f0;white-space:pre-wrap}code{font-family:monospace}table{border-collapse:collapse;display:block;overflow:auto;max-width:100%}th,td{padding:6px 10px;border:1px solid #deddd6}blockquote{margin-left:0;padding-left:12px;border-left:3px solid #c6c9bf}a{color:inherit}</style>${doc.head.innerHTML}</head><body>${doc.body.innerHTML}</body></html>`
}
