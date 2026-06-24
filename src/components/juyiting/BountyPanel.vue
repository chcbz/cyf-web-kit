<template>
  <div class="bounty-panel">
    <div class="panel-toolbar">
      <div class="task-search">
        <input
          :value="taskKeyword"
          placeholder="查榜号"
          @input="$emit('update:taskKeyword', $event.target.value.trim())"
          @keyup.enter="$emit('load-tasks')"
        />
        <select
          :value="taskAbilityFilter"
          @change="$emit('update:taskAbilityFilter', $event.target.value); $emit('load-tasks')"
        >
          <option value="">不拘本领</option>
          <option v-for="ability in taskAbilityOptions" :key="ability" :value="ability">{{ ability }}</option>
        </select>
      </div>
      <button @click="$emit('load-tasks')">
        <var-icon name="refresh" />
        <span>重查</span>
      </button>
      <button class="new-task-button" type="button" @click="showCreateForm = !showCreateForm">
        <var-icon name="plus" />
        <span>张榜</span>
      </button>
    </div>

    <form v-if="showCreateForm" class="task-create-form" @submit.prevent="submitCreateTask">
      <input v-model.trim="taskForm.title" name="taskTitle" placeholder="榜文名目" />
      <textarea v-model.trim="taskForm.description" name="taskDescription" placeholder="榜文缘由"></textarea>
      <input v-model.trim="taskForm.requiredAbilities" name="requiredAbilities" placeholder="所需本领，逗号分隔" />
      <button type="submit" :disabled="!taskForm.title">张榜悬赏</button>
    </form>

    <div class="task-status-tabs">
      <button
        v-for="item in taskStatusFilters"
        :key="item.value"
        :class="{ active: taskStatusFilter === item.value }"
        @click="$emit('set-status-filter', item.value)"
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
          @click="openTask(task)"
        >
          <div class="task-head">
            <strong>{{ task.title }}</strong>
            <span :class="taskStateClass(task.status)">{{ taskStatusText(task.status) }}</span>
          </div>
          <p>{{ task.description || '榜文尚未写明缘由' }}</p>
          <div class="task-meta">
            <span>{{ task.id }}</span>
            <span v-if="task.assignedAgentName">领令：{{ task.assignedAgentName }}</span>
            <span v-if="task.updatedAt">{{ formatTime(task.updatedAt) }}</span>
          </div>
          <div class="ability-tags">
            <span v-for="ability in task.requiredAbilities || []" :key="ability">{{ ability }}</span>
            <span v-if="!(task.requiredAbilities || []).length">不拘本领</span>
          </div>
        </article>
        <div v-if="!tasks.length" class="empty-list">榜上暂无悬赏，可换个筛法或重查一遍。</div>
      </div>
    </div>

    <transition name="modal">
      <div v-if="detailTask" class="bounty-modal-overlay" @click.self="closeTask">
        <section class="bounty-modal">
          <div class="bounty-modal-header">
            <h3>榜文点将</h3>
            <button class="modal-close" @click="closeTask">
              <var-icon name="close-circle-outline" />
            </button>
          </div>

          <div class="bounty-modal-body">
            <div class="modal-task-info">
              <div class="task-detail-head">
                <div>
                  <strong>{{ detailTask.title }}</strong>
                  <small>{{ detailTask.id }} / {{ taskStatusText(detailTask.status) }}</small>
                </div>
                <span :class="taskStateClass(detailTask.status)">{{ taskStatusText(detailTask.status) }}</span>
              </div>

              <p>{{ detailTask.description || '榜文尚未写明缘由' }}</p>

              <div class="ability-tags">
                <span v-for="ability in detailTask.requiredAbilities || []" :key="ability">{{ ability }}</span>
                <span v-if="!(detailTask.requiredAbilities || []).length">不拘本领</span>
              </div>

              <div class="task-operation-grid">
                <button
                  :aria-label="agentDisplayName(selectedAgent) ? `点当前好汉 ${agentDisplayName(selectedAgent)} 领令` : '先择好汉再点将'"
                  :disabled="!canAssign(detailTask, selectedAgent)"
                  :title="agentDisplayName(selectedAgent) ? `点当前好汉领令：${agentDisplayName(selectedAgent)}` : '先择好汉再点将'"
                  @click="$emit('assign-task', detailTask, selectedAgent)"
                >
                  <var-icon name="account-circle-outline" />
                  <span class="visually-hidden">{{ agentDisplayName(selectedAgent) ? '点将当前' : '选择好汉' }}</span>
                </button>
                <button
                  aria-label="密议"
                  title="与当前好汉密议"
                  @click="$emit('brief-selected-task', detailTask, selectedAgent)"
                >
                  <var-icon name="message-text-outline" />
                  <span class="visually-hidden">密议</span>
                </button>
                <button
                  class="assign-selected-agents"
                  type="button"
                  :aria-label="`点已选 ${selectedAssignees.length} 人领令`"
                  :disabled="!selectedAssignees.length"
                  :title="`点已选 ${selectedAssignees.length} 人领令`"
                  @click="$emit('assign-task', detailTask, selectedAssignees)"
                >
                  <var-icon name="format-list-checkbox" />
                  <span class="count-badge">{{ selectedAssignees.length }}</span>
                  <span class="visually-hidden">点将已选 {{ selectedAssignees.length }}</span>
                </button>
                <button
                  class="auto-assign-task"
                  type="button"
                  aria-label="宋江代为点将"
                  :disabled="detailTask.status !== 'open' || !recommendedAgents.length"
                  title="宋江代为点将"
                  @click="$emit('auto-assign-task', detailTask)"
                >
                  <var-icon name="account-tie-outline" />
                  <span class="visually-hidden">宋江代为点将</span>
                </button>
                <button
                  class="discuss-task-button"
                  type="button"
                  aria-label="榜文议事"
                  :disabled="!taskAssigneeIds(detailTask).length"
                  :title="!taskAssigneeIds(detailTask).length ? unassignedDiscussHint : ''"
                  @click="$emit('discuss-task', detailTask)"
                >
                  <var-icon name="chat-processing-outline" />
                  <span class="visually-hidden">榜文议事</span>
                </button>
                <button
                  class="archive-task-button"
                  type="button"
                  aria-label="收入案卷"
                  title="收入案卷"
                  @click="$emit('archive-task', detailTask)"
                >
                  <var-icon name="download-outline" />
                  <span class="visually-hidden">收入案卷</span>
                </button>
              </div>
              <p v-if="!taskAssigneeIds(detailTask).length" class="task-operation-hint">
                {{ unassignedDiscussHint }}
              </p>
            </div>

            <div class="modal-agent-scroll">
              <div class="section-label">可点好汉</div>
              <div
                v-for="agent in recommendedAgents"
                :key="agent.agentId"
                class="recommended-agent-row"
                :class="{ active: selectedAgent?.agentId === agent.agentId }"
              >
                <button class="recommended-agent-main" type="button" @click="$emit('select-agent', agent)">
                  <input
                    class="assignee-check"
                    type="checkbox"
                    :checked="selectedAssigneeIds.includes(agent.agentId)"
                    @click.stop
                    @change="toggleAssignee(agent)"
                  />
                  <span class="mini-avatar portrait-avatar" :style="portraitStyle(agent)" :title="portraitName(agent)"></span>
                  <span>
                    <strong>{{ agentDisplayName(agent) }}</strong>
                    <small>{{ abilityText(agent) }}</small>
                  </span>
                  <em>{{ recommendationScore(detailTask, agent) }}%</em>
                </button>
                <p v-if="recommendationReason(agent)" class="recommendation-reason">
                  {{ recommendationReason(agent) }}
                </p>
                <div class="recommended-agent-actions">
                  <button type="button" :aria-label="`选定 ${agentDisplayName(agent)}`" :title="`选定 ${agentDisplayName(agent)}`" @click="$emit('select-agent', agent)">
                    <var-icon name="check-circle-outline" />
                    <span class="visually-hidden">选定</span>
                  </button>
                  <button type="button" :aria-label="`点 ${agentDisplayName(agent)} 领令`" :disabled="!canAssign(detailTask, agent)" :title="`点 ${agentDisplayName(agent)} 领令`" @click="$emit('assign-task', detailTask, agent)">
                    <var-icon name="account-circle-outline" />
                    <span class="visually-hidden">点将</span>
                  </button>
                  <button type="button" :aria-label="`与 ${agentDisplayName(agent)} 密议`" :title="`与 ${agentDisplayName(agent)} 密议`" @click="$emit('brief-selected-task', detailTask, agent)">
                    <var-icon name="message-text-outline" />
                    <span class="visually-hidden">密议</span>
                  </button>
                </div>
              </div>
              <p v-if="!recommendedAgents.length">暂未寻得可领令的好汉。</p>
            </div>
          </div>
        </section>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  tasks: { type: Array, default: () => [] },
  selectedTask: { type: Object, default: null },
  selectedAgent: { type: Object, default: null },
  recommendedAgents: { type: Array, default: () => [] },
  taskAbilityOptions: { type: Array, default: () => [] },
  taskStatusFilters: { type: Array, default: () => [] },
  taskAbilityFilter: { type: String, default: '' },
  taskKeyword: { type: String, default: '' },
  taskStatusFilter: { type: String, default: '' },
  abilityText: { type: Function, required: true },
  canAssign: { type: Function, required: true },
  formatTime: { type: Function, required: true },
  portraitName: { type: Function, required: true },
  portraitStyle: { type: Function, required: true },
  taskAgentMatchScore: { type: Function, required: true },
  taskStateClass: { type: Function, required: true },
  taskStatusCount: { type: Function, required: true },
  taskStatusText: { type: Function, required: true }
})

