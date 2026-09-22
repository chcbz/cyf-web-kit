import { existsSync, readFileSync } from 'fs'
import { expect } from 'chai'
import { compileScript, compileStyle, parse } from '@vue/compiler-sfc'
import { mount } from '@vue/test-utils'
import * as Vue from 'vue'

const portraitHomeUrl = new URL('../src/components/juyiting/HallPortraitHome.vue', import.meta.url)
const hallUrl = new URL('../src/components/world/JuyiHall.vue', import.meta.url)
const portraitHomeSource = readFileSync(portraitHomeUrl, 'utf8').replace(/\r\n/g, '\n')
const hallSource = readFileSync(hallUrl, 'utf8').replace(/\r\n/g, '\n')

global.Element = global.window?.Element
global.SVGElement = global.window?.SVGElement
global.Node = global.window?.Node

const vueImportToVar = (_line, imports) => {
  const bindings = imports.split(',').map(part => {
    const [name, alias] = part.trim().split(/\s+as\s+/)
    return alias ? `${name}: ${alias}` : name
  }).join(', ')
  return `var { ${bindings} } = Vue`
}

const restoreDescriptor = (target, key, descriptor) => { if (descriptor) Object.defineProperty(target, key, descriptor); else delete target[key] }
const previewFixture = Vue.defineComponent({ setup: (_props, { slots }) => () => Vue.h('section', { class: 'preview-frame-fixture' }, slots.default?.()) })
const accountEntryFixture = Vue.defineComponent({ props: ['avatar', 'displayName', 'disabled'], emits: ['open-profile'], template: '<button class="account-entry-fixture" type="button" :disabled="disabled" @click="$emit(\'open-profile\')">个人中心</button>' })

