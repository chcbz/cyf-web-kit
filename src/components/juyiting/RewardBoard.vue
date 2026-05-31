<template>
  <section class="reward-board">
    <header class="panel-header">
      <div>
        <h2>{{ $t('juyiting.reward_board') }}</h2>
        <p>{{ $t('juyiting.reward_summary', { total: agentStore.taskTotal }) }}</p>
      </div>
      <var-button
        text
        type="primary"
        size="small"
        :loading="agentStore.taskLoading"
        @click="refresh"
      >
        {{ $t('app.refresh') }}
      </var-button>
    </header>

    <div class="task-toolbar">
      <var-input
        v-model="keyword"
        class="task-search"
        :placeholder="$t('juyiting.task_search')"
        clearable
        @keyup.enter="refresh"
        @clear="refresh"
      >
        <template #prepend-icon>
          <var-icon name="magnify" />
        </template>
      </var-input>
      <var-select
        v-model="taskStatus"
        class="status-select"
        :options="taskStatusOptions"
        label-key="text"
        value-key="value"
        :placeholder="$t('juyiting.task_status')"
        @change="refresh"
      />
    </div>

    <var-loading v-if="agentStore.taskLoading" class="task-loading" />

    <var-empty
      v-else-if="!agentStore.tasks.length"
      :description="agentStore.taskError || $t('juyiting.empty_tasks')"
    />

    <div v-else class="task-list">
      <article
        v-for="task in agentStore.tasks"
        :key="task.id"
        class="task-item"
      >
        <div class="task-title-row">
          <h3>{{ task.title }}</h3>
          <var-chip :type="priorityType(task.priority)" size="mini">
            {{ priorityLabel(task.priority) }}
          </var-chip>
        </div>

        <p class="task-description">{{ task.description || $t('juyiting.no_description') }}</p>

        <div class="ability-list">
          <var-chip
            v-for="ability in task.requiredAbilities"
            :key="ability"
            size="mini"
          >
            {{ ability }}
          </var-chip>
        </div>

        <div class="task-meta">
          <span>{{ $t('juyiting.reward') }} {{ task.reward }}</span>
          <span>{{ task.assignedAgentName || $t('juyiting.unassigned') }}</span>
        </div>

        <div class="task-actions">
          <var-select
            v-model="taskAssignments[task.id]"
            class="agent-select"
            :options="agentOptions"
            label-key="text"
            value-key="value"
            :placeholder="$t('juyiting.assign_agent')"
            :disabled="!agentOptions.length"
          />
          <var-button
            type="primary"
            size="small"
            :loading="agentStore.assigning"
            :disabled="!taskAssignments[task.id]"
            @click="assign(task.id)"
          >
            {{ $t('juyiting.assign') }}
          </var-button>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { Dialog } from '@varlet/ui'
import { useI18n } from 'vue-i18n'
import { useAgentStore } from '@/stores/agent'

const { t } = useI18n()
const agentStore = useAgentStore()
const keyword = ref('')
const taskStatus = ref('')
const taskAssignments = reactive({})

const taskStatusOptions = computed(() => [
  { text: t('juyiting.status_all'), value: '' },
  { text: t('juyiting.task_pending'), value: 'pending' },
  { text: t('juyiting.task_assigned'), value: 'assigned' },
  { text: t('juyiting.task_running'), value: 'running' },
  { text: t('juyiting.task_done'), value: 'done' },
  { text: t('juyiting.task_failed'), value: 'failed' }
])

const agentOptions = computed(() => {
  return agentStore.availableAgents.map(agent => ({
    text: `${agent.name} - ${agent.abilities.join('/')}`,
    value: agent.agentId
  }))
})

watch(
  () => agentStore.tasks,
  (tasks) => {
    tasks.forEach(task => {
      taskAssignments[task.id] = task.assignedAgentId || taskAssignments[task.id] || ''
    })
  },
  { immediate: true }
)

const refresh = () => {
  agentStore.fetchRewardTasks({
    status: taskStatus.value,
    keyword: keyword.value.trim()
  })
}

const assign = async (taskId) => {
  try {
    await agentStore.assignTask(taskId, taskAssignments[taskId])
    Dialog({
      title: t('app.notify'),
      message: t('juyiting.assign_success'),
      confirmButtonText: t('app.confirm')
    })
  } catch (error) {
    Dialog({
      title: t('app.alert'),
      message: error.message || t('juyiting.assign_failed'),
      confirmButtonText: t('app.confirm')
    })
  }
}

const priorityLabel = (priority) => {
  const map = {
    high: t('juyiting.priority_high'),
    medium: t('juyiting.priority_medium'),
    low: t('juyiting.priority_low')
  }
  return map[priority] || priority || t('juyiting.priority_medium')
}

const priorityType = (priority) => {
  const map = {
    high: 'danger',
    medium: 'warning',
    low: 'success'
  }
  return map[priority] || 'default'
}
</script>

<style scoped>
.reward-board {
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

.task-toolbar {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
  margin-bottom: 12px;
}

.task-loading {
  min-height: 180px;
}

.task-list {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.task-item {
  padding: 14px;
  border: 1px solid var(--color-outline);
  border-radius: 8px;
  background: var(--color-surface-container-lowest);
}

.task-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.task-title-row h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.task-description {
  margin: 8px 0;
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.ability-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.task-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: var(--color-text-secondary);
  font-size: 12px;
  margin-bottom: 10px;
}

.task-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
}

@media (min-width: 768px) {
  .task-toolbar {
    grid-template-columns: minmax(0, 1fr) 160px;
  }
}
</style>
