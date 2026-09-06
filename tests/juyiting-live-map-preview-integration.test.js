import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { mount } from '@vue/test-utils'
import * as Vue from 'vue'

global.Element = global.window?.Element
global.SVGElement = global.window?.SVGElement
global.Node = global.window?.Node

const vueImportToVar = (_line, imports) => `var { ${imports.split(',').map(part => { const [name, alias] = part.trim().split(/\s+as\s+/); return alias ? `${name}: ${alias}` : name }).join(', ')} } = Vue`
const loadStage = game => {
  const url = new URL('../src/components/juyiting/HallStage.vue', import.meta.url)
  const { descriptor } = parse(readFileSync(url, 'utf8'), { filename: url.pathname })
  const body = compileScript(descriptor, { id: 'live-preview-stage-harness', inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, vueImportToVar)
    .replace(/^import\s+\{\s*juyitingGame\s*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var juyitingGame = game')
    .replace(/^import\s+\{\s*classifyViewportResize\s*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, "var classifyViewportResize = () => 'layout'")
    .replace('export default', 'return')
  return new Function('Vue', 'game', body)(Vue, game)
}
const flush = async () => { for (let i = 0; i < 4; i++) { await Promise.resolve(); await Vue.nextTick() } }
const restoreDescriptor = (target, key, descriptor) => { if (descriptor) Object.defineProperty(target, key, descriptor); else delete target[key] }
const props = { agentBubbles: {}, agentKey: () => '', agentStyle: () => ({}), portraitName: () => '', portraitShortName: () => '', portraitStyle: () => ({}), roleClass: () => '', statusClass: () => '', statusText: () => '', experienceMode: 'portrait-command', readOnlyPreview: true, previewVisible: true }
const fixture = () => {
  const calls = { destroy: 0, draw: [], locks: [], phases: [], ready: 0, reset: 0, targets: 0 }
  let handlers
  const game = {
    beginMapGeneration: () => 1, getSceneBounds: () => ({ x: 0, y: 0, width: 1664, height: 928 }),
    mount: async (_container, next) => { handlers = next }, start: () => {}, destroy: () => { calls.destroy++ },
    setInteractionLocked: (...args) => calls.locks.push(args), applyPreviewContain: () => ({}), clearPreviewContain: () => ({}),
    setPreviewDrawPolicy: value => calls.draw.push(value), clearPreviewDrawPolicy: () => calls.draw.push('clear'),
    getMovementRuntime: () => ({}), enqueueMovementCommands: () => [], cancelMovement: () => {},
    commitViewport: async () => ({}), resizeViewport: () => ({}), syncAgents: () => {}, syncHotspots: () => {}, setSelectedAgent: () => {},
    getCameraSnapshot: () => null, setVirtualViewport: () => {}, getMapGeneration: () => 1, captureResumeSnapshot: () => null,
    setInteractionLocked: (...args) => calls.locks.push(args), focusAgent: () => { calls.targets++; return true }, focusHotspot: () => false
  }
  return { calls, game, get handlers () { return handlers } }
}
describe('live map preview Stage adapter lifecycle', () => {
  it('mounts cold preview without business admission, then admits once and keeps the instance through returns', async () => {
    const f = fixture(); const Stage = loadStage(f.game)
    const globalResize = Object.getOwnPropertyDescriptor(global, 'ResizeObserver')
    const windowResize = Object.getOwnPropertyDescriptor(window, 'ResizeObserver')
    class ResizeObserverStub { constructor (callback) { this.callback = callback } observe () { this.callback([]) } disconnect () {} }
    Object.defineProperty(global, 'ResizeObserver', { configurable: true, value: ResizeObserverStub })
    Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: ResizeObserverStub })
    const globalRaf = Object.getOwnPropertyDescriptor(global, 'requestAnimationFrame')
    const windowRaf = Object.getOwnPropertyDescriptor(window, 'requestAnimationFrame')
    const globalCancel = Object.getOwnPropertyDescriptor(global, 'cancelAnimationFrame')
    const windowCancel = Object.getOwnPropertyDescriptor(window, 'cancelAnimationFrame')
    const frames = new Map(); let nextFrame = 1
    const requestFrame = callback => { const id = nextFrame++; frames.set(id, callback); return id }
    const cancelFrame = id => frames.delete(id)
    // completePreviewExit first awaits nextTick before it schedules RAF. Always
    // flush microtasks before inspecting the queue so the fixture cannot miss
    // that first frame merely because the queue was initially empty.
    const pump = async (limit = 12) => {
      for (let i = 0; i < limit; i++) {
        await flush()
        const queued = [...frames.entries()]
        if (!queued.length) continue
        frames.clear()
        queued.forEach(([, callback]) => callback(i * 16))
      }
    }
    const settleUntil = async (predicate, limit = 24) => {
      for (let i = 0; i < limit; i++) {
        if (predicate()) return true
        await pump(1)
      }
      return predicate()
    }
    Object.defineProperty(global, 'requestAnimationFrame', { configurable: true, value: requestFrame })
    Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, value: requestFrame })
    Object.defineProperty(global, 'cancelAnimationFrame', { configurable: true, value: cancelFrame })
    Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, value: cancelFrame })
    let wrapper
    try {
      const states = []
      wrapper = mount(Stage, { attachTo: document.body, props: { ...props, onSceneStateChange: value => states.push(value) }, global: { stubs: { 'var-icon': true } } })
      const container = wrapper.get('.melon-layer').element
      container.getBoundingClientRect = () => ({ width: 390, height: 720, top: 0, left: 0, right: 390, bottom: 720 })
      await flush(); f.handlers.onReady(); await pump(); expect(states).to.include('ready')
    expect(wrapper.emitted('simulation-ready')).to.equal(undefined)
    f.handlers.onSimulationPhaseEvents([{ id: 'cold-terminal' }]); await pump()
    expect(wrapper.emitted('simulation-phase-events')).to.equal(undefined)
    expect(f.calls.destroy).to.equal(0)
    expect(f.calls.locks.some(([, reason]) => reason === 'preview')).to.equal(true)
    await wrapper.setProps({ experienceMode: 'landscape-map', readOnlyPreview: false })
    expect(await settleUntil(() => wrapper.emitted('simulation-ready')?.length === 1)).to.equal(true)
    expect(wrapper.emitted('simulation-ready')).to.have.length(1)
    await wrapper.setProps({ experienceMode: 'portrait-command', readOnlyPreview: true }); f.handlers.onSimulationPhaseEvents([{ id: 'terminal' }]); await pump()
    await wrapper.setProps({ experienceMode: 'portrait-command', readOnlyPreview: true }); await wrapper.setProps({ experienceMode: 'landscape-map', readOnlyPreview: false }); await wrapper.setProps({ experienceMode: 'portrait-command', readOnlyPreview: true }); await flush()
    expect(wrapper.emitted('simulation-ready')).to.have.length(1)
    expect(wrapper.emitted('simulation-phase-events')).to.have.length(1)
    expect(f.calls.destroy).to.equal(0)
    wrapper.unmount(); expect(f.calls.destroy).to.equal(1)
    } finally { if (wrapper?.exists?.()) wrapper.unmount(); frames.clear(); restoreDescriptor(global, 'ResizeObserver', globalResize); restoreDescriptor(window, 'ResizeObserver', windowResize); restoreDescriptor(global, 'requestAnimationFrame', globalRaf); restoreDescriptor(window, 'requestAnimationFrame', windowRaf); restoreDescriptor(global, 'cancelAnimationFrame', globalCancel); restoreDescriptor(window, 'cancelAnimationFrame', windowCancel) }
  })
})

