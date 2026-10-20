<template>
  <section class="bounty-discussion-panel discussion-panel">
    <BountyDeliberationStatus v-if="!taskCompleted" :presentation="v2Presentation" />
    <BountyExecutionTermination
      :enabled="deliberationV2Enabled && !taskCompleted"
      :requests="requestCatalog.length ? requestCatalog.map(entry => entry.request) : activeRequest ? [activeRequest] : []"
      :conversation-id="conversationId"
      :identity-key="`${identityEpoch}\u0000${identityScope}`"
      @settled="$emit('execution-settled', $event)"
    />
    <p v-if="typedInspectionStatus" class="typed-inspection-status" role="status">{{ typedInspectionStatus }}</p>
    <button
      v-if="typedRecoveryAvailable && !taskCompleted"
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
      <template #after-toolbar>
        <TaskSkillCapabilities v-if="typedEnabled" :projection="skillDirectory" :error="skillDirectoryError" :loading="skillDirectoryLoading" @refresh="$emit('skill-directory-refresh')" />
      </template>
      <template #matter-actions>
        <button
          v-if="!taskCompleted && reviewContext?.currentDelivery?.allowedActions.includes('ACCEPT')"
          type="button"
          class="matter-action"
          aria-label="查看并验收"
          title="查看并验收"
          :disabled="reviewBusy || conversationBusy || voice?.voiceInteractionLocked"
          @click="$emit('review-delivery')"
        ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5h10M9 12h10M9 19h10M3 5l1 1 2-2M3 12l1 1 2-2M3 19l1 1 2-2" /></svg></button>
      </template>
      <template #bounty-results>
        <BountyExecutionOutputs
          :enabled="deliberationV2Enabled"
          :task-completed="taskCompleted"
          :request="activeRequest"
          :catalog="requestCatalog"
          :typed-outcomes="typedOutcomes"
          :task-id="selectedTask?.id || ''"
          :conversation-generation="conversationGeneration"
          :conversation-id="conversationId"
          :identity-key="`${identityEpoch}\u0000${identityScope}`"
          :task-version="selectedTask?.taskVersion ?? selectedTask?.version"
        />
      </template>
    </ChatPanel>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import ChatPanel from './ChatPanel.vue'
import TaskSkillCapabilities from './TaskSkillCapabilities.vue'
import { discussionPanelProps, discussionPanelEmits } from './discussionPanelContract.js'
import BountyDeliberationStatus from './BountyDeliberationStatus.vue'
import BountyExecutionTermination from './BountyExecutionTermination.vue'
import BountyExecutionOutputs from './BountyExecutionOutputs.vue'
import { bountyDeliberationPresentation } from '../../composables/juyiting/hallMultimediaDeliberationUi.js'

const props = defineProps({
  ...discussionPanelProps,
  reviewContext: { type: Object, default: null },
  reviewBusy: { type: Boolean, default: false },
  activeRequest: { type: Object, default: null },
  requestCatalog: { type: Array, default: () => [] },
  activeTurns: { type: Array, default: () => [] },
  capabilityState: { type: Object, default: null },
  deliberationV2Enabled: { type: Boolean, default: false },
  conversationGeneration: { type: String, default: '' },
  typedOutcomes: { type: Array, default: () => [] },
  typedPendingQuestion: { type: Object, default: null },
  typedEnabled: { type: Boolean, default: false },
  skillDirectory: { type: Object, default: null }, skillDirectoryError: { type: String, default: '' }, skillDirectoryLoading: { type: Boolean, default: false },
  typedRecoveryAvailable: { type: Boolean, default: false },
  typedInspectionStatus: { type: String, default: '' },
  identityScope: { type: String, default: '' },
})

defineEmits([...discussionPanelEmits, 'execution-settled', 'review-delivery', 'typed-reply', 'typed-resume', 'skill-directory-refresh'])

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

const taskCompleted = computed(() => props.selectedTask?.status === 'completed' ||
  Boolean(props.selectedTask?.id && props.reviewContext?.taskId === props.selectedTask.id && props.reviewContext.taskState === 'COMPLETED'))

const chatProps = computed(() => {
  const {
    reviewContext, reviewBusy, activeRequest, requestCatalog, activeTurns, capabilityState, deliberationV2Enabled,
    typedRecoveryAvailable, typedInspectionStatus, ...chat
  } = props
  return { ...chat, matterReadOnly: chat.matterReadOnly || taskCompleted.value, connectionStatus: taskCompleted.value ? '事项已完成' : chat.connectionStatus }
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
