<template>
  <div class="chat-panel discussion-surface" :class="`discussion-${discussionVariant}`">
    <div class="panel-toolbar">
      <div class="context-summary">
        <strong>{{ title }}</strong>
        <small>{{ resolvedSubtitle }}</small>
        <em>{{ displayStatus }}</em>
      </div>
      <div class="toolbar-actions">
        <button class="icon-button" type="button" title="同步" aria-label="同步" @click="$emit('load-messages')">
          <var-icon name="refresh" />
        </button>
        <button class="icon-button primary" type="button" title="新建会话" aria-label="新建会话" @click="$emit('new-conversation')">
          <var-icon name="plus" />
        </button>
      </div>
    </div>

    <div v-if="showTargetPicker && agents.length" class="discussion-target-controls">
      <button
        class="target-toggle"
        type="button"
        title="选择目标"
        aria-label="选择目标"
        :class="{ active: showTargets }"
        @click="showTargets = !showTargets"
      >
        <var-icon name="account-circle" />
        <span>{{ targetBadgeText }}</span>
      </button>
    </div>

    <div v-if="showTargets && agents.length" class="compact-mention-strip" aria-label="选择要提及的地图人物">
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
        :class="[message.sender, { 'is-streaming': message.streaming }]"
      >
        <div class="message-head">
          <strong>{{ senderText(message) }}</strong>
          <span v-if="message.streaming" class="message-state">回话中</span>
        </div>
        <div class="message-content" v-html="renderMarkdown(message.content)"></div>
        <small v-if="message.statusText" class="message-status">{{ message.statusText }}</small>
      </div>
      <div v-if="isAwaitingReply" class="hall-message SYSTEM is-pending">
        <strong>{{ pendingAuthor }}</strong>
        <div class="message-content" v-html="renderMarkdown(pendingLabel)"></div>
      </div>
      <div v-if="!messages.length" class="empty-list">{{ emptyText }}</div>
    </div>

    <form class="hall-input chat-composer" @submit.prevent="$emit('send-message')">
      <input
        :value="draft"
        autofocus
        :disabled="isStreaming"
        :placeholder="placeholder"
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
import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.setOptions({
  breaks: true,
  gfm: true,
  headerIds: false,
  sanitize: false
})

const props = defineProps({
  agents: { type: Array, default: () => [] },
  connectionStatus: { type: String, default: '' },
  discussionVariant: { type: String, default: 'public' },
  draft: { type: String, default: '' },
  emptyText: { type: String, default: '厅中暂无议事，发起一句开始讨论。' },
  eventStreamRecovering: { type: Boolean, default: false },
  isAwaitingReply: { type: Boolean, default: false },
  isStreaming: { type: Boolean, default: false },
  mentionLabel: { type: Function, required: true },
  messages: { type: Array, default: () => [] },
  pendingAgentName: { type: String, default: '' },
  placeholder: { type: String, default: '向聚义厅发起议事，或 @某位好汉' },
  selectedAgent: { type: Object, default: null },
  selectedTask: { type: Object, default: null },
  senderText: { type: Function, required: true },
  showTargetPicker: { type: Boolean, default: true },
  scopeHint: { type: String, default: 'public' },
  subtitle: { type: String, default: '' },
  title: { type: String, default: '议事' },
  targetText: { type: String, default: '全体好汉' }
})

defineEmits([
  'load-messages',
  'mention-agent',
  'new-conversation',
  'send-message',
  'update:draft'
])

const messageBoxRef = ref(null)
const showTargets = ref(false)
const pendingAuthor = '聚义厅'
const taskText = computed(() => props.selectedTask?.title || '未选悬赏')
const resolvedSubtitle = computed(() => {
  if (props.subtitle) return props.subtitle
  if (props.discussionVariant === 'bounty') return taskText.value
  if (props.discussionVariant === 'private') return props.targetText
  if (props.selectedTask) return taskText.value
  if (props.selectedAgent) return props.targetText
  return props.scopeHint === 'public' ? '未 @ 时交由宋江分流' : props.scopeHint
})
const targetBadgeText = computed(() => {
  if (props.selectedAgent) return mentionLabel(props.selectedAgent)
  if (props.discussionVariant === 'bounty') return `${props.agents.length} 人`
  return '@'
})
const displayStatus = computed(() => {
  if (props.eventStreamRecovering) return '正在尝试恢复回话'
  return props.connectionStatus || (props.isAwaitingReply ? pendingLabel.value : '实时同步中')
})
const pendingLabel = computed(() => {
  if (props.pendingAgentName) return `${props.pendingAgentName} 正在回话...`
  return '正在整理回报...'
})
const renderMarkdown = (content = '') => DOMPurify.sanitize(marked(String(content || '')))

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
  padding: 8px 10px 6px;
  border-bottom: 1px solid rgba(116, 75, 35, 0.12);
  color: #765f40;
  font-size: 12px;
}

