<template>
  <main class="hall-portrait-home" aria-label="聚义厅掌上首页">
    <header class="portrait-header">
      <div>
        <p class="portrait-eyebrow">聚义厅 · 掌上调度</p>
        <h1>厅中动静</h1>
      </div>
      <button
        class="portrait-refresh"
        type="button"
        :disabled="refreshing"
        aria-label="点验刷新"
        @click="emit('refresh-hall')"
      >
        {{ refreshing ? '点验中…' : '点验刷新' }}
      </button>
    </header>

    <section class="portrait-overview" aria-label="状态概览">
      <div><strong>{{ idleCount }}</strong><span>候命</span></div>
      <div><strong>{{ busyCount }}</strong><span>办事</span></div>
      <div><strong>{{ issueCount }}</strong><span>异常</span></div>
      <div><strong>{{ openTaskCount }}</strong><span>待办</span></div>
    </section>

    <section class="portrait-scene" aria-label="聚义厅轻量实景窗口">
      <div class="scene-sky" aria-hidden="true"></div>
      <div class="scene-hall" aria-hidden="true"><span>聚义</span></div>
      <div class="scene-courtyard" aria-hidden="true"></div>
      <ul v-if="sceneAgents.length" class="scene-agent-list" aria-label="厅中好汉">
        <li v-for="agent in sceneAgents" :key="agentKey(agent)">
          <button type="button" @click="emit('select-agent', agent)">
            <span class="agent-dot" :class="statusClass(agent.status)"></span>
            <span>{{ agentName(agent) }}</span>
          </button>
        </li>
      </ul>
      <p v-else class="scene-empty">厅前静候点将</p>
      <button
        class="landscape-entry"
        type="button"
        :disabled="orientationRequestPending"
        @click="emit('request-landscape')"
      >
        {{ orientationRequestPending ? '正在请求横屏…' : '横屏看全景' }}
      </button>
      <p v-if="orientationHint" class="orientation-hint" role="status">{{ orientationHint }}</p>
    </section>

    <section class="portrait-section" aria-labelledby="portrait-shortcuts-title">
      <div class="section-heading">
        <h2 id="portrait-shortcuts-title">常用入口</h2>
        <span>单手直达</span>
      </div>
      <div class="portrait-shortcuts">
        <button
          v-for="action in quickActions"
          :key="action.key"
          class="portrait-shortcut"
          type="button"
          :data-portrait-action="action.key"
          @click="emit('quick-action', action.key)"
        >
          <span aria-hidden="true">{{ action.icon }}</span>
          <span>{{ action.label }}</span>
        </button>
      </div>
    </section>

    <section class="portrait-section portrait-todos" aria-labelledby="portrait-todos-title">
      <div class="section-heading">
        <h2 id="portrait-todos-title">待办榜文</h2>
        <button type="button" @click="emit('quick-action', 'tasks')">查看悬赏榜</button>
      </div>
      <button
        v-for="task in todoTasks"
        :key="task.id"
        class="portrait-todo"
        type="button"
        @click="openTask(task)"
      >
        <span :class="taskStateClass(task.status)">{{ taskStatusText(task.status) }}</span>
        <strong>{{ task.title || '未命名榜文' }}</strong>
        <small>{{ task.requiredAbilities?.length ? task.requiredAbilities.join(' / ') : '待议定人手' }}</small>
      </button>
      <p v-if="!todoTasks.length" class="portrait-empty">眼下无待办榜文，可先点验厅中人手。</p>
    </section>

    <section class="portrait-context" aria-label="当前上下文">
      <div>
        <span>当前好汉</span>
        <strong>{{ selectedAgent ? agentName(selectedAgent) : '尚未点将' }}</strong>
      </div>
      <div>
        <span>当前榜文</span>
        <strong>{{ selectedTask?.title || '尚未选定' }}</strong>
      </div>
      <button type="button" @click="emit('quick-action', 'discussion')">厅前议事</button>
    </section>

    <section
      v-if="taskDetailOpen && selectedTask"
      class="portrait-task-detail"
      role="dialog"
      aria-modal="true"
      aria-label="榜文详情"
    >
      <div class="task-detail-heading">
        <span :class="taskStateClass(selectedTask.status)">{{ taskStatusText(selectedTask.status) }}</span>
        <button type="button" aria-label="关闭榜文详情" @click="emit('close-task-detail')">关闭</button>
      </div>
      <p class="task-detail-id">榜号 {{ selectedTask.id }}</p>
      <h2>{{ selectedTask.title || '未命名榜文' }}</h2>
      <p class="task-detail-description">{{ selectedTask.description || selectedTask.content || '暂无详情，待厅中议定。' }}</p>
      <p class="task-detail-abilities">所需本领：{{ selectedTask.requiredAbilities?.length ? selectedTask.requiredAbilities.join(' / ') : '不拘本领' }}</p>
      <div class="task-detail-actions">
        <button type="button" @click="emit('open-task-board')">进入悬赏榜</button>
        <button type="button" @click="emit('discuss-task', selectedTask)">就此议事</button>
      </div>
    </section>
  </main>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  agents: { type: Array, default: () => [] },
  mapAgents: { type: Array, default: () => [] },
  orientationHint: { type: String, default: '' },
  orientationRequestPending: Boolean,
  refreshing: Boolean,
  selectedAgent: { type: Object, default: null },
  selectedTask: { type: Object, default: null },
  taskDetailOpen: Boolean,
  statusClass: { type: Function, required: true },
  taskStateClass: { type: Function, required: true },
  taskStatusText: { type: Function, required: true },
  tasks: { type: Array, default: () => [] }
})

