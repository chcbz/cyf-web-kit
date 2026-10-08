<template>
  <section class="bounty-discussion-panel discussion-panel">
    <BountyDeliberationStatus :presentation="v2Presentation" />
    <BountyExecutionTermination
      :enabled="deliberationV2Enabled"
      :requests="requestCatalog.length ? requestCatalog.map(entry => entry.request) : activeRequest ? [activeRequest] : []"
      :conversation-id="conversationId"
      :identity-key="`${identityEpoch}\u0000${identityScope}`"
      @settled="$emit('execution-settled', $event)"
    />
    <p v-if="typedInspectionStatus" class="typed-inspection-status" role="status">{{ typedInspectionStatus }}</p>
    <button
      v-if="typedRecoveryAvailable"
      type="button"
      class="typed-recovery"
      @click="$emit('typed-resume')"
    >刷新处理状态</button>
    <ChatPanel
      v-model:draft="draftProxy"
      discussion-variant="bounty"
      empty-text="此榜文尚无议事记录，先说清险处、分工与下一步。"
      placeholder="就当前榜文发起议事"
      :subtitle="bountySubtitle"
      title="榜文议事"
      :voice="voice"
      :typed-outcomes="typedOutcomes"
      :typed-pending-question="typedPendingQuestion"
      :typed-enabled="typedEnabled"
      v-bind="chatProps"
      @cancel-deliberation="$emit('cancel-deliberation', $event)"
      @cancel-legacy-transport="$emit('cancel-legacy-transport')"
      @clear-target="$emit('clear-target', $event)"
      @delete-conversation="$emit('delete-conversation', $event)"
      @load-history="$emit('load-history')"
      @load-more-history="$emit('load-more-history')"
      @load-messages="$emit('load-messages')"
      @mention-agent="$emit('mention-agent', $event)"
      @new-conversation="$emit('new-conversation')"
      @open-workspace="$emit('open-workspace')"
      @open-maintenance-job="$emit('open-maintenance-job', $event)"
      @open-archive-edition="$emit('open-archive-edition', $event)"
      @retry-conversation="$emit('retry-conversation')"
      @select-conversation="$emit('select-conversation', $event)"
      @send-message="$emit('send-message', $event)"
      @voice-apply="$emit('voice-apply', $event)"
      @typed-reply="$emit('typed-reply', $event)"
    >
      <template #bounty-results>
        <BountyExecutionOutputs
          :enabled="deliberationV2Enabled"
          :task-completed="selectedTask?.status === 'completed'"
          :request="activeRequest"
          :catalog="requestCatalog"
          :conversation-id="conversationId"
          :identity-key="`${identityEpoch}\u0000${identityScope}`"
          :task-version="selectedTask?.taskVersion ?? selectedTask?.version"
          @task-completed="$emit('task-completed', $event)"
        />
      </template>
    </ChatPanel>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import ChatPanel from './ChatPanel.vue'
import BountyDeliberationStatus from './BountyDeliberationStatus.vue'
import BountyExecutionTermination from './BountyExecutionTermination.vue'
import BountyExecutionOutputs from './BountyExecutionOutputs.vue'
import { bountyDeliberationPresentation } from '../../composables/juyiting/hallMultimediaDeliberationUi.js'

const props = defineProps({
  activeRequest: { type: Object, default: null },
  requestCatalog: { type: Array, default: () => [] },
  activeTurns: { type: Array, default: () => [] },
  agents: { type: Array, default: () => [] },
  capabilityState: { type: Object, default: null },
  connectionStatus: { type: String, default: '' },
  conversationHistory: { type: Array, default: () => [] },
  conversationHistoryDeletingId: { type: String, default: '' },
  conversationHistoryError: { type: String, default: '' },
  conversationHistoryHasMore: { type: Boolean, default: false },
  conversationHistoryLoading: { type: Boolean, default: false },
  conversationLoadError: { type: String, default: '' },
  conversationBusy: { type: Boolean, default: false },
  deliberationStatus: { type: String, default: '' },
  deliberationV2Enabled: { type: Boolean, default: false },
  typedOutcomes: { type: Array, default: () => [] },
  typedPendingQuestion: { type: Object, default: null },
  typedEnabled: { type: Boolean, default: false },
  typedRecoveryAvailable: { type: Boolean, default: false },
  typedInspectionStatus: { type: String, default: '' },
  durableCancelTarget: { type: Object, default: null },
  legacyCancelAvailable: { type: Boolean, default: false },
  conversationId: { type: String, default: '' },
  identityEpoch: { type: [Number, String], default: 0 },
  identityScope: { type: String, default: '' },
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
  'execution-settled',
  'cancel-deliberation',
  'cancel-legacy-transport',
  'clear-target',
  'delete-conversation',
  'load-history',
  'load-more-history',
  'load-messages',
  'mention-agent',
  'new-conversation',
  'open-workspace',
  'open-maintenance-job',
  'open-archive-edition',
  'retry-conversation',
  'select-conversation',
  'send-message',
  'task-completed',
  'update:draft',
  'voice-apply',
  'typed-reply',
  'typed-resume'
])

const draftProxy = computed({
  get: () => props.draft,
  set: value => emit('update:draft', value)
})

const v2Presentation = computed(() => bountyDeliberationPresentation({
  enabled: props.deliberationV2Enabled,
  capability: props.capabilityState,
  request: props.activeRequest,
  turns: props.activeTurns,
  messages: props.messages
}))

const bountySubtitle = computed(() => {
  const taskName = props.selectedTask?.title || props.selectedTask?.id || '当前榜文'
  const countText = props.agents.length ? ` / ${props.agents.length} 位领令好汉` : ''
  return `${taskName}${countText}`
})

const chatProps = computed(() => ({
  agents: props.agents,
  connectionStatus: props.connectionStatus,
  conversationHistory: props.conversationHistory,
  conversationHistoryDeletingId: props.conversationHistoryDeletingId,
  conversationHistoryError: props.conversationHistoryError,
  conversationHistoryHasMore: props.conversationHistoryHasMore,
  conversationHistoryLoading: props.conversationHistoryLoading,
  conversationLoadError: props.conversationLoadError,
  conversationBusy: props.conversationBusy,
  deliberationStatus: props.deliberationStatus,
  durableCancelTarget: props.durableCancelTarget,
  legacyCancelAvailable: props.legacyCancelAvailable,
  conversationId: props.conversationId,
  identityEpoch: props.identityEpoch,
  identityScope: props.identityScope,
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
.typed-recovery { align-self: flex-end; margin: 6px 12px 0; border: 1px solid #6b8d7e; border-radius: 5px; padding: 5px 8px; color: #294c3d; background: #fff; }

.discussion-panel {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  background: #fffaf0;
}

</style>

<style scoped>
.typed-inspection-status{margin:8px 0;padding:8px 10px;border-left:3px solid #6f8c81;background:#f3f8f4;color:#3f6254;font-size:12px;line-height:1.5}
</style>
