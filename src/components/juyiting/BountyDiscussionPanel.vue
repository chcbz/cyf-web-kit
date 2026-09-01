<template>
  <section class="bounty-discussion-panel discussion-panel">
    <div class="discussion-brief">
      <var-icon name="format-list-checkbox" />
      <div>
        <strong>榜文议事</strong>
        <small>{{ bountySubtitle }}</small>
      </div>
    </div>
    <ChatPanel
      v-model:draft="draftProxy"
      discussion-variant="bounty"
      empty-text="此榜文尚无议事记录，先说清险处、分工与下一步。"
      placeholder="就当前榜文发起议事"
      :subtitle="bountySubtitle"
      title="榜文议事"
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

const bountySubtitle = computed(() => {
  const taskName = props.selectedTask?.title || props.selectedTask?.id || '当前榜文'
  const countText = props.agents.length ? ` / ${props.agents.length} 位领令好汉` : ''
  return `${taskName}${countText}`
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
  border-bottom: 1px solid rgba(35, 72, 62, 0.16);
  background: #e8f2ed;
  color: #213d34;
}

.discussion-brief :deep(.var-icon) {
  align-self: center;
  color: #23483e;
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
  color: #4f6c61;
  font-size: 12px;
}
</style>
