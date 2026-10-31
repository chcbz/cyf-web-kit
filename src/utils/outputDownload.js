import { inMiniProgram, assertCurrent, saveInMiniProgram } from './miniProgramFileBridge.js'
import miniConfig from '../../miniprogram/juyiting/utils/app-config.json'

const unsafeFilename = /[\\/:*?"<>|]/g

export const safeOutputFilename = (item = {}) => {
  const raw = String(item.title || item.name || 'output')
  const cleaned = [...raw].map(char => char.charCodeAt(0) < 32 ? '_' : char).join('')
    .replace(unsafeFilename, '_').replace(/^\.+/, '').trim()
  const name = cleaned || 'output'
  const extension = name.match(/\.[a-zA-Z0-9]{1,16}$/)?.[0] || ''
  return name.length <= 180 ? name : name.slice(0, 180 - extension.length).replace(/[\uD800-\uDBFF]$/, '') + extension
}

/** Desktop uses a browser download; WeChat mini program uses the bounded native bridge. */
export function saveOutputBlob ({ blob, item, documentRef = globalThis.document, urlApi = globalThis.URL, host = globalThis.window, signal, isCurrent, onHandoff, returnTarget } = {}) {
  assertCurrent({ signal, isCurrent })
  if (!(blob instanceof Blob)) throw new TypeError('A Blob is required for output download')
  if (inMiniProgram(host)) return saveInMiniProgram({ blob, filename: safeOutputFilename(item), host, signal, isCurrent, onHandoff, returnTarget: returnTarget || { url: host.location?.href, label: miniConfig.returnLabel }, webPolicy: miniConfig.webPolicy })
  const href = urlApi?.createObjectURL?.(blob)
  const anchor = documentRef?.createElement?.('a')
  if (!href || !anchor) throw new Error('当前浏览器不能创建安全下载。')
  try {
    anchor.href = href
    anchor.download = safeOutputFilename(item)
    anchor.rel = 'noopener'
    if (anchor.style) anchor.style.display = 'none'
    documentRef.body?.appendChild(anchor)
    assertCurrent({ signal, isCurrent })
    anchor.click()
  } finally {
    anchor.remove?.()
    urlApi.revokeObjectURL?.(href)
  }
}