.context-summary {
  display: flex;
  flex: 1 1 auto;
  align-items: baseline;
  min-width: 0;
  gap: 8px;
}

.context-summary strong {
  flex: 0 0 auto;
  color: #3f2815;
  font-size: 14px;
  font-weight: 700;
  white-space: nowrap;
}

.context-summary small,
.context-summary em {
  max-width: 100%;
  overflow: hidden;
  color: #8a6f4b;
  font-size: 12px;
  font-style: normal;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-summary em {
  flex: 0 0 auto;
  color: #9a6e40;
}

.toolbar-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
  min-width: 0;
}

.icon-button,
.target-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border-radius: 8px;
  background: #efe0c6;
  color: #4a3423;
  white-space: nowrap;
}

.icon-button.primary {
  background: #6d3f1f;
  color: #fff8e8;
}

.discussion-target-controls {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  padding: 6px 10px 8px;
  overflow-x: auto;
}

.target-toggle {
  border: 1px solid #d7c3a2;
  background: #fffdf6;
  color: #5b432a;
}

.target-toggle.active {
  border-color: #23483e;
  background: #23483e;
  color: #fff8e8;
}

.target-toggle {
  width: auto;
  max-width: 120px;
  gap: 4px;
  padding: 0 8px;
  font-size: 12px;
}

.target-toggle span {
  overflow: hidden;
  text-overflow: ellipsis;
}

.compact-mention-strip {
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
  padding: 0 10px 8px;
  overflow-x: auto;
}

.compact-mention-strip button {
  flex: 0 0 auto;
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid #d7c3a2;
  border-radius: 999px;
  background: #fffdf6;
  color: #5b432a;
  white-space: nowrap;
}

.compact-mention-strip button.active {
  border-color: #7f4a22;
  background: #7f4a22;
  color: #fff8e8;
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

.message-content {
  max-width: 100%;
  overflow-wrap: anywhere;
  word-break: break-word;
  line-height: 1.55;
}

.message-content :deep(*) {
  max-width: 100%;
}

.message-content :deep(p),
.message-content :deep(ul),
.message-content :deep(ol),
.message-content :deep(blockquote),
.message-content :deep(pre),
.message-content :deep(table) {
  margin: 0 0 8px;
}

.message-content :deep(:first-child) {
  margin-top: 0;
}

.message-content :deep(:last-child) {
  margin-bottom: 0;
}

.message-content :deep(ul),
.message-content :deep(ol) {
  padding-left: 20px;
}

.message-content :deep(li + li) {
  margin-top: 3px;
}

.message-content :deep(a) {
  color: #7f4a22;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.message-content :deep(code) {
  padding: 1px 4px;
  border-radius: 4px;
  background: rgba(127, 74, 34, 0.1);
  color: #3f2815;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.92em;
}

.message-content :deep(pre) {
  overflow-x: auto;
  padding: 8px 10px;
  border: 1px solid rgba(116, 75, 35, 0.16);
  border-radius: 8px;
  background: #f5ead6;
  white-space: pre;
}

.message-content :deep(pre code) {
  padding: 0;
  background: transparent;
  white-space: pre;
}

.message-content :deep(blockquote) {
  padding-left: 10px;
  border-left: 3px solid #c8a96e;
  color: #765f40;
}

.message-content :deep(table) {
  display: block;
  overflow-x: auto;
  border-collapse: collapse;
}

.message-content :deep(th),
.message-content :deep(td) {
  padding: 5px 8px;
  border: 1px solid rgba(116, 75, 35, 0.2);
}

.message-content :deep(th) {
  background: #f5ead6;
  font-weight: 700;
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

  .context-summary {
    gap: 6px;
  }

  .context-summary em {
    display: none;
  }

  .hall-message {
    max-width: 94%;
  }
}
</style>
