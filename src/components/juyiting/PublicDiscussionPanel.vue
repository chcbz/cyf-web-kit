<template>
  <section class="public-discussion-panel discussion-panel">
    <div class="discussion-brief">
      <var-icon name="message-text-outline" />
      <div>
        <strong>厅前公议</strong>
        <small>厅前面向众好汉，未点名时由宋江分拨。</small>
      </div>
    </div>
    <ChatPanel
      v-model:draft="draftProxy"
      discussion-variant="public"
      empty-text="厅前暂无话头，先发一句请众好汉接话。"
      placeholder="向众好汉传话，或 @某位好汉"
      subtitle="厅前公议"
      title="厅前公议"
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
  scopeHint: { type: String, default: 'public' },
  targetText: { type: String, default: '众好汉' },
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
  border-bottom: 1px solid rgba(116, 75, 35, 0.12);
  background: #f5ead6;
  color: #3f2815;
}

.discussion-brief :deep(.var-icon) {
  align-self: center;
  color: #7f4a22;
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
