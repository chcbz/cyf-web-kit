<template>
  <div class="agent-panel">
    <div class="panel-toolbar">
      <div class="status-filter">
        <button
          v-for="item in statusFilters"
          :key="item.value"
          :class="{ active: agentFilter === item.value }"
          @click="$emit('set-agent-filter', item.value)"
        >
          {{ item.label }}
        </button>
      </div>
      <span>簿上 {{ agents.length }} / 厅中 {{ mapAgents.length }}</span>
    </div>

    <div class="agent-panel-body">
      <div class="agent-list">
        <button
          v-for="agent in filteredAgents"
          :key="agent.agentId"
          class="agent-row"
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
            <span v-if="!(selectedAgent.abilities || []).length">未录本领</span>
          </div>
          <p>{{ selectedAgent.errorMessage || selectedAgent.currentTaskTitle || '正在厅中候令，可从榜文房点将。' }}</p>
        </template>
        <p v-else>点一位厅中好汉，查看动静、本领与所领榜文。</p>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  agents: { type: Array, default: () => [] },
  filteredAgents: { type: Array, default: () => [] },
  mapAgents: { type: Array, default: () => [] },
  selectedAgent: { type: Object, default: null },
  agentFilter: { type: String, default: 'all' },
  statusFilters: { type: Array, default: () => [] },
  abilityText: { type: Function, required: true },
  portraitName: { type: Function, required: true },
  portraitStyle: { type: Function, required: true },
  statusClass: { type: Function, required: true },
  statusText: { type: Function, required: true }
})

defineEmits(['set-agent-filter', 'select-agent'])
</script>

<style scoped>
.agent-panel {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
}

button {
  border: 0;
  cursor: pointer;
  font: inherit;
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

.status-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.status-filter button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  padding: 0 12px;
  border-radius: 8px;
  background: #efe0c6;
  color: #4a3423;
}

.status-filter button.active {
  background: #23483e;
  color: #fff;
}

.agent-panel-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(260px, 320px);
  gap: 12px;
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: 0 12px 12px;
  overflow: hidden;
}

.agent-list {
  overflow: auto;
  min-width: 0;
  min-height: 0;
  padding: 0;
}

.agent-row {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
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

.agent-row.active {
  background: #ead3a9;
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
.detail-head small {
  color: #765f40;
  font-size: 12px;
}

.agent-row em {
  font-style: normal;
  font-size: 12px;
}

.mini-avatar,
.large-avatar {
  display: inline-grid;
  place-items: center;
  border-radius: 50%;
  background: #7c1f1b;
  color: #fff4d4;
  font-weight: 700;
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

.detail-card {
  min-width: 0;
  min-height: 0;
  margin: 0;
  padding: 12px;
  overflow: auto;
  border-radius: 8px;
  background: #f4e2c3;
}

.detail-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.detail-head > div {
  min-width: 0;
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

@media (max-width: 900px) {
  .agent-panel-body {
    grid-template-columns: 1fr;
    overflow: auto;
  }

  .detail-card {
    order: -1;
  }
}

@media (max-width: 620px) {
  .panel-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
