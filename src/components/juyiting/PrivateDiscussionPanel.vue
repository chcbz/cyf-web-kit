<template>
  <section class="private-discussion-panel discussion-panel">
    <div class="discussion-brief">
      <var-icon name="account-circle" />
      <div>
        <strong>密议</strong>
        <small>{{ privateSubtitle }}</small>
      </div>
    </div>
    <ChatPanel
      v-model:draft="draftProxy"
      discussion-variant="private"
      empty-text="尚无密议记录，可先问一声眼下动静。"
      placeholder="向当前好汉传一句话"
      :show-target-picker="false"
      :subtitle="privateSubtitle"
      title="密议"
      :voice="voice"
      v-bind="chatProps"
      @clear-target="$emit('clear-target', $event)"
      @load-messages="$emit('load-messages')"
      @mention-agent="$emit('mention-agent', $event)"
      @new-conversation="$emit('new-conversation')"
      @send-message="$emit('send-message')"
      @voice-apply="$emit('voice-apply', $event)"
    />
  </section>
</template>

<script setup>
import { computed } from 'vue'
import ChatPanel from './ChatPanel.vue'

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
  scopeHint: { type: String, default: '' },
  targetText: { type: String, default: '' },
  voice: { type: Object, default: null }
})

const emit = defineEmits([
  'clear-target',
  'load-messages',
  'mention-agent',
  'new-conversation',
  'send-message',
  'update:draft',
  'voice-apply'
])

const draftProxy = computed({
  get: () => props.draft,
  set: value => emit('update:draft', value)
})

const privateSubtitle = computed(() => {
  if (props.selectedTask?.title) return `${props.targetText} / ${props.selectedTask.title}`
  return props.targetText || '当前好汉'
})

const chatProps = computed(() => ({
  agents: props.agents,
  connectionStatus: props.connectionStatus,
  eventStreamRecovering: props.eventStreamRecovering,
  isAwaitingReply: props.isAwaitingReply,
  isStreaming: props.isStreaming,
  mentionLabel: props.mentionLabel,
  messages: props.messages,
  pendingAgentName: props.pendingAgentName,
  selectedAgent: props.selectedAgent,
  selectedTask: props.selectedTask,
  senderText: props.senderText,
  scopeHint: props.scopeHint,
  targetText: props.targetText
}))
</script>

<style scoped>
.discussion-panel {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  background: #fffaf0;
}

.discussion-brief {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid rgba(124, 31, 27, 0.14);
  background: #f7ecd7;
  color: #3f2815;
}

.discussion-brief :deep(.var-icon) {
  align-self: center;
  color: #7c1f1b;
  font-size: 24px;
}

.discussion-brief strong,
.discussion-brief small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.discussion-brief small {
  margin-top: 3px;
  color: #765f40;
  font-size: 12px;
}
</style>
