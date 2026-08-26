import { expect } from 'chai'
import { before } from 'mocha'
import { readFileSync } from 'fs'
import { compileScript, parse } from '@vue/compiler-sfc'

global.SVGElement = global.window?.SVGElement

let mount
let Vue
let BottomDock
let BountyPanel
let ChatPanel
let CommandPanel
let CoordinationPanel
let HallChatComposer
let HallStage
let LibraryPanel
let PersonaCatalogPanel
let hallGameMock
let classifyViewportResizeMock

const vueImportToVar = (_line, imports) => {
  const vueBindings = imports.split(',').map((part) => {
    const [name, alias] = part.trim().split(/\s+as\s+/)
    return alias ? `${name}: ${alias}` : name
  }).join(', ')

  return vueBindings ? `var { ${vueBindings} } = Vue` : ''
}

const loadSfc = (relativePath) => {
  const filename = new URL(relativePath, import.meta.url).pathname
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const { descriptor } = parse(source, { filename })
  const id = `test-${relativePath.replace(/[^a-z0-9]/gi, '-')}`
  const script = compileScript(descriptor, {
    id,
    inlineTemplate: true,
    templateOptions: {
      compilerOptions: {
        isCustomElement: tag => tag === 'var-icon'
      }
    }
  }).content

  const scriptBody = script
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, vueImportToVar)
    .replace(/^import\s+AgentToken\s+from\s+['"]@\/components\/juyiting\/AgentToken\.vue['"];?\s*$/gm, 'var AgentToken = { template: \'<button class="agent-token" type="button" @click="$emit(\\\'select-agent\\\', agent)"></button>\', props: [\'agent\'] }')
    .replace(/^import\s+\{\s*juyitingGame\s*\}\s+from\s+['"]@\/game\/index\.js['"];?\s*$/gm, 'var juyitingGame = arguments[2]')
    .replace(/^import\s+\{\s*classifyViewportResize\s*\}\s+from\s+['"]@\/game\/camera\/resizePolicy\.js['"];?\s*$/gm, 'var classifyViewportResize = arguments[3]')
    .replace(/^import\s+BountyActionIcon\s+from\s+['"].\/BountyActionIcon\.vue['"];?\s*$/gm, 'var BountyActionIcon = { template: \'<span />\', props: [\'status\'] }')
    .replace(/^import\s+ArchiveReader\s+from\s+['"].\/archive\/ArchiveReader\.vue['"];?\s*$/gm, 'var ArchiveReader = { template: \'<section class="archive-reader-stub">典籍阅读</section>\' }')
    .replace(/^import\s+(\w+)\s+from\s+['"]@\/assets\/juyiting\/[^'"]+['"];?\s*$/gm, 'var $1 = \'/mock-juyiting-asset.png\'')
    .replace(/^import\s+\{\s*hallPhysicalScene,\s*hallRoomPropVisuals\s*\}\s+from\s+['"]@\/constants\/juyiting['"];?\s*$/gm, 'var hallRoomPropVisuals = []; var hallPhysicalScene = { interactiveZones: [{ key: \'main\', panel: \'chat\', title: \'忠义堂公议\', subtitle: \'厅前公议 / 众好汉\', x: 50, y: 36, w: 12, h: 7, object: \'plaque\', hitShape: \'plaque\' }, { key: \'agents\', panel: \'agents\', title: \'点将册\', subtitle: \'点将调遣\', x: 21, y: 32, w: 13, h: 7, object: \'ledger\' }, { key: \'tasks\', panel: \'tasks\', title: \'悬赏榜\', subtitle: \'榜文\', x: 76, y: 47, w: 19, h: 18, object: \'notice-rack\' }, { key: \'catalog\', panel: \'catalog\', title: \'招贤令\', subtitle: \'遍请豪杰\', x: 14, y: 68, w: 12, h: 7, object: \'banner-flag\' }, { key: \'library\', panel: \'library\', title: \'案卷阁\', subtitle: \'查卷问典\', x: 82, y: 76, w: 22, h: 18, object: \'scroll-shelf\' }, { key: \'back\', panel: null, title: \'整装处\', subtitle: \'兵甲行囊\', x: 67, y: 26, w: 12, h: 8, object: \'rear-gear\' }] }')
    .replace(/^import\s+HallChatComposer\s+from\s+['"].\/HallChatComposer\.vue['"];?\s*$/gm, 'var HallChatComposer = arguments[1]')
    .replace(/^import\s+\{\s*marked\s*\}\s+from\s+['"]marked['"];?\s*$/gm, 'var marked = { setOptions: () => {}, parse: value => value }')
    .replace(/^import\s+DOMPurify\s+from\s+['"]dompurify['"];?\s*$/gm, 'var DOMPurify = { sanitize: value => value }')
    .replace('export default', 'return')

  return new Function('Vue', 'HallChatComposer', 'juyitingGame', 'classifyViewportResize', scriptBody)(Vue, HallChatComposer, hallGameMock, classifyViewportResizeMock)
}

const stubs = {
  'var-icon': { template: '<i />' }
}

const makeHallStageProps = (overrides = {}) => ({
  agentKey: agent => agent.agentId,
  agentStyle: () => ({}),
  portraitName: agent => agent.name,
  portraitShortName: agent => agent.name,
  portraitStyle: () => ({}),
  roleClass: () => '',
  statusClass: () => '',
  statusText: () => '',
  tasksTotal: 3,
  visibleAgents: [],
  ...overrides
})

const cssRule = (source, selector) => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))
  return match?.[1] || ''
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

const flushPromises = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Vue.nextTick()
}

describe('JuyiHall component behavior', () => {
  before(async () => {
    global.SVGElement = global.window?.SVGElement
    global.Element = global.window?.Element
    global.Node = global.window?.Node
    ;({ mount } = await import('@vue/test-utils'))
    Vue = await import('vue')
    ;({ classifyViewportResize: classifyViewportResizeMock } = await import('../src/game/camera/resizePolicy.js'))
    hallGameMock = {
      destroy: () => {},
      mount: async (_container, options = {}) => {
        options.onReady?.()
      },
      setSelectedAgent: () => {},
      start: () => {},
      syncAgents: () => {}
    }
    BottomDock = loadSfc('../src/components/juyiting/BottomDock.vue')
    BountyPanel = loadSfc('../src/components/juyiting/BountyPanel.vue')
    HallChatComposer = loadSfc('../src/components/juyiting/HallChatComposer.vue')
    ChatPanel = loadSfc('../src/components/juyiting/ChatPanel.vue')
    CommandPanel = loadSfc('../src/components/juyiting/CommandPanel.vue')
    CoordinationPanel = loadSfc('../src/components/juyiting/CoordinationPanel.vue')
    HallStage = loadSfc('../src/components/juyiting/HallStage.vue')
    LibraryPanel = loadSfc('../src/components/juyiting/LibraryPanel.vue')
    PersonaCatalogPanel = loadSfc('../src/components/juyiting/PersonaCatalogPanel.vue')
  })

  it('classifies panel layouts for desktop, landscape touch, and portrait touch viewports', async () => {
    const { classifyPanelLayout } = await import('../src/composables/juyiting/useHallPanels.js')

    expect(classifyPanelLayout({ isMobileCoarse: false, experienceMode: 'portrait-command' })).to.equal('center-modal')
    expect(classifyPanelLayout({ isMobileCoarse: true, experienceMode: 'landscape-map' })).to.equal('right-drawer')
    expect(classifyPanelLayout({ isMobileCoarse: true, experienceMode: 'portrait-command' })).to.equal('bottom-drawer')
  })

  it('exposes accessible modal dialog wiring and focus lifecycle hooks', () => {
    const source = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')

    expect(source).to.include('role="dialog"')
    expect(source).to.include('aria-modal="true"')
    expect(source).to.include(':aria-labelledby="panelTitleId"')
    expect(source).to.include('aria-label="关闭面板"')
    expect(source).to.include('@keydown="handlePanelKeydown"')
    expect(source).to.include('restorePanelFocus')
  })

  it('focuses and traps a modal panel then restores the prior focus', async () => {
    const { focusHallPanel, restorePanelFocus, trapPanelFocus } = await import('../src/composables/juyiting/useHallPanels.js')
    const prior = document.createElement('button')
    const panel = document.createElement('section')
    const first = document.createElement('button')
    const last = document.createElement('input')
    panel.tabIndex = -1
    panel.append(first, last)
    document.body.append(prior, panel)
    prior.focus()

    try {
      focusHallPanel(panel)
      expect(document.activeElement).to.equal(first)
      last.focus()
      const forward = new global.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      trapPanelFocus(forward, panel)
      expect(document.activeElement).to.equal(first)
      first.focus()
      const backward = new global.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
      trapPanelFocus(backward, panel)
      expect(document.activeElement).to.equal(last)
      restorePanelFocus(prior)
      expect(document.activeElement).to.equal(prior)
    } finally {
      prior.remove()
      panel.remove()
    }
  })

  it('keeps panel layout a pure experience-mode projection', async () => {
    const { useHallPanels } = await import('../src/composables/juyiting/useHallPanels.js')
    const experienceMode = Vue.ref('portrait-command')
    const isMobileCoarse = Vue.ref(true)
    const Harness = {
      setup() {
        const { panelLayout } = useHallPanels({ experienceMode, isMobileCoarse })
        return () => Vue.h('div', { class: panelLayout.value }, panelLayout.value)
      }
    }
    const wrapper = mount(Harness)
    await Vue.nextTick()
    expect(wrapper.classes()).to.include('bottom-drawer')
    experienceMode.value = 'landscape-map'
    await Vue.nextTick()
    expect(wrapper.classes()).to.include('right-drawer')
    wrapper.unmount()
  })

  it('wires the exact responsive panel class and immediate HallStage interaction lock', () => {
    const source = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')

    expect(source).to.include(':interaction-locked="isPanelSessionActive"')
    expect(source).to.include(':class="[`panel-${renderedPanel}`, `layout-${panelLayout}`]"')
    expect(source).to.include('layout-bottom-drawer')
    expect(source).to.include('layout-right-drawer')
    expect(source).to.include('layout-center-modal')
  })

  it('locks and unlocks map interaction immediately for panels and cleans up on unmount', async () => {
    const lockCalls = []
    hallGameMock = {
      destroy: () => {},
      mount: async (_container, options = {}) => options.onReady?.(),
      setInteractionLocked: (...args) => lockCalls.push(args),
      setSelectedAgent: () => {}, start: () => {}, syncAgents: () => {}, syncHotspots: () => {}
    }
    HallStage = loadSfc('../src/components/juyiting/HallStage.vue')
    const wrapper = mount(HallStage, { global: { stubs }, props: makeHallStageProps({ interactionLocked: true }) })
    await flushPromises()
    await wrapper.setProps({ interactionLocked: false })
    wrapper.unmount()

    expect(lockCalls).to.deep.include.members([[true, 'panel'], [false, 'panel']])
    expect(lockCalls.at(-1)).to.deep.equal([false, 'loading'])
  })

  it('classifies visual viewport keyboard resizing without fitting the map transform', async () => {
    const originalVisualViewport = global.window.visualViewport
    const originalInnerWidth = global.window.innerWidth
    const originalInnerHeight = global.window.innerHeight
    const visualListeners = []
    const resizeCalls = []
    let visualHeight = 800
    Object.defineProperty(global.window, 'innerWidth', { configurable: true, value: 500 })
    Object.defineProperty(global.window, 'innerHeight', { configurable: true, value: 800 })
    Object.defineProperty(global.window, 'visualViewport', { configurable: true, value: {
      get height() { return visualHeight },
      addEventListener: (_event, callback) => visualListeners.push(callback),
      removeEventListener: () => {}
    } })
    hallGameMock = {
      destroy: () => {}, mount: async (_container, options = {}) => options.onReady?.(),
      resizeViewport: change => resizeCalls.push(change), setInteractionLocked: () => {},
      setSelectedAgent: () => {}, start: () => {}, syncAgents: () => {}, syncHotspots: () => {}
    }
    HallStage = loadSfc('../src/components/juyiting/HallStage.vue')

    try {
      const wrapper = mount(HallStage, { attachTo: document.body, global: { stubs }, props: makeHallStageProps() })
      await flushPromises()
      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()
      visualHeight = 560
      visualListeners.forEach(listener => listener())
      await flushPromises()

      expect(resizeCalls.at(-1)).to.include({ kind: 'keyboard', width: 500, height: 560 })
      expect(hallGameMock.fitToViewport).to.equal(undefined)
      wrapper.unmount()
      input.remove()
    } finally {
      Object.defineProperty(global.window, 'visualViewport', { configurable: true, value: originalVisualViewport })
      Object.defineProperty(global.window, 'innerWidth', { configurable: true, value: originalInnerWidth })
      Object.defineProperty(global.window, 'innerHeight', { configurable: true, value: originalInnerHeight })
    }
  })

  it('coalesces resize races, keeps keyboard close classified, and deduplicates rotation', async () => {
    const originals = {
      innerWidth: global.window.innerWidth,
      innerHeight: global.window.innerHeight,
      visualViewport: global.window.visualViewport,
      requestAnimationFrame: global.window.requestAnimationFrame,
      cancelAnimationFrame: global.window.cancelAnimationFrame
    }
    const visualListeners = []
    const frames = new Map()
    const resizeCalls = []
    let frameId = 0
    let visualHeight = 800
    Object.defineProperty(global.window, 'innerWidth', { configurable: true, value: 500, writable: true })
    Object.defineProperty(global.window, 'innerHeight', { configurable: true, value: 800, writable: true })
    Object.defineProperty(global.window, 'visualViewport', { configurable: true, value: {
      get height() { return visualHeight },
      addEventListener: (_event, callback) => visualListeners.push(callback),
      removeEventListener: () => {}
    } })
    global.window.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId }
    global.window.cancelAnimationFrame = id => frames.delete(id)
    const flushFrame = () => {
      const pending = [...frames.entries()]
      frames.clear()
      pending.forEach(([, callback]) => callback(0))
    }
    hallGameMock = {
      destroy: () => {}, mount: async (_container, options = {}) => options.onReady?.(),
      resizeViewport: change => resizeCalls.push(change), setInteractionLocked: () => {},
      setSelectedAgent: () => {}, start: () => {}, syncAgents: () => {}, syncHotspots: () => {}
    }
    HallStage = loadSfc('../src/components/juyiting/HallStage.vue')
    let wrapper
    const input = document.createElement('input')
    document.body.appendChild(input)

    try {
      wrapper = mount(HallStage, { attachTo: document.body, global: { stubs }, props: makeHallStageProps() })
      await flushPromises()
      flushFrame()
      resizeCalls.length = 0
      input.focus()
      global.window.innerHeight = 560
      global.window.dispatchEvent(new global.window.Event('resize'))
      expect(resizeCalls).to.have.length(0)
      visualHeight = 560
      visualListeners.forEach(listener => listener())
      flushFrame()
      expect(resizeCalls).to.have.length(1)
      expect(resizeCalls[0].kind).to.equal('keyboard')

      input.blur()
      global.window.innerHeight = 800
      visualHeight = 800
      global.window.dispatchEvent(new global.window.Event('resize'))
      visualListeners.forEach(listener => listener())
      flushFrame()
      expect(resizeCalls.at(-1).kind).to.equal('keyboard')

      resizeCalls.length = 0
      global.window.innerWidth = 800
      global.window.innerHeight = 500
      visualHeight = 500
      global.window.dispatchEvent(new global.window.Event('resize'))
      visualListeners.forEach(listener => listener())
      flushFrame()
      expect(resizeCalls.filter(call => call.kind === 'orientation')).to.have.length(1)
      expect(resizeCalls).to.have.length(1)
    } finally {
      wrapper?.unmount()
      input.remove()
      Object.defineProperty(global.window, 'innerWidth', { configurable: true, value: originals.innerWidth })
      Object.defineProperty(global.window, 'innerHeight', { configurable: true, value: originals.innerHeight })
      Object.defineProperty(global.window, 'visualViewport', { configurable: true, value: originals.visualViewport })
      global.window.requestAnimationFrame = originals.requestAnimationFrame
      global.window.cancelAnimationFrame = originals.cancelAnimationFrame
    }
  })

  it('shows loading, times out at 15 seconds, retries fresh, and ignores stale ready callbacks', async () => {
    const originalSetTimeout = global.window.setTimeout
    const originalClearTimeout = global.window.clearTimeout
    const timers = []
    const readyCallbacks = []
    const lockCalls = []
    let destroyCalls = 0
    let syncCalls = 0
    global.window.setTimeout = (callback, delay) => {
      timers.push({ callback, delay, cleared: false })
      return timers.length
    }
    global.window.clearTimeout = id => { if (timers[id - 1]) timers[id - 1].cleared = true }
    hallGameMock = {
      destroy: () => { destroyCalls += 1 },
      mount: (_container, options = {}) => {
        readyCallbacks.push(options.onReady)
        return readyCallbacks.length === 1 ? new Promise(() => {}) : Promise.resolve()
      },
      setInteractionLocked: (...args) => lockCalls.push(args), setSelectedAgent: () => {}, start: () => {},
      syncAgents: () => { syncCalls += 1 }, syncHotspots: () => {}
    }
    HallStage = loadSfc('../src/components/juyiting/HallStage.vue')

    try {
      const wrapper = mount(HallStage, { global: { stubs }, props: makeHallStageProps() })
      await Vue.nextTick()
      expect(wrapper.text()).to.include('聚义厅地图加载中…')
      expect(timers[0].delay).to.equal(15000)
      expect(lockCalls).to.deep.include([true, 'loading'])

      timers[0].callback()
      await Vue.nextTick()
      expect(wrapper.text()).to.include('地图加载超时，请重试')
      expect(lockCalls).to.deep.include([false, 'loading'])
      expect(destroyCalls).to.equal(1)
      await wrapper.find('.scene-error button').trigger('click')
      await flushPromises()
      expect(destroyCalls).to.equal(1)
      readyCallbacks[1]()
      await flushPromises()
      const syncAfterFreshReady = syncCalls
      readyCallbacks[0]()
      await flushPromises()

      expect(syncCalls).to.equal(syncAfterFreshReady)
      wrapper.unmount()
      expect(destroyCalls).to.equal(2)
      expect(timers.every(timer => timer.cleared || timer.delay !== 15000)).to.equal(true)
    } finally {
      global.window.setTimeout = originalSetTimeout
      global.window.clearTimeout = originalClearTimeout
    }
  })

  it('keeps HallStage loading unless JuyitingGame confirms a built scene and publishes success once', async () => {
    const { JuyitingGame } = await import('../src/game/JuyitingGame.js')
    const makeContractGame = (sceneBuildState) => {
      const game = new JuyitingGame()
      let activeStage = null
      let sceneReadyCallback = null
      let readyCount = 0
      const me = {
        game: { viewport: { width: 960, height: 640 } },
        state: {
          USER: 100,
          PLAY: 0,
          set: (_id, stage) => { activeStage = stage },
          change: () => activeStage?.onResetEvent?.(),
          pause: () => {}
        },
        video: { destroy: () => {} }
      }
      const scene = {
        sceneBuildState,
        onReady: callback => { sceneReadyCallback = callback },
        onResetEvent: () => {
          if (scene.sceneBuildState === 'ready') sceneReadyCallback?.()
        },
        onDestroyEvent: () => {},
        setInteractionLocked: () => {},
        setSelectedAgent: () => {},
        syncAgents: () => {},
        syncHotspots: () => {}
      }
      game.mount = async (_container, options = {}) => {
        const mountToken = ++game._generation
        game._mountToken = mountToken
        game._me = me
        game._hallScene = scene
        game._callbacks = {
          ...options,
          onReady: () => {
            readyCount += 1
            options.onReady?.()
          }
        }
        scene.onReady(() => game._publishReadyIfSceneBuilt(mountToken))
        game._startGame(me, mountToken)
        return { ready: true }
      }
      return { game, readyCount: () => readyCount }
    }

    const failed = makeContractGame('failed')
    hallGameMock = failed.game
    HallStage = loadSfc('../src/components/juyiting/HallStage.vue')
    const failedWrapper = mount(HallStage, { global: { stubs }, props: makeHallStageProps() })
    await new Promise(resolve => setTimeout(resolve, 240))
    await Vue.nextTick()
    expect(failed.readyCount()).to.equal(0)
    expect(failedWrapper.find('.hall-board').classes()).not.to.include('is-melon-ready')
    expect(failedWrapper.find('.scene-loading').exists()).to.equal(true)
    failedWrapper.unmount()

    const succeeded = makeContractGame('ready')
    hallGameMock = succeeded.game
    HallStage = loadSfc('../src/components/juyiting/HallStage.vue')
    const succeededWrapper = mount(HallStage, { global: { stubs }, props: makeHallStageProps() })
    await new Promise(resolve => setTimeout(resolve, 240))
    await Vue.nextTick()
    expect(succeeded.readyCount()).to.equal(1)
    expect(succeededWrapper.find('.hall-board').classes()).to.include('is-melon-ready')
    expect(succeededWrapper.find('.scene-loading').exists()).to.equal(false)
    succeededWrapper.unmount()
  })

  it('keeps timeout terminal when the old mount resolves late and retries one fresh mount', async () => {
    const originalSetTimeout = global.window.setTimeout
    const originalClearTimeout = global.window.clearTimeout
    const timers = []
    const oldMount = deferred()
    const readyCallbacks = []
    const lockCalls = []
    let mountCalls = 0
    let startCalls = 0
    let destroyCalls = 0
    global.window.setTimeout = (callback, delay) => { timers.push({ callback, delay }); return timers.length }
    global.window.clearTimeout = () => {}
    hallGameMock = {
      destroy: () => { destroyCalls += 1 },
      mount: async (_container, options = {}) => {
        mountCalls += 1
        readyCallbacks.push(options.onReady)
        if (mountCalls === 1) await oldMount.promise
      },
      setInteractionLocked: (...args) => lockCalls.push(args), setSelectedAgent: () => {},
      start: () => { startCalls += 1 }, syncAgents: () => {}, syncHotspots: () => {}
    }
    HallStage = loadSfc('../src/components/juyiting/HallStage.vue')
    let wrapper
    try {
      wrapper = mount(HallStage, { global: { stubs }, props: makeHallStageProps() })
      await Vue.nextTick()
      timers.find(timer => timer.delay === 15000).callback()
      await Vue.nextTick()
      expect(destroyCalls).to.equal(1)
      expect(wrapper.emitted('simulation-reset')).to.have.length(1)
      const lockCountAfterTimeout = lockCalls.length
      oldMount.resolve()
      await flushPromises()
      readyCallbacks[0]()
      await flushPromises()
      expect(startCalls).to.equal(0)
      expect(lockCalls).to.have.length(lockCountAfterTimeout)

      await wrapper.find('.scene-error button').trigger('click')
      await flushPromises()
      expect(mountCalls).to.equal(2)
      expect(destroyCalls).to.equal(1)
      expect(wrapper.emitted('simulation-reset')).to.have.length(2)
    } finally {
      wrapper?.unmount()
      global.window.setTimeout = originalSetTimeout
      global.window.clearTimeout = originalClearTimeout
    }
  })

  it('passes rollback mode into the game mount and declares lifecycle reset wiring', async () => {
    let mountOptions
    hallGameMock = {
      destroy: () => {},
      mount: async (_container, options = {}) => {
        mountOptions = options
        options.onReady?.()
      },
      setInteractionLocked: () => {}, setSelectedAgent: () => {},
      start: () => {}, syncAgents: () => {}, syncHotspots: () => {}
    }
    HallStage = loadSfc('../src/components/juyiting/HallStage.vue')
    const wrapper = mount(HallStage, {
      global: { stubs },
      props: makeHallStageProps({ simulationEnabled: false })
    })
    await flushPromises()

    expect(mountOptions.simulationEnabled).to.equal(false)
    expect(readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8'))
      .to.include('@simulation-reset="resetSimulationLifecycle"')
    wrapper.unmount()
  })

  it('restarts a timed-out replacement engine from a fresh authoritative snapshot', async () => {
    const { useHallCommandQueue } = await import('../src/composables/juyiting/useHallCommandQueue.js')
    const { useHallSceneState } = await import('../src/composables/juyiting/useHallSceneState.js')
    const originalSetTimeout = global.window.setTimeout
    const originalClearTimeout = global.window.clearTimeout
    const timers = []
    const engines = [[], []]
    let mountIndex = 0
    const movementRuntime = {
      sceneId: 'juyiting-main', movementSchemaVersion: '1', navGraphVersion: 'graph-v1',
      spriteManifestVersion: 'persona-sheets-v1', width: 400, height: 300,
      regions: [
        { regionId: 'main-seat' },
        { regionId: 'council-table' }
      ],
      nodes: [], edges: [], obstacles: [],
      slots: [{
        stableId: 'home-songjiang', slotId: 'home-songjiang', regionId: 'main-seat',
        point: { x: 20, y: 20 }, personaCode: 'songjiang', kind: 'home'
      }]
    }
    const authoritativeSnapshot = {
      sceneId: 'juyiting-main', sceneVersion: 16,
      states: [{
        agentId: 'agent-songjiang', personaCode: 'songjiang',
        behavior: 'moving_to_discussion', targetRegionId: 'council-table',
        stateVersion: 16, startedAt: 1_000, expectedArrivalAt: 5_000, phase: 'moving'
      }]
    }
    global.window.setTimeout = (callback, delay) => {
      timers.push({ callback, delay })
      return timers.length
    }
    global.window.clearTimeout = () => {}
    hallGameMock = {
      destroy: () => {},
      mount: async () => { mountIndex += 1 },
      getMovementRuntime: () => movementRuntime,
      enqueueMovementCommands: ([command]) => {
        engines[mountIndex - 1].push(command)
        return [{ accepted: true }]
      },
      cancelMovement: () => true,
      setInteractionLocked: () => {}, setSelectedAgent: () => {},
      start: () => {}, syncAgents: () => {}, syncHotspots: () => {}
    }
    HallStage = loadSfc('../src/components/juyiting/HallStage.vue')
    const commandQueue = useHallCommandQueue()
    const sceneState = useHallSceneState({ commandQueue, now: () => 2_000 })
    const Harness = {
      setup() {
        const onSimulationReady = ({ movementRuntime: map, simulation }) => {
          sceneState.setMapRuntime(map)
          commandQueue.setSimulation(simulation)
          sceneState.applySnapshot(authoritativeSnapshot)
        }
        const onSimulationReset = () => {
          commandQueue.setSimulation(null)
          sceneState.reset()
        }
        return () => Vue.h(HallStage, {
          ...makeHallStageProps(),
          onSimulationReady,
          onSimulationReset
        })
      }
    }
    let wrapper
    try {
      wrapper = mount(Harness, { global: { stubs } })
      await flushPromises()
      expect(engines[0]).to.have.length(1)

      timers.find(timer => timer.delay === 15000).callback()
      await Vue.nextTick()
      await wrapper.find('.scene-error button').trigger('click')
      await flushPromises()

      expect(mountIndex).to.equal(2)
      expect(engines[1]).to.have.length(1)
      expect(engines[1][0]).to.include({ agentId: 'agent-songjiang', stateVersion: 16 })
    } finally {
      wrapper?.unmount()
      global.window.setTimeout = originalSetTimeout
      global.window.clearTimeout = originalClearTimeout
    }
  })

  it('blocks stage actions while loading and reapplies the loading lock after mount resolves', async () => {
    const pendingMount = deferred()
    const lockCalls = []
    const zoomCalls = []
    const resetCalls = []
    let readyCallback
    hallGameMock = {
      destroy: () => {},
      mount: async (_container, options = {}) => {
        readyCallback = options.onReady
        await pendingMount.promise
      },
      resetToMainHall: () => resetCalls.push(true),
      setInteractionLocked: (...args) => lockCalls.push(args),
      setSelectedAgent: () => {}, start: () => {}, syncAgents: () => {}, syncHotspots: () => {},
      zoomBy: delta => zoomCalls.push(delta)
    }
    HallStage = loadSfc('../src/components/juyiting/HallStage.vue')
    const wrapper = mount(HallStage, { global: { stubs }, props: makeHallStageProps() })
    const board = wrapper.find('.hall-board')

    await board.trigger('keydown', { key: '+' })
    await board.trigger('keydown', { key: '0' })
    await wrapper.find('.orientation-action').trigger('click')
    expect(zoomCalls).to.deep.equal([])
    expect(resetCalls).to.deep.equal([])

    pendingMount.resolve()
    await flushPromises()
    expect(lockCalls.filter(call => call[0] === true && call[1] === 'loading')).to.have.length(2)

    readyCallback()
    await flushPromises()
    expect(lockCalls.filter(call => call[0] === false && call[1] === 'loading')).to.have.length(1)
    wrapper.unmount()
  })

  it('shows an accessible return-main-hall control away from preset and hides it during a panel lock', async () => {
    let resetCalls = 0
    hallGameMock = {
      destroy: () => {}, mount: async (_container, options = {}) => options.onReady?.(),
      getCameraSnapshot: () => ({ presetKey: 'desktop', transform: { zoom: 1, offsetX: 0, offsetY: 0 } }),
      resetToMainHall: () => { resetCalls += 1 }, setInteractionLocked: () => {},
      setSelectedAgent: () => {}, start: () => {}, syncAgents: () => {}, syncHotspots: () => {}
    }
    HallStage = loadSfc('../src/components/juyiting/HallStage.vue')
    const wrapper = mount(HallStage, { global: { stubs }, props: makeHallStageProps() })
    await flushPromises()
    await wrapper.find('.hall-board').trigger('wheel')
    await Vue.nextTick()

    const button = wrapper.find('.return-main-hall')
    expect(button.attributes('aria-label')).to.equal('回主厅')
    expect(button.attributes('title')).to.equal('回主厅')
    await button.trigger('click')
    expect(resetCalls).to.equal(1)
    await wrapper.setProps({ interactionLocked: true })
    expect(wrapper.find('.return-main-hall').exists()).to.equal(false)
    wrapper.unmount()
  })

  it('uses screen-to-world center math for return visibility at non-unit zoom', async () => {
    const originalInnerWidth = global.window.innerWidth
    const originalInnerHeight = global.window.innerHeight
    Object.defineProperty(global.window, 'innerWidth', { configurable: true, value: 500 })
    Object.defineProperty(global.window, 'innerHeight', { configurable: true, value: 800 })
    const snapshot = {
      presetKey: 'mobilePortrait',
      transform: { zoom: 1.25, offsetX: -727.5, offsetY: 12.5 }
    }
    hallGameMock = {
      destroy: () => {}, mount: async (_container, options = {}) => options.onReady?.(),
      getCameraSnapshot: () => snapshot, setInteractionLocked: () => {}, setSelectedAgent: () => {},
      start: () => {}, syncAgents: () => {}, syncHotspots: () => {}
    }
    HallStage = loadSfc('../src/components/juyiting/HallStage.vue')

    let wrapper
    try {
      wrapper = mount(HallStage, { global: { stubs }, props: makeHallStageProps() })
      await flushPromises()
      expect(wrapper.find('.return-main-hall').exists()).to.equal(false)

      snapshot.transform = { zoom: 1.25, offsetX: -791.25, offsetY: 12.5 }
      await wrapper.find('.hall-board').trigger('wheel')
      await Vue.nextTick()
      expect(wrapper.find('.return-main-hall').exists()).to.equal(true)
    } finally {
      wrapper?.unmount()
      Object.defineProperty(global.window, 'innerWidth', { configurable: true, value: originalInnerWidth })
      Object.defineProperty(global.window, 'innerHeight', { configurable: true, value: originalInnerHeight })
    }
  })

  it('throttles return refresh, polls reset completion, and cancels callbacks on unmount', async () => {
    const originalRaf = global.window.requestAnimationFrame
    const originalCancelRaf = global.window.cancelAnimationFrame
    const frames = new Map()
    let frameId = 0
    let snapshotCalls = 0
    let resetCalls = 0
    let animation = null
    global.window.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId }
    global.window.cancelAnimationFrame = id => frames.delete(id)
    const runNextFrame = () => {
      const entry = frames.entries().next().value
      if (!entry) return null
      frames.delete(entry[0])
      entry[1](0)
      return entry[1]
    }
    hallGameMock = {
      destroy: () => {}, mount: async (_container, options = {}) => options.onReady?.(),
      getCameraSnapshot: () => {
        snapshotCalls += 1
        return { presetKey: 'desktop', animation, transform: { zoom: 1, offsetX: 0, offsetY: 0 } }
      },
      resetToMainHall: () => { resetCalls += 1; animation = { startedAt: 0, durationMs: 200 } },
      setInteractionLocked: () => {}, setSelectedAgent: () => {}, start: () => {}, syncAgents: () => {}, syncHotspots: () => {}
    }
    HallStage = loadSfc('../src/components/juyiting/HallStage.vue')
    let wrapper
    try {
      wrapper = mount(HallStage, { global: { stubs }, props: makeHallStageProps() })
      await flushPromises()
      while (frames.size) runNextFrame()
      const baseline = snapshotCalls
      await wrapper.find('.hall-board').trigger('wheel')
      await wrapper.find('.hall-board').trigger('wheel')
      expect(frames.size).to.equal(1)
      runNextFrame()
      expect(snapshotCalls).to.equal(baseline + 1)

      await wrapper.find('.return-main-hall').trigger('click')
      expect(resetCalls).to.equal(1)
      runNextFrame()
      expect(frames.size).to.equal(1)
      animation = null
      const staleCallback = runNextFrame()
      expect(frames.size).to.equal(0)
      const beforeUnmount = snapshotCalls
      wrapper.unmount()
      wrapper = null
      staleCallback?.(0)
      expect(snapshotCalls).to.equal(beforeUnmount)
    } finally {
      wrapper?.unmount()
      global.window.requestAnimationFrame = originalRaf
      global.window.cancelAnimationFrame = originalCancelRaf
    }
  })

  it('renders the hall scene body as a melonJS canvas shell without DOM room or agent layers', () => {
    const wrapper = mount(HallStage, {
      global: { stubs },
      props: makeHallStageProps()
    })
    const stageSource = readFileSync(new URL('../src/components/juyiting/HallStage.vue', import.meta.url), 'utf8')
    const board = wrapper.find('.hall-board')

    expect(wrapper.find('.melon-layer').exists()).to.equal(true)
    expect(board.attributes('aria-label')).to.equal('聚义厅 melonJS 场景，可使用加减号缩放，0 复位')
    expect(board.attributes('tabindex')).to.equal('0')
    expect(wrapper.find('.map-world').exists()).to.equal(false)
    expect(wrapper.find('.hall-room').exists()).to.equal(false)
    expect(wrapper.find('.room-prop-layer').exists()).to.equal(false)
    expect(wrapper.find('.agent-token').exists()).to.equal(false)
    expect(stageSource).not.to.include('hallBoardRef')
  })

  it('forwards keyboard zoom controls to the melonJS game layer', async () => {
    const zoomCalls = []
    const resetCalls = []
    hallGameMock = {
      destroy: () => {},
      mount: async (_container, options = {}) => {
        options.onReady?.()
      },
      resetToMainHall: () => resetCalls.push(true),
      setSelectedAgent: () => {},
      start: () => {},
      syncAgents: () => {},
      syncHotspots: () => {},
      zoomBy: delta => zoomCalls.push(delta)
    }
    HallStage = loadSfc('../src/components/juyiting/HallStage.vue')
    const wrapper = mount(HallStage, {
      global: { stubs },
      props: makeHallStageProps()
    })
    const board = wrapper.find('.hall-board')

    await board.trigger('keydown', { key: '+' })
    await board.trigger('keydown', { key: '-' })
    await board.trigger('keydown', { key: '0' })

    expect(zoomCalls).to.deep.equal([0.12, -0.12])
    expect(resetCalls).to.have.length(1)
  })

  it('leaves mobile touch drag and pinch gestures to the melonJS scene layer', async () => {
    const panCalls = []
    const zoomCalls = []
    hallGameMock = {
      destroy: () => {},
      mount: async (_container, options = {}) => {
        options.onReady?.()
      },
      panBy: (dx, dy) => panCalls.push([dx, dy]),
      resetTransform: () => {},
      setSelectedAgent: () => {},
      start: () => {},
      syncAgents: () => {},
      syncHotspots: () => {},
      zoomBy: delta => zoomCalls.push(delta)
    }
    HallStage = loadSfc('../src/components/juyiting/HallStage.vue')
    const wrapper = mount(HallStage, {
      global: { stubs },
      props: makeHallStageProps()
    })
    const board = wrapper.find('.hall-board')

    expect(board.attributes()).not.to.have.property('ontouchstart')
    await board.trigger('touchmove', {
      touches: [{ clientX: 128, clientY: 116 }],
      preventDefault: () => {}
    })

    expect(panCalls).to.deep.equal([])
    expect(zoomCalls).to.deep.equal([])
  })

  it('renders HallStage from the supplied experience mode and delegates orientation requests', async () => {
    hallGameMock = {
      destroy: () => {}, mount: async (_container, options = {}) => options.onReady?.(),
      setSelectedAgent: () => {}, start: () => {}, syncAgents: () => {}, syncHotspots: () => {}
    }
    HallStage = loadSfc('../src/components/juyiting/HallStage.vue')
    const wrapper = mount(HallStage, {
      global: { stubs },
      props: makeHallStageProps({
        experienceMode: 'portrait-command',
        orientationHint: '请旋转手机横屏查看'
      })
    })
    await flushPromises()

    expect(wrapper.find('.hall-board').classes()).to.include('is-scene-portrait')
    expect(wrapper.find('.orientation-hint').text()).to.equal('请旋转手机横屏查看')
    await wrapper.find('.orientation-action').trigger('click')
    expect(wrapper.emitted('request-landscape')).to.have.length(1)

    await wrapper.setProps({ experienceMode: 'landscape-map', orientationHint: '' })
    expect(wrapper.find('.hall-board').classes()).to.include('is-scene-landscape')
    expect(wrapper.find('.orientation-action').attributes('disabled')).to.not.equal(undefined)
    wrapper.unmount()
  })

  it('uses supported Varlet icons for the orientation toggle', () => {
    const source = readFileSync(new URL('../src/components/juyiting/HallStage.vue', import.meta.url), 'utf8')

    expect(source).not.to.include('crop-landscape')
    expect(source).not.to.include("sceneMode === 'landscape' ? 'phone'")
    expect(source).to.include('class="orientation-glyph"')
    expect(source).to.include("'is-glyph-portrait': sceneMode === 'landscape'")
    expect(source).to.include("'is-glyph-landscape': sceneMode !== 'landscape'")
  })

  it('keeps the orientation glyph visible when mobile tool labels are hidden', () => {
    const source = readFileSync(new URL('../src/components/juyiting/HallStage.vue', import.meta.url), 'utf8')

    expect(source).to.include('class="tool-label"')
    expect(source).to.include('.tool-action .tool-label')
    expect(source).not.to.include('.tool-action span {\n    display: none;')
  })

  it('keeps the floating stage header compact so it does not cover the hall map', () => {
    const source = readFileSync(new URL('../src/components/juyiting/HallStage.vue', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    const headerRule = cssRule(source, '.stage-header')

    expect(headerRule).to.include('right: auto;')
    expect(headerRule).to.include('width: fit-content;')
    expect(headerRule).to.include('max-width: min(420px, calc(100% - 36px));')
    expect(headerRule).to.include('background: rgba(35, 24, 16, 0.38)')
    expect(source).to.include('@media (max-width: 640px)')
    expect(source).to.include('max-width: calc(100% - 16px);')
    expect(source).to.include('.stage-heading .eyebrow {\n    display: none;')
    expect(source).not.to.include('.hall-stage.is-virtual-landscape {')
    expect(source).not.to.include('transform: rotate(90deg) translateY(-100%);')
    expect(source).to.include('.hall-stage:has(.hall-board.is-scene-landscape) .stage-header {\n  top: 4px;')
    expect(source).to.include('.hall-stage:has(.hall-board.is-scene-landscape) .stage-heading .eyebrow {\n  display: none;')
    expect(source).to.include('.hall-stage:has(.hall-board.is-scene-landscape) .tool-action .tool-label {\n  display: none;')
  })

  it('renders the recruit entry and persona catalog actions', async () => {
    const personas = [
      { personaCode: 'songjiang', name: '宋江', title: '及时雨', rankNo: 1, starName: '天魁星', systemAgent: true, abilities: ['dispatch'] },
      { personaCode: 'wuyong', name: '吴用', title: '智多星', rankNo: 3, starName: '天机星', canBind: true, abilities: ['planning'] },
      { personaCode: 'linchong', name: '林冲', title: '豹子头', rankNo: 6, starName: '天雄星', boundToMe: true, abilities: ['battle'] }
    ]
    const catalog = mount(PersonaCatalogPanel, {
      global: { stubs },
      props: {
        personas,
        portraitName: persona => `${persona.name}·${persona.title}`,
        portraitStyle: () => ({})
      }
    })

    expect(catalog.text()).to.include('3 位待请豪杰')
    expect(catalog.text()).to.include('宋江')
    expect(catalog.text()).to.include('头领')
    expect(catalog.text()).to.include('吴用')
    expect(catalog.text()).to.include('请上梁山')
    expect(catalog.text()).to.include('林冲')
    expect(catalog.text()).to.include('除名下山')

    await catalog.find('.catalog-action.primary').trigger('click')
    expect(catalog.text()).to.include('择个接应去处')
    expect(catalog.text()).to.include('山寨安顿')
    expect(catalog.text()).to.include('自家接应')

    await catalog.find('.catalog-action.primary').trigger('click')
    expect(catalog.emitted('bind-persona')[0]).to.deep.equal([personas[1], 'server'])
  })

  it('keeps hotspot labels in scene constants instead of the HallStage DOM', () => {
    const source = readFileSync(new URL('../src/constants/juyiting.js', import.meta.url), 'utf8')
    const sceneSource = readFileSync(new URL('../src/constants/juyitingScene.js', import.meta.url), 'utf8')
    const stageSource = readFileSync(new URL('../src/components/juyiting/HallStage.vue', import.meta.url), 'utf8')

    for (const label of ['忠义堂公议', '点将册', '悬赏榜', '招贤令', '案卷阁', '整装处']) {
      expect(source).to.include(`title: '${label}'`)
    }

    for (const oldLabel of ['榜文房', '招贤馆', '藏书阁']) {
      expect(source).not.to.include(`title: '${oldLabel}'`)
      expect(sceneSource).not.to.include(`label: '${oldLabel}'`)
    }

    for (const label of ['忠义堂公议', '点将册', '悬赏榜', '招贤令', '案卷阁', '整装处']) {
      expect(stageSource).not.to.include(label)
    }
    expect(stageSource).not.to.include('object-visual')
  })

  it('does not import DOM scene assets or AgentToken in HallStage', () => {
    const stageSource = readFileSync(new URL('../src/components/juyiting/HallStage.vue', import.meta.url), 'utf8')

    expect(stageSource).not.to.include('AgentToken')
    expect(stageSource).not.to.include('@/assets/juyiting/')
    expect(stageSource).not.to.include('hallPhysicalScene')
    expect(stageSource).not.to.include('hallRoomPropVisuals')
  })

  it('syncs scene agents to the melonJS game layer when ready', async () => {
    const syncedAgents = []
    const syncedHotspots = []
    const selectedAgentIds = []
    hallGameMock = {
      destroy: () => {},
      mount: async (_container, options = {}) => {
        options.onReady?.()
      },
      setSelectedAgent: agentId => selectedAgentIds.push(agentId),
      start: () => {},
      syncAgents: agents => syncedAgents.push(agents),
      syncHotspots: hotspots => syncedHotspots.push(hotspots)
    }
    HallStage = loadSfc('../src/components/juyiting/HallStage.vue')
    const sceneAgents = [
      { agentId: 'songjiang', name: '宋江', x: 50, y: 45 },
      { agentId: 'linchong', name: '林冲', x: 34, y: 63 }
    ]
    const sceneHotspots = [
      { id: 'bountyBoard', state: 'active', feedbackText: '荐单已出' }
    ]

    const wrapper = mount(HallStage, {
      global: { stubs },
      props: makeHallStageProps({
        sceneAgents,
        sceneHotspots,
        visibleAgents: []
      })
    })
    await Vue.nextTick()

    expect(syncedAgents).to.deep.include(sceneAgents)
    expect(syncedHotspots).to.deep.include(sceneHotspots)
    expect(wrapper.find('.hall-board').classes()).to.include('is-melon-ready')
    expect(wrapper.find('.map-world').exists()).to.equal(false)

    const updatedAgents = [{ agentId: 'wuyong', name: '吴用', x: 42, y: 52 }]
    const updatedHotspots = [{ id: 'catalog', state: 'active' }]
    const selectedAgent = { agentId: 'wuyong', name: '吴用' }
    await wrapper.setProps({
      sceneAgents: updatedAgents,
      sceneHotspots: updatedHotspots,
      selectedAgent
    })
    await Vue.nextTick()

    expect(syncedAgents).to.deep.include(updatedAgents)
    expect(syncedHotspots).to.deep.include(updatedHotspots)
    expect(selectedAgentIds).to.deep.include('wuyong')
  })

  it('keeps the melonJS layer filling the hall board without leaving unused page space', () => {
    const source = readFileSync(new URL('../src/components/juyiting/HallStage.vue', import.meta.url), 'utf8')
    const boardRule = cssRule(source, '.hall-board')
    const melonRule = cssRule(source, '.melon-layer')

    expect(boardRule).not.to.include('aspect-ratio: 1672 / 941')
    expect(boardRule).to.include('flex: 1 1 auto')
    expect(boardRule).to.include('width: 100%')
    expect(melonRule).to.include('inset: 0')
    expect(melonRule).to.include('width: 100%')
    expect(melonRule).to.include('height: 100%')
    expect(melonRule).not.to.include('transform')
    expect(cssRule(source, '.melon-layer :deep(canvas)')).to.include('display: block')
    expect(source).not.to.include('--map-offset-x')
    expect(source).not.to.include('--map-zoom')
  })

  it('wires melonJS agent clicks back to Vue selection', async () => {
    let clickHandler
    hallGameMock = {
      destroy: () => {},
      mount: async (_container, options = {}) => {
        clickHandler = options.onAgentClick
        options.onReady?.()
      },
      setSelectedAgent: () => {},
      start: () => {},
      syncAgents: () => {},
      syncHotspots: () => {}
    }
    HallStage = loadSfc('../src/components/juyiting/HallStage.vue')
    const sceneAgents = [{ agentId: 'linchong', name: '林冲', x: 34, y: 63 }]
    const wrapper = mount(HallStage, {
      global: { stubs },
      props: makeHallStageProps({
        sceneAgents,
        visibleAgents: []
      })
    })

    clickHandler({ agentId: 'linchong' })

    expect(wrapper.emitted('select-agent')[0]).to.deep.equal([sceneAgents[0]])
  })

  it('wires melonJS hotspot clicks back to Vue panel routing', async () => {
    let hotspotHandler
    hallGameMock = {
      destroy: () => {},
      mount: async (_container, options = {}) => {
        hotspotHandler = options.onHotspotClick
        options.onReady?.()
      },
      setSelectedAgent: () => {},
      start: () => {},
      syncAgents: () => {},
      syncHotspots: () => {}
    }
    HallStage = loadSfc('../src/components/juyiting/HallStage.vue')
    const wrapper = mount(HallStage, {
      global: { stubs },
      props: makeHallStageProps()
    })

    hotspotHandler({ panel: 'tasks' })

    expect(wrapper.emitted('open-panel')[0]).to.deep.equal(['tasks'])
  })

  it('does not expose ground-click movement controls from the melonJS layer', async () => {
    let mountOptions
    hallGameMock = {
      destroy: () => {},
      mount: async (_container, options = {}) => {
        mountOptions = options
        options.onReady?.()
      },
      setSelectedAgent: () => {},
      start: () => {},
      syncAgents: () => {},
      syncHotspots: () => {}
    }
    HallStage = loadSfc('../src/components/juyiting/HallStage.vue')
    const wrapper = mount(HallStage, {
      global: { stubs },
      props: makeHallStageProps()
    })

    expect(mountOptions).not.to.have.property('onWalkRequest')
    expect(wrapper.emitted('move-agent')).to.equal(undefined)
  })

  it('shows a scene error and retries melonJS mounting without restoring DOM rooms', async () => {
    let mountCalls = 0
    let destroyCalls = 0
    const originalWarn = console.warn
    console.warn = () => {}
    hallGameMock = {
      destroy: () => {
        destroyCalls += 1
      },
      mount: async (_container, options = {}) => {
        mountCalls += 1
        if (mountCalls === 1) throw new Error('boom')
        options.onReady?.()
      },
      setSelectedAgent: () => {},
      start: () => {},
      syncAgents: () => {},
      syncHotspots: () => {}
    }
    HallStage = loadSfc('../src/components/juyiting/HallStage.vue')

    try {
      const wrapper = mount(HallStage, {
        global: { stubs },
        props: makeHallStageProps()
      })

      await Promise.resolve()
      await Vue.nextTick()

      expect(wrapper.find('.scene-error').text()).to.include('聚义厅场景暂不可用')
      expect(wrapper.find('.map-world').exists()).to.equal(false)
      expect(wrapper.find('.hall-room').exists()).to.equal(false)

      await wrapper.find('.scene-error button').trigger('click')
      await flushPromises()

      expect(destroyCalls).to.equal(1)
      expect(mountCalls).to.equal(2)
      expect(wrapper.find('.hall-board').classes()).to.include('is-melon-ready')
      expect(wrapper.find('.scene-error').exists()).to.equal(false)
    } finally {
      console.warn = originalWarn
    }
  })

  it('prevents overlapping melonJS retry mounts while retry is pending', async () => {
    let mountCalls = 0
    let destroyCalls = 0
    const pendingRetry = deferred()
    const originalWarn = console.warn
    console.warn = () => {}
    hallGameMock = {
      destroy: () => {
        destroyCalls += 1
      },
      mount: async (_container, options = {}) => {
        mountCalls += 1
        if (mountCalls === 1) throw new Error('boom')
        await pendingRetry.promise
        options.onReady?.()
      },
      setSelectedAgent: () => {},
      start: () => {},
      syncAgents: () => {},
      syncHotspots: () => {}
    }
    HallStage = loadSfc('../src/components/juyiting/HallStage.vue')

    try {
      const wrapper = mount(HallStage, {
        global: { stubs },
        props: makeHallStageProps()
      })
      await flushPromises()

      const retryButton = wrapper.find('.scene-error button')
      await retryButton.trigger('click')
      await Vue.nextTick()

      expect(wrapper.find('.scene-loading').exists()).to.equal(true)

      expect(destroyCalls).to.equal(1)
      expect(mountCalls).to.equal(2)

      pendingRetry.resolve()
      await flushPromises()

      expect(wrapper.find('.hall-board').classes()).to.include('is-melon-ready')
      expect(wrapper.find('.scene-error').exists()).to.equal(false)
    } finally {
      console.warn = originalWarn
    }
  })

  it('ignores stale melonJS ready callbacks after HallStage unmounts', async () => {
    let readyHandler
    let syncedAgents = 0
    hallGameMock = {
      destroy: () => {},
      mount: async (_container, options = {}) => {
        readyHandler = options.onReady
      },
      setSelectedAgent: () => {},
      start: () => {},
      syncAgents: () => {
        syncedAgents += 1
      },
      syncHotspots: () => {}
    }
    HallStage = loadSfc('../src/components/juyiting/HallStage.vue')
    const wrapper = mount(HallStage, {
      global: { stubs },
      props: makeHallStageProps({
        sceneAgents: [{ agentId: 'songjiang', name: '宋江', x: 50, y: 45 }]
      })
    })

    await flushPromises()
    wrapper.unmount()
    readyHandler()

    expect(syncedAgents).to.equal(0)
  })

  it('opens panels and clears locked contexts from BottomDock', async () => {
    const wrapper = mount(BottomDock, {
      global: { stubs },
      props: {
        activePanel: 'tasks',
        agentsTotal: 18,
        tasksTotal: 5,
        selectedAgent: { agentId: 'agent-wuyong', name: 'Wu Yong' },
        selectedTask: { id: 'task-1', title: 'Inspect the camp' },
        agentLabel: 'Strategist / Wu Yong'
      }
    })

    const buttons = wrapper.findAll('button')
    await buttons[0].trigger('click')
    await buttons[6].trigger('click')
    await buttons[7].trigger('click')

    expect(wrapper.emitted('open-panel')[0]).to.deep.equal(['command'])
    expect(wrapper.emitted('clear-agent')).to.have.length(1)
    expect(wrapper.emitted('clear-task')).to.have.length(1)
    expect(wrapper.text()).to.include('Strategist / Wu Yong')
    expect(wrapper.text()).to.include('Inspect the camp')
  })

  it('emits explicit recommendation actions from BountyPanel', async () => {
    const selectedTask = {
      id: 'task-1',
      title: 'Inspect the camp',
      status: 'open',
      description: 'Inspect every outpost',
      requiredAbilities: ['planning']
    }
    const agent = {
      agentId: 'agent-wuyong',
      name: 'Wu Yong',
      status: 'online',
      abilities: ['planning']
    }
    const wrapper = mount(BountyPanel, {
      global: { stubs },
      props: {
        tasks: [selectedTask],
        selectedTask,
        selectedAgent: null,
        recommendedAgents: [agent],
        taskAbilityOptions: ['planning'],
        taskStatusFilters: [],
        abilityText: item => (item.abilities || []).join(' / '),
        canAssign: (task, targetAgent) => Boolean(task && targetAgent),
        formatTime: value => value,
        portraitName: item => item.name,
        portraitStyle: () => ({}),
        taskAgentMatchScore: () => 98,
        taskStateClass: () => 'is-open',
        taskStatusCount: () => 1,
        taskStatusText: status => status
      }
    })

    await wrapper.find('.task-card').trigger('click')

    expect(wrapper.text()).to.include('议事')
    expect(wrapper.text()).to.include('榜文议事')
    expect(wrapper.text()).not.to.include('单独议事')
    expect(wrapper.text()).not.to.include('传令议事')

    const actionButtons = wrapper.findAll('.recommended-agent-actions button')
    await actionButtons[0].trigger('click')
    await actionButtons[1].trigger('click')
    await actionButtons[2].trigger('click')
    await wrapper.find('.auto-assign-task').trigger('click')

    expect(wrapper.emitted('select-agent')[0]).to.deep.equal([agent])
    expect(wrapper.emitted('assign-task')[0]).to.deep.equal([selectedTask, agent])
    expect(wrapper.emitted('brief-selected-task')[0]).to.deep.equal([selectedTask, agent])
    expect(wrapper.emitted('auto-assign-task')[0]).to.deep.equal([selectedTask])
  })

  it('does not reopen BountyPanel detail modal from a stale selected task', async () => {
    const selectedTask = {
      id: 'task-1',
      title: 'Inspect the camp',
      status: 'open',
      description: 'Inspect every outpost',
      requiredAbilities: ['planning']
    }
    const wrapper = mount(BountyPanel, {
      global: { stubs },
      props: {
        tasks: [selectedTask],
        selectedTask,
        selectedAgent: null,
        recommendedAgents: [],
        taskAbilityOptions: ['planning'],
        taskStatusFilters: [],
        abilityText: item => (item.abilities || []).join(' / '),
        canAssign: (task, targetAgent) => Boolean(task && targetAgent),
        formatTime: value => value,
        portraitName: item => item.name,
        portraitStyle: () => ({}),
        taskAgentMatchScore: () => 98,
        taskStateClass: () => 'is-open',
        taskStatusCount: () => 1,
        taskStatusText: status => status
      }
    })

    expect(wrapper.find('.bounty-modal-overlay').exists()).to.equal(false)

    await wrapper.find('.task-card').trigger('click')

    expect(wrapper.find('.bounty-modal-overlay').exists()).to.equal(true)
    expect(wrapper.emitted('select-task')[0]).to.deep.equal([selectedTask])
  })

  it('emits create, multi-assign, discussion and archive actions from BountyPanel', async () => {
    const selectedTask = {
      id: 'task-1',
      title: 'Inspect the camp',
      status: 'assigned',
      description: 'Inspect every outpost',
      assignedAgentIds: ['agent-wuyong']
    }
    const agents = [
      { agentId: 'agent-wuyong', name: 'Wu Yong', status: 'online', abilities: ['planning'] },
      { agentId: 'agent-linchong', name: 'Lin Chong', status: 'online', abilities: ['execute'] }
    ]
    const wrapper = mount(BountyPanel, {
      global: { stubs },
      props: {
        tasks: [selectedTask],
        selectedTask,
        selectedAgent: null,
        recommendedAgents: agents,
        taskAbilityOptions: ['planning'],
        taskStatusFilters: [],
        abilityText: item => (item.abilities || []).join(' / '),
        canAssign: () => true,
        formatTime: value => value,
        portraitName: item => item.name,
        portraitStyle: () => ({}),
        taskAgentMatchScore: () => 98,
        taskStateClass: () => 'is-open',
        taskStatusCount: () => 1,
        taskStatusText: status => status
      }
    })

    await wrapper.find('.new-task-button').trigger('click')
    await wrapper.find('input[name="taskTitle"]').setValue('Review reports')
    await wrapper.find('textarea[name="taskDescription"]').setValue('Summarize reports')
    await wrapper.find('.task-create-form').trigger('submit')
    await wrapper.find('.task-card').trigger('click')
    await wrapper.findAll('.assignee-check')[0].setChecked(true)
    await wrapper.findAll('.assignee-check')[1].setChecked(true)
    await wrapper.find('.assign-selected-agents').trigger('click')
    await wrapper.find('.discuss-task-button').trigger('click')
    await wrapper.find('.archive-task-button').trigger('click')

    expect(wrapper.emitted('create-task')[0][0]).to.include({
      title: 'Review reports',
      description: 'Summarize reports'
    })
    expect(wrapper.emitted('assign-task')[0]).to.deep.equal([selectedTask, agents])
    expect(wrapper.emitted('discuss-task')[0]).to.deep.equal([selectedTask])
    expect(wrapper.emitted('archive-task')[0]).to.deep.equal([selectedTask])
  })

  it('keeps discussion disabled for unassigned bounty tasks with a readable hint', async () => {
    const selectedTask = {
      id: 'task-1',
      title: 'Inspect the camp',
      status: 'open',
      description: 'Inspect every outpost',
      assignedAgentIds: []
    }
    const wrapper = mount(BountyPanel, {
      global: { stubs },
      props: {
        tasks: [selectedTask],
        selectedTask,
        selectedAgent: null,
        recommendedAgents: [],
        taskAbilityOptions: ['planning'],
        taskStatusFilters: [],
        abilityText: item => (item.abilities || []).join(' / '),
        canAssign: () => false,
        formatTime: value => value,
        portraitName: item => item.name,
        portraitStyle: () => ({}),
        taskAgentMatchScore: () => 98,
        taskStateClass: () => 'is-open',
        taskStatusCount: () => 1,
        taskStatusText: status => status
      }
    })

    await wrapper.find('.task-card').trigger('click')

    const discussButton = wrapper.find('.discuss-task-button')
    await discussButton.trigger('click')

    expect(discussButton.attributes('disabled')).to.not.equal(undefined)
    expect(wrapper.text()).to.include('此榜文尚未点将，暂不可开议')
    expect(wrapper.emitted('discuss-task')).to.equal(undefined)
  })

  it('keeps persistent command templates out of ChatPanel', async () => {
    const wrapper = mount(ChatPanel, {
      global: { stubs },
      props: {
        agents: [],
        draft: '',
        messages: [],
        mentionLabel: agent => agent.name,
        senderText: message => message.sender,
        selectedTask: { id: 'task-1', title: 'Inspect the camp' },
        targetText: 'Strategist / Wu Yong',
        connectionStatus: 'Synced'
      }
    })

    expect(wrapper.find('.command-templates').exists()).to.equal(false)
    expect(wrapper.text()).to.include('Inspect the camp')
    expect(wrapper.emitted('apply-template')).to.equal(undefined)
    expect(wrapper.emitted('send-message')).to.equal(undefined)
  })

  it('integrates mentions and clearing into the ChatPanel composer', async () => {
    const agents = [
      { agentId: 'wuyong', name: 'Wu Yong' },
      { agentId: 'linchong', name: 'Lin Chong' }
    ]
    const wrapper = mount(ChatPanel, {
      global: { stubs },
      props: {
        agents,
        draft: '',
        messages: [],
        mentionLabel: agent => agent.name,
        senderText: message => message.sender,
        targetText: 'All agents',
        connectionStatus: 'Synced'
      }
    })

    expect(wrapper.find('.discussion-target-controls').exists()).to.equal(false)
    expect(wrapper.find('.compact-mention-strip').exists()).to.equal(false)
    expect(wrapper.find('.hall-chat-composer').exists(), 'composer mounted').to.equal(true)

    await wrapper.find('.composer-textarea').trigger('focus')
    await wrapper.find('.composer-textarea').setValue('@')
    await wrapper.setProps({ draft: '@' })
    expect(wrapper.find('.composer-mention-menu').exists(), 'mention menu opens after @').to.equal(true)

    await wrapper.findAll('.composer-mention-option')[0].trigger('click')
    expect(wrapper.emitted('mention-agent')[0]).to.deep.equal([agents[1]])

    const clearWrapper = mount(ChatPanel, {
      global: { stubs },
      props: {
        agents,
        draft: '@Lin Chong ready',
        messages: [],
        mentionLabel: agent => agent.name,
        senderText: message => message.sender,
        targetText: 'All agents',
        connectionStatus: 'Synced'
      }
    })

    expect(clearWrapper.find('.composer-clear').exists(), 'clear button appears with draft').to.equal(true)
    await clearWrapper.find('.composer-clear').trigger('click')
    expect(clearWrapper.emitted('update:draft').at(-1)).to.deep.equal([''])
  })

  it('renders variant-specific target chips in ChatPanel composer', () => {
    const agents = [
      { agentId: 'wuyong', name: 'Wu Yong' },
      { agentId: 'linchong', name: 'Lin Chong' }
    ]
    const bountyWrapper = mount(ChatPanel, {
      global: { stubs },
      props: {
        agents,
        draft: '',
        discussionVariant: 'bounty',
        messages: [],
        mentionLabel: agent => agent.name,
        senderText: message => message.sender,
        targetText: 'Inspect camp / 2 participants',
        connectionStatus: 'Synced'
      }
    })
    const privateWrapper = mount(ChatPanel, {
      global: { stubs },
      props: {
        agents,
        draft: '',
        discussionVariant: 'private',
        messages: [],
        mentionLabel: agent => agent.name,
        selectedAgent: agents[0],
        senderText: message => message.sender,
        targetText: 'Wu Yong',
        connectionStatus: 'Synced'
      }
    })

    expect(bountyWrapper.find('.composer-context.is-bounty').exists()).to.equal(true)
    expect(bountyWrapper.findAll('.composer-target-chip')).to.have.length(2)
    const publicWrapper = mount(ChatPanel, {
      global: { stubs },
      props: {
        agents,
        draft: '',
        discussionVariant: 'public',
        messages: [],
        mentionLabel: agent => agent.name,
        selectedAgent: { agentId: 'other-user-agent', name: 'Other User Agent' },
        senderText: message => message.sender,
        targetText: 'All agents',
        connectionStatus: 'Synced'
      }
    })

    expect(privateWrapper.find('.composer-context.is-private').exists()).to.equal(true)
    expect(privateWrapper.find('.composer-target-chip.is-locked').exists()).to.equal(true)
    expect(privateWrapper.find('.composer-target-remove').exists()).to.equal(false)
    expect(publicWrapper.find('.composer-target-chip').exists()).to.equal(false)
  })

  it('does not expose a cross-scope mode switch inside the shared ChatPanel', () => {
    const wrapper = mount(ChatPanel, {
      global: { stubs },
      props: {
        agents: [],
        draft: '',
        messages: [],
        mentionLabel: agent => agent.name,
        senderText: message => message.sender,
        targetText: 'All agents',
        connectionStatus: 'Synced'
      }
    })

    expect(wrapper.find('.mode-switch').exists()).to.equal(false)
    expect(wrapper.find('.mode-icon-button').exists()).to.equal(false)
    expect(wrapper.text()).not.to.include('公开会谈')
    expect(wrapper.text()).not.to.include('私聊')
  })

  it('keeps ChatPanel composer as a dedicated bottom region', () => {
    const wrapper = mount(ChatPanel, {
      global: { stubs },
      props: {
        agents: [],
        draft: '',
        messages: [],
        mentionLabel: agent => agent.name,
        senderText: message => message.sender,
        targetText: 'All agents',
        connectionStatus: 'Synced'
      }
    })

    expect(wrapper.find('.chat-composer').exists()).to.equal(true)
    expect(wrapper.find('.hall-messages').exists()).to.equal(true)
  })

  it('keeps low-value SongJiang and coordination actions out of ChatPanel', async () => {
    const agents = [
      { agentId: 'wuyong', name: '吴用' },
      { agentId: 'linchong', name: '林冲' }
    ]
    const wrapper = mount(ChatPanel, {
      global: { stubs },
      props: {
        agents,
        draft: '',
        messages: [],
        mentionLabel: agent => agent.name,
        senderText: message => message.sender,
        selectedTask: { id: 'task-1', title: 'Inspect the camp' },
        targetText: '众好汉',
        connectionStatus: 'Synced'
      }
    })

    expect(wrapper.find('.command-templates').exists()).to.equal(false)
    expect(wrapper.emitted('apply-template')).to.equal(undefined)
    expect(wrapper.find('.chief-templates').exists()).to.equal(false)
    expect(wrapper.find('.coordination-inline').exists()).to.equal(false)
    expect(wrapper.text()).not.to.include('宋江号令')
    expect(wrapper.text()).not.to.include('往来传话')
    expect(wrapper.text()).not.to.include('结伴办事')
    expect(wrapper.emitted('relay-message')).to.equal(undefined)
    expect(wrapper.emitted('coordinate-work')).to.equal(undefined)
  })

  it('shows a readable recovery status while chat event stream reconnects', () => {
    const wrapper = mount(ChatPanel, {
      global: { stubs },
      props: {
        agents: [],
        draft: '',
        eventStreamRecovering: true,
        messages: [],
        mentionLabel: agent => agent.name,
        senderText: message => message.sender,
        targetText: '众好汉'
      }
    })

    expect(wrapper.text()).to.include('正在续上传令')
  })

  it('emits SongJiang management commands from CommandPanel', async () => {
    const wrapper = mount(CommandPanel, {
      global: { stubs },
      props: {
        agentsTotal: 10,
        chiefAgent: { agentId: 'songjiang', name: '宋江' },
        portraitStyle: () => ({}),
        selectedAgent: null,
        selectedTask: { id: 'task-1', title: 'Inspect the camp' },
        tasksTotal: 3
      }
    })

    expect(wrapper.text()).to.include('巡看榜文')
    expect(wrapper.text()).to.include('整点点将册')
    expect(wrapper.text()).to.include('厅前发话')

    await wrapper.findAll('.command-grid button')[0].trigger('click')
    expect(wrapper.emitted('issue-command')[0]).to.deep.equal(['reviewBounties'])
  })

  it('emits relay and coordination actions from CoordinationPanel', async () => {
    const agents = [
      { agentId: 'wuyong', name: '吴用', abilities: ['planning'] },
      { agentId: 'linchong', name: '林冲', abilities: ['execute'] }
    ]
    const wrapper = mount(CoordinationPanel, {
      global: { stubs },
      props: {
        abilityText: agent => (agent.abilities || []).join(' / '),
        agents,
        fromAgentId: 'wuyong',
        message: '请同步风险',
        portraitStyle: () => ({}),
        selectedTask: { id: 'task-1', title: 'Inspect the camp' },
        toAgentId: 'linchong'
      }
    })

    const actionButtons = wrapper.findAll('.action-row button')
    await actionButtons[0].trigger('click')
    await actionButtons[1].trigger('click')

    expect(wrapper.text()).to.include('往来传话')
    expect(wrapper.text()).to.include('结伴办事')
    expect(wrapper.emitted('relay-message')).to.have.length(1)
    expect(wrapper.emitted('coordinate-work')).to.have.length(1)
  })

  it('searches and cites vector library results from LibraryPanel', async () => {
    const wrapper = mount(LibraryPanel, {
      global: { stubs },
      props: {
        formatTime: value => String(value),
        keyword: 'deploy',
        loading: false,
        results: [{ id: 'm1', content: 'Deployment notes', summaryType: 'project', score: 0.8 }],
        sourceType: 'project'
      }
    })

    expect(wrapper.text()).to.include('典籍阅读')
    expect(wrapper.find('.archive-reader-stub').exists()).to.equal(true)
    await wrapper.get('#library-search-tab').trigger('click')
    await wrapper.find('form').trigger('submit')
    await wrapper.find('.result-card button').trigger('click')

    expect(wrapper.text()).to.include('藏书查卷')
    expect(wrapper.emitted('search-library')).to.have.length(1)
    expect(wrapper.emitted('cite-library')[0][0].content).to.equal('Deployment notes')
  })

  it('uses roving tab focus and keyboard navigation in LibraryPanel', async () => {
    const wrapper = mount(LibraryPanel, {
      global: { stubs },
      attachTo: document.body,
      props: {
        formatTime: value => String(value),
        results: []
      }
    })
    const readerTab = wrapper.get('#library-reader-tab')
    const searchTab = wrapper.get('#library-search-tab')

    expect(readerTab.attributes('tabindex')).to.equal('0')
    expect(searchTab.attributes('tabindex')).to.equal('-1')
    await readerTab.trigger('keydown', { key: 'ArrowRight' })
    expect(document.activeElement).to.equal(searchTab.element)
    expect(searchTab.attributes('tabindex')).to.equal('0')
    await searchTab.trigger('keydown', { key: 'Home' })
    expect(document.activeElement).to.equal(readerTab.element)
    await readerTab.trigger('keydown', { key: 'End' })
    expect(document.activeElement).to.equal(searchTab.element)
    await searchTab.trigger('keydown', { key: 'ArrowLeft' })
    expect(document.activeElement).to.equal(readerTab.element)
    wrapper.unmount()
  })

  it('shows public beta empty and error states for LibraryPanel', async () => {
    const emptyWrapper = mount(LibraryPanel, {
      global: { stubs },
      props: {
        formatTime: value => String(value),
        hasSearched: true,
        keyword: 'unknown',
        loading: false,
        results: [],
        sourceType: 'project'
      }
    })

    await emptyWrapper.get('#library-search-tab').trigger('click')
    expect(emptyWrapper.text()).to.include('暂未查得案卷')

    const errorWrapper = mount(LibraryPanel, {
      global: { stubs },
      props: {
        errorMessage: '案卷阁暂不可查，主线不受影响',
        formatTime: value => String(value),
        hasSearched: true,
        keyword: 'deploy',
        loading: false,
        results: [],
        sourceType: 'project'
      }
    })

    await errorWrapper.get('#library-search-tab').trigger('click')
    expect(errorWrapper.text()).to.include('案卷阁暂不可查，主线不受影响')
  })
})

const VALID_HALL_TMX = readFileSync('public/juyiting/hall.tmx', 'utf8')

const createFakeGameMelon = ({ deferDeviceReady = false } = {}) => {
  const loadCallbacks = []
  const stateSets = []
  const stateChanges = []
  const deviceReadyCallbacks = []
  let videoInitCalls = 0

  class Stage {}
  class Sprite {}
  class Renderable {}
  class Body {}
  class Color {}

  const me = {
    Body,
    Color,
    Renderable,
    Sprite,
    Stage,
    game: {
      viewport: { width: 960, height: 640 },
      world: {
        addChild: () => {},
        removeChild: () => {}
      }
    },
    input: {
      registerPointerEvent: () => {},
      releaseAllPointerEvents: () => {}
    },
    device: {
      onReady: callback => {
        if (deferDeviceReady) deviceReadyCallbacks.push(callback)
        else callback()
      }
    },
    loader: {
      getImage: () => null,
      getTMX: () => VALID_HALL_TMX,
      load: (_resource, onload, onerror) => {
        loadCallbacks.push({ onload, onerror })
      }
    },
    state: {
      PLAY: 'PLAY',
      change: (...args) => stateChanges.push(args),
      pause: () => {},
      set: (...args) => stateSets.push(args)
    },
    video: {
      CANVAS: 'canvas',
      init: () => {
        videoInitCalls += 1
        return true
      }
    }
  }

  return { deviceReadyCallbacks, loadCallbacks, me, stateChanges, stateSets, videoInitCalls: () => videoInitCalls }
}

const settleMountWithLoaderSuccess = async (fake, mountPromise, timeoutMs = 5_000) => {
  let settled = false
  mountPromise.finally(() => {
    settled = true
  }).catch(() => {})

  const deadline = Date.now() + timeoutMs
  while (!settled && Date.now() < deadline) {
    const callbacks = fake.loadCallbacks.splice(0)
    callbacks.forEach(item => item.onload())
    await new Promise(resolve => setTimeout(resolve, 0))
  }

  if (!settled) throw new Error('timed out draining fake melonJS loader callbacks')
  return mountPromise
}

describe('JuyitingGame lifecycle guards', () => {
  it('waits for the melonJS engine ready callback before video initialization', async () => {
    const mod = await import('../src/game/JuyitingGame.js')
    const game = new mod.JuyitingGame()
    const fake = createFakeGameMelon({ deferDeviceReady: true })
    game._me = fake.me

    const mountPromise = game.mount({ querySelector: () => null })
    await Promise.resolve()

    expect(fake.deviceReadyCallbacks).to.have.length(1)
    expect(fake.videoInitCalls()).to.equal(0)

    fake.deviceReadyCallbacks[0]()
    await settleMountWithLoaderSuccess(fake, mountPromise)

    expect(fake.videoInitCalls()).to.equal(1)
  })

  it('ignores stale loader callbacks after destroy invalidates a mount', async () => {
    const mod = await import('../src/game/JuyitingGame.js')
    expect(mod.JuyitingGame).to.be.a('function')

    const game = new mod.JuyitingGame()
    const fake = createFakeGameMelon()
    let readyCalls = 0
    game._me = fake.me

    const mountPromise = game.mount({ querySelector: () => null }, {
      onReady: () => {
        readyCalls += 1
      }
    })
    await Promise.resolve()
    game.destroy()
    await settleMountWithLoaderSuccess(fake, mountPromise)

    expect(fake.stateSets).to.have.length(0)
    expect(readyCalls).to.equal(0)
  })

  it('ignores delayed ready callbacks after destroy invalidates a started game', async () => {
    const mod = await import('../src/game/JuyitingGame.js')
    expect(mod.JuyitingGame).to.be.a('function')

    const game = new mod.JuyitingGame()
    const fake = createFakeGameMelon()
    let readyCalls = 0
    game._me = fake.me

    const mountPromise = game.mount({ querySelector: () => null }, {
      onReady: () => {
        readyCalls += 1
      }
    })
    await settleMountWithLoaderSuccess(fake, mountPromise)
    game.destroy()
    await new Promise(resolve => setTimeout(resolve, 240))

    expect(fake.stateSets).to.have.length(1)
    expect(readyCalls).to.equal(0)
  })
})

describe('O03 map snapshot lifecycle contract', () => {
  it('serializes snapshot destroy/remount and consumes only strict latest landscape targets', () => {
    const source = readFileSync(new URL('../src/components/juyiting/HallStage.vue', import.meta.url), 'utf8')
    const hall = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
    expect(source).to.include("const mapLifecycleState = ref('unmounted')")
    expect(source).to.include("mapLifecycleState.value = 'suspending'")
    expect(source).to.include("mapLifecycleState.value = 'suspended'")
    expect(source).to.include("mapLifecycleState.value = 'resuming'")
    expect(source).to.include("mapLifecycleState.value = 'running'")
    expect(source).to.include("mapLifecycleState.value = 'destroying'")
    expect(source).to.include("mapLifecycleState.value = 'unmounted'")
    expect(source).to.include('captureResumeSnapshot?.()')
    expect(source).to.include('settleFinalViewport')
    expect(source).to.include('stableFrames < 2')
    expect(source).to.include("kind: 'orientation'")
    expect(source).to.include('restoreResumeSnapshot?.(snapshot, viewport)')
    expect(source).to.include('consumeLandscapeEntryTarget')
    expect(source).to.include('assignedIds.includes(target.agentId) || assigneeIds.includes(target.agentId)')
    expect(source).to.include('juyitingGame.resetToMainHall?.()')
    expect(hall).to.include('const mapResumeSnapshot = ref(null)')
    expect(hall).to.include('const landscapeEntryTarget = ref(null)')
    expect(hall).to.include('const setLandscapeEntryTarget = target => {')
    expect(hall).to.include('@map-snapshot="handleMapSnapshot"')
    expect(hall).to.include('@landscape-target-consumed="handleLandscapeTargetConsumed"')
  })
})

describe('O04 shared panel session contract', () => {
  it('keeps the rendered session through leave, fences stale generations, and shields the active shell', async () => {
    const source = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
    const { capturePanelReturnTarget, isCurrentPanelGeneration, resolvePanelReturnTarget } = await import('../src/composables/juyiting/useHallPanels.js')

    expect(source).to.include('v-if="activePanel" :key="panelSessionGeneration"')
    expect(source).to.include(':data-panel-generation="panelSessionGeneration"')
    expect(source).to.include(':interaction-locked="isPanelSessionActive"')
    expect(source).to.include(':inert="isPanelSessionActive ? \'\' : null"')
    expect(source).to.include(':aria-hidden="isPanelSessionActive ? \'true\' : null"')
    expect(source).to.include('const panelWhitelist = new Set(')
    expect(source).to.include('if (!panelWhitelist.has(panel)) return false')
    expect(source).to.include('isCurrentPanelGeneration({')
    expect(source).to.include('await nextTick()')

    expect(isCurrentPanelGeneration({ leavingGeneration: 1, closingGeneration: 1, sessionGeneration: 2, activePanel: '', disposed: false })).to.equal(false)
    expect(isCurrentPanelGeneration({ leavingGeneration: 2, closingGeneration: 2, sessionGeneration: 2, activePanel: 'library', disposed: false })).to.equal(false)
    expect(isCurrentPanelGeneration({ leavingGeneration: 2, closingGeneration: 2, sessionGeneration: 2, activePanel: '', disposed: true })).to.equal(false)
    expect(isCurrentPanelGeneration({ leavingGeneration: 2, closingGeneration: 2, sessionGeneration: 2, activePanel: '', disposed: false })).to.equal(true)

    const root = document.createElement('main')
    const prior = document.createElement('button')
    const rotatedTrigger = document.createElement('button')
    prior.setAttribute('data-portrait-action', 'library')
    rotatedTrigger.setAttribute('data-portrait-action', 'library')
    root.append(rotatedTrigger)
    document.body.append(prior, root)
    try {
      const origin = capturePanelReturnTarget(prior, 'library')
      prior.remove()
      expect(resolvePanelReturnTarget({ origin, root })).to.equal(rotatedTrigger)
    } finally {
      root.remove()
      prior.remove()
    }
  })
})

const loadActualJuyiHall = (mocks) => {
  const relativePath = '../src/components/world/JuyiHall.vue'
  const filename = new URL(relativePath, import.meta.url).pathname
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const { descriptor } = parse(source, { filename })
  const script = compileScript(descriptor, { id: 'o04-actual-juyi-hall', inlineTemplate: true }).content
  const body = script
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, vueImportToVar)
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"];?\s*$/gm, (_line, imports) => `var { ${imports} } = mocks`)
    .replace(/^import\s+(\w+)\s+from\s+['"][^'"]+['"];?\s*$/gm, (_line, name) => `var ${name} = mocks.${name}`)
    .replace(/import\.meta\.env/g, 'mocks.env')
    .replace('export default', 'return')
  return new Function('Vue', 'mocks', body)(Vue, mocks)
}

const createActualHallMocks = ({ mode, mounts, counters = {} }) => {
  const noop = () => {}
  const asyncNoop = async () => {}
  const value = Vue.ref([])
  const scalar = Vue.ref('')
  const HallPortraitHome = Vue.defineComponent({
    emits: ['quick-action'],
    setup (_props, { attrs, emit }) {
      Vue.onMounted(() => { mounts.portrait = (mounts.portrait || 0) + 1 })
      Vue.onUnmounted(() => { mounts.portraitUnmount = (mounts.portraitUnmount || 0) + 1 })
      return () => Vue.h('main', { ...attrs, class: 'portrait-shell' }, [
        ...['agents', 'tasks', 'discussion', 'catalog', 'library'].map(action => Vue.h('button', { type: 'button', 'data-portrait-action': action, onClick: () => emit('quick-action', action) }, action))
      ])
    }
  })
  const ArchiveReader = Vue.defineComponent({ setup: () => { Vue.onMounted(() => { mounts.archive += 1 }); Vue.onUnmounted(() => { mounts.archiveUnmount = (mounts.archiveUnmount || 0) + 1 }); return () => Vue.h('div', { class: 'archive-reader-instance' }, 'reader') } })
  const LibraryPanel = Vue.defineComponent({ setup: () => { Vue.onMounted(() => { mounts.library += 1 }); Vue.onUnmounted(() => { mounts.libraryUnmount = (mounts.libraryUnmount || 0) + 1 }); return () => Vue.h('section', { class: 'library-panel-instance' }, [Vue.h('button', { class: 'library-last' }, '末项'), Vue.h(ArchiveReader)]) } })
  const HallStage = Vue.defineComponent({ setup: (_props, { attrs }) => () => Vue.h('section', { ...attrs, class: 'hall-board', tabindex: 0 }) })
  const EmptyPanel = Vue.defineComponent({ setup: () => () => Vue.h('section') })
  counters.loads ||= { agents: 0, tasks: 0, messages: 0 }
  counters.owners ||= { data: 0, conversation: 0, debug: 0 }
  counters.refs ||= {
    conversationId: Vue.ref('conversation-o04'),
    draft: Vue.ref('draft-o04'),
    messages: Vue.ref([{ id: 'message-o04', content: 'sentinel' }])
  }
  const hallData = {
    applySceneEvent: noop, applySceneSnapshot: noop, agentFilter: scalar, agents: value, bindPersona: asyncNoop, canAssign: () => true,
    filteredAgents: value, hiddenAgentCount: Vue.ref(0), loadAgents: async () => { counters.loads.agents += 1 }, loadTasks: async () => { counters.loads.tasks += 1 }, loadTaskRecommendations: asyncNoop,
    mapAgents: value, personaCatalog: value, recommendedAgents: value, setAgentFilter: asyncNoop, setTaskStatusFilter: asyncNoop,
    taskAbilityFilter: scalar, taskAbilityOptions: value, taskKeyword: scalar, tasks: value, taskStatusCount: Vue.ref({}), taskStatusFilter: scalar, unbindPersona: asyncNoop, visibleAgents: value
  }
  const panelHelpers = counters.panelHelpers || {}
  return {
    ...panelHelpers,
    env: {}, capturePanelReturnTarget: panelHelpers.capturePanelReturnTarget, focusHallPanel: panelHelpers.focusHallPanel, isCurrentPanelGeneration: panelHelpers.isCurrentPanelGeneration, isSafePanelFocusTarget: panelHelpers.isSafePanelFocusTarget, resolvePanelReturnTarget: panelHelpers.resolvePanelReturnTarget, restorePanelFocus: panelHelpers.restorePanelFocus, trapPanelFocus: panelHelpers.trapPanelFocus,
    useGlobalStore: () => ({ setTitle: noop, setShowBack: noop, setShowAppBar: noop, setShowMore: noop }), useApiStore: () => ({}), agentApi: {}, chatApi: {}, log: { warn: noop }, juyitingGame: {},
    roleDialogues: { default: [''] }, statusFilters: [], taskStatusFilters: [],
    useHallData: ({ selectedAgent, selectedTask }) => { counters.owners.data += 1; selectedAgent.value = { agentId: 'agent-o04', name: 'sentinel-agent' }; selectedTask.value = { id: 'task-o04', title: 'sentinel-task' }; return hallData },
    useHallExperienceMode: () => ({ experienceMode: mode, isMobileCoarse: Vue.ref(true), orientationHint: scalar, orientationRequestPending: Vue.ref(false), requestLandscape: asyncNoop }),
    useHallPanels: ({ experienceMode, isMobileCoarse }) => ({ panelLayout: Vue.computed(() => isMobileCoarse.value ? (experienceMode.value === 'landscape-map' ? 'right-drawer' : 'bottom-drawer') : 'center-modal') }),
    useHallSceneState: () => ({ setMapRuntime: noop, reset: noop, forwardPhaseEvents: asyncNoop }),
    useHallCommandQueue: () => ({ ready: Vue.ref(false), setSimulation: noop }),
    useHallBackendSceneState: () => ({ start: asyncNoop, stop: noop, dispose: noop, reportPhase: noop }), useHallSceneDebugBridge: () => { counters.owners.debug += 1; return { sentinel: 'debug-owner-o04', republish: noop, stop: noop } },
    useHallSound: () => ({ playAgentSelect: noop, playError: noop, playPanelOpen: noop, playRefresh: noop, playSend: noop, playSuccess: noop, playTap: noop, setSoundEnabled: noop, soundEnabled: Vue.ref(false) }),
    useHallChatContext: () => ({ chatContext: Vue.ref({}), chatMentionAgents: value, chatMode: Vue.ref('public'), chatTargetText: scalar, enterBountyDiscussion: noop, enterPrivateConversation: noop, resetToPublic: noop, setMentionAgent: noop }),
    useHallScene: () => ({ markAgentSpeaking: noop, markDiscussionStarted: noop, markLibraryCitation: noop, markLibrarySearching: noop, markRecommendedAgents: noop, markTaskArchived: noop, markTaskAssigned: noop, markTaskAutoAssigned: noop, markTaskCreated: noop, resetSceneFeedback: noop, sceneAgents: value, sceneAgentStyle: () => ({}), sceneHotspots: value, syncAfterPersonaChanged: noop }),
    useHallTaskActions: () => ({ archiveTask: asyncNoop, autoAssignTask: asyncNoop, assignTask: async () => true, createTask: asyncNoop }),
    useHallConversation: () => { counters.owners.conversation += 1; return ({ chatConnectionStatus: scalar, conversationId: counters.refs.conversationId, draft: counters.refs.draft, eventStreamRecovering: Vue.ref(false), insertAgentMention: noop, isAwaitingReply: Vue.ref(false), isStreaming: Vue.ref(false), loadHallMessages: async () => { counters.loads.messages += 1 }, mentionAgent: noop, messages: counters.refs.messages, newHallConversation: noop, pendingAgentName: scalar, sendHallMessage: asyncNoop, senderText: scalar, disposeHallConversation: noop, stopHallEventStream: noop, stopHallReplyPolling: noop, stopHallReplyStreaming: noop }) },
    useHallLibrary: () => ({ citeLibraryItem: noop, libraryErrorMessage: scalar, libraryHasSearched: Vue.ref(false), libraryKeyword: scalar, libraryLoading: Vue.ref(false), libraryResults: value, librarySourceType: scalar, searchLibrary: asyncNoop }),
    useTaskWorkspace: () => null, createDisabledTaskWorkspaceBinding: () => ({ selectExplicitActor: noop, clearExplicitActor: noop, dispose: noop }), isTaskWorkspaceBuildEnabled: () => false, useTaskWorkspaceView: () => ({ subject: Vue.ref(null), workspace: Vue.ref(null), connectionState: scalar, error: Vue.ref(null), retry: noop }), useTaskWorkspaceBinding: () => ({ selectExplicitActor: noop, clearExplicitActor: noop }),
    portraitName: () => '', portraitRole: () => ({ slug: 'default' }), portraitShortName: () => '', portraitStyle: () => ({}), roleClass: () => '',
    HallPortraitHome, HallStage, LibraryPanel, AgentPanel: EmptyPanel, BountyDiscussionPanel: EmptyPanel, BountyPanel: EmptyPanel, TaskWorkspacePanel: EmptyPanel, PersonaCatalogPanel: EmptyPanel, PrivateDiscussionPanel: EmptyPanel, PublicDiscussionPanel: EmptyPanel, SelectedAgentCard: EmptyPanel
  }
}

describe('O04 actual-mounted JuyiHall panel identity', () => {
  it('retains panel/state identity for five cycles and fences stale keyed leaves', async () => {
    const mode = Vue.ref('portrait-command')
    const mounts = { library: 0, archive: 0 }
    const counters = { panelHelpers: await import('../src/composables/juyiting/useHallPanels.js') }
    const JuyiHall = loadActualJuyiHall(createActualHallMocks({ mode, mounts, counters }))
    const wrapper = mount(JuyiHall, { attachTo: document.body, global: { stubs: { ...stubs, transition: false } } })
    try {
      await flushPromises()
      const originalTrigger = wrapper.find('[data-portrait-action="library"]').element
      originalTrigger.focus()
      await wrapper.find('[data-portrait-action="library"]').trigger('click')
      await Vue.nextTick()
      const floatingPanel = wrapper.find('.floating-panel').element
      const library = wrapper.find('.library-panel-instance').element
      const archive = wrapper.find('.archive-reader-instance').element
      expect(document.activeElement).to.equal(wrapper.find('.panel-close').element)
      expect(wrapper.find('.portrait-shell').attributes('inert')).to.equal('')
      expect(wrapper.find('.portrait-shell').attributes('aria-hidden')).to.equal('true')
      expect(counters.owners).to.deep.equal({ data: 1, conversation: 1, debug: 1 })
      const initialLoads = { ...counters.loads }
      const conversationId = counters.refs.conversationId.value
      const draft = counters.refs.draft.value
      const messages = counters.refs.messages.value

      for (let cycle = 0; cycle < 5; cycle += 1) {
        mode.value = 'landscape-map'; await Vue.nextTick()
        expect(wrapper.find('.floating-panel').classes()).to.include('layout-right-drawer')
        expect(wrapper.find('.hall-board').attributes('inert')).to.equal('')
        mode.value = 'portrait-command'; await Vue.nextTick()
        expect(wrapper.find('.floating-panel').classes()).to.include('layout-bottom-drawer')
        expect(wrapper.find('.floating-panel').element).to.equal(floatingPanel)
        expect(wrapper.find('.library-panel-instance').element).to.equal(library)
        expect(wrapper.find('.archive-reader-instance').element).to.equal(archive)
        expect(counters.refs.conversationId.value).to.equal(conversationId)
        expect(counters.refs.draft.value).to.equal(draft)
        expect(counters.refs.messages.value).to.equal(messages)
        expect(counters.loads).to.deep.equal(initialLoads)
        expect(mounts.libraryUnmount || 0).to.equal(0)
        expect(mounts.archiveUnmount || 0).to.equal(0)
      }

      const state = wrapper.vm.$.setupState
      const overlayA = wrapper.find('.panel-overlay').element
      const generationA = overlayA.dataset.panelGeneration
      state.closePanel()
      state.openPanel('library')
      await Vue.nextTick()
      const overlayB = wrapper.find('.panel-overlay').element
      expect(overlayB).not.to.equal(overlayA)
      expect(overlayB.dataset.panelGeneration).not.to.equal(generationA)
      await state.handlePanelAfterLeave(overlayA)
      expect(wrapper.find('.panel-overlay').element).to.equal(overlayB)
      state.closePanel()
      await state.handlePanelAfterLeave(overlayA)
      expect(state.renderedPanel).to.equal('library')
      await state.handlePanelAfterLeave(overlayB)
      await Vue.nextTick()
      expect(state.renderedPanel).to.equal('')
      expect(document.activeElement).to.equal(wrapper.find('[data-portrait-action="library"]').element)
      expect(mounts.library).to.equal(1)
      expect(mounts.archive).to.equal(1)
    } finally {
      wrapper.unmount()
    }
    expect(mounts.libraryUnmount).to.equal(1)
    expect(mounts.archiveUnmount).to.equal(1)
  })

  it('cancels chat load and deferred focus when actual JuyiHall unmounts', async () => {
    const mode = Vue.ref('portrait-command')
    const mounts = { library: 0, archive: 0 }
    const counters = { panelHelpers: await import('../src/composables/juyiting/useHallPanels.js') }
    const JuyiHall = loadActualJuyiHall(createActualHallMocks({ mode, mounts, counters }))
    const external = document.createElement('button')
    document.body.append(external)
    external.focus()
    const wrapper = mount(JuyiHall, { attachTo: document.body, global: { stubs: { ...stubs, transition: false } } })
    await flushPromises()
    wrapper.vm.$.setupState.openPanel('chat')
    wrapper.unmount()
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(counters.loads.messages).to.equal(0)
    expect(document.activeElement).to.equal(external)
    external.remove()
  })

  it('converges Escape, close button, and backdrop and restores landscape/root fallbacks', async () => {
    const mode = Vue.ref('portrait-command')
    const mounts = { library: 0, archive: 0 }
    const counters = { panelHelpers: await import('../src/composables/juyiting/useHallPanels.js') }
    const JuyiHall = loadActualJuyiHall(createActualHallMocks({ mode, mounts, counters }))
    const wrapper = mount(JuyiHall, { attachTo: document.body, global: { stubs: { ...stubs, transition: false } } })
    const state = wrapper.vm.$.setupState
    try {
      await flushPromises()
      const trigger = wrapper.find('[data-portrait-action="library"]')
      trigger.element.focus()
      await trigger.trigger('click')
      await Vue.nextTick()
      const last = wrapper.find('.library-last').element
      last.focus()
      await wrapper.find('.floating-panel').trigger('keydown', { key: 'Tab' })
      expect(document.activeElement).to.equal(wrapper.find('.panel-close').element)
      await wrapper.find('.floating-panel').trigger('keydown', { key: 'Tab', shiftKey: true })
      expect(document.activeElement).to.equal(last)

      mode.value = 'landscape-map'; await Vue.nextTick()
      const escapeOverlay = wrapper.find('.panel-overlay').element
      await wrapper.find('.floating-panel').trigger('keydown', { key: 'Escape' })
      expect(state.activePanel).to.equal('')
      await state.handlePanelAfterLeave(escapeOverlay)
      await Vue.nextTick()
      expect(document.activeElement).to.equal(wrapper.find('.hall-board').element)

      document.activeElement.blur()
      state.openPanel('library')
      await Vue.nextTick()
      const closeOverlay = wrapper.find('.panel-overlay').element
      await wrapper.find('.panel-close').trigger('click')
      expect(state.activePanel).to.equal('')
      await state.handlePanelAfterLeave(closeOverlay)
      await Vue.nextTick()
      expect(document.activeElement).to.equal(wrapper.find('.juyi-page').element)

      state.openPanel('library')
      await Vue.nextTick()
      const backdropOverlay = wrapper.find('.panel-overlay').element
      await wrapper.find('.panel-overlay').trigger('pointerdown')
      expect(state.activePanel).to.equal('')
      await state.handlePanelAfterLeave(backdropOverlay)
      expect(state.renderedPanel).to.equal('')
    } finally {
      wrapper.unmount()
    }
  })

})
