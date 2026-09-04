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
  let observedOrientation = { screen: null, media: null, legacy: null }
  let lastAcceptedPhysicalEventStamp = 0
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

  const physicalEventStamp = event => {
    const stamp = Number(event?.timeStamp)
    return Number.isFinite(stamp) && stamp > 0 ? stamp : null
  }

  const commitFreshSourceTruth = (source, next, event) => {
    if (typeof next !== 'boolean') return false
    const stamp = physicalEventStamp(event)
    if (stamp !== null) {
      if (stamp <= lastAcceptedPhysicalEventStamp) return false
      observedOrientation[source] = next
      lastAcceptedPhysicalEventStamp = stamp
      return commitPhysicalOrientation(next)
    }
    if (observedOrientation[source] === next) return false
    observedOrientation[source] = next
    return commitPhysicalOrientation(next)
  }

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

  const attachOrCleanResource = async (token, attach, cleanup) => {
    const ownership = requestOwnership
    if (ownership && !ownership.releasing) {
      attach(ownership)
      return ownership.token === token ? 'current' : 'newer'
    }
    await cleanup(ownership)
    return 'released'
  }

  const reconcileFullscreenCompletion = async (token, element) => {
    if (!element || globalThis.document?.fullscreenElement !== element) return 'missing'
    return attachOrCleanResource(
      token,
      ownership => { ownership.fullscreenElement = element },
      ownership => (
        ownership?.releasing && ownership.fullscreenElement === element && ownership.releasePromise
          ? ownership.releasePromise
          : releaseFullscreenElement(element)
      )
    )
  }

  const reconcileOrientationLockCompletion = token => attachOrCleanResource(
    token,
    ownership => { ownership.orientationLocked = true },
    () => {
      try {
        globalThis.screen?.orientation?.unlock?.()
      } catch { /* late lock cleanup */ }
    }
  )

  const releaseRequestOwnership = async token => {
    const ownership = requestOwnership
    if (!ownership || ownership.token !== token) return
    if (ownership.releasePromise) return ownership.releasePromise

    ownership.releasing = true
    ownership.releasePromise = (async () => {
      try {
        if (ownership.orientationLocked) {
          try {
            globalThis.screen?.orientation?.unlock?.()
          } catch { /* best-effort ownership cleanup */ }
        }
        await releaseFullscreenElement(ownership.fullscreenElement)
      } finally {
        if (requestOwnership === ownership) requestOwnership = null
      }
    })()
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

    const fullscreenElement = globalThis.document?.documentElement || null
    const currentFullscreen = globalThis.document?.fullscreenElement
    const requestFullscreen = fullscreenElement?.requestFullscreen
    const lockOrientation = globalThis.screen?.orientation?.lock
    // WeChat H5 commonly exposes no fullscreen request API. Do not make a doomed request
    // (or wait for its timeout): tell the user immediately to rotate physically.
    if (typeof requestFullscreen !== 'function') {
      orientationHint.value = '请旋转手机横屏查看'
      return false
    }

    const token = ++requestGeneration
    requestOwnership = { token, fullscreenElement: null, orientationLocked: false, releasing: false, releasePromise: null }
    orientationRequestPending.value = true
    orientationHint.value = ''
    requestTimer = {
      token,
      id: window.setTimeout(() => {
        if (isCurrentRequest(token)) void cancelRequest(token, { showHint: true })
      }, REQUEST_TIMEOUT_MS)
    }

    let failed = false
    if (currentFullscreen) {
      failed = true
    } else if (typeof requestFullscreen !== 'function') {
      failed = true
    } else {
      try {
        await requestFullscreen.call(fullscreenElement)
        if (await reconcileFullscreenCompletion(token, fullscreenElement) === 'missing') failed = true
      } catch {
        failed = true
      }
    }

    if (!isCurrentRequest(token)) {
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
        await reconcileOrientationLockCompletion(token)
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

  const readScreenSource = () => orientationFromScreen(screenOrientation)
  const readMediaSource = event => (
    typeof event?.matches === 'boolean'
      ? event.matches
      : (typeof orientationMedia?.matches === 'boolean' ? orientationMedia.matches : null)
  )
  const readLegacySource = () => orientationFromLegacyWindow()
  const handleScreenOrientationChange = event => commitFreshSourceTruth('screen', readScreenSource(), event)
  const handleOrientationMediaChange = event => commitFreshSourceTruth('media', readMediaSource(event), event)
  const handleLegacyOrientationChange = event => commitFreshSourceTruth('legacy', readLegacySource(), event)
  const handleCoarseChange = () => { isMobileCoarse.value = Boolean(coarseMedia?.matches) }

  onMounted(() => {
    if (typeof window === 'undefined') return
    isMounted = true
    screenOrientation = globalThis.screen?.orientation || null
    orientationMedia = window.matchMedia?.('(orientation: landscape)') || null
    coarseMedia = window.matchMedia?.('(pointer: coarse)') || null
    observedOrientation = {
      screen: readScreenSource(),
      media: readMediaSource(),
      legacy: readLegacySource()
    }
    lastAcceptedPhysicalEventStamp = 0
    isMobileCoarse.value = Boolean(coarseMedia?.matches)
    commitPhysicalOrientation(readInitialPhysicalOrientation({ allowInitialViewportFallback: true }))
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
