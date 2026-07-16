<template>
  <div class="juyi-page" :class="{ 'is-panel-open': activePanel }">
    <HallStage
      :agent-bubbles="agentBubbles"
      :agent-key="agentKey"
      :agent-style="sceneAgentStyle"
      :hidden-agent-count="hiddenAgentCount"
      :interaction-locked="Boolean(activePanel)"
      :portrait-name="portraitName"
      :portrait-short-name="portraitShortName"
      :portrait-style="portraitStyle"
      :role-class="roleClass"
      :simulation-enabled="simulationEnabled"
      :refreshing="hallRefreshing"
      :scene-agents="sceneAgents"
      :scene-hotspots="sceneHotspots"
      :selected-agent="selectedAgent"
      :sound-enabled="soundEnabled"
      :status-class="statusClass"
      :status-text="statusText"
      :tasks-total="tasks.length"
      :visible-agents="visibleAgents"
      @new-conversation="handleNewHallConversation"
      @open-panel="handleStagePanelOpen"
      @refresh-hall="refreshHall"
      @select-agent="selectAgent"
      @simulation-phase-events="handleSimulationPhaseEvents"
      @simulation-ready="handleSimulationReady"
      @simulation-reset="resetSimulationLifecycle"
      @toggle-sound="toggleHallSound"
    >

      <div v-if="selectedAgent" class="quick-bar">
        <transition name="agent-card">
          <SelectedAgentCard
            :ability-text="abilityText"
            :agent="selectedAgent"
            :can-start-chat="canStartAgentConversation(selectedAgent)"
            :portrait-name="portraitName"
            :portrait-style="portraitStyle"
            :status-text="statusText"
            @close-card="closeSelectedAgentCard"
            @open-agents="openPanel('agents')"
            @start-chat="handleStartAgentConversation(selectedAgent)"
          />
        </transition>
      </div>
    </HallStage>

    <transition name="panel" @after-leave="handlePanelAfterLeave">
      <div v-if="activePanel" class="panel-overlay" @click.self="closePanel">
        <section
          ref="panelRef"
          class="floating-panel"
          :class="[`panel-${renderedPanel}`, `layout-${panelLayout}`]"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="panelTitleId"
          tabindex="-1"
          @wheel.stop
          @pointerdown.stop
          @pointermove.stop
          @pointerup.stop
          @pointercancel.stop
          @keydown="handlePanelKeydown"
          @keyup.stop
          @input.stop
          @click.stop
        >
          <div class="panel-title">
            <span :id="panelTitleId">{{ activePanelTitle }}</span>
            <button
              class="panel-close"
              type="button"
              aria-label="关闭面板"
              @click="closePanel"
            >
              <var-icon name="close-circle-outline" />
            </button>
          </div>

          <AgentPanel
            v-if="renderedPanel === 'agents'"
            :ability-text="abilityText"
            :agents="agents"
            :filtered-agents="filteredAgents"
            :map-agents="mapAgents"
            :portrait-name="portraitName"
            :portrait-style="portraitStyle"
            :selected-agent="selectedAgent"
            :status-class="statusClass"
            :status-filters="statusFilters"
            :status-text="statusText"
            :agent-filter="agentFilter"
            @set-agent-filter="setAgentFilter"
            @select-agent="selectAgent"
          />

          <BountyPanel
            v-if="renderedPanel === 'tasks'"
            v-model:task-ability-filter="taskAbilityFilter"
            v-model:task-keyword="taskKeyword"
            :ability-text="abilityText"
            :can-assign="canAssign"
            :format-time="formatTime"
            :portrait-name="portraitName"
            :portrait-style="portraitStyle"
            :recommended-agents="recommendedAgents"
            :selected-agent="selectedAgent"
            :selected-task="selectedTask"
            :task-ability-options="taskAbilityOptions"
            :task-agent-match-score="taskAgentMatchScore"
            :task-state-class="taskStateClass"
            :task-status-count="taskStatusCount"
            :task-status-filter="taskStatusFilter"
            :task-status-filters="taskStatusFilters"
            :task-status-text="taskStatusText"
            :tasks="tasks"
            @auto-assign-task="autoAssignTask"
            @assign-task="assignTask"
            @archive-task="archiveTask"
            @brief-selected-task="briefSelectedTask"
            @create-task="createTask"
            @discuss-task="discussTask"
            @load-tasks="loadTasks"
            @select-agent="selectAgent"
            @select-task="selectTask"
            @set-status-filter="setTaskStatusFilter"
          />

          <PersonaCatalogPanel
            v-if="renderedPanel === 'catalog'"
            :personas="personaCatalog"
            :portrait-name="portraitName"
            :portrait-style="portraitStyle"
            :setup-result="personaSetupResult"
            @bind-persona="handleBindPersona"
            @clear-setup-result="personaSetupResult = null"
            @unbind-persona="handleUnbindPersona"
          />

          <PublicDiscussionPanel
            v-if="renderedPanel === 'chat' && chatMode === 'public'"
            v-model:draft="draft"
            :agents="chatMentionAgents"
            :event-stream-recovering="eventStreamRecovering"
            :is-awaiting-reply="isAwaitingReply"
            :is-streaming="isStreaming"
            :messages="messages"
            :mention-label="portraitShortName"
            :pending-agent-name="pendingAgentName"
            :selected-agent="selectedAgent"
            :selected-task="selectedTask"
            :sender-text="senderText"
            :connection-status="chatConnectionStatus"
            :target-text="chatTargetText"
            :scope-hint="chatContext.conversationScopeKey"
            @clear-target="handleClearChatTarget"
            @load-messages="loadHallMessages(conversationId)"
            @mention-agent="handleMentionAgent"
            @new-conversation="handleNewHallConversation"
            @send-message="handleSendHallMessage"
          />

          <BountyDiscussionPanel
            v-if="renderedPanel === 'chat' && chatMode === 'bounty'"
            v-model:draft="draft"
            :agents="chatMentionAgents"
            :event-stream-recovering="eventStreamRecovering"
            :is-awaiting-reply="isAwaitingReply"
            :is-streaming="isStreaming"
            :messages="messages"
            :mention-label="portraitShortName"
            :pending-agent-name="pendingAgentName"
            :selected-agent="selectedAgent"
            :selected-task="selectedTask"
            :sender-text="senderText"
            :connection-status="chatConnectionStatus"
            :target-text="chatTargetText"
            :scope-hint="chatContext.conversationScopeKey"
            @clear-target="handleClearChatTarget"
            @load-messages="loadHallMessages(conversationId)"
            @mention-agent="handleMentionAgent"
            @new-conversation="handleNewHallConversation"
            @send-message="handleSendHallMessage"
          />

          <PrivateDiscussionPanel
            v-if="renderedPanel === 'chat' && chatMode === 'private'"
            v-model:draft="draft"
            :agents="chatMentionAgents"
            :event-stream-recovering="eventStreamRecovering"
            :is-awaiting-reply="isAwaitingReply"
            :is-streaming="isStreaming"
            :messages="messages"
            :mention-label="portraitShortName"
            :pending-agent-name="pendingAgentName"
            :selected-agent="selectedAgent"
            :selected-task="selectedTask"
            :sender-text="senderText"
            :connection-status="chatConnectionStatus"
            :target-text="chatTargetText"
            :scope-hint="chatContext.conversationScopeKey"
            @clear-target="handleClearChatTarget"
            @load-messages="loadHallMessages(conversationId)"
            @mention-agent="handleMentionAgent"
            @new-conversation="handleNewHallConversation"
            @send-message="handleSendHallMessage"
          />

          <LibraryPanel
            v-if="renderedPanel === 'library'"
            v-model:keyword="libraryKeyword"
            v-model:source-type="librarySourceType"
            :error-message="libraryErrorMessage"
            :format-time="formatTime"
            :has-searched="libraryHasSearched"
            :loading="libraryLoading"
            :results="libraryResults"
            @cite-library="citeLibraryItem"
            @search-library="searchLibrary"
          />
        </section>
      </div>
    </transition>

    <transition name="toast">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </transition>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useGlobalStore } from '@/stores/global'
