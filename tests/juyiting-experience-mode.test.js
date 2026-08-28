import { expect } from 'chai'
import { before } from 'mocha'
import { readFileSync } from 'fs'

let mount
let Vue

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Vue.nextTick()
}

const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const createMedia = (matches = false) => {
  const listeners = new Set()
  return {
    matches,
    addEventListener: (_event, listener) => listeners.add(listener),
    removeEventListener: (_event, listener) => listeners.delete(listener),
    emit(next, event = { matches: next }) {
      this.matches = next
      listeners.forEach(listener => listener(event))
    },
    listenerCount: () => listeners.size
  }
}

const createScreenOrientation = (options = {}) => {
  const listeners = new Set()
  const type = Object.hasOwn(options, 'type') ? options.type : 'portrait-primary'
  const angle = Object.hasOwn(options, 'angle') ? options.angle : 0
  return {
    type,
    angle,
    addEventListener: (_event, listener) => listeners.add(listener),
    removeEventListener: (_event, listener) => listeners.delete(listener),
    emit({ nextType = this.type, nextAngle = this.angle, event = {} } = {}) {
      this.type = nextType
      this.angle = nextAngle
      listeners.forEach(listener => listener(event))
    },
    listenerCount: () => listeners.size
  }
}

const setFullscreenElement = element => Object.defineProperty(global.document, 'fullscreenElement', {
  configurable: true,
  value: element
})

const dispatchLegacyOrientationChange = timeStamp => {
  const event = new global.window.Event('orientationchange')
  if (timeStamp !== undefined) Object.defineProperty(event, 'timeStamp', { configurable: true, value: timeStamp })
  global.window.dispatchEvent(event)
}

const restoreProperty = (target, key, descriptor) => {
  if (descriptor) Object.defineProperty(target, key, descriptor)
  else delete target[key]
}

const setupEnvironment = ({ coarse = true, mediaLandscape = false, screen = {}, legacyAngle } = {}) => {
  const original = {
    matchMedia: global.window.matchMedia,
    screen: global.screen,
    windowOrientation: Object.getOwnPropertyDescriptor(global.window, 'orientation'),
    requestFullscreen: global.document.documentElement.requestFullscreen,
    exitFullscreen: global.document.exitFullscreen,
    fullscreenElement: Object.getOwnPropertyDescriptor(global.document, 'fullscreenElement')
  }
  const orientationMedia = mediaLandscape === null ? null : createMedia(mediaLandscape)
  const pointerMedia = createMedia(coarse)
  const screenOrientation = screen === false ? null : createScreenOrientation(screen)
  global.window.matchMedia = query => query.includes('orientation') ? orientationMedia : pointerMedia
  global.screen = screenOrientation ? { orientation: screenOrientation } : undefined
  if (legacyAngle !== undefined) {
    Object.defineProperty(global.window, 'orientation', { configurable: true, writable: true, value: legacyAngle })
  } else {
    delete global.window.orientation
  }
  setFullscreenElement(null)

  return {
    orientationMedia,
    pointerMedia,
    screenOrientation,
    restore() {
      global.window.matchMedia = original.matchMedia
      global.screen = original.screen
      restoreProperty(global.window, 'orientation', original.windowOrientation)
      global.document.documentElement.requestFullscreen = original.requestFullscreen
      global.document.exitFullscreen = original.exitFullscreen
      restoreProperty(global.document, 'fullscreenElement', original.fullscreenElement)
    }
  }
}

const mountMode = async () => {
  const { useHallExperienceMode } = await import('../src/composables/juyiting/useHallExperienceMode.js')
  let mode
  const Harness = {
    setup() {
      mode = useHallExperienceMode()
      return () => Vue.h('div', mode.experienceMode.value)
    }
  }
  const wrapper = mount(Harness)
  await flush()
  return { mode, wrapper }
}

