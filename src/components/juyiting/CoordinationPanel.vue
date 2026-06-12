<template>
  <div class="coordination-panel">
    <div class="selector-grid">
      <label>
        <span>发话人</span>
        <select :value="fromAgentId" @change="$emit('update:fromAgentId', $event.target.value)">
          <option value="">请选择</option>
          <option v-for="agent in agents" :key="agent.agentId" :value="agent.agentId">
            {{ agentDisplayName(agent) }}
          </option>
        </select>
      </label>
      <label>
        <span>接话人</span>
        <select :value="toAgentId" @change="$emit('update:toAgentId', $event.target.value)">
          <option value="">请选择</option>
          <option v-for="agent in agents" :key="agent.agentId" :value="agent.agentId">
            {{ agentDisplayName(agent) }}
          </option>
        </select>
      </label>
    </div>

    <textarea
      :value="message"
      placeholder="输入要转达的内容，或围绕当前悬赏安排协同事项"
      @input="$emit('update:message', $event.target.value)"
    ></textarea>

    <div class="action-row">
      <button type="button" :disabled="!canRelay" @click="$emit('relay-message')">
        <var-icon name="message-text-outline" />
        <span>互相传话</span>
      </button>
      <button type="button" :disabled="!canCoordinate" @click="$emit('coordinate-work')">
        <var-icon name="share" />
        <span>配合办事</span>
      </button>
    </div>

    <div class="section-label">当前悬赏</div>
    <article class="task-card">
      <strong>{{ selectedTask?.title || '未选悬赏' }}</strong>
      <p>{{ selectedTask?.description || '可先到悬赏榜选定任务，再安排两位好汉协同。' }}</p>
    </article>

    <div class="section-label">在线好汉</div>
    <div class="agent-grid">
      <button
        v-for="agent in agents"
        :key="agent.agentId"
        type="button"
        :class="{ selected: fromAgentId === agent.agentId || toAgentId === agent.agentId }"
        @click="$emit('pick-agent', agent)"
      >
        <span class="mini-avatar" :style="portraitStyle(agent)"></span>
        <span>
          <strong>{{ agentDisplayName(agent) }}</strong>
          <small>{{ abilityText(agent) }}</small>
        </span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  abilityText: { type: Function, required: true },
  agents: { type: Array, default: () => [] },
  fromAgentId: { type: String, default: '' },
  message: { type: String, default: '' },
  portraitStyle: { type: Function, required: true },
  selectedTask: { type: Object, default: null },
  toAgentId: { type: String, default: '' }
})

defineEmits([
  'coordinate-work',
  'pick-agent',
  'relay-message',
  'update:fromAgentId',
  'update:message',
  'update:toAgentId'
])

const canRelay = computed(() => props.fromAgentId && props.toAgentId && props.message.trim())
const canCoordinate = computed(() => props.fromAgentId && props.toAgentId && props.selectedTask)

const agentDisplayName = (agent) => agent?.name || agent?.personaName || agent?.agentId || ''
</script>

<style scoped>
.coordination-panel {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  overflow: auto;
}

button,
select,
textarea {
  font: inherit;
}

button {
  border: 0;
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.selector-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

label {
  display: grid;
  gap: 6px;
  color: #765f40;
  font-size: 13px;
}

select,
textarea {
  min-width: 0;
  border: 1px solid #d7c3a2;
  border-radius: 8px;
  background: #fffdf6;
  color: #3f2815;
  outline: none;
}

select {
  height: 38px;
  padding: 0 10px;
}

textarea {
  min-height: 96px;
  padding: 10px;
  resize: vertical;
}

.action-row {
  display: flex;
  gap: 10px;
}

.action-row button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 38px;
  padding: 0 14px;
  border-radius: 8px;
  background: #6d3f1f;
  color: #fff8e8;
}

.section-label {
  color: #765f40;
  font-size: 13px;
  font-weight: 700;
}

.task-card,
.agent-grid button {
  border-radius: 8px;
  background: #fff8e8;
  color: #3f2815;
}

.task-card {
  padding: 12px;
}

.task-card p {
  margin: 6px 0 0;
  color: #765f40;
}

.agent-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 10px;
}

.agent-grid button {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 10px;
  border: 1px solid transparent;
  text-align: left;
}

.agent-grid button.selected {
  border-color: #8c2f20;
}

.mini-avatar {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background-position: center;
  background-size: cover;
}

.agent-grid strong,
.agent-grid small {
  display: block;
  overflow: hidden;
  max-width: 100%;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-grid small {
  color: #8a6f4b;
  font-size: 12px;
}

@media (max-width: 620px) {
  .selector-grid,
  .agent-grid {
    grid-template-columns: 1fr;
  }
}
</style>
