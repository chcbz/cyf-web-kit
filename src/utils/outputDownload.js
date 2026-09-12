import { useHttp } from '../composables/useHttp.js'

const unsafeFilename = /[\\/:*?"<>|]/g
const attachmentParameter = /(?:^|;)\s*filename\*?\s*=\s*(?:UTF-8''([^;]+)|"([^"]*)"|([^;]+))/i

export function safeOutputFilename (item = {}) {
  const withoutControls = [...String(item.name || item.title || 'output')]
    .map(character => character.charCodeAt(0) < 32 ? '_' : character)
    .join('')
  const candidate = withoutControls
    .replace(unsafeFilename, '_')
    .replace(/^\.+/, '')
    .trim()
  return (candidate || 'output').slice(0, 180)
}

export function contentDispositionFilename (value = '') {
  const match = String(value).match(attachmentParameter)
  if (!match) return ''
  const encoded = match[1]
  if (encoded) {
    try {
      return decodeURIComponent(encoded)
    } catch {
      return encoded
    }
  }
  return (match[2] ?? match[3] ?? '').trim()
}

export async function downloadOutput ({ url, item, signal, authStore, timeout, http } = {}) {
  if (!url) throw new TypeError('A download URL is required')
  const request = http || useHttp()
  const result = await request.get(url, undefined, { responseType: 'blob', signal, authStore, timeout })
  const responseName = contentDispositionFilename(result.headers?.['content-disposition'])
  const objectUrl = URL.createObjectURL(result.data)
  let anchor
  try {
    anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = safeOutputFilename({ name: responseName || item?.name, title: item?.title })
    anchor.rel = 'noopener'
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
  } finally {
    anchor?.remove()
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
  }
  return result
}