const emit = defineEmits([
  'assign-task',
  'archive-task',
  'auto-assign-task',
  'brief-selected-task',
  'create-task',
  'discuss-task',
  'load-tasks',
  'select-agent',
  'select-task',
  'set-status-filter',
  'update:taskAbilityFilter',
  'update:taskKeyword'
])

const modalTask = ref(null)
const showCreateForm = ref(false)
const selectedAssigneeIds = ref([])
const taskForm = ref({
  title: '',
  description: '',
  requiredAbilities: ''
})
const detailTask = computed(() => modalTask.value)
const unassignedDiscussHint = '此榜文尚未点将，暂不可开议'
const selectedAssignees = computed(() => {
  const selected = new Set(selectedAssigneeIds.value)
  return props.recommendedAgents.filter(agent => selected.has(agent.agentId))
})

const agentDisplayName = (agent) => agent?.name || agent?.personaName || agent?.agentId || ''
const recommendationReason = (agent) => agent?.recommendationReason || ''
const recommendationScore = (task, agent) => agent?.recommendationScore ?? props.taskAgentMatchScore(task, agent)
const taskAssigneeIds = (task) => {
  if (!task) return []
  if (Array.isArray(task.assignedAgentIds)) return task.assignedAgentIds
  return task.assignedAgentId ? [task.assignedAgentId] : []
}