const loadHallPage = mocks => {
  const url = new URL('../src/components/world/JuyiHall.vue', import.meta.url)
  const { descriptor } = parse(readFileSync(url, 'utf8'), { filename: url.pathname })
  const body = compileScript(descriptor, { id: 'live-preview-page-harness', inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, vueImportToVar)
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"];?\s*$/gm, (_line, imports) => `var { ${imports} } = mocks`)
    .replace(/^import\s+(\w+)\s+from\s+['"][^'"]+['"];?\s*$/gm, (_line, name) => `var ${name} = mocks.${name}`)
    .replace(/import\.meta\.env/g, 'mocks.env')
    .replace('export default', 'return')
  return new Function('Vue', 'mocks', body)(Vue, mocks)
}

const makeHallPageMocks = ({ mode, counters }) => {
  const noop = () => {}
  const asyncNoop = async () => {}
  const list = Vue.ref([])
  const text = Vue.ref('')
  const HallPortraitHome = Vue.defineComponent({
    emits: ['live-preview-visibility-change', 'retry-live-preview', 'quick-action'],
    setup (_props, { attrs, emit, expose }) {
      const livePreviewTarget = Vue.ref(null)
      expose({ livePreviewTarget })
      return () => Vue.h('section', { ...attrs, class: 'preview-home' }, [
        Vue.h('div', { ref: livePreviewTarget, class: 'preview-target' }),
        Vue.h('button', { type: 'button', class: 'portrait-quick-agents', onClick: () => emit('quick-action', 'agents') }, 'agents'),
        Vue.h('button', { type: 'button', class: 'portrait-quick-discussion', onClick: () => emit('quick-action', 'discussion') }, 'discussion')
      ])
    }
  })
  const HallStage = Vue.defineComponent({
    props: { readOnlyPreview: Boolean, previewVisible: Boolean },
    emits: ['scene-state-change', 'scene-bounds-change', 'scene-error'],
    setup (props, { attrs, expose }) {
      counters.stageMounts += 1
      expose({ retryScene: () => { counters.retries += 1 } })
      return () => Vue.h('section', { ...attrs, class: 'preview-stage', 'data-preview': String(props.readOnlyPreview), 'data-visible': String(props.previewVisible) })
    }
  })
  const Empty = Vue.defineComponent({ setup: () => () => Vue.h('section') })
  counters.PortraitHome = HallPortraitHome
  const data = {
    applySceneEvent: noop, applySceneSnapshot: noop, agentFilter: text, agents: list, bindPersona: asyncNoop, canAssign: () => true,
    filteredAgents: list, hiddenAgentCount: Vue.ref(0), loadAgents: asyncNoop, loadTasks: asyncNoop, loadTaskRecommendations: asyncNoop,
    mapAgents: list, personaCatalog: list, recommendedAgents: list, setAgentFilter: noop, setTaskStatusFilter: noop,
    taskAbilityFilter: text, taskAbilityOptions: list, taskKeyword: text, tasks: list, taskStatusCount: Vue.ref({}), taskStatusFilter: text, unbindPersona: asyncNoop, visibleAgents: list
  }
  return {
    env: {}, agentApi: {}, chatApi: {}, juyitingGame: {}, log: { warn: noop }, roleDialogues: { default: [''] }, statusFilters: [], taskStatusFilters: [],
    useGlobalStore: () => ({ setTitle: noop, setShowBack: noop, setShowAppBar: noop, setShowMore: noop }), useApiStore: () => ({}),
    useHallData: () => data, useHallBackendSceneState: () => ({ start: asyncNoop, stop: noop, dispose: noop, reportPhase: noop }),
    useHallSceneDebugBridge: () => ({ republish: noop, stop: noop }), useHallExperienceMode: () => ({ experienceMode: mode, isMobileCoarse: Vue.ref(true), isVirtualLandscape: Vue.ref(false), orientationHint: text, orientationRequestPending: Vue.ref(false), hallViewportHeight: Vue.ref(0), requestLandscape: asyncNoop, requestPortrait: asyncNoop }),
    capturePanelReturnTarget: noop, focusHallPanel: noop, isCurrentPanelGeneration: () => false, isSafePanelFocusTarget: () => false, resolvePanelReturnTarget: noop, restorePanelFocus: noop, trapPanelFocus: noop, useHallPanels: () => ({ panelLayout: Vue.ref('bottom-drawer') }),
    useHallScene: () => ({ markAgentSpeaking: noop, markDiscussionStarted: noop, markLibraryCitation: noop, markLibrarySearching: noop, markRecommendedAgents: noop, markTaskArchived: noop, markTaskAssigned: noop, markTaskAutoAssigned: noop, markTaskCreated: noop, resetSceneFeedback: noop, sceneAgents: list, sceneAgentStyle: () => ({}), sceneHotspots: list, syncAfterPersonaChanged: noop }),
    useHallSceneState: () => ({ setMapRuntime: noop, reset: noop, forwardPhaseEvents: asyncNoop }), useHallCommandQueue: () => ({ ready: Vue.ref(false), setSimulation: noop }),
    useHallChatContext: () => ({ chatContext: Vue.ref({}), chatMentionAgentIds: list, chatMentionAgents: list, chatMode: text, chatTargetText: text, enterBountyDiscussion: noop, enterPrivateConversation: noop, resetToPublic: noop, setMentionAgent: noop }),
    useHallSound: () => ({ playAgentSelect: noop, playError: noop, playPanelOpen: noop, playRefresh: noop, playSend: noop, playSuccess: noop, playTap: noop, setSoundEnabled: noop, setSoundSuppressed: noop, soundEnabled: Vue.ref(false) }),
    useHallTaskActions: () => ({ archiveTask: asyncNoop, autoAssignTask: asyncNoop, assignTask: asyncNoop, createTask: asyncNoop }),
    useHallConversation: () => ({ cancelHallReplyTurn: noop, chatConnectionStatus: text, conversationId: text, draft: text, eventStreamRecovering: Vue.ref(false), insertAgentMention: noop, isAwaitingReply: Vue.ref(false), isStreaming: Vue.ref(false), loadHallMessages: asyncNoop, mentionAgent: noop, messages: list, newHallConversation: noop, pendingAgentName: text, replyEventSequence: Vue.ref(0), sendHallMessage: asyncNoop, senderText: text, disposeHallConversation: noop, draftRevision: Vue.ref(0), setDraft: noop, stopHallEventStream: noop, stopHallReplyPolling: noop, stopHallReplyStreaming: noop }),
    useHallVoiceConversation: () => ({ voiceInteractionLocked: Vue.ref(false), cancel: noop, dispose: noop, applyTranscript: noop }), createHallVoiceReplyCorrelation: () => ({ close: noop, closeIfCurrent: () => false, start: () => true, observe: noop, resolveConversation: noop }),
    useHallLibrary: () => ({ citeLibraryItem: noop, libraryErrorMessage: text, libraryHasSearched: Vue.ref(false), libraryKeyword: text, libraryLoading: Vue.ref(false), libraryResults: list, librarySourceType: text, searchLibrary: asyncNoop }),
    isTaskWorkspaceBuildEnabled: () => false, createDisabledTaskWorkspaceBinding: () => ({ selectExplicitActor: noop, clearExplicitActor: noop, dispose: noop }), useTaskWorkspaceView: () => ({ subject: Vue.ref(null), workspace: Vue.ref(null), connectionState: text, error: Vue.ref(null), retry: noop }), useTaskWorkspace: noop, useTaskWorkspaceBinding: () => ({ selectExplicitActor: noop, clearExplicitActor: noop, dispose: noop }),
    portraitName: () => '', portraitRole: () => ({ slug: 'default' }), portraitShortName: () => '', portraitStyle: () => ({}), roleClass: () => '',
    HallPortraitHome, HallStage, HallVoiceHud: Empty, AgentPanel: Empty, BountyDiscussionPanel: Empty, BountyPanel: Empty, TaskWorkspacePanel: Empty, PersonaCatalogPanel: Empty, PrivateDiscussionPanel: Empty, PublicDiscussionPanel: Empty, SelectedAgentCard: Empty, LibraryPanel: Empty
  }
}

describe('live map preview Hall page bridge', () => {
  it('waits for document and observed portrait visibility, then keeps one teleported Stage across landscape and retry', async () => {
    const originalHidden = Object.getOwnPropertyDescriptor(document, 'hidden')
    const originalVisibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState')
    const globalRaf = Object.getOwnPropertyDescriptor(global, 'requestAnimationFrame')
    const globalCancel = Object.getOwnPropertyDescriptor(global, 'cancelAnimationFrame')
    const windowRaf = Object.getOwnPropertyDescriptor(window, 'requestAnimationFrame')
    const windowCancel = Object.getOwnPropertyDescriptor(window, 'cancelAnimationFrame')
    let hidden = true
    const frames = new Map(); let nextFrame = 1
    const requestFrame = callback => { const id = nextFrame++; frames.set(id, callback); return id }
    const cancelFrame = id => frames.delete(id)
    const pump = async (limit = 12) => {
      for (let step = 0; step < limit; step += 1) {
        await flush()
        const queued = [...frames.entries()]
        if (!queued.length) continue
        frames.clear()
        queued.forEach(([, callback]) => callback(step * 16))
      }
    }
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' })
    Object.defineProperty(global, 'requestAnimationFrame', { configurable: true, value: requestFrame })
    Object.defineProperty(global, 'cancelAnimationFrame', { configurable: true, value: cancelFrame })
    Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, value: requestFrame })
    Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, value: cancelFrame })
    const mode = Vue.ref('portrait-command')
    const counters = { stageMounts: 0, retries: 0 }
    const Hall = loadHallPage(makeHallPageMocks({ mode, counters }))
    let wrapper
    try {
      wrapper = mount(Hall, { attachTo: document.body, global: { stubs: { 'var-icon': true, transition: false } } })
      await flush(); await pump()
      expect(counters.stageMounts).to.equal(0)
      expect(wrapper.find('.preview-target').exists()).to.equal(true)
      const portrait = wrapper.findComponent(counters.PortraitHome)
      portrait.vm.$emit('live-preview-visibility-change', true)
      await flush(); await pump()
      // The real document guard prevents a hidden tab from creating Stage.
      expect(counters.stageMounts).to.equal(0)
      hidden = false
      document.dispatchEvent(new window.Event('visibilitychange'))
      await flush(); await pump()
      expect(counters.stageMounts).to.equal(1)
      const stage = document.body.querySelector('.preview-stage')
      expect(stage?.parentElement?.classList.contains('preview-target')).to.equal(true)
      expect(stage?.dataset.preview).to.equal('true')
      expect(stage?.dataset.visible).to.equal('true')
      hidden = true
      document.dispatchEvent(new window.Event('visibilitychange'))
      await flush(); await pump()
      expect(document.body.querySelector('.preview-stage')?.dataset.visible).to.equal('false')
      hidden = false
      document.dispatchEvent(new window.Event('visibilitychange'))
      await flush(); await pump()
      expect(document.body.querySelector('.preview-stage')?.dataset.visible).to.equal('true')

      // Exercise the actual portrait quick-action and page close controls rather
      // than relying on compiler-private setupState implementation details.
      await portrait.find('.portrait-quick-agents').trigger('click')
      await flush(); await pump()
      expect(wrapper.find('.panel-overlay').exists()).to.equal(true)
      expect(wrapper.find('.panel-overlay').classes()).not.to.include('is-chat-overlay')
      expect(document.body.querySelector('.preview-stage')?.dataset.visible).to.equal('true')
      await wrapper.find('.panel-close').trigger('click')
      await flush(); await pump()
      expect(wrapper.find('.panel-overlay').exists()).to.equal(false)
      expect(document.body.querySelector('.preview-stage')?.dataset.visible).to.equal('true')

      await portrait.find('.portrait-quick-discussion').trigger('click')
      await flush(); await pump()
      expect(wrapper.find('.panel-overlay').classes()).to.include('is-chat-overlay')
      expect(document.body.querySelector('.preview-stage')?.dataset.visible).to.equal('false')
      await wrapper.find('.panel-close').trigger('click')
      await flush(); await pump()
      expect(wrapper.find('.panel-overlay').exists()).to.equal(false)
      expect(document.body.querySelector('.preview-stage')?.dataset.visible).to.equal('true')

      mode.value = 'landscape-map'; await flush(); await pump()
      expect(counters.stageMounts).to.equal(1)
      expect(document.body.querySelector('.preview-stage')?.parentElement?.classList.contains('hall-live-landscape-target')).to.equal(true)
      expect(document.body.querySelector('.preview-stage')?.dataset.preview).to.equal('false')
      mode.value = 'portrait-command'; await flush(); await pump()
      expect(counters.stageMounts).to.equal(1)
      portrait.vm.$emit('retry-live-preview'); await flush(); await pump()
      expect(counters.retries).to.equal(1)
    } finally {
      wrapper?.unmount()
      frames.clear()
      restoreDescriptor(document, 'hidden', originalHidden)
      restoreDescriptor(document, 'visibilityState', originalVisibilityState)
      restoreDescriptor(global, 'requestAnimationFrame', globalRaf)
      restoreDescriptor(global, 'cancelAnimationFrame', globalCancel)
      restoreDescriptor(window, 'requestAnimationFrame', windowRaf)
      restoreDescriptor(window, 'cancelAnimationFrame', windowCancel)
    }
  })
})

