<template>
  <div class="juyi-page">
    <section class="hall-stage">
      <div class="stage-header">
        <div>
          <div class="eyebrow">梁山泊协作中枢</div>
          <h1>聚义厅</h1>
        </div>
        <div class="stage-actions">
          <button class="icon-action" title="好汉名册" @click="openPanel('agents')">
            <var-icon name="account-circle" />
          </button>
          <button class="icon-action" title="悬赏榜" @click="openPanel('tasks')">
            <var-icon name="format-list-checkbox" />
          </button>
          <button class="icon-action" title="厅内传令" @click="openPanel('chat')">
            <var-icon name="message-text-outline" />
          </button>
          <button class="icon-action" title="刷新大厅" @click="refreshHall">
            <var-icon name="refresh" />
          </button>
          <button class="icon-action" title="新建聚义会话" @click="newHallConversation">
            <var-icon name="plus" />
          </button>
        </div>
      </div>

      <div ref="hallBoardRef" class="hall-board">
        <div ref="mapWorldRef" class="map-world" :style="mapWorldStyle">
          <div class="map-region region-water"></div>
          <div class="map-region region-forest"></div>
          <div class="map-region region-village"></div>
          <div class="map-road road-main"></div>
          <div class="map-road road-branch"></div>
          <button class="hall-room room-main" @click="resetMap">
            <strong>聚义厅</strong>
            <small>议事中庭</small>
          </button>
          <button class="hall-room room-agents" @click="openPanel('agents')">
            <strong>名册房</strong>
            <small>好汉调度</small>
          </button>
          <button class="hall-room room-tasks" @click="openPanel('tasks')">
            <strong>悬赏房</strong>
            <small>{{ tasks.length }} 件</small>
          </button>
          <button class="hall-room room-chat" @click="openPanel('chat')">
            <strong>传令房</strong>
            <small>厅内会话</small>
          </button>
          <div class="hall-room room-back">
            <strong>后堂</strong>
            <small>整备</small>
          </div>
          <div class="beam beam-top"></div>
          <div class="banner">替天行道</div>
          <AgentToken
            v-for="agent in visibleAgents"
            :key="agent.agentId"
            :active="selectedAgent?.agentId === agent.agentId"
            :agent="agent"
            :agent-style="agentStyle"
            :bubble-text="agentBubbles[agentKey(agent)]"
            :portrait-name="portraitName"
            :portrait-short-name="portraitShortName"
            :portrait-style="portraitStyle"
            :role-class="roleClass"
            :status-class="statusClass"
            :status-text="statusText"
            @select-agent="startAgentConversation"
          />
          <div v-if="!visibleAgents.length" class="empty-hall">
            暂无 Agent 入厅，先在右侧刷新或等待上线
          </div>
          <button class="scene-hotspot hotspot-agents" @click="openPanel('agents')">
            <var-icon name="account-circle" />
            <span>名册</span>
          </button>
          <button class="scene-hotspot hotspot-tasks" @click="openPanel('tasks')">
            <var-icon name="format-list-checkbox" />
            <span>悬赏</span>
          </button>
          <button class="scene-hotspot hotspot-chat" @click="openPanel('chat')">
            <var-icon name="message-text-outline" />
            <span>传令</span>
          </button>
        </div>

        <div class="map-controls" aria-label="地图方向控制">
          <button
            v-for="control in mapControls"
            :key="control.key"
            class="map-control"
            :class="`control-${control.key}`"
            :title="control.label"
            @click="control.action()"
          >
            <var-icon :name="control.icon" />
          </button>
        </div>
      </div>

      <div class="quick-bar">
        <div class="dock-summary">
          <span>
            <strong>{{ agents.length }}</strong>
            好汉在线
          </span>
          <span>
            <strong>{{ tasks.length }}</strong>
            悬赏在榜
          </span>
          <span class="dock-focus">
            {{ selectedAgent ? `${portraitShortName(selectedAgent)} / ${selectedAgent.name || selectedAgent.agentId}` : '未选中好汉' }}
          </span>
        </div>
        <div class="dock-actions">
          <button class="quick-action" @click="openPanel('agents')">
            <var-icon name="account-circle" />
            <span>名册</span>
          </button>
          <button class="quick-action" @click="openPanel('tasks')">
            <var-icon name="format-list-checkbox" />
            <span>悬赏</span>
          </button>
          <button class="quick-action primary" @click="openPanel('chat')">
            <var-icon name="message-text-outline" />
            <span>传令</span>
          </button>
          <button class="quick-action" @click="refreshHall">
            <var-icon name="refresh" />
            <span>刷新</span>
          </button>
        </div>
      </div>
    </section>

    <SelectedAgentCard
      :ability-text="abilityText"
      :agent="selectedAgent"
      :portrait-name="portraitName"
      :portrait-style="portraitStyle"
      :status-text="statusText"
      @open-agents="openPanel('agents')"
    />

    <transition name="panel">
      <div v-if="activePanel" class="panel-overlay" @click.self="closePanel">
        <section class="floating-panel" :class="`panel-${activePanel}`">
          <div class="panel-title">
            <span>{{ activePanelTitle }}</span>
            <button class="panel-close" @click="closePanel">
              <var-icon name="close-circle-outline" />
            </button>
          </div>

          <AgentPanel
            v-if="activePanel === 'agents'"
            v-model:agent-filter="agentFilter"
            :ability-text="abilityText"
            :agents="agents"
            :filtered-agents="filteredAgents"
            :portrait-name="portraitName"
            :portrait-style="portraitStyle"
            :selected-agent="selectedAgent"
            :status-class="statusClass"
            :status-filters="statusFilters"
            :status-text="statusText"
            @select-agent="selectAgent"
          />

          <BountyPanel
            v-if="activePanel === 'tasks'"
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
            @assign-task="assignTask"
            @brief-selected-task="briefSelectedTask"
            @load-tasks="loadTasks"
            @select-agent="selectAgent"
            @select-task="selectTask"
            @set-status-filter="setTaskStatusFilter"
          />

          <ChatPanel
            v-if="activePanel === 'chat'"
            v-model:draft="draft"
            :agents="agents"
            :is-streaming="isStreaming"
            :messages="messages"
            :mention-label="portraitShortName"
            :selected-agent="selectedAgent"
            :sender-text="senderText"
            :target-text="chatTargetText"
            @load-messages="loadHallMessages"
            @mention-agent="mentionAgent"
            @send-message="sendHallMessage"
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
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useGlobalStore } from '@/stores/global'
import { useApiStore } from '@/stores/api'
import { agentApi, chatApi } from '@/composables/useHttp'
import { useHallPhysics } from '@/composables/juyiting/useHallPhysics'
import { portraitName, portraitRole, portraitShortName, portraitStyle, roleClass } from '@/composables/juyiting/useWaterMarginRoles'
import AgentPanel from '@/components/juyiting/AgentPanel.vue'
import AgentToken from '@/components/juyiting/AgentToken.vue'
import BountyPanel from '@/components/juyiting/BountyPanel.vue'
import ChatPanel from '@/components/juyiting/ChatPanel.vue'
import SelectedAgentCard from '@/components/juyiting/SelectedAgentCard.vue'
import {
  mapControlsConfig,
  roleDialogues,
  statusFilters,
  taskStatusFilters
} from '@/constants/juyiting'
import { log } from '@/utils/logger'

