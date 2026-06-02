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
        <button
          v-for="agent in visibleAgents"
          :key="agent.agentId"
          class="agent-token"
          :class="[statusClass(agent.status), roleClass(agent), { active: selectedAgent?.agentId === agent.agentId }]"
          :style="agentStyle(agent)"
          @click="selectAgent(agent)"
        >
          <span class="agent-shadow"></span>
          <span class="agent-figure" :title="portraitName(agent)">
            <span class="agent-weapon"></span>
            <span class="agent-cape"></span>
            <span class="agent-hat"></span>
            <span
              class="agent-head portrait-avatar"
              :style="portraitStyle(agent)"
            ></span>
            <span class="agent-shoulder agent-shoulder-left"></span>
            <span class="agent-shoulder agent-shoulder-right"></span>
            <span class="agent-arm agent-arm-left"></span>
            <span class="agent-arm agent-arm-right"></span>
            <span class="agent-body">
              <span class="agent-sash"></span>
              <span class="agent-emblem"></span>
            </span>
            <span class="agent-leg agent-leg-left"></span>
            <span class="agent-leg agent-leg-right"></span>
            <span class="agent-accessory"></span>
          </span>
          <span class="agent-name-tag">{{ portraitShortName(agent) }}</span>
          <span class="agent-status-badge">{{ statusText(agent.status) }}</span>
        </button>
        <div v-if="!visibleAgents.length" class="empty-hall">
          暂无 Agent 入厅，先在右侧刷新或等待上线
        </div>
        <div class="table-core">
          <span>悬赏议事桌</span>
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
        <button
          v-for="action in quickActions"
          :key="action.key"
          class="quick-action"
          @click="runQuickAction(action)"
        >
          <var-icon :name="action.icon" />
          <span>{{ action.label }}</span>
        </button>
      </div>
    </section>

    <aside class="selected-agent-card" @click="openPanel('agents')">
      <template v-if="selectedAgent">
        <span
          class="large-avatar portrait-avatar"
          :style="portraitStyle(selectedAgent)"
          :title="portraitName(selectedAgent)"
        ></span>
        <div>
          <strong>{{ selectedAgent.name || selectedAgent.personaName }}</strong>
          <small>{{ portraitName(selectedAgent) }} / {{ statusText(selectedAgent.status) }} / {{ selectedAgent.currentTaskTitle || abilityText(selectedAgent) }}</small>
        </div>
      </template>
      <span v-else>点击好汉查看详情</span>
    </aside>

    <div class="bottom-dock">
      <button
        :class="{ active: activePanel === 'agents' }"
        @click="openPanel('agents')"
      >
        <var-icon name="account-circle" />
        <span>名册</span>
      </button>
      <button
        :class="{ active: activePanel === 'tasks' }"
        @click="openPanel('tasks')"
      >
        <var-icon name="format-list-checkbox" />
        <span>悬赏</span>
      </button>
      <button
        :class="{ active: activePanel === 'chat' }"
        @click="openPanel('chat')"
      >
        <var-icon name="message-text-outline" />
        <span>传令</span>
      </button>
    </div>

    <transition name="panel">
      <div v-if="activePanel" class="panel-overlay" @click.self="closePanel">
        <section class="floating-panel" :class="`panel-${activePanel}`">
          <div class="panel-title">
            <span>{{ activePanelTitle }}</span>
            <button class="panel-close" @click="closePanel">
              <var-icon name="close-circle-outline" />
            </button>
          </div>

          <template v-if="activePanel === 'agents'">
            <div class="panel-toolbar">
              <div class="status-filter">
                <button
                  v-for="item in statusFilters"
                  :key="item.value"
                  :class="{ active: agentFilter === item.value }"
                  @click="agentFilter = item.value"
                >
                  {{ item.label }}
                </button>
              </div>
              <span>{{ agents.length }} 人</span>
            </div>
            <div class="agent-panel-body">
              <div class="agent-list">
                <button
                  v-for="agent in filteredAgents"
                  :key="agent.agentId"
                  class="agent-row"
                  :class="{ active: selectedAgent?.agentId === agent.agentId }"
                  @click="selectAgent(agent)"
                >
                  <span
                    class="mini-avatar portrait-avatar"
                    :style="portraitStyle(agent)"
                    :title="portraitName(agent)"
                  ></span>
                  <span>
                    <strong>{{ agent.name || agent.personaName || agent.agentId }}</strong>
                    <small>{{ portraitName(agent) }} / {{ agent.currentTaskTitle || abilityText(agent) }}</small>
                  </span>
                  <em :class="statusClass(agent.status)">{{ statusText(agent.status) }}</em>
                </button>
              </div>
              <div class="detail-card">
                <template v-if="selectedAgent">
                  <div class="detail-head">
                    <span
                      class="large-avatar portrait-avatar"
                      :style="portraitStyle(selectedAgent)"
                      :title="portraitName(selectedAgent)"
                    ></span>
                    <div>
                      <strong>{{ selectedAgent.name || selectedAgent.personaName }}</strong>
                      <small>{{ portraitName(selectedAgent) }} / {{ selectedAgent.agentId }}</small>
                    </div>
                  </div>
                  <div class="ability-tags">
                    <span v-for="ability in selectedAgent.abilities || []" :key="ability">{{ ability }}</span>
                    <span v-if="!(selectedAgent.abilities || []).length">未登记能力</span>
                  </div>
                  <p>{{ selectedAgent.errorMessage || selectedAgent.currentTaskTitle || '正在厅中候命，可从悬赏榜指派任务。' }}</p>
                </template>
                <p v-else>点击厅中人物查看状态、能力和当前任务。</p>
              </div>
            </div>
          </template>

          <template v-if="activePanel === 'tasks'">
            <div class="panel-toolbar">
              <div class="task-search">
                <input
                  v-model.trim="taskKeyword"
                  placeholder="搜索悬赏编号"
                  @keyup.enter="loadTasks"
                />
                <select v-model="taskAbilityFilter" @change="loadTasks">
                  <option value="">全部能力</option>
                  <option v-for="ability in taskAbilityOptions" :key="ability" :value="ability">{{ ability }}</option>
                </select>
              </div>
              <button @click="loadTasks">
                <var-icon name="refresh" />
                <span>刷新</span>
              </button>
            </div>
            <div class="task-status-tabs">
              <button
                v-for="item in taskStatusFilters"
                :key="item.value"
                :class="{ active: taskStatusFilter === item.value }"
                @click="setTaskStatusFilter(item.value)"
              >
                {{ item.label }}
                <small>{{ taskStatusCount(item.value) }}</small>
              </button>
            </div>
            <div class="task-panel-body">
              <div class="task-list">
                <article
                  v-for="task in tasks"
                  :key="task.id"
                  class="task-card"
                  :class="{ selected: selectedTask?.id === task.id }"
                  @click="selectTask(task)"
                >
                  <div class="task-head">
                    <strong>{{ task.title }}</strong>
                    <span :class="taskStateClass(task.status)">{{ taskStatusText(task.status) }}</span>
                  </div>
                  <p>{{ task.description || '暂无任务描述' }}</p>
                  <div class="task-meta">
                    <span>{{ task.id }}</span>
                    <span v-if="task.assignedAgentName">承接：{{ task.assignedAgentName }}</span>
                    <span v-if="task.updatedAt">{{ formatTime(task.updatedAt) }}</span>
                  </div>
                  <div class="ability-tags">
                    <span v-for="ability in task.requiredAbilities || []" :key="ability">{{ ability }}</span>
                    <span v-if="!(task.requiredAbilities || []).length">不限能力</span>
                  </div>
                </article>
                <div v-if="!tasks.length" class="empty-list">暂无悬赏，调整筛选或刷新后再试</div>
              </div>

              <aside class="task-detail-card">
                <template v-if="selectedTask">
                  <div class="task-detail-head">
                    <div>
                      <strong>{{ selectedTask.title }}</strong>
                      <small>{{ selectedTask.id }} / {{ taskStatusText(selectedTask.status) }}</small>
                    </div>
                    <span :class="taskStateClass(selectedTask.status)">{{ taskStatusText(selectedTask.status) }}</span>
                  </div>

                  <p>{{ selectedTask.description || '暂无任务描述' }}</p>

                  <div class="ability-tags">
                    <span v-for="ability in selectedTask.requiredAbilities || []" :key="ability">{{ ability }}</span>
                    <span v-if="!(selectedTask.requiredAbilities || []).length">不限能力</span>
                  </div>

                  <div class="task-operation-grid">
                    <button
                      :disabled="!canAssign(selectedTask)"
                      @click="assignTask(selectedTask)"
                    >
                      <var-icon name="account-circle" />
                      <span>指派当前好汉</span>
                    </button>
                    <button @click="briefSelectedTask">
                      <var-icon name="message-text-outline" />
                      <span>传令议事</span>
                    </button>
                  </div>

                  <div class="recommended-agents">
                    <div class="section-label">适配好汉</div>
                    <button
                      v-for="agent in recommendedAgents"
                      :key="agent.agentId"
                      :class="{ active: selectedAgent?.agentId === agent.agentId }"
                      @click="selectAgent(agent)"
                    >
                      <span
                        class="mini-avatar portrait-avatar"
                        :style="portraitStyle(agent)"
                        :title="portraitName(agent)"
                      ></span>
                      <span>
                        <strong>{{ agent.name || agent.personaName || agent.agentId }}</strong>
                        <small>{{ abilityText(agent) }}</small>
                      </span>
                      <em>{{ taskAgentMatchScore(selectedTask, agent) }}%</em>
                    </button>
                    <p v-if="!recommendedAgents.length">暂无活跃好汉可接令。</p>
                  </div>
                </template>
                <p v-else>选择一条悬赏后查看详情和可用操作。</p>
              </aside>
            </div>
          </template>
          <template v-if="activePanel === 'chat'">
            <div class="panel-toolbar">
              <span>厅内传令会带上当前好汉和悬赏上下文。</span>
              <button @click="loadHallMessages">同步</button>
            </div>
            <div ref="messageBoxRef" class="hall-messages">
              <div
                v-for="message in messages"
                :key="message.localId || message.timestamp"
                class="hall-message"
                :class="message.sender"
              >
                <strong>{{ senderText(message) }}</strong>
                <p>{{ message.content }}</p>
              </div>
              <div v-if="!messages.length" class="empty-list">厅中尚无传令，发起一句开始议事。</div>
            </div>
            <form class="hall-input" @submit.prevent="sendHallMessage">
              <input
                v-model.trim="draft"
                :disabled="isStreaming"
                placeholder="向聚义厅发令，或 @某位好汉"
              />
              <button :disabled="!draft || isStreaming">
                <var-icon :name="isStreaming ? 'refresh' : 'chevron-right'" />
              </button>
            </form>
          </template>
        </section>
      </div>
    </transition>

    <transition name="toast">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </transition>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useGlobalStore } from '@/stores/global'
