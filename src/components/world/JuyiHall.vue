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
            <var-icon name="add" />
          </button>
        </div>
      </div>

      <div class="hall-board">
        <div class="beam beam-top"></div>
        <div class="banner">替天行道</div>
        <button
          v-for="task in visibleTaskSprites"
          :key="task.id"
          class="task-sprite"
          :class="taskSpriteClass(task)"
          :style="taskSpriteStyle(task)"
          @click="selectTaskFromStage(task)"
        >
          <span class="task-sprite-icon">
            <var-icon :name="taskSpriteIcon(task)" />
          </span>
          <span class="task-sprite-title">{{ task.title }}</span>
          <span class="task-sprite-status">{{ taskStatusText(task.status) }}</span>
        </button>
        <button
          v-for="agent in visibleAgents"
          :key="agent.agentId"
          class="agent-token"
          :class="[statusClass(agent.status), { active: selectedAgent?.agentId === agent.agentId }]"
          :style="agentStyle(agent)"
          @click="selectAgent(agent)"
        >
          <span class="agent-avatar">{{ avatarText(agent) }}</span>
          <span class="agent-name">{{ agent.name || agent.personaName || agent.agentId }}</span>
          <span class="agent-status">{{ statusText(agent.status) }}</span>
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
        <span class="large-avatar">{{ avatarText(selectedAgent) }}</span>
        <div>
          <strong>{{ selectedAgent.name || selectedAgent.personaName }}</strong>
          <small>{{ statusText(selectedAgent.status) }} / {{ selectedAgent.currentTaskTitle || abilityText(selectedAgent) }}</small>
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
                  <span class="mini-avatar">{{ avatarText(agent) }}</span>
                  <span>
                    <strong>{{ agent.name || agent.personaName || agent.agentId }}</strong>
                    <small>{{ agent.currentTaskTitle || abilityText(agent) }}</small>
                  </span>
                  <em :class="statusClass(agent.status)">{{ statusText(agent.status) }}</em>
                </button>
              </div>
              <div class="detail-card">
                <template v-if="selectedAgent">
                  <div class="detail-head">
                    <span class="large-avatar">{{ avatarText(selectedAgent) }}</span>
                    <div>
                      <strong>{{ selectedAgent.name || selectedAgent.personaName }}</strong>
                      <small>{{ selectedAgent.agentId }}</small>
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
              <span>选择任务后可直接指派给当前选中好汉。</span>
              <button @click="loadTasks">刷新</button>
            </div>
            <div class="task-list">
              <article
                v-for="task in tasks"
                :key="task.id"
                class="task-card"
                :class="{ selected: selectedTask?.id === task.id }"
                @click="selectedTask = task"
              >
                <div class="task-head">
                  <strong>{{ task.title }}</strong>
                  <span>{{ taskStatusText(task.status) }}</span>
                </div>
                <p>{{ task.description || '暂无任务描述' }}</p>
                <div class="ability-tags">
                  <span v-for="ability in task.requiredAbilities || []" :key="ability">{{ ability }}</span>
                </div>
                <button
                  :disabled="!canAssign(task)"
                  @click.stop="assignTask(task)"
                >
                  指派给{{ selectedAgent?.name || '好汉' }}
                </button>
              </article>
              <div v-if="!tasks.length" class="empty-list">暂无悬赏，刷新后再试</div>
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
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useGlobalStore } from '@/stores/global'
import { agentApi, chatApi } from '@/composables/useHttp'
import { log } from '@/utils/logger'

const globalStore = useGlobalStore()

const agents = ref([])
const tasks = ref([])
const messages = ref([])
const selectedAgent = ref(null)
const selectedTask = ref(null)
const agentFilter = ref('all')
const conversationId = ref('')
const draft = ref('')
const isStreaming = ref(false)
const toast = ref('')
const messageBoxRef = ref(null)
const activePanel = ref('')

