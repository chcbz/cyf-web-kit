<template>
  <div class="chat-panel">
    <div class="panel-toolbar">
      <span>厅内传令会带上当前好汉和悬赏上下文。</span>
      <button @click="$emit('load-messages')">同步</button>
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
        :disabled="isStreaming"
        placeholder="向聚义厅发令，或 @某位好汉"
        @input="$emit('update:draft', $event.target.value.trim())"
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
  draft: { type: String, default: '' },
  isStreaming: { type: Boolean, default: false },
  messages: { type: Array, default: () => [] },
  senderText: { type: Function, required: true }
})

defineEmits(['load-messages', 'send-message', 'update:draft'])

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
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 16px 14px;
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

.hall-messages {
  flex: 1;
  min-height: 260px;
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

@media (max-width: 900px) {
  .hall-messages {
    min-height: 320px;
  }
}

@media (max-width: 620px) {
  .panel-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
