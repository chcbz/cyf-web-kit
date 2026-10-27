<template>
  <div class="chat-panel discussion-surface" :class="`discussion-${discussionVariant}`">
    <div class="panel-toolbar">
      <div class="context-summary">
        <strong>{{ title }}</strong>
        <small>{{ resolvedSubtitle }}</small>
        <em>{{ displayStatus }}</em>
      </div>
      <div class="toolbar-actions">
        <button
          class="icon-button"
          type="button"
          title="刷新议事记录"
          aria-label="刷新议事记录"
          :disabled="conversationBusy || voice?.voiceInteractionLocked"
          @click="$emit('load-messages')"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 11-2l3 3M4 16l3 3a7 7 0 0 0 11-2" /></svg>
        </button>
        <button
          ref="historyButtonRef"
          class="icon-button"
          type="button"
          title="议事记录"
          aria-label="议事记录"
          :aria-expanded="historyOpen ? 'true' : 'false'"
          :disabled="Boolean(conversationHistoryDeletingId) || voice?.voiceInteractionLocked"
          @click="toggleHistory"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 5v5h5M3 10a9 9 0 1 1 2 8M12 7v5l3 2" /></svg>
        </button>
        <button
          v-if="!serverTaskCompleted && !isTaskDiscussion"
          class="icon-button primary"
          type="button"
          title="新对话"
          aria-label="新对话"
          :disabled="conversationBusy || voice?.voiceInteractionLocked"
          @click="$emit('new-conversation')"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" /></svg>
        </button>

        <slot name="matter-actions"></slot>
      </div>
    </div>



    <slot name="after-toolbar"></slot>
    <HallConversationHistory
      v-if="historyOpen"
      ref="historyRef"
      :dismiss-trigger="historyButtonRef"
      :conversations="conversationHistory"
      :read-only="serverTaskCompleted || isTaskDiscussion"
      :deleting-id="conversationHistoryDeletingId"
      :disabled="conversationBusy || voice?.voiceInteractionLocked"
      :error="conversationHistoryError"
      :has-more="conversationHistoryHasMore"
      :loading="conversationHistoryLoading"
      :selected-id="conversationId"
      @dismiss="closeHistory"
      @delete="!serverTaskCompleted && !isTaskDiscussion && $emit('delete-conversation', $event)"
      @load-more="$emit('load-more-history')"
      @select="$emit('select-conversation', $event)"
    />

    <div v-if="conversationLoadError" class="conversation-load-error" role="alert">
      <span>{{ conversationLoadError }}</span>
      <button type="button" :disabled="conversationBusy || voice?.voiceInteractionLocked" @click="$emit('retry-conversation')">重试</button>
    </div>

    <div ref="messageBoxRef" class="hall-messages">
      <div
        v-for="message in displayedMessages"
        :key="message.localId || message.timestamp"
        class="hall-message"
        :class="[message.sender, { 'is-streaming': message.streaming }]"
      >
        <div class="message-head">
          <strong>{{ senderText(message) }}</strong>
          <span v-if="message.streaming" class="message-state">正在回复…</span>
        </div>
        <div
          v-if="message.turnProjections?.length"
          class="discussion-turn-progress"
          role="status"
          aria-live="polite"
        >
          <span v-for="projection in message.turnProjections" :key="projection.key || projection.outcome.outcomeId">{{ discussionTurnStatus(projection) }}</span>
        </div>
        <div v-if="message.content" class="message-content" v-html="renderMarkdown(message.content)"></div>
        <div v-if="isTaskDiscussion && message.typedTaskId === taskId && message.typedSourceSelectors?.length" class="message-parts" aria-label="本条消息资料">
          <article v-for="(source, index) in message.typedSourceSelectors" :key="index" class="task-material-reference">
            <template v-if="source.kind === 'TASK_LINKED_WORKSPACE_VERSION'">
              <strong>{{ materialName(source) }}</strong><span>版本 {{ source.version }} · {{ source.purpose === 'INPUT' ? '输入资料' : '参考资料' }}</span>
            </template>
            <template v-else><strong>会话资料</strong><span>修订 {{ source.assetRevision }}</span></template>
          </article>
        </div>
        <BountyTextSelectionArchive
          v-if="isTaskDiscussion"
          :conversation-id="conversationId"
          :identity-key="materialIdentityKey"
          :message="message.turnOriginal || message"
        />
        <template v-for="delivery in message.turnDeliveries || []" :key="delivery.localId">
          <div v-if="discussionDeliveryText(delivery)" class="message-content" v-html="renderMarkdown(discussionDeliveryText(delivery))"></div>
          <BountyTextSelectionArchive
            v-if="discussionDeliveryText(delivery)"
            :conversation-id="conversationId"
            :identity-key="materialIdentityKey"
            :message="delivery"
          />
        </template>
        <HallMessageParts
          :parts="message.parts"
          :conversation-id="conversationId"
          :identity-key="materialIdentityKey"
          :identity-scope="identityScope"
        >
          <template #output-actions="{ part }">
            <button
              v-if="canReviewMessageOutputs && outputForPart(message, part)"
              type="button"
              class="message-output-accept"
              :disabled="outputReviewBusy || conversationBusy || voice?.voiceInteractionLocked"
              @click="reviewMessageOutput(outputForPart(message, part))"
            >验收此版</button>
          </template>
        </HallMessageParts>
        <div
          v-for="output in textOutputsFor(message)"
          :key="`${output.requestId}:${output.messageSource.turnId}:${output.messageSource.messageId}`"
          class="message-output-actions"
          role="group"
          aria-label="文字成果操作"
        >
          <button type="button" @click="textOutputPreview = output">预览</button>
          <button
            v-if="canReviewMessageOutputs"
            type="button"
            class="message-output-accept"
            :disabled="outputReviewBusy || conversationBusy || voice?.voiceInteractionLocked"
            @click="reviewMessageOutput(output)"
          >验收此版</button>
        </div>
        <BountyTypedOutcomeCard
          v-for="projection in typedForMessage(message)"
          :key="projection.key"
          :projection="projection"
          :read-only="serverTaskCompleted"
          @reply="!serverTaskCompleted && $emit('typed-reply', $event)"
        />
        <slot name="turn-actions" :request-ids="message.turnRequestIds || []"></slot>
        <small v-if="message.statusText && !message.turnProjections?.length" class="message-status">{{ message.statusText }}</small>
      </div>
      <slot name="bounty-results"></slot>
      <p v-if="deliberationStatus && !serverTaskCompleted" class="deliberation-status" :role="deliberationStatus.startsWith('停止失败') ? 'alert' : 'status'">{{ deliberationStatus }}</p>
      <div v-if="isAwaitingReply && !serverTaskCompleted" class="hall-message SYSTEM is-pending">
        <strong>{{ pendingAuthor }}</strong>
        <div class="message-content" v-html="renderMarkdown(pendingLabel)"></div>
      </div>
      <div v-if="!messages.length" class="empty-list">{{ emptyText }}</div>


    </div>

    <Teleport to="body">
      <dialog
        v-if="textOutputPreview"
        ref="textOutputDialog"
        class="message-output-preview"
        aria-label="文字成果预览"
        @cancel.prevent="textOutputPreview = null"
        @click="closeTextOutputPreview"
      >
        <header><strong>文字成果预览</strong><button type="button" aria-label="关闭预览" @click="textOutputPreview = null">×</button></header>
        <pre>{{ textOutputPreview.text }}</pre>
      </dialog>
    </Teleport>
    <HallChatComposer
      v-if="!serverTaskCompleted"
      ref="composerRef"
      :compact="discussionVariant === 'bounty'"
      :agents="agents"
      :durable-cancel-target="durableCancelTarget"
      :reply-cancellation-state="replyCancellationState"
      :discussion-variant="discussionVariant"
      :draft="draft"
      :has-typed-attachments="typedEnabled && discussionVariant === 'bounty' && typedSourceSelectors.length > 0"
      :interaction-locked="conversationBusy || serverTaskCompleted || materialSelectionBusy || materialActionBusy || materialUploadBusy"
      :send-blocked="materialWriteUnresolved || materialUploadPending || pendingMaterials.length > 0"
      :actions-disabled="serverTaskCompleted"
      :is-awaiting-reply="isAwaitingReply"
      :is-streaming="isStreaming"
      :mention-label="mentionLabel"
      :placeholder="placeholder"
      :selected-agent="selectedAgent"
      :target-text="targetText"
      :typed-pending-question="typedPendingQuestion"
      :context-key="`${materialIdentityKey}\u0000${taskId}\u0000${conversationId}`"
      :voice="voice"
      :materials-open="materialPickerOpen"
      @cancel-deliberation="$emit('cancel-deliberation', $event)"
      @clear-target="$emit('clear-target', $event)"
      @mention-agent="$emit('mention-agent', $event)"
      @send-message="$emit('send-message', typedEnabled && discussionVariant === 'bounty' ? { sourceSelectors: typedSourceSelectors, materialScope: typedMaterialScope } : undefined)"
      @update:draft="$emit('update:draft', $event)"
      @voice-apply="$emit('voice-apply', $event)"
      @open-tools="closeHistory"
      @close-materials="materialPickerOpen = false"
      @open-materials="toggleMaterialPicker"
      @import-images="importMaterialImages"
    >
      <template #attachments>
        <div
          v-if="activeMaterialLinks.length"
          class="composer-attachment-strip"
          tabindex="0"
          aria-label="已选资料，可横向滚动"
        >
          <article v-for="link in activeMaterialLinks" :key="link.relationId" class="composer-attachment-card">
            <HallMaterialThumbnail :file-id="link.fileId" :version="link.version" :identity-key="materialIdentityKey" />
            <span class="composer-attachment-name"><strong :title="materialName(link)">{{ materialName(link) }}</strong><small>固定版本 v{{ link.version }}</small></span>
            <button type="button" :aria-label="`预览 ${materialName(link)}`" @click="previewMaterial(link)">预览</button>
            <button
              type="button"
              :disabled="materialSelectionBusy || materialActionBusy || materialUploadBusy || conversationBusy || serverTaskCompleted"
              :aria-label="`移除 ${materialName(link)}`"
              @click="removeMaterialReference(link)"
            >移除</button>
          </article>
        </div>
      </template>
      <template #materials>
        <p v-if="materialPickerLoading" class="material-reference-state" role="status">正在读取资料…</p>
        <HallMaterialPicker
          v-if="!serverTaskCompleted"
          ref="materialPickerRef"
          dialog-only
          :model-value="pickerMaterials"
          :identity-epoch="identityEpoch"
          :identity-scope="`${identityScope}\u0000${taskId}\u0000${conversationId}`"
          :enabled="hasMaterialScope && !serverTaskCompleted"
          :disabled="materialSelectionBusy || materialActionBusy || conversationBusy || serverTaskCompleted"
          @update:model-value="completeMaterials"
          @import-materials="attachMaterials"
          @upload-busy="materialUploadBusy = $event"
          @upload-pending="materialUploadPending = $event"
        >
          <template #context>
            <WorkspaceWriteRecovery :pending="selectedMaterialDirectory.pendingWrites.value" @retry="selectedMaterialDirectory.retryWrite" />
            <p v-if="selectedMaterialDirectory.writeNotice.value" role="status">{{ selectedMaterialDirectory.writeNotice.value }}</p>
            <p v-if="materialError" class="material-reference-error" role="alert">{{ materialError }}</p>
            <details v-if="isTaskDiscussion" class="material-use-settings">
              <summary>本事项资料与使用范围<span v-if="activeMaterialLinks.length"> · {{ activeMaterialLinks.length }} 份</span></summary>
              <label v-if="typedEnabled" class="typed-material-scope">资料范围
                <select v-model="draftMaterialScope" aria-label="资料范围">
                  <option value="TASK_DEFAULT">本事项资料</option>
                  <option value="EXPLICIT">仅本条消息</option>
                  <option value="NONE">本条消息不附带资料</option>
                </select>
              </label>
              <p v-if="!activeMaterialLinks.length" class="material-reference-state">暂未关联资料，可在下方选择或上传。</p>
              <ul v-else class="material-use-list">
                <li v-for="link in activeMaterialLinks" :key="link.relationId || `${link.fileId}:${link.version}`">
                  <label v-if="typedEnabled && draftMaterialScope === 'EXPLICIT'">
                    <input type="checkbox" :checked="draftSourceIds.has(`${link.fileId}\u0000${link.version}`)" @change="toggleDraftSource(link, $event.target.checked)" />
                    {{ materialName(link) }} · v{{ link.version }}
                  </label>
                  <span v-else>{{ materialName(link) }} · v{{ link.version }}</span>
                </li>
              </ul>
              <p class="material-reference-notice">完成后应用本次选择；取消不改变原有资料与使用范围。</p>
            </details>
          </template>
        </HallMaterialPicker>
        <div v-if="materialSelectionBusy || pendingMaterials.length" class="material-link-status" role="status">
          <span v-if="materialSelectionBusy">正在关联所选资料…</span>
          <template v-else>
            <span>部分资料尚未关联，已有选择保留。</span>
            <button type="button" @click="toggleMaterialPicker">查看并继续</button>
          </template>
        </div>
        <p v-if="materialPickerOpen && !hasMaterialScope" class="material-reference-notice" role="status">{{ isTaskDiscussion ? '未确认当前事项标识，不能读取或展示资料。' : '请先发送一条消息建立议事，再从资料中选择引用。' }}</p>
        <p v-if="materialError" class="material-reference-error" role="alert">{{ materialError }}</p>
        <WorkspaceWriteRecovery :pending="selectedMaterialDirectory.pendingWrites.value" @retry="selectedMaterialDirectory.retryWrite" />
        <p v-if="selectedMaterialDirectory.writeNotice.value" role="status">{{ selectedMaterialDirectory.writeNotice.value }}</p>
      </template>
    </HallChatComposer>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import HallMessageParts from './HallMessageParts.vue'