import { agentApi, chatApi } from '@/composables/useHttp'
import { log } from '@/utils/logger'
import waterMarginAgents from '@/assets/juyiting/water-margin-agents.png'

const globalStore = useGlobalStore()

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
const messageBoxRef = ref(null)
const hallBoardRef = ref(null)
const mapWorldRef = ref(null)
const activePanel = ref('')
const physicsFrame = ref(0)
const viewportOffset = ref({ x: 0, y: 0 })
const agentPhysics = new Map()
let physicsRaf = 0
let lastPhysicsTime = 0

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

const mapControls = [
  { key: 'up', icon: 'chevron-up', label: '上移视野', action: () => panMap('up') },
  { key: 'left', icon: 'chevron-left', label: '左移视野', action: () => panMap('left') },
  { key: 'center', icon: 'crosshairs-gps', label: '回到中心', action: resetMap },
  { key: 'right', icon: 'chevron-right', label: '右移视野', action: () => panMap('right') },
  { key: 'down', icon: 'chevron-down', label: '下移视野', action: () => panMap('down') }
]

const statusFilters = [
  { label: '全部', value: 'all' },
  { label: '空闲', value: 'idle' },
  { label: '忙碌', value: 'busy' },
  { label: '异常', value: 'error' }
]

const taskStatusFilters = [
  { label: '全部', value: '' },
  { label: '待接取', value: 'open' },
  { label: '已指派', value: 'assigned' },
  { label: '进行中', value: 'running' },
  { label: '已完成', value: 'completed' },
  { label: '失败', value: 'failed' }
]