const emit = defineEmits(['close-task-detail', 'discuss-task', 'open-task', 'open-task-board', 'quick-action', 'refresh-hall', 'request-landscape', 'select-agent'])

const quickActions = Object.freeze([
  { key: 'agents', label: '点将册', icon: '将' },
  { key: 'tasks', label: '悬赏榜', icon: '榜' },
  { key: 'discussion', label: '厅前议事', icon: '议' },
  { key: 'catalog', label: '招贤令', icon: '贤' },
  { key: 'library', label: '案卷阁', icon: '卷' },
  { key: 'refresh', label: '点验刷新', icon: '验' }
])

const normalizedStatus = status => String(status || '').toLowerCase()
const idleCount = computed(() => props.agents.filter(agent => normalizedStatus(agent.status) === 'online').length)
const busyCount = computed(() => props.agents.filter(agent => ['busy', 'running'].includes(normalizedStatus(agent.status))).length)
const issueCount = computed(() => props.agents.filter(agent => ['error', 'offline'].includes(normalizedStatus(agent.status))).length)
const openTaskCount = computed(() => props.tasks.filter(task => normalizedStatus(task.status) === 'open').length)
const sceneAgents = computed(() => props.mapAgents.slice(0, 4))
const todoTasks = computed(() => props.tasks.filter(task => ['open', 'assigned', 'running'].includes(normalizedStatus(task.status))).slice(0, 3))
const agentKey = agent => agent?.agentId || agent?.name || agent?.personaName || ''
const agentName = agent => agent?.name || agent?.personaName || agent?.agentId || '未署名好汉'

const openTask = task => emit('open-task', task)
</script>

<style scoped>
.hall-portrait-home {
  display: grid;
  align-content: start;
  gap: 14px;
  width: 100%;
  min-height: 100%;
  padding: max(16px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom));
  overflow-y: auto;
  background:
    radial-gradient(circle at 80% 0%, rgba(234, 180, 84, 0.18), transparent 34%),
    linear-gradient(160deg, #211812 0%, #382418 45%, #171a18 100%);
  color: #fff5df;
}

.portrait-task-detail {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid rgba(247, 204, 112, 0.5);
  border-radius: 14px;
  background: #382418;
  box-shadow: 0 14px 30px rgba(0, 0, 0, 0.32);
}

.task-detail-heading,
.task-detail-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.task-detail-heading > span,
.task-detail-id,
.task-detail-abilities {
  color: #f2ca79;
  font-size: 12px;
}

.task-detail-heading button,
.task-detail-actions button {
  min-height: 38px;
  padding: 0 12px;
  border-radius: 9px;
  background: rgba(255, 239, 200, 0.13);
  color: #fff4dc;
  font-weight: 700;
}

.task-detail-actions button:last-child {
  background: #a84928;
}

.task-detail-id,
.task-detail-description,
.task-detail-abilities { margin: 0; }
.task-detail-description { color: rgba(255, 237, 199, 0.84); line-height: 1.55; }

.portrait-header,
.section-heading,
.portrait-context,
.portrait-overview,
.portrait-shortcuts {
  display: flex;
  align-items: center;
}

.portrait-header,
.section-heading,
.portrait-context {
  justify-content: space-between;
  gap: 12px;
}

.portrait-eyebrow,
.section-heading span,
.portrait-context span,
.portrait-todo small,
.orientation-hint,
.scene-empty {
  color: rgba(255, 237, 199, 0.7);
  font-size: 12px;
}

.portrait-eyebrow {
  margin: 0 0 4px;
}

h1,
h2,
p {
  margin: 0;
}

h1 {
  font-size: 26px;
  line-height: 1.05;
}

h2 {
  font-size: 16px;
}

button {
  border: 0;
  font: inherit;
}

button:disabled {
  opacity: 0.62;
}

.portrait-refresh,
.landscape-entry,
.section-heading button,
.portrait-context > button {
  min-height: 40px;
  padding: 0 13px;
  border-radius: 10px;
  background: #a84928;
  color: #fff8e9;
  font-weight: 700;
}

.portrait-overview {
  justify-content: space-between;
  gap: 8px;
  padding: 12px;
  border: 1px solid rgba(255, 227, 170, 0.2);
  border-radius: 14px;
  background: rgba(65, 42, 25, 0.68);
}

.portrait-overview div {
  display: grid;
  gap: 3px;
  min-width: 0;
  text-align: center;
}

.portrait-overview strong {
  color: #f5ca72;
  font-size: 21px;
}

.portrait-overview span {
  color: rgba(255, 241, 211, 0.76);
  font-size: 12px;
}

