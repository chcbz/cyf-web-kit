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

const createMedia = (matches = false) => {
  const listeners = new Set()
  return {
    matches,
    addEventListener: (_event, listener) => listeners.add(listener),
    removeEventListener: (_event, listener) => listeners.delete(listener),
    emit(next) {
      this.matches = next
      listeners.forEach(listener => listener({ matches: next }))
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
    emit({ nextType = this.type, nextAngle = this.angle } = {}) {
      this.type = nextType
      this.angle = nextAngle
      listeners.forEach(listener => listener(new global.window.Event('change')))
    },
    listenerCount: () => listeners.size
  }
}

const setFullscreenElement = element => Object.defineProperty(global.document, 'fullscreenElement', {
  configurable: true,
  value: element
})

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

  it('prefers screen.orientation truth when orientation media is missing or stale', async () => {
    const missingMedia = setupEnvironment({ mediaLandscape: null, screen: { type: 'portrait-primary', angle: 0 } })
    try {
      const { mode, wrapper } = await mountMode()
      expect(mode.experienceMode.value).to.equal('portrait-command')
      missingMedia.screenOrientation.emit({ nextType: 'landscape-primary', nextAngle: 90 })
      await flush()
      expect(mode.experienceMode.value).to.equal('landscape-map')
      wrapper.unmount()
    } finally {
      missingMedia.restore()
    }

    const staleMedia = setupEnvironment({ mediaLandscape: false, screen: { type: undefined, angle: 90 } })
    try {
      const { mode, wrapper } = await mountMode()
      expect(mode.experienceMode.value).to.equal('landscape-map')
      staleMedia.screenOrientation.emit({ nextType: undefined, nextAngle: 0 })
      await flush()
      expect(mode.experienceMode.value).to.equal('portrait-command')
      wrapper.unmount()
    } finally {
      staleMedia.restore()
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

  it('does not switch shells merely because a successful request completes', async () => {
    const env = setupEnvironment()
    let exitCalls = 0
    global.document.documentElement.requestFullscreen = async () => setFullscreenElement(global.document.documentElement)
    global.document.exitFullscreen = async () => { exitCalls += 1; setFullscreenElement(null) }
    global.screen.orientation.lock = async () => {}
    global.screen.orientation.unlock = () => {}
    try {
      const { mode, wrapper } = await mountMode()
      expect(await mode.requestLandscape()).to.equal(true)
      expect(mode.experienceMode.value).to.equal('portrait-command')
      wrapper.unmount()
      await flush()
      expect(exitCalls).to.equal(1)
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
