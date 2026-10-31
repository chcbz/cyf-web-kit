import { ensureMiniProgramBridge, nativeOrientationFromLocation } from './miniProgramBridge.js'
const MAX_MINI_DOWNLOAD_BYTES = 8 * 1024 * 1024
const MINI_DOWNLOAD_PAGE = '/pages/download/index'

const hasControl = value => [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)

// Browser-side early feedback; native policy validation remains the navigation authority.
export const validateReturnTarget = (value, current, policy) => {
  const fail = () => { throw new Error('返回地址无效或包含不允许传递的参数。') }
  try {
    if (typeof value !== 'string' || (/[\s\\<>"]/.test(value) || hasControl(value))) return fail()
    const url = new URL(value, current)
    if (url.protocol !== 'https:' || url.username || url.password || url.origin !== new URL(current).origin || !policy.origins.includes(url.origin)) return fail()
    const path = decodeURIComponent(url.pathname)
    if ((/[\s\\<>"]/.test(path) || hasControl(path)) || !policy.paths.some(allowed => path === allowed || (allowed !== '/' && path.startsWith(allowed + '/')))) return fail()
    decodeURIComponent(url.search)
    const seen = new Set()
    for (const [key, value] of url.searchParams) {
      if (!policy.queryKeys.includes(key) || seen.has(key) || hasControl(value)) return fail()
      seen.add(key)
    }
    const hash = decodeURIComponent(url.hash.slice(1))
    if (/[\s\\<>"?=&]/.test(hash) || hasControl(hash)) return fail()
    return url.href
  } catch { return fail() }
}

export const inMiniProgram = host => host?.__wxjs_environment === 'miniprogram' || /\bminiProgram\b/i.test(host?.navigator?.userAgent || '')
const makeRequestId = host => {
  const crypto = host?.crypto || globalThis.crypto
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID()
  if (typeof crypto?.getRandomValues !== 'function') throw new Error('无法安全生成文件传输标识。')
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
export const assertCurrent = ({ signal, isCurrent } = {}) => {
  if (signal?.aborted || (isCurrent && !isCurrent())) throw new DOMException('下载已取消或身份已变化。', 'AbortError')
}
// Observe both explicit cancellation and caller-owned identity/view fences while encoding or waiting for SDK callbacks.
const guardedWait = (start, guard, cancel = () => {}) => new Promise((resolve, reject) => {
  let settled = false
  let poll = null
  const finish = (error, value) => {
    if (settled) return
    settled = true
    clearInterval(poll)
    guard.signal?.removeEventListener('abort', check)
    if (error) { cancel(); reject(error) } else resolve(value)
  }
  const check = () => { try { assertCurrent(guard) } catch (error) { finish(error) } }
  try { assertCurrent(guard) } catch (error) { finish(error); return }
  guard.signal?.addEventListener('abort', check, { once: true })
  poll = setInterval(check, 25)
  try { start(value => { try { assertCurrent(guard); finish(null, value) } catch (error) { finish(error) } }, error => finish(error)) } catch (error) { finish(error) }
})
const readBase64 = (blob, host, guard) => {
  let reader
  return guardedWait((resolve, reject) => {
    const Reader = host?.FileReader || globalThis.FileReader
    if (typeof Reader !== 'function') throw new Error('当前环境无法读取文件数据。')
    reader = new Reader()
    reader.onload = () => {
      const value = String(reader.result || '')
      const comma = value.indexOf(',')
      if (comma < 0) reject(new Error('文件编码失败。'))
      else resolve(value.slice(comma + 1))
    }
    reader.onerror = () => reject(reader.error || new Error('文件读取失败。'))
    reader.onabort = () => reject(new DOMException('文件读取已取消。', 'AbortError'))
    reader.readAsDataURL(blob)
  }, guard, () => { if (reader) { reader.onload = null; reader.onerror = null; reader.onabort = null; reader.abort?.() } })
}
export const saveInMiniProgram = async ({ blob, filename, host, signal, isCurrent, onHandoff, returnTarget, webPolicy }) => {
  const guard = { signal, isCurrent }
  const source = validateReturnTarget(returnTarget?.url || host.location.href, host.location.href, webPolicy)
  const orientation = nativeOrientationFromLocation(source) === 'landscape' ? 'landscape' : 'portrait'
  const returnLabel = returnTarget?.label?.trim() || '返回来源页面'
  assertCurrent(guard)
  if (blob.size < 1 || blob.size > MAX_MINI_DOWNLOAD_BYTES) throw new Error('当前小程序文件桥接的单文件下载上限为8 MiB。')
  const bridge = await guardedWait((resolve, reject) => {
    ensureMiniProgramBridge({ host, document: host.document }).then(resolve, reject)
  }, guard)
  assertCurrent(guard)
  if (typeof bridge?.postMessage !== 'function' || typeof bridge?.redirectTo !== 'function') throw new Error('微信小程序文件桥接不可用，文件未提交。')
  const base64 = await readBase64(blob, host, guard)
  assertCurrent(guard)
  if (base64.length > Math.ceil(MAX_MINI_DOWNLOAD_BYTES / 3) * 4) throw new Error('文件编码超过8 MiB传输上限。')
  const requestId = makeRequestId(host)
  const payload = { protocolVersion: 1, requestId, messageType: 'file.download', data: { name: filename, mime: (blob.type || 'application/octet-stream').split(';', 1)[0].trim().toLowerCase(), size: blob.size, base64 } }
  assertCurrent(guard)
  bridge.postMessage({ data: payload })
  // postMessage is the irreversible handoff: aborting H5 cannot revoke native bytes.
  onHandoff?.({ requestId, status: 'submitted' })
  let timer
  try {
    await new Promise((resolve, reject) => {
      timer = host.setTimeout(() => reject(new Error('文件已提交，打开小程序文件页超时；无法撤回，请核对原生页面，勿重复下载。')), 10000)
      bridge.redirectTo({
        url: `${MINI_DOWNLOAD_PAGE}?requestId=${encodeURIComponent(requestId)}&returnUrl=${encodeURIComponent(source)}&returnLabel=${encodeURIComponent(returnLabel)}&orientation=${orientation}`,
        success: resolve,
        fail: () => reject(new Error('文件已提交，但无法确认小程序文件页已打开；无法撤回，请核对后再重试。'))
      })
    })
  } finally { host.clearTimeout(timer) }
  return { requestId, status: 'transferred' }
}
