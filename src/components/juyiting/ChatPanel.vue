<template>
  <div class="chat-panel">
    <div class="panel-toolbar">
      <div class="toolbar-meta">
        <span>对话对象：{{ targetText }}</span>
        <span>当前悬赏：{{ taskText }}</span>
        <span class="panel-status">{{ displayStatus }}</span>
      </div>
      <div class="toolbar-actions">
        <button class="new-chat" type="button" @click="$emit('new-conversation')">新建聚义会话</button>
        <button type="button" @click="$emit('load-messages')">同步</button>
      </div>
    </div>

    <div v-if="agents.length" class="mention-strip" aria-label="选择要提及的地图人物">
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

    <div class="command-groups" aria-label="传令快捷模板">
      <div class="command-group command-templates">
        <span>议事</span>
        <button
          v-for="template in commandTemplates"
          :key="template.key"
          type="button"
          @click="$emit('apply-template', template.key)"
        >
          {{ template.label }}
        </button>
      </div>
    </div>

    <div ref="messageBoxRef" class="hall-messages">
      <div
        v-for="message in messages"
        :key="message.localId || message.timestamp"
        class="hall-message"
        :class="[message.sender, { 'is-streaming': message.streaming }]"
      >
        <div class="message-head">
          <strong>{{ senderText(message) }}</strong>
          <span v-if="message.streaming" class="message-state">回话中</span>
        </div>
        <p>{{ message.content }}</p>
        <small v-if="message.statusText" class="message-status">{{ message.statusText }}</small>
      </div>
      <div v-if="isAwaitingReply" class="hall-message SYSTEM is-pending">
        <strong>{{ pendingAuthor }}</strong>
        <p>{{ pendingLabel }}</p>
      </div>
      <div v-if="!messages.length" class="empty-list">厅中暂无传令，发起一句开始议事。</div>
    </div>

    <form class="hall-input chat-composer" @submit.prevent="$emit('send-message')">
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
import { computed, nextTick, ref, watch } from 'vue'

const props = defineProps({
  agents: { type: Array, default: () => [] },
  connectionStatus: { type: String, default: '' },
  draft: { type: String, default: '' },
  eventStreamRecovering: { type: Boolean, default: false },
  isAwaitingReply: { type: Boolean, default: false },
  isStreaming: { type: Boolean, default: false },
  mentionLabel: { type: Function, required: true },
  messages: { type: Array, default: () => [] },
  pendingAgentName: { type: String, default: '' },
  selectedAgent: { type: Object, default: null },
  selectedTask: { type: Object, default: null },
  senderText: { type: Function, required: true },
  targetText: { type: String, default: '全体好汉' }
})

defineEmits([
  'apply-template',
  'load-messages',
  'mention-agent',
  'new-conversation',
  'send-message',
  'update:draft'
])

const messageBoxRef = ref(null)
const pendingAuthor = '聚义厅'
const commandTemplates = [
  { key: 'status', label: '汇报状态' },
  { key: 'risk', label: '评估风险' },
  { key: 'confirm', label: '接令确认' }
]
const taskText = computed(() => props.selectedTask?.title || '未选悬赏')
const displayStatus = computed(() => {
  if (props.eventStreamRecovering) return '正在尝试恢复回话'
  return props.connectionStatus || (props.isAwaitingReply ? pendingLabel.value : '实时同步中')
})
const pendingLabel = computed(() => {
  if (props.pendingAgentName) return `${props.pendingAgentName} 正在回话...`
  return '正在整理回报...'
})

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
  background: #fffaf0;
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
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(116, 75, 35, 0.12);
  color: #765f40;
  font-size: 12px;
}

.toolbar-meta {
  display: flex;
  flex: 1 1 260px;
  min-width: 0;
  flex-wrap: wrap;
  gap: 6px;
}

.toolbar-meta span {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  min-height: 26px;
  padding: 0 8px;
  overflow: hidden;
  border-radius: 8px;
  background: #f5ead6;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-status {
  color: #9a6e40;
}

.toolbar-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
  min-width: 0;
}

.panel-toolbar button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  background: #efe0c6;
  color: #4a3423;
  font-size: 12px;
  white-space: nowrap;
}

.panel-toolbar .new-chat {
  background: #6d3f1f;
  color: #fff8e8;
}

.mention-strip {
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
  padding: 8px 12px 6px;
  overflow-x: auto;
}

.mention-strip button {
  flex: 0 0 auto;
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid #d7c3a2;
  border-radius: 999px;
  background: #fffdf6;
  color: #5b432a;
  white-space: nowrap;
}

.mention-strip button.active {
  border-color: #7f4a22;
  background: #7f4a22;
  color: #fff8e8;
}

.command-groups {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
  padding: 0 12px 8px;
  overflow-x: auto;
}

.command-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.command-group span {
  color: #8a6f4b;
  font-size: 12px;
  white-space: nowrap;
}

.command-group button {
  flex: 0 0 auto;
  min-height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  background: #23483e;
  color: #fff8e8;
  white-space: nowrap;
}

.hall-messages {
  flex: 1;
  min-height: 0;
  padding: 14px 16px;
  overflow-y: auto;
  background:
    linear-gradient(180deg, rgba(239, 224, 198, 0.44), rgba(255, 250, 240, 0) 82px),
    #fbf3e4;
}

.hall-message {
  max-width: 88%;
  margin-bottom: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #fff8e8;
  color: #4a3423;
  box-shadow: 0 1px 0 rgba(71, 44, 23, 0.08);
}

.hall-message.USER {
  margin-left: auto;
  background: #e8f2ed;
}

.hall-message.AGENT,
.hall-message.SYSTEM {
  margin-right: auto;
  background: #fffdf6;
}

.hall-message.is-pending {
  border: 1px dashed #c8a96e;
}

.hall-message.is-streaming {
  box-shadow: inset 3px 0 0 #7f4a22;
}

.message-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.message-head strong {
  font-size: 13px;
}

.message-state,
.message-status {
  color: #8a6f4b;
  font-size: 12px;
}

.hall-message p {
  margin: 0;
  line-height: 1.55;
  white-space: pre-wrap;
}

.empty-list {
  display: grid;
  min-height: 140px;
  place-items: center;
  color: #a88b62;
  font-size: 13px;
  text-align: center;
}

.hall-input {
  display: grid;
  flex: 0 0 auto;
  grid-template-columns: minmax(0, 1fr) 44px;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid rgba(116, 75, 35, 0.16);
  background: #fffaf0;
}

.hall-input input {
  min-width: 0;
  height: 44px;
  padding: 0 12px;
  border: 1px solid #d7c3a2;
  border-radius: 8px;
  background: #fffdf6;
  color: #3f2815;
  font: inherit;
  outline: none;
}

.hall-input button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: #7f4a22;
  color: #fff8e8;
}

@media (max-width: 640px) {
  .panel-toolbar {
    align-items: center;
  }

  .toolbar-actions {
    width: 100%;
  }

  .toolbar-actions button {
    flex: 1 1 0;
  }

  .hall-message {
    max-width: 94%;
  }
}
</style>