import { useApiStore } from '@/stores/api'
import { agentApi, chatApi } from '@/composables/useHttp'
import { useHallChatContext } from '@/composables/juyiting/useHallChatContext'
import { useHallBackendSceneState } from '@/composables/juyiting/useHallBackendSceneState'
import { useHallCommandQueue } from '@/composables/juyiting/useHallCommandQueue'
import { useHallConversation } from '@/composables/juyiting/useHallConversation'
import { useHallData } from '@/composables/juyiting/useHallData'
import { useHallLibrary } from '@/composables/juyiting/useHallLibrary'
import { focusHallPanel, restorePanelFocus, trapPanelFocus, useHallPanels } from '@/composables/juyiting/useHallPanels'
import { useHallScene } from '@/composables/juyiting/useHallScene'
import { useHallSceneState } from '@/composables/juyiting/useHallSceneState'
import { useHallSceneDebugBridge } from '@/composables/juyiting/useHallSceneDebugBridge'
import { useHallSound } from '@/composables/juyiting/useHallSound'
import { useHallTaskActions } from '@/composables/juyiting/useHallTaskActions'
import { portraitName, portraitRole, portraitShortName, portraitStyle, roleClass } from '@/composables/juyiting/useWaterMarginRoles'
import AgentPanel from '@/components/juyiting/AgentPanel.vue'
import BountyDiscussionPanel from '@/components/juyiting/BountyDiscussionPanel.vue'
import BountyPanel from '@/components/juyiting/BountyPanel.vue'
import HallStage from '@/components/juyiting/HallStage.vue'
import LibraryPanel from '@/components/juyiting/LibraryPanel.vue'
import PersonaCatalogPanel from '@/components/juyiting/PersonaCatalogPanel.vue'
import PrivateDiscussionPanel from '@/components/juyiting/PrivateDiscussionPanel.vue'
import PublicDiscussionPanel from '@/components/juyiting/PublicDiscussionPanel.vue'
import SelectedAgentCard from '@/components/juyiting/SelectedAgentCard.vue'
import {
  roleDialogues,
  statusFilters,
  taskStatusFilters
} from '@/constants/juyiting'
import { log } from '@/utils/logger'
import { juyitingGame } from '@/game/index.js'

const globalStore = useGlobalStore()
const apiStore = useApiStore()

const selectedAgent = ref(null)
const selectedTask = ref(null)
const personaSetupResult = ref(null)
const toast = ref('')
const activePanel = ref('')
const renderedPanel = ref('')
const hallRefreshing = ref(false)
const agentBubbles = ref({})
const outgoingMetadata = ref({})
const { panelLayout } = useHallPanels()
const panelRef = ref(null)
const panelTitleId = 'juyiting-floating-panel-title'
let panelPriorFocus = null
let bubbleTimer = null
let bubbleInitialTimer = null
let bubbleClearTimer = null
const simulationEnabled = import.meta.env.VITE_JUYITING_SIMULATION_ENABLED === 'true'
const hallCommandQueue = useHallCommandQueue()
let hallBackendSceneState = null
const hallSceneState = useHallSceneState({
  commandQueue: hallCommandQueue,
  reportPhase: report => hallBackendSceneState?.reportPhase(report)
})
let backendSceneStarted = false

const {
  playAgentSelect,
  playError,
  playPanelOpen,
  playRefresh,
  playSend,
  playSuccess,
  playTap,
  setSoundEnabled,
  soundEnabled
} = useHallSound()

const activePanelTitle = computed(() => {
  if (renderedPanel.value === 'agents') return '点将册'
  if (renderedPanel.value === 'catalog') return '招贤令'
  if (renderedPanel.value === 'tasks') return '悬赏榜'
  if (renderedPanel.value === 'chat') return '厅前议事'
  if (renderedPanel.value === 'library') return '案卷阁'
  return ''
})

const normalizeStatus = (status = '') => status.toLowerCase()

const statusClass = (status = '') => {
  const value = normalizeStatus(status)
  if (value === 'busy') return 'is-busy'
  if (value === 'error') return 'is-error'
  if (value === 'offline') return 'is-offline'
  return 'is-idle'
}

const statusText = (status = '') => {
  const value = normalizeStatus(status)
  if (value === 'busy') return '办事'
  if (value === 'offline') return '出征'
  if (value === 'error') return '失联'
  return '候命'
}