const submitCreateTask = () => {
  if (!taskForm.value.title) return
  emit('create-task', {
    title: taskForm.value.title,
    description: taskForm.value.description,
    requiredAbilities: taskForm.value.requiredAbilities
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
  })
  taskForm.value = { title: '', description: '', requiredAbilities: '' }
  showCreateForm.value = false
}

const toggleAssignee = (agent) => {
  const id = agent?.agentId
  if (!id) return
  if (selectedAssigneeIds.value.includes(id)) {
    selectedAssigneeIds.value = selectedAssigneeIds.value.filter(item => item !== id)
  } else {
    selectedAssigneeIds.value = [...selectedAssigneeIds.value, id]
  }
}

const openTask = (task) => {
  modalTask.value = task
  selectedAssigneeIds.value = taskAssigneeIds(task)
  emit('select-task', task)
}

const closeTask = () => {
  modalTask.value = null
  emit('select-task', null)
}

watch(() => props.selectedTask, (task) => {
  if (!task) {
    modalTask.value = null
    return
  }

  if (modalTask.value?.id === task.id) {
    modalTask.value = task
    selectedAssigneeIds.value = taskAssigneeIds(task)
  }
})
</script>
<style scoped>
.bounty-panel {
  position: relative;
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  flex-direction: column;
  overflow: hidden;
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

.panel-toolbar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px;
  color: #765f40;
  font-size: 13px;
}

