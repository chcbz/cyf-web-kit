<template>
  <section class="agent-list-panel">
    <header class="panel-header">
      <div>
        <h2>{{ $t('juyiting.agent_list') }}</h2>
        <p>{{ $t('juyiting.agent_summary', { total: agentStore.total, online: agentStore.onlineTotal }) }}</p>
      </div>
      <var-button
        text
        type="primary"
        size="small"
        :loading="agentStore.loading"
        @click="refresh"
      >
        {{ $t('app.refresh') }}
      </var-button>
    </header>

    <div class="agent-filters">
      <var-chip
        v-for="item in statusFilters"
        :key="item.value"
        :type="statusFilter === item.value ? 'primary' : 'default'"
        size="small"
        @click="setStatus(item.value)"
      >
        {{ item.label }}
      </var-chip>
    </div>

    <var-input
      v-model="abilityFilter"
      class="ability-filter"
      :placeholder="$t('juyiting.ability_filter')"
      clearable
      @keyup.enter="refresh"
      @clear="refresh"
    >
      <template #prepend-icon>
        <var-icon name="magnify" />
      </template>
    </var-input>

    <var-loading v-if="agentStore.loading" class="agent-loading" />

    <var-empty
      v-else-if="!agentStore.agents.length"
      :description="agentStore.error || $t('juyiting.empty_agents')"
    />

    <div v-else class="agent-list">
      <AgentCard
        v-for="agent in agentStore.agents"
        :key="agent.agentId"
        :agent="agent"
        :selected="agentStore.selectedAgentId === agent.agentId"
        @select="selectAgent"
        @detail="$emit('detail', $event)"
      />
    </div>

    <p v-if="agentStore.usingFallback" class="fallback-note">
      {{ $t('juyiting.fallback_note') }}
    </p>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AgentCard from '@/components/agent/AgentCard.vue'
import { useAgentStore, AGENT_STATUS } from '@/stores/agent'

const emit = defineEmits(['detail', 'select'])

const { t } = useI18n()
const agentStore = useAgentStore()
const statusFilter = ref('')
const abilityFilter = ref('')

const statusFilters = computed(() => [
  { value: '', label: t('juyiting.status_all') },
  { value: AGENT_STATUS.ONLINE, label: t('juyiting.status_online') },
  { value: AGENT_STATUS.BUSY, label: t('juyiting.status_busy') },
  { value: AGENT_STATUS.OFFLINE, label: t('juyiting.status_offline') },
  { value: AGENT_STATUS.ERROR, label: t('juyiting.status_error') }
])

const refresh = () => {
  agentStore.fetchAgents({
    status: statusFilter.value,
    ability: abilityFilter.value.trim()
  })
}

const setStatus = (status) => {
  statusFilter.value = status
  refresh()
}

const selectAgent = async (agentId) => {
  agentStore.selectAgent(agentId)
  emit('select', agentId)
}
</script>

<style scoped>
.agent-list-panel {
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

.agent-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.ability-filter {
  margin-bottom: 12px;
}

.agent-loading {
  min-height: 180px;
}

.agent-list {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.fallback-note {
  margin: 12px 0 0;
  color: var(--color-text-secondary);
  font-size: 12px;
}
</style>