describe('Juyi Hall experience mode', () => {
  before(async () => {
    ;({ mount } = await import('@vue/test-utils'))
    Vue = await import('vue')
  })

  it('keeps desktop in landscape-map and cleans up the owned physical listeners', async () => {
    const env = setupEnvironment({ coarse: false, mediaLandscape: false, screen: { type: 'portrait-primary', angle: 0 } })
    try {
      const { mode, wrapper } = await mountMode()
      expect(mode.experienceMode.value).to.equal('landscape-map')
      expect(env.screenOrientation.listenerCount()).to.equal(1)
      expect(env.orientationMedia.listenerCount()).to.equal(1)
      expect(env.pointerMedia.listenerCount()).to.equal(1)
      wrapper.unmount()
      expect(env.screenOrientation.listenerCount()).to.equal(0)
      expect(env.orientationMedia.listenerCount()).to.equal(0)
      expect(env.pointerMedia.listenerCount()).to.equal(0)
    } finally {
      env.restore()
    }
  })

  it('uses per-source freshness so delayed stale callbacks cannot reverse newer media or legacy truth', async () => {
    const missingMedia = setupEnvironment({ mediaLandscape: null, screen: { type: 'portrait-primary', angle: 0 } })
    try {
      const { mode, wrapper } = await mountMode()
      missingMedia.screenOrientation.emit({ nextType: 'landscape-primary', nextAngle: 90 })
      await flush()
      expect(mode.experienceMode.value).to.equal('landscape-map')
      wrapper.unmount()
    } finally {
      missingMedia.restore()
    }

    const staleScreenPortraitMedia = setupEnvironment({ mediaLandscape: false, screen: { type: 'portrait-primary', angle: 0 }, legacyAngle: 0 })
    try {
      const { mode, wrapper } = await mountMode()
      staleScreenPortraitMedia.orientationMedia.emit(true)
      staleScreenPortraitMedia.screenOrientation.emit({ nextType: 'portrait-primary', nextAngle: 0 })
      await flush()
      expect(mode.experienceMode.value).to.equal('landscape-map')
      wrapper.unmount()
    } finally {
      staleScreenPortraitMedia.restore()
    }

    const staleScreenLandscapeMedia = setupEnvironment({ mediaLandscape: true, screen: { type: 'landscape-primary', angle: 90 }, legacyAngle: 90 })
    try {
      const { mode, wrapper } = await mountMode()
      staleScreenLandscapeMedia.orientationMedia.emit(false)
      staleScreenLandscapeMedia.screenOrientation.emit({ nextType: 'landscape-primary', nextAngle: 90 })
      await flush()
      expect(mode.experienceMode.value).to.equal('portrait-command')
      wrapper.unmount()
    } finally {
      staleScreenLandscapeMedia.restore()
    }

    const staleScreenPortraitLegacy = setupEnvironment({ mediaLandscape: false, screen: { type: 'portrait-primary', angle: 0 }, legacyAngle: 0 })
    try {
      const { mode, wrapper } = await mountMode()
      global.window.orientation = 90
      global.window.dispatchEvent(new global.window.Event('orientationchange'))
      staleScreenPortraitLegacy.screenOrientation.emit({ nextType: 'portrait-primary', nextAngle: 0 })
      await flush()
      expect(mode.experienceMode.value).to.equal('landscape-map')
      wrapper.unmount()
    } finally {
      staleScreenPortraitLegacy.restore()
    }

    const staleScreenLandscapeLegacy = setupEnvironment({ mediaLandscape: true, screen: { type: 'landscape-primary', angle: 90 }, legacyAngle: 90 })
    try {
      const { mode, wrapper } = await mountMode()
      global.window.orientation = 0
      global.window.dispatchEvent(new global.window.Event('orientationchange'))
      staleScreenLandscapeLegacy.screenOrientation.emit({ nextType: 'landscape-primary', nextAngle: 90 })
      await flush()
      expect(mode.experienceMode.value).to.equal('portrait-command')
      wrapper.unmount()
    } finally {
      staleScreenLandscapeLegacy.restore()
    }
  })

  it('commits changed current media without event.matches and ignores invalid source callbacks', async () => {
    const env = setupEnvironment({ mediaLandscape: false, screen: { type: 'portrait-primary', angle: 0 }, legacyAngle: 0 })
    try {
      const { mode, wrapper } = await mountMode()
      env.orientationMedia.emit(true, {})
      await flush()
      expect(mode.experienceMode.value).to.equal('landscape-map')
      env.screenOrientation.emit({ nextType: 'unknown', nextAngle: Number.NaN })
      global.window.orientation = undefined
      global.window.dispatchEvent(new global.window.Event('orientationchange'))
      await flush()
      expect(mode.experienceMode.value).to.equal('landscape-map')
      wrapper.unmount()
    } finally {
      env.restore()
    }
  })

  it('uses event timestamps to accept real returns while rejecting stale cross-source callbacks', async () => {
    const mediaFirst = setupEnvironment({ mediaLandscape: false, screen: { type: 'portrait-primary', angle: 0 }, legacyAngle: 0 })
    try {
      const { mode, wrapper } = await mountMode()
      mediaFirst.orientationMedia.emit(true, { matches: true, timeStamp: 200 })
      mediaFirst.screenOrientation.emit({ nextType: 'portrait-primary', nextAngle: 0, event: { timeStamp: 100 } })
      await flush()
      expect(mode.experienceMode.value).to.equal('landscape-map')
      mediaFirst.screenOrientation.emit({ nextType: 'portrait-primary', nextAngle: 0, event: { timeStamp: 300 } })
      await flush()
      expect(mode.experienceMode.value).to.equal('portrait-command')
      mediaFirst.screenOrientation.emit({ nextType: 'landscape-primary', nextAngle: 90, event: { timeStamp: 300 } })
      await flush()
      expect(mode.experienceMode.value).to.equal('portrait-command')
      mediaFirst.orientationMedia.emit(true, { matches: true, timeStamp: 400 })
      mediaFirst.orientationMedia.emit(false, {})
      mediaFirst.orientationMedia.emit(false, {})
      await flush()
      expect(mode.experienceMode.value).to.equal('portrait-command')
      wrapper.unmount()
      mediaFirst.orientationMedia.emit(true, { matches: true, timeStamp: 500 })
      await flush()
      expect(mode.experienceMode.value).to.equal('portrait-command')
    } finally {
      mediaFirst.restore()
    }

    const legacyReturn = setupEnvironment({ mediaLandscape: true, screen: { type: 'landscape-primary', angle: 90 }, legacyAngle: 90 })
    try {
      const { mode, wrapper } = await mountMode()
      legacyReturn.orientationMedia.emit(false, { matches: false, timeStamp: 200 })
      global.window.orientation = 90
      dispatchLegacyOrientationChange(100)
      await flush()
      expect(mode.experienceMode.value).to.equal('portrait-command')
      dispatchLegacyOrientationChange(300)
      await flush()
      expect(mode.experienceMode.value).to.equal('landscape-map')
      wrapper.unmount()
    } finally {
      legacyReturn.restore()
    }
  })

  it('uses viewport dimensions only for no-API initialization, never for later keyboard resize', async () => {
    const originalWidth = global.window.innerWidth
    const originalHeight = global.window.innerHeight
    const originalVisualViewport = global.window.visualViewport
    let visualListener = null
    Object.defineProperty(global.window, 'innerWidth', { configurable: true, writable: true, value: 390 })
    Object.defineProperty(global.window, 'innerHeight', { configurable: true, writable: true, value: 844 })
    Object.defineProperty(global.window, 'visualViewport', { configurable: true, value: {
      addEventListener: (_event, listener) => { visualListener = listener },
      removeEventListener: () => {},
      height: 844
    } })
    const env = setupEnvironment({ mediaLandscape: null, screen: false })
    try {
      const { mode, wrapper } = await mountMode()
      expect(mode.experienceMode.value).to.equal('portrait-command')
      global.window.innerWidth = 844
      global.window.innerHeight = 390
      global.window.dispatchEvent(new global.window.Event('resize'))
      visualListener?.(new global.window.Event('resize'))
      await flush()
      expect(visualListener).to.equal(null)
      expect(mode.experienceMode.value).to.equal('portrait-command')
      wrapper.unmount()
    } finally {
      Object.defineProperty(global.window, 'innerWidth', { configurable: true, value: originalWidth })
      Object.defineProperty(global.window, 'innerHeight', { configurable: true, value: originalHeight })
      Object.defineProperty(global.window, 'visualViewport', { configurable: true, value: originalVisualViewport })
      env.restore()
    }
  })

  it('commits legacy physical orientation events once, uses latest truth, and removes them on unmount', async () => {
    const env = setupEnvironment({ mediaLandscape: null, screen: false, legacyAngle: 0 })
    try {
      const { mode, wrapper } = await mountMode()
      let commits = 0
      const stop = Vue.watch(() => mode.isPhysicalLandscape.value, () => { commits += 1 })
      global.window.orientation = 90
      global.window.dispatchEvent(new global.window.Event('orientationchange'))
      global.window.dispatchEvent(new global.window.Event('orientationchange'))
      await flush()
      expect(mode.experienceMode.value).to.equal('landscape-map')
      expect(commits).to.equal(1)
      global.window.orientation = 0
      global.window.dispatchEvent(new global.window.Event('orientationchange'))
      await flush()
      expect(mode.experienceMode.value).to.equal('portrait-command')
      expect(commits).to.equal(2)
      wrapper.unmount()
      global.window.orientation = 90
      global.window.dispatchEvent(new global.window.Event('orientationchange'))
      await flush()
      expect(mode.experienceMode.value).to.equal('portrait-command')
      stop()
    } finally {
      env.restore()
    }
  })

  it('keeps successful ownership live, dedupes repeat requests, and cleans it exactly once on unmount', async () => {
    const env = setupEnvironment()
    let requestCalls = 0
    let lockCalls = 0
    let exitCalls = 0
    let unlockCalls = 0
    let timerCalls = 0
    const originalSetTimeout = global.window.setTimeout
    const originalClearTimeout = global.window.clearTimeout
    global.document.documentElement.requestFullscreen = async () => {
      requestCalls += 1
      setFullscreenElement(global.document.documentElement)
    }
    global.document.exitFullscreen = async () => { exitCalls += 1; setFullscreenElement(null) }
    global.screen.orientation.lock = async () => { lockCalls += 1 }
    global.screen.orientation.unlock = () => { unlockCalls += 1 }
    try {
      const { mode, wrapper } = await mountMode()
      global.window.setTimeout = () => ++timerCalls
      global.window.clearTimeout = () => {}
      expect(await mode.requestLandscape()).to.equal(true)
      const hintAfterFirst = mode.orientationHint.value
      expect(mode.experienceMode.value).to.equal('portrait-command')
      expect(await mode.requestLandscape()).to.equal(false)
      expect(requestCalls).to.equal(1)
      expect(lockCalls).to.equal(1)
      expect(timerCalls).to.equal(1)
      expect(mode.orientationHint.value).to.equal(hintAfterFirst)
      expect(exitCalls).to.equal(0)
      expect(unlockCalls).to.equal(0)
      wrapper.unmount()
      await flush()
      expect(unlockCalls).to.equal(1)
      expect(exitCalls).to.equal(1)
    } finally {
      global.window.setTimeout = originalSetTimeout
      global.window.clearTimeout = originalClearTimeout
      env.restore()
    }
  })

  it('keeps release-in-flight fenced through a landscape-to-portrait race until exit settles', async () => {
    const env = setupEnvironment()
    const exit = deferred()
    let requestCalls = 0
    let lockCalls = 0
    let exitCalls = 0
    let unlockCalls = 0
    let timerCalls = 0
    const originalSetTimeout = global.window.setTimeout
    const originalClearTimeout = global.window.clearTimeout
    global.document.documentElement.requestFullscreen = async () => {
      requestCalls += 1
      setFullscreenElement(global.document.documentElement)
    }
    global.document.exitFullscreen = () => { exitCalls += 1; return exit.promise }
    global.screen.orientation.lock = async () => { lockCalls += 1 }
    global.screen.orientation.unlock = () => { unlockCalls += 1 }
    try {
      const { mode, wrapper } = await mountMode()
      global.window.setTimeout = () => ++timerCalls
      global.window.clearTimeout = () => {}
      expect(await mode.requestLandscape()).to.equal(true)
      const hintAfterSuccess = mode.orientationHint.value
      env.screenOrientation.emit({ nextType: 'landscape-primary', nextAngle: 90 })
      await flush()
      expect(mode.experienceMode.value).to.equal('landscape-map')
      expect(unlockCalls).to.equal(1)
      expect(exitCalls).to.equal(1)
      env.screenOrientation.emit({ nextType: 'portrait-primary', nextAngle: 0 })
      await flush()
      expect(mode.experienceMode.value).to.equal('portrait-command')
      expect(await mode.requestLandscape()).to.equal(false)
      expect(requestCalls).to.equal(1)
      expect(lockCalls).to.equal(1)
      expect(timerCalls).to.equal(1)
      expect(mode.orientationHint.value).to.equal(hintAfterSuccess)
      exit.resolve()
      await flush()
      setFullscreenElement(null)
      expect(await mode.requestLandscape()).to.equal(true)
      expect(requestCalls).to.equal(2)
      expect(lockCalls).to.equal(2)
      wrapper.unmount()
      await flush()
    } finally {
      global.window.setTimeout = originalSetTimeout
      global.window.clearTimeout = originalClearTimeout
      env.restore()
    }
  })

  it('clears a release fence without exiting a host element that replaced Hall fullscreen', async () => {
    const env = setupEnvironment()
    const hostElement = global.document.createElement('div')
    let requestCalls = 0
    let exitCalls = 0
    global.document.documentElement.requestFullscreen = async () => {
      requestCalls += 1
      setFullscreenElement(global.document.documentElement)
    }
    global.document.exitFullscreen = async () => { exitCalls += 1 }
    global.screen.orientation.lock = async () => {}
    global.screen.orientation.unlock = () => {}
    try {
      const { mode, wrapper } = await mountMode()
      expect(await mode.requestLandscape()).to.equal(true)
      setFullscreenElement(hostElement)
      env.screenOrientation.emit({ nextType: 'landscape-primary', nextAngle: 90 })
      await flush()
      expect(exitCalls).to.equal(0)
      expect(global.document.fullscreenElement).to.equal(hostElement)
      env.screenOrientation.emit({ nextType: 'portrait-primary', nextAngle: 0 })
      setFullscreenElement(null)
      await flush()
      expect(await mode.requestLandscape()).to.equal(true)
      expect(requestCalls).to.equal(2)
      wrapper.unmount()
    } finally {
      env.restore()
    }
  })

  it('keeps portrait and releases Hall-owned fullscreen when orientation lock rejects', async () => {
    const env = setupEnvironment()
    let exitCalls = 0
    global.document.documentElement.requestFullscreen = async () => setFullscreenElement(global.document.documentElement)
    global.document.exitFullscreen = async () => { exitCalls += 1; setFullscreenElement(null) }
    global.screen.orientation.lock = async () => { throw new Error('rejected') }
    try {
      const { mode, wrapper } = await mountMode()
      expect(await mode.requestLandscape()).to.equal(false)
      expect(mode.experienceMode.value).to.equal('portrait-command')
      expect(mode.orientationHint.value).to.equal('请旋转手机横屏查看')
      expect(exitCalls).to.equal(1)
      wrapper.unmount()
    } finally {
      env.restore()
    }
  })

  it('times out a pending lock, releases only its acquired fullscreen once, and ignores late resolution', async () => {
    const env = setupEnvironment()
    const originalSetTimeout = global.window.setTimeout
    const originalClearTimeout = global.window.clearTimeout
    const timers = []
    let resolveLock
    let exitCalls = 0
    let unlockCalls = 0
    global.window.setTimeout = (callback, delay) => {
      timers.push({ callback, delay, cleared: false })
      return timers.length
    }
    global.window.clearTimeout = id => { if (timers[id - 1]) timers[id - 1].cleared = true }
    global.document.documentElement.requestFullscreen = async () => setFullscreenElement(global.document.documentElement)
    global.document.exitFullscreen = async () => { exitCalls += 1; setFullscreenElement(null) }
    global.screen.orientation.lock = () => new Promise(resolve => { resolveLock = resolve })
    global.screen.orientation.unlock = () => { unlockCalls += 1 }
    try {
      const { mode, wrapper } = await mountMode()
      const pending = mode.requestLandscape()
      expect(await mode.requestLandscape()).to.equal(false)
      await flush()
      expect(timers).to.have.length(1)
      expect(timers[0].delay).to.equal(3000)
      timers[0].callback()
      await flush()
      expect(mode.orientationRequestPending.value).to.equal(false)
      expect(mode.orientationHint.value).to.equal('请旋转手机横屏查看')
      expect(mode.experienceMode.value).to.equal('portrait-command')
      expect(exitCalls).to.equal(1)
      expect(global.document.fullscreenElement).to.equal(null)
      resolveLock()
      await pending
      await flush()
      expect(exitCalls).to.equal(1)
      expect(unlockCalls).to.equal(1)
      wrapper.unmount()
    } finally {
      global.window.setTimeout = originalSetTimeout
      global.window.clearTimeout = originalClearTimeout
      env.restore()
    }
  })

  it('adopts late resources to a newer owner and releases them once when no owner remains', async () => {
    const originalSetTimeout = global.window.setTimeout
    const originalClearTimeout = global.window.clearTimeout

    const oldFullscreenEnv = setupEnvironment()
    const oldFullscreen = deferred()
    const fullscreenTimers = []
    let fullscreenRequests = 0
    let fullscreenLocks = 0
    let fullscreenUnlocks = 0
    let fullscreenExits = 0
    global.window.setTimeout = callback => {
      fullscreenTimers.push(callback)
      return fullscreenTimers.length
    }
    global.window.clearTimeout = () => {}
    global.document.documentElement.requestFullscreen = () => {
      fullscreenRequests += 1
      if (fullscreenRequests === 1) return oldFullscreen.promise
      setFullscreenElement(global.document.documentElement)
      return Promise.resolve()
    }
    global.document.exitFullscreen = async () => { fullscreenExits += 1; setFullscreenElement(null) }
    global.screen.orientation.lock = async () => { fullscreenLocks += 1 }
    global.screen.orientation.unlock = () => { fullscreenUnlocks += 1 }
    try {
      const { mode, wrapper } = await mountMode()
      const oldRequest = mode.requestLandscape()
      await flush()
      fullscreenTimers[0]()
      await flush()
      expect(await mode.requestLandscape()).to.equal(true)
      oldFullscreen.resolve()
      expect(await oldRequest).to.equal(false)
      await flush()
      expect(global.document.fullscreenElement).to.equal(global.document.documentElement)
      expect(fullscreenExits).to.equal(0)
      expect(await mode.requestLandscape()).to.equal(false)
      wrapper.unmount()
      await flush()
      expect(fullscreenUnlocks).to.equal(1)
      expect(fullscreenExits).to.equal(1)
      expect(fullscreenLocks).to.equal(1)
    } finally {
      global.window.setTimeout = originalSetTimeout
      global.window.clearTimeout = originalClearTimeout
      oldFullscreenEnv.restore()
    }

    const oldLockEnv = setupEnvironment()
    const oldLock = deferred()
    const lockTimers = []
    let lockCalls = 0
    let unlockCalls = 0
    let lockExitCalls = 0
    global.window.setTimeout = callback => {
      lockTimers.push(callback)
      return lockTimers.length
    }
    global.window.clearTimeout = () => {}
    global.document.documentElement.requestFullscreen = async () => setFullscreenElement(global.document.documentElement)
    global.document.exitFullscreen = async () => { lockExitCalls += 1; setFullscreenElement(null) }
    global.screen.orientation.lock = () => {
      lockCalls += 1
      return lockCalls === 1 ? oldLock.promise : Promise.resolve()
    }
    global.screen.orientation.unlock = () => { unlockCalls += 1 }
    try {
      const { mode, wrapper } = await mountMode()
      const oldRequest = mode.requestLandscape()
      await flush()
      lockTimers[0]()
      await flush()
      expect(await mode.requestLandscape()).to.equal(true)
      oldLock.resolve()
      expect(await oldRequest).to.equal(false)
      await flush()
      expect(unlockCalls).to.equal(0)
      expect(await mode.requestLandscape()).to.equal(false)
      wrapper.unmount()
      await flush()
      expect(unlockCalls).to.equal(1)
      expect(lockExitCalls).to.equal(2)
    } finally {
      global.window.setTimeout = originalSetTimeout
      global.window.clearTimeout = originalClearTimeout
      oldLockEnv.restore()
    }

    const noOwnerEnv = setupEnvironment()
    const lateFullscreen = deferred()
    const noOwnerTimers = []
    let noOwnerExits = 0
    let noOwnerUnlocks = 0
    global.window.setTimeout = callback => {
      noOwnerTimers.push(callback)
      return noOwnerTimers.length
    }
    global.window.clearTimeout = () => {}
    global.document.documentElement.requestFullscreen = () => lateFullscreen.promise
    global.document.exitFullscreen = async () => { noOwnerExits += 1; setFullscreenElement(null) }
    global.screen.orientation.lock = async () => { throw new Error('late fullscreen must not lock') }
    global.screen.orientation.unlock = () => { noOwnerUnlocks += 1 }
    try {
      const { mode, wrapper } = await mountMode()
      const oldRequest = mode.requestLandscape()
      await flush()
      noOwnerTimers[0]()
      await flush()
      setFullscreenElement(global.document.documentElement)
      lateFullscreen.resolve()
      expect(await oldRequest).to.equal(false)
      await flush()
      expect(noOwnerExits).to.equal(1)
      expect(noOwnerUnlocks).to.equal(0)
      expect(global.document.fullscreenElement).to.equal(null)
      wrapper.unmount()
    } finally {
      global.window.setTimeout = originalSetTimeout
      global.window.clearTimeout = originalClearTimeout
      noOwnerEnv.restore()
    }

    const hostEnv = setupEnvironment()
    const hostFullscreen = deferred()
    const hostTimers = []
    const hostElement = global.document.createElement('div')
    let hostExits = 0
    global.window.setTimeout = callback => {
      hostTimers.push(callback)
      return hostTimers.length
    }
    global.window.clearTimeout = () => {}
    global.document.documentElement.requestFullscreen = () => hostFullscreen.promise
    global.document.exitFullscreen = async () => { hostExits += 1; setFullscreenElement(null) }
    try {
      const { mode, wrapper } = await mountMode()
      const oldRequest = mode.requestLandscape()
      await flush()
      hostTimers[0]()
      await flush()
      setFullscreenElement(hostElement)
      hostFullscreen.resolve()
      expect(await oldRequest).to.equal(false)
      await flush()
      expect(hostExits).to.equal(0)
      expect(global.document.fullscreenElement).to.equal(hostElement)
      wrapper.unmount()
    } finally {
      global.window.setTimeout = originalSetTimeout
      global.window.clearTimeout = originalClearTimeout
      hostEnv.restore()
    }
  })

  it('cleans late resources when the only current owner is releasing', async () => {
    const originalSetTimeout = global.window.setTimeout
    const originalClearTimeout = global.window.clearTimeout

    const failedNewOwnerEnv = setupEnvironment()
    const oldLock = deferred()
    const failedOwnerExit = deferred()
    const failedOwnerTimers = []
    let failedOwnerLockCalls = 0
    let failedOwnerUnlockCalls = 0
    let failedOwnerExitCalls = 0
    global.window.setTimeout = callback => {
      failedOwnerTimers.push(callback)
      return failedOwnerTimers.length
    }
    global.window.clearTimeout = () => {}
    global.document.documentElement.requestFullscreen = async () => setFullscreenElement(global.document.documentElement)
    global.screen.orientation.lock = () => {
      failedOwnerLockCalls += 1
      return failedOwnerLockCalls === 1 ? oldLock.promise : Promise.reject(new Error('new lock rejected'))
    }
    global.screen.orientation.unlock = () => { failedOwnerUnlockCalls += 1 }
    global.document.exitFullscreen = () => {
      failedOwnerExitCalls += 1
      if (failedOwnerExitCalls === 1) {
        setFullscreenElement(null)
        return Promise.resolve()
      }
      return failedOwnerExit.promise.then(() => setFullscreenElement(null))
    }
    try {
      const { mode, wrapper } = await mountMode()
      const oldRequest = mode.requestLandscape()
      await flush()
      failedOwnerTimers[0]()
      await flush()
      const newerRequest = mode.requestLandscape()
      await flush()
      expect(failedOwnerExitCalls).to.equal(2)
      oldLock.resolve()
      await flush()
      expect(failedOwnerUnlockCalls).to.equal(1)
      failedOwnerExit.resolve()
      expect(await newerRequest).to.equal(false)
      expect(await oldRequest).to.equal(false)
      wrapper.unmount()
    } finally {
      global.window.setTimeout = originalSetTimeout
      global.window.clearTimeout = originalClearTimeout
      failedNewOwnerEnv.restore()
    }

    const unmountedNewOwnerEnv = setupEnvironment()
    const unmountedOldLock = deferred()
    const unmountedNewLock = deferred()
    const unmountedExit = deferred()
    const unmountedTimers = []
    let unmountedLockCalls = 0
    let unmountedUnlockCalls = 0
    let unmountedExitCalls = 0
    global.window.setTimeout = callback => {
      unmountedTimers.push(callback)
      return unmountedTimers.length
    }
    global.window.clearTimeout = () => {}
    global.document.documentElement.requestFullscreen = async () => setFullscreenElement(global.document.documentElement)
    global.screen.orientation.lock = () => {
      unmountedLockCalls += 1
      return unmountedLockCalls === 1 ? unmountedOldLock.promise : unmountedNewLock.promise
    }
    global.screen.orientation.unlock = () => { unmountedUnlockCalls += 1 }
    global.document.exitFullscreen = () => {
      unmountedExitCalls += 1
      if (unmountedExitCalls === 1) {
        setFullscreenElement(null)
        return Promise.resolve()
      }
      return unmountedExit.promise.then(() => setFullscreenElement(null))
    }
    try {
      const { mode, wrapper } = await mountMode()
      const oldRequest = mode.requestLandscape()
      await flush()
      unmountedTimers[0]()
      await flush()
      const newerRequest = mode.requestLandscape()
      await flush()
      wrapper.unmount()
      await flush()
      unmountedOldLock.resolve()
      await flush()
      expect(unmountedUnlockCalls).to.equal(1)
      unmountedExit.resolve()
      expect(await oldRequest).to.equal(false)
      unmountedNewLock.resolve()
      expect(await newerRequest).to.equal(false)
      await flush()
      expect(unmountedUnlockCalls).to.equal(2)
    } finally {
      global.window.setTimeout = originalSetTimeout
      global.window.clearTimeout = originalClearTimeout
      unmountedNewOwnerEnv.restore()
    }

    const sameOwnerEnv = setupEnvironment()
    const sameOwnerLock = deferred()
    const sameOwnerExit = deferred()
    const sameOwnerTimers = []
    let sameOwnerUnlockCalls = 0
    global.window.setTimeout = callback => {
      sameOwnerTimers.push(callback)
      return sameOwnerTimers.length
    }
    global.window.clearTimeout = () => {}
    global.document.documentElement.requestFullscreen = async () => setFullscreenElement(global.document.documentElement)
    global.screen.orientation.lock = () => sameOwnerLock.promise
    global.screen.orientation.unlock = () => { sameOwnerUnlockCalls += 1 }
    global.document.exitFullscreen = () => sameOwnerExit.promise.then(() => setFullscreenElement(null))
    try {
      const { mode, wrapper } = await mountMode()
      const request = mode.requestLandscape()
      await flush()
      sameOwnerTimers[0]()
      await flush()
      sameOwnerLock.resolve()
      await flush()
      expect(sameOwnerUnlockCalls).to.equal(1)
      sameOwnerExit.resolve()
      expect(await request).to.equal(false)
      wrapper.unmount()
    } finally {
      global.window.setTimeout = originalSetTimeout
      global.window.clearTimeout = originalClearTimeout
      sameOwnerEnv.restore()
    }
  })

  it('cleans late fullscreen against releasing Hall ownership without touching host fullscreen', async () => {
    const originalSetTimeout = global.window.setTimeout
    const originalClearTimeout = global.window.clearTimeout
    const hallEnv = setupEnvironment()
    const oldFullscreen = deferred()
    const hallExit = deferred()
    const hallTimers = []
    let fullscreenRequests = 0
    let hallExitCalls = 0
    global.window.setTimeout = callback => {
      hallTimers.push(callback)
      return hallTimers.length
    }
    global.window.clearTimeout = () => {}
    global.document.documentElement.requestFullscreen = () => {
      fullscreenRequests += 1
      if (fullscreenRequests === 1) return oldFullscreen.promise
      setFullscreenElement(global.document.documentElement)
      return Promise.resolve()
    }
    global.screen.orientation.lock = async () => { throw new Error('new lock rejected') }
    global.document.exitFullscreen = () => {
      hallExitCalls += 1
      return hallExit.promise.then(() => setFullscreenElement(null))
    }
    try {
      const { mode, wrapper } = await mountMode()
      const oldRequest = mode.requestLandscape()
      await flush()
      hallTimers[0]()
      await flush()
      const newerRequest = mode.requestLandscape()
      await flush()
      expect(hallExitCalls).to.equal(1)
      oldFullscreen.resolve()
      await flush()
      expect(hallExitCalls).to.equal(1)
      hallExit.resolve()
      expect(await newerRequest).to.equal(false)
      expect(await oldRequest).to.equal(false)
      wrapper.unmount()
    } finally {
      global.window.setTimeout = originalSetTimeout
      global.window.clearTimeout = originalClearTimeout
      hallEnv.restore()
    }

    const hostEnv = setupEnvironment()
    const hostFullscreen = deferred()
    const hostExit = deferred()
    const hostTimers = []
    const hostElement = global.document.createElement('div')
    let hostRequests = 0
    let hostExitCalls = 0
    global.window.setTimeout = callback => {
      hostTimers.push(callback)
      return hostTimers.length
    }
    global.window.clearTimeout = () => {}
    global.document.documentElement.requestFullscreen = () => {
      hostRequests += 1
      if (hostRequests === 1) return hostFullscreen.promise
      setFullscreenElement(global.document.documentElement)
      return Promise.resolve()
    }
    global.screen.orientation.lock = async () => { throw new Error('new lock rejected') }
    global.document.exitFullscreen = () => {
      hostExitCalls += 1
      return hostExit.promise
    }
    try {
      const { mode, wrapper } = await mountMode()
      const oldRequest = mode.requestLandscape()
      await flush()
      hostTimers[0]()
      await flush()
      const newerRequest = mode.requestLandscape()
      await flush()
      expect(hostExitCalls).to.equal(1)
      setFullscreenElement(hostElement)
      hostFullscreen.resolve()
      await flush()
      expect(hostExitCalls).to.equal(1)
      expect(global.document.fullscreenElement).to.equal(hostElement)
      hostExit.resolve()
      expect(await newerRequest).to.equal(false)
      expect(await oldRequest).to.equal(false)
      expect(global.document.fullscreenElement).to.equal(hostElement)
      wrapper.unmount()
    } finally {
      global.window.setTimeout = originalSetTimeout
      global.window.clearTimeout = originalClearTimeout
      hostEnv.restore()
    }
  })

  it('never claims, requests, or exits host-owned fullscreen', async () => {
    const env = setupEnvironment()
    const hostElement = global.document.createElement('div')
    let requestCalls = 0
    let exitCalls = 0
    setFullscreenElement(hostElement)
    global.document.documentElement.requestFullscreen = async () => { requestCalls += 1 }
    global.document.exitFullscreen = async () => { exitCalls += 1 }
    global.screen.orientation.lock = async () => { throw new Error('must not lock') }
    try {
      const { mode, wrapper } = await mountMode()
      expect(await mode.requestLandscape()).to.equal(false)
      expect(requestCalls).to.equal(0)
      expect(exitCalls).to.equal(0)
      expect(global.document.fullscreenElement).to.equal(hostElement)
      wrapper.unmount()
      await flush()
      expect(exitCalls).to.equal(0)
      expect(global.document.fullscreenElement).to.equal(hostElement)
    } finally {
      env.restore()
    }
  })

  it('keeps orientation ownership in the mode composable, not panels or stage', () => {
    const modeSource = readFileSync(new URL('../src/composables/juyiting/useHallExperienceMode.js', import.meta.url), 'utf8')
    const panelsSource = readFileSync(new URL('../src/composables/juyiting/useHallPanels.js', import.meta.url), 'utf8')
    const stageSource = readFileSync(new URL('../src/components/juyiting/HallStage.vue', import.meta.url), 'utf8')

    expect(modeSource).to.include("screenOrientation?.addEventListener?.('change'")
    expect(modeSource).to.include("window.addEventListener?.('orientationchange'")
    expect(modeSource).not.to.include("addEventListener?.('resize'")
    expect(panelsSource).not.to.include('addEventListener')
    expect(panelsSource).not.to.include('matchMedia')
    expect(stageSource).not.to.include("matchMedia?.('(orientation: landscape)')")
    expect(stageSource).not.to.include('miniProgram.redirectTo')
    expect(stageSource).not.to.include('transform: rotate(90deg)')
  })
})

describe('O04 panel projection ownership', () => {
  it('keeps panel session ownership out of the orientation projection composable', () => {
    const panelsSource = readFileSync(new URL('../src/composables/juyiting/useHallPanels.js', import.meta.url), 'utf8')
    expect(panelsSource).to.include('export const isCurrentPanelGeneration')
    expect(panelsSource).to.include('export const resolvePanelReturnTarget')
    expect(panelsSource).not.to.include('addEventListener')
    expect(panelsSource).not.to.include('matchMedia')
    expect(panelsSource).not.to.include('orientation')
  })
})