.panel-toolbar button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  padding: 0 12px;
  border-radius: 8px;
  background: #efe0c6;
  color: #4a3423;
}

.task-search {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) minmax(118px, 150px);
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.task-search input,
.task-search select,
.task-create-form input,
.task-create-form textarea {
  min-width: 0;
  height: 36px;
  padding: 0 10px;
  border: 1px solid #d7c3a2;
  border-radius: 8px;
  background: #fffdf6;
  color: #3f2815;
  outline: none;
}

.task-create-form {
  display: grid;
  flex: 0 0 auto;
  grid-template-columns: minmax(150px, 1fr) minmax(180px, 1.4fr) minmax(140px, 0.8fr) auto;
  gap: 8px;
  padding: 0 16px 12px;
}

.task-create-form textarea {
  height: 36px;
  padding-top: 8px;
  resize: vertical;
}

.task-create-form button {
  min-height: 36px;
  padding: 0 12px;
  border-radius: 8px;
  background: #7c1f1b;
  color: #fff8e8;
}

.task-status-tabs {
  display: flex;
  flex: 0 0 auto;
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

.task-panel-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: 0 12px 12px;
  box-sizing: border-box;
  overflow: hidden;
}

.task-list {
  overflow: auto;
  min-width: 0;
  min-height: 0;
  padding: 0;
}

.task-card {
  box-sizing: border-box;
  max-width: 100%;
  padding: 12px;
  margin-bottom: 10px;
  border-radius: 8px;
  background: #f7ecd7;
}

.task-card.selected {
  background: #ead3a9;
}

.task-card p {
  color: #765f40;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.task-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 12px;
}

.task-head strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.task-detail-card {
  min-width: 0;
  min-height: 0;
  max-width: 100%;
  padding: 12px;
  box-sizing: border-box;
  overflow: auto;
  border-radius: 8px;
  background: #f4e2c3;
}

.task-detail-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 10px;
  margin-bottom: 10px;
}

.task-detail-head > div {
  min-width: 0;
}

.task-detail-head strong,
.task-detail-head small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-detail-head small {
  margin-top: 3px;
  color: #765f40;
  font-size: 12px;
}

.task-operation-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 10px 0;
}

.task-operation-grid button {
  position: relative;
  display: inline-grid;
  place-items: center;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  min-width: 34px;
  min-height: 34px;
  padding: 0;
  border-radius: 8px;
  background: #7c1f1b;
  color: #fff8e8;
  line-height: 1;
}

.task-operation-grid button + button {
  background: #23483e;
}

.task-operation-grid button:disabled,
.recommended-agent-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.count-badge {
  position: absolute;
  right: -4px;
  top: -5px;
  display: inline-grid;
  place-items: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border: 1px solid #fff8e8;
  border-radius: 999px;
  background: #d8a33a;
  color: #2f261c;
  font-size: 10px;
  font-weight: 800;
  line-height: 1;
}

.task-operation-hint {
  margin: -2px 0 10px;
  color: #8a5d26;
  font-size: 12px;
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

.recommended-agent-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 8px;
  border-radius: 8px;
  background: #f7ecd7;
}

.recommended-agent-row.active {
  outline: 2px solid #7c1f1b;
}

.recommended-agent-main {
  display: grid;
  grid-template-columns: 22px 38px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  width: 100%;
  padding: 8px;
  border-radius: 8px;
  background: rgba(255, 253, 246, 0.72);
  color: #2f261c;
  text-align: left;
}

.assignee-check {
  width: 16px;
  height: 16px;
  accent-color: #7c1f1b;
}

.recommended-agent-actions {
  display: flex;
  flex-wrap: nowrap;
  gap: 6px;
  width: 100%;
}

.recommendation-reason {
  grid-column: 1 / -1;
  margin: -2px 4px 0 68px;
  overflow-wrap: anywhere;
}

.recommended-agent-actions button {
  display: inline-grid;
  place-items: center;
  width: 30px;
  height: 30px;
  min-width: 30px;
  padding: 0;
  border-radius: 7px;
  background: #efe0c6;
  color: #4a3423;
  line-height: 1;
}

