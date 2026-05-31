<template>
  <article
    class="agent-card"
    :class="{ selected }"
    @click="$emit('select', agent.agentId)"
  >
    <div class="agent-main">
      <div class="agent-avatar">
        <img v-if="agent.avatar" :src="agent.avatar" :alt="agent.name" />
        <span v-else>{{ avatarText }}</span>
      </div>

      <div class="agent-summary">
        <div class="agent-title-row">
          <h3>{{ agent.name }}</h3>
          <var-chip :type="statusType" size="mini">
            {{ statusLabel }}
          </var-chip>
        </div>
        <p class="agent-subtitle">{{ agent.title || agent.personaName || $t('juyiting.agent') }}</p>
        <p v-if="agent.slogan" class="agent-slogan">{{ agent.slogan }}</p>
      </div>
    </div>

    <div class="ability-list">
      <var-chip
        v-for="ability in agent.abilities"
        :key="ability"
        size="mini"
      >
        {{ ability }}
      </var-chip>
    </div>

    <div v-if="agent.currentTask" class="current-task">
      <var-icon name="progress-clock" />
      <span>{{ agent.currentTask.title }}</span>
    </div>

    <div v-if="agent.errorMessage" class="agent-error">
      {{ agent.errorMessage }}
    </div>

    <div class="agent-footer">
      <span>{{ $t('juyiting.score') }} {{ agent.stats?.totalScore || 0 }}</span>
      <var-button
        text
        type="primary"
        size="small"
        @click.stop="$emit('detail', agent.agentId)"
      >
        {{ $t('juyiting.detail') }}
      </var-button>
    </div>
  </article>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AGENT_STATUS } from '@/stores/agent'

const props = defineProps({
  agent: {
    type: Object,
    required: true
  },
  selected: {
    type: Boolean,
    default: false
  }
})

defineEmits(['select', 'detail'])

const { t } = useI18n()

const avatarText = computed(() => {
  return (props.agent.name || props.agent.agentId || 'A').slice(0, 1)
})

const statusLabel = computed(() => {
  const map = {
    [AGENT_STATUS.ONLINE]: t('juyiting.status_online'),
    [AGENT_STATUS.BUSY]: t('juyiting.status_busy'),
    [AGENT_STATUS.OFFLINE]: t('juyiting.status_offline'),
    [AGENT_STATUS.ERROR]: t('juyiting.status_error')
  }
  return map[props.agent.status] || props.agent.status || t('juyiting.status_unknown')
})

const statusType = computed(() => {
  const map = {
    [AGENT_STATUS.ONLINE]: 'success',
    [AGENT_STATUS.BUSY]: 'warning',
    [AGENT_STATUS.OFFLINE]: 'default',
    [AGENT_STATUS.ERROR]: 'danger'
  }
  return map[props.agent.status] || 'default'
})
</script>

<style scoped>
.agent-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--color-outline);
  border-radius: 8px;
  background: var(--color-surface-container-lowest);
  cursor: pointer;
}

.agent-card.selected {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 1px rgba(var(--color-primary-rgb), 0.2);
}

.agent-main {
  display: flex;
  gap: 12px;
  min-width: 0;
}

.agent-avatar {
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  overflow: hidden;
  border-radius: 50%;
  background: rgba(var(--color-primary-rgb), 0.1);
  color: var(--color-primary);
  display: grid;
  place-items: center;
  font-size: 18px;
  font-weight: 700;
}

.agent-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.agent-summary {
  min-width: 0;
  flex: 1;
}

.agent-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.agent-title-row h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.agent-subtitle,
.agent-slogan {
  margin: 4px 0 0;
  color: var(--color-text-secondary);
  font-size: 12px;
}

.ability-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.current-task {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--color-warning);
  font-size: 12px;
}

.current-task span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-error {
  color: var(--color-danger);
  font-size: 12px;
}

.agent-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--color-text-secondary);
  font-size: 12px;
}
</style>
