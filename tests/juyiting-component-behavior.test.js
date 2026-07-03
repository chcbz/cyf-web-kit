import { expect } from 'chai'
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
    .replace(/^import\s+BountyActionIcon\s+from\s+['"].\/BountyActionIcon\.vue['"];?\s*$/gm, 'var BountyActionIcon = { template: \'<span />\', props: [\'status\'] }')
    .replace(/^import\s+(\w+)\s+from\s+['"]@\/assets\/juyiting\/[^'"]+['"];?\s*$/gm, 'var $1 = \'/mock-juyiting-asset.png\'')
    .replace(/^import\s+\{\s*hallPhysicalScene,\s*hallRoomPropVisuals\s*\}\s+from\s+['"]@\/constants\/juyiting['"];?\s*$/gm, 'var hallRoomPropVisuals = []; var hallPhysicalScene = { interactiveZones: [{ key: \'main\', panel: \'chat\', title: \'忠义堂公议\', subtitle: \'厅前公议 / 众好汉\', x: 50, y: 36, w: 12, h: 7, object: \'plaque\', hitShape: \'plaque\' }, { key: \'agents\', panel: \'agents\', title: \'点将册\', subtitle: \'点将调遣\', x: 21, y: 32, w: 13, h: 7, object: \'ledger\' }, { key: \'tasks\', panel: \'tasks\', title: \'悬赏榜\', subtitle: \'榜文\', x: 76, y: 47, w: 19, h: 18, object: \'notice-rack\' }, { key: \'catalog\', panel: \'catalog\', title: \'招贤令\', subtitle: \'遍请豪杰\', x: 14, y: 68, w: 12, h: 7, object: \'banner-flag\' }, { key: \'library\', panel: \'library\', title: \'案卷阁\', subtitle: \'查卷问典\', x: 82, y: 76, w: 22, h: 18, object: \'scroll-shelf\' }, { key: \'back\', panel: null, title: \'整装处\', subtitle: \'兵甲行囊\', x: 67, y: 26, w: 12, h: 8, object: \'rear-gear\' }] }')
    .replace(/^import\s+HallChatComposer\s+from\s+['"].\/HallChatComposer\.vue['"];?\s*$/gm, 'var HallChatComposer = arguments[1]')
    .replace(/^import\s+\{\s*marked\s*\}\s+from\s+['"]marked['"];?\s*$/gm, 'var marked = { setOptions: () => {}, parse: value => value }')
    .replace(/^import\s+DOMPurify\s+from\s+['"]dompurify['"];?\s*$/gm, 'var DOMPurify = { sanitize: value => value }')
    .replace('export default', 'return')

  return new Function('Vue', 'HallChatComposer', 'juyitingGame', scriptBody)(Vue, HallChatComposer, hallGameMock)
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
      resetTransform: () => resetCalls.push(true),
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

  it('forwards mobile touch drag and pinch gestures to the melonJS game layer', async () => {
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

    await board.trigger('touchstart', {
      touches: [{ clientX: 100, clientY: 100 }]
    })
    await board.trigger('touchmove', {
      touches: [{ clientX: 128, clientY: 116 }],
      preventDefault: () => {}
    })

    expect(panCalls).to.deep.equal([[28, 16]])

    await board.trigger('touchstart', {
      touches: [
        { clientX: 100, clientY: 100 },
        { clientX: 200, clientY: 100 }
      ]
    })
    await board.trigger('touchmove', {
      touches: [
        { clientX: 100, clientY: 100 },
        { clientX: 260, clientY: 100 }
      ],
      preventDefault: () => {}
    })

    expect(zoomCalls).to.have.length(1)
    expect(zoomCalls[0]).to.be.greaterThan(0)
  })

  it('adapts the hall stage orientation and exposes a landscape view toggle', async () => {
    const originalMatchMedia = global.window.matchMedia
    const originalFullscreen = global.document.documentElement.requestFullscreen
    const originalExitFullscreen = global.document.exitFullscreen
    const originalScreen = global.screen
    const listeners = []
    const fitModes = []
    let fullscreenCalls = 0
    let exitFullscreenCalls = 0
    let unlockCalls = 0
    let lockCalls = []
    let matches = false

    global.window.matchMedia = query => ({
      media: query,
      get matches() {
        return matches
      },
      addEventListener: (_event, callback) => listeners.push(callback),
      removeEventListener: (_event, callback) => {
        const index = listeners.indexOf(callback)
        if (index >= 0) listeners.splice(index, 1)
      }
    })
    global.document.documentElement.requestFullscreen = async () => {
      fullscreenCalls += 1
    }
    global.document.exitFullscreen = async () => {
      exitFullscreenCalls += 1
    }
    global.screen = {
      orientation: {
        lock: async mode => lockCalls.push(mode),
        unlock: () => {
          unlockCalls += 1
        }
      }
    }
    hallGameMock = {
      destroy: () => {},
      fitToViewport: mode => fitModes.push(mode),
      mount: async (_container, options = {}) => {
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

      const board = wrapper.find('.hall-board')
      const toggle = wrapper.find('.orientation-action')

      expect(board.classes()).to.include('is-scene-portrait')
      expect(toggle.exists()).to.equal(true)
      expect(toggle.text()).to.include('横屏')
      expect(fitModes).to.deep.include('portrait')

      await toggle.trigger('click')
      await flushPromises()

      expect(fullscreenCalls).to.equal(1)
      expect(lockCalls).to.deep.equal(['landscape'])
      expect(wrapper.find('.hall-board').classes()).to.include('is-app-landscape')
      expect(fitModes).to.deep.include('landscape')

      await toggle.trigger('click')
      await flushPromises()

      expect(unlockCalls).to.equal(1)
      expect(exitFullscreenCalls).to.equal(1)
      expect(wrapper.find('.hall-board').classes()).not.to.include('is-app-landscape')
      expect(wrapper.find('.hall-board').classes()).to.include('is-scene-portrait')
      expect(wrapper.find('.orientation-action').text()).to.include('横屏')
      expect(fitModes.at(-1)).to.equal('portrait')

      matches = true
      listeners.forEach(listener => listener({ matches: true }))
      await flushPromises()

      expect(wrapper.find('.hall-board').classes()).to.include('is-device-landscape')
    } finally {
      global.window.matchMedia = originalMatchMedia
      global.document.documentElement.requestFullscreen = originalFullscreen
      global.document.exitFullscreen = originalExitFullscreen
      global.screen = originalScreen
    }
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
    const source = readFileSync(new URL('../src/components/juyiting/HallStage.vue', import.meta.url), 'utf8')
    const headerRule = cssRule(source, '.stage-header')

    expect(headerRule).to.include('background: rgba(35, 24, 16, 0.52)')
    expect(source).to.include('@media (max-width: 640px)')
    expect(source).to.include('width: fit-content;')
    expect(source).to.include('max-width: calc(100% - 16px);')
    expect(source).to.include('.stage-heading .eyebrow {\n    display: none;')
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
    expect(source).to.include('object-fit: cover')
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

      expect(wrapper.find('.scene-error button').attributes('disabled')).to.not.equal(undefined)
      await wrapper.find('.scene-error button').trigger('click')

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
    expect(privateWrapper.find('.composer-context.is-private').exists()).to.equal(true)
    expect(privateWrapper.find('.composer-target-chip.is-locked').exists()).to.equal(true)
    expect(privateWrapper.find('.composer-target-remove').exists()).to.equal(false)
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

    await wrapper.find('form').trigger('submit')
    await wrapper.find('.result-card button').trigger('click')

    expect(wrapper.text()).to.include('藏书查卷')
    expect(wrapper.emitted('search-library')).to.have.length(1)
    expect(wrapper.emitted('cite-library')[0][0].content).to.equal('Deployment notes')
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

    expect(errorWrapper.text()).to.include('案卷阁暂不可查，主线不受影响')
  })
})

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
      getTMX: () => null,
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
    await mountPromise

    expect(fake.videoInitCalls()).to.equal(1)
  })

  it('ignores stale loader callbacks after destroy invalidates a mount', async () => {
    const mod = await import('../src/game/JuyitingGame.js')
    expect(mod.JuyitingGame).to.be.a('function')

    const game = new mod.JuyitingGame()
    const fake = createFakeGameMelon()
    let readyCalls = 0
    game._me = fake.me

    await game.mount({ querySelector: () => null }, {
      onReady: () => {
        readyCalls += 1
      }
    })
    game.destroy()
    fake.loadCallbacks.forEach(item => item.onload())

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

    await game.mount({ querySelector: () => null }, {
      onReady: () => {
        readyCalls += 1
      }
    })
    fake.loadCallbacks.forEach(item => item.onload())
    game.destroy()
    await new Promise(resolve => setTimeout(resolve, 240))

    expect(fake.stateSets).to.have.length(1)
    expect(readyCalls).to.equal(0)
  })
})
