const unsafeFilename = /[\\/:*?"<>|]/g

export const safeOutputFilename = (item = {}) => {
  const raw = String(item.title || item.name || 'output')
  const cleaned = [...raw].map(char => char.charCodeAt(0) < 32 ? '_' : char).join('')
    .replace(unsafeFilename, '_').replace(/^\.+/, '').trim()
  return (cleaned || 'output').slice(0, 180)
}

/** Creates a browser download only from an adapter-returned Blob for the exact selected version. */
export function saveOutputBlob ({ blob, item, documentRef = globalThis.document, urlApi = globalThis.URL } = {}) {
  if (!(blob instanceof Blob)) throw new TypeError('A Blob is required for output download')
  const href = urlApi?.createObjectURL?.(blob)
  const anchor = documentRef?.createElement?.('a')
  if (!href || !anchor) throw new Error('当前浏览器不能创建安全下载。')
  try {
    anchor.href = href
    anchor.download = safeOutputFilename(item)
    anchor.rel = 'noopener'
    anchor.style.display = 'none'
    documentRef.body?.appendChild(anchor)
    anchor.click()
  } finally {
    anchor.remove?.()
    urlApi.revokeObjectURL?.(href)
  }
}