const taskStatusText = (status = '') => {
  const value = normalizeStatus(status)
  if (value === 'open') return '待点将'
  if (value === 'assigned') return '已点将'
  if (value === 'running') return '在办'
  if (value === 'completed') return '交令'
  if (value === 'failed') return '失手'
  if (value === 'archived') return '入档'
  return '待点将'
}

const taskStateClass = (status = '') => {
  const value = normalizeStatus(status)
  if (value === 'completed') return 'task-state-done'
  if (value === 'failed') return 'task-state-failed'
  if (value === 'archived') return 'task-state-done'
  if (value === 'running') return 'task-state-running'
  if (value === 'assigned') return 'task-state-assigned'
  return 'task-state-open'
}

const abilityText = (agent) => {
  const abilities = agent.abilities || []
  return abilities.length ? abilities.slice(0, 3).join(' / ') : '未录本领'
}


const taskAgentMatchScore = (task, agent) => {
  const requiredAbilities = task?.requiredAbilities || []
  if (!requiredAbilities.length) return 80
  const agentAbilities = new Set((agent?.abilities || []).map(ability => ability.toLowerCase()))
  const matched = requiredAbilities.filter(ability => agentAbilities.has(String(ability).toLowerCase())).length
  return Math.round((matched / requiredAbilities.length) * 100)
}

const {
  applySceneEvent,
  applySceneSnapshot,
  agentFilter,
  agents,
  bindPersona,
  canAssign,
  filteredAgents,
  hiddenAgentCount,
  loadAgents,
  loadTasks,
  loadTaskRecommendations,
  mapAgents,
  personaCatalog,
  recommendedAgents,
  setAgentFilter,
  setTaskStatusFilter,
  taskAbilityFilter,
  taskAbilityOptions,
  taskKeyword,
  tasks,
  taskStatusCount,
  taskStatusFilter,
  unbindPersona,
  visibleAgents
} = useHallData({
  agentApi,
  log,
  normalizeStatus,
  selectedAgent,
  selectedTask,
  taskAgentMatchScore,
  sceneState: hallSceneState
})

hallBackendSceneState = useHallBackendSceneState({
  agentApi,
  onSnapshot: applySceneSnapshot,
  onEvent: applySceneEvent
})

const hallSceneDebugBridge = useHallSceneDebugBridge({
  backend: hallBackendSceneState,
  commandQueue: hallCommandQueue,
  game: juyitingGame
})

const {
  chatContext,
  chatMentionAgents,
  chatMode,
  chatTargetText,
  enterBountyDiscussion,
  enterPrivateConversation,
  resetToPublic,
  setMentionAgent
} = useHallChatContext({
  /* useHallChatContext({
  agents,
  }) */
  agents,
  portraitShortName,
  selectedAgent,
  selectedTask
})

const startBackendSceneState = async () => {
  if (backendSceneStarted) return
  backendSceneStarted = true
  try {
    await hallBackendSceneState.start()
  } catch (error) {
    backendSceneStarted = false
    log.warn('Juyiting backend scene state degraded:', error)
  }
}

const handleSimulationReady = async ({ movementRuntime, simulation } = {}) => {
  if (!simulationEnabled || !movementRuntime || !simulation?.enqueue) return
  hallSceneState.setMapRuntime(movementRuntime)
  hallCommandQueue.setSimulation(simulation)
  hallSceneDebugBridge.republish()
  await startBackendSceneState()
}

const resetSimulationLifecycle = () => {
  backendSceneStarted = false
  hallBackendSceneState?.stop()
  hallCommandQueue.setSimulation(null)
  hallSceneState.reset()
}

const handleSimulationPhaseEvents = events => {
  if (!simulationEnabled) return
  void hallSceneState.forwardPhaseEvents(events).catch(error => {
    log.warn('Juyiting phase forwarding failed:', error)
  })
}

const refreshHall = async ({ silent = false } = {}) => {
  if (hallRefreshing.value) return
  hallRefreshing.value = true
  if (!silent) playRefresh()
  try {
    await Promise.all([loadAgents(), loadTasks()])
    if (simulationEnabled && hallCommandQueue.ready.value && !backendSceneStarted) {
      await startBackendSceneState()
    }
    if (!silent) showToast('厅中动静已点验')
  } finally {
    hallRefreshing.value = false
  }
}