const statusFilters = [
  { label: '全部', value: 'all' },
  { label: '空闲', value: 'idle' },
  { label: '忙碌', value: 'busy' },
  { label: '异常', value: 'error' }
]

const quickActions = [
  { key: 'summon', icon: 'bell-outline', label: '点将', text: '请各位好汉报上当前状态和可接任务。' },
  { key: 'bounty', icon: 'format-list-checkbox', label: '看榜', text: '请汇总当前悬赏榜中最适合优先处理的任务。' },
  { key: 'review', icon: 'check-circle-outline', label: '复盘', text: '请复盘最近一次任务协作，列出风险和下一步。' },
  { key: 'tea', icon: 'message-text-outline', label: '闲谈', text: '今日聚义厅中，哪位好汉有新的见闻？' }
]

const fallbackAgents = [
  { agentId: 'songjiang', name: '宋江', personaName: '及时雨', status: 'idle', abilities: ['orchestration', 'planning'], currentTaskTitle: '' },
  { agentId: 'wuyong', name: '吴用', personaName: '智多星', status: 'busy', abilities: ['analysis', 'code-review'], currentTaskTitle: '推演任务拆解' },
  { agentId: 'linchong', name: '林冲', personaName: '豹子头', status: 'idle', abilities: ['implementation', 'debug'], currentTaskTitle: '' },
  { agentId: 'luzhishen', name: '鲁智深', personaName: '花和尚', status: 'error', abilities: ['ops', 'incident'], errorMessage: '等待重新连线' }
]

const fallbackTasks = [
  { id: 'bounty-1', title: '巡检接口异常', description: '排查最近失败的 Agent API 调用并给出修复建议。', status: 'pending', requiredAbilities: ['debug', 'ops'] },
  { id: 'bounty-2', title: '优化会话记忆', description: '整理聚义厅聊天上下文，减少重复回复。', status: 'pending', requiredAbilities: ['analysis'] },
  { id: 'bounty-3', title: '悬赏榜体验验收', description: '从任务筛选、指派、反馈三个环节做一次交互验收。', status: 'running', requiredAbilities: ['code-review'], assignedAgentName: '吴用' }
]

const filteredAgents = computed(() => {
  if (agentFilter.value === 'all') return agents.value
  if (agentFilter.value === 'busy') {
    return agents.value.filter(agent => ['busy', 'running'].includes(normalizeStatus(agent.status)))
  }
  return agents.value.filter(agent => normalizeStatus(agent.status) === agentFilter.value)
})

const visibleAgents = computed(() => filteredAgents.value.slice(0, 12))
const visibleTaskSprites = computed(() => tasks.value.slice(0, 6))
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
  if (value === 'running') return '进行中'
  if (value === 'completed') return '已完成'
  if (value === 'failed') return '失败'
  return '待接取'
}

const taskSpriteClass = (task) => {
  const status = normalizeStatus(task.status)
  if (status === 'running') return 'is-running'
  if (status === 'completed') return 'is-completed'
  if (status === 'failed') return 'is-failed'
  return 'is-pending'
}

const taskSpriteIcon = (task) => {
  const status = normalizeStatus(task.status)
  if (status === 'running') return 'progress-clock'
  if (status === 'completed') return 'check-circle-outline'
  if (status === 'failed') return 'alert-circle-outline'
  return 'script-text-outline'
}

const avatarText = (agent) => (agent?.name || agent?.personaName || agent?.agentId || '?').slice(0, 1)

const abilityText = (agent) => {
  const abilities = agent.abilities || []
  return abilities.length ? abilities.slice(0, 3).join(' / ') : '未登记能力'
}

