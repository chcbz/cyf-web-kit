import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

export const resolveHallExperienceMode = ({ isMobileCoarse, isPhysicalLandscape }) => (
  !isMobileCoarse || isPhysicalLandscape ? 'landscape-map' : 'portrait-command'
)

const REQUEST_TIMEOUT_MS = 3000

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
  let requestGeneration = 0
  let requestTimeout = null
  let ownsFullscreen = false
  let ownsOrientationLock = false

  const clearRequestTimeout = () => {
    if (requestTimeout !== null && typeof window !== 'undefined') window.clearTimeout(requestTimeout)
    requestTimeout = null
  }

  const updateFacts = ({ orientationEvent, allowViewportFallback = false } = {}) => {
    const physicalLandscape = typeof orientationEvent?.matches === 'boolean'
      ? orientationEvent.matches
      : (typeof orientationMedia?.matches === 'boolean'
          ? orientationMedia.matches
          : (allowViewportFallback && typeof window !== 'undefined' ? window.innerWidth > window.innerHeight : isPhysicalLandscape.value))
    isMobileCoarse.value = Boolean(coarseMedia?.matches)
    isPhysicalLandscape.value = Boolean(physicalLandscape)
  }

  const releaseAcquired = async ({ fullscreen = false, orientation = false } = {}) => {
    if (orientation) {
      try {
        globalThis.screen?.orientation?.unlock?.()
      } catch { /* best-effort ownership cleanup */ }
    }
    if (fullscreen) {
      try {
        await globalThis.document?.exitFullscreen?.()
      } catch { /* best-effort ownership cleanup */ }
    }
  }

  const releaseOwnedOrientation = async () => {
    const acquired = { fullscreen: ownsFullscreen, orientation: ownsOrientationLock }
    ownsFullscreen = false
    ownsOrientationLock = false
    await releaseAcquired(acquired)
  }

  const isCurrentRequest = token => (
    isMounted && token === requestGeneration && orientationRequestPending.value
  )

  const requestLandscape = async () => {
    if (!isMounted || orientationRequestPending.value || !isMobileCoarse.value || isPhysicalLandscape.value) return false

    const token = ++requestGeneration
    orientationRequestPending.value = true
    orientationHint.value = ''
    requestTimeout = window.setTimeout(() => {
      if (!isCurrentRequest(token)) return
      orientationRequestPending.value = false
      orientationHint.value = '请旋转手机横屏查看'
    }, REQUEST_TIMEOUT_MS)

    let acquiredFullscreen = false
    let acquiredOrientation = false
    let failed = false
    const requestFullscreen = globalThis.document?.documentElement?.requestFullscreen
    const lockOrientation = globalThis.screen?.orientation?.lock

    if (typeof requestFullscreen !== 'function') {
      failed = true
    } else {
      try {
        await requestFullscreen.call(globalThis.document.documentElement)
        acquiredFullscreen = true
        ownsFullscreen = true
      } catch {
        failed = true
      }
    }

    if (!isCurrentRequest(token)) {
      if (acquiredFullscreen) ownsFullscreen = false
      await releaseAcquired({ fullscreen: acquiredFullscreen })
      return false
    }

    if (typeof lockOrientation !== 'function') {
      failed = true
    } else {
      try {
        await lockOrientation.call(globalThis.screen.orientation, 'landscape')
        acquiredOrientation = true
        ownsOrientationLock = true
      } catch {
        failed = true
      }
    }

    if (!isCurrentRequest(token)) {
      if (acquiredFullscreen) ownsFullscreen = false
      if (acquiredOrientation) ownsOrientationLock = false
      await releaseAcquired({ fullscreen: acquiredFullscreen, orientation: acquiredOrientation })
      return false
    }

    clearRequestTimeout()
    orientationRequestPending.value = false
    if (!failed) return true

    if (acquiredFullscreen) ownsFullscreen = false
    if (acquiredOrientation) ownsOrientationLock = false
    await releaseAcquired({ fullscreen: acquiredFullscreen, orientation: acquiredOrientation })
    orientationHint.value = '请旋转手机横屏查看'
    return false
  }

  const handleOrientationChange = event => updateFacts({ orientationEvent: event })
  const handleCoarseChange = () => updateFacts()
  const handleResize = () => {
    if (!orientationMedia) updateFacts({ allowViewportFallback: true })
  }

  onMounted(() => {
    if (typeof window === 'undefined') return
    isMounted = true
    orientationMedia = window.matchMedia?.('(orientation: landscape)') || null
    coarseMedia = window.matchMedia?.('(pointer: coarse)') || null
    updateFacts({ allowViewportFallback: true })
    orientationMedia?.addEventListener?.('change', handleOrientationChange)
    coarseMedia?.addEventListener?.('change', handleCoarseChange)
    window.addEventListener?.('resize', handleResize)
  })

  onBeforeUnmount(() => {
    isMounted = false
    requestGeneration += 1
    orientationRequestPending.value = false
    clearRequestTimeout()
    orientationMedia?.removeEventListener?.('change', handleOrientationChange)
    coarseMedia?.removeEventListener?.('change', handleCoarseChange)
    window.removeEventListener?.('resize', handleResize)
    orientationMedia = null
    coarseMedia = null
    void releaseOwnedOrientation()
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
