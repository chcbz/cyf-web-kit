<template>
  <div class="chat-panel">
    <div class="panel-toolbar">
      <span>对话对象：{{ targetText }}</span>
      <button @click="$emit('load-messages')">同步</button>
    </div>
    <div v-if="agents.length" class="mention-strip" aria-label="选择要提及的 Agent">
      <button
        v-for="agent in agents"
        :key="agent.agentId"
        type="button"
        :class="{ active: selectedAgent?.agentId === agent.agentId }"
        @click="$emit('mention-agent', agent)"
      >
        @{{ mentionLabel(agent) }}
      </button>
    </div>
    <div ref="messageBoxRef" class="hall-messages">
      <div
        v-for="message in messages"
        :key="message.localId || message.timestamp"
        class="hall-message"
        :class="message.sender"
      >
        <strong>{{ senderText(message) }}</strong>
        <p>{{ message.content }}</p>
      </div>
      <div v-if="!messages.length" class="empty-list">厅中尚无传令，发起一句开始议事。</div>
    </div>
    <form class="hall-input" @submit.prevent="$emit('send-message')">
      <input
        :value="draft"
        autofocus
        :disabled="isStreaming"
        placeholder="向聚义厅发令，或 @某位好汉"
        @input="$emit('update:draft', $event.target.value)"
      />
      <button :disabled="!draft || isStreaming">
        <var-icon :name="isStreaming ? 'refresh' : 'chevron-right'" />
      </button>
    </form>
  </div>
</template>

<script setup>
import { nextTick, ref, watch } from 'vue'

const props = defineProps({
  agents: { type: Array, default: () => [] },
  draft: { type: String, default: '' },
  isStreaming: { type: Boolean, default: false },
  mentionLabel: { type: Function, required: true },
  messages: { type: Array, default: () => [] },
  selectedAgent: { type: Object, default: null },
  senderText: { type: Function, required: true },
  targetText: { type: String, default: '全体好汉' }
})

defineEmits(['load-messages', 'mention-agent', 'send-message', 'update:draft'])

const messageBoxRef = ref(null)

watch(() => props.messages, () => {
  nextTick(() => {
    if (messageBoxRef.value) {
      messageBoxRef.value.scrollTop = messageBoxRef.value.scrollHeight
    }
  })
}, { deep: true })
</script>

<style scoped>
.chat-panel {
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

.mention-strip {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
  padding: 0 14px 12px;
  overflow-x: auto;
}

.mention-strip button {
  flex: 0 0 auto;
  min-height: 32px;
  padding: 0 10px;
  border: 1px solid #d7c3a2;
  border-radius: 8px;
  background: #fff8e8;
  color: #6d3f1f;
  white-space: nowrap;
}

.mention-strip button.active {
  border-color: #b93622;
  background: #b93622;
  color: #fff8e8;
}

.hall-messages {
  flex: 1;
  min-height: 0;
  padding: 0 14px;
  overflow: auto;
}

.hall-message {
  max-width: 86%;
  margin: 0 0 10px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #f7ecd7;
}

.hall-message.USER {
  margin-left: auto;
  background: #dceadf;
}

.hall-message.SYSTEM {
  max-width: 100%;
  background: #eee5d7;
}

.hall-message p {
  margin: 4px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.hall-input {
  display: grid;
  grid-template-columns: 1fr 44px;
  gap: 8px;
  padding: 12px 14px 14px;
}

.hall-input input {
  min-width: 0;
  height: 42px;
  padding: 0 12px;
  border: 1px solid #d7c3a2;
  border-radius: 8px;
  background: #fffdf6;
  color: #2f261c;
  outline: none;
}

.hall-input button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  min-height: 42px;
  border-radius: 8px;
  background: #6d3f1f;
  color: #fff8e8;
}

.empty-list {
  padding: 16px;
  color: #765f40;
}

@media (max-width: 620px) {
  .panel-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