const globalStore = useGlobalStore()
const apiStore = useApiStore()

const agents = ref([])
const tasks = ref([])
const messages = ref([])
const selectedAgent = ref(null)
const selectedTask = ref(null)
const agentFilter = ref('all')
const taskStatusFilter = ref('')
const taskAbilityFilter = ref('')
const taskKeyword = ref('')
const conversationId = ref('')
const draft = ref('')
const isStreaming = ref(false)
const toast = ref('')
const hallBoardRef = ref(null)
const mapWorldRef = ref(null)
const activePanel = ref('')
const viewportOffset = ref({ x: 0, y: 0 })
const agentBubbles = ref({})
let bubbleTimer = null
let bubbleInitialTimer = null
let bubbleClearTimer = null
let hallEventController = null
let hallEventConversationId = ''
let hallEventReconnectTimer = null

const mapPanStep = 92
const mapPanPadding = 2

const mapWorldStyle = computed(() => ({
  '--map-offset-x': `${viewportOffset.value.x}px`,
  '--map-offset-y': `${viewportOffset.value.y}px`
}))

const panMap = (direction) => {
  const next = { ...viewportOffset.value }
  if (direction === 'left') next.x += mapPanStep
  if (direction === 'right') next.x -= mapPanStep
  if (direction === 'up') next.y += mapPanStep
  if (direction === 'down') next.y -= mapPanStep
  const bounds = mapOffsetBounds()
  viewportOffset.value = {
    x: clamp(next.x, -bounds.x, bounds.x),
    y: clamp(next.y, -bounds.y, bounds.y)
  }
}

