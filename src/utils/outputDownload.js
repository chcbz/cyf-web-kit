import { ensureMiniProgramBridge, nativeOrientationFromLocation } from '../composables/juyiting/miniProgramOrientation.js'

const unsafeFilename = /[\\/:*?"<>|]/g
const MAX_MINI_DOWNLOAD_BYTES = 8 * 1024 * 1024
const MINI_DOWNLOAD_PAGE = '/pages/download/index'

export const safeOutputFilename = (item = {}) => {
  const raw = String(item.title || item.name || 'output')
  const cleaned = [...raw].map(char => char.charCodeAt(0) < 32 ? '_' : char).join('')
    .replace(unsafeFilename, '_').replace(/^\.+/, '').trim()
  return (cleaned || 'output').slice(0, 180)
}

const inMiniProgram = host => host?.__wxjs_environment === 'miniprogram' || /\bminiProgram\b/i.test(host?.navigator?.userAgent || '')
const makeTransferId = host => {
  const crypto = host?.crypto || globalThis.crypto
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID()
  if (typeof crypto?.getRandomValues !== 'function') throw new Error('无法安全生成文件传输标识。')
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
const readBase64 = (blob, host) => new Promise((resolve, reject) => {
  const Reader = host?.FileReader || globalThis.FileReader
  if (typeof Reader !== 'function') return reject(new Error('当前环境无法读取文件数据。'))
  const reader = new Reader()
  reader.onload = () => {
    const value = String(reader.result || '')
    const comma = value.indexOf(',')
    if (comma < 0) reject(new Error('文件编码失败。'))
    else resolve(value.slice(comma + 1))
  }
  reader.onerror = () => reject(reader.error || new Error('文件读取失败。'))
  reader.readAsDataURL(blob)
})
const saveInMiniProgram = async ({ blob, item, host }) => {
  if (blob.size < 1 || blob.size > MAX_MINI_DOWNLOAD_BYTES) throw new Error('微信小程序单文件下载上限为8 MiB。')
  const bridge = await ensureMiniProgramBridge({ host, document: host.document })
  if (typeof bridge?.postMessage !== 'function' || typeof bridge?.redirectTo !== 'function') throw new Error('微信小程序文件桥接不可用，文件未提交。')
  const base64 = await readBase64(blob, host)
  if (base64.length > Math.ceil(MAX_MINI_DOWNLOAD_BYTES / 3) * 4) throw new Error('文件编码超过8 MiB传输上限。')
  const transferId = makeTransferId(host)
  const orientation = nativeOrientationFromLocation(host.location) === 'landscape' ? 'landscape' : 'portrait'
  const payload = { protocol: 'juyiting-file-download-v1', transferId, name: safeOutputFilename(item), mime: blob.type || 'application/octet-stream', size: blob.size, base64 }
  bridge.postMessage({ data: payload })
  await new Promise((resolve, reject) => {
    const timer = host.setTimeout(() => reject(new Error('打开小程序文件页超时，文件未确认写入。')), 10000)
    const settle = callback => value => { host.clearTimeout(timer); callback(value) }
    bridge.redirectTo({
      url: `${MINI_DOWNLOAD_PAGE}?transferId=${encodeURIComponent(transferId)}&entry=${orientation}`,
      success: settle(resolve),
      fail: settle(() => reject(new Error('无法打开小程序文件页，文件未确认写入。')))
    })
  })
  return { transferId, status: 'transferred' }
}

/** Desktop uses a browser download; WeChat mini program uses the bounded native bridge. */
export function saveOutputBlob ({ blob, item, documentRef = globalThis.document, urlApi = globalThis.URL, host = globalThis.window } = {}) {
  if (!(blob instanceof Blob)) throw new TypeError('A Blob is required for output download')
  if (inMiniProgram(host)) return saveInMiniProgram({ blob, item, host })
  const href = urlApi?.createObjectURL?.(blob)
  const anchor = documentRef?.createElement?.('a')
  if (!href || !anchor) throw new Error('当前浏览器不能创建安全下载。')
  try {
    anchor.href = href
    anchor.download = safeOutputFilename(item)
    anchor.rel = 'noopener'
    if (anchor.style) anchor.style.display = 'none'
    documentRef.body?.appendChild(anchor)
    anchor.click()
  } finally {
    anchor.remove?.()
    urlApi.revokeObjectURL?.(href)
  }
}