const quickActions = [
  { key: 'summon', icon: 'bell-outline', label: '点将', text: '请各位好汉报上当前状态和可接任务。' },
  { key: 'bounty', icon: 'format-list-checkbox', label: '看榜', text: '请汇总当前悬赏榜中最适合优先处理的任务。' },
  { key: 'review', icon: 'check-circle-outline', label: '复盘', text: '请复盘最近一次任务协作，列出风险和下一步。' },
  { key: 'tea', icon: 'message-text-outline', label: '闲谈', text: '今日聚义厅中，哪位好汉有新的见闻？' }
]

const portraitRoles = [
  { slug: 'songjiang', name: '宋江', title: '统领型', x: 0, y: 0, robe: '#7c1f1b', trim: '#f4c84c', scale: 1, step: 0.86 },
  { slug: 'wuyong', name: '吴用', title: '谋略型', x: 1, y: 0, robe: '#23483e', trim: '#d7b875', scale: 0.96, step: 0.78 },
  { slug: 'linchong', name: '林冲', title: '攻坚型', x: 2, y: 0, robe: '#3f4f78', trim: '#c08a46', scale: 1.04, step: 0.72 },
  { slug: 'luzhishen', name: '鲁智深', title: '护法型', x: 0, y: 1, robe: '#8b5a1f', trim: '#d9d0be', scale: 1.12, step: 0.92 },
  { slug: 'yanqing', name: '燕青', title: '机动型', x: 1, y: 1, robe: '#5c2d63', trim: '#7a9e7e', scale: 0.92, step: 0.62 },
  { slug: 'likui', name: '李逵', title: '先锋型', x: 2, y: 1, robe: '#6d3f1f', trim: '#b93622', scale: 1.08, step: 0.68 }
]

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

watch(messages, () => {
  nextTick(() => {
    if (messageBoxRef.value) {
      messageBoxRef.value.scrollTop = messageBoxRef.value.scrollHeight
    }
  })
}, { deep: true })

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

const agentSeed = (agent) => {
  const source = agent?.personaName || agent?.name || agent?.agentId || ''
  return Array.from(source).reduce((sum, char) => sum + char.charCodeAt(0), 0)
}

const portraitRole = (agent) => {
  const explicitName = `${agent?.personaName || ''}${agent?.name || ''}`
  const matched = portraitRoles.find(role => explicitName.includes(role.name))
  if (matched) return matched
  return portraitRoles[agentSeed(agent) % portraitRoles.length]
}

const portraitName = (agent) => {
  const role = portraitRole(agent)
  return `${role.name}${role.title ? `·${role.title}` : ''}`
}

const portraitShortName = (agent) => portraitRole(agent).name

const roleClass = (agent) => `role-${portraitRole(agent).slug}`

