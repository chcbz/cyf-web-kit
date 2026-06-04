<template>
  <aside class="selected-agent-card" @click="$emit('open-agents')">
    <template v-if="agent">
      <span
        class="large-avatar portrait-avatar"
        :style="portraitStyle(agent)"
        :title="portraitName(agent)"
      ></span>
      <div>
        <strong>{{ agent.name || agent.personaName }}</strong>
        <small>{{ portraitName(agent) }} / {{ statusText(agent.status) }} / {{ agent.currentTaskTitle || abilityText(agent) }}</small>
      </div>
    </template>
    <span v-else>点击好汉查看详情</span>
  </aside>
</template>

<script setup>
defineProps({
  abilityText: { type: Function, required: true },
  agent: { type: Object, default: null },
  portraitName: { type: Function, required: true },
  portraitStyle: { type: Function, required: true },
  statusText: { type: Function, required: true }
})

defineEmits(['open-agents'])
</script>

<style scoped>
.selected-agent-card {
  position: absolute;
  right: 18px;
  bottom: calc(var(--bottom-action-bar-height, 68px) + 6px);
  z-index: 6;
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(320px, calc(100% - 36px));
  min-height: 78px;
  padding: 12px;
  border: 1px solid rgba(255, 244, 212, 0.22);
  border-radius: 8px;
  background: rgba(35, 24, 16, 0.74);
  color: #fff4d4;
  backdrop-filter: blur(8px);
  cursor: pointer;
}

.selected-agent-card strong,
.selected-agent-card small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.selected-agent-card small {
  color: #d7b875;
  font-size: 12px;
}

.large-avatar {
  display: inline-grid;
  place-items: center;
  width: 58px;
  height: 58px;
  border-radius: 50%;
  background: #7c1f1b;
  color: #fff4d4;
  font-size: 22px;
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

@media (max-width: 620px) {
  .selected-agent-card {
    left: calc(var(--map-controls-footprint, 0px) + 12px);
    right: 12px;
    bottom: calc(var(--bottom-action-bar-height, 68px) + 4px);
    width: auto;
    min-height: 64px;
    padding: 10px 12px;
  }
}
</style>