const loadPreview = () => {
  const url = new URL('../src/components/juyiting/HallLiveMapPreview.vue', import.meta.url)
  const { descriptor } = parse(readFileSync(url, 'utf8'), { filename: url.pathname })
  const body = compileScript(descriptor, { id: 'live-preview-status-harness', inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, vueImportToVar)
    .replace('export default', 'return')
  return new Function('Vue', body)(Vue)
}

describe('live map preview status ownership', () => {
  it('keeps a failed nested Stage retry hidden in preview and delegates one outer retry', async () => {
    const Preview = loadPreview()
    let mounts = 0
    const game = {
      beginMapGeneration: () => 1, mount: async () => { mounts += 1; throw new Error('map failed') }, destroy: () => {},
      setInteractionLocked: () => {}, clearPreviewContain: () => {}, clearPreviewDrawPolicy: () => {}, getSceneBounds: () => null
    }
    const Stage = loadStage(game)
    const Harness = Vue.defineComponent({
      setup () {
        const state = Vue.ref('loading'); const error = Vue.ref(''); const stage = Vue.ref(null)
        return () => Vue.h(Preview, {
          state: state.value, errorMessage: error.value,
          onRetry: () => stage.value?.retryScene?.(),
          onSceneError: cause => { state.value = 'error'; error.value = cause?.message || 'map failed' }
        }, { default: () => Vue.h(Stage, { ref: stage, ...props, readOnlyPreview: true, onSceneError: cause => { state.value = 'error'; error.value = cause?.message || 'map failed' } }) })
      }
    })
    const wrapper = mount(Harness, { attachTo: document.body, global: { stubs: { 'var-icon': true } } })
    try {
      await flush()
      expect(wrapper.find('.scene-error').exists()).to.equal(false)
      expect(wrapper.findAll('button').map(button => button.text())).to.include('重试地图预览')
      await wrapper.findAll('button').find(button => button.text() === '重试地图预览').trigger('click')
      await flush()
      expect(mounts).to.equal(2)
    } finally { wrapper.unmount() }
  })
})

const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('live map preview orientation target transaction', () => {
  it('consumes a preview-queued target only after stable viewport commit and fences a reversed transition', async () => {
    const f = fixture(); const Stage = loadStage(f.game)
    const originalRaf = Object.getOwnPropertyDescriptor(window, 'requestAnimationFrame')
    const originalCancel = Object.getOwnPropertyDescriptor(window, 'cancelAnimationFrame')
    const originalResize = Object.getOwnPropertyDescriptor(window, 'ResizeObserver')
    const frames = new Map(); let frame = 0
    const commits = []; const targets = []; let pendingCommit = null
    class ResizeObserverStub { constructor (callback) { this.callback = callback } observe () { this.callback([]) } disconnect () {} }
    Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: ResizeObserverStub })
    window.requestAnimationFrame = callback => { frames.set(++frame, callback); return frame }
    window.cancelAnimationFrame = id => frames.delete(id)
    f.game.commitViewport = change => { commits.push(change); return pendingCommit ? pendingCommit.promise : Promise.resolve({ committed: true }) }
    f.game.syncAgentsAndFocusAgent = (_agents, id) => { targets.push(id); return true }
    let wrapper
    const pump = async (limit = 12) => {
      for (let step = 0; step < limit; step += 1) {
        await flush()
        const current = [...frames.entries()]
        if (!current.length) continue
        frames.clear()
        current.forEach(([, callback]) => callback(step * 16))
      }
    }
    const entry = generation => ({ generation, target: { kind: 'agent', agentId: 'agent-1' } })
    try {
      wrapper = mount(Stage, { attachTo: document.body, props: { ...props, landscapeEntryTarget: entry(1), sceneAgents: [{ agentId: 'agent-1' }] }, global: { stubs: { 'var-icon': true } } })
      wrapper.get('.melon-layer').element.getBoundingClientRect = () => ({ width: 390, height: 720, top: 0, left: 0, right: 390, bottom: 720 })
      await flush(); f.handlers.onReady(); await pump()
      pendingCommit = deferred()
      await wrapper.setProps({ experienceMode: 'landscape-map', readOnlyPreview: false }); await pump()
      expect(targets).to.deep.equal([])
      expect(f.calls.locks).to.deep.include([true, 'preview-transition'])
      expect(f.calls.locks).not.to.deep.include([false, 'preview'])
      pendingCommit.resolve({ committed: true }); await flush(); await pump()
      expect(targets).to.deep.equal(['agent-1'])
      expect(f.calls.locks).to.deep.include([false, 'preview'])
      expect(commits.length).to.be.greaterThan(1)

      pendingCommit = deferred()
      await wrapper.setProps({ experienceMode: 'portrait-command', readOnlyPreview: true, landscapeEntryTarget: entry(2) })
      await wrapper.setProps({ experienceMode: 'landscape-map', readOnlyPreview: false }); await pump()
      const lockCountBeforeReverse = f.calls.locks.length
      await wrapper.setProps({ experienceMode: 'portrait-command', readOnlyPreview: true })
      pendingCommit.resolve(false); await flush(); await pump()
      expect(targets).to.deep.equal(['agent-1'])
      expect(f.calls.destroy).to.equal(0)
      expect(f.calls.locks.slice(lockCountBeforeReverse)).not.to.deep.include([false, 'preview'])

      pendingCommit = deferred()
      await wrapper.setProps({ experienceMode: 'landscape-map', readOnlyPreview: false, landscapeEntryTarget: entry(3) })
      // The target watcher runs in this same batch; it must remain fenced until
      // the preview exit has committed its stable landscape viewport.
      expect(targets).to.deep.equal(['agent-1'])
      await pump()
      const lockCountBeforeReject = f.calls.locks.length
      await wrapper.setProps({ experienceMode: 'portrait-command', readOnlyPreview: true })
      pendingCommit.reject(new Error('late viewport rejection')); await flush(); await pump()
      expect(targets).to.deep.equal(['agent-1'])
      expect(f.calls.destroy).to.equal(0)
      expect(f.calls.locks.slice(lockCountBeforeReject)).not.to.deep.include([false, 'preview'])
    } finally {
      wrapper?.unmount()
      frames.clear()
      restoreDescriptor(window, 'requestAnimationFrame', originalRaf)
      restoreDescriptor(window, 'cancelAnimationFrame', originalCancel)
      restoreDescriptor(window, 'ResizeObserver', originalResize)
    }
  })
})
