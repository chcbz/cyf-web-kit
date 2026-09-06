<template>
  <aside
    v-if="agent"
    class="selected-agent-card"
    :class="{ 'is-locked': locked }"
    :inert="locked ? '' : null"
    :aria-disabled="locked ? 'true' : null"
  >
    <button
      class="card-close"
      type="button"
      title="收起好汉牌"
      :disabled="locked"
      @click="emitAction('close-card')"
    >
      <var-icon name="close-circle-outline" />
    </button>
    <span
      class="large-avatar portrait-avatar"
      :style="portraitStyle(agent, { highRes: true })"
      :title="portraitName(agent)"
    ></span>
    <div class="agent-card-body">
      <strong>{{ agent.name || agent.personaName || agent.agentId }}</strong>
      <small>{{ portraitName(agent) }} / {{ statusText(agent.status) }}</small>
      <p>{{ agent.currentTaskTitle || abilityText(agent) }}</p>
      <div class="card-actions">
        <button
          v-if="canStartChat"
          type="button"
          class="card-action primary"
          :disabled="locked"
          @click="emitAction('start-chat')"
        >
          <var-icon name="message-text-outline" />
          <span>密议</span>
        </button>
        <button type="button" class="card-action" :disabled="locked" @click="emitAction('open-agents')">
          <var-icon name="account-circle" />
          <span>看牌</span>
        </button>
      </div>
    </div>
  </aside>
</template>

<script setup>
const props = defineProps({
  abilityText: { type: Function, required: true },
  agent: { type: Object, default: null },
  canStartChat: { type: Boolean, default: true },
  locked: { type: Boolean, default: false },
  portraitName: { type: Function, required: true },
  portraitStyle: { type: Function, required: true },
  statusText: { type: Function, required: true }
})

const emit = defineEmits(['open-agents', 'start-chat', 'close-card'])

const emitAction = event => {
  if (!props.locked) emit(event)
}
</script>

<style scoped>
.selected-agent-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(360px, 100%);
  max-width: 100%;
  min-height: 64px;
  padding: 10px 38px 10px 10px;
  box-sizing: border-box;
  border: 1px solid rgba(255, 244, 212, 0.22);
  border-radius: 8px;
  background: rgba(35, 24, 16, 0.74);
  color: #fff4d4;
  backdrop-filter: blur(8px);
  cursor: default;
}

button {
  border: 0;
  cursor: pointer;
  font: inherit;
}

.selected-agent-card.is-locked {
  pointer-events: none;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.agent-card-body {
  min-width: 0;
  flex: 1;
}

.selected-agent-card strong,
.selected-agent-card small,
.selected-agent-card p {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.selected-agent-card small {
  color: #d7b875;
  font-size: 12px;
}

.selected-agent-card p {
  margin: 5px 0 9px;
  color: rgba(255, 248, 232, 0.82);
  font-size: 12px;
}

.card-actions {
  display: flex;
  gap: 8px;
}

.card-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  background: rgba(255, 244, 212, 0.14);
  color: #fff4d4;
}

.card-action.primary {
  background: #b93622;
  color: #fff8e8;
}

.card-close {
  position: absolute;
  top: 6px;
  right: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  min-width: 26px;
  min-height: 26px;
  border-radius: 8px;
  background: transparent;
  color: rgba(255, 244, 212, 0.72);
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
    width: 100%;
    min-height: 64px;
    padding: 10px 38px 10px 12px;
  }

  .card-actions {
    flex-wrap: wrap;
  }
}
</style>