.portrait-scene {
  position: relative;
  min-height: 214px;
  overflow: hidden;
  border: 1px solid rgba(255, 222, 159, 0.3);
  border-radius: 16px;
  background: linear-gradient(180deg, #26372e 0%, #5a4027 58%, #2e2118 100%);
  box-shadow: inset 0 -46px 54px rgba(0, 0, 0, 0.25);
}

.scene-sky {
  position: absolute;
  inset: 0 0 44% 0;
  background: radial-gradient(circle at 78% 25%, rgba(255, 228, 139, 0.84) 0 9px, transparent 10px), linear-gradient(135deg, #36504b, #19312c);
}

.scene-hall {
  position: absolute;
  left: 50%;
  bottom: 39px;
  display: grid;
  place-items: center;
  width: 172px;
  height: 98px;
  border: 8px solid #4d2b1a;
  border-bottom-width: 22px;
  border-radius: 8px 8px 2px 2px;
  background: linear-gradient(90deg, rgba(255, 219, 129, 0.3) 1px, transparent 1px) 0 0 / 28px 100%, #aa7140;
  box-shadow: 0 -14px 0 #351e15, 0 -25px 0 #c69a58;
  color: #fff0bd;
  font-size: 26px;
  font-weight: 800;
  letter-spacing: 8px;
  text-indent: 8px;
  transform: translateX(-50%);
}

.scene-courtyard {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 58px;
  background: repeating-linear-gradient(90deg, rgba(255, 239, 197, 0.08) 0 18px, transparent 18px 36px), #302419;
}

.scene-agent-list {
  position: absolute;
  z-index: 1;
  bottom: 11px;
  left: 12px;
  display: flex;
  gap: 6px;
  max-width: calc(100% - 24px);
  margin: 0;
  padding: 0;
  overflow-x: auto;
  list-style: none;
}

.scene-agent-list button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 32px;
  padding: 0 9px;
  border: 1px solid rgba(255, 238, 202, 0.3);
  border-radius: 999px;
  background: rgba(29, 23, 17, 0.82);
  color: #fff7e2;
  font-size: 12px;
  white-space: nowrap;
}

.agent-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #8fbe82;
}

.agent-dot.is-busy { background: #e7b04d; }
.agent-dot.is-error,
.agent-dot.is-offline { background: #c86c58; }

.scene-empty {
  position: absolute;
  z-index: 1;
  bottom: 18px;
  left: 16px;
}

.landscape-entry {
  position: absolute;
  z-index: 2;
  top: 12px;
  right: 12px;
  background: rgba(45, 31, 20, 0.82);
}

.orientation-hint {
  position: absolute;
  z-index: 2;
  top: 57px;
  right: 12px;
  max-width: 176px;
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(27, 20, 15, 0.78);
  text-align: right;
}

.portrait-section {
  display: grid;
  gap: 9px;
}

.section-heading button {
  min-height: 30px;
  padding: 0;
  background: transparent;
  color: #f1c66f;
  font-size: 12px;
}

.portrait-shortcuts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.portrait-shortcut {
  display: grid;
  place-items: center;
  gap: 5px;
  min-height: 74px;
  padding: 8px 4px;
  border: 1px solid rgba(255, 228, 172, 0.18);
  border-radius: 12px;
  background: rgba(87, 55, 30, 0.7);
  color: #fff4da;
  font-size: 13px;
}

.portrait-shortcut > span:first-child {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: rgba(216, 155, 63, 0.28);
  color: #f7d488;
  font-size: 13px;
  font-weight: 800;
}

.portrait-todos {
  padding: 12px;
  border: 1px solid rgba(255, 227, 170, 0.16);
  border-radius: 14px;
  background: rgba(28, 26, 21, 0.72);
}

.portrait-todo {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 4px 8px;
  width: 100%;
  padding: 10px 0;
  border-top: 1px solid rgba(255, 231, 183, 0.1);
  background: transparent;
  color: #fff4dc;
  text-align: left;
}

.portrait-todo:first-of-type { border-top: 0; }

.portrait-todo > span {
  align-self: start;
  padding: 3px 6px;
  border-radius: 999px;
  background: rgba(243, 191, 83, 0.18);
  color: #f6cf7d;
  font-size: 11px;
}

.portrait-todo strong,
.portrait-todo small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.portrait-todo small { grid-column: 2; }
.portrait-empty { padding: 8px 0 0; color: rgba(255, 237, 199, 0.72); font-size: 13px; }

.portrait-context {
  align-items: stretch;
  padding: 12px;
  border-radius: 14px;
  background: #542d1d;
}

.portrait-context > div { display: grid; gap: 4px; min-width: 0; }
.portrait-context strong { overflow: hidden; max-width: 108px; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.portrait-context > button { align-self: center; min-height: 34px; padding: 0 9px; background: rgba(255, 241, 207, 0.16); font-size: 12px; }

@media (max-width: 360px) {
  .hall-portrait-home { padding-right: 12px; padding-left: 12px; }
  .portrait-context { gap: 8px; }
  .portrait-context strong { max-width: 82px; }
}
</style>
