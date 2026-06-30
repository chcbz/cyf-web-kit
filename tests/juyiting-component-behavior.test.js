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

const cssRule = (source, selector) => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))
  return match?.[1] || ''
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

  it('uses the central courtyard as the all-hands discussion entrance without a command room', async () => {
    const wrapper = mount(HallStage, {
      global: { stubs },
      props: {
        agentKey: agent => agent.agentId,
        agentStyle: () => ({}),
        portraitName: agent => agent.name,
        portraitShortName: agent => agent.name,
        portraitStyle: () => ({}),
        roleClass: () => '',
        statusClass: () => '',
        statusText: () => '',
        tasksTotal: 3,
        visibleAgents: []
      }
    })

    expect(wrapper.text()).to.include('厅前公议')
    expect(wrapper.text()).to.include('众好汉')
    expect(wrapper.text()).not.to.include('传令房')
    expect(wrapper.find('.room-chat').exists()).to.equal(false)
    expect(wrapper.find('.hotspot-chat').exists()).to.equal(false)

    await wrapper.find('.room-main').trigger('click')

    expect(wrapper.emitted('open-panel')[0]).to.deep.equal(['chat'])
  })

  it('renders the recruit entry and persona catalog actions', async () => {
    const stage = mount(HallStage, {
      global: { stubs },
      props: {
        agentKey: agent => agent.agentId,
        agentStyle: () => ({}),
        portraitName: agent => agent.name,
        portraitShortName: agent => agent.name,
        portraitStyle: () => ({}),
        roleClass: () => '',
        statusClass: () => '',
        statusText: () => '',
        tasksTotal: 3,
        visibleAgents: []
      }
    })

    expect(stage.text()).to.include('招贤令')
    expect(stage.text()).to.include('遍请豪杰')
    await stage.find('.room-catalog').trigger('click')
    expect(stage.emitted('open-panel')[0]).to.deep.equal(['catalog'])

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

  it('labels hall hotspots as concrete function objects in the redesigned scene', () => {
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

    expect(stageSource).to.include('liangshan-hall-functional-bg-v1.png')
  })

  it('syncs scene agents to the melonJS game layer when ready', async () => {
    const syncedAgents = []
    const syncedHotspots = []
    hallGameMock = {
      destroy: () => {},
      mount: async (_container, options = {}) => {
        options.onReady?.()
      },
      setSelectedAgent: () => {},
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
      props: {
        agentKey: agent => agent.agentId,
        agentStyle: () => ({}),
        portraitName: agent => agent.name,
        portraitShortName: agent => agent.name,
        portraitStyle: () => ({}),
        roleClass: () => '',
        sceneAgents,
        sceneHotspots,
        statusClass: () => '',
        statusText: () => '',
        tasksTotal: 3,
        visibleAgents: []
      }
    })
    await Vue.nextTick()

    expect(syncedAgents).to.deep.include(sceneAgents)
    expect(syncedHotspots).to.deep.include(sceneHotspots)
    expect(wrapper.find('.hall-board').classes()).to.include('is-melon-ready')
    expect(wrapper.find('.map-world').classes()).to.include('is-melon-enhanced')
    expect(wrapper.find('.map-world').classes()).not.to.include('is-dom-fallback-hidden')
  })

  it('keeps scene and agent hit routing usable when the melonJS layer is ready', async () => {
    hallGameMock = {
      destroy: () => {},
      mount: async (_container, options = {}) => {
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
      attachTo: document.body,
      global: { stubs },
      props: {
        agentKey: agent => agent.agentId,
        agentStyle: () => ({}),
        portraitName: agent => agent.name,
        portraitShortName: agent => agent.name,
        portraitStyle: () => ({}),
        roleClass: () => '',
        sceneAgents,
        statusClass: () => '',
        statusText: () => '',
        tasksTotal: 3,
        visibleAgents: sceneAgents
      }
    })
    await Vue.nextTick()

    wrapper.find('.map-world').element.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 1000,
      right: 1000,
      bottom: 1000
    })

    expect(wrapper.find('.map-world').classes()).to.include('is-melon-enhanced')
    expect(wrapper.find('.map-world').classes()).not.to.include('is-dom-fallback-hidden')

    await wrapper.find('.hall-board').trigger('click', { clientX: 130, clientY: 680 })
    expect(wrapper.emitted('open-panel')[0]).to.deep.equal(['catalog'])

    await wrapper.find('.hall-board').trigger('click', { clientX: 340, clientY: 630 })
    expect(wrapper.emitted('select-agent')[0]).to.deep.equal([sceneAgents[0]])
  })

  it('zooms the map through wheel, keyboard, and touch gestures without visible zoom buttons', async () => {
    hallGameMock = {
      destroy: () => {},
      mount: async (_container, options = {}) => {
        options.onReady?.()
      },
      setSelectedAgent: () => {},
      start: () => {},
      syncAgents: () => {},
      syncHotspots: () => {}
    }
    HallStage = loadSfc('../src/components/juyiting/HallStage.vue')
    const wrapper = mount(HallStage, {
      attachTo: document.body,
      global: { stubs },
      props: {
        agentKey: agent => agent.agentId,
        agentStyle: () => ({}),
        portraitName: agent => agent.name,
        portraitShortName: agent => agent.name,
        portraitStyle: () => ({}),
        roleClass: () => '',
        statusClass: () => '',
        statusText: () => '',
        visibleAgents: []
      }
    })
    await Vue.nextTick()

    const board = wrapper.find('.hall-board')
    const world = wrapper.find('.map-world')
    const melonLayer = wrapper.find('.melon-layer')
    board.element.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 500,
      height: 400,
      right: 500,
      bottom: 400
    })
    world.element.getBoundingClientRect = () => ({
      left: -150,
      top: -96,
      width: 810,
      height: 592,
      right: 660,
      bottom: 496
    })

    const currentZoom = () => Number((world.attributes('style') || '').match(/--map-zoom:\s*([0-9.]+)/)?.[1])
    const dispatchMapEvent = async (type, detail) => {
      const event = new window.Event(type, { bubbles: true, cancelable: true })
      Object.defineProperties(event, Object.fromEntries(
        Object.entries(detail).map(([key, value]) => [key, { value }])
      ))
      board.element.dispatchEvent(event)
      await Vue.nextTick()
    }

    expect(wrapper.find('.map-controls').exists()).to.equal(false)
    expect(wrapper.find('.map-control').exists()).to.equal(false)
    expect(board.attributes('tabindex')).to.equal('0')
    expect(currentZoom()).to.equal(1)
    expect(melonLayer.attributes('style')).to.include('--map-zoom: 1.00')

    await dispatchMapEvent('wheel', { deltaY: -120, clientX: 250, clientY: 200 })
    expect(currentZoom()).to.be.greaterThan(1)
    expect(melonLayer.attributes('style')).to.include(`--map-zoom: ${currentZoom().toFixed(2)}`)

    await board.trigger('keydown', { key: '0' })
    await Vue.nextTick()
    expect(currentZoom()).to.equal(1)

    await board.trigger('keydown', { key: '+' })
    await Vue.nextTick()
    expect(currentZoom()).to.be.greaterThan(1)

    await board.trigger('keydown', { key: '0' })
    await dispatchMapEvent('pointerdown', { pointerId: 1, pointerType: 'touch', button: 0, clientX: 180, clientY: 200 })
    await dispatchMapEvent('pointerdown', { pointerId: 2, pointerType: 'touch', button: 0, clientX: 280, clientY: 200 })
    await dispatchMapEvent('pointermove', { pointerId: 2, pointerType: 'touch', clientX: 330, clientY: 200 })
    expect(currentZoom()).to.be.greaterThan(1)
  })

  it('keeps the melonJS interaction layer aligned to the oversized map world on portrait screens', () => {
    const source = readFileSync(new URL('../src/components/juyiting/HallStage.vue', import.meta.url), 'utf8')
    const melonRule = cssRule(source, '.melon-layer')

    expect(melonRule).to.include('left: 50%')
    expect(melonRule).to.include('top: 50%')
    expect(melonRule).to.include('width: 162%')
    expect(melonRule).to.include('height: 148%')
    expect(melonRule).to.include('translate3d(calc(-50% + var(--map-offset-x, 0px)), calc(-50% + var(--map-offset-y, 0px)), 0)')
  })

  it('fits the full landscape hall scene on portrait phones without cover cropping', () => {
    const source = readFileSync(new URL('../src/components/juyiting/HallStage.vue', import.meta.url), 'utf8')
    const portraitMedia = source.slice(source.indexOf('@media (max-width: 640px) and (orientation: portrait)'))

    expect(portraitMedia).to.include('aspect-ratio: 1672 / 941')
    expect(portraitMedia).to.include('width: 100%')
    expect(portraitMedia).to.include('height: auto')
    expect(portraitMedia).to.include('background-size: auto, contain')
  })

  it('uses object-shaped hotspots with highlight treatment instead of visible text labels', () => {
    const source = readFileSync(new URL('../src/components/juyiting/HallStage.vue', import.meta.url), 'utf8')
    const constants = readFileSync(new URL('../src/constants/juyiting.js', import.meta.url), 'utf8')

    expect(source).not.to.include('class="hall-room-label"')
    expect(source).not.to.include('class="hall-room-subtitle"')
    expect(source).to.include('object-highlight')
    for (const shape of ['shape-ledger', 'shape-notice-board', 'shape-banner-flag', 'shape-scroll-desk', 'shape-gear-rack']) {
      expect(source).to.include(`.${shape}`)
      expect(constants).to.include(`hitShape: '${shape.replace('shape-', '')}'`)
    }
  })

  it('scales agents and speech bubbles with the fitted portrait hall scene', () => {
    const stageSource = readFileSync(new URL('../src/components/juyiting/HallStage.vue', import.meta.url), 'utf8')
    const tokenSource = readFileSync(new URL('../src/components/juyiting/AgentToken.vue', import.meta.url), 'utf8')
    const portraitMedia = stageSource.slice(stageSource.indexOf('@media (max-width: 640px) and (orientation: portrait)'))

    expect(portraitMedia).to.include('--scene-fit-scale: 0.62')
    expect(tokenSource).to.include('scale(var(--scene-fit-scale, 1))')
    expect(tokenSource).to.include('transform-origin: 50% 100%')
    expect(tokenSource).to.include('.agent-dialogue')
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
      props: {
        agentKey: agent => agent.agentId,
        agentStyle: () => ({}),
        portraitName: agent => agent.name,
        portraitShortName: agent => agent.name,
        portraitStyle: () => ({}),
        roleClass: () => '',
        sceneAgents,
        statusClass: () => '',
        statusText: () => '',
        visibleAgents: []
      }
    })

    clickHandler({ agentId: 'linchong' })

    expect(wrapper.emitted('select-agent')[0]).to.deep.equal([sceneAgents[0]])
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