import BountyTextSelectionArchive from './BountyTextSelectionArchive.vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import HallChatComposer from './HallChatComposer.vue'
import HallMaterialPicker from './HallMaterialPicker.vue'
import HallMaterialThumbnail from './HallMaterialThumbnail.vue'
import HallConversationHistory from './HallConversationHistory.vue'
import BountyTypedOutcomeCard from './BountyTypedOutcomeCard.vue'
import { discussionTurns, discussionDeliveryText, discussionTurnStatus } from '../../composables/juyiting/hallDiscussionTurns.js'
import WorkspaceWriteRecovery from '../personal-workspace/WorkspaceWriteRecovery.vue'
import { usePersonalWorkspace } from '../../composables/usePersonalWorkspace.js'
import { usePersonalWorkspaceConversationLinks } from '../../composables/usePersonalWorkspaceConversationLinks.js'
import { usePersonalWorkspaceTaskLinks } from '../../composables/usePersonalWorkspaceTaskLinks.js'

marked.setOptions({
  breaks: true,
  gfm: true,
  headerIds: false,
  sanitize: false
})

const props = defineProps({
  agents: { type: Array, default: () => [] },
  connectionStatus: { type: String, default: '' },
  conversationHistory: { type: Array, default: () => [] },
  conversationHistoryDeletingId: { type: String, default: '' },
  conversationHistoryError: { type: String, default: '' },
  conversationHistoryHasMore: { type: Boolean, default: false },
  conversationHistoryLoading: { type: Boolean, default: false },
  conversationLoadError: { type: String, default: '' },
  conversationBusy: { type: Boolean, default: false },
  deliberationStatus: { type: String, default: '' },
  durableCancelTarget: { type: Object, default: null },
  replyCancellationState: { type: Object, default: null },
  conversationId: { type: String, default: '' },
  discussionVariant: { type: String, default: 'public' },
  matterReadOnly: { type: Boolean, default: false },
  draft: { type: String, default: '' },
  emptyText: { type: String, default: '还没有议事记录，可以先提问。' },
  eventStreamRecovering: { type: Boolean, default: false },
  isAwaitingReply: { type: Boolean, default: false },
  isStreaming: { type: Boolean, default: false },
  identityEpoch: { type: [Number, String], default: 0 },
  identityScope: { type: String, default: '' },
  mentionLabel: { type: Function, required: true },
  messages: { type: Array, default: () => [] },
  pendingAgentName: { type: String, default: '' },
  placeholder: { type: String, default: '向聚义厅传话，或 @某位好汉' },
  selectedAgent: { type: Object, default: null },
  selectedTask: { type: Object, default: null },
  senderText: { type: Function, required: true },
  scopeHint: { type: String, default: 'public' },
  subtitle: { type: String, default: '' },
  title: { type: String, default: '议事' },
  targetText: { type: String, default: '众好汉' },
  voice: { type: Object, default: null },
  outputCandidates: { type: Array, default: () => [] },
  outputReviewEnabled: { type: Boolean, default: false },
  outputReviewBusy: { type: Boolean, default: false },
  typedOutcomes: { type: Array, default: () => [] },
  typedPendingQuestion: { type: Object, default: null },
  typedEnabled: { type: Boolean, default: false }
})