const formatTime = (timestamp) => {
  if (!timestamp) return ''
  const date = new Date(Number(timestamp))
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getMonth() + 1}-${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

const agentKey = (agent) => agent?.agentId || agent?.name || agent?.personaName || ''

const {
  markAgentSpeaking,
  markDiscussionStarted,
  markLibraryCitation,
  markLibrarySearching,
  markRecommendedAgents,
  markTaskArchived,
  markTaskAssigned,
  markTaskAutoAssigned,
  markTaskCreated,
  resetSceneFeedback,
  sceneAgents,
  sceneAgentStyle,
  sceneHotspots,
  syncAfterPersonaChanged
} = useHallScene({
  mapAgents,
  normalizeStatus,
  selectedAgent,
  selectedTask,
  simulationEnabled
})

const selectTask = async (task) => {
  selectedTask.value = task
  if (task) {
    await loadTaskRecommendations(task)
    markRecommendedAgents(recommendedAgents.value)
  }
  playTap()
}

const selectAgent = (agent) => {
  selectedAgent.value = agent
  playAgentSelect()
}

const openPanel = (panel, options = {}) => {
  if (!activePanel.value) panelPriorFocus = document.activeElement
  if (panel !== 'chat') {
    resetToPublic()
  }
  if (panel === 'chat' && options.mode === 'public') {
    resetToPublic({ clearSelection: true })
  }
  renderedPanel.value = panel
  activePanel.value = panel
  nextTick(() => focusHallPanel(panelRef.value))
  if (!options.silent) playPanelOpen()
  if (panel === 'chat') {
    window.setTimeout(() => loadHallMessages(), 0)
  }
}

const handleStagePanelOpen = (panel) => {
  if (panel === 'chat') {
    openPanel('chat', { mode: 'public', resetContext: true })
    return
  }
  openPanel(panel)
}

const closePanel = () => {
  activePanel.value = ''
  playTap()
}

const handlePanelKeydown = (event) => {
  event.stopPropagation()
  if (event.key === 'Escape') {
    event.preventDefault()
    closePanel()
    return
  }
  trapPanelFocus(event, panelRef.value)
}

const handlePanelAfterLeave = () => {
  if (!activePanel.value) {
    renderedPanel.value = ''
    restorePanelFocus(panelPriorFocus)
    panelPriorFocus = null
  }
}

const closeSelectedAgentCard = () => {
  selectedAgent.value = null
  playTap()
}

const briefSelectedTask = (task = selectedTask.value, agent = selectedAgent.value) => {
  if (!task) return
  selectedTask.value = task
  if (agent) {
    enterPrivateConversation(agent)
  } else {
    enterBountyDiscussion(task)
  }
  const abilities = (task.requiredAbilities || []).join(' / ') || '不拘本领'
  const target = agent ? `可请 ${portraitShortName(agent)} / ${agent.name || agent.personaName || agent.agentId} 领令。` : '请点一位合适好汉领令。'
  draft.value = `请就榜文「${task.title}」议事：榜号 ${task.id}，眼下 ${taskStatusText(task.status)}，所需本领 ${abilities}。${target}请说明险处与下一步章程。`
  openPanel('chat')
  showToast('议事话头已备')
}

const discussTask = (task) => {
  if (!task) return
  enterBountyDiscussion(task)
  markDiscussionStarted(task, chatContext.participantAgentIds || [])
  draft.value = `请就榜文「${task.title}」议事。`
  openPanel('chat')
}

const toggleHallSound = () => {
  const nextEnabled = !soundEnabled.value
  setSoundEnabled(nextEnabled)
  if (nextEnabled) {
    playTap()
    showToast('厅中声响已开')
    return
  }
  showToast('厅中声响已歇')
}

const showToast = (message) => {
  toast.value = message
  setTimeout(() => {
    if (toast.value === message) toast.value = ''
  }, 2200)
}

const {
  archiveTask: runArchiveTask,
  autoAssignTask: runAutoAssignTask,
  assignTask: runAssignTask,
  createTask: runCreateTask
} = useHallTaskActions({
  agentApi,
  canAssign,
  log,
  playError,
  playSuccess,
  selectedAgent,
  selectedTask,
  showToast,
  tasks
})

const createTask = async (payload) => {
  await runCreateTask(payload)
  markTaskCreated(selectedTask.value)
}

const assignTask = async (task, agent = selectedAgent.value) => {
  const targetAgents = Array.isArray(agent) ? agent : [agent].filter(Boolean)
  await runAssignTask(task, agent)
  if (task?.status === 'assigned' && targetAgents.length) {
    markTaskAssigned(task, targetAgents)
  }
}

const autoAssignTask = async (task) => {
  await runAutoAssignTask(task)
  const currentTask = selectedTask.value || task
  const assignedIds = currentTask?.assignedAgentIds || (currentTask?.assignedAgentId ? [currentTask.assignedAgentId] : [])
  const assignedAgents = assignedIds
    .map(agentId => mapAgents.value.find(agent => agent.agentId === agentId) || agents.value.find(agent => agent.agentId === agentId) || agentId)
    .filter(Boolean)
  markTaskAutoAssigned(currentTask, assignedAgents)
}

const archiveTask = async (task) => {
  await runArchiveTask(task)
  if (selectedTask.value?.status === 'archived') {
    markTaskArchived(selectedTask.value)
  }
}

const {
  chatConnectionStatus,
  conversationId,
  draft,
  eventStreamRecovering,
  insertAgentMention,
  isAwaitingReply,
  isStreaming,
  loadHallMessages,
  mentionAgent,
  messages,
  newHallConversation,
  pendingAgentName,
  sendHallMessage,
  senderText,
  stopHallEventStream,
  stopHallReplyPolling,
  stopHallReplyStreaming
} = useHallConversation({
  apiStore,
  chatContext,
  chatMode,
  chatApi,
  globalStore,
  log,
  openPanel,
  outgoingMetadata,
  portraitShortName,
  selectedAgent,
  selectedTask,
  showToast
})

const {
  citeLibraryItem: runCiteLibraryItem,
  libraryErrorMessage,
  libraryHasSearched,
  libraryKeyword,
  libraryLoading,
  libraryResults,
  librarySourceType,
  searchLibrary: runSearchLibrary
} = useHallLibrary({
  chatApi,
  draft,
  log,
  openPanel,
  outgoingMetadata,
  playSuccess,
  showToast
})

const searchLibrary = async () => {
  markLibrarySearching('searching')
  await runSearchLibrary()
  markLibrarySearching(libraryErrorMessage.value ? 'error' : 'success')
}

const citeLibraryItem = (item) => {
  runCiteLibraryItem(item)
  markLibraryCitation(item)
}

const startDialogueBubbles = () => {
  stopDialogueBubbles()
  bubbleTimer = window.setInterval(showRandomAgentBubble, 5200)
  bubbleInitialTimer = window.setTimeout(showRandomAgentBubble, 1800)
}

const stopDialogueBubbles = () => {
  if (bubbleTimer) window.clearInterval(bubbleTimer)
  if (bubbleInitialTimer) window.clearTimeout(bubbleInitialTimer)
  if (bubbleClearTimer) window.clearTimeout(bubbleClearTimer)
  bubbleTimer = null
  bubbleInitialTimer = null
  bubbleClearTimer = null
}

const showRandomAgentBubble = () => {
  const pool = visibleAgents.value
  if (!pool.length || activePanel.value) return
  const agent = pool[Math.floor(Math.random() * pool.length)]
  const role = portraitRole(agent)
  const lines = roleDialogues[role.slug] || roleDialogues.default
  const text = lines[Math.floor(Math.random() * lines.length)]
  const key = agentKey(agent)
  agentBubbles.value = { [key]: text }
  markAgentSpeaking(agent, text, 'speech')
  if (bubbleClearTimer) window.clearTimeout(bubbleClearTimer)
  bubbleClearTimer = window.setTimeout(() => {
    agentBubbles.value = {}
  }, 3600)
}


const handleNewHallConversation = () => {
  playPanelOpen()
  newHallConversation()
  resetSceneFeedback()
}

const handleSendHallMessage = async () => {
  playSend()
  const targets = chatContext.targetAgentIds?.length ? chatContext.targetAgentIds : chatContext.participantAgentIds
  targets?.slice(0, 3).forEach(agentId => markAgentSpeaking(agentId, '收到传令', 'system'))
  await sendHallMessage()
}

const handleMentionAgent = (agent) => {
  playTap()
  setMentionAgent(agent)
  mentionAgent(agent)
  markAgentSpeaking(agent, '收到传令', 'system')
}

const handleClearChatTarget = () => {
  playTap()
  setMentionAgent(null)
  if (chatMode.value === 'public') {
    selectedAgent.value = null
  }
}

const handleStartAgentConversation = (agent) => {
  if (!agent) return
  if (!canStartAgentConversation(agent)) {
    showToast(agent.systemAgent ? '宋江坐镇公议' : '只可与自家好汉密议')
    return
  }
  playAgentSelect()
  enterPrivateConversation(agent)
  markAgentSpeaking(agent, '入席密议', 'system')
  draft.value = ''
  insertAgentMention(agent, '请报眼下动静、可领何榜、还需哪路照应。')
  openPanel('chat')
  showToast(`正与 ${portraitShortName(agent)} 密议`)
}

const canStartAgentConversation = (agent) => Boolean(agent?.boundToMe && !agent?.systemAgent && agent?.canOperate !== false)

const handleBindPersona = async (persona, mode = 'local') => {
  try {
    personaSetupResult.value = await bindPersona(persona, mode)
    syncAfterPersonaChanged()
    playSuccess()
    showToast(mode === 'server' ? `${portraitShortName(persona)} 已在山寨安顿` : `${portraitShortName(persona)} 自家接应文书已备`)
  } catch (error) {
    log.warn('bind persona failed:', error)
    playError()
    showToast(error.message || '请贤未成')
  }
}

const handleUnbindPersona = async (persona) => {
  try {
    await unbindPersona(persona)
    if (selectedAgent.value?.personaCode === persona.personaCode) selectedAgent.value = null
    if (personaSetupResult.value?.agent?.personaCode === persona.personaCode) personaSetupResult.value = null
    syncAfterPersonaChanged()
    playSuccess()
    showToast(`${portraitShortName(persona)} 已除名下山`)
  } catch (error) {
    log.warn('unbind persona failed:', error)
    playError()
    showToast(error.message || '除名未成')
  }
}

onMounted(async () => {
  globalStore.setTitle('聚义厅')
  globalStore.setShowBack(false)
  globalStore.setShowAppBar(false)
  globalStore.setShowMore(false)
  await refreshHall({ silent: true })
  startDialogueBubbles()
})

onUnmounted(() => {
  restorePanelFocus(panelPriorFocus)
  panelPriorFocus = null
  stopHallEventStream()
  stopHallReplyStreaming()
  stopHallReplyPolling()
  stopDialogueBubbles()
  resetSimulationLifecycle()
  hallSceneDebugBridge.stop()
  globalStore.setShowAppBar(true)
})
</script>

<style scoped>
.juyi-page {
  --bottom-action-bar-height: 68px;
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
  height: 100%;
  padding: 0;
  overflow: hidden;
  background: #211812;
  color: #2f261c;
}

.hall-stage {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  background: #211812;
}

.stage-header {
  position: absolute;
  top: 18px;
  left: 18px;
  right: 18px;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid rgba(255, 240, 202, 0.22);
  border-radius: 8px;
  background: rgba(35, 24, 16, 0.72);
  color: #fff4d4;
  backdrop-filter: blur(8px);
}

.eyebrow {
  font-size: 12px;
  color: #d7b875;
}

h1 {
  margin: 2px 0 0;
  font-size: 28px;
  line-height: 1.1;
  letter-spacing: 0;
}

.stage-actions,
.quick-bar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

button {
  border: 0;
  cursor: pointer;
  font: inherit;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.icon-action,
.quick-action,
.panel-title button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  border-radius: 8px;
  background: #6d3f1f;
  color: #fff8e8;
}

.icon-action {
  width: 38px;
  background: rgba(255, 244, 212, 0.16);
  color: #fff4d4;
}

.hall-board {
  position: relative;
  flex: 1;
  min-height: 0;
  margin: 0;
  overflow: hidden;
  border-radius: 0;
  cursor: grab;
  touch-action: none;
  background:
    radial-gradient(circle at 50% 48%, rgba(255, 238, 180, 0.16), transparent 32%),
    linear-gradient(135deg, #17231d, #1b271f 50%, #0e1411);
}

.hall-board.is-dragging {
  cursor: grabbing;
}

.hall-board::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 4;
  pointer-events: none;
  box-shadow: inset 0 0 90px rgba(0, 0, 0, 0.58);
}

.map-world {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 162%;
  height: 148%;
  transform: translate3d(calc(-50% + var(--map-offset-x, 0px)), calc(-50% + var(--map-offset-y, 0px)), 0);
  transform-origin: center;
  transition: transform 0.28s ease;
  background:
    linear-gradient(90deg, rgba(99, 61, 31, 0.24) 1px, transparent 1px) 0 0 / 72px 72px,
    linear-gradient(0deg, rgba(99, 61, 31, 0.22) 1px, transparent 1px) 0 0 / 72px 72px,
    repeating-linear-gradient(90deg, rgba(169, 114, 58, 0.12) 0 18px, rgba(89, 54, 28, 0.12) 18px 36px),
    radial-gradient(ellipse at 52% 54%, rgba(229, 177, 92, 0.34), transparent 28%),
    linear-gradient(145deg, #8a6032 0%, #5b3923 38%, #6f4a2a 68%, #3a291f 100%);
  will-change: transform;
}

.map-world::before,
.map-world::after {
  content: '';
  position: absolute;
  pointer-events: none;
}

.map-world::before {
  inset: 8% 10%;
  border: 8px solid rgba(64, 35, 18, 0.62);
  border-radius: 8px;
  background:
    linear-gradient(90deg, rgba(64, 35, 18, 0.46) 2px, transparent 2px) 0 0 / 25% 100%,
    linear-gradient(0deg, rgba(64, 35, 18, 0.44) 2px, transparent 2px) 0 0 / 100% 34%,
    rgba(255, 238, 194, 0.08);
}

.map-world::after {
  left: 15%;
  right: 15%;
  top: 46%;
  height: 18px;
  border-radius: 999px;
  background: rgba(238, 190, 111, 0.48);
  box-shadow:
    0 -116px 0 rgba(238, 190, 111, 0.24),
    0 116px 0 rgba(238, 190, 111, 0.2);
}

.map-region,
.map-road {
  position: absolute;
  pointer-events: none;
}

.map-region {
  z-index: 0;
  opacity: 0.88;
}

.region-water {
  left: 13%;
  bottom: 14%;
  width: 22%;
  height: 22%;
  border-radius: 8px;
  background:
    linear-gradient(90deg, rgba(255, 239, 188, 0.18) 1px, transparent 1px) 0 0 / 18px 18px,
    linear-gradient(135deg, rgba(87, 51, 27, 0.58), rgba(48, 31, 22, 0.5));
}

.region-forest {
  right: 13%;
  top: 14%;
  width: 24%;
  height: 24%;
  border-radius: 8px;
  background:
    radial-gradient(circle at 28% 36%, rgba(244, 200, 76, 0.24), transparent 16%),
    linear-gradient(135deg, rgba(35, 72, 62, 0.64), rgba(28, 52, 44, 0.56));
}

.region-village {
  left: 13%;
  top: 14%;
  width: 24%;
  height: 24%;
  border-radius: 8px;
  background:
    repeating-linear-gradient(45deg, rgba(255, 239, 188, 0.16) 0 10px, transparent 10px 20px),
    linear-gradient(135deg, rgba(124, 31, 27, 0.46), rgba(92, 45, 99, 0.42));
}

.map-road {
  z-index: 1;
  height: 16px;
  border-radius: 999px;
  background: rgba(239, 195, 115, 0.56);
  box-shadow: 0 0 0 5px rgba(83, 55, 29, 0.1);
}

.road-main {
  left: 20%;
  top: 50%;
  width: 62%;
  transform: rotate(-13deg);
}

.road-branch {
  left: 45%;
  top: 42%;
  width: 32%;
  transform: rotate(42deg);
}

.hall-room {
  position: absolute;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 0;
  min-height: 0;
  padding: 10px;
  border: 2px solid rgba(64, 35, 18, 0.68);
  border-radius: 8px;
  background:
    linear-gradient(90deg, rgba(255, 244, 212, 0.14) 1px, transparent 1px) 0 0 / 20px 20px,
    linear-gradient(145deg, rgba(255, 237, 190, 0.72), rgba(188, 132, 67, 0.64));
  color: #3c2716;
  text-align: center;
  box-shadow:
    inset 0 0 0 1px rgba(255, 250, 232, 0.22),
    0 12px 26px rgba(0, 0, 0, 0.18);
}

button.hall-room {
  cursor: pointer;
}

.hall-room:hover {
  border-color: rgba(244, 200, 76, 0.84);
  box-shadow:
    inset 0 0 0 1px rgba(255, 250, 232, 0.3),
    0 0 0 3px rgba(244, 200, 76, 0.18),
    0 14px 28px rgba(0, 0, 0, 0.2);
}

.hall-room strong,
.hall-room small {
  overflow: hidden;
  max-width: 100%;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hall-room strong {
  font-size: 16px;
  font-weight: 800;
}

.hall-room small {
  color: rgba(60, 39, 22, 0.78);
  font-size: 12px;
}

.room-main {
  left: 37%;
  top: 35%;
  width: 26%;
  height: 32%;
  background:
    radial-gradient(circle at 50% 52%, rgba(244, 200, 76, 0.28), transparent 44%),
    linear-gradient(145deg, rgba(255, 239, 188, 0.82), rgba(192, 138, 70, 0.74));
}

.room-agents {
  left: 14%;
  top: 36%;
  width: 19%;
  height: 24%;
}

.room-tasks {
  right: 14%;
  top: 36%;
  width: 19%;
  height: 24%;
}

.room-back {
  left: 40%;
  bottom: 13%;
  width: 20%;
  height: 16%;
  background:
    linear-gradient(145deg, rgba(235, 218, 184, 0.74), rgba(112, 76, 47, 0.56));
}

.beam {
  position: absolute;
  left: 0;
  right: 0;
  height: 18px;
  background: #4a2716;
}

.beam-top {
  top: 0;
}

.banner {
  position: absolute;
  top: 86px;
  left: 50%;
  width: 116px;
  padding: 10px 0;
  transform: translateX(-50%);
  border-radius: 0 0 8px 8px;
  background: #b93622;
  color: #fff1c1;
  text-align: center;
  font-weight: 700;
}

.task-sprite {
  position: absolute;
  z-index: 2;
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  grid-template-rows: auto auto;
  align-items: center;
  column-gap: 7px;
  width: clamp(132px, 15vw, 176px);
  min-height: 56px;
  padding: 8px 10px;
  transform: translate(-50%, -50%) rotate(var(--sprite-tilt, -4deg));
  border: 1px solid rgba(87, 50, 24, 0.34);
  border-radius: 8px 8px 16px 8px;
  background:
    linear-gradient(90deg, rgba(123, 71, 33, 0.12) 1px, transparent 1px) 12px 0 / 18px 100%,
    linear-gradient(155deg, rgba(255, 248, 224, 0.96), rgba(225, 175, 89, 0.94));
  color: #3f2815;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.26),
    0 12px 24px rgba(0, 0, 0, 0.23);
  animation-timing-function: cubic-bezier(0.45, 0.02, 0.3, 1);
  animation-iteration-count: infinite;
}

.task-sprite::after {
  content: "";
  position: absolute;
  right: -7px;
  bottom: -6px;
  width: 32px;
  height: 28px;
  border-radius: 58% 42% 48% 52%;
  background: rgba(129, 35, 27, 0.16);
  transform: rotate(-14deg);
}

.task-sprite-icon {
  grid-row: 1 / 3;
  display: inline-grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: #7c1f1b;
  color: #fff4d4;
}

.task-sprite-title,
.task-sprite-status {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-sprite-title {
  font-weight: 700;
  font-size: 13px;
}

.task-sprite-status {
  color: #7a5630;
  font-size: 11px;
}

.task-sprite.is-running {
  background:
    linear-gradient(90deg, rgba(35, 72, 62, 0.12) 1px, transparent 1px) 12px 0 / 18px 100%,
    linear-gradient(155deg, rgba(237, 250, 240, 0.96), rgba(139, 185, 147, 0.94));
}

.task-sprite.is-completed {
  opacity: 0.76;
}

.task-sprite.is-failed .task-sprite-icon {
  background: #b3261e;
}

.agent-name,
.agent-status {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-status {
  font-size: 12px;
}

.is-idle {
  color: #2e7d32;
}

.is-busy {
  color: #9a5b00;
}

.is-error {
  color: #b3261e;
}

.is-offline {
  color: #777;
}

.empty-hall,
.empty-list {
  color: #856d4a;
  text-align: center;
  padding: 18px;
}

.hall-overflow {
  position: absolute;
  right: 18px;
  bottom: 118px;
  z-index: 5;
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid rgba(255, 244, 212, 0.2);
  border-radius: 999px;
  background: rgba(35, 24, 16, 0.72);
  color: #fff4d4;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.18);
  backdrop-filter: blur(8px);
}

.quick-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 8;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  max-width: 100%;
  padding: 10px max(18px, env(safe-area-inset-right)) max(10px, env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-left));
  box-sizing: border-box;
  border: 1px solid rgba(255, 240, 202, 0.18);
  border-right: 0;
  border-bottom: 0;
  border-left: 0;
  border-radius: 0;
  background: rgba(35, 24, 16, 0.72);
  backdrop-filter: blur(8px);
}

.dock-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: #fff4d4;
}

.dock-summary span {
  display: inline-flex;
  align-items: center;
  min-height: 38px;
  padding: 0 10px;
  border: 1px solid rgba(255, 244, 212, 0.14);
  border-radius: 8px;
  background: rgba(255, 244, 212, 0.08);
  color: #d7b875;
  white-space: nowrap;
}

.dock-summary strong {
  margin-right: 4px;
  color: #fff8e8;
  font-size: 18px;
}

.dock-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.quick-action {
  flex: 0 0 auto;
  min-width: 86px;
  gap: 6px;
  background: rgba(35, 72, 62, 0.92);
}

.quick-action.primary {
  background: #b93622;
  color: #fff8e8;
}

.scene-hotspot {
  position: absolute;
  z-index: 3;
  display: none;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 10px;
  border: 1px solid rgba(255, 240, 202, 0.3);
  border-radius: 8px;
  background: rgba(255, 250, 240, 0.9);
  color: #4a3423;
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.22);
}

.hotspot-agents {
  left: 8%;
  top: 58%;
}

.hotspot-tasks {
  left: 50%;
  bottom: 25%;
  transform: translateX(-50%);
}

.panel-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 72px 20px 92px;
  box-sizing: border-box;
  background: transparent;
  isolation: isolate;
  contain: layout paint;
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
}