const portraitStyle = (agent) => {
  if (agent?.avatar) {
    return {
      backgroundImage: `url("${agent.avatar}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center'
    }
  }

  const role = portraitRole(agent)
  return {
    backgroundImage: `url("${waterMarginAgents}")`,
    backgroundSize: '300% 200%',
    backgroundPosition: `${role.x * 50}% ${role.y * 100}%`
  }
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

const hallRoutes = [
  [[12, 72], [16, 45], [34, 28], [62, 28], [82, 44], [86, 70], [58, 73], [28, 76]],
  [[18, 38], [38, 24], [72, 30], [86, 50], [78, 70], [63, 62], [42, 61], [22, 68]],
  [[78, 36], [58, 24], [31, 30], [14, 52], [24, 72], [41, 64], [61, 62], [84, 68]],
  [[27, 80], [18, 64], [26, 43], [48, 31], [73, 40], [84, 58], [70, 76], [43, 78]],
  [[52, 24], [78, 33], [88, 52], [73, 66], [61, 55], [39, 55], [25, 66], [12, 50]],
  [[15, 58], [24, 33], [49, 24], [77, 34], [86, 62], [66, 73], [50, 60], [34, 73]]
]

const routePoint = (route, index, seed) => {
  const [x, y] = route[index % route.length]
  const jitterX = ((seed + index * 7) % 7) - 3
  const jitterY = ((seed + index * 5) % 5) - 2
  return {
    x: Math.min(90, Math.max(10, x + jitterX)),
    y: Math.min(82, Math.max(22, y + jitterY))
  }
}

const hallObstacles = [
  { x: 50, y: 76, rx: 19, ry: 12, strength: 2.8 },
  { x: 50, y: 23, rx: 12, ry: 8, strength: 1.7 },
  { x: 8, y: 63, rx: 12, ry: 9, strength: 1.4 },
  { x: 88, y: 63, rx: 12, ry: 9, strength: 1.4 },
  { x: 84, y: 22, rx: 12, ry: 9, strength: 1.3 }
]

const walkBounds = {
  minX: 9,
  maxX: 91,
  minY: 22,
  maxY: 84
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const limitVector = (vector, maxLength) => {
  const length = Math.hypot(vector.x, vector.y)
  if (!length || length <= maxLength) return vector
  const scale = maxLength / length
  return { x: vector.x * scale, y: vector.y * scale }
}

const createPhysicsState = (agent) => {
  const seed = agentSeed(agent)
  const route = hallRoutes[seed % hallRoutes.length]
  const startOffset = seed % route.length
  const points = Array.from({ length: 8 }, (_, index) => routePoint(route, startOffset + index, seed))
  const start = points[0]
  return {
    seed,
    points,
    targetIndex: 1,
    x: start.x,
    y: start.y,
    vx: (((seed % 5) - 2) * 0.02),
    vy: (((seed % 7) - 3) * 0.015),
    face: points[1].x >= start.x ? 1 : -1,
    speed: 0
  }
}

const physicsKey = (agent) => agent?.agentId || agent?.name || agent?.personaName || `${agentSeed(agent)}`

const getPhysicsState = (agent) => {
  const key = physicsKey(agent)
  if (!agentPhysics.has(key)) {
    agentPhysics.set(key, createPhysicsState(agent))
  }
  return agentPhysics.get(key)
}

const syncPhysicsAgents = () => {
  const activeKeys = new Set(visibleAgents.value.map(physicsKey))
  for (const key of agentPhysics.keys()) {
    if (!activeKeys.has(key)) agentPhysics.delete(key)
  }
  visibleAgents.value.forEach(getPhysicsState)
}

const obstacleAvoidance = (state) => {
  return hallObstacles.reduce((force, obstacle) => {
    const dx = state.x - obstacle.x
    const dy = state.y - obstacle.y
    const normalized = Math.hypot(dx / obstacle.rx, dy / obstacle.ry)
    if (normalized >= 1.18) return force
    const falloff = (1.18 - Math.max(normalized, 0.08)) / 1.18
    const length = Math.hypot(dx, dy) || 1
    force.x += (dx / length) * falloff * obstacle.strength
    force.y += (dy / length) * falloff * obstacle.strength
    return force
  }, { x: 0, y: 0 })
}

const separationForce = (state, allStates) => {
  return allStates.reduce((force, other) => {
    if (other === state) return force
    const dx = state.x - other.x
    const dy = state.y - other.y
    const distance = Math.hypot(dx, dy) || 1
    if (distance > 8.5) return force
    const strength = (8.5 - distance) / 8.5
    force.x += (dx / distance) * strength * 1.8
    force.y += (dy / distance) * strength * 1.2
    return force
  }, { x: 0, y: 0 })
}

const updatePhysics = (time) => {
  if (!lastPhysicsTime) lastPhysicsTime = time
  const dt = clamp((time - lastPhysicsTime) / 1000, 0.001, 0.05)
  lastPhysicsTime = time

  syncPhysicsAgents()
  const states = visibleAgents.value.map(getPhysicsState)
  states.forEach((state, index) => {
    const target = state.points[state.targetIndex]
    const dx = target.x - state.x
    const dy = target.y - state.y
    const distance = Math.hypot(dx, dy) || 1
    if (distance < 2.4) {
      state.targetIndex = (state.targetIndex + 1) % state.points.length
    }

    const nextTarget = state.points[state.targetIndex]
    const toTargetX = nextTarget.x - state.x
    const toTargetY = nextTarget.y - state.y
    const targetDistance = Math.hypot(toTargetX, toTargetY) || 1
    const role = portraitRole(visibleAgents.value[index])
    const status = normalizeStatus(visibleAgents.value[index]?.status)
    const maxSpeed = (status === 'busy' || status === 'running' ? 9.4 : 7.2) * (1.12 - (role.scale - 0.9) * 0.25)
    const desiredSpeed = targetDistance < 8 ? maxSpeed * 0.58 : maxSpeed
    const desired = {
      x: (toTargetX / targetDistance) * desiredSpeed,
      y: (toTargetY / targetDistance) * desiredSpeed
    }
    const avoid = obstacleAvoidance(state)
    const separate = separationForce(state, states)
    const steering = limitVector({
      x: (desired.x - state.vx) * 1.5 + avoid.x + separate.x,
      y: (desired.y - state.vy) * 1.5 + avoid.y + separate.y
    }, 9.5)

    state.vx += steering.x * dt
    state.vy += steering.y * dt
    const velocity = limitVector({ x: state.vx, y: state.vy }, maxSpeed)
    state.vx = velocity.x * 0.982
    state.vy = velocity.y * 0.982
    state.x = clamp(state.x + state.vx * dt, walkBounds.minX, walkBounds.maxX)
    state.y = clamp(state.y + state.vy * dt, walkBounds.minY, walkBounds.maxY)
    state.speed = Math.hypot(state.vx, state.vy)
    if (Math.abs(state.vx) > 0.08) state.face = state.vx > 0 ? 1 : -1
  })

  physicsFrame.value += 1
  physicsRaf = requestAnimationFrame(updatePhysics)
}

const startPhysics = () => {
  if (physicsRaf) return
  lastPhysicsTime = 0
  physicsRaf = requestAnimationFrame(updatePhysics)
}

const stopPhysics = () => {
  if (!physicsRaf) return
  cancelAnimationFrame(physicsRaf)
  physicsRaf = 0
}

const agentStyle = (agent) => {
  physicsFrame.value
  const state = getPhysicsState(agent)
  const role = portraitRole(agent)
  const walkActivity = clamp(state.speed / 7, 0.25, 1)
  return {
    left: `${state.x}%`,
    top: `${state.y}%`,
    zIndex: 4 + Math.round(state.y / 6),
    '--face': state.face,
    '--robe-color': role.robe,
    '--trim-color': role.trim,
    '--body-scale': role.scale,
    '--step-speed': `${clamp(role.step / Math.max(walkActivity, 0.35), 0.48, 1.15)}s`,
    '--step-lift': `${2 + walkActivity * 2}px`,
    '--shadow-scale': 0.88 + walkActivity * 0.16
  }
}

const selectTask = (task) => {
  selectedTask.value = task
}

const selectAgent = (agent) => {
  selectedAgent.value = agent
  showToast(`已选中 ${portraitShortName(agent)} / ${agent.name || agent.personaName || agent.agentId}`)
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

const showToast = (message) => {
  toast.value = message
  setTimeout(() => {
    if (toast.value === message) toast.value = ''
  }, 2200)
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
        selectedTask.value = selectedTask.value || tasks.value[0] || null
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
            messages.value = (contentResult?.data || []).map((item, index) => ({
              localId: `${item.id || index}`,
              sender: item.messageType || item.senderType || 'SYSTEM',
              senderName: item.senderName,
              content: item.content || '',
              timestamp: item.createTime || Date.now()
            }))
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
      conversationId.value = data.conversationId
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

const runQuickAction = (action) => {
  draft.value = action.text
  sendHallMessage()
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
})

onUnmounted(() => {
  stopPhysics()
})
</script>

<style scoped>
.juyi-page {
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
.quick-bar,
.status-filter {
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
.panel-title button,
.panel-toolbar button,
.status-filter button,
.task-card button,
.hall-input button {
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

.table-core {
  position: absolute;
  z-index: 3;
  left: 50%;
  top: 55%;
  width: clamp(190px, 24vw, 320px);
  height: clamp(64px, 8vw, 102px);
  transform: translate(-50%, -50%);
  border: 10px solid #5e371f;
  border-radius: 50%;
  background: #c08a46;
  color: #3c2716;
  display: grid;
  place-items: center;
  font-weight: 700;
}

.table-core span {
  font-size: 0;
}

.table-core span::before {
  content: '议事圆桌';
  font-size: 16px;
}

.agent-token {
  position: absolute;
  z-index: 4;
  width: 66px;
  height: 96px;
  padding: 0;
  transform: translate(-50%, -50%);
  border: 0;
  border-radius: 0;
  background: transparent;
  color: #2f261c;
  box-shadow: none;
  will-change: left, top;
}

.agent-token.active {
  outline: 0;
}

.agent-token.active .agent-figure {
  filter: drop-shadow(0 0 10px rgba(244, 200, 76, 0.78));
}

.agent-shadow {
  position: absolute;
  left: 50%;
  bottom: 16px;
  width: calc(36px * var(--body-scale, 1) * 0.76);
  height: 10px;
  transform: translateX(-50%);
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.25);
  filter: blur(2px);
  animation: agentShadowPulse var(--step-speed, 0.72s) ease-in-out infinite;
}

.agent-figure {
  position: absolute;
  left: 50%;
  bottom: 21px;
  width: 58px;
  height: 88px;
  transform: translateX(-50%) scaleX(var(--face, 1)) scale(calc(var(--body-scale, 1) * 0.76));
  transform-origin: 50% 100%;
  animation: agentStepBob var(--step-speed, 0.72s) ease-in-out infinite;
}

.agent-head {
  position: absolute;
  left: 50%;
  top: 0;
  width: 42px;
  height: 42px;
  transform: translateX(-50%) scaleX(var(--face, 1));
  z-index: 3;
}

.agent-hat {
  position: absolute;
  left: 50%;
  top: -6px;
  z-index: 4;
  display: none;
  transform: translateX(-50%);
}

.agent-cape {
  position: absolute;
  left: 50%;
  top: 35px;
  z-index: 0;
  display: none;
  transform: translateX(-50%);
}

.agent-weapon,
.agent-accessory,
.agent-shoulder,
.agent-emblem {
  position: absolute;
  display: none;
}

.agent-weapon {
  z-index: 0;
}

.agent-accessory {
  z-index: 4;
}

.agent-shoulder {
  top: 36px;
  z-index: 3;
  width: 13px;
  height: 12px;
  border-radius: 50%;
  background: var(--trim-color);
  box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.18);
}

.agent-shoulder-left {
  left: 9px;
}

.agent-shoulder-right {
  right: 9px;
}

.agent-body {
  position: absolute;
  left: 50%;
  top: 34px;
  width: 36px;
  height: 44px;
  transform: translateX(-50%);
  border-radius: 16px 16px 10px 10px;
  background:
    linear-gradient(135deg, transparent 42%, rgba(255, 255, 255, 0.26) 43%, transparent 47%),
    linear-gradient(180deg, color-mix(in srgb, var(--robe-color) 78%, #ffffff), var(--robe-color));
  box-shadow:
    inset 0 0 0 2px rgba(255, 244, 212, 0.34),
    0 6px 10px rgba(0, 0, 0, 0.18);
  z-index: 2;
}

.agent-sash {
  position: absolute;
  left: 4px;
  right: 4px;
  top: 18px;
  height: 7px;
  border-radius: 8px;
  background: var(--trim-color);
  transform: rotate(-10deg);
}

.agent-emblem {
  left: 50%;
  top: 7px;
  width: 10px;
  height: 10px;
  transform: translateX(-50%);
  border-radius: 50%;
  background: rgba(255, 248, 220, 0.82);
  box-shadow: inset 0 0 0 2px var(--trim-color);
}

.agent-arm,
.agent-leg {
  position: absolute;
  display: block;
  background: color-mix(in srgb, var(--robe-color) 82%, #000000);
}

.agent-arm {
  top: 42px;
  width: 10px;
  height: 30px;
  border-radius: 8px;
  transform-origin: 50% 4px;
  z-index: 1;
}

.agent-arm-left {
  left: 8px;
  animation: agentArmLeft var(--step-speed, 0.72s) ease-in-out infinite;
}

.agent-arm-right {
  right: 8px;
  animation: agentArmRight var(--step-speed, 0.72s) ease-in-out infinite;
}

.agent-leg {
  top: 72px;
  width: 11px;
  height: 22px;
  border-radius: 8px 8px 6px 6px;
  transform-origin: 50% 2px;
  z-index: 1;
}

.agent-leg::after {
  content: '';
  position: absolute;
  left: -3px;
  bottom: -3px;
  width: 17px;
  height: 7px;
  border-radius: 50%;
  background: #251711;
}

.agent-leg-left {
  left: 19px;
  animation: agentLegLeft var(--step-speed, 0.72s) ease-in-out infinite;
}

.agent-leg-right {
  right: 19px;
  animation: agentLegRight var(--step-speed, 0.72s) ease-in-out infinite;
}

.role-songjiang .agent-hat {
  display: block;
  width: 40px;
  height: 13px;
  border-radius: 12px 12px 6px 6px;
  background: #1f1712;
  box-shadow: inset 0 4px 0 rgba(255, 244, 212, 0.18);
}

.role-songjiang .agent-hat::after {
  content: '';
  position: absolute;
  left: 50%;
  top: -7px;
  width: 12px;
  height: 12px;
  transform: translateX(-50%);
  border-radius: 50% 50% 3px 3px;
  background: #1f1712;
}

.role-songjiang .agent-cape {
  display: block;
  width: 46px;
  height: 50px;
  border-radius: 18px 18px 14px 14px;
  background: linear-gradient(180deg, rgba(122, 31, 27, 0.86), rgba(63, 24, 18, 0.64));
}

.role-songjiang .agent-emblem {
  display: block;
}

.role-wuyong .agent-accessory {
  display: block;
  right: -10px;
  top: 38px;
  width: 28px;
  height: 24px;
  transform: rotate(-22deg);
  border-radius: 100% 0 100% 0;
  background:
    repeating-linear-gradient(90deg, rgba(35, 72, 62, 0.34) 0 2px, transparent 2px 5px),
    linear-gradient(135deg, #fff8e8, #d7b875);
  box-shadow: inset -3px -3px 0 rgba(0, 0, 0, 0.08);
}

.role-wuyong .agent-body {
  width: 32px;
  border-radius: 20px 20px 12px 12px;
}

.role-linchong .agent-weapon {
  display: block;
  left: -2px;
  top: -10px;
  width: 5px;
  height: 106px;
  transform: rotate(13deg);
  border-radius: 5px;
  background: linear-gradient(180deg, #d9d0be 0 10px, #51341d 10px 100%);
  box-shadow: 7px 0 0 -3px rgba(0, 0, 0, 0.24);
}

.role-linchong .agent-weapon::before {
  content: '';
  position: absolute;
  left: -6px;
  top: -9px;
  width: 17px;
  height: 18px;
  clip-path: polygon(50% 0, 100% 68%, 58% 58%, 50% 100%, 42% 58%, 0 68%);
  background: #e8dfc8;
}

.role-linchong .agent-shoulder {
  display: block;
}

.role-luzhishen .agent-body {
  width: 42px;
  height: 46px;
  border-radius: 18px 18px 12px 12px;
}

.role-luzhishen .agent-weapon {
  display: block;
  right: -2px;
  top: 5px;
  width: 7px;
  height: 86px;
  transform: rotate(-10deg);
  border-radius: 6px;
  background: linear-gradient(180deg, #d9d0be, #6d3f1f 34%, #3a2418);
}

.role-luzhishen .agent-weapon::after {
  content: '';
  position: absolute;
  left: -6px;
  top: -8px;
  width: 19px;
  height: 19px;
  border-radius: 50%;
  border: 4px solid #d9d0be;
  border-bottom-color: transparent;
}

.role-yanqing .agent-cape {
  display: block;
  top: 38px;
  width: 38px;
  height: 38px;
  border-radius: 14px 14px 20px 20px;
  background: linear-gradient(180deg, rgba(92, 45, 99, 0.74), rgba(35, 72, 62, 0.58));
}

.role-yanqing .agent-body {
  width: 30px;
  height: 39px;
}

.role-yanqing .agent-leg {
  height: 25px;
}

.role-yanqing .agent-sash {
  transform: rotate(14deg);
}

.role-likui .agent-body {
  width: 41px;
  height: 45px;
  border-radius: 15px 15px 11px 11px;
}

.role-likui .agent-accessory,
.role-likui .agent-weapon {
  display: block;
  top: 38px;
  width: 20px;
  height: 26px;
}

.role-likui .agent-weapon {
  left: -8px;
  transform: rotate(-24deg);
}

.role-likui .agent-accessory {
  right: -8px;
  transform: rotate(24deg);
}

.role-likui .agent-weapon::before,
.role-likui .agent-accessory::before {
  content: '';
  position: absolute;
  left: 7px;
  top: 0;
  width: 5px;
  height: 26px;
  border-radius: 4px;
  background: #4a2716;
}

.role-likui .agent-weapon::after,
.role-likui .agent-accessory::after {
  content: '';
  position: absolute;
  left: 1px;
  top: -2px;
  width: 18px;
  height: 16px;
  clip-path: polygon(50% 0, 100% 28%, 82% 100%, 50% 78%, 18% 100%, 0 28%);
  background: #d9d0be;
}

.agent-name-tag,
.agent-status-badge {
  position: absolute;
  left: 50%;
  max-width: 76px;
  transform: translateX(-50%);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: 8px;
  box-shadow: 0 6px 12px rgba(0, 0, 0, 0.18);
}

.agent-name-tag {
  bottom: 0;
  padding: 2px 6px;
  background: rgba(255, 247, 224, 0.95);
  color: #2f261c;
  font-size: 11px;
  font-weight: 700;
}

.agent-status-badge {
  top: 6px;
  padding: 1px 5px;
  background: rgba(35, 24, 16, 0.78);
  color: #fff4d4;
  font-size: 10px;
}

.agent-avatar,
.mini-avatar,
.large-avatar {
  display: inline-grid;
  place-items: center;
  border-radius: 50%;
  background: #7c1f1b;
  color: #fff4d4;
  font-weight: 700;
}

.portrait-avatar {
  position: relative;
  overflow: hidden;
  background-repeat: no-repeat;
  background-color: #7c1f1b;
  box-shadow:
    inset 0 0 0 2px rgba(255, 244, 212, 0.72),
    inset 0 -4px 0 rgba(0, 0, 0, 0.14);
}

.portrait-avatar::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: radial-gradient(circle at 35% 23%, rgba(255, 255, 255, 0.22), transparent 34%);
  pointer-events: none;
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
  position: absolute;
  left: 50%;
  bottom: 18px;
  z-index: 5;
  width: min(720px, calc(100% - 160px));
  padding: 10px;
  transform: translateX(-50%);
  border: 1px solid rgba(255, 240, 202, 0.18);
  border-radius: 8px;
  background: rgba(35, 24, 16, 0.72);
  backdrop-filter: blur(8px);
}

.quick-action {
  flex: 1;
  min-width: 86px;
  gap: 6px;
  background: rgba(35, 72, 62, 0.92);
}

.selected-agent-card {
  position: absolute;
  left: 18px;
  bottom: 18px;
  z-index: 6;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: min(340px, calc(50% - 40px));
  padding: 10px 12px;
  border: 1px solid rgba(255, 240, 202, 0.2);
  border-radius: 8px;
  background: rgba(255, 250, 240, 0.92);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
  cursor: pointer;
}

.selected-agent-card strong,
.selected-agent-card small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.selected-agent-card small {
  color: #765f40;
}

.bottom-dock {
  position: absolute;
  right: 18px;
  bottom: 18px;
  z-index: 6;
  display: flex;
  gap: 8px;
  padding: 8px;
  border: 1px solid rgba(255, 240, 202, 0.2);
  border-radius: 8px;
  background: rgba(35, 24, 16, 0.76);
  backdrop-filter: blur(8px);
}

.bottom-dock button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 38px;
  padding: 0 12px;
  border-radius: 8px;
  background: rgba(255, 244, 212, 0.14);
  color: #fff4d4;
}

.bottom-dock button.active {
  background: #f4c84c;
  color: #3c2716;
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

.panel-title,
.panel-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
}

.panel-title {
  font-weight: 700;
}

.panel-title button,
.panel-toolbar button,
.status-filter button {
  padding: 0 12px;
  background: #efe0c6;
  color: #4a3423;
}

.panel-close {
  width: 36px;
  padding: 0;
}

.panel-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 0;
  color: #765f40;
  font-size: 13px;
}

.panel-toolbar .status-filter {
  padding: 0;
}

.status-filter {
  padding: 0 16px 12px;
}

.status-filter button.active {
  background: #23483e;
  color: #fff;
}

.task-search {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) minmax(118px, 150px);
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.task-search input,
.task-search select {
  min-width: 0;
  height: 36px;
  padding: 0 10px;
  border: 1px solid #d7c3a2;
  border-radius: 8px;
  background: #fffdf6;
  color: #3f2815;
  outline: none;
}

.task-status-tabs {
  display: flex;
  gap: 8px;
  padding: 0 12px 12px;
  overflow-x: auto;
}

.task-status-tabs button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 10px;
  border-radius: 8px;
  background: #efe0c6;
  color: #4a3423;
  white-space: nowrap;
}

.task-status-tabs button.active {
  background: #7c1f1b;
  color: #fff8e8;
}

.task-status-tabs small {
  min-width: 18px;
  padding: 1px 5px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.28);
  font-size: 11px;
}

.agent-list,
.task-list,
.hall-messages {
  overflow: auto;
  min-height: 0;
}

.agent-panel-body {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) minmax(240px, 320px);
  gap: 12px;
  flex: 1;
  min-height: 0;
  padding: 0 12px 12px;
  overflow: hidden;
}

.agent-list {
  flex: 1;
  padding: 0;
}

.agent-row {
  display: grid;
  grid-template-columns: 40px 1fr auto;
  gap: 10px;
  align-items: center;
  width: 100%;
  padding: 10px;
  margin-bottom: 8px;
  border-radius: 8px;
  background: #f7ecd7;
  color: inherit;
  text-align: left;
}

.agent-row.active,
.task-card.selected {
  background: #ead3a9;
}

.mini-avatar {
  width: 38px;
  height: 38px;
}

.large-avatar {
  width: 58px;
  height: 58px;
  font-size: 22px;
}

.agent-row strong,
.agent-row small,
.detail-head small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-row small,
.detail-head small,
.task-card p {
  color: #765f40;
  font-size: 12px;
}

.agent-row em {
  font-style: normal;
  font-size: 12px;
}

.detail-card {
  margin: 0;
  padding: 12px;
  border-radius: 8px;
  background: #f4e2c3;
}

.detail-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.ability-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.ability-tags span {
  padding: 3px 7px;
  border-radius: 8px;
  background: rgba(35, 72, 62, 0.12);
  color: #23483e;
  font-size: 12px;
}

.task-list {
  flex: 1;
  padding: 0 12px 12px;
}

.task-panel-body {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) minmax(280px, 360px);
  gap: 12px;
  flex: 1;
  min-height: 0;
  padding: 0 12px 12px;
  overflow: hidden;
}

.task-panel-body .task-list {
  padding: 0;
}

.task-card {
  padding: 12px;
  margin-bottom: 10px;
  border-radius: 8px;
  background: #f7ecd7;
}

.task-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.task-head span {
  font-size: 12px;
  white-space: nowrap;
}

.task-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 8px;
  color: #8b6b44;
  font-size: 12px;
}

.task-detail-card {
  min-height: 0;
  padding: 12px;
  overflow: auto;
  border-radius: 8px;
  background: #f4e2c3;
}

.task-detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.task-detail-head strong,
.task-detail-head small {
  display: block;
}

.task-detail-head small {
  margin-top: 3px;
  color: #765f40;
  font-size: 12px;
}

.task-operation-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin: 12px 0;
}

.task-operation-grid button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 38px;
  padding: 0 10px;
  border-radius: 8px;
  background: #7c1f1b;
  color: #fff8e8;
}

.task-operation-grid button + button {
  background: #23483e;
}

.recommended-agents {
  display: grid;
  gap: 8px;
}

.section-label {
  color: #765f40;
  font-size: 12px;
  font-weight: 700;
}

.recommended-agents button {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  width: 100%;
  padding: 8px;
  border-radius: 8px;
  background: #f7ecd7;
  color: #2f261c;
  text-align: left;
}

.recommended-agents button.active {
  outline: 2px solid #7c1f1b;
}

.recommended-agents strong,
.recommended-agents small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recommended-agents small,
.recommended-agents p {
  color: #765f40;
  font-size: 12px;
}

.recommended-agents em {
  font-style: normal;
  color: #23483e;
  font-weight: 700;
}

.task-state-open,
.task-state-assigned,
.task-state-running,
.task-state-done,
.task-state-failed {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 7px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.task-state-open {
  background: rgba(124, 31, 27, 0.12);
  color: #7c1f1b;
}

.task-state-assigned,
.task-state-running {
  background: rgba(154, 91, 0, 0.14);
  color: #875200;
}

.task-state-done {
  background: rgba(46, 125, 50, 0.14);
  color: #2e7d32;
}

.task-state-failed {
  background: rgba(179, 38, 30, 0.14);
  color: #b3261e;
}

.chat-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.hall-messages {
  flex: 1;
  min-height: 260px;
  padding: 0 14px;
}

.hall-message {
  max-width: 86%;
  margin: 0 0 10px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #f7ecd7;
}

.hall-message.USER {
  margin-left: auto;
  background: #dceadf;
}

.hall-message.SYSTEM {
  max-width: 100%;
  background: #eee5d7;
}

.hall-message p {
  margin: 4px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.hall-input {
  display: grid;
  grid-template-columns: 1fr 44px;
  gap: 8px;
  padding: 12px 14px 14px;
}

.hall-input input {
  min-width: 0;
  height: 42px;
  padding: 0 12px;
  border: 1px solid #d7c3a2;
  border-radius: 8px;
  background: #fffdf6;
  color: #2f261c;
  outline: none;
}

.hall-input button {
  width: 44px;
  min-height: 42px;
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

@keyframes agentStepBob {
  0%,
  100% {
    transform: translateX(-50%) translateY(0) scaleX(var(--face, 1)) scale(calc(var(--body-scale, 1) * 0.76));
  }
  50% {
    transform: translateX(-50%) translateY(calc(var(--step-lift, 3px) * -1)) scaleX(var(--face, 1)) scale(calc(var(--body-scale, 1) * 0.76));
  }
}

@keyframes agentShadowPulse {
  0%,
  100% {
    transform: translateX(-50%) scaleX(var(--shadow-scale, 1));
    opacity: 0.72;
  }
  50% {
    transform: translateX(-50%) scaleX(calc(var(--shadow-scale, 1) * 0.82));
    opacity: 0.5;
  }
}

@keyframes agentArmLeft {
  0%,
  100% {
    transform: rotate(24deg);
  }
  50% {
    transform: rotate(-26deg);
  }
}

@keyframes agentArmRight {
  0%,
  100% {
    transform: rotate(-26deg);
  }
  50% {
    transform: rotate(24deg);
  }
}

@keyframes agentLegLeft {
  0%,
  100% {
    transform: rotate(-18deg);
  }
  50% {
    transform: rotate(20deg);
  }
}

@keyframes agentLegRight {
  0%,
  100% {
    transform: rotate(20deg);
  }
  50% {
    transform: rotate(-18deg);
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
  .agent-token,
  .agent-figure,
  .agent-shadow,
  .agent-arm,
  .agent-leg,
  .task-sprite {
    animation: none;
  }
}

@media (max-width: 640px) {
  .juyi-page {
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

  .panel-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .task-search {
    grid-template-columns: 1fr;
  }

  .task-panel-body {
    grid-template-columns: 1fr;
    overflow: auto;
  }

  .task-panel-body .task-list,
  .task-detail-card {
    overflow: visible;
  }

  .task-operation-grid {
    grid-template-columns: 1fr;
  }

  .agent-token {
    width: 58px;
    height: 86px;
  }

  .agent-figure {
    width: 52px;
    height: 82px;
  }

  .agent-head {
    width: 38px;
    height: 38px;
  }

  .agent-body {
    top: 31px;
    width: 32px;
    height: 41px;
  }

  .agent-arm {
    top: 38px;
    height: 27px;
  }

  .agent-leg {
    top: 67px;
    height: 20px;
  }

  .agent-name-tag,
  .agent-status-badge {
    max-width: 66px;
    font-size: 10px;
  }

  .table-core {
    width: 170px;
    height: 58px;
    top: 56%;
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
    left: 8px;
    right: 8px;
    bottom: 76px;
    width: auto;
    transform: none;
    overflow-x: auto;
    flex-wrap: nowrap;
  }

  .quick-action {
    flex: 0 0 auto;
    min-width: 78px;
  }

  .selected-agent-card {
    left: 8px;
    right: 8px;
    bottom: 8px;
    max-width: none;
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

  .bottom-dock {
    right: 8px;
    bottom: 76px;
    display: none;
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

  .agent-panel-body {
    grid-template-columns: 1fr;
    overflow: auto;
  }

  .detail-card {
    order: -1;
  }

  .hall-messages {
    min-height: 320px;
  }
}
</style>
