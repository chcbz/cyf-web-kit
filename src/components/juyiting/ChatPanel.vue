<template>
  <div class="chat-panel">
    <div class="panel-toolbar">
      <div class="toolbar-meta">
        <span>对话对象：{{ targetText }}</span>
        <span>当前悬赏：{{ taskText }}</span>
        <span class="panel-status">{{ connectionStatus || (isAwaitingReply ? pendingLabel : '实时同步中') }}</span>
      </div>
      <div class="toolbar-actions">
        <button class="new-chat" type="button" @click="$emit('new-conversation')">新建聚义会话</button>
        <button type="button" @click="$emit('load-messages')">同步</button>
      </div>
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
      <div class="command-group chief-templates">
        <span>宋江号令</span>
        <button
          v-for="template in chiefTemplates"
          :key="template.key"
          type="button"
          @click="$emit('apply-template', template.key)"
        >
          {{ template.label }}
        </button>
      </div>
    </div>
    <div v-if="agents.length" class="coordination-inline" aria-label="协同会办">
      <label>
        <span>发话</span>
        <select v-model="relayFromAgentId">
          <option value="">请选择</option>
          <option v-for="agent in agents" :key="`from-${agent.agentId}`" :value="agent.agentId">
            {{ agentName(agent) }}
          </option>
        </select>
      </label>
      <label>
        <span>接话</span>
        <select v-model="relayToAgentId">
          <option value="">请选择</option>
          <option v-for="agent in agents" :key="`to-${agent.agentId}`" :value="agent.agentId">
            {{ agentName(agent) }}
          </option>
        </select>
      </label>
      <input v-model="relayMessage" placeholder="转达内容或协同要求" />
      <button type="button" :disabled="!canRelay" @click="emitRelay">互相传话</button>
      <button type="button" :disabled="!canCoordinate" @click="emitCoordinate">配合办事</button>
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
import { computed, nextTick, ref, watch } from 'vue'

const props = defineProps({
  agents: { type: Array, default: () => [] },
  connectionStatus: { type: String, default: '' },
  draft: { type: String, default: '' },
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

const emit = defineEmits([
  'apply-template',
  'coordinate-work',
  'load-messages',
  'mention-agent',
  'new-conversation',
  'relay-message',
  'send-message',
  'update:draft'
])

const messageBoxRef = ref(null)
const relayFromAgentId = ref('')
const relayToAgentId = ref('')
const relayMessage = ref('')
const pendingAuthor = '聚义厅'
const commandTemplates = [
  { key: 'status', label: '汇报状态' },
  { key: 'risk', label: '评估风险' },
  { key: 'confirm', label: '接令确认' }
]
const chiefTemplates = [
  { key: 'reviewBounties', label: '巡检悬赏' },
  { key: 'reviewRoster', label: '整备名册' },
  { key: 'broadcastOrder', label: '全厅传令' },
  { key: 'summonReport', label: '收拢回报' }
]
const taskText = computed(() => props.selectedTask?.title || '未选悬赏')
const canRelay = computed(() => relayFromAgentId.value && relayToAgentId.value && relayMessage.value.trim())
const canCoordinate = computed(() => relayFromAgentId.value && relayToAgentId.value && props.selectedTask)
const pendingLabel = computed(() => {
  if (props.pendingAgentName) return `${props.pendingAgentName} 正在回话...`
  return '正在整理回报...'
})

const agentName = (agent) => agent?.name || agent?.personaName || agent?.agentId || ''

const coordinationPayload = () => ({
  fromAgentId: relayFromAgentId.value,
  toAgentId: relayToAgentId.value,
  message: relayMessage.value.trim()
})

const emitRelay = () => {
  if (!canRelay.value) return
  emit('relay-message', coordinationPayload())
}

const emitCoordinate = () => {
  if (!canCoordinate.value) return
  emit('coordinate-work', coordinationPayload())
}

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
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px;
  color: #765f40;
  font-size: 13px;
}

.toolbar-meta {
  display: grid;
  gap: 4px;
}

.panel-status {
  color: #9a6e40;
  font-size: 12px;
}

.toolbar-actions {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  min-width: 132px;
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

.panel-toolbar .new-chat {
  background: #6d3f1f;
  color: #fff8e8;
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

.command-groups {
  display: grid;
  flex: 0 0 auto;
  gap: 8px;
  padding: 0 14px 12px;
}

.command-group {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
}

.command-group > span {
  flex: 0 0 auto;
  color: #8a6f4b;
  font-size: 12px;
  font-weight: 700;
}

.command-group button {
  flex: 0 0 auto;
  min-height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  background: #23483e;
  color: #fff8e8;
  white-space: nowrap;
}

.coordination-inline {
  display: grid;
  flex: 0 0 auto;
  grid-template-columns: 120px 120px minmax(160px, 1fr) auto auto;
  gap: 8px;
  padding: 0 14px 12px;
}

.coordination-inline label {
  display: grid;
  gap: 4px;
  min-width: 0;
  color: #8a6f4b;
  font-size: 12px;
}

.coordination-inline select,
.coordination-inline input {
  min-width: 0;
  height: 34px;
  padding: 0 9px;
  border: 1px solid #d7c3a2;
  border-radius: 8px;
  background: #fffdf6;
  color: #3f2815;
  font: inherit;
  outline: none;
}

.coordination-inline input {
  align-self: end;
}

.coordination-inline button {
  align-self: end;
  min-height: 34px;
  padding: 0 10px;
  border-radius: 8px;
  background: #6d3f1f;
  color: #fff8e8;
  white-space: nowrap;
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
  transition: background-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}

.hall-message.USER {
  margin-left: auto;
  background: #dceadf;
}

.hall-message.SYSTEM {
  max-width: 100%;
  background: #eee5d7;
}

.hall-message.AGENT {
  background: #eef2dd;
}

.hall-message.is-streaming {
  background: #f3e2be;
  box-shadow: 0 0 0 1px rgba(185, 54, 34, 0.18), 0 10px 24px rgba(109, 63, 31, 0.10);
  transform: translateY(-1px);
}

.message-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.message-state {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(185, 54, 34, 0.12);
  color: #a02d1d;
  font-size: 11px;
  line-height: 1;
  animation: hall-pulse 1.4s ease-in-out infinite;
}

.hall-message.is-streaming::after,
.hall-message.is-pending::after {
  display: inline-block;
  width: 0.7ch;
  margin-left: 3px;
  color: #b93622;
  content: '▎';
  animation: hall-caret 0.8s steps(1) infinite;
}

.hall-message.is-pending {
  opacity: 0.82;
}

.hall-message p {
  margin: 4px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.message-status {
  display: block;
  margin-top: 6px;
  color: #856d4a;
  font-size: 11px;
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

@keyframes hall-caret {
  50% {
    opacity: 0;
  }
}

@keyframes hall-pulse {
  50% {
    background: rgba(185, 54, 34, 0.2);
    transform: translateY(-1px);
  }
}

@media (max-width: 620px) {
  .panel-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .toolbar-actions {
    min-width: 0;
  }

  .coordination-inline {
    grid-template-columns: 1fr;
  }
}
</style>