.panel-overlay::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 0;
  background: rgba(18, 13, 10, 0.42);
  opacity: 1;
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
  pointer-events: none;
  contain: layout paint;
}

.floating-panel {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  width: min(860px, 100%);
  max-width: 100%;
  min-height: 0;
  max-height: 100%;
  box-sizing: border-box;
  border: 1px solid rgba(71, 44, 23, 0.2);
  border-radius: 8px;
  background: #fffaf0;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.34);
  overflow: hidden;
  opacity: 1;
  transform: translate3d(0, 0, 0);
  transform-origin: center bottom;
  backface-visibility: hidden;
  contain: layout paint;
  will-change: transform, opacity;
  isolation: isolate;
}

.floating-panel.layout-center-modal {
  width: min(860px, calc(100% - 40px));
  max-height: calc(100% - 48px);
}

.panel-chat.layout-center-modal {
  width: min(920px, calc(100% - 40px));
}

.panel-overlay:has(.layout-right-drawer) {
  align-items: stretch;
  justify-content: flex-end;
  padding: 0;
}

.floating-panel.layout-right-drawer {
  width: clamp(45%, 50vw, 55%);
  max-width: 55%;
  height: var(--hall-visual-height, 100%);
  max-height: 100%;
  border-radius: 8px 0 0 8px;
}

