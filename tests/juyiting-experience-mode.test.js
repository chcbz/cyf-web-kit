import { expect } from 'chai'
import { before } from 'mocha'
import { readFileSync } from 'fs'

// Keep this focused suite independently runnable; the full suite may initialize SVG globals in another file first.
global.SVGElement = global.window?.SVGElement
global.Element = global.window?.Element
global.Node = global.window?.Node

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

const dispatchFullscreenChange = () => global.document.dispatchEvent(new global.window.Event('fullscreenchange'))

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

  it('uses viewport dimensions only for no-API initialization and later updates presentation without changing physical mode', async () => {
    const originalWidth = global.window.innerWidth
    const originalHeight = global.window.innerHeight
    const originalVisualViewport = global.window.visualViewport
    const visualListeners = new Set()
    let visualWidth = 390
    let visualHeight = 844
    let wrapper
    Object.defineProperty(global.window, 'innerWidth', { configurable: true, writable: true, value: 390 })
    Object.defineProperty(global.window, 'innerHeight', { configurable: true, writable: true, value: 844 })
    Object.defineProperty(global.window, 'visualViewport', { configurable: true, value: {
      get width() { return visualWidth },
      get height() { return visualHeight },
      addEventListener: (_event, listener) => visualListeners.add(listener),
      removeEventListener: (_event, listener) => visualListeners.delete(listener)
    } })
    const env = setupEnvironment({ mediaLandscape: null, screen: false })
    try {
      const mounted = await mountMode()
      wrapper = mounted.wrapper
      expect(mounted.mode.experienceMode.value).to.equal('portrait-command')
      expect(mounted.mode.hallViewportHeight.value).to.equal(844)
      expect(visualListeners.size).to.equal(1)
      global.window.innerWidth = 844
      global.window.innerHeight = 390
      visualWidth = 844
      visualHeight = 390
      global.window.dispatchEvent(new global.window.Event('resize'))
      visualListeners.forEach(listener => listener(new global.window.Event('resize')))
      await flush()
      expect(mounted.mode.hallViewportHeight.value).to.equal(390)
      expect(mounted.mode.isPhysicalLandscape.value).to.equal(false)
      expect(mounted.mode.experienceMode.value).to.equal('portrait-command')
    } finally {
      wrapper?.unmount()
      expect(visualListeners.size).to.equal(0)
      Object.defineProperty(global.window, 'innerWidth', { configurable: true, value: originalWidth })
      Object.defineProperty(global.window, 'innerHeight', { configurable: true, value: originalHeight })
      Object.defineProperty(global.window, 'visualViewport', { configurable: true, value: originalVisualViewport })
      env.restore()
    }
  })

  it('tracks live viewport height separately from physical orientation and restores it after rotation', async () => {
    const originals = {
      innerWidth: global.window.innerWidth,
      innerHeight: global.window.innerHeight,
      visualViewport: global.window.visualViewport
    }
    const visualListeners = new Set()
    let visualWidth = 844
    let visualHeight = 390
    Object.defineProperty(global.window, 'innerWidth', { configurable: true, writable: true, value: 844 })
    Object.defineProperty(global.window, 'innerHeight', { configurable: true, writable: true, value: 390 })
    Object.defineProperty(global.window, 'visualViewport', { configurable: true, value: {
      get width() { return visualWidth },
      get height() { return visualHeight },
      addEventListener: (_event, listener) => visualListeners.add(listener),
      removeEventListener: (_event, listener) => visualListeners.delete(listener)
    } })
    const env = setupEnvironment({ mediaLandscape: true, screen: false })
    let wrapper
    try {
      const mounted = await mountMode()
      const { mode } = mounted
      wrapper = mounted.wrapper
      expect(mode.isPhysicalLandscape.value).to.equal(true)
      expect(mode.hallViewportHeight.value).to.equal(390)

      // A keyboard resize changes only presentation height; it cannot change
      // the physical orientation or leave a remembered 430px-style value.
      visualHeight = 220
      visualListeners.forEach(listener => listener(new global.window.Event('resize')))
      await flush()
      expect(mode.hallViewportHeight.value).to.equal(220)
      expect(mode.isPhysicalLandscape.value).to.equal(true)

      global.window.innerWidth = 390
      global.window.innerHeight = 844
      visualWidth = 390
      visualHeight = 844
      env.orientationMedia.emit(false, { matches: false, timeStamp: 100 })
      global.window.dispatchEvent(new global.window.Event('resize'))
      visualListeners.forEach(listener => listener(new global.window.Event('resize')))
      await flush()
      expect(mode.isPhysicalLandscape.value).to.equal(false)
      expect(mode.hallViewportHeight.value).to.equal(844)
    } finally {
      wrapper?.unmount()
      expect(visualListeners.size).to.equal(0)
      Object.defineProperty(global.window, 'innerWidth', { configurable: true, value: originals.innerWidth })
      Object.defineProperty(global.window, 'innerHeight', { configurable: true, value: originals.innerHeight })
      Object.defineProperty(global.window, 'visualViewport', { configurable: true, value: originals.visualViewport })
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
      dispatchLegacyOrientationChange(100)
      dispatchLegacyOrientationChange(101)
      await flush()
      expect(mode.experienceMode.value).to.equal('landscape-map')
      expect(commits).to.equal(1)
      global.window.orientation = 0
      dispatchLegacyOrientationChange(102)
      await flush()
      expect(mode.experienceMode.value).to.equal('portrait-command')
      expect(commits).to.equal(2)
      wrapper.unmount()
      global.window.orientation = 90
      dispatchLegacyOrientationChange(103)
      await flush()
      expect(mode.experienceMode.value).to.equal('portrait-command')
      stop()
    } finally {
      env.restore()
    }
  })

  it('settles a successful orientation request from the real orientation event and cleans owned resources once', async () => {
    const env = setupEnvironment()
    let exits = 0
    let unlocks = 0
    global.document.documentElement.requestFullscreen = async () => setFullscreenElement(global.document.documentElement)
    global.document.exitFullscreen = async () => { exits += 1; setFullscreenElement(null) }
    global.screen.orientation.lock = async () => env.screenOrientation.emit({ nextType: 'landscape-primary', nextAngle: 90 })
    global.screen.orientation.unlock = () => { unlocks += 1 }
    try {
      const { mode, wrapper } = await mountMode()
      expect(await mode.requestLandscape()).to.equal(true)
      expect(mode.orientationRequestPending.value).to.equal(false)
      wrapper.unmount()
      await flush()
      expect(unlocks).to.equal(1)
      expect(exits).to.equal(1)
    } finally { env.restore() }
  })

  it('lets the user exit portrait while retaining the normal owner-release fence', async () => {
    const env = setupEnvironment()
    let exits = 0
    let unlocks = 0
    global.document.documentElement.requestFullscreen = async () => setFullscreenElement(global.document.documentElement)
    global.document.exitFullscreen = async () => { exits += 1; setFullscreenElement(null) }
    global.screen.orientation.lock = async () => env.screenOrientation.emit({ nextType: 'landscape-primary', nextAngle: 90 })
    global.screen.orientation.unlock = () => { unlocks += 1 }
    try {
      const { mode, wrapper } = await mountMode()
      expect(await mode.requestLandscape()).to.equal(true)
      expect(await mode.requestPortrait()).to.equal(true)
      expect(mode.experienceMode.value).to.equal('portrait-command')
      expect(unlocks).to.equal(1)
      expect(exits).to.equal(1)
      wrapper.unmount()
    } finally { env.restore() }
  })

  it('does not exit host-owned fullscreen after Hall loses ownership', async () => {
    const env = setupEnvironment()
    const hostElement = global.document.createElement('div')
    let exits = 0
    global.document.documentElement.requestFullscreen = async () => setFullscreenElement(global.document.documentElement)
    global.document.exitFullscreen = async () => { exits += 1; setFullscreenElement(null) }
    global.screen.orientation.lock = async () => env.screenOrientation.emit({ nextType: 'landscape-primary', nextAngle: 90 })
    try {
      const { mode, wrapper } = await mountMode()
      expect(await mode.requestLandscape()).to.equal(true)
      setFullscreenElement(hostElement)
      dispatchFullscreenChange()
      await flush()
      expect(global.document.fullscreenElement).to.equal(hostElement)
      expect(exits).to.equal(0)
      wrapper.unmount()
    } finally { env.restore() }
  })

  it('shows the physical-rotation hint immediately when automatic landscape is unsupported', async () => {
    const env = setupEnvironment()
    const originalSetTimeout = global.window.setTimeout
    let fullscreenCalls = 0
    let timerCalls = 0
    global.document.documentElement.requestFullscreen = undefined
    global.screen.orientation.lock = async () => { fullscreenCalls += 1 }
    global.window.setTimeout = () => { timerCalls += 1; return timerCalls }
    try {
      const { mode, wrapper } = await mountMode()
      expect(await mode.requestLandscape()).to.equal(false)
      expect(mode.orientationHint.value).to.equal('请旋转手机横屏查看')
      expect(mode.orientationRequestPending.value).to.equal(false)
      expect(fullscreenCalls).to.equal(0)
      expect(timerCalls).to.equal(0)
      wrapper.unmount()
    } finally {
      global.window.setTimeout = originalSetTimeout
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

  it('does not force-cancel a pending fullscreen request; explicit portrait exit settles it', async () => {
    const env = setupEnvironment()
    const fullscreen = deferred()
    global.document.documentElement.requestFullscreen = () => fullscreen.promise
    global.document.exitFullscreen = async () => setFullscreenElement(null)
    global.screen.orientation.lock = async () => {}
    try {
      const { mode, wrapper } = await mountMode()
      const request = mode.requestLandscape()
      await flush()
      expect(mode.orientationRequestPending.value).to.equal(true)
      expect(await mode.requestPortrait()).to.equal(true)
      expect(await request).to.equal(false)
      fullscreen.resolve()
      await flush()
      wrapper.unmount()
    } finally { env.restore() }
  })

  it('does not force-cancel a pending orientation lock; explicit portrait exit releases it', async () => {
    const env = setupEnvironment()
    const lock = deferred()
    let exits = 0
    global.document.documentElement.requestFullscreen = async () => setFullscreenElement(global.document.documentElement)
    global.document.exitFullscreen = async () => { exits += 1; setFullscreenElement(null) }
    global.screen.orientation.lock = () => lock.promise
    try {
      const { mode, wrapper } = await mountMode()
      const request = mode.requestLandscape()
      await flush()
      expect(mode.orientationRequestPending.value).to.equal(true)
      expect(await mode.requestPortrait()).to.equal(true)
      expect(await request).to.equal(false)
      expect(exits).to.equal(1)
      lock.resolve()
      await flush()
      wrapper.unmount()
    } finally { env.restore() }
  })

  it('settles pending fullscreen and lock requests on unmount and handles their late rejection', async () => {
    const fullscreenEnv = setupEnvironment()
    const fullscreen = deferred()
    global.document.documentElement.requestFullscreen = () => fullscreen.promise
    global.screen.orientation.lock = async () => { throw new Error('pending fullscreen must not lock') }
    try {
      const { mode, wrapper } = await mountMode()
      const request = mode.requestLandscape()
      await flush()
      wrapper.unmount()
      expect(await request).to.equal(false)
      fullscreen.reject(new Error('late fullscreen rejection'))
      await flush()
    } finally {
      fullscreenEnv.restore()
    }

    const lockEnv = setupEnvironment()
    const lock = deferred()
    let exitCalls = 0
    global.document.documentElement.requestFullscreen = async () => setFullscreenElement(global.document.documentElement)
    global.document.exitFullscreen = async () => { exitCalls += 1; setFullscreenElement(null) }
    global.screen.orientation.lock = () => lock.promise
    try {
      const { mode, wrapper } = await mountMode()
      const request = mode.requestLandscape()
      await flush()
      wrapper.unmount()
      expect(await request).to.equal(false)
      expect(exitCalls).to.equal(1)
      lock.reject(new Error('late lock rejection'))
      await flush()
      expect(exitCalls).to.equal(1)
    } finally {
      lockEnv.restore()
    }
  })

  it('keeps a pending lock pending until a real lifecycle end, then ignores its late resolution', async () => {
    const env = setupEnvironment()
    const lock = deferred()
    global.document.documentElement.requestFullscreen = async () => setFullscreenElement(global.document.documentElement)
    global.document.exitFullscreen = async () => setFullscreenElement(null)
    global.screen.orientation.lock = () => lock.promise
    try {
      const { mode, wrapper } = await mountMode()
      const request = mode.requestLandscape()
      await flush()
      expect(mode.orientationRequestPending.value).to.equal(true)
      wrapper.unmount()
      expect(await request).to.equal(false)
      lock.resolve()
      await flush()
    } finally { env.restore() }
  })

  it('keeps late completion fenced after the user has withdrawn the request', async () => {
    const env = setupEnvironment()
    const fullscreen = deferred()
    let exits = 0
    global.document.documentElement.requestFullscreen = () => fullscreen.promise
    global.document.exitFullscreen = async () => { exits += 1; setFullscreenElement(null) }
    global.screen.orientation.lock = async () => {}
    try {
      const { mode, wrapper } = await mountMode()
      const request = mode.requestLandscape()
      await flush()
      expect(await mode.requestPortrait()).to.equal(true)
      expect(await request).to.equal(false)
      setFullscreenElement(global.document.documentElement)
      fullscreen.resolve()
      await flush()
      expect(exits).to.equal(0)
      wrapper.unmount()
    } finally { env.restore() }
  })

  it('does not exit host fullscreen when a withdrawn request resolves late', async () => {
    const env = setupEnvironment()
    const fullscreen = deferred()
    const hostElement = global.document.createElement('div')
    let exits = 0
    global.document.documentElement.requestFullscreen = () => fullscreen.promise
    global.document.exitFullscreen = async () => { exits += 1; setFullscreenElement(null) }
    global.screen.orientation.lock = async () => {}
    try {
      const { mode, wrapper } = await mountMode()
      const request = mode.requestLandscape()
      await flush()
      await mode.requestPortrait()
      setFullscreenElement(hostElement)
      fullscreen.resolve()
      await flush()
      expect(exits).to.equal(0)
      expect(global.document.fullscreenElement).to.equal(hostElement)
      expect(await request).to.equal(false)
      wrapper.unmount()
    } finally { env.restore() }
  })

  it('releases only the active Hall-owned resources on unmount', async () => {
    const env = setupEnvironment()
    let exits = 0
    let unlocks = 0
    global.document.documentElement.requestFullscreen = async () => setFullscreenElement(global.document.documentElement)
    global.document.exitFullscreen = async () => { exits += 1; setFullscreenElement(null) }
    global.screen.orientation.lock = async () => env.screenOrientation.emit({ nextType: 'landscape-primary', nextAngle: 90 })
    global.screen.orientation.unlock = () => { unlocks += 1 }
    try {
      const { mode, wrapper } = await mountMode()
      await mode.requestLandscape()
      wrapper.unmount()
      await flush()
      expect(unlocks).to.equal(1)
      expect(exits).to.equal(1)
    } finally { env.restore() }
  })

  it('does not make an arbitrary timer a request lifecycle owner', () => {
    const source = readFileSync(new URL('../src/composables/juyiting/useHallExperienceMode.js', import.meta.url), 'utf8')
    expect(source).not.to.include('REQUEST_TIMEOUT_MS')
    expect(source).not.to.include('requestTimer')
    expect(source).to.include('releaseRequestOwnership')
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

  it('uses an interactive virtual landscape shell in WeChat without requesting fullscreen or orientation lock', async () => {
    const env = setupEnvironment()
    const originalWx = global.wx
    let fullscreenRequests = 0
    let lockRequests = 0
    global.wx = { miniProgram: {} }
    global.document.documentElement.requestFullscreen = () => { fullscreenRequests += 1; return Promise.resolve() }
    global.screen.orientation.lock = () => { lockRequests += 1; return Promise.resolve() }
    try {
      const { mode, wrapper } = await mountMode()
      expect(await mode.requestLandscape()).to.equal(true)
      expect(mode.experienceMode.value).to.equal('landscape-map')
      expect(mode.isVirtualLandscape.value).to.equal(true)
      expect(mode.orientationHint.value).to.equal('')
      expect(await mode.requestPortrait()).to.equal(true)
      expect(mode.experienceMode.value).to.equal('portrait-command')
      expect(mode.isVirtualLandscape.value).to.equal(false)
      expect(fullscreenRequests).to.equal(0)
      expect(lockRequests).to.equal(0)
      wrapper.unmount()
    } finally {
      global.wx = originalWx
      env.restore()
    }
  })

  it('hands a marked portrait Mini Program route to the native landscape page without virtual rotation', async () => {
    const env = setupEnvironment()
    const originalUrl = global.window.location.href
    const originalWx = global.window.wx
    const calls = []
    global.window.history.replaceState({}, '', '/juyiting?nativeOrientation=portrait&entry=direct')
    global.window.wx = {
      miniProgram: {
        navigateTo: options => calls.push(options),
        redirectTo: options => calls.push(options)
      }
    }
    try {
      const { mode, wrapper } = await mountMode()
      expect(mode.isNativeOrientationRoute.value).to.equal(true)
      expect(mode.isVirtualLandscape.value).to.equal(false)
      expect(mode.experienceMode.value).to.equal('portrait-command')
      expect(await mode.requestLandscape()).to.equal(true)
      expect(calls[0].url).to.equal('/pages/landscape/index?entry=portrait')
      expect(mode.isVirtualLandscape.value).to.equal(false)
      wrapper.unmount()
    } finally {
      global.window.wx = originalWx
      global.window.history.replaceState({}, '', originalUrl)
      env.restore()
    }
  })

  it('hands a marked landscape Mini Program route back to the native portrait page', async () => {
    const env = setupEnvironment()
    const originalUrl = global.window.location.href
    const originalWx = global.window.wx
    const calls = []
    global.window.history.replaceState({}, '', '/juyiting?nativeOrientation=landscape&entry=portrait')
    global.window.wx = {
      miniProgram: {
        navigateBack: options => calls.push(options),
        redirectTo: options => calls.push(options)
      }
    }
    try {
      const { mode, wrapper } = await mountMode()
      expect(mode.isNativeOrientationRoute.value).to.equal(true)
      expect(mode.isVirtualLandscape.value).to.equal(false)
      expect(mode.experienceMode.value).to.equal('landscape-map')
      expect(await mode.requestPortrait()).to.equal(true)
      expect(calls[0].delta).to.equal(1)
      wrapper.unmount()
    } finally {
      global.window.wx = originalWx
      global.window.history.replaceState({}, '', originalUrl)
      env.restore()
    }
  })

  it('lets the explicit portrait control release Hall-owned native orientation state', async () => {
    const env = setupEnvironment()
    let unlocks = 0
    let exits = 0
    global.document.documentElement.requestFullscreen = async () => setFullscreenElement(global.document.documentElement)
    global.document.exitFullscreen = async () => { exits += 1; setFullscreenElement(null) }
    global.screen.orientation.lock = async () => env.screenOrientation.emit({ nextType: 'landscape-primary', nextAngle: 90 })
    global.screen.orientation.unlock = () => { unlocks += 1 }
    try {
      const { mode, wrapper } = await mountMode()
      expect(await mode.requestLandscape()).to.equal(true)
      expect(mode.experienceMode.value).to.equal('landscape-map')
      expect(await mode.requestPortrait()).to.equal(true)
      // Releasing native ownership is best effort; the explicit control must
      // switch the shell immediately even before the device reports rotation.
      expect(mode.experienceMode.value).to.equal('portrait-command')
      expect(unlocks).to.equal(1)
      expect(exits).to.equal(1)
      wrapper.unmount()
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
    expect(modeSource).to.include('const isWeChatWebView')
    expect(modeSource).to.include('const requestPortrait = async () =>')
    expect(modeSource).to.include("visualViewport?.addEventListener?.('resize'")
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
