<template>
  <section class="bounty-discussion-panel discussion-panel">
    <div class="discussion-brief">
      <var-icon name="format-list-checkbox" />
      <div>
        <strong>榜文议事</strong>
        <small>{{ bountySubtitle }}</small>
      </div>
    </div>
    <BountyDeliberationStatus :presentation="v2Presentation" />
    <button v-if="typedRecoveryAvailable" type="button" class="typed-recovery" @click="$emit('typed-resume')">按原键继续未确认议事</button>
    <BountyFollowupConsentPanel
      :enabled="followupExecuteEnabled"
      :state="followupState"
      :busy="followupBusy"
      @confirm="$emit('confirm-followup', $event)"
      @check-original="$emit('check-followup-original', $event)"
    />
    <ChatPanel
      v-model:draft="draftProxy"
      discussion-variant="bounty"
      empty-text="此榜文尚无议事记录，先说清险处、分工与下一步。"
      placeholder="就当前榜文发起议事"
      :subtitle="bountySubtitle"
      title="榜文议事"
      :voice="voice"
      :execute-enabled="followupExecuteEnabled"
      :typed-outcomes="typedOutcomes"
      :typed-pending-question="typedPendingQuestion"
      :typed-enabled="typedEnabled"
      v-bind="chatProps"
      @cancel-deliberation="$emit('cancel-deliberation', $event)"
      @cancel-legacy-transport="$emit('cancel-legacy-transport')"
      @clear-target="$emit('clear-target', $event)"
      @delete-conversation="$emit('delete-conversation', $event)"
      @execute-followup="$emit('execute-followup')"
      @load-history="$emit('load-history')"
      @load-more-history="$emit('load-more-history')"
      @load-messages="$emit('load-messages')"
      @mention-agent="$emit('mention-agent', $event)"
      @new-conversation="$emit('new-conversation')"
      @open-workspace="$emit('open-workspace')"
      @retry-conversation="$emit('retry-conversation')"
      @select-conversation="$emit('select-conversation', $event)"
      @send-message="$emit('send-message')"
      @voice-apply="$emit('voice-apply', $event)"
      @typed-reply="$emit('typed-reply', $event)"
      @typed-confirm-proposal="$emit('typed-confirm-proposal', $event)"
    >
      <template #bounty-results>
        <BountyExecutionOutputs
          :enabled="deliberationV2Enabled"
          :followup-enabled="followupExecuteEnabled"
          :request="activeRequest"
          :catalog="requestCatalog"
          :conversation-id="conversationId"
          :identity-key="`${identityEpoch}\u0000${identityScope}`"
          :task-version="selectedTask?.taskVersion ?? selectedTask?.version"
          @request-followup-edit="$emit('request-followup-edit', $event)"
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
import BountyExecutionOutputs from './BountyExecutionOutputs.vue'
import BountyFollowupConsentPanel from './BountyFollowupConsentPanel.vue'
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
  followupExecuteEnabled: { type: Boolean, default: false },
  followupState: { type: Object, default: () => ({ status: 'IDLE' }) },
  followupBusy: { type: Boolean, default: false },
  typedOutcomes: { type: Array, default: () => [] },
  typedPendingQuestion: { type: Object, default: null },
  typedEnabled: { type: Boolean, default: false },
  typedRecoveryAvailable: { type: Boolean, default: false },
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
  'cancel-deliberation',
  'cancel-legacy-transport',
  'clear-target',
  'delete-conversation',
  'execute-followup',
  'confirm-followup',
  'check-followup-original',
  'request-followup-edit',
  'load-history',
  'load-more-history',
  'load-messages',
  'mention-agent',
  'new-conversation',
  'open-workspace',
  'retry-conversation',
  'select-conversation',
  'send-message',
  'task-completed',
  'update:draft',
  'voice-apply',
  'typed-reply',
  'typed-confirm-proposal',
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