const loadPortraitHome = (HallLiveMapPreview = previewFixture, HallAccountEntry = accountEntryFixture) => {
  const { descriptor } = parse(portraitHomeSource, { filename: portraitHomeUrl.pathname })
  const body = compileScript(descriptor, { id: 'portrait-home-followups', inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, vueImportToVar)
    .replace(/^import\s+(\w+)\s+from\s+['"][^'"]+['"];?\s*$/gm, (_line, name) => `var ${name} = children.${name}`)
    .replace('export default', 'return')
  return new Function('Vue', 'children', body)(Vue, { HallLiveMapPreview, HallAccountEntry })
}

const baseProps = overrides => ({
  agents: [],
  canStartAgentConversation: agent => Boolean(agent?.boundToMe === true && !agent?.systemAgent && agent?.canOperate === true),
  mapAgents: [],
  operableAgents: [],
  statusClass: () => '',
  taskStateClass: () => '',
  taskStatusText: () => '',
  tasks: [],
  ...overrides
})

const quickActions = [
  ['agents', '点将册'],
  ['tasks', '悬赏榜'],
  ['discussion', '厅前议事'],
  ['catalog', '招贤令'],
  ['library', '案卷阁'],
  ['treasure', '百宝箱'],
  ['messages', '消息']
]

describe('HallPortraitHome', () => {
  it('keeps first portrait entry outside the melon stage mount path', () => {
    expect(existsSync(portraitHomeUrl)).to.equal(true)
    expect(hallSource).to.include(`v-show="!experienceReady || experienceMode === 'portrait-command' || isOverviewHome"`)
    expect(hallSource).to.include('v-if="stageMounted"')
    expect(hallSource).to.include('<Teleport :to="stageTarget" :disabled="!stageTarget">')
    expect(hallSource).to.include('const stageHasMounted = ref(false)')
    expect(hallSource).to.include('watch([experienceReady, experienceMode, previewVisible, stageTarget], permitStageMount, { immediate: true })')
    expect(portraitHomeSource).not.to.include('juyitingGame')
    expect(portraitHomeSource).not.to.include('<canvas')
    expect(portraitHomeSource).not.to.include('melon')
    expect(hallSource).to.include('const experienceReady = ref(false)')
    expect(hallSource).to.include('experienceReady.value = true')
    expect(hallSource).not.to.include('juyitingGame.mount')
  })

  it('renders all seven real quick entries and routes them through the page owner', () => {
    expect(portraitHomeSource).to.include('const quickActions = Object.freeze([')
    for (const [key, label] of quickActions) {
      expect(portraitHomeSource).to.include(`{ key: '${key}', label: '${label}'`)
    }
    expect(portraitHomeSource).to.include("emit('quick-action', action.key)")
    expect(hallSource).to.include('const handlePortraitQuickAction = (action) => {')
    expect(hallSource).to.include("handleStagePanelOpen('chat')")
    expect(hallSource).to.include("['agents', 'tasks', 'catalog', 'library', 'treasure', 'messages'].includes(action)")
    expect(hallSource).to.include('openBabaoBox()')
    expect(hallSource).to.match(/<HallStage[\s\S]*?@open-workspace="openBabaoBox"/)
    const refresh = hallSource.match(/const refreshHall = async \([^)]*\) => \{([\s\S]*?)\n\}/)?.[1] || ''
    expect(refresh).to.include('await loadAgents()')
    expect(refresh).not.to.include('await loadMapAgents()')
  })

  it('prioritizes a visible personal-center button in the portrait header while exposing Babao box in shortcuts', async () => {
    const wrapper = mount(loadPortraitHome(), { props: baseProps() })
    try {
      expect(wrapper.get('.portrait-header-account.account-entry-fixture').text()).to.equal('个人中心')
      expect(wrapper.find('.portrait-refresh').exists()).to.equal(false)
      expect(portraitHomeSource).not.to.include('data-tour="portrait-refresh"')
      expect(portraitHomeSource).to.include("{ key: 'treasure', label: '百宝箱'")
      expect(portraitHomeSource).to.include('class="portrait-header-account"')
      expect(portraitHomeSource).to.include('.portrait-header-account :deep(.hall-account-entry)')
      await wrapper.get('.portrait-header-account.account-entry-fixture').trigger('click')
      expect(wrapper.emitted('open-profile')).to.deep.equal([[]])
      await wrapper.get('[data-portrait-action="treasure"]').trigger('click')
      expect(wrapper.emitted('quick-action')).to.deep.equal([['treasure']])
    } finally {
      wrapper.unmount()
    }
  })

  it('opens full view through the page owner and exposes onboarding as a low-prominence existing-menu action', () => {
    const entrySource = readFileSync(new URL('../src/components/world/JuyiHallEntry.vue', import.meta.url), 'utf8')
    expect(portraitHomeSource).to.include("emit('request-landscape')")
    expect(hallSource).to.include('@request-landscape="requestPortraitLandscape"')
    const stageSource = readFileSync(new URL('../src/components/juyiting/HallStage.vue', import.meta.url), 'utf8')
    expect(portraitHomeSource).to.include('class="onboarding-link"')
    expect(portraitHomeSource).to.include("emit('open-onboarding', $event.currentTarget)")
    expect(stageSource).to.include('class="tool-action onboarding-replay"')
    expect(stageSource).to.include('@click="emitOnboarding($event.currentTarget)"')
    expect(stageSource).to.include('const emitOnboarding = target => {')
    expect(stageSource).to.include('if (stageInputLocked.value) return false')
    expect(stageSource).to.include("emit('open-onboarding', target)")
    expect(stageSource).not.to.include("$emit('open-onboarding', $event.currentTarget)")
    expect(hallSource).to.include('@open-onboarding="emit(\'open-onboarding\', $event)"')
    expect(entrySource).to.include('<JuyiHall @open-onboarding="reopen" />')
    expect(entrySource).to.include(':return-focus-target="onboardingReturnFocusTarget"')
    expect(entrySource).to.include('onboardingReturnFocusTarget.value = invoker || null')
    expect(entrySource).not.to.include('class="onboarding-reopen"')
    expect(entrySource).not.to.include('position: fixed')
    expect(portraitHomeSource).not.to.match(/transform:\s*rotate|rotate\(/)
    expect(portraitHomeSource).not.to.include('miniProgram.redirectTo')
    expect(portraitHomeSource).not.to.include('visualViewport')
  })

  it('scrolls the full operation area below the map instead of making todo notices scroll independently', () => {
    const homeStyles = portraitHomeSource.match(/\.hall-portrait-home\s*\{([\s\S]*?)\n\}/)?.[1] || ''
    const belowMapStyles = portraitHomeSource.match(/\.portrait-below-map-scroll\s*\{([\s\S]*?)\n\}/)?.[1] || ''
    const todoListStyles = portraitHomeSource.match(/\.portrait-todo-list\s*\{([\s\S]*?)\n\}/)?.[1] || ''
    const mapEnd = portraitHomeSource.indexOf('</section>', portraitHomeSource.indexOf('class="portrait-scene"'))
    const belowMapStart = portraitHomeSource.indexOf('class="portrait-below-map-scroll"')

    expect(portraitHomeSource).to.include('class="portrait-below-map-scroll" aria-label="地图以下操作区"')
    expect(belowMapStart).to.be.greaterThan(mapEnd)
    expect(homeStyles).to.include('display: flex')
    expect(homeStyles).to.include('flex-direction: column')
    expect(homeStyles).to.include('height: min(100%, var(--hall-visual-height, 100%))')
    expect(homeStyles).to.include('overflow: hidden')
    expect(belowMapStyles).to.include('flex: 1 1 auto')
    expect(belowMapStyles).to.include('min-height: 0')
    expect(belowMapStyles).to.include('overflow-y: auto')
    expect(belowMapStyles).to.include('overscroll-behavior-y: contain')
    expect(todoListStyles).to.not.include('max-height')
    expect(todoListStyles).to.not.include('overflow-y')
  })

  it('opens a tapped todo in the page-owned portrait detail without depending on the bounty-panel watcher', () => {
    const handler = hallSource.match(/const handlePortraitTaskOpen = task => \{([\s\S]*?)\n\}/)?.[1] || ''
    const boardHandler = hallSource.match(/const handlePortraitTaskBoard = \(\) => \{([\s\S]*?)\n\}/)?.[1] || ''
    const discussionHandler = hallSource.match(/const handlePortraitTaskDiscussion = task => \{([\s\S]*?)\n\}/)?.[1] || ''

    expect(portraitHomeSource).to.include("const openTask = task => emit('open-task', task)")
    const overlayStyles = portraitHomeSource.match(/\.portrait-task-overlay\s*\{([\s\S]*?)\n\}/)?.[1] || ''
    const backdropStyles = portraitHomeSource.match(/\.portrait-task-backdrop\s*\{([\s\S]*?)\n\}/)?.[1] || ''
    const sheetStyles = portraitHomeSource.match(/\.portrait-task-detail\s*\{([\s\S]*?)\n\}/)?.[1] || ''

    expect(portraitHomeSource).to.include('taskDetailOpen: Boolean')
    expect(portraitHomeSource).to.include('<div v-if="taskDetailOpen && selectedTask" class="portrait-task-overlay">')
    expect(portraitHomeSource).to.include('class="portrait-task-backdrop"')
    expect(portraitHomeSource).to.match(/<section[\s\S]*?class="portrait-task-detail"[\s\S]*?role="dialog"[\s\S]*?aria-modal="true"/)
    expect(overlayStyles).to.include('position: fixed')
    expect(overlayStyles).to.include('inset: 0')
    expect(overlayStyles).to.include('align-items: flex-end')
    expect(backdropStyles).to.include('position: absolute')
    expect(backdropStyles).to.include('background: rgba(8, 7, 6, 0.68)')
    expect(sheetStyles).to.include('max-height: min(78vh, calc(100dvh - 24px))')
    expect(sheetStyles).to.include('overflow-y: auto')
    expect(sheetStyles).to.include('env(safe-area-inset-bottom)')
    expect(portraitHomeSource).to.include('min-height: 44px')
    expect(portraitHomeSource).to.include('{{ taskStatusText(selectedTask.status) }}')
    expect(portraitHomeSource).to.include('榜号 {{ selectedTask.id }}')
    expect(portraitHomeSource).to.include("selectedTask.description || selectedTask.content || '暂无详情，待厅中议定。'")
    expect(portraitHomeSource).to.include("selectedTask.requiredAbilities?.length ? selectedTask.requiredAbilities.join(' / ') : '不拘本领'")
    expect(portraitHomeSource).to.include("emit('close-task-detail')")
    expect(portraitHomeSource).to.include("emit('open-task-board')")
    expect(portraitHomeSource).to.include("emit('discuss-task', selectedTask)")

    expect(handler).to.include('const selection = selectTask(task)')
    expect(handler).to.include('portraitTaskDetailOpen.value = true')
    expect(handler).not.to.include("openPanel('tasks')")
    expect(handler).not.to.include('nextTick')
    expect(handler.indexOf('selectTask(task)')).to.be.lessThan(handler.indexOf('portraitTaskDetailOpen.value = true'))
    expect(hallSource).to.include('const closePortraitTaskDetail = () => {')
    expect(hallSource).to.include('portraitTaskDetailOpen.value = false')
    expect(boardHandler).to.include('closePortraitTaskDetail()')
    expect(boardHandler).to.include("openPanel('tasks')")
    expect(discussionHandler).to.include('closePortraitTaskDetail()')
    expect(discussionHandler).to.include('discussTask(task)')
    expect(hallSource).to.include("if (mode !== 'portrait-command') closePortraitTaskDetail()")
  })

  it('consumes page-owned map, roster, task, and selected-context state without creating a second session', () => {
    for (const binding of [
      ':agents="agents"',
      ':map-agents="mapAgents"',
      ':operable-agents="operableRosterAgents"',
      ':tasks="tasks"',
      ':selected-agent="selectedAgent"',
      ':selected-task="selectedTask"',
      ':can-start-agent-conversation="canStartAgentConversation"',
      ':task-detail-open="portraitTaskDetailOpen"'
    ]) expect(hallSource).to.include(binding)

    expect(portraitHomeSource).to.include("emit('select-agent', agent)")
    expect(portraitHomeSource).to.include("emit('open-task', task)")
    expect(hallSource).to.include('@start-agent-conversation="handleStartAgentConversation"')
    expect(hallSource).to.include('@open-task="handlePortraitTaskOpen"')
    expect(hallSource).to.include('@close-task-detail="closePortraitTaskDetail"')
    expect(hallSource).to.include('@open-task-board="handlePortraitTaskBoard"')
    expect(hallSource).to.include('@discuss-task="handlePortraitTaskDiscussion"')
    expect(portraitHomeSource).to.not.include('useHallData')
    expect(portraitHomeSource).to.not.include('useHallConversation')
    expect(portraitHomeSource).to.include('defineExpose({ livePreviewTarget })')
  })


  it('renders every eligible current-user roster agent in non-inert preview controls and emits the exact clicked agent', async () => {
    const selected = { agentId: 'linchong', name: '林冲', status: 'online', boundToMe: true, canOperate: true }
    const other = { agentId: 'wuyong', name: '吴用', status: 'busy', boundToMe: true, canOperate: true }
    const mapOnly = { agentId: 'foreign', name: '外来好汉', status: 'online', boundToMe: false, canOperate: false }
    const HallLiveMapPreview = Vue.defineComponent({
      setup: (_props, { slots }) => () => Vue.h('section', { class: 'preview-frame-fixture' }, [
        Vue.h('div', { class: 'preview-map-slot', inert: '' }, slots.default?.()),
        Vue.h('div', { class: 'preview-map-controls' }, slots.controls?.())
      ])
    })
    const wrapper = mount(loadPortraitHome(HallLiveMapPreview), {
      props: baseProps({ livePreviewEnabled: true, mapAgents: [mapOnly], operableAgents: [selected, other], selectedAgent: selected })
    })

    const controls = wrapper.get('.preview-map-controls')
    expect(controls.findAll('.preview-agent-list button')).to.have.length(2)
    const selectedControl = controls.get('.preview-agent-list button')
    expect(selectedControl.attributes('aria-pressed')).to.equal('true')
    expect(controls.findAll('.preview-agent-list button')[1].attributes('aria-pressed')).to.equal('false')
    await selectedControl.trigger('click')
    expect(wrapper.emitted('select-agent')).to.deep.equal([[selected]])
    wrapper.unmount()
  })

  it('mounts an eligible selected-agent private CTA and emits the exact selected agent', async () => {
    const eligible = { agentId: 'wuyong', name: '吴用', boundToMe: true, systemAgent: false, canOperate: true }
    const wrapper = mount(loadPortraitHome(), { props: baseProps({ agents: [eligible], selectedAgent: eligible }) })
    const action = wrapper.get('[data-portrait-action="private-discussion"]')
    expect(action.text()).to.include('与吴用密议')
    await action.trigger('click')
    expect(wrapper.emitted('start-agent-conversation')).to.deep.equal([[eligible]])
    wrapper.unmount()
  })

  it('guides toward point selection when another eligible self-owned agent exists', async () => {
    const system = { agentId: 'songjiang', name: '宋江', boundToMe: true, systemAgent: true, canOperate: true }
    const eligible = { agentId: 'wuyong', name: '吴用', boundToMe: true, systemAgent: false, canOperate: true }
    const wrapper = mount(loadPortraitHome(), { props: baseProps({ agents: [system, eligible], operableAgents: [eligible], selectedAgent: system }) })
    expect(wrapper.find('[data-portrait-action="private-discussion"]').exists()).to.equal(false)
    await wrapper.get('[data-portrait-action="pick-agent"]').trigger('click')
    expect(wrapper.emitted('quick-action')).to.deep.equal([['agents']])
    expect(wrapper.emitted('start-agent-conversation')).to.equal(undefined)
    wrapper.unmount()
  })

  it('guides toward recruitment when there is no eligible private-discussion agent', async () => {
    const foreign = { agentId: 'linchong', name: '林冲', boundToMe: false, systemAgent: false, canOperate: true }
    const wrapper = mount(loadPortraitHome(), { props: baseProps({ agents: [foreign], selectedAgent: foreign }) })
    await wrapper.get('[data-portrait-action="recruit-agent"]').trigger('click')
    expect(wrapper.emitted('quick-action')).to.deep.equal([['catalog']])
    expect(wrapper.emitted('start-agent-conversation')).to.equal(undefined)
    wrapper.unmount()
  })


  it('keeps the keyed shared dialog outside both orientation shells with full-session shielding', () => {
    expect(hallSource).to.match(/<HallPortraitHome[\s\S]*?<Teleport :to="stageTarget"[\s\S]*?<HallStage[\s\S]*?<transition\s+name="panel"/)
    expect(hallSource).to.include('v-if="activePanel" :key="panelSessionGeneration"')
    expect(hallSource).to.include(':data-panel-generation="panelSessionGeneration"')
    expect(hallSource).to.include(':inert="isPanelSessionActive ? \'\' : null"')
    expect(hallSource).to.include(':aria-hidden="isPanelSessionActive ? \'true\' : null"')
    expect(hallSource).to.not.include(':key="experienceMode"')
  })
})


it('reserves a stable live preview target without importing the engine', () => {
  expect(portraitHomeSource).to.include('HallLiveMapPreview')
  expect(portraitHomeSource).to.include('livePreviewTarget')
  expect(portraitHomeSource).to.include('<template #controls>')
  expect(portraitHomeSource).to.include('class="scene-agent-list preview-agent-list"')
  expect(portraitHomeSource).to.include('.scene-empty.preview-scene-empty')
  expect(portraitHomeSource).not.to.include('juyitingGame')
})


it('compiles the stable preview target CSS and mounts a concrete target node', () => {
  const { descriptor } = parse(portraitHomeSource, { filename: portraitHomeUrl.pathname })
  const style = descriptor.styles.find(block => block.scoped)
  const compiled = compileStyle({ source: style.content, filename: portraitHomeUrl.pathname, id: 'portrait-preview-target', scoped: true })
  expect(compiled.errors).to.deep.equal([])
  const normalizedCss = compiled.code.replace(/\s+/g, '')
  expect(normalizedCss).to.include('.portrait-live-preview-target[data-v-portrait-preview-target]')
  expect(normalizedCss).to.include('display:flex')
  expect(normalizedCss).to.include('width:100%')
  expect(normalizedCss).to.include('height:100%')

  const body = compileScript(descriptor, { id: 'portrait-preview-target', inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, vueImportToVar)
    .replace(/^import\s+(\w+)\s+from\s+['"][^'"]+['"];?\s*$/gm, (_line, name) => `var ${name} = children.${name}`)
    .replace('export default', 'return')
  const domDescriptors = Object.fromEntries(['Element', 'SVGElement', 'Node'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.defineProperty(globalThis, 'Element', { configurable: true, value: globalThis.window?.Element })
  Object.defineProperty(globalThis, 'SVGElement', { configurable: true, value: globalThis.window?.SVGElement })
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: globalThis.window?.Node })
  let wrapper
  try {
    const HallLiveMapPreview = Vue.defineComponent({ setup: (_props, { slots }) => () => Vue.h('section', { class: 'preview-frame-fixture' }, slots.default?.()) })
    const PortraitHome = new Function('Vue', 'children', body)(Vue, { HallLiveMapPreview })
    wrapper = mount(PortraitHome, {
      attachTo: document.body,
      props: { livePreviewEnabled: true, canStartAgentConversation: () => false, statusClass: () => '', taskStateClass: () => '', taskStatusText: () => '' }
    })
    const target = wrapper.get('.portrait-live-preview-target')
    expect(target.element.parentElement?.classList.contains('preview-frame-fixture')).to.equal(true)
  } finally {
    wrapper?.unmount()
    for (const [key, descriptor] of Object.entries(domDescriptors)) restoreDescriptor(globalThis, key, descriptor)
  }
})

describe('W05 production overview slot', () => {
  it('replaces filtered-task summaries and counts while preserving the live map and source context', async () => {
    const wrapper = mount(loadPortraitHome(), {
      props: baseProps({ tasks: [{ id: 'filtered-a', title: '榜单过滤结果', status: 'open' }] }),
      slots: { overview: '<section class="independent-overview">独立最近事项</section>' }
    })
    try {
      expect(wrapper.find('.independent-overview').exists()).to.equal(true)
      expect(wrapper.find('.portrait-overview').exists()).to.equal(false)
      expect(wrapper.find('.portrait-todos').exists()).to.equal(false)
      await wrapper.setProps({ tasks: [] })
      expect(wrapper.find('.independent-overview').text()).to.equal('独立最近事项')
      expect(wrapper.find('[data-portrait-action="messages"]').exists()).to.equal(true)
      expect(wrapper.find('.portrait-scene').exists()).to.equal(true)
    } finally { wrapper.unmount() }
  })
})
