<template>
  <var-dialog
    v-model:show="visible"
    :title="$t('juyiting.agent_detail')"
    :confirm-button-text="$t('app.confirm')"
  >
    <div v-if="agent" class="agent-detail">
      <div class="detail-head">
        <div class="detail-avatar">
          <img v-if="agent.avatar" :src="agent.avatar" :alt="agent.name" />
          <span v-else>{{ avatarText }}</span>
        </div>
        <div>
          <h3>{{ agent.name }}</h3>
          <p>{{ agent.title || agent.personaName || $t('juyiting.agent') }}</p>
        </div>
      </div>

      <div class="detail-grid">
        <div>
          <span>{{ $t('juyiting.status') }}</span>
          <strong>{{ statusLabel }}</strong>
        </div>
        <div>
          <span>{{ $t('juyiting.score') }}</span>
          <strong>{{ agent.stats?.totalScore || 0 }}</strong>
        </div>
        <div>
          <span>{{ $t('juyiting.success_count') }}</span>
          <strong>{{ agent.stats?.success || 0 }}</strong>
        </div>
        <div>
          <span>{{ $t('juyiting.failure_count') }}</span>
          <strong>{{ agent.stats?.failure || 0 }}</strong>
        </div>
      </div>

      <section class="detail-section">
        <h4>{{ $t('juyiting.abilities') }}</h4>
        <div class="ability-list">
          <var-chip
            v-for="ability in agent.abilities"
            :key="ability"
            size="small"
          >
            {{ ability }}
          </var-chip>
        </div>
      </section>

      <section v-if="agent.currentTask" class="detail-section">
        <h4>{{ $t('juyiting.current_task') }}</h4>
        <p>{{ agent.currentTask.title }}</p>
      </section>

      <section v-if="agent.endpoint" class="detail-section">
        <h4>{{ $t('juyiting.endpoint') }}</h4>
        <p>{{ agent.endpoint }}</p>
      </section>

      <section v-if="agent.errorMessage" class="detail-section error">
        <h4>{{ $t('juyiting.error_message') }}</h4>
        <p>{{ agent.errorMessage }}</p>
      </section>
    </div>
  </var-dialog>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AGENT_STATUS } from '@/stores/agent'

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  agent: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['update:show'])
const { t } = useI18n()

const visible = computed({
  get: () => props.show,
  set: value => emit('update:show', value)
})

const avatarText = computed(() => {
  return (props.agent?.name || props.agent?.agentId || 'A').slice(0, 1)
})

const statusLabel = computed(() => {
  const map = {
    [AGENT_STATUS.ONLINE]: t('juyiting.status_online'),
    [AGENT_STATUS.BUSY]: t('juyiting.status_busy'),
    [AGENT_STATUS.OFFLINE]: t('juyiting.status_offline'),
    [AGENT_STATUS.ERROR]: t('juyiting.status_error')
  }
  return map[props.agent?.status] || props.agent?.status || t('juyiting.status_unknown')
})
</script>

<style scoped>
.agent-detail {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.detail-head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.detail-avatar {
  width: 52px;
  height: 52px;
  flex: 0 0 52px;
  overflow: hidden;
  border-radius: 50%;
  background: rgba(var(--color-primary-rgb), 0.1);
  color: var(--color-primary);
  display: grid;
  place-items: center;
  font-size: 20px;
  font-weight: 700;
}

.detail-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.detail-head h3,
.detail-head p {
  margin: 0;
}

.detail-head p {
  margin-top: 4px;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.detail-grid > div {
  padding: 10px;
  border: 1px solid var(--color-outline);
  border-radius: 8px;
}

.detail-grid span,
.detail-grid strong {
  display: block;
}

.detail-grid span {
  color: var(--color-text-secondary);
  font-size: 12px;
}

.detail-grid strong {
  margin-top: 4px;
  font-size: 16px;
}

.detail-section h4 {
  margin: 0 0 8px;
  font-size: 14px;
}

.detail-section p {
  margin: 0;
  color: var(--color-text-secondary);
  line-height: 1.5;
  word-break: break-word;
}

.ability-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.error p {
  color: var(--color-danger);
}
</style>
