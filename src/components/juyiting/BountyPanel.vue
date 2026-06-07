<template>
  <div class="bounty-panel">
    <div class="panel-toolbar">
      <div class="task-search">
        <input
          :value="taskKeyword"
          placeholder="搜索悬赏编号"
          @input="$emit('update:taskKeyword', $event.target.value.trim())"
          @keyup.enter="$emit('load-tasks')"
        />
        <select
          :value="taskAbilityFilter"
          @change="$emit('update:taskAbilityFilter', $event.target.value); $emit('load-tasks')"
        >
          <option value="">全部能力</option>
          <option v-for="ability in taskAbilityOptions" :key="ability" :value="ability">{{ ability }}</option>
        </select>
      </div>
      <button @click="$emit('load-tasks')">
        <var-icon name="refresh" />
        <span>刷新</span>
      </button>
    </div>

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

    <div class="task-panel-body" :class="{ 'has-selection': selectedTask }">
      <div class="task-list">
        <article
          v-for="task in tasks"
          :key="task.id"
          class="task-card"
          :class="{ selected: selectedTask?.id === task.id }"
          @click="$emit('select-task', task)"
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

      <aside v-if="selectedTask" class="task-detail-card">
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
            @click="$emit('assign-task', selectedTask)"
          >
            <var-icon name="account-circle" />
            <span>指派当前好汉</span>
          </button>
          <button @click="$emit('brief-selected-task')">
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
            @click="$emit('select-agent', agent)"
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
      </aside>
    </div>
  </div>
</template>

<script setup>
defineProps({
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

defineEmits([
  'assign-task',
  'brief-selected-task',
  'load-tasks',
  'select-agent',
  'select-task',
  'set-status-filter',
  'update:taskAbilityFilter',
  'update:taskKeyword'
])
</script>

<style scoped>
.bounty-panel {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  flex-direction: column;
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

.task-panel-body.has-selection {
  grid-template-columns: minmax(0, 1fr) minmax(300px, 360px);
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
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 12px 0;
}

.task-operation-grid button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 0;
  min-height: 38px;
  padding: 7px 10px;
  border-radius: 8px;
  background: #7c1f1b;
  color: #fff8e8;
  line-height: 1.2;
  text-align: center;
  white-space: normal;
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
  white-space: nowrap;
  font-style: normal;
  color: #23483e;
  font-weight: 700;
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

@media (max-width: 900px) {
  .panel-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .task-search,
  .task-panel-body {
    grid-template-columns: 1fr;
  }

  .task-panel-body.has-selection {
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
    grid-template-columns: 1fr;
  }
}
</style>