.recommended-agent-actions button:nth-child(2) {
  background: #7c1f1b;
  color: #fff8e8;
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
  white-space: nowrap;
  font-style: normal;
  color: #23483e;
  font-weight: 700;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.mini-avatar {
  display: inline-grid;
  place-items: center;
  width: 38px;
  height: 38px;
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

.empty-list {
  padding: 16px;
  color: #765f40;
}

/* Modal Styles */
.bounty-modal-overlay {
  position: absolute;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  background: transparent;
  padding: 16px;
  isolation: isolate;
  contain: layout paint;
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
}

.bounty-modal-overlay,
.bounty-modal,
.bounty-modal * {
  box-sizing: border-box;
}

.bounty-modal-overlay::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 0;
  background: rgba(15, 10, 6, 0.72);
  opacity: 1;
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
  pointer-events: none;
}

.bounty-modal {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 560px;
  max-height: min(90vh, 720px);
  border: 1px solid rgba(255, 240, 202, 0.28);
  border-radius: 12px;
  background:
    linear-gradient(155deg, #fdf6ea 0%, #f2e0bd 100%);
  color: #2f261c;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.18),
    0 18px 48px rgba(0, 0, 0, 0.42);
  overflow: hidden;
  opacity: 1;
  transform: translate3d(0, 0, 0);
  transform-origin: center bottom;
  backface-visibility: hidden;
  contain: layout paint;
  will-change: transform, opacity;
  isolation: isolate;
}

.bounty-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(124, 31, 27, 0.16);
  background: linear-gradient(135deg, rgba(124, 31, 27, 0.06), transparent);
}

.bounty-modal-header h3 {
  margin: 0;
  font-size: 18px;
  color: #7c1f1b;
}

.modal-close {
  display: inline-grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(124, 31, 27, 0.1);
  color: #7c1f1b;
  transition: background 0.18s;
}

.modal-close:hover {
  background: rgba(124, 31, 27, 0.2);
}

.bounty-modal-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-task-info {
  flex: 0 0 auto;
  padding: 14px 16px 0;
}

.modal-agent-scroll {
  flex: 1;
  min-height: 0;
  margin-top: 12px;
  padding: 0 16px 16px;
  overflow-y: auto;
}

/* Modal Transition */
.modal-enter-active,
.modal-leave-active {
  transition: none;
}

.modal-enter-active::before,
.modal-leave-active::before {
  transition: opacity 0.16s ease-out;
  will-change: opacity;
}

.modal-enter-active .bounty-modal,
.modal-leave-active .bounty-modal {
  transition:
    transform 0.18s cubic-bezier(0.2, 0, 0, 1),
    opacity 0.14s ease-out;
  will-change: transform, opacity;
}

.modal-enter-from::before,
.modal-leave-to::before {
  opacity: 0;
}

.modal-enter-from .bounty-modal {
  opacity: 0;
  transform: translate3d(0, 10px, 0);
}

.modal-leave-to .bounty-modal {
  opacity: 0;
  transform: translate3d(0, 10px, 0);
}

@media (prefers-reduced-motion: reduce) {
  .modal-enter-active,
  .modal-leave-active,
  .modal-enter-active::before,
  .modal-leave-active::before,
  .modal-enter-active .bounty-modal,
  .modal-leave-active .bounty-modal {
    transition: none;
  }
}

@media (max-width: 900px) {
  .bounty-modal-overlay {
    padding: 10px;
  }

  .panel-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .task-search,
  .task-panel-body {
    grid-template-columns: 1fr;
  }

  .task-panel-body {
    overflow: auto;
  }

  .task-list,
  .task-detail-card {
    overflow: visible;
  }

  .task-operation-grid {
    justify-content: flex-start;
  }

  .recommended-agent-row {
    grid-template-columns: 1fr;
  }

  .recommended-agent-main {
    grid-template-columns: 22px 38px minmax(0, 1fr) auto;
  }

  .recommended-agent-actions {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    justify-content: stretch;
  }

  .recommended-agent-actions button {
    width: 100%;
    min-width: 0;
    height: 34px;
  }

  .task-create-form {
    grid-template-columns: 1fr;
  }

  .bounty-modal {
    width: 100%;
    max-width: 100%;
    max-height: 100%;
  }
}
</style>
