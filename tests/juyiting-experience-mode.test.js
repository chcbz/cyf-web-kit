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

const setupEnvironment = ({ coarse = true, landscape = false } = {}) => {
  const original = {
    matchMedia: global.window.matchMedia,
    requestFullscreen: global.document.documentElement.requestFullscreen,
    exitFullscreen: global.document.exitFullscreen,
    screen: global.screen
  }
  const orientation = createMedia(landscape)
  const pointer = createMedia(coarse)
  global.window.matchMedia = query => query.includes('orientation') ? orientation : pointer
  return {
    orientation,
    pointer,
    restore() {
      global.window.matchMedia = original.matchMedia
      global.document.documentElement.requestFullscreen = original.requestFullscreen
      global.document.exitFullscreen = original.exitFullscreen
      global.screen = original.screen
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

  it('keeps desktop in landscape-map regardless of physical dimensions', async () => {
    const env = setupEnvironment({ coarse: false, landscape: false })
    try {
      const { mode, wrapper } = await mountMode()
      expect(mode.experienceMode.value).to.equal('landscape-map')
      expect(env.orientation.listenerCount()).to.equal(1)
      expect(env.pointer.listenerCount()).to.equal(1)
      env.orientation.emit(true)
      await flush()
      expect(mode.experienceMode.value).to.equal('landscape-map')
      wrapper.unmount()
      expect(env.orientation.listenerCount()).to.equal(0)
      expect(env.pointer.listenerCount()).to.equal(0)
    } finally {
      env.restore()
    }
  })

  it('uses only physical orientation for mobile shells and ignores keyboard viewport changes', async () => {
    const env = setupEnvironment({ coarse: true, landscape: false })
    const originalVisualViewport = global.window.visualViewport
    let visualListener = null
    Object.defineProperty(global.window, 'visualViewport', { configurable: true, value: {
      addEventListener: (_event, listener) => { visualListener = listener },
      removeEventListener: () => {},
      height: 800
    } })
    try {
      const { mode, wrapper } = await mountMode()
      expect(mode.experienceMode.value).to.equal('portrait-command')
      global.window.dispatchEvent(new global.window.Event('resize'))
      expect(visualListener).to.equal(null)
      await flush()
      expect(mode.experienceMode.value).to.equal('portrait-command')
      env.orientation.emit(true)
      await flush()
      expect(mode.experienceMode.value).to.equal('landscape-map')
      env.orientation.emit(false)
      await flush()
      expect(mode.experienceMode.value).to.equal('portrait-command')
      wrapper.unmount()
    } finally {
      Object.defineProperty(global.window, 'visualViewport', { configurable: true, value: originalVisualViewport })
      env.restore()
    }
  })

  it('never switches shells for a request until the physical orientation changes, including rejection', async () => {
    const env = setupEnvironment({ coarse: true, landscape: false })
    let fullscreenCalls = 0
    let exitCalls = 0
    global.document.documentElement.requestFullscreen = async () => { fullscreenCalls += 1 }
    global.document.exitFullscreen = async () => { exitCalls += 1 }
    global.screen = { orientation: { lock: async () => { throw new Error('rejected') }, unlock: () => {} } }
    try {
      const { mode, wrapper } = await mountMode()
      await mode.requestLandscape()
      expect(fullscreenCalls).to.equal(1)
      expect(mode.experienceMode.value).to.equal('portrait-command')
      expect(mode.orientationHint.value).to.equal('请旋转手机横屏查看')
      expect(exitCalls).to.equal(1)
      wrapper.unmount()
      await flush()
      expect(exitCalls).to.equal(1)
    } finally {
      env.restore()
    }
  })

  it('times out without changing shells and releases a late fullscreen acquisition', async () => {
    const env = setupEnvironment({ coarse: true, landscape: false })
    const originalSetTimeout = global.window.setTimeout
    const originalClearTimeout = global.window.clearTimeout
    const timers = []
    let resolveFullscreen
    let exitCalls = 0
    global.window.setTimeout = (callback, delay) => {
      timers.push({ callback, delay, cleared: false })
      return timers.length
    }
    global.window.clearTimeout = id => { if (timers[id - 1]) timers[id - 1].cleared = true }
    global.document.documentElement.requestFullscreen = () => new Promise(resolve => { resolveFullscreen = resolve })
    global.document.exitFullscreen = async () => { exitCalls += 1 }
    global.screen = { orientation: { lock: async () => {}, unlock: () => {} } }
    try {
      const { mode, wrapper } = await mountMode()
      const pending = mode.requestLandscape()
      expect(timers).to.have.length(1)
      expect(timers[0].delay).to.equal(3000)
      timers[0].callback()
      await flush()
      expect(mode.orientationRequestPending.value).to.equal(false)
      expect(mode.experienceMode.value).to.equal('portrait-command')
      expect(mode.orientationHint.value).to.equal('请旋转手机横屏查看')
      resolveFullscreen()
      await pending
      expect(exitCalls).to.equal(1)
      wrapper.unmount()
    } finally {
      global.window.setTimeout = originalSetTimeout
      global.window.clearTimeout = originalClearTimeout
      env.restore()
    }
  })

  it('fails closed for duplicate, late, and unmounted requests while physical orientation remains latest truth', async () => {
    const env = setupEnvironment({ coarse: true, landscape: false })
    let resolveFullscreen
    let fullscreenCalls = 0
    let exitCalls = 0
    global.document.documentElement.requestFullscreen = () => {
      fullscreenCalls += 1
      return new Promise(resolve => { resolveFullscreen = resolve })
    }
    global.document.exitFullscreen = async () => { exitCalls += 1 }
    global.screen = { orientation: { lock: async () => {}, unlock: () => {} } }
    try {
      const { mode, wrapper } = await mountMode()
      const first = mode.requestLandscape()
      expect(await mode.requestLandscape()).to.equal(false)
      expect(fullscreenCalls).to.equal(1)
      env.orientation.emit(true)
      await flush()
      expect(mode.experienceMode.value).to.equal('landscape-map')
      env.orientation.emit(false)
      await flush()
      expect(mode.experienceMode.value).to.equal('portrait-command')
      wrapper.unmount()
      resolveFullscreen()
      await first
      await flush()
      expect(mode.experienceMode.value).to.equal('portrait-command')
      expect(exitCalls).to.equal(1)
    } finally {
      env.restore()
    }
  })

  it('keeps orientation ownership in the mode composable, not panels or stage', () => {
    const modeSource = readFileSync(new URL('../src/composables/juyiting/useHallExperienceMode.js', import.meta.url), 'utf8')
    const panelsSource = readFileSync(new URL('../src/composables/juyiting/useHallPanels.js', import.meta.url), 'utf8')
    const stageSource = readFileSync(new URL('../src/components/juyiting/HallStage.vue', import.meta.url), 'utf8')

    expect(modeSource).to.include("matchMedia?.('(orientation: landscape)')")
    expect(modeSource).to.include("matchMedia?.('(pointer: coarse)')")
    expect(panelsSource).not.to.include('addEventListener')
    expect(panelsSource).not.to.include('matchMedia')
    expect(stageSource).not.to.include("matchMedia?.('(orientation: landscape)')")
    expect(stageSource).not.to.include('miniProgram.redirectTo')
    expect(stageSource).not.to.include('transform: rotate(90deg)')
  })
})