const mapOffsetBounds = () => {
  const board = hallBoardRef.value?.getBoundingClientRect()
  const world = mapWorldRef.value?.getBoundingClientRect()
  if (!board || !world) {
    return { x: 0, y: 0 }
  }
  return {
    x: Math.max(0, (world.width - board.width) / 2 - mapPanPadding),
    y: Math.max(0, (world.height - board.height) / 2 - mapPanPadding)
  }
}

const resetMap = () => {
  viewportOffset.value = { x: 0, y: 0 }
}

const mapControls = computed(() => mapControlsConfig.map(control => ({
  ...control,
  action: () => control.direction === 'center' ? resetMap() : panMap(control.direction)
})))

const filteredAgents = computed(() => {
  if (agentFilter.value === 'all') return agents.value
  if (agentFilter.value === 'busy') {
    return agents.value.filter(agent => ['busy', 'running'].includes(normalizeStatus(agent.status)))
  }
  return agents.value.filter(agent => normalizeStatus(agent.status) === agentFilter.value)
})

const visibleAgents = computed(() => filteredAgents.value.slice(0, 12))
const taskAbilityOptions = computed(() => {
  const abilities = new Set()
  tasks.value.forEach(task => (task.requiredAbilities || []).forEach(ability => abilities.add(ability)))
  agents.value.forEach(agent => (agent.abilities || []).forEach(ability => abilities.add(ability)))
  return [...abilities].sort()
})
const recommendedAgents = computed(() => {
  if (!selectedTask.value) return []
  return agents.value
    .filter(agent => ['idle', 'online', ''].includes(normalizeStatus(agent.status || 'online')))
    .map(agent => ({ agent, score: taskAgentMatchScore(selectedTask.value, agent) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(item => item.agent)
})
const activePanelTitle = computed(() => {
  if (activePanel.value === 'agents') return '好汉名册'
  if (activePanel.value === 'tasks') return '悬赏榜'
  if (activePanel.value === 'chat') return '厅内传令'
  return ''
})
const chatTargetText = computed(() => {
  if (!selectedAgent.value) return '全体好汉'
  return `${portraitShortName(selectedAgent.value)} / ${selectedAgent.value.name || selectedAgent.value.agentId}`
})

const normalizeStatus = (status = '') => status.toLowerCase()

const statusClass = (status = '') => {
  const value = normalizeStatus(status)
  if (['busy', 'running'].includes(value)) return 'is-busy'
  if (['error', 'failed'].includes(value)) return 'is-error'
  if (['offline'].includes(value)) return 'is-offline'
  return 'is-idle'
}

const statusText = (status = '') => {
  const value = normalizeStatus(status)
  if (['busy', 'running'].includes(value)) return '出征'
  if (['error', 'failed'].includes(value)) return '异常'
  if (value === 'offline') return '离线'
  return '候命'
}

const taskStatusText = (status = '') => {
  const value = normalizeStatus(status)
  if (value === 'open') return '待接取'
  if (value === 'assigned') return '已指派'
  if (value === 'running') return '进行中'
  if (value === 'completed') return '已完成'
  if (value === 'failed') return '失败'
  return '待接取'
}

const taskStateClass = (status = '') => {
  const value = normalizeStatus(status)
  if (value === 'completed') return 'task-state-done'
  if (value === 'failed') return 'task-state-failed'
  if (value === 'running') return 'task-state-running'
  if (value === 'assigned') return 'task-state-assigned'
  return 'task-state-open'
}

const abilityText = (agent) => {
  const abilities = agent.abilities || []
  return abilities.length ? abilities.slice(0, 3).join(' / ') : '未登记能力'
}

const taskAgentMatchScore = (task, agent) => {
  const requiredAbilities = task?.requiredAbilities || []
  if (!requiredAbilities.length) return 80
  const agentAbilities = new Set((agent?.abilities || []).map(ability => ability.toLowerCase()))
  const matched = requiredAbilities.filter(ability => agentAbilities.has(String(ability).toLowerCase())).length
  return Math.round((matched / requiredAbilities.length) * 100)
}

const formatTime = (timestamp) => {
  if (!timestamp) return ''
  const date = new Date(Number(timestamp))
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getMonth() + 1}-${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const agentKey = (agent) => agent?.agentId || agent?.name || agent?.personaName || ''

const { agentStyle, startPhysics, stopPhysics } = useHallPhysics(visibleAgents, normalizeStatus)

const selectTask = (task) => {
  selectedTask.value = task
}

const selectAgent = (agent) => {
  selectedAgent.value = agent
  showToast(`已选中 ${portraitShortName(agent)} / ${agent.name || agent.personaName || agent.agentId}`)
}

const startAgentConversation = (agent) => {
  selectedAgent.value = agent
  insertAgentMention(agent, '请汇报当前状态、可承接任务和需要协助的事项。')
  openPanel('chat')
  showToast(`正在与 ${portraitShortName(agent)} 对话`)
}

const mentionAgent = (agent) => {
  selectedAgent.value = agent
  insertAgentMention(agent)
}

const insertAgentMention = (agent, suffix = '') => {
  const mention = `@${portraitShortName(agent)}`
  const current = draft.value.trim()
  if (!current) {
    draft.value = suffix ? `${mention} ${suffix}` : `${mention} `
    return
  }
  if (current.includes(mention)) {
    draft.value = suffix && current === mention ? `${mention} ${suffix}` : draft.value
    return
  }
  draft.value = `${current} ${mention}${suffix ? ` ${suffix}` : ' '}`
}

const openPanel = (panel) => {
  activePanel.value = panel
}

const closePanel = () => {
  activePanel.value = ''
}

const canAssign = (task) => {
  if (!selectedAgent.value) return false
  if (!['open', 'pending', ''].includes(normalizeStatus(task.status))) return false
  return ['idle', 'online', ''].includes(normalizeStatus(selectedAgent.value.status || 'online'))
}

const setTaskStatusFilter = async (status) => {
  taskStatusFilter.value = status
  await loadTasks()
}

const taskStatusCount = (status) => {
  if (!status) return tasks.value.length
  return tasks.value.filter(task => normalizeStatus(task.status) === status).length
}

const briefSelectedTask = () => {
  if (!selectedTask.value) return
  const abilities = (selectedTask.value.requiredAbilities || []).join(' / ') || '不限能力'
  draft.value = `请围绕悬赏「${selectedTask.value.title}」议事：任务编号 ${selectedTask.value.id}，状态 ${taskStatusText(selectedTask.value.status)}，所需能力 ${abilities}。请给出适合承接的好汉、风险和下一步安排。`
  openPanel('chat')
  showToast('已生成传令内容')
}

const senderText = (message) => {
  if (message.senderName) return message.senderName
  if (message.sender === 'USER') return '你'
  if (message.sender === 'SYSTEM') return '系统'
  return '聚义厅'
}

const parseMessageMetadata = (metadata) => {
  if (!metadata) return {}
  if (typeof metadata === 'object') return metadata
  try {
    return JSON.parse(metadata)
  } catch {
    return {}
  }
}

const normalizeHallMessage = (item, index = 0) => {
  const metadata = parseMessageMetadata(item.metadata)
  return {
    localId: `${item.id || metadata.messageId || index}`,
    sender: item.senderType === 'agent' ? 'AGENT' : (item.messageType || item.senderType || 'SYSTEM'),
    senderName: item.senderName || metadata.senderName,
    agentId: metadata.agentId,
    content: item.content || '',
    timestamp: item.createTime || metadata.timestamp || Date.now()
  }
}

const appendHallEventMessage = (event) => {
  if (!event || event.conversationId?.toString() !== conversationId.value?.toString()) return
  const localId = `${event.messageId || `${event.agentId}-${event.timestamp || Date.now()}`}`
  if (messages.value.some(message => message.localId === localId)) return
  messages.value.push({
    localId,
    sender: event.senderType === 'agent' ? 'AGENT' : (event.messageType || 'ASSISTANT'),
    senderName: event.senderName,
    agentId: event.agentId,
    content: event.content || '',
    timestamp: event.timestamp || Date.now()
  })
  if (event.senderName) {
    showToast(`${event.senderName} 已回话`)
  }
}

const apiStreamUrl = (path, params = {}) => {
  const baseURL = import.meta.env.VITE_API_BASE_URL || ''
  const requestPath = baseURL
    ? `${baseURL}${path.startsWith('/') ? path : `/${path}`}`
    : path
  const searchParams = new URLSearchParams(params).toString()
  return searchParams ? `${requestPath}?${searchParams}` : requestPath
}

const startHallEventStream = async () => {
  const id = conversationId.value?.toString()
  if (!id || hallEventConversationId === id) return
  stopHallEventStream()
  hallEventConversationId = id
  hallEventController = new AbortController()

  try {
    const token = await apiStore.token()
    const response = await fetch(apiStreamUrl('/chat/conversation/events', { id }), {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: hallEventController.signal
    })
    if (!response.ok || !response.body) {
      throw new Error(`Hall event stream failed: ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let eventEndIndex
      while ((eventEndIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.substring(0, eventEndIndex).trim()
        buffer = buffer.substring(eventEndIndex + 1)
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload) continue
        appendHallEventMessage(JSON.parse(payload))
      }
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      log.warn('聚义厅实时消息连接中断:', error)
      hallEventReconnectTimer = window.setTimeout(() => {
        hallEventConversationId = ''
        startHallEventStream()
      }, 2500)
    }
  }
}

const stopHallEventStream = () => {
  if (hallEventReconnectTimer) window.clearTimeout(hallEventReconnectTimer)
  hallEventReconnectTimer = null
  if (hallEventController) hallEventController.abort()
  hallEventController = null
  hallEventConversationId = ''
}

const showToast = (message) => {
  toast.value = message
  setTimeout(() => {
    if (toast.value === message) toast.value = ''
  }, 2200)
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
  if (bubbleClearTimer) window.clearTimeout(bubbleClearTimer)
  bubbleClearTimer = window.setTimeout(() => {
    agentBubbles.value = {}
  }, 3600)
}

const loadAgents = async () => {
  try {
    await agentApi.get('/active', {}, {
      autoLoading: false,
      onSuccess: (result) => {
        agents.value = result?.data || []
        if (selectedAgent.value && !agents.value.some(agent => agent.agentId === selectedAgent.value.agentId)) {
          selectedAgent.value = null
        }
        if (!selectedAgent.value && agents.value.length) {
          selectedAgent.value = agents.value[0]
        }
      }
    })
  } catch (error) {
    log.warn('加载活跃 Agent 列表失败:', error)
    agents.value = []
    selectedAgent.value = null
  }
}

const loadTasks = async () => {
  try {
    await agentApi.search('/tasks/search', {
      status: taskStatusFilter.value || undefined,
      ability: taskAbilityFilter.value || undefined,
      keyword: taskKeyword.value || undefined,
      pageNum: 1,
      pageSize: 30
    }, {
      autoLoading: false,
      onSuccess: (result) => {
        const list = result?.data || []
        tasks.value = list
        if (selectedTask.value && !tasks.value.some(task => task.id === selectedTask.value.id)) {
          selectedTask.value = null
        }
      }
    })
  } catch (error) {
    log.warn('加载悬赏榜失败:', error)
    tasks.value = []
    selectedTask.value = null
  }
}

const loadHallMessages = async () => {
  try {
    await chatApi.list('/conversation/list', {
      pageNum: 1,
      pageSize: 1,
      orderBy: 'update_time desc',
      search: {
        jiacn: globalStore.getJiacn,
        conversationType: 'juyiting'
      }
    }, {
      autoLoading: false,
      onSuccess: async (result) => {
        const hallConversation = result?.data?.[0]
        if (!hallConversation) return
        conversationId.value = hallConversation.id?.toString() || ''
        await chatApi.getById('/conversation/content', conversationId.value, {
          autoLoading: false,
          onSuccess: (contentResult) => {
            messages.value = (contentResult?.data || []).map(normalizeHallMessage)
            startHallEventStream()
          }
        })
      }
    })
  } catch (error) {
    log.warn('加载聚义厅会话失败:', error)
  }
}

const refreshHall = async () => {
  await Promise.all([loadAgents(), loadTasks(), loadHallMessages()])
  showToast('聚义厅已刷新')
}

const newHallConversation = () => {
  stopHallEventStream()
  conversationId.value = ''
  messages.value = []
  showToast('已开启新的聚义议事')
}

const processStream = (eventData) => {
  let payload = eventData.startsWith('data:') ? eventData.slice(5).trim() : eventData.trim()
  if (!payload || payload === '[DONE]' || payload === '[EOM]') return

  try {
    const data = JSON.parse(payload)
    if (data.conversationId) {
      const nextConversationId = data.conversationId?.toString() || ''
      const shouldReconnect = nextConversationId && nextConversationId !== conversationId.value?.toString()
      conversationId.value = nextConversationId
      if (shouldReconnect) startHallEventStream()
      return
    }
    payload = data.v || data.content || ''
  } catch {
    // plain text stream
  }

  if (!payload) return
  const last = messages.value[messages.value.length - 1]
  if (last?.sender === 'ASSISTANT') {
    last.content += payload
  } else {
    messages.value.push({
      localId: `assistant-${Date.now()}`,
      sender: 'ASSISTANT',
      content: payload,
      timestamp: Date.now()
    })
  }
}

const sendHallMessage = async () => {
  if (!draft.value || isStreaming.value) return
  const content = draft.value
  draft.value = ''
  messages.value.push({
    localId: `user-${Date.now()}`,
    sender: 'USER',
    content,
    timestamp: Date.now()
  })
  isStreaming.value = true

  try {
    await chatApi.create('/stream', {
      content,
      conversationId: conversationId.value,
      conversationType: 'juyiting',
      metadata: {
        scene: 'juyiting',
        selectedAgentId: selectedAgent.value?.agentId,
        selectedTaskId: selectedTask.value?.id
      }
    }, {
      responseType: 'stream',
      autoLoading: false,
      timeout: 1800000,
      onStream: processStream,
      onStreamEnd: () => {
        isStreaming.value = false
      },
      onError: (message) => {
        throw new Error(message)
      }
    })
  } catch (error) {
    log.error('聚义厅消息发送失败:', error)
    isStreaming.value = false
    messages.value.push({
      localId: `system-${Date.now()}`,
      sender: 'SYSTEM',
      content: '传令失败，请稍后再试',
      timestamp: Date.now()
    })
  }
}

const assignTask = async (task) => {
  if (!canAssign(task)) return
  try {
    await agentApi.create(`/tasks/${task.id}/assign`, {
      agentId: selectedAgent.value.agentId
    }, {
      autoLoading: false,
      onSuccess: () => {
        task.status = 'assigned'
        task.assignedAgentId = selectedAgent.value.agentId
        task.assignedAgentName = selectedAgent.value.name
        selectedAgent.value.status = 'busy'
        selectedAgent.value.currentTaskTitle = task.title
        showToast(`${task.title} 已指派给 ${selectedAgent.value.name || selectedAgent.value.agentId}`)
      }
    })
  } catch (error) {
    log.warn('指派任务失败:', error)
    showToast('指派失败，请刷新状态后重试')
  }
}

onMounted(async () => {
  globalStore.setTitle('聚义厅')
  globalStore.setShowBack(false)
  globalStore.setShowMore(false)
  await refreshHall()
  startPhysics()
  startDialogueBubbles()
})

onUnmounted(() => {
  stopHallEventStream()
  stopPhysics()
  stopDialogueBubbles()
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
  background:
    radial-gradient(circle at 50% 48%, rgba(255, 238, 180, 0.16), transparent 32%),
    linear-gradient(135deg, #17231d, #1b271f 50%, #0e1411);
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

.room-chat {
  left: 40%;
  top: 14%;
  width: 20%;
  height: 17%;
  background:
    linear-gradient(145deg, rgba(230, 235, 205, 0.76), rgba(116, 151, 110, 0.58));
}

.room-back {
  left: 40%;
  bottom: 13%;
  width: 20%;
  height: 16%;
  background:
    linear-gradient(145deg, rgba(235, 218, 184, 0.74), rgba(112, 76, 47, 0.56));
}

.map-controls {
  position: absolute;
  left: 14px;
  bottom: 96px;
  z-index: 12;
  display: grid;
  grid-template-columns: repeat(3, 30px);
  grid-template-rows: repeat(3, 30px);
  gap: 4px;
  padding: 7px;
  border: 1px solid rgba(255, 244, 212, 0.18);
  border-radius: 8px;
  background: rgba(20, 26, 22, 0.3);
  color: #fff4d4;
  backdrop-filter: blur(10px);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.18);
}

.map-control {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  min-height: 30px;
  border-radius: 8px;
  background: rgba(255, 244, 212, 0.18);
  color: #fff8e8;
  transition: background 0.16s ease, transform 0.16s ease;
}

.map-control:hover {
  background: rgba(244, 200, 76, 0.46);
  transform: translateY(-1px);
}

.control-up {
  grid-column: 2;
  grid-row: 1;
}

.control-left {
  grid-column: 1;
  grid-row: 2;
}

.control-center {
  grid-column: 2;
  grid-row: 2;
}

.control-right {
  grid-column: 3;
  grid-row: 2;
}

.control-down {
  grid-column: 2;
  grid-row: 3;
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

.quick-bar {
  position: relative;
  z-index: 8;
  display: grid;
  grid-template-columns: minmax(240px, 1fr) auto;
  align-items: center;
  gap: 12px;
  flex: 0 0 auto;
  width: 100%;
  padding: 10px max(18px, env(safe-area-inset-right)) max(10px, env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-left));
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

.dock-focus {
  min-width: 0;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
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

.hotspot-chat {
  right: 8%;
  top: 58%;
}

.panel-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 72px 20px 92px;
  background: rgba(18, 13, 10, 0.42);
}

.floating-panel {
  display: flex;
  flex-direction: column;
  width: min(860px, 100%);
  min-height: 0;
  max-height: 100%;
  border: 1px solid rgba(71, 44, 23, 0.2);
  border-radius: 8px;
  background: #fffaf0;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.34);
  overflow: hidden;
}

.panel-chat {
  width: min(760px, 100%);
}

.panel-title {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
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
  width: 36px;
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

.panel-enter-active,
.panel-leave-active {
  transition: opacity 0.18s ease;
}

.panel-enter-active .floating-panel,
.panel-leave-active .floating-panel {
  transition: transform 0.18s ease, opacity 0.18s ease;
}

.panel-enter-from,
.panel-leave-to {
  opacity: 0;
}

.panel-enter-from .floating-panel,
.panel-leave-to .floating-panel {
  opacity: 0;
  transform: translateY(12px) scale(0.98);
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

  .hotspot-chat {
    right: 5%;
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

  .dock-focus {
    max-width: none;
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

  .room-chat {
    left: 39%;
    top: 14%;
    width: 22%;
    height: 16%;
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

  .map-controls {
    left: 8px;
    bottom: 154px;
    grid-template-columns: repeat(3, 28px);
    grid-template-rows: repeat(3, 28px);
    gap: 4px;
    padding: 6px;
  }

  .map-control {
    min-width: 28px;
    min-height: 28px;
  }

  .panel-overlay {
    align-items: flex-end;
    padding: 0;
  }

  .floating-panel {
    width: 100%;
    max-height: 82%;
    border-radius: 8px 8px 0 0;
  }

}
</style>
