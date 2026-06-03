<template>
  <div class="juyi-hall">
    <header class="hall-header">
      <div>
        <h1>{{ $t('juyiting.title') }}</h1>
        <p>{{ $t('juyiting.subtitle') }}</p>
      </div>
      <var-button type="primary" size="small" @click="refreshAll">
        {{ $t('app.refresh') }}
      </var-button>
    </header>

    <div class="hall-stats">
      <div>
        <span>{{ $t('juyiting.total_agents') }}</span>
        <strong>{{ agentStore.total }}</strong>
      </div>
      <div>
        <span>{{ $t('juyiting.online_agents') }}</span>
        <strong>{{ agentStore.onlineTotal }}</strong>
      </div>
      <div>
        <span>{{ $t('juyiting.busy_agents') }}</span>
        <strong>{{ agentStore.busyTotal }}</strong>
      </div>
      <div>
        <span>{{ $t('juyiting.reward_tasks') }}</span>
        <strong>{{ agentStore.taskTotal }}</strong>
      </div>
    </div>

    <section class="game-stage">
      <div class="stage-topbar">
        <div>
          <h2>忠义堂沙盘</h2>
          <p>{{ sceneSubtitle }}</p>
        </div>
        <div class="stage-actions">
          <var-button
            text
            type="primary"
            size="small"
            @click="patrolEnabled = !patrolEnabled"
          >
            {{ patrolEnabled ? '暂停巡厅' : '开始巡厅' }}
          </var-button>
          <var-button
            text
            type="primary"
            size="small"
            @click="openChat"
          >
            {{ $t('juyiting.open_chat') }}
          </var-button>
        </div>
      </div>

      <div class="game-board">
        <div class="hall-scene" :class="{ patrolling: patrolEnabled }">
          <div class="scene-backdrop">
            <div class="lantern lantern-left"></div>
            <div class="lantern lantern-right"></div>
            <div class="hall-plaque">聚义厅</div>
            <div class="banner banner-left">议事</div>
            <div class="banner banner-right">悬赏</div>
          </div>

          <div class="dais">
            <span>主座</span>
          </div>
          <button
            class="reward-board-prop"
            type="button"
            @click="activeTab = 0"
          >
            <var-icon name="clipboard-text-outline" />
            <span>{{ $t('juyiting.reward_board') }}</span>
          </button>
          <div class="floor-grid"></div>

          <button
            v-for="agent in positionedAgents"
            :key="agent.agentId"
            class="agent-token"
            :class="[agent.status, { active: agentStore.selectedAgentId === agent.agentId }]"
            :style="agent.sceneStyle"
            type="button"
            @click="selectSceneAgent(agent.agentId)"
            @dblclick="openAgentDetail(agent.agentId)"
          >
            <span class="token-shadow"></span>
            <span class="token-body">
              <img v-if="agent.avatar" :src="agent.avatar" :alt="agent.name" />
              <span v-else>{{ agentInitial(agent) }}</span>
            </span>
            <span class="token-name">{{ agent.name }}</span>
            <span class="token-bubble">{{ activityLine(agent) }}</span>
          </button>
        </div>

        <aside class="scene-panel">
          <div v-if="agentStore.selectedAgent" class="selected-agent">
            <div class="selected-head">
              <div class="selected-avatar">
                <img
                  v-if="agentStore.selectedAgent.avatar"
                  :src="agentStore.selectedAgent.avatar"
                  :alt="agentStore.selectedAgent.name"
                />
                <span v-else>{{ agentInitial(agentStore.selectedAgent) }}</span>
              </div>
              <div>
                <h3>{{ agentStore.selectedAgent.name }}</h3>
                <p>{{ agentStore.selectedAgent.title || agentStore.selectedAgent.personaName || $t('juyiting.agent') }}</p>
              </div>
            </div>

            <div class="selected-status">
              <span>{{ $t('juyiting.status') }}</span>
              <strong>{{ statusLabel(agentStore.selectedAgent.status) }}</strong>
            </div>

            <p class="selected-task">
              {{ agentStore.selectedAgent.currentTask?.title || $t('juyiting.no_current_task') }}
            </p>

            <div class="selected-abilities">
              <var-chip
                v-for="ability in agentStore.selectedAgent.abilities"
                :key="ability"
                size="mini"
              >
                {{ ability }}
              </var-chip>
            </div>

            <div class="selected-actions">
              <var-button
                type="primary"
                size="small"
                @click="openAgentDetail(agentStore.selectedAgent.agentId)"
              >
                {{ $t('juyiting.detail') }}
              </var-button>
              <var-button
                text
                type="primary"
                size="small"
                @click="activeTab = 1"
              >
                看厅内动静
              </var-button>
            </div>
          </div>

          <var-empty v-else description="厅内暂无点将" />
        </aside>
      </div>
    </section>

    <main class="hall-layout">
      <AgentList
        class="agent-column"
        @select="loadAgentDetail"
        @detail="openAgentDetail"
      />

      <section class="hall-workspace">
        <var-tabs v-model:active="activeTab">
          <var-tab>{{ $t('juyiting.reward_board') }}</var-tab>
          <var-tab>厅内动静</var-tab>
        </var-tabs>

        <var-tabs-items v-model:active="activeTab" class="workspace-tabs">
          <var-tab-item>
            <RewardBoard />
          </var-tab-item>
          <var-tab-item>
            <section class="chat-panel">
              <header class="panel-header">
                <div>
                  <h2>厅内动静</h2>
                  <p>灯火未歇，厅内回报会在这里滚动。</p>
                </div>
                <var-button
                  text
                  type="primary"
                  size="small"
                  @click="openChat"
                >
                  {{ $t('juyiting.open_chat') }}
                </var-button>
              </header>

              <div class="event-list">
                <article
                  v-for="event in hallEvents"
                  :key="event.id"
                  class="event-item"
                >
                  <div class="event-icon">
                    <var-icon :name="event.icon" />
                  </div>
                  <div>
                    <h3>{{ event.title }}</h3>
                    <p>{{ event.content }}</p>
                  </div>
                </article>
              </div>
            </section>
          </var-tab-item>
        </var-tabs-items>
      </section>
    </main>

    <AgentDetail v-model:show="detailVisible" :agent="agentStore.selectedAgent" />
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AgentDetail from '@/components/agent/AgentDetail.vue'
import AgentList from '@/components/agent/AgentList.vue'
import RewardBoard from '@/components/juyiting/RewardBoard.vue'
import { useAgentStore, AGENT_STATUS } from '@/stores/agent'
import { useGlobalStore } from '@/stores/global'