const agentStyle = (agent) => {
  const source = agent.agentId || agent.name || ''
  const seed = Array.from(source).reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return {
    left: `${14 + (seed * 17) % 68}%`,
    top: `${24 + (seed * 29) % 52}%`,
    '--move-x': `${((seed % 9) - 4) * 3}px`,
    '--move-y': `${-8 - (seed % 6) * 2}px`,
    '--move-x-back': `${((seed % 9) - 4) * -1.6}px`,
    '--move-y-back': `${3 + (seed % 6)}px`,
    '--tilt-a': `${-4 + (seed % 5)}deg`,
    '--tilt-b': `${4 + (seed % 4)}deg`,
    '--token-radius': `${42 + (seed % 16)}% ${54 + (seed % 10)}% ${44 + (seed % 14)}% ${52 + (seed % 12)}% / ${48 + (seed % 12)}% ${42 + (seed % 14)}% ${58 + (seed % 10)}% ${44 + (seed % 16)}%`,
    animationDelay: `${(seed % 7) * -0.37}s`,
    animationDuration: `${3.2 + (seed % 5) * 0.34}s`
  }
}

const taskSpriteStyle = (task) => {
  const source = `${task.id || ''}${task.title || ''}`
  const seed = Array.from(source).reduce((sum, char) => sum + char.charCodeAt(0), 0)
  const orbit = seed % 3
  const orbitX = 96 + (seed % 5) * 18
  const orbitY = 34 + (seed % 4) * 10
  return {
    '--orbit-x': `${orbitX}px`,
    '--orbit-y': `${orbitY}px`,
    '--orbit-x-left': `${orbitX * -0.65}px`,
    '--orbit-x-mid': `${orbitX * 0.42}px`,
    '--orbit-x-left-soft': `${orbitX * -0.48}px`,
    '--orbit-x-right-soft': `${orbitX * 0.35}px`,
    '--orbit-y-high': `${orbitY * -1.25}px`,
    '--orbit-y-up-soft': `${orbitY * -0.8}px`,
    '--orbit-y-down-soft': `${orbitY * 0.7}px`,
    '--wander-x': `${((seed % 11) - 5) * 5}px`,
    '--wander-y': `${((seed % 7) - 3) * 4}px`,
    '--sprite-tilt': `${-10 + (seed % 21)}deg`,
    left: `${28 + (seed * 13) % 44}%`,
    top: `${38 + (seed * 19) % 24}%`,
    animationName: orbit === 0 ? 'taskOrbitA' : orbit === 1 ? 'taskOrbitB' : 'taskOrbitC',
    animationDelay: `${(seed % 9) * -0.46}s`,
    animationDuration: `${7.4 + (seed % 6) * 0.65}s`
  }
}

const selectTaskFromStage = (task) => {
  selectedTask.value = task
  openPanel('tasks')
}

const selectAgent = (agent) => {
  selectedAgent.value = agent
  showToast(`已选中 ${agent.name || agent.agentId}`)
}

const openPanel = (panel) => {
  activePanel.value = panel
}

const closePanel = () => {
  activePanel.value = ''
}

const canAssign = (task) => {
  if (!selectedAgent.value) return false
  if (normalizeStatus(task.status) !== 'pending') return false
  return ['idle', 'online', ''].includes(normalizeStatus(selectedAgent.value.status || 'idle'))
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
    await agentApi.get('/list', { pageNum: 1, pageSize: 50 }, {
      autoLoading: false,
      onSuccess: (result) => {
        const list = result?.data || []
        agents.value = list.length ? list : fallbackAgents
        if (!selectedAgent.value && agents.value.length) {
          selectedAgent.value = agents.value[0]
        }
      }
    })
  } catch (error) {
    log.warn('加载 Agent 列表失败:', error)
    agents.value = fallbackAgents
    selectedAgent.value = selectedAgent.value || agents.value[0]
  }
}