const emit = defineEmits([
  'cancel-deliberation',
  'clear-target',
  'delete-conversation',
  'load-history',
  'load-more-history',
  'load-messages',
  'mention-agent',
  'new-conversation',
  'open-workspace',
  'retry-conversation',
  'select-conversation',
  'send-message',
  'update:draft',
  'voice-apply',
  'typed-reply',
  'accept-output',
])

const messageBoxRef = ref(null)
const historyOpen = ref(false)
const historyButtonRef = ref(null)
const historyRef = ref(null)
const composerRef = ref(null)
const materialPickerOpen = ref(false)
const pendingAuthor = '聚义厅'
const materialIdentityKey = computed(() => `${props.identityEpoch}\u0000${props.identityScope}`)
const taskId = computed(() => String(props.selectedTask?.id || '').trim())
const serverTaskCompleted = computed(() => props.discussionVariant === 'bounty' &&
  (props.matterReadOnly || ['completed', 'failed', 'cancelled', 'archived'].includes(props.selectedTask?.status)))
const typedForMessage = message => props.typedOutcomes.filter(projection =>
  projection?.outcome?.assistantMessageId === String(message?.localId || '') && !message.turnProjections?.includes(projection))

const isTaskDiscussion = computed(() => props.discussionVariant === 'bounty')
const displayedMessages = computed(() => !isTaskDiscussion.value ? props.messages : discussionTurns({
  messages: props.messages, projections: props.typedOutcomes, conversationId: props.conversationId, taskId: taskId.value
}))
const canReviewMessageOutputs = computed(() => isTaskDiscussion.value && props.outputReviewEnabled && !serverTaskCompleted.value)
const isAgentMessage = message => ['AGENT', 'ASSISTANT'].includes(message?.sender)
const outputForPart = (message, part) => {
  if (!isTaskDiscussion.value || !isAgentMessage(message) || part?.state !== 'ready' || !part.assetId) return null
  const matches = props.outputCandidates.filter(item => item.assetRef?.assetId === part.assetId && item.assetRef.revision === String(part.revision))
  // No newest/title fallback: ambiguous references stay in the explicit selection dialog.
  return matches.length === 1 ? matches[0] : null
}
const textOutputsFor = message => !isTaskDiscussion.value || !isAgentMessage(message) ? [] : props.outputCandidates.filter(item =>
  item.messageSource?.messageId === String(message.localId || '') && item.taskId === taskId.value)