.panel-chat.layout-right-drawer {
  width: min(92%, 720px);
  max-width: 92%;
}

.panel-overlay:has(.layout-bottom-drawer) {
  align-items: flex-end;
  padding: 0;
}

.floating-panel.layout-bottom-drawer {
  width: 100%;
  max-width: 100%;
  height: 72vh;
  height: min(72vh, calc(var(--hall-visual-height, 100vh) * 0.72));
  max-height: 75vh;
  border-radius: 8px 8px 0 0;
}

.floating-panel.panel-chat.layout-bottom-drawer {
  height: calc(var(--hall-visual-height, 100vh) - 12px);
  max-height: calc(var(--hall-visual-height, 100vh) - 12px);
}

.panel-chat {
  width: min(920px, calc(100vw - 32px));
  height: min(760px, calc(100vh - 48px));
}

.panel-title {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  padding: 14px 16px;
  box-sizing: border-box;
  border-bottom: 1px solid rgba(71, 44, 23, 0.12);
  background: #fffaf0;
}

.panel-title {
  font-weight: 700;
}

.panel-title > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-title button {
  padding: 0 12px;
  background: #efe0c6;
  color: #4a3423;
}

.panel-close {
  flex: 0 0 36px;
  width: 36px;
  min-width: 36px;
  padding: 0;
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  z-index: 1200;
  transform: translateX(-50%);
  padding: 10px 14px;
  border-radius: 8px;
  background: rgba(42, 31, 22, 0.92);
  color: #fff;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}

.agent-card-enter-active,
.agent-card-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.agent-card-enter-from,
.agent-card-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.panel-enter-active,
.panel-leave-active {
  transition: none;
}

.panel-enter-active::before,
.panel-leave-active::before {
  transition: opacity 0.16s ease-out;
  will-change: opacity;
}

.panel-enter-active .floating-panel,
.panel-leave-active .floating-panel {
  transition:
    transform 0.18s cubic-bezier(0.2, 0, 0, 1),
    opacity 0.14s ease-out;
  will-change: transform, opacity;
}

.panel-enter-from::before,
.panel-leave-to::before {
  opacity: 0;
}

.panel-enter-from .floating-panel {
  transform: translate3d(0, 10px, 0);
}

.panel-leave-to .floating-panel {
  opacity: 0;
  transform: translate3d(0, 10px, 0);
}

.juyi-page.is-panel-open :deep(.hall-board),
.juyi-page.is-panel-open :deep(.map-world),
.juyi-page.is-panel-open :deep(.agent-token),
.juyi-page.is-panel-open :deep(.agent-token *) {
  animation-play-state: paused !important;
}

.juyi-page.is-panel-open :deep(.map-world) {
  transition: none;
}

@media (prefers-reduced-motion: reduce) {
  .panel-enter-active,
  .panel-leave-active,
  .panel-enter-active::before,
  .panel-leave-active::before,
  .panel-enter-active .floating-panel,
  .panel-leave-active .floating-panel {
    transition: none;
  }
}

@keyframes agentWalkRoute {
  0% {
    left: var(--p0x);
    top: var(--p0y);
  }
  12% {
    left: var(--p1x);
    top: var(--p1y);
  }
  25% {
    left: var(--p2x);
    top: var(--p2y);
  }
  38% {
    left: var(--p3x);
    top: var(--p3y);
  }
  52% {
    left: var(--p4x);
    top: var(--p4y);
  }
  66% {
    left: var(--p5x);
    top: var(--p5y);
  }
  82% {
    left: var(--p6x);
    top: var(--p6y);
  }
  94% {
    left: var(--p7x);
    top: var(--p7y);
  }
  100% {
    left: var(--p0x);
    top: var(--p0y);
  }
}

@keyframes taskOrbitA {
  0% {
    transform: translate(-50%, -50%) rotate(var(--sprite-tilt, -4deg)) scale(0.98);
  }
  23% {
    transform: translate(calc(-50% + var(--orbit-x)), calc(-50% - var(--orbit-y))) rotate(7deg) scale(1.02);
  }
  61% {
    transform: translate(calc(-50% + var(--wander-x)), calc(-50% + var(--orbit-y))) rotate(-9deg) scale(0.96);
  }
  100% {
    transform: translate(-50%, -50%) rotate(var(--sprite-tilt, -4deg)) scale(0.98);
  }
}

@keyframes taskOrbitB {
  0% {
    transform: translate(-50%, -50%) rotate(var(--sprite-tilt, 4deg));
  }
  34% {
    transform: translate(calc(-50% + var(--orbit-x-left)), calc(-50% + var(--wander-y))) rotate(-12deg);
  }
  72% {
    transform: translate(calc(-50% + var(--orbit-x-mid)), calc(-50% + var(--orbit-y-high))) rotate(10deg);
  }
  100% {
    transform: translate(-50%, -50%) rotate(var(--sprite-tilt, 4deg));
  }
}

@keyframes taskOrbitC {
  0% {
    transform: translate(-50%, -50%) rotate(var(--sprite-tilt, 2deg)) scale(1);
  }
  19% {
    transform: translate(calc(-50% + var(--wander-x)), calc(-50% + var(--orbit-y-up-soft))) rotate(11deg) scale(0.97);
  }
  48% {
    transform: translate(calc(-50% + var(--orbit-x-left-soft)), calc(-50% + var(--orbit-y-down-soft))) rotate(-8deg) scale(1.03);
  }
  83% {
    transform: translate(calc(-50% + var(--orbit-x-right-soft)), calc(-50% + var(--wander-y))) rotate(5deg) scale(0.99);
  }
  100% {
    transform: translate(-50%, -50%) rotate(var(--sprite-tilt, 2deg)) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .task-sprite {
    animation: none;
  }
}

@media (max-width: 640px) {
  .juyi-page {
    --bottom-action-bar-height: 108px;
    background: #211812;
  }

  .stage-header {
    top: 8px;
    left: 8px;
    right: 8px;
    padding: 12px;
    align-items: flex-start;
  }

  h1 {
    font-size: 24px;
  }

  .stage-actions {
    justify-content: flex-end;
    flex-wrap: nowrap;
    max-width: none;
    gap: 6px;
  }

  .icon-action {
    width: 34px;
    min-height: 34px;
  }

  .banner {
    top: 92px;
  }

  .scene-hotspot {
    min-height: 32px;
    padding: 0 8px;
    font-size: 12px;
  }

  .hotspot-agents {
    left: 5%;
    top: 63%;
  }

  .quick-bar {
    grid-template-columns: 1fr;
    gap: 8px;
    padding: 8px max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left));
  }

  .dock-summary {
    overflow-x: auto;
    flex-wrap: nowrap;
  }

  .dock-summary span {
    min-height: 34px;
    padding: 0 8px;
    font-size: 12px;
  }

  .dock-summary strong {
    font-size: 16px;
  }

  .dock-actions {
    justify-content: flex-start;
    overflow-x: auto;
  }

  .quick-action {
    flex: 0 0 auto;
    min-width: 78px;
  }

  .map-world {
    width: 164%;
    height: 146%;
  }

  .room-main {
    left: 35%;
    top: 36%;
    width: 30%;
    height: 31%;
  }

  .room-agents {
    left: 15%;
    top: 38%;
    width: 18%;
    height: 22%;
  }

  .room-tasks {
    right: 15%;
    top: 38%;
    width: 18%;
    height: 22%;
  }

  .room-back {
    left: 39%;
    bottom: 13%;
    width: 22%;
    height: 15%;
  }

  .hall-room {
    padding: 7px;
  }

  .hall-room strong {
    font-size: 13px;
  }

  .hall-room small {
    font-size: 10px;
  }

  .panel-overlay {
    --mobile-chat-panel-top-gap: 18px;
    align-items: flex-end;
    padding: 0;
  }

  .agent-card-enter-from,
  .agent-card-leave-to {
    transform: translateY(8px);
  }

  .floating-panel {
    width: calc(100% - 16px);
    max-width: calc(100% - 16px);
    max-height: 82%;
    border-radius: 8px 8px 0 0;
  }

  .floating-panel.panel-chat {
    width: calc(100% - 16px);
    max-width: calc(100% - 16px);
    height: min(760px, calc(100% - var(--mobile-chat-panel-top-gap)));
    max-height: calc(100% - var(--mobile-chat-panel-top-gap));
  }

}
</style>