const loadTasks = async () => {
  try {
    await agentApi.search('/tasks/search', { pageNum: 1, pageSize: 20 }, {
      autoLoading: false,
      onSuccess: (result) => {
        const list = result?.data || []
        tasks.value = list.length ? list : fallbackTasks
        selectedTask.value = selectedTask.value || tasks.value[0] || null
      }
    })
  } catch (error) {
    log.warn('加载悬赏榜失败:', error)
    tasks.value = fallbackTasks
    selectedTask.value = selectedTask.value || tasks.value[0]
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
        task.status = 'running'
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
    linear-gradient(90deg, rgba(255, 255, 255, 0.1) 1px, transparent 1px) 0 0 / 52px 52px,
    linear-gradient(0deg, rgba(255, 255, 255, 0.1) 1px, transparent 1px) 0 0 / 52px 52px,
    radial-gradient(circle at 50% 44%, rgba(240, 184, 74, 0.48), transparent 24%),
    radial-gradient(circle at 15% 24%, rgba(142, 40, 28, 0.46), transparent 22%),
    radial-gradient(circle at 85% 30%, rgba(37, 89, 73, 0.42), transparent 20%),
    linear-gradient(135deg, #7b5530, #2f241b 58%, #17100d);
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
  z-index: 1;
  left: 50%;
  bottom: 12%;
  width: clamp(190px, 24vw, 320px);
  height: clamp(64px, 8vw, 102px);
  transform: translateX(-50%);
  border: 10px solid #5e371f;
  border-radius: 50%;
  background: #c08a46;
  color: #3c2716;
  display: grid;
  place-items: center;
  font-weight: 700;
}

.agent-token {
  position: absolute;
  z-index: 4;
  width: clamp(82px, 8vw, 112px);
  min-height: clamp(78px, 7.8vw, 104px);
  padding: 9px 8px 8px;
  transform: translate(-50%, -50%) rotate(var(--tilt-a, -2deg));
  border: 1px solid rgba(96, 47, 24, 0.35);
  border-radius: var(--token-radius, 46% 54% 48% 52% / 52% 44% 56% 48%);
  background:
    radial-gradient(circle at 28% 22%, rgba(255, 255, 255, 0.7), transparent 22%),
    linear-gradient(145deg, rgba(255, 250, 235, 0.98), rgba(226, 188, 123, 0.96));
  color: #2f261c;
  box-shadow:
    inset 0 -8px 18px rgba(109, 63, 31, 0.14),
    0 10px 20px rgba(0, 0, 0, 0.24);
  animation: agentWander 3.6s ease-in-out infinite;
}

.agent-token.active {
  outline: 3px solid #f4c84c;
  box-shadow:
    inset 0 -8px 18px rgba(109, 63, 31, 0.14),
    0 0 0 6px rgba(244, 200, 76, 0.18),
    0 14px 26px rgba(0, 0, 0, 0.28);
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

.agent-avatar {
  width: 34px;
  height: 34px;
  margin-bottom: 4px;
  box-shadow: inset 0 -3px 0 rgba(0, 0, 0, 0.14);
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
  display: inline-flex;
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
  width: 34px;
  height: 34px;
}

.large-avatar {
  width: 52px;
  height: 52px;
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
  color: #8b4d25;
  font-size: 12px;
  white-space: nowrap;
}

.task-card button {
  width: 100%;
  margin-top: 10px;
  background: #7c1f1b;
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

@keyframes agentWander {
  0% {
    transform: translate(-50%, -50%) rotate(var(--tilt-a, -2deg));
  }
  28% {
    transform: translate(calc(-50% + var(--move-x, 8px)), calc(-50% + var(--move-y, -12px))) rotate(var(--tilt-b, 5deg));
  }
  63% {
    transform: translate(calc(-50% + var(--move-x-back, -4px)), calc(-50% + var(--move-y-back, 5px))) rotate(calc(var(--tilt-a, -2deg) - 3deg));
  }
  100% {
    transform: translate(-50%, -50%) rotate(var(--tilt-a, -2deg));
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
    max-width: 176px;
  }

  .agent-token {
    width: 82px;
    min-height: 78px;
  }

  .table-core {
    width: 170px;
    height: 58px;
    bottom: 22%;
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
