import { ensureMiniProgramBridge } from '../../utils/miniProgramBridge.js'
export const MINI_PROGRAM_ORIENTATION_ROUTES = Object.freeze({
  landscape: '/pages/landscape/index?entry=portrait',
  landscapeFallback: '/pages/landscape/index?entry=replace',
  portraitFallback: '/pages/index/index?entry=fallback'
})

export { ensureMiniProgramBridge, nativeOrientationFromLocation, WECHAT_MINI_PROGRAM_SDK_URL } from '../../utils/miniProgramBridge.js'

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