const reviewMessageOutput = item => {
  if (canReviewMessageOutputs.value && !props.outputReviewBusy && !props.conversationBusy && !props.voice?.voiceInteractionLocked && props.outputCandidates.includes(item)) emit('accept-output', item)
}
const textOutputPreview = ref(null)
const textOutputDialog = ref(null)
let textPreviewReturnFocus = null
const closeTextOutputPreview = event => { if (event.target === textOutputDialog.value) textOutputPreview.value = null }
watch(textOutputPreview, async item => {
  if (item) {
    textPreviewReturnFocus = document.activeElement
    await nextTick()
    if (!textOutputPreview.value) return
    textOutputDialog.value?.showModal?.()
    textOutputDialog.value?.querySelector('button')?.focus()
  } else {
    await nextTick()
    if (textPreviewReturnFocus?.isConnected) textPreviewReturnFocus.focus()
  }
})
watch(() => `${materialIdentityKey.value}\u0000${taskId.value}\u0000${props.conversationId}`, () => { textOutputPreview.value = null }, { flush: 'sync' })

const workspace = usePersonalWorkspace({ identityEpoch: materialIdentityKey })
const conversationMaterialLinks = usePersonalWorkspaceConversationLinks({
  conversationId: () => props.conversationId,
  identityEpoch: materialIdentityKey
})
const taskMaterialLinks = usePersonalWorkspaceTaskLinks({
  taskId,
  identityEpoch: materialIdentityKey
})
const materialNames = ref({})
const pendingMaterials = ref([])
const materialPickerRef = ref(null)
const draftMaterialScope = ref('TASK_DEFAULT')
const draftSourceIds = ref(new Set())
const materialSelectionBusy = ref(false)
const materialUploadBusy = ref(false)
const materialUploadPending = ref(false)
const materialPickerLoading = ref(false)
let materialRefresh = null
let materialSelectionGeneration = 0
const typedSelectedSourceIds = ref(new Set())
const hasMaterialScope = computed(() => isTaskDiscussion.value ? Boolean(taskId.value) : Boolean(props.conversationId))
// UI, staging and recovery are shared; only the authorized association scope differs.
const selectedMaterialDirectory = computed(() => isTaskDiscussion.value ? taskMaterialLinks : conversationMaterialLinks)
const materialWriteUnresolved = computed(() => selectedMaterialDirectory.value.pendingWrites.value.length > 0)
const materialActionBusy = computed(() => ['saving', 'removing'].includes(selectedMaterialDirectory.value.actionState.value))
const materialError = computed(() => selectedMaterialDirectory.value.error.value || workspace.error.value)
const activeMaterialLinks = computed(() => selectedMaterialDirectory.value.links.value.filter(link => link.state === 'ACTIVE' &&
  (isTaskDiscussion.value ? ['INPUT', 'REFERENCE'].includes(link.role) : link.role === 'REFERENCE')))
