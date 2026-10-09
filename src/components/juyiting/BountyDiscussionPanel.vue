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
      @update:draft="$emit('update:draft', $event)"
      discussion-variant="bounty"
      empty-text="此榜文尚无议事记录，先说清险处、分工与下一步。"
      placeholder="就当前榜文发起议事"
      :subtitle="bountySubtitle"
      title="榜文议事"
      v-bind="chatProps"
      @cancel-deliberation="$emit('cancel-deliberation', $event)"
      @clear-target="$emit('clear-target', $event)"
      @delete-conversation="$emit('delete-conversation', $event)"
      @load-history="$emit('load-history')"
      @load-more-history="$emit('load-more-history')"
      @load-messages="$emit('load-messages')"
      @mention-agent="$emit('mention-agent', $event)"
      @new-conversation="$emit('new-conversation')"
      @open-workspace="$emit('open-workspace')"
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
import { discussionPanelProps, discussionPanelEmits } from './discussionPanelContract.js'
import BountyDeliberationStatus from './BountyDeliberationStatus.vue'
import BountyExecutionTermination from './BountyExecutionTermination.vue'
import BountyExecutionOutputs from './BountyExecutionOutputs.vue'
import { bountyDeliberationPresentation } from '../../composables/juyiting/hallMultimediaDeliberationUi.js'

const props = defineProps({
  ...discussionPanelProps,
  activeRequest: { type: Object, default: null },
  requestCatalog: { type: Array, default: () => [] },
  activeTurns: { type: Array, default: () => [] },
  capabilityState: { type: Object, default: null },
  deliberationV2Enabled: { type: Boolean, default: false },
  typedOutcomes: { type: Array, default: () => [] },
  typedPendingQuestion: { type: Object, default: null },
  typedEnabled: { type: Boolean, default: false },
  typedRecoveryAvailable: { type: Boolean, default: false },
  typedInspectionStatus: { type: String, default: '' },
  identityScope: { type: String, default: '' },
})

defineEmits([...discussionPanelEmits, 'execution-settled', 'task-completed', 'typed-reply', 'typed-resume'])

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

const chatProps = computed(() => {
  const {
    activeRequest, requestCatalog, activeTurns, capabilityState, deliberationV2Enabled,
    typedRecoveryAvailable, typedInspectionStatus, ...chat
  } = props
  return chat
})
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