const router = useRouter()
const { t } = useI18n()
const globalStore = useGlobalStore()
const agentStore = useAgentStore()
const activeTab = ref(0)
const detailVisible = ref(false)
const patrolEnabled = ref(true)

const sceneSlots = [
  { left: 18, top: 58, walkX: 14, walkY: -8 },
  { left: 42, top: 47, walkX: -10, walkY: 10 },
  { left: 66, top: 58, walkX: -14, walkY: -7 },
  { left: 28, top: 72, walkX: 10, walkY: -12 },
  { left: 55, top: 73, walkX: -12, walkY: -11 },
  { left: 74, top: 43, walkX: -16, walkY: 8 },
  { left: 14, top: 39, walkX: 14, walkY: 8 },
  { left: 47, top: 30, walkX: 8, walkY: 18 }
]

const sceneSubtitle = computed(() => {
  if (!agentStore.agents.length) return '厅内暂时无人，等待 Agent 上线。'
  if (agentStore.busyTotal) return `${agentStore.busyTotal} 位 Agent 正在办事，悬赏榜等候回报。`
  return `${agentStore.onlineTotal} 位 Agent 已在厅中待命。`
})

const positionedAgents = computed(() => {
  return agentStore.agents.slice(0, 8).map((agent, index) => {
    const slot = sceneSlots[index % sceneSlots.length]
    return {
      ...agent,
      sceneStyle: {
        left: `${slot.left}%`,
        top: `${slot.top}%`,
        '--walk-x': `${slot.walkX}px`,
        '--walk-y': `${slot.walkY}px`,
        '--walk-delay': `${index * -0.7}s`
      }
    }
  })
})