const materialName = link => materialNames.value[link.fileId] || workspace.items.value.find(file => file.fileId === link.fileId)?.displayName || `资料 ${link.fileId}`
const pickerMaterials = computed(() => [...new Map([
  ...activeMaterialLinks.value.map(link => ({ fileId: link.fileId, version: link.version, displayName: materialName(link) })),
  ...pendingMaterials.value
].map(material => [`${material.fileId}:${material.version}`, material])).values()])
const previewMaterial = link => materialPickerRef.value?.preview?.({ ...link, displayName: materialName(link) })
const importMaterialImages = files => {
  if (!hasMaterialScope.value) { materialPickerOpen.value = true; return }
  void materialPickerRef.value?.importImages?.(files)
}
const typedMaterialScope = ref('TASK_DEFAULT')
const typedSourceSelectors = computed(() => (typedMaterialScope.value === 'NONE' ? [] : activeMaterialLinks.value).filter(link => typedSelectedSourceIds.value.has(`${link.fileId}\u0000${link.version}`) ).map(link => ({ kind: 'TASK_LINKED_WORKSPACE_VERSION', fileId: link.fileId, version: String(link.version), purpose: link.role })))
const toggleDraftSource = (link, selected) => {
  if (!props.typedEnabled || !link || !['INPUT', 'REFERENCE'].includes(link.role)) return
  const next = new Set(draftSourceIds.value); const key = `${link.fileId}\u0000${link.version}`
  if (selected) next.add(key); else next.delete(key)
  draftSourceIds.value = next
}
const resolveMaterialNames = async operationKey => {
  for (const link of activeMaterialLinks.value) {
    if (materialNames.value[link.fileId] || workspace.items.value.some(file => file.fileId === link.fileId)) continue
    const detail = await workspace.select(link.fileId)
    if (operationKey !== `${materialIdentityKey.value}\u0000${taskId.value}\u0000${props.conversationId}`) return
    if (detail?.file?.state === 'ACTIVE' && detail.file.fileId === link.fileId) {
      materialNames.value = { ...materialNames.value, [link.fileId]: detail.file.displayName }
    }
  }
}
const refreshMaterialReferences = () => {
  if (!hasMaterialScope.value) return Promise.resolve(false)
  const operationKey = `${materialIdentityKey.value}\u0000${taskId.value}\u0000${props.conversationId}`
  if (materialRefresh?.key === operationKey) return materialRefresh.promise
  const directory = selectedMaterialDirectory.value
  const request = { key: operationKey, promise: null }
  request.promise = (async () => {
    const [, loaded] = await Promise.all([workspace.refresh({ state: 'ACTIVE' }), directory.load()])
    if (!loaded || operationKey !== `${materialIdentityKey.value}\u0000${taskId.value}\u0000${props.conversationId}`) return false
    await resolveMaterialNames(operationKey)
    return operationKey === `${materialIdentityKey.value}\u0000${taskId.value}\u0000${props.conversationId}`
  })().finally(() => { if (materialRefresh === request) materialRefresh = null })
  materialRefresh = request
  return request.promise
}
const toggleMaterialPicker = async () => {
  if (serverTaskCompleted.value) { materialPickerOpen.value = false; return }
  if (materialPickerLoading.value) return
  if (!hasMaterialScope.value) { materialPickerOpen.value = true; return }
  materialPickerOpen.value = false
  draftMaterialScope.value = typedMaterialScope.value
  draftSourceIds.value = new Set(typedSelectedSourceIds.value)
  const generation = materialSelectionGeneration
  materialPickerLoading.value = true
  try {
    if (!await refreshMaterialReferences() || generation !== materialSelectionGeneration || serverTaskCompleted.value) return
    await materialPickerRef.value?.open?.()
  } finally { if (generation === materialSelectionGeneration) materialPickerLoading.value = false }
}
const completeMaterials = materials => {
  if (serverTaskCompleted.value || materialSelectionBusy.value || !hasMaterialScope.value) return
  typedMaterialScope.value = draftMaterialScope.value
  typedSelectedSourceIds.value = new Set(draftSourceIds.value)
  void attachMaterials(materials, true)
}
const attachMaterials = async (materials, reconcile = false) => {
  if (serverTaskCompleted.value || materialSelectionBusy.value || !hasMaterialScope.value) return
  const directory = selectedMaterialDirectory.value
  pendingMaterials.value = materials.map(material => ({ ...material }))
  const generation = ++materialSelectionGeneration
  materialSelectionBusy.value = true
  try {
    for (const material of materials) {
      if (generation !== materialSelectionGeneration || serverTaskCompleted.value) return
      const existing = activeMaterialLinks.value.find(link => link.fileId === material.fileId && link.version === material.version)
      const link = existing || await directory.attach({ fileId: material.fileId, version: material.version, role: 'REFERENCE' })
      if (generation !== materialSelectionGeneration || serverTaskCompleted.value) return
      if (!link || link.state !== 'ACTIVE') return // Keep failed/unattempted selections and the existing write recovery intent.
      materialNames.value = { ...materialNames.value, [material.fileId]: material.displayName }
      if (!existing && props.typedEnabled && typedMaterialScope.value === 'EXPLICIT') typedSelectedSourceIds.value = new Set([...typedSelectedSourceIds.value, `${link.fileId}\u0000${link.version}`])
      pendingMaterials.value = pendingMaterials.value.filter(item => item.fileId !== material.fileId || item.version !== material.version)
    }
    if (reconcile) {
      const selected = new Set(materials.map(material => `${material.fileId}:${material.version}`))
      for (const link of [...activeMaterialLinks.value]) {
        if (generation !== materialSelectionGeneration || serverTaskCompleted.value) return
        if (!selected.has(`${link.fileId}:${link.version}`)) {
          const removed = await directory.detach(link)
          if (!removed) return
        }
      }
    }
  } finally { if (generation === materialSelectionGeneration) materialSelectionBusy.value = false }
}
const removeMaterialReference = async link => {
  if (!link || serverTaskCompleted.value || materialSelectionBusy.value || materialActionBusy.value || props.conversationBusy || materialUploadBusy.value) return
  await selectedMaterialDirectory.value.detach(link)
}
const closeHistory = () => {
  if (!historyRef.value?.dismissBlocked) historyOpen.value = false
}
const toggleHistory = () => {
  if (historyRef.value?.dismissBlocked) return
  historyOpen.value = !historyOpen.value
  if (historyOpen.value) {
    composerRef.value?.closeTools?.()
    emit('load-history')
  }
}
const taskText = computed(() => props.selectedTask?.title || '未选榜文')
const resolvedSubtitle = computed(() => {
  if (props.subtitle) return props.subtitle
  if (props.discussionVariant === 'bounty') return taskText.value
  if (props.discussionVariant === 'private') return props.targetText
  if (props.selectedTask) return taskText.value
  if (props.selectedAgent) return props.targetText
  return props.scopeHint === 'public' ? '未指定好汉时，由宋江安排回复。' : props.scopeHint
})
const displayStatus = computed(() => {
  if (serverTaskCompleted.value) return ({ completed: '事项已完成', cancelled: '事项已取消', failed: '事项未完成', archived: '事项已归档' })[props.selectedTask?.status] || props.connectionStatus || '事项只读'
  if (props.eventStreamRecovering) return '正在恢复连接'
  return props.connectionStatus || (props.isAwaitingReply ? pendingLabel.value : '连接正常')
})
const pendingLabel = computed(() => {
  if (props.pendingAgentName) return `${props.pendingAgentName} 正在回复…`
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

watch(() => `${materialIdentityKey.value}\u0000${taskId.value}\u0000${props.conversationId}\u0000${serverTaskCompleted.value}`, () => {
  historyOpen.value = false
  materialPickerOpen.value = false
  materialNames.value = {}
  materialSelectionGeneration++
  materialSelectionBusy.value = false
  materialUploadBusy.value = false
  materialUploadPending.value = false
  materialPickerLoading.value = false
  materialRefresh = null
  pendingMaterials.value = []
  typedSelectedSourceIds.value = new Set()
  typedMaterialScope.value = 'TASK_DEFAULT'
  draftMaterialScope.value = 'TASK_DEFAULT'
  draftSourceIds.value = new Set()
  if (hasMaterialScope.value && !serverTaskCompleted.value) void refreshMaterialReferences()
}, { flush: 'sync', immediate: true })
watch(serverTaskCompleted, (terminal, previous) => {
  if (!terminal) return
  materialPickerOpen.value = false
  if (!previous) props.voice?.cancel?.()
}, { flush: 'sync', immediate: true })
onBeforeUnmount(() => {
  materialSelectionGeneration++
  workspace.dispose()
  conversationMaterialLinks.dispose()
  taskMaterialLinks.dispose()
})
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
.toolbar-actions :deep(.matter-action) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 44px;
  height: 44px;
  min-width: 44px;
  min-height: 44px;
  padding: 0;
  flex: 0 0 auto;
  border-radius: 8px;
  background: transparent;
  color: #4a3423;
  white-space: nowrap;
}

.icon-button svg,
.toolbar-actions :deep(.matter-action svg) {
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
}

.icon-button:hover:not(:disabled),
.toolbar-actions :deep(.matter-action:hover:not(:disabled)) {
  background: #f2e8d8;
}

.icon-button:focus-visible,
.toolbar-actions :deep(.matter-action:focus-visible) {
  outline: 2px solid #7f4a22;
  outline-offset: 2px;
}

.workspace-entry {
  width: auto;
  gap: 4px;
  padding: 0 8px;
  background: #ead3a9;
  color: #5d361c;
  font-size: 12px;
}

.material-reference-entry {
  width: auto;
  gap: 4px;
  padding: 0 8px;
  background: #e7dbc4;
  color: #604323;
  font-size: 12px;
}

.material-reference-entry span {
  white-space: nowrap;
}

.material-link-status { display: flex; gap: 8px; padding: 6px 10px; font-size: 12px; color: #806441; }
.material-link-status button { color: #7f4a22; text-decoration: underline; }
.material-use-settings summary { cursor: pointer; color: #654122; }
.material-use-list { margin: 8px 0; padding-left: 18px; font-size: 13px; }
.material-use-list li + li { margin-top: 6px; }

.material-reference-picker {
  flex: 0 0 auto;
  max-height: min(42vh, 270px);
  overflow-y: auto;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(116, 75, 35, 0.16);
  background: #f8eedc;
  color: #4a3423;
}

.material-reference-heading {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 10px;
}

.material-reference-heading strong,
.material-reference-heading small {
  display: block;
}

.material-reference-heading strong {
  font-size: 13px;
}

.material-reference-heading small,
.material-reference-notice,
.material-reference-state,
.material-reference-error {
  margin: 3px 0 0;
  color: #806441;
  font-size: 12px;
  line-height: 1.45;
}

.material-reference-heading > button {
  display: grid;
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 5px;
  background: transparent;
  color: #765f40;
}

.material-reference-error {
  color: #a23f32;
}

.material-reference-state button {
  margin-left: 4px;
  color: #7f4a22;
  text-decoration: underline;
}

.material-reference-list {
  display: grid;
  gap: 6px;
  margin: 9px 0 0;
  padding: 0;
  list-style: none;
}

.material-reference-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border: 1px solid rgba(116, 75, 35, 0.14);
  border-radius: 7px;
  background: #fffaf0;
}

.material-reference-file {
  min-width: 0;
  flex: 1;
}

.material-reference-file strong,
.material-reference-file small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.material-reference-file strong {
  font-size: 12px;
}

.material-reference-file small {
  margin-top: 2px;
  color: #8a6f4b;
  font-size: 11px;
}

.material-reference-list li > button,
.active-material-references > button {
  flex: 0 0 auto;
  padding: 4px 7px;
  border-radius: 5px;
  background: #e8d3ad;
  color: #623e20;
  font-size: 12px;
}

.material-reference-list li > button.material-reference-linked {
  background: #eee4d2;
  color: #765f40;
}

.active-material-references {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  margin-top: 9px;
  color: #806441;
  font-size: 12px;
}

.active-material-references > button {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  max-width: 100%;
}

.active-material-references :deep(.var-icon) {
  font-size: 13px;
}

.workspace-entry span {
  white-space: nowrap;
}

.icon-button.primary {
  color: #6d3f1f;
}

.conversation-load-error {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  background: #fff0ea;
  color: #a23f32;
  font-size: 12px;
}

.conversation-load-error button {
  flex: 0 0 auto;
  padding: 4px 8px;
  border: 1px solid currentColor;
  border-radius: 5px;
  background: transparent;
  color: inherit;
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
.deliberation-status { margin: 8px 12px; color: var(--color-warning, #a66b16); font-size: 12px; }

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

@media (max-width: 640px) {
  .panel-toolbar {
    align-items: center;
  }

  .context-summary {
    flex-wrap: wrap;
    gap: 2px 6px;
  }

  .context-summary strong {
    flex-shrink: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .context-summary em {
    display: none;
  }

  .hall-message {
    max-width: 94%;
  }
}
.composer-attachment-strip { display: flex; flex: 1 0 100%; box-sizing: border-box; width: 100%; min-width: 0; max-width: 100%; gap: 8px; padding: 6px 2px; overflow-x: auto; scrollbar-width: none; }
.composer-attachment-strip::-webkit-scrollbar { display: none; }
.composer-attachment-strip:focus-visible { outline: 2px solid var(--hall-brand, #923f30); outline-offset: -2px; }
.composer-attachment-card { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; max-width: 300px; padding: 8px; background: var(--hall-surface, #fffefa); border: 1px solid var(--hall-border, #e3e5dc); border-radius: 8px; }
.composer-attachment-name { display: flex; flex-direction: column; min-width: 0; }
.composer-attachment-name strong { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.composer-attachment-name small { font-size: 11px; color: var(--hall-text-muted, #68716b); }
.composer-attachment-card button { min-height: 44px; flex-shrink: 0; padding: 4px; background: transparent; font-size: 12px; }
</style>

<style scoped>
.task-material-directory{display:grid;gap:8px}.task-material-reference{display:grid;gap:5px;padding:10px 12px;border:1px solid #d8ded8;border-radius:8px;background:#f6faf7}.task-material-reference>div{display:flex;align-items:baseline;justify-content:space-between;gap:8px}.task-material-reference strong,.task-material-reference small{overflow-wrap:anywhere}.task-material-reference small{color:#5f746b;font-size:11px}.task-material-reference p{margin:0;color:#5b6963;font-size:12px;line-height:1.55}.material-reference-notice{line-height:1.55}
.composer-attachment-strip { display: flex; flex: 1 0 100%; box-sizing: border-box; width: 100%; min-width: 0; max-width: 100%; gap: 8px; padding: 6px 2px; overflow-x: auto; scrollbar-width: none; }
.composer-attachment-strip::-webkit-scrollbar { display: none; }
.composer-attachment-strip:focus-visible { outline: 2px solid var(--hall-brand, #923f30); outline-offset: -2px; }
.composer-attachment-card { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; max-width: 300px; padding: 8px; background: var(--hall-surface, #fffefa); border: 1px solid var(--hall-border, #e3e5dc); border-radius: 8px; }
.composer-attachment-name { display: flex; flex-direction: column; min-width: 0; }
.composer-attachment-name strong { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.composer-attachment-name small { font-size: 11px; color: var(--hall-text-muted, #68716b); }
.composer-attachment-card button { min-height: 44px; flex-shrink: 0; padding: 4px; background: transparent; font-size: 12px; }
</style>

<style scoped>
.message-output-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; }
.message-output-actions button, .message-output-accept { min-height: 40px; padding: 6px 12px; border: 1px solid var(--hall-border, #e3e5dc); border-radius: 7px; font: inherit; cursor: pointer; }
.message-output-accept { background: var(--hall-brand, #923f30); color: var(--hall-surface, #fffefa); }
.message-output-accept:disabled { opacity: .65; cursor: not-allowed; }
.message-output-preview { width: min(800px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); box-sizing: border-box; border: 1px solid var(--hall-border, #e3e5dc); border-radius: 12px; padding: 16px; background: var(--hall-surface, #fffefa); color: var(--hall-text, #242e2b); }
.message-output-preview::backdrop { background: #242e2baa; }
.message-output-preview header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.message-output-preview header button { min-width: 40px; min-height: 40px; border: 0; background: transparent; color: inherit; font-size: 24px; cursor: pointer; }
.message-output-preview pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
.composer-attachment-strip { display: flex; flex: 1 0 100%; box-sizing: border-box; width: 100%; min-width: 0; max-width: 100%; gap: 8px; padding: 6px 2px; overflow-x: auto; scrollbar-width: none; }
.composer-attachment-strip::-webkit-scrollbar { display: none; }
.composer-attachment-strip:focus-visible { outline: 2px solid var(--hall-brand, #923f30); outline-offset: -2px; }
.composer-attachment-card { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; max-width: 300px; padding: 8px; background: var(--hall-surface, #fffefa); border: 1px solid var(--hall-border, #e3e5dc); border-radius: 8px; }
.composer-attachment-name { display: flex; flex-direction: column; min-width: 0; }
.composer-attachment-name strong { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.composer-attachment-name small { font-size: 11px; color: var(--hall-text-muted, #68716b); }
.composer-attachment-card button { min-height: 44px; flex-shrink: 0; padding: 4px; background: transparent; font-size: 12px; }
</style>

<style scoped>
.discussion-turn-progress { display: flex; flex-wrap: wrap; gap: 8px; margin: 4px 0 8px; color: var(--hall-text-muted, #68716b); font-size: 12px; }
.composer-attachment-strip { display: flex; flex: 1 0 100%; box-sizing: border-box; width: 100%; min-width: 0; max-width: 100%; gap: 8px; padding: 6px 2px; overflow-x: auto; scrollbar-width: none; }
.composer-attachment-strip::-webkit-scrollbar { display: none; }
.composer-attachment-strip:focus-visible { outline: 2px solid var(--hall-brand, #923f30); outline-offset: -2px; }
.composer-attachment-card { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; max-width: 300px; padding: 8px; background: var(--hall-surface, #fffefa); border: 1px solid var(--hall-border, #e3e5dc); border-radius: 8px; }
.composer-attachment-name { display: flex; flex-direction: column; min-width: 0; }
.composer-attachment-name strong { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.composer-attachment-name small { font-size: 11px; color: var(--hall-text-muted, #68716b); }
.composer-attachment-card button { min-height: 44px; flex-shrink: 0; padding: 4px; background: transparent; font-size: 12px; }
</style>
