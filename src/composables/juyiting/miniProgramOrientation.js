export const MINI_PROGRAM_ORIENTATION_ROUTES = Object.freeze({
  landscape: '/pages/landscape/index?entry=portrait',
  landscapeFallback: '/pages/landscape/index?entry=replace',
  portraitFallback: '/pages/index/index?entry=fallback'
})

export const WECHAT_MINI_PROGRAM_SDK_URL = 'https://res.wx.qq.com/open/js/jweixin-1.6.0.js'

const BRIDGE_SCRIPT_ID = 'juyiting-wechat-mini-program-sdk'
const BRIDGE_WAIT_MS = 3000
let bridgeLoadPromise = null

export const nativeOrientationFromLocation = (location = globalThis.location) => {
  try {
    const orientation = new URL(location?.href || String(location || ''), 'https://invalid.local')
      .searchParams
      .get('nativeOrientation')
    return orientation === 'landscape' || orientation === 'portrait' ? orientation : null
  } catch {
    return null
  }
}

const miniProgramBridge = (host = globalThis.window) => host?.wx?.miniProgram || null

const waitForBridge = ({ host, timeoutMs }) => new Promise(resolve => {
  const startedAt = Date.now()
  const poll = () => {
    const bridge = miniProgramBridge(host)
    if (bridge) {
      resolve(bridge)
      return
    }
    if (Date.now() - startedAt >= timeoutMs) {
      resolve(null)
      return
    }
    host.setTimeout(poll, 25)
  }
  poll()
})

export const ensureMiniProgramBridge = async ({
  host = globalThis.window,
  document = host?.document || globalThis.document,
  timeoutMs = BRIDGE_WAIT_MS
} = {}) => {
  const existing = miniProgramBridge(host)
  if (existing) return existing
  if (!host || !document?.createElement) return null

  if (!bridgeLoadPromise) {
    bridgeLoadPromise = new Promise(resolve => {
      let script = document.getElementById?.(BRIDGE_SCRIPT_ID)
      const finish = async () => resolve(await waitForBridge({ host, timeoutMs }))
      if (!script) {
        script = document.createElement('script')
        script.id = BRIDGE_SCRIPT_ID
        script.src = WECHAT_MINI_PROGRAM_SDK_URL
        script.async = true
        script.addEventListener?.('load', finish, { once: true })
        script.addEventListener?.('error', () => resolve(null), { once: true })
        ;(document.head || document.documentElement)?.appendChild(script)
      } else {
        script.addEventListener?.('load', finish, { once: true })
        script.addEventListener?.('error', () => resolve(null), { once: true })
        void finish()
      }
      host.setTimeout?.(() => resolve(miniProgramBridge(host)), timeoutMs)
    }).finally(() => {
      if (!miniProgramBridge(host)) bridgeLoadPromise = null
    })
  }
  return bridgeLoadPromise
}

export const enterNativeLandscape = async (options = {}) => {
  const bridge = await ensureMiniProgramBridge(options)
  if (typeof bridge?.navigateTo !== 'function') return false
  try {
    bridge.navigateTo({
      url: MINI_PROGRAM_ORIENTATION_ROUTES.landscape,
      fail: () => bridge.redirectTo?.({ url: MINI_PROGRAM_ORIENTATION_ROUTES.landscapeFallback })
    })
    return true
  } catch {
    return false
  }
}

export const leaveNativeLandscape = async (options = {}) => {
  const bridge = await ensureMiniProgramBridge(options)
  if (typeof bridge?.navigateBack !== 'function') return false
  try {
    bridge.navigateBack({
      delta: 1,
      fail: () => bridge.redirectTo?.({ url: MINI_PROGRAM_ORIENTATION_ROUTES.portraitFallback })
    })
    return true
  } catch {
    return false
  }
}