const hallEvents = computed(() => {
  const events = []

  agentStore.agents.slice(0, 4).forEach(agent => {
    events.push({
      id: `agent-${agent.agentId}`,
      icon: agent.status === AGENT_STATUS.ERROR ? 'alert-circle-outline' : 'account-circle-outline',
      title: `${agent.name} - ${statusLabel(agent.status)}`,
      content: agent.currentTask?.title || agent.slogan || t('juyiting.no_current_task')
    })
  })

  agentStore.tasks.slice(0, 3).forEach(task => {
    events.push({
      id: `task-${task.id}`,
      icon: 'clipboard-text-outline',
      title: task.title,
      content: task.assignedAgentName
        ? t('juyiting.task_assigned_to', { agent: task.assignedAgentName })
        : t('juyiting.task_waiting')
    })
  })

  return events
})

const statusLabel = (status) => {
  const map = {
    [AGENT_STATUS.ONLINE]: t('juyiting.status_online'),
    [AGENT_STATUS.BUSY]: t('juyiting.status_busy'),
    [AGENT_STATUS.OFFLINE]: t('juyiting.status_offline'),
    [AGENT_STATUS.ERROR]: t('juyiting.status_error')
  }
  return map[status] || status || t('juyiting.status_unknown')
}

const agentInitial = (agent) => {
  return (agent?.name || agent?.agentId || 'A').slice(0, 1).toUpperCase()
}

const activityLine = (agent) => {
  if (agent.status === AGENT_STATUS.ERROR) return agent.errorMessage || '需要处理'
  if (agent.status === AGENT_STATUS.OFFLINE) return '暂离厅外'
  if (agent.currentTask?.title) return agent.currentTask.title
  if (agent.status === AGENT_STATUS.BUSY) return '正在办事'
  return agent.slogan || '待命'
}

const refreshAll = async () => {
  await Promise.all([
    agentStore.fetchAgents(),
    agentStore.fetchRewardTasks()
  ])
}

const loadAgentDetail = (agentId) => {
  agentStore.fetchAgentDetail(agentId)
}

const selectSceneAgent = (agentId) => {
  agentStore.selectAgent(agentId)
  agentStore.fetchAgentDetail(agentId)
}

const openAgentDetail = async (agentId) => {
  await agentStore.fetchAgentDetail(agentId)
  detailVisible.value = true
}

const openChat = () => {
  router.push({
    name: 'Chat',
    query: {
      conversationType: 'juyiting'
    }
  })
}

onMounted(async () => {
  globalStore.setTitle(t('juyiting.title'))
  globalStore.setShowBack(false)
  globalStore.setShowMore(false)
  await refreshAll()
})
</script>

<style scoped>
.juyi-hall {
  flex: 1;
  overflow: auto;
  padding: 16px;
  background:
    linear-gradient(180deg, rgba(255, 246, 231, 0.9), rgba(244, 247, 250, 0.96)),
    var(--color-body);
}

.hall-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.hall-header h1 {
  margin: 0 0 4px;
  font-size: 24px;
  font-weight: 700;
}

.hall-header p {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.hall-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 16px;
}

.hall-stats > div {
  padding: 12px;
  border: 1px solid rgba(107, 68, 35, 0.16);
  border-radius: 8px;
  background: rgba(255, 252, 246, 0.9);
}

.hall-stats span,
.hall-stats strong {
  display: block;
}

.hall-stats span {
  color: var(--color-text-secondary);
  font-size: 12px;
}

.hall-stats strong {
  margin-top: 4px;
  font-size: 22px;
}

.game-stage {
  margin-bottom: 16px;
}

.stage-topbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.stage-topbar h2 {
  margin: 0 0 4px;
  font-size: 18px;
  font-weight: 700;
}

