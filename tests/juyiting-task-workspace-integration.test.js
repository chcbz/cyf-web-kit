import { expect } from 'chai'
import { readFileSync } from 'fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { useTaskWorkspaceView } from '../src/composables/juyiting/useTaskWorkspaceView.js'
import * as HallPanelHelpers from '../src/composables/juyiting/useHallPanels.js'

const hallSource = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
const hallDataSource = readFileSync(new URL('../src/composables/juyiting/useHallData.js', import.meta.url), 'utf8')
const taskActionsSource = readFileSync(new URL('../src/composables/juyiting/useHallTaskActions.js', import.meta.url), 'utf8')
const panelSource = readFileSync(new URL('../src/components/juyiting/TaskWorkspacePanel.vue', import.meta.url), 'utf8')

let mount
let Vue
let TaskTimeline
let TaskWorkspacePanel
const domGlobalDescriptors = {}

const vueImportToVar = (_line, imports) => {
  const vueBindings = imports.split(',').map(part => {
    const [name, alias] = part.trim().split(/\s+as\s+/)
    return alias ? `${name}: ${alias}` : name
  }).join(', ')
  return vueBindings ? `var { ${vueBindings} } = Vue` : ''
}

const loadSfc = (relativePath, child = null) => {
  const filename = new URL(relativePath, import.meta.url).pathname
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const { descriptor } = parse(source, { filename })
  const id = `test-${relativePath.replace(/[^a-z0-9]/gi, '-')}`
  const script = compileScript(descriptor, { id, inlineTemplate: true }).content
  const scriptBody = script
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, vueImportToVar)
    .replace(/^import\s+TaskTimeline\s+from\s+['"].\/TaskTimeline\.vue['"];?\s*$/gm, 'var TaskTimeline = arguments[1]')
    .replace('export default', 'return')
  return new Function('Vue', 'TaskTimeline', scriptBody)(Vue, child)
}


const loadActualHallForIntegration = (mocks, id) => {
  const relativePath = '../src/components/world/JuyiHall.vue'
  const filename = new URL(relativePath, import.meta.url).pathname
  const { descriptor } = parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'), { filename })
  const body = compileScript(descriptor, { id, inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, vueImportToVar)
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"];?\s*$/gm, (_line, imports) => `var { ${imports} } = mocks`)
    .replace(/^import\s+(\w+)\s+from\s+['"][^'"]+['"];?\s*$/gm, (_line, name) => `var ${name} = mocks.${name}`)
    .replace(/import\.meta\.env/g, 'mocks.env')
    .replace('export default', 'return')
  return new Function('Vue', 'mocks', body)(Vue, mocks)
}

const createHallIntegrationMocks = ({ mode, LibraryPanel, TaskWorkspacePanel, workspaceState = null, counters }) => {
  const noop = () => {}
  const asyncNoop = async () => {}
  const list = Vue.ref([])
  const text = Vue.ref('')
  const EmptyPanel = Vue.defineComponent({ setup: () => () => Vue.h('section') })
  const HallPortraitHome = Vue.defineComponent({
    emits: ['quick-action'],
    setup (_props, { attrs, emit }) {
      return () => Vue.h('main', { ...attrs, class: 'portrait-shell' }, ['agents', 'tasks', 'discussion', 'catalog', 'library'].map(action =>
        Vue.h('button', { type: 'button', 'data-portrait-action': action, onClick: () => emit('quick-action', action) }, action)))
    }
  })
  const HallStage = Vue.defineComponent({ setup: (_props, { attrs }) => () => Vue.h('section', { ...attrs, class: 'hall-board', tabindex: 0 }) })
  const hallData = {
    applySceneEvent: noop, applySceneSnapshot: noop, agentFilter: Vue.ref('online'), agents: list, bindPersona: asyncNoop,
    canAssign: () => true, filteredAgents: list, hiddenAgentCount: Vue.ref(0), loadAgents: async () => { counters.hallLoads += 1 },
    loadTasks: async () => { counters.hallLoads += 1 }, loadTaskRecommendations: asyncNoop, mapAgents: list, personaCatalog: list,
    recommendedAgents: list, setAgentFilter: asyncNoop, setTaskStatusFilter: asyncNoop, taskAbilityFilter: Vue.ref('ability-o04'),
    taskAbilityOptions: list, taskKeyword: Vue.ref('task-filter-o04'), tasks: list, taskStatusCount: Vue.ref({}), taskStatusFilter: Vue.ref('open'),
    unbindPersona: asyncNoop, visibleAgents: list
  }
  const taskWorkspace = workspaceState || null
  return {
    ...HallPanelHelpers,
    env: { VITE_JUYITING_TASK_WORKSPACE_ENABLED: workspaceState ? 'true' : undefined },
    useGlobalStore: () => ({ setTitle: noop, setShowBack: noop, setShowAppBar: noop, setShowMore: noop }), useApiStore: () => ({}),
    agentApi: {}, chatApi: {}, log: { warn: noop }, juyitingGame: {}, roleDialogues: { default: [''] }, statusFilters: [], taskStatusFilters: [],
    useHallData: () => hallData,
    useHallExperienceMode: () => ({ experienceMode: mode, isMobileCoarse: Vue.ref(true), orientationHint: text, orientationRequestPending: Vue.ref(false), requestLandscape: asyncNoop }),
    useHallPanels: HallPanelHelpers.useHallPanels,
    useHallSceneState: () => ({ setMapRuntime: noop, reset: noop, forwardPhaseEvents: asyncNoop }),
    useHallCommandQueue: () => ({ ready: Vue.ref(false), setSimulation: noop }),
    useHallBackendSceneState: () => ({ start: asyncNoop, stop: noop, dispose: noop, reportPhase: noop }),
    useHallSceneDebugBridge: () => ({ sentinel: 'debug-o04', republish: noop, stop: noop }),
    useHallSound: () => ({ playAgentSelect: noop, playError: noop, playPanelOpen: noop, playRefresh: noop, playSend: noop, playSuccess: noop, playTap: noop, setSoundEnabled: noop, soundEnabled: Vue.ref(false) }),
    useHallChatContext: () => ({ chatContext: Vue.ref({ conversationScopeKey: 'scope-o04' }), chatMentionAgents: list, chatMode: Vue.ref('public'), chatTargetText: text, enterBountyDiscussion: noop, enterPrivateConversation: noop, resetToPublic: noop, setMentionAgent: noop }),
    useHallScene: () => ({ markAgentSpeaking: noop, markDiscussionStarted: noop, markLibraryCitation: noop, markLibrarySearching: noop, markRecommendedAgents: noop, markTaskArchived: noop, markTaskAssigned: noop, markTaskAutoAssigned: noop, markTaskCreated: noop, resetSceneFeedback: noop, sceneAgents: list, sceneAgentStyle: () => ({}), sceneHotspots: list, syncAfterPersonaChanged: noop }),
    useHallTaskActions: () => ({ archiveTask: asyncNoop, autoAssignTask: asyncNoop, assignTask: async () => true, createTask: asyncNoop }),
    useHallConversation: () => ({ chatConnectionStatus: text, conversationId: Vue.ref('conversation-o04'), draft: Vue.ref('draft-o04'), eventStreamRecovering: Vue.ref(false), insertAgentMention: noop, isAwaitingReply: Vue.ref(false), isStreaming: Vue.ref(false), loadHallMessages: asyncNoop, mentionAgent: noop, messages: Vue.ref([{ id: 'message-o04' }]), newHallConversation: noop, pendingAgentName: text, sendHallMessage: asyncNoop, senderText: text, disposeHallConversation: noop, stopHallEventStream: noop, stopHallReplyPolling: noop, stopHallReplyStreaming: noop }),
    useHallLibrary: () => ({ citeLibraryItem: noop, libraryErrorMessage: text, libraryHasSearched: Vue.ref(false), libraryKeyword: Vue.ref('library-filter-o04'), libraryLoading: Vue.ref(false), libraryResults: list, librarySourceType: Vue.ref('project'), searchLibrary: asyncNoop }),
    useTaskWorkspace: () => taskWorkspace,
    createDisabledTaskWorkspaceBinding: () => ({ selectExplicitActor: noop, clearExplicitActor: noop, dispose: noop }),
    isTaskWorkspaceBuildEnabled: () => Boolean(workspaceState),
    useTaskWorkspaceView: () => workspaceState ? ({ subject: workspaceState.subject, workspace: workspaceState.workspace, connectionState: workspaceState.connectionState, error: workspaceState.error, retry: workspaceState.retry }) : ({ subject: Vue.ref(null), workspace: Vue.ref(null), connectionState: text, error: Vue.ref(null), retry: noop }),
    useTaskWorkspaceBinding: () => ({ selectExplicitActor: noop, clearExplicitActor: noop, dispose: noop }),
    portraitName: () => '', portraitRole: () => ({ slug: 'default' }), portraitShortName: () => '', portraitStyle: () => ({}), roleClass: () => '',
    HallPortraitHome, HallStage, LibraryPanel: LibraryPanel || EmptyPanel, TaskWorkspacePanel: TaskWorkspacePanel || EmptyPanel,
    AgentPanel: EmptyPanel, BountyDiscussionPanel: EmptyPanel, BountyPanel: EmptyPanel, PersonaCatalogPanel: EmptyPanel, PrivateDiscussionPanel: EmptyPanel, PublicDiscussionPanel: EmptyPanel, SelectedAgentCard: EmptyPanel
  }
}

const workspaceFixture = () => ({
  task: {
    taskId: 'task-1',
    status: 'running',
    requiredAbilities: '[]',
    collaborationMode: 'team',
    riskLevel: 'medium',
    maxAgents: 4
  },
  members: [],
  workItems: [],
  openRequests: [],
  recentArtifacts: [],
  recentArtifactsTruncated: false,
  conversationId: null,
  recentEvents: [],
  timelineTruncated: false,
  currentVersion: '3'
})

describe('C07 JuyiHall task workspace integration', () => {
  before(async () => {
    for (const key of ['SVGElement', 'Element', 'Node']) {
      domGlobalDescriptors[key] = Object.getOwnPropertyDescriptor(global, key)
      global[key] = global.window?.[key]
    }
    ;({ mount } = await import('@vue/test-utils'))
    Vue = await import('vue')
    TaskTimeline = Vue.defineComponent({ render: () => null })
    TaskWorkspacePanel = loadSfc('../src/components/juyiting/TaskWorkspacePanel.vue', TaskTimeline)
  })

  after(() => {
    for (const key of ['SVGElement', 'Element', 'Node']) {
      const descriptor = domGlobalDescriptors[key]
      if (descriptor) Object.defineProperty(global, key, descriptor)
      else delete global[key]
    }
  })
  it('uses the existing Hall dialog and concrete top-level values from the single FE1 workspace state source', () => {
    expect(hallSource).to.include("import TaskWorkspacePanel from '@/components/juyiting/TaskWorkspacePanel.vue'")
    expect(hallSource).to.include("import { useTaskWorkspaceView } from '@/composables/juyiting/useTaskWorkspaceView'")
    expect(hallSource).to.include('subject: taskWorkspaceSubject')
    expect(hallSource).to.include('workspace: taskWorkspaceSnapshot')
    expect(hallSource).to.include('connectionState: taskWorkspaceConnectionState')
    expect(hallSource).to.include('error: taskWorkspaceError')
    expect(hallSource).to.include('retry: retryTaskWorkspace')
    expect(hallSource).to.include("v-if=\"taskWorkspaceEnabled && renderedPanel === 'workspace' && taskWorkspaceSubject\"")
    expect(hallSource).to.include(':workspace="taskWorkspaceSnapshot"')
    expect(hallSource).to.include(':connection-state="taskWorkspaceConnectionState"')
    expect(hallSource).to.include(':error="taskWorkspaceError"')
    expect(hallSource).to.include(':actor-agent-id="taskWorkspaceSubject.actorAgentId"')
    expect(hallSource).to.include('@retry="retryTaskWorkspace"')
    expect(hallSource).not.to.include(':workspace="taskWorkspace?.workspace"')
    expect(hallSource).not.to.include(':connection-state="taskWorkspace?.connectionState"')
    expect(hallSource).not.to.include(':error="taskWorkspace?.error"')
    expect(hallSource).not.to.include(':actor-agent-id="taskWorkspace?.subject?.actorAgentId || \'\'"')
    expect(panelSource).not.to.include('role="dialog"')
    expect(hallSource).to.include("if (renderedPanel.value === 'workspace') return '协作工作台'")
  })

  it('opens only from an existing explicit workspace subject without actor fallback', () => {
    const openWorkspaceSource = hallSource.slice(hallSource.indexOf('const openTaskWorkspace'), hallSource.indexOf('const closePanel'))
    expect(openWorkspaceSource).to.include('taskWorkspaceSubject.value?.taskId')
    expect(openWorkspaceSource).to.include('taskWorkspaceSubject.value?.actorAgentId')
    expect(openWorkspaceSource).to.include("openPanel('workspace')")
    expect(openWorkspaceSource).not.to.match(/coordinator|assignee|roster|alias|agents\.value\[0\]|selectedAgent\.value\?\.agentId/)
  })

  it('mounts concrete workspace refs so subject, state, error, and retry are usable by the panel', async () => {
    const taskWorkspace = {
      subject: Vue.ref(null),
      workspace: Vue.ref(null),
      connectionState: Vue.ref('idle'),
      error: Vue.ref(null),
      retryCalls: 0,
      retry () {
        this.retryCalls += 1
      }
    }
    const WorkspaceSurface = Vue.defineComponent({
      setup () {
        const taskWorkspaceView = useTaskWorkspaceView(taskWorkspace)
        return {
          taskWorkspaceSubject: taskWorkspaceView.subject,
          taskWorkspaceSnapshot: taskWorkspaceView.workspace,
          taskWorkspaceConnectionState: taskWorkspaceView.connectionState,
          taskWorkspaceError: taskWorkspaceView.error,
          retryTaskWorkspace: taskWorkspaceView.retry,
          renderedPanel: Vue.ref('workspace')
        }
      },
      render () {
        return Vue.h('div', [
          this.taskWorkspaceSubject
            ? Vue.h('button', { class: 'panel-workspace-link', type: 'button' }, '协作工作台')
            : null,
          this.renderedPanel === 'workspace' && this.taskWorkspaceSubject
            ? Vue.h(TaskWorkspacePanel, {
              actorAgentId: this.taskWorkspaceSubject.actorAgentId,
              connectionState: this.taskWorkspaceConnectionState,
              error: this.taskWorkspaceError,
              workspace: this.taskWorkspaceSnapshot,
              onRetry: this.retryTaskWorkspace
            })
            : null
        ])
      }
    })
    const wrapper = mount(WorkspaceSurface)
    try {
      expect(wrapper.find('.panel-workspace-link').exists()).to.equal(false)
      expect(wrapper.findComponent(TaskWorkspacePanel).exists()).to.equal(false)

      taskWorkspace.subject.value = { taskId: 'task-1', actorAgentId: 'agent-77' }
      taskWorkspace.workspace.value = workspaceFixture()
      taskWorkspace.connectionState.value = 'degraded'
      taskWorkspace.error.value = { message: '服务暂不可用' }
      await Vue.nextTick()

      const panel = wrapper.findComponent(TaskWorkspacePanel)
      expect(wrapper.find('.panel-workspace-link').exists()).to.equal(true)
      expect(panel.exists()).to.equal(true)
      expect(panel.find('dd[title="agent-77"]').text()).to.equal('agent-77')
      expect(panel.find('.task-connection-badge').text()).to.equal('服务暂不可用')
      expect(panel.find('button.task-workspace-retry').exists()).to.equal(true)

      taskWorkspace.connectionState.value = 'error'
      await Vue.nextTick()
      expect(panel.find('[role="alert"]').text()).to.equal('服务暂不可用')
      await panel.find('button.task-workspace-retry').trigger('click')
      expect(taskWorkspace.retryCalls).to.equal(1)
    } finally {
      wrapper.unmount()
    }
  })

  it('keeps the workspace read-only and conversation association-only', () => {
    const panelBinding = hallSource.slice(hallSource.indexOf('<TaskWorkspacePanel'), hallSource.indexOf('<PersonaCatalogPanel'))
    expect(panelBinding).not.to.match(/assign-task|create-task|archive-task|send-message|loadHallMessages|enterPrivateConversation/)
    expect(panelSource).not.to.match(/loadHallMessages|new-conversation|enterPrivateConversation|send-message/)
  })

  it('preserves map/roster separation, no active route, and explicit assignment targets', () => {
    expect(hallDataSource).to.include("agentApi.get('/map'")
    expect(hallDataSource).to.include("agentApi.search('/roster'")
    expect(hallDataSource).not.to.include("'/active'")
    expect(hallSource).to.include('await runAssignTask(task, agent)')
    expect(taskActionsSource).to.include('agentId: targetAgent.agentId')
  })

  it('retains actual-JuyiHall TaskWorkspacePanel identity and byte-exact state for five cycles', async () => {
    const mode = Vue.ref('portrait-command')
    const subjectValue = Object.freeze({ taskId: 'task-01', actorAgentId: 'agent-01' })
    const retry = () => { retry.calls += 1 }
    retry.calls = 0
    const workspaceState = {
      subject: Vue.ref(subjectValue),
      workspace: Vue.ref({ ...workspaceFixture(), currentVersion: '9223372036854775807', recoverySequence: '18446744073709551615' }),
      connectionState: Vue.ref('degraded'),
      error: Vue.ref({ code: 'workspace-recovering', message: '等待重连' }),
      retry
    }
    const counters = { hallLoads: 0 }
    const JuyiHall = loadActualHallForIntegration(createHallIntegrationMocks({ mode, TaskWorkspacePanel, workspaceState, counters }), 'workspace-actual-juyi-hall')
    const wrapper = mount(JuyiHall, { attachTo: document.body, global: { stubs: { 'var-icon': true, transition: false } } })
    try {
      await Vue.nextTick()
      await wrapper.find('[data-portrait-action="tasks"]').trigger('click')
      await Vue.nextTick()
      await wrapper.find('.panel-workspace-link').trigger('click')
      await Vue.nextTick()
      const floating = wrapper.find('.floating-panel').element
      const panel = wrapper.findComponent(TaskWorkspacePanel)
      const retryIdentity = workspaceState.retry
      const loads = counters.hallLoads
      for (let cycle = 0; cycle < 5; cycle += 1) {
        mode.value = 'landscape-map'; await Vue.nextTick()
        mode.value = 'portrait-command'; await Vue.nextTick()
        expect(wrapper.find('.floating-panel').element).to.equal(floating)
        expect(wrapper.findComponent(TaskWorkspacePanel).vm).to.equal(panel.vm)
        expect(workspaceState.subject.value).to.equal(subjectValue)
        expect(panel.props('actorAgentId')).to.equal('agent-01')
        expect(workspaceState.workspace.value.currentVersion).to.equal('9223372036854775807')
        expect(workspaceState.workspace.value.recoverySequence).to.equal('18446744073709551615')
        expect(workspaceState.connectionState.value).to.equal('degraded')
        expect(workspaceState.error.value.code).to.equal('workspace-recovering')
        expect(workspaceState.retry).to.equal(retryIdentity)
        expect(counters.hallLoads).to.equal(loads)
      }
    } finally {
      wrapper.unmount()
    }
  })

})
