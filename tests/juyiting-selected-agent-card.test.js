import { readFileSync } from 'fs'
import { expect } from 'chai'
import { compileScript, parse } from '@vue/compiler-sfc'
import { mount } from '@vue/test-utils'
import * as Vue from 'vue'

global.SVGElement = global.window?.SVGElement
global.Element = global.window?.Element
global.Node = global.window?.Node

const cardSource = readFileSync(
  new URL('../src/components/juyiting/SelectedAgentCard.vue', import.meta.url),
  'utf8'
)
const hallSource = readFileSync(
  new URL('../src/components/world/JuyiHall.vue', import.meta.url),
  'utf8'
)
const hallStageSource = readFileSync(
  new URL('../src/components/juyiting/HallStage.vue', import.meta.url),
  'utf8'
)
const bountySource = readFileSync(
  new URL('../src/components/juyiting/BountyPanel.vue', import.meta.url),
  'utf8'
)

const cssRule = (source, selector) => {
  const matches = [...source.matchAll(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{[^}]+\\}`, 'g'))]
  return matches.map(match => match[0]).join('\n')
}


const vueImportToVar = (_line, imports) => {
  const bindings = imports.split(',').map(part => {
    const [name, alias] = part.trim().split(/\s+as\s+/)
    return alias ? `${name}: ${alias}` : name
  }).join(', ')
  return `var { ${bindings} } = Vue`
}

const loadSelectedAgentCard = () => {
  const filename = new URL('../src/components/juyiting/SelectedAgentCard.vue', import.meta.url).pathname
  const { descriptor } = parse(cardSource, { filename })
  const body = compileScript(descriptor, {
    id: 'selected-agent-card-behavior',
    inlineTemplate: true,
    templateOptions: { compilerOptions: { isCustomElement: tag => tag === 'var-icon' } }
  }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, vueImportToVar)
    .replace('export default', 'return')
  return new Function('Vue', body)(Vue)
}

const loadActualJuyiHall = mocks => {
  const filename = new URL('../src/components/world/JuyiHall.vue', import.meta.url).pathname
  const { descriptor } = parse(hallSource, { filename })
  const body = compileScript(descriptor, { id: 'selected-agent-card-hall', inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, vueImportToVar)
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"];?\s*$/gm, (_line, imports) => `var { ${imports} } = mocks`)
    .replace(/^import\s+(\w+)\s+from\s+['"][^'"]+['"];?\s*$/gm, (_line, name) => `var ${name} = mocks.${name}`)
    .replace(/import\.meta\.env/g, 'mocks.env')
    .replace('export default', 'return')
  return new Function('Vue', 'mocks', body)(Vue, mocks)
}

const createHallMocks = ({ SelectedAgentCard, counters }) => {
  const noop = () => {}
  const asyncNoop = async () => {}
  const list = Vue.ref([])
  const text = Vue.ref('')
  const selected = { agentId: 'wuyong', name: '吴用', personaName: '智多星', status: 'idle', boundToMe: true, canOperate: true, systemAgent: false }
  const HallStage = Vue.defineComponent({ inheritAttrs: false, setup: (_props, { attrs, slots }) => () => Vue.h('section', { ...attrs, class: 'hall-board' }, slots.default?.()) })
  const EmptyPanel = Vue.defineComponent({ setup: () => () => Vue.h('section') })
  const hallData = {
    applySceneEvent: noop, applySceneSnapshot: noop, agentFilter: text, agents: Vue.ref([selected]), bindPersona: asyncNoop, canAssign: () => true,
    filteredAgents: Vue.ref([selected]), hiddenAgentCount: Vue.ref(0), loadAgents: asyncNoop, loadTasks: asyncNoop, loadTaskRecommendations: asyncNoop,
    mapAgents: Vue.ref([selected]), personaCatalog: list, recommendedAgents: list, setAgentFilter: asyncNoop, setTaskStatusFilter: asyncNoop,
    taskAbilityFilter: text, taskAbilityOptions: list, taskKeyword: text, tasks: list, taskStatusCount: Vue.ref({}), taskStatusFilter: text,
    unbindPersona: asyncNoop, visibleAgents: Vue.ref([selected])
  }
  const conversationDraft = Vue.ref('旧话头')
  return {
    env: {}, capturePanelReturnTarget: () => null, focusHallPanel: noop, isCurrentPanelGeneration: () => true, isSafePanelFocusTarget: () => false,
    resolvePanelReturnTarget: () => null, restorePanelFocus: noop, trapPanelFocus: noop,
    useGlobalStore: () => ({ setTitle: noop, setShowBack: noop, setShowAppBar: noop, setShowMore: noop }), useApiStore: () => ({}),
    agentApi: {}, chatApi: {}, log: { warn: noop }, juyitingGame: {}, roleDialogues: { default: [''] }, statusFilters: [], taskStatusFilters: [],
    useHallData: ({ selectedAgent }) => { selectedAgent.value = selected; return hallData },
    useHallExperienceMode: () => ({ experienceMode: Vue.ref('landscape-map'), isMobileCoarse: Vue.ref(false), orientationHint: text, orientationRequestPending: Vue.ref(false), requestLandscape: asyncNoop }),
    useHallPanels: () => ({ panelLayout: Vue.ref('center-modal') }),
    useHallSceneState: () => ({ setMapRuntime: noop, reset: noop, forwardPhaseEvents: asyncNoop }), useHallCommandQueue: () => ({ ready: Vue.ref(false), setSimulation: noop }),
    useHallBackendSceneState: () => ({ start: asyncNoop, stop: noop, dispose: noop, reportPhase: noop }), useHallSceneDebugBridge: () => ({ republish: noop, stop: noop }),
    useHallSound: () => ({ playAgentSelect: noop, playError: noop, playPanelOpen: noop, playRefresh: noop, playSend: noop, playSuccess: noop, playTap: noop, setSoundEnabled: noop, setSoundSuppressed: noop, soundEnabled: Vue.ref(false) }),
    useHallChatContext: () => ({ chatContext: Vue.ref({ conversationScopeType: 'public', conversationScopeKey: 'public', mode: 'public', participantAgentIds: [], targetAgentIds: [] }), chatMentionAgentIds: list, chatMentionAgents: Vue.ref([selected]), chatMode: Vue.ref('public'), chatTargetText: text, enterBountyDiscussion: noop, enterPrivateConversation: agent => counters.privateTargets.push(agent), resetToPublic: noop, setMentionAgent: noop }),
    useHallScene: () => ({ markAgentSpeaking: noop, markDiscussionStarted: noop, markLibraryCitation: noop, markLibrarySearching: noop, markRecommendedAgents: noop, markTaskArchived: noop, markTaskAssigned: noop, markTaskAutoAssigned: noop, markTaskCreated: noop, resetSceneFeedback: noop, sceneAgents: Vue.ref([selected]), sceneAgentStyle: () => ({}), sceneHotspots: list, syncAfterPersonaChanged: noop }),
    useHallTaskActions: () => ({ archiveTask: asyncNoop, autoAssignTask: asyncNoop, assignTask: asyncNoop, createTask: asyncNoop }),
    useHallConversation: () => ({ chatConnectionStatus: text, conversationId: text, draft: conversationDraft, draftRevision: Vue.ref(0), eventStreamRecovering: Vue.ref(false),
      insertAgentMention: (agent, suffix) => { counters.mentions.push({ agent, suffix }); conversationDraft.value = `@${agent.name} ${suffix}` },
      isAwaitingReply: Vue.ref(false), isStreaming: Vue.ref(false), loadHallMessages: asyncNoop, mentionAgent: noop, messages: list, newHallConversation: noop,
      pendingAgentName: text, replyEventSequence: Vue.ref(0), sendHallMessage: asyncNoop, senderText: () => '',
      setDraft: value => { counters.drafts.push(value); conversationDraft.value = value }, disposeHallConversation: noop, stopHallEventStream: noop, stopHallReplyPolling: noop, stopHallReplyStreaming: noop }),
    useHallVoiceConversation: () => ({ supported: false, voiceInteractionLocked: false, cancel: noop, dispose: noop, applyTranscript: noop }),
    createHallVoiceReplyCorrelation: () => ({ start: () => true, observe: noop, resolveConversation: () => true, close: noop }),
    useHallLibrary: () => ({ citeLibraryItem: noop, libraryErrorMessage: text, libraryHasSearched: Vue.ref(false), libraryKeyword: text, libraryLoading: Vue.ref(false), libraryResults: list, librarySourceType: text, searchLibrary: asyncNoop }),
    useTaskWorkspace: () => null, createDisabledTaskWorkspaceBinding: () => ({ selectExplicitActor: agent => counters.explicitActors.push(agent), clearExplicitActor: noop, dispose: noop }),
    isTaskWorkspaceBuildEnabled: () => false, useTaskWorkspaceView: () => ({ subject: Vue.ref(null), workspace: Vue.ref(null), connectionState: text, error: Vue.ref(null), retry: noop }), useTaskWorkspaceBinding: () => ({ selectExplicitActor: noop, clearExplicitActor: noop }),
    portraitName: agent => agent?.personaName || '', portraitRole: () => ({ slug: 'default' }), portraitShortName: agent => agent?.name || '', portraitStyle: () => ({}), roleClass: () => '',
    HallPortraitHome: EmptyPanel, HallStage, HallVoiceHud: EmptyPanel, LibraryPanel: EmptyPanel, AgentPanel: EmptyPanel, BountyDiscussionPanel: EmptyPanel,
    BountyPanel: EmptyPanel, TaskWorkspacePanel: EmptyPanel, PersonaCatalogPanel: EmptyPanel, PrivateDiscussionPanel: EmptyPanel, PublicDiscussionPanel: EmptyPanel, SelectedAgentCard
  }
}

const flushMounted = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Vue.nextTick()
}

describe('SelectedAgentCard interaction contract', () => {
  it('only renders after an agent is selected', () => {
    expect(cardSource).to.include('v-if="agent"')
  })

  it('emits explicit actions only when the mounted card is unlocked', async () => {
    const SelectedAgentCard = loadSelectedAgentCard()
    const wrapper = mount(SelectedAgentCard, {
      global: { stubs: { 'var-icon': true } },
      props: {
        abilityText: () => '军情推演', agent: { agentId: 'wuyong', name: '吴用', status: 'idle' }, canStartChat: true, locked: true,
        portraitName: () => '智多星', portraitStyle: () => ({}), statusText: () => '候令'
      }
    })
    expect(cardSource).to.include("emitAction('start-chat')")
    expect(wrapper.attributes('inert')).to.equal('')
    expect(wrapper.attributes('aria-disabled')).to.equal('true')
    wrapper.findAll('button').forEach(button => expect(button.attributes('disabled')).to.equal(''))
    await wrapper.find('.card-action.primary').trigger('click')
    await wrapper.findAll('.card-action')[1].trigger('click')
    expect(wrapper.emitted('start-chat')).to.equal(undefined)
    expect(wrapper.emitted('open-agents')).to.equal(undefined)
    await wrapper.setProps({ locked: false })
    expect(wrapper.attributes('inert')).to.equal(undefined)
    expect(wrapper.attributes('aria-disabled')).to.equal(undefined)
    wrapper.findAll('button').forEach(button => expect(button.attributes('disabled')).to.equal(undefined))
    await wrapper.find('.card-action.primary').trigger('click')
    await wrapper.findAll('.card-action')[1].trigger('click')
    expect(wrapper.emitted('start-chat')).to.have.length(1)
    expect(wrapper.emitted('open-agents')).to.have.length(1)
    wrapper.unmount()
  })

  it('renders inside the quick bar instead of as a map overlay', () => {
    const quickBarStart = hallSource.indexOf('<div v-if="selectedAgent" class="quick-bar">')
    const quickBarEnd = hallSource.indexOf('</div>\n    </section>', quickBarStart)
    const quickBarSource = hallSource.slice(quickBarStart, quickBarEnd)
    const cardRule = cssRule(cardSource, '.selected-agent-card')
    expect(quickBarSource).to.include('<SelectedAgentCard')
    expect(cardRule).not.to.include('position: absolute')
    expect(cardRule).not.to.include('bottom: calc')
  })

  it('keeps the selected agent card without rendering the duplicate bottom dock', () => {
    const quickBarStart = hallSource.indexOf('<div v-if="selectedAgent" class="quick-bar">')
    const quickBarEnd = hallSource.indexOf('</div>\n    </section>', quickBarStart)
    const quickBarSource = hallSource.slice(quickBarStart, quickBarEnd)
    expect(quickBarSource).to.include('<SelectedAgentCard')
    expect(quickBarSource).not.to.include('<BottomDock')
    expect(hallSource).not.to.include('import BottomDock')
    expect(quickBarSource).not.to.include('<span class="dock-focus"')
    expect(hallSource).not.to.include('.dock-focus')
  })

  it('uses drag gestures instead of visible map direction controls', () => {
    expect(hallSource).not.to.include('class="map-controls"')
    expect(hallSource).not.to.include('class="map-control"')
    expect(hallSource).not.to.include('.map-controls')
    expect(hallSource).not.to.include('.map-control')
    expect(hallStageSource).to.include('class="melon-layer"')
    expect(hallStageSource).not.to.include('@pointerdown="startMapDrag"')
    expect(hallStageSource).not.to.include('@pointermove="moveMapDrag"')
    expect(hallStageSource).not.to.include('@pointerup="endMapDrag"')
    expect(hallStageSource).not.to.include('@pointercancel="endMapDrag"')
  })

  it('does not auto-select the first loaded agent', () => {
    expect(hallSource).not.to.include('selectedAgent.value = agents.value[0]')
  })

  it('does not depend on the mobile direction controls footprint', () => {
    expect(cardSource).not.to.include('--map-controls-footprint')
    expect(hallSource).not.to.include('--map-controls-footprint')
  })

  it('keeps cards and task panels inside the small-screen viewport', () => {
    const cardRule = cssRule(cardSource, '.selected-agent-card')
    const quickBarRule = cssRule(hallSource, '.quick-bar')
    const panelOverlayRule = cssRule(hallSource, '.panel-overlay')
    const floatingPanelRule = cssRule(hallSource, '.floating-panel')
    const chatOverlayRule = cssRule(hallSource, '.panel-overlay.is-chat-overlay')
    const fullChatRule = hallSource.match(/\.floating-panel\.panel-chat,[\s\S]*?\n}/)?.[0] || ''
    const panelCloseRule = cssRule(hallSource, '.panel-close')
    const taskCardRule = cssRule(bountySource, '.task-card')
    const taskDetailRule = cssRule(bountySource, '.task-detail-card')

    expect(cardRule).to.include('box-sizing: border-box')
    expect(cardRule).to.include('max-width: 100%')
    expect(quickBarRule).to.include('box-sizing: border-box')
    expect(panelOverlayRule).to.include('box-sizing: border-box')
    expect(floatingPanelRule).to.include('box-sizing: border-box')
    expect(floatingPanelRule).to.include('max-width: 100%')
    expect(floatingPanelRule).to.include('width: calc(100% - 16px)')
    expect(hallSource).to.include(":class=\"{ 'is-chat-overlay': renderedPanel === 'chat' }\"")
    expect(chatOverlayRule).to.include('top: 0')
    expect(chatOverlayRule).to.include('bottom: auto')
    expect(chatOverlayRule).to.include('height: min(100%, var(--hall-visual-height, 100%))')
    expect(chatOverlayRule).to.include('align-items: flex-start')
    expect(chatOverlayRule).to.include('padding: 0')
    expect(fullChatRule).to.include('width: 100%')
    expect(fullChatRule).to.include('height: 100%')
    expect(hallSource).not.to.include('--mobile-chat-panel-top-gap')
    expect(panelOverlayRule).not.to.include('bottom: 10px')
    expect(hallSource).not.to.include('height: calc(100dvh - 32px)')
    expect(panelCloseRule).to.include('flex: 0 0 36px')
    expect(taskCardRule).to.include('box-sizing: border-box')
    expect(taskDetailRule).to.include('box-sizing: border-box')
    expect(taskDetailRule).to.include('max-width: 100%')
  })

  it('does not resize the map when the selected agent card appears', () => {
    const quickBarRule = cssRule(hallSource, '.quick-bar')

    expect(quickBarRule).to.include('position: absolute')
    expect(quickBarRule).to.include('left: 0')
    expect(quickBarRule).to.include('right: 0')
    expect(quickBarRule).to.include('bottom: 0')
    expect(quickBarRule).not.to.include('flex: 0 0 auto')
  })

  it('selects an agent without showing a toast', () => {
    const selectAgentStart = hallSource.indexOf('const selectAgent = (agent) => {')
    const selectAgentEnd = hallSource.indexOf('const openPanel', selectAgentStart)
    const selectAgentSource = hallSource.slice(selectAgentStart, selectAgentEnd)

    expect(selectAgentSource).to.include('taskWorkspaceBinding.selectExplicitActor(agent)')
    expect(selectAgentSource).not.to.include('selectedAgent.value = agent')
    expect(selectAgentSource).not.to.include('showToast')
    expect(hallSource).not.to.include('已选中')
    expect(hallSource).not.to.include('\\u5df2\\u9009\\u4e2d')
  })

  it('mounts the Hall card flow through private context, setDraft, and mention insertion', async () => {
    const SelectedAgentCard = loadSelectedAgentCard()
    const counters = { drafts: [], mentions: [], privateTargets: [], explicitActors: [] }
    const JuyiHall = loadActualJuyiHall(createHallMocks({ SelectedAgentCard, counters }))
    const wrapper = mount(JuyiHall, { attachTo: document.body, global: { stubs: { 'var-icon': true } } })
    try {
      await flushMounted()
      const action = wrapper.find('.selected-agent-card .card-action.primary')
      expect(action.exists()).to.equal(true)
      await action.trigger('click')
      await Vue.nextTick()
      expect(counters.privateTargets.map(agent => agent.agentId)).to.deep.equal(['wuyong'])
      expect(counters.explicitActors.map(agent => agent.agentId)).to.deep.equal(['wuyong'])
      expect(counters.drafts).to.deep.equal([''])
      expect(counters.mentions).to.have.length(1)
      expect(counters.mentions[0].agent.agentId).to.equal('wuyong')
      expect(counters.mentions[0].suffix).to.equal('请报眼下动静、可领何榜、还需哪路照应。')
    } finally {
      wrapper.unmount()
    }
  })
})