.stage-topbar p {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.stage-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.game-board {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.hall-scene {
  position: relative;
  min-height: 360px;
  overflow: hidden;
  border: 1px solid rgba(105, 66, 36, 0.2);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(96, 48, 28, 0.08) 0%, rgba(255, 238, 203, 0.32) 38%, rgba(115, 72, 42, 0.08) 100%),
    #fff8ec;
  box-shadow: inset 0 -32px 60px rgba(122, 76, 41, 0.14);
}

.scene-backdrop {
  position: absolute;
  inset: 0 0 42%;
  background:
    linear-gradient(90deg, rgba(85, 44, 30, 0.2) 0 10px, transparent 10px calc(100% - 10px), rgba(85, 44, 30, 0.2) calc(100% - 10px)),
    linear-gradient(180deg, #6f392c, #9f6041 58%, rgba(159, 96, 65, 0));
}

.hall-plaque {
  position: absolute;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  min-width: 112px;
  padding: 8px 18px;
  border: 2px solid #e4b865;
  border-radius: 4px;
  background: #3f241d;
  color: #ffe6a5;
  text-align: center;
  font-size: 22px;
  font-weight: 800;
  letter-spacing: 0;
}

.lantern {
  position: absolute;
  top: 44px;
  width: 24px;
  height: 34px;
  border-radius: 50% 50% 46% 46%;
  background: #d94a36;
  box-shadow: 0 0 18px rgba(217, 74, 54, 0.55);
}

.lantern::after {
  content: '';
  position: absolute;
  left: 10px;
  bottom: -12px;
  width: 4px;
  height: 14px;
  background: #d6a04c;
}

.lantern-left {
  left: 18%;
}

.lantern-right {
  right: 18%;
}

.banner {
  position: absolute;
  top: 94px;
  width: 38px;
  padding: 12px 0;
  border-radius: 4px;
  background: #6f1f1a;
  color: #ffe5ad;
  text-align: center;
  font-weight: 700;
  box-shadow: 0 8px 18px rgba(67, 28, 20, 0.18);
}

.banner-left {
  left: 26%;
}

.banner-right {
  right: 26%;
}

.dais,
.reward-board-prop {
  position: absolute;
  z-index: 2;
  border: 1px solid rgba(88, 52, 28, 0.26);
  color: #704225;
  font-weight: 700;
}

.dais {
  top: 30%;
  left: 50%;
  width: 156px;
  height: 52px;
  transform: translateX(-50%);
  border-radius: 8px 8px 18px 18px;
  background: linear-gradient(180deg, #f8d493, #c9874c);
  display: grid;
  place-items: center;
}

.reward-board-prop {
  right: 24px;
  bottom: 58px;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 92px;
  padding: 9px 10px;
  border-radius: 6px;
  background: #fff4d6;
  cursor: pointer;
}

.floor-grid {
  position: absolute;
  inset: 42% -12% -18%;
  transform: perspective(420px) rotateX(56deg);
  transform-origin: top;
  background:
    linear-gradient(rgba(122, 82, 48, 0.16) 1px, transparent 1px),
    linear-gradient(90deg, rgba(122, 82, 48, 0.16) 1px, transparent 1px),
    linear-gradient(180deg, rgba(244, 204, 128, 0.55), rgba(184, 118, 66, 0.18));
  background-size: 42px 42px;
}

.agent-token {
  position: absolute;
  z-index: 5;
  width: 74px;
  min-height: 82px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  transform: translate(-50%, -50%);
}

.hall-scene.patrolling .agent-token {
  animation: patrol 4.6s ease-in-out infinite;
  animation-delay: var(--walk-delay);
}

.agent-token.active {
  z-index: 8;
}

.token-shadow {
  position: absolute;
  left: 50%;
  top: 48px;
  width: 52px;
  height: 18px;
  transform: translateX(-50%);
  border-radius: 50%;
  background: rgba(67, 39, 24, 0.2);
  filter: blur(1px);
}

.token-body {
  position: relative;
  width: 48px;
  height: 48px;
  margin: 0 auto;
  border: 3px solid #fff5d8;
  border-radius: 50%;
  background: #4d8f78;
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 18px;
  font-weight: 800;
  box-shadow: 0 8px 16px rgba(62, 35, 21, 0.24);
}

.token-body img {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
}

.agent-token.busy .token-body {
  background: #b7792c;
}

.agent-token.offline .token-body {
  background: #7a7d83;
}

.agent-token.error .token-body {
  background: #b13e3e;
}

.agent-token.active .token-body {
  outline: 3px solid rgba(var(--color-primary-rgb), 0.34);
}

.token-name {
  position: relative;
  display: block;
  max-width: 74px;
  margin-top: 4px;
  overflow: hidden;
  color: #4f2f20;
  font-size: 12px;
  font-weight: 700;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.token-bubble {
  position: absolute;
  left: 50%;
  bottom: 78px;
  width: max-content;
  max-width: 152px;
  padding: 5px 8px;
  transform: translateX(-50%) scale(0.92);
  border: 1px solid rgba(96, 58, 33, 0.18);
  border-radius: 8px;
  background: rgba(255, 252, 243, 0.96);
  color: #5a3925;
  font-size: 12px;
  line-height: 1.3;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.agent-token:hover .token-bubble,
.agent-token.active .token-bubble {
  opacity: 1;
  transform: translateX(-50%) scale(1);
}

.scene-panel {
  padding: 14px;
  border: 1px solid rgba(107, 68, 35, 0.16);
  border-radius: 8px;
  background: rgba(255, 252, 246, 0.92);
}

.selected-agent {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.selected-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.selected-avatar {
  width: 48px;
  height: 48px;
  flex: 0 0 48px;
  overflow: hidden;
  border-radius: 50%;
  background: #4d8f78;
  color: #fff;
  display: grid;
  place-items: center;
  font-weight: 800;
}

.selected-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.selected-head h3,
.selected-head p {
  margin: 0;
}

.selected-head p,
.selected-task {
  color: var(--color-text-secondary);
  font-size: 13px;
}

.selected-status {
  display: flex;
  justify-content: space-between;
  padding: 10px;
  border-radius: 8px;
  background: rgba(94, 139, 116, 0.1);
}

.selected-task {
  margin: 0;
  line-height: 1.5;
}

.selected-abilities {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.selected-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.hall-layout {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}

.hall-workspace {
  min-width: 0;
}

.workspace-tabs {
  padding-top: 12px;
}

.chat-panel {
  min-width: 0;
}

.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.panel-header h2 {
  margin: 0 0 4px;
  font-size: 18px;
  font-weight: 600;
}

.panel-header p {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.event-list {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.event-item {
  display: flex;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--color-outline);
  border-radius: 8px;
  background: var(--color-surface-container-lowest);
}

.event-icon {
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: rgba(var(--color-primary-rgb), 0.1);
  color: var(--color-primary);
}

.event-item h3,
.event-item p {
  margin: 0;
}

.event-item h3 {
  font-size: 14px;
  font-weight: 600;
}

.event-item p {
  margin-top: 4px;
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.5;
}

@keyframes patrol {
  0%,
  100% {
    transform: translate(-50%, -50%);
  }

  50% {
    transform: translate(calc(-50% + var(--walk-x)), calc(-50% + var(--walk-y)));
  }
}

@media (min-width: 768px) {
  .juyi-hall {
    padding: 24px;
  }

  .hall-stats {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .game-board {
    grid-template-columns: minmax(0, 1fr) 280px;
  }

  .hall-layout {
    grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
    align-items: start;
  }
}

@media (max-width: 520px) {
  .hall-scene {
    min-height: 300px;
  }

  .stage-topbar,
  .hall-header,
  .panel-header {
    flex-direction: column;
  }

  .stage-actions {
    justify-content: flex-start;
  }

  .reward-board-prop {
    right: 10px;
    bottom: 42px;
  }

  .agent-token {
    width: 62px;
  }

  .token-body {
    width: 42px;
    height: 42px;
  }

  .token-bubble {
    max-width: 116px;
  }
}
</style>
