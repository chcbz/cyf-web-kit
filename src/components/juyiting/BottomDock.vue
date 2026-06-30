<template>
  <div class="bottom-dock">
    <div class="dock-actions">
      <button
        v-for="item in items"
        :key="item.key"
        :class="{ active: activePanel === item.key }"
        @click="$emit('open-panel', item.key)"
      >
        <var-icon :name="item.icon" />
        <span>{{ item.label }}</span>
      </button>
    </div>
    <div class="dock-contexts">
      <span class="dock-count"><strong>{{ agentsTotal }}</strong> 好汉</span>
      <span class="dock-count"><strong>{{ tasksTotal }}</strong> 榜文</span>
      <button class="context-chip" type="button" @click="selectedAgent ? $emit('clear-agent') : $emit('open-panel', 'agents')">
        <small>所点好汉</small>
        <strong>{{ agentLabel || selectedAgent?.name || selectedAgent?.personaName || selectedAgent?.agentId || '未点好汉' }}</strong>
      </button>
      <button class="context-chip" type="button" @click="selectedTask ? $emit('clear-task') : $emit('open-panel', 'tasks')">
        <small>所看榜文</small>
        <strong>{{ selectedTask?.title || '未选榜文' }}</strong>
      </button>
    </div>
  </div>
</template>

<script setup>
defineProps({
  activePanel: { type: String, default: '' },
  agentsTotal: { type: Number, default: 0 },
  tasksTotal: { type: Number, default: 0 },
  selectedAgent: { type: Object, default: null },
  selectedTask: { type: Object, default: null },
  agentLabel: { type: String, default: '' }
})

defineEmits(['open-panel', 'clear-agent', 'clear-task'])

const items = [
  { key: 'command', icon: 'account-circle-outline', label: '宋江' },
  { key: 'agents', icon: 'account-circle', label: '点将册' },
  { key: 'tasks', icon: 'format-list-checkbox', label: '悬赏榜' },
  { key: 'coordination', icon: 'share', label: '照应' },
  { key: 'chat', icon: 'message-text-outline', label: '议事' },
  { key: 'library', icon: 'notebook', label: '案卷阁' }
]
</script>

<style scoped>
.bottom-dock {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px;
  box-sizing: border-box;
  border: 1px solid rgba(255, 244, 212, 0.18);
  border-radius: 8px;
  background: rgba(35, 24, 16, 0.66);
  backdrop-filter: blur(8px);
}

.dock-actions {
  display: flex;
  gap: 8px;
}

.dock-actions button {
  display: grid;
  place-items: center;
  min-width: 58px;
  min-height: 48px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #fff4d4;
  cursor: pointer;
  font: inherit;
}

.dock-actions button.active {
  background: rgba(244, 200, 76, 0.24);
  color: #fff8e8;
}

.dock-contexts {
  display: flex;
  gap: 8px;
  min-width: 0;
  overflow-x: auto;
}

.dock-count,
.context-chip {
  display: inline-flex;
  align-items: center;
  min-height: 48px;
  padding: 0 10px;
  border: 1px solid rgba(255, 244, 212, 0.14);
  border-radius: 8px;
  background: rgba(255, 244, 212, 0.08);
  color: #d7b875;
  white-space: nowrap;
}

.dock-count strong {
  margin-right: 4px;
  color: #fff8e8;
  font-size: 18px;
}

.context-chip {
  display: grid;
  justify-items: start;
  max-width: 180px;
  border: 0;
  cursor: pointer;
  font: inherit;
}

.context-chip small,
.context-chip strong {
  overflow: hidden;
  max-width: 100%;
  text-overflow: ellipsis;
}

.context-chip small {
  color: #d7b875;
  font-size: 11px;
}

.context-chip strong {
  color: #fff8e8;
  font-size: 13px;
}

@media (max-width: 620px) {
  .bottom-dock {
    grid-template-columns: 1fr;
  }

  .dock-actions,
  .dock-contexts {
    overflow-x: auto;
  }
}
</style>
