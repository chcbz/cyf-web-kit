import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

export const resolveHallExperienceMode = ({ isMobileCoarse, isPhysicalLandscape }) => (
  !isMobileCoarse || isPhysicalLandscape ? 'landscape-map' : 'portrait-command'
)

const REQUEST_TIMEOUT_MS = 3000

const orientationFromAngle = angle => {
  if (!Number.isFinite(angle)) return null
  return Math.abs(Math.trunc(angle) % 180) === 90
}

const orientationFromScreen = orientation => {
  const type = orientation?.type
  if (typeof type === 'string') {
    if (type.startsWith('landscape')) return true
    if (type.startsWith('portrait')) return false
  }
  return orientationFromAngle(orientation?.angle)
}

const orientationFromLegacyWindow = () => orientationFromAngle(globalThis.window?.orientation)

export const useHallExperienceMode = () => {
  const isMobileCoarse = ref(false)
  const isPhysicalLandscape = ref(false)
  const orientationHint = ref('')
  const orientationRequestPending = ref(false)
  const experienceMode = computed(() => resolveHallExperienceMode({
    isMobileCoarse: isMobileCoarse.value,
    isPhysicalLandscape: isPhysicalLandscape.value
  }))

  let isMounted = false
  let orientationMedia = null
  let coarseMedia = null
  let screenOrientation = null
  let requestGeneration = 0
  let requestTimer = null
  let requestOwnership = null

  const commitPhysicalOrientation = next => {
    if (typeof next !== 'boolean' || next === isPhysicalLandscape.value) return false
    isPhysicalLandscape.value = next
    // A confirmed landscape fact replaces the advisory request, so release Hall-owned controls.
    if (next && requestOwnership) void cancelRequest(requestOwnership.token)
    return true
  }

  // Initialization only: Screen Orientation API, orientation media, legacy angle, then viewport fallback.
  const readInitialPhysicalOrientation = ({ allowInitialViewportFallback = false } = {}) => {
    const screenTruth = orientationFromScreen(screenOrientation)
    if (screenTruth !== null) return screenTruth
    if (typeof orientationMedia?.matches === 'boolean') return orientationMedia.matches
    const legacyTruth = orientationFromLegacyWindow()
    if (legacyTruth !== null) return legacyTruth
    if (allowInitialViewportFallback && typeof window !== 'undefined') return window.innerWidth > window.innerHeight
    return null
  }

  const readPhysicalOrientation = ({ source, event, allowInitialViewportFallback = false } = {}) => {
    if (source === 'screen') {
      const screenTruth = orientationFromScreen(screenOrientation)
      if (screenTruth !== null) return screenTruth
    }
    if (source === 'media' && typeof event?.matches === 'boolean') return event.matches
    if (source === 'legacy') {
      const legacyTruth = orientationFromLegacyWindow()
      if (legacyTruth !== null) return legacyTruth
    }

    return readInitialPhysicalOrientation({ allowInitialViewportFallback })
  }

  const commitPhysicalTruth = options => commitPhysicalOrientation(readPhysicalOrientation(options))

  const clearRequestTimer = token => {
    if (!requestTimer || (token !== undefined && requestTimer.token !== token)) return
    window.clearTimeout(requestTimer.id)
    requestTimer = null
  }

  const releaseFullscreenElement = async element => {
    if (!element || globalThis.document?.fullscreenElement !== element) return
    try {
      await globalThis.document.exitFullscreen?.()
    } catch { /* best-effort ownership cleanup */ }
  }

  const releaseRequestOwnership = async token => {
    const ownership = requestOwnership
    if (!ownership || ownership.token !== token) return
    if (ownership.releasePromise) return ownership.releasePromise

    ownership.releasePromise = (async () => {
      if (ownership.orientationLocked) {
        try {
          globalThis.screen?.orientation?.unlock?.()
        } catch { /* best-effort ownership cleanup */ }
      }
      await releaseFullscreenElement(ownership.fullscreenElement)
    })()
    requestOwnership = null
    return ownership.releasePromise
  }

  const cancelRequest = async (token, { showHint = false } = {}) => {
    clearRequestTimer(token)
    if (token === requestGeneration) {
      orientationRequestPending.value = false
      if (showHint && isMounted) orientationHint.value = '请旋转手机横屏查看'
    }
    await releaseRequestOwnership(token)
  }

  const isCurrentRequest = token => (
    isMounted && token === requestGeneration && orientationRequestPending.value
  )

  const requestLandscape = async () => {
    if (!isMounted || requestOwnership || orientationRequestPending.value || !isMobileCoarse.value || isPhysicalLandscape.value) return false

    const token = ++requestGeneration
    const fullscreenElement = globalThis.document?.documentElement || null
    requestOwnership = { token, fullscreenElement: null, orientationLocked: false, releasePromise: null }
    orientationRequestPending.value = true
    orientationHint.value = ''
    requestTimer = {
      token,
      id: window.setTimeout(() => {
        if (isCurrentRequest(token)) void cancelRequest(token, { showHint: true })
      }, REQUEST_TIMEOUT_MS)
    }

    let failed = false
    const currentFullscreen = globalThis.document?.fullscreenElement
    const requestFullscreen = fullscreenElement?.requestFullscreen
    const lockOrientation = globalThis.screen?.orientation?.lock

    if (currentFullscreen) {
      failed = true
    } else if (typeof requestFullscreen !== 'function') {
      failed = true
    } else {
      try {
        await requestFullscreen.call(fullscreenElement)
        if (globalThis.document?.fullscreenElement === fullscreenElement) {
          if (requestOwnership?.token === token) requestOwnership.fullscreenElement = fullscreenElement
        } else {
          failed = true
        }
      } catch {
        failed = true
      }
    }

    if (!isCurrentRequest(token)) {
      await releaseFullscreenElement(globalThis.document?.fullscreenElement === fullscreenElement ? fullscreenElement : null)
      await releaseRequestOwnership(token)
      return false
    }

    if (failed) {
      await cancelRequest(token, { showHint: true })
      return false
    }

    if (typeof lockOrientation !== 'function') {
      failed = true
    } else {
      try {
        await lockOrientation.call(globalThis.screen.orientation, 'landscape')
        if (requestOwnership?.token === token) requestOwnership.orientationLocked = true
        else {
          try {
            globalThis.screen?.orientation?.unlock?.()
          } catch { /* late lock cleanup */ }
        }
      } catch {
        failed = true
      }
    }

    if (!isCurrentRequest(token) || failed) {
      await cancelRequest(token, { showHint: isCurrentRequest(token) && failed })
      return false
    }

    clearRequestTimer(token)
    orientationRequestPending.value = false
    return true
  }

  const handleOrientationMediaChange = event => commitPhysicalTruth({ source: 'media', event })
  const handleScreenOrientationChange = () => commitPhysicalTruth({ source: 'screen' })
  const handleLegacyOrientationChange = () => commitPhysicalTruth({ source: 'legacy' })
  const handleCoarseChange = () => { isMobileCoarse.value = Boolean(coarseMedia?.matches) }

  onMounted(() => {
    if (typeof window === 'undefined') return
    isMounted = true
    screenOrientation = globalThis.screen?.orientation || null
    orientationMedia = window.matchMedia?.('(orientation: landscape)') || null
    coarseMedia = window.matchMedia?.('(pointer: coarse)') || null
    isMobileCoarse.value = Boolean(coarseMedia?.matches)
    commitPhysicalTruth({ allowInitialViewportFallback: true })
    screenOrientation?.addEventListener?.('change', handleScreenOrientationChange)
    orientationMedia?.addEventListener?.('change', handleOrientationMediaChange)
    coarseMedia?.addEventListener?.('change', handleCoarseChange)
    window.addEventListener?.('orientationchange', handleLegacyOrientationChange)
  })

  onBeforeUnmount(() => {
    isMounted = false
    const activeGeneration = requestGeneration
    void cancelRequest(activeGeneration)
    requestGeneration += 1
    screenOrientation?.removeEventListener?.('change', handleScreenOrientationChange)
    orientationMedia?.removeEventListener?.('change', handleOrientationMediaChange)
    coarseMedia?.removeEventListener?.('change', handleCoarseChange)
    window.removeEventListener?.('orientationchange', handleLegacyOrientationChange)
    screenOrientation = null
    orientationMedia = null
    coarseMedia = null
  })

  return {
    experienceMode,
    isMobileCoarse,
    isPhysicalLandscape,
    orientationHint,
    orientationRequestPending,
    requestLandscape
  }
}
