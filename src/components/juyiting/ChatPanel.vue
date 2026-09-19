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
          title="重取回话"
          aria-label="重取回话"
          :disabled="conversationBusy || voice?.voiceInteractionLocked"
          @click="$emit('load-messages')"
        >
          <var-icon name="refresh" />
        </button>
        <button
          class="icon-button"
          type="button"
          title="话头记录"
          aria-label="话头记录"
          :aria-expanded="historyOpen ? 'true' : 'false'"
          :disabled="Boolean(conversationHistoryDeletingId) || voice?.voiceInteractionLocked"
          @click="toggleHistory"
        >
          <var-icon name="history" />
        </button>
        <button
          class="icon-button primary"
          type="button"
          title="另起话头"
          aria-label="另起话头"
          :disabled="conversationBusy || voice?.voiceInteractionLocked"
          @click="$emit('new-conversation')"
        >
          <var-icon name="plus" />
        </button>
      </div>
    </div>

    <HallConversationHistory
      v-if="historyOpen"
      :conversations="conversationHistory"
      :deleting-id="conversationHistoryDeletingId"
      :disabled="conversationBusy || voice?.voiceInteractionLocked"
      :error="conversationHistoryError"
      :has-more="conversationHistoryHasMore"
      :loading="conversationHistoryLoading"
      :selected-id="conversationId"
      @delete="$emit('delete-conversation', $event)"
      @load-more="$emit('load-more-history')"
      @select="$emit('select-conversation', $event)"
    />

    <div v-if="conversationLoadError" class="conversation-load-error" role="alert">
      <span>{{ conversationLoadError }}</span>
      <button type="button" :disabled="conversationBusy || voice?.voiceInteractionLocked" @click="$emit('retry-conversation')">重试</button>
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
          <span v-if="message.streaming" class="message-state">回话未尽</span>
        </div>
        <div class="message-content" v-html="renderMarkdown(message.content)"></div>
        <small v-if="message.statusText" class="message-status">{{ message.statusText }}</small>
      </div>
      <div v-if="isAwaitingReply" class="hall-message SYSTEM is-pending">
        <strong>{{ pendingAuthor }}</strong>
        <div class="message-content" v-html="renderMarkdown(pendingLabel)"></div>
      </div>
      <div v-if="!messages.length" class="empty-list">{{ emptyText }}</div>

      <section v-if="conversationId && executionEnabled" class="execution-directory" aria-label="交给 Agent 执行">
        <div class="deliverable-directory-head">
          <strong>交给 Agent 执行</strong>
          <button type="button" :disabled="executionLoading" @click="refreshExecutionMaterials">刷新资料</button>
        </div>
        <p class="execution-note">此处是明确执行指令，不会因普通聊天自动发起文件处理或模型调用。</p>
        <p class="execution-note">确认执行会将本轮资料交给所选 Agent 及其配置的 Provider；资料可能外发并产生费用，费用未知。此提示不代表已获得本轮收费或外发授权。</p>
        <p v-if="taskExecutionMode" class="execution-note">当前榜文：{{ selectedTaskId }}。仅已关联且获授权的精确版本可由服务端接受。</p>
        <p v-else class="execution-note">私人执行仅归档到自己的工作空间，不会变成悬赏正式交付。</p>
        <p v-if="taskExecutionMode" class="execution-note">将资料加入本轮时，系统会先固定为该榜文的 INPUT 版本关联；REFERENCE 不会被当作执行输入。</p>
        <p v-if="activeConversationInputLinks.length" class="execution-note">本话头已固定 {{ activeConversationInputLinks.length }} 份资料；解除关联不会撤销已开始执行的输入快照。</p>
        <ul v-if="activeConversationInputLinks.length" class="execution-material-list conversation-material-list" aria-label="已固定议事资料">
          <li v-for="link in activeConversationInputLinks" :key="link.relationId">{{ conversationMaterialLabel(link) }} <button type="button" :disabled="conversationLinks.actionState.value === 'removing'" @click="detachConversationInput(link)">解除议事资料</button></li>
        </ul>
        <p v-if="execution.capabilityState.value === 'loading' || workspace.listState.value === 'loading'" class="execution-note" role="status">正在读取执行能力与工作空间…</p>
        <p v-else-if="execution.capabilityError.value || workspace.error.value || conversationLinks.error.value || taskLinks.error.value || execution.rosterError.value" class="deliverable-error" role="alert">{{ execution.capabilityError.value || workspace.error.value || conversationLinks.error.value || taskLinks.error.value || execution.rosterError.value }}</p>
        <template v-else>
          <label class="execution-field"><span>交付格式</span><select v-model="executionOutputMime"><option v-for="mime in execution.allowedMimeTypes.value" :key="mime" :value="mime">{{ outputMimeLabel(mime) }}</option></select></label>
          <label class="execution-field"><span>执行说明</span><textarea v-model="executionInstruction" maxlength="4000" placeholder="例如：根据已选资料生成 5 页中文项目汇报 PPT；或修改图片背景。"></textarea></label>
          <div class="execution-materials">
            <strong>固定资料版本</strong>
            <p v-if="!workspace.items.value.length" class="execution-note">暂无可选文件；可先在工作空间上传，或在此处直接生成图片/PPT。</p>
            <div v-else class="execution-file-list">
              <button v-for="file in executionWorkspaceFiles" :key="file.fileId" type="button" :class="{ selected: selectedExecutionFileId === file.fileId }" @click="selectExecutionFile(file.fileId)">{{ file.displayName }} · v{{ file.latestVersion }}</button>
            </div>
            <label v-if="workspace.detail.value?.file?.state === 'ACTIVE'" class="execution-field"><span>文件版本</span><select v-model.number="selectedExecutionVersion"><option v-for="version in workspace.detail.value.versions" :key="version.version" :value="version.version">v{{ version.version }} · {{ version.originalFilename }}</option></select></label>
            <button v-if="workspace.detail.value?.file?.state === 'ACTIVE'" type="button" :disabled="!canAddExecutionMaterial" @click="addExecutionMaterial">{{ taskExecutionMode && !selectedTaskInputLinked ? '关联为输入并加入本轮资料' : '加入本轮资料' }}</button>
            <ul v-if="executionMaterials.length" class="execution-material-list"><li v-for="material in executionMaterials" :key="`${material.fileId}:${material.version}`">{{ material.label }} <button type="button" @click="removeExecutionMaterial(material.fileId)">移除</button></li></ul>
          </div>
          <div class="deliverable-actions">
            <button type="button" :disabled="!canCreateExecution" @click="createExecution">确认交给 {{ executionTargetName }} 执行</button>
            <button v-if="execution.execution.value?.state === 'QUEUED'" type="button" @click="revokeExecutionInputs">撤销未开始输入</button>
          </div>
          <p v-if="execution.executionState.value === 'creating'" class="execution-note" role="status">正在创建唯一执行记录…</p>
          <p v-if="execution.execution.value" class="execution-note">执行 {{ execution.execution.value.executionId }}：{{ execution.execution.value.state }}<template v-if="execution.execution.value.executionMode === 'TASK'">（任务工作项 {{ execution.execution.value.workItemState || '状态确认中' }}）</template></p>
          <p v-if="execution.completionNotice.value" class="execution-note" role="status">{{ execution.completionNotice.value }}</p>
          <p v-if="execution.error.value" class="deliverable-error" role="alert">{{ execution.error.value }}</p>
        </template>
      </section>

      <section v-if="conversationId" class="deliverable-directory" aria-label="本话头执行与成果">
        <div class="deliverable-directory-head">
          <strong>执行与成果</strong>
          <button type="button" :disabled="deliverables.loading.value" @click="refreshDeliverables">刷新</button>
        </div>
        <p v-if="deliverables.state.value === 'syncing'" class="deliverable-syncing" role="status">交付同步中，尚未提交待验收。</p>
        <div v-else-if="deliverables.state.value === 'unavailable' || deliverables.state.value === 'forbidden' || deliverables.state.value === 'error'" class="deliverable-error" role="alert">
          <span>{{ deliverables.message.value }}</span>
          <button type="button" @click="refreshDeliverables">重试</button>
        </div>
        <ol v-else-if="deliverables.items.value.length" class="deliverable-list">
          <li v-for="item in deliverables.items.value" :key="`${item.outputId || item.artifactId}\u0000${item.fileRef?.fileId || item.artifactRef?.artifactId}\u0000${item.fileRef?.fileVersion || item.artifactRef?.artifactVersion}`" class="deliverable-card">
            <div>
              <strong>{{ item.title }}</strong>
              <small>{{ item.mimeType }} · {{ formatBytes(item.byteLength) }}</small>
            </div>
            <p>{{ deliveryStateText(item) }}</p>
            <div class="deliverable-actions">
              <button type="button" :disabled="!item.canPreview || outputPreviewKind(item) === 'none'" @click="emitDeliverableAction('preview', item)">预览</button>
              <button type="button" :disabled="!item.canDownload || downloadingOutputId === item.outputId" @click="emitDeliverableAction('download', item)">{{ downloadingOutputId === item.outputId ? '下载中…' : '下载' }}</button>
            </div>
            <OutputPreview v-if="previewItem === item" :item="previewItem" :load="deliverables.preview" :context-key="deliverables.cacheKey.value" />
          </li>
        </ol>
        <p v-if="deliverableActionError" class="deliverable-error" role="alert">{{ deliverableActionError }}</p>
        <p v-else-if="deliverables.state.value !== 'loading'" class="deliverable-empty">暂无执行成果。</p>
      </section>

      <FormalDeliveryList
        v-if="taskExecutionMode"
        :task-id="selectedTaskId"
        :identity-fingerprint="executionIdentity"
        :conversation-id="conversationId"
        :target-agent-id="executionTargetId"
        :outputs="deliverables.items.value"
        @rework-created="adoptReworkExecution"
      />
    </div>

    <HallChatComposer
      :agents="agents"
      :discussion-variant="discussionVariant"
      :draft="draft"
      :interaction-locked="conversationBusy"
      :is-awaiting-reply="isAwaitingReply"
      :is-streaming="isStreaming"
      :mention-label="mentionLabel"
      :placeholder="placeholder"
      :selected-agent="selectedAgent"
      :target-text="targetText"
      :voice="voice"
      @clear-target="$emit('clear-target', $event)"
      @mention-agent="$emit('mention-agent', $event)"
      @send-message="$emit('send-message')"
      @update:draft="$emit('update:draft', $event)"
      @voice-apply="$emit('voice-apply', $event)"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import HallChatComposer from './HallChatComposer.vue'
import HallConversationHistory from './HallConversationHistory.vue'
import OutputPreview from '../outputs/OutputPreview.vue'
import FormalDeliveryList from '../deliveries/FormalDeliveryList.vue'
import { outputPreviewKind, outputSource, useOutputs } from '../../composables/useOutputs.js'
import { saveOutputBlob } from '../../utils/outputDownload.js'
import { usePersonalWorkspace } from '../../composables/usePersonalWorkspace.js'
import { usePersonalWorkspaceExecution } from '../../composables/usePersonalWorkspaceExecution.js'
import { usePersonalWorkspaceTaskLinks } from '../../composables/usePersonalWorkspaceTaskLinks.js'
import { usePersonalWorkspaceConversationLinks } from '../../composables/usePersonalWorkspaceConversationLinks.js'

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
  conversationId: { type: String, default: '' },
  discussionVariant: { type: String, default: 'public' },
  draft: { type: String, default: '' },
  emptyText: { type: String, default: '厅中暂无话头，可先传一句。' },
  eventStreamRecovering: { type: Boolean, default: false },
  isAwaitingReply: { type: Boolean, default: false },
  isStreaming: { type: Boolean, default: false },
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
  voice: { type: Object, default: null }
})

const emit = defineEmits([
  'clear-target',
  'delete-conversation',
  'download-deliverable',
  'load-history',
  'load-more-history',
  'load-messages',
  'mention-agent',
  'new-conversation',
  'retry-conversation',
  'select-conversation',
  'preview-deliverable',
  'send-message',
  'update:draft',
  'voice-apply'
])

const messageBoxRef = ref(null)
const deliverableSource = outputSource('conversation', () => props.conversationId)
const selectedTaskId = computed(() => {
  const candidate = String(props.selectedTask?.taskId || props.selectedTask?.id || '')
  return candidate.length > 0 && candidate.length <= 100 && !/\s/.test(candidate) ? candidate : ''
})
// The conversation id changes before a different thread is rendered; identity lifecycle cleanup
// also clears this directory, so no prior identity's references survive a switch.
const deliverables = useOutputs({
  source: deliverableSource,
  taskId: () => selectedTaskId.value,
  identityFingerprint: () => props.conversationId
})
const previewItem = ref(null)
const downloadingOutputId = ref('')
const deliverableActionError = ref('')
const executionEnabled = computed(() => ['bounty', 'private'].includes(props.discussionVariant))
const taskExecutionMode = computed(() => props.discussionVariant === 'bounty' && Boolean(selectedTaskId.value))
const executionTargetId = computed(() => {
  const candidate = String(props.selectedAgent?.agentId || props.selectedAgent?.id || '')
  return candidate.length > 0 && candidate.length <= 100 && !/\s/.test(candidate) ? candidate : ''
})
const executionTargetName = computed(() => String(props.selectedAgent?.name || props.selectedAgent?.personaName || executionTargetId.value || '当前 Agent'))
const executionIdentity = computed(() => `${props.conversationId}\u0000${executionTargetId.value}`)
const workspace = usePersonalWorkspace({ identityEpoch: executionIdentity })
const taskLinks = usePersonalWorkspaceTaskLinks({ taskId: () => taskExecutionMode.value ? selectedTaskId.value : '', identityEpoch: executionIdentity })
const conversationLinks = usePersonalWorkspaceConversationLinks({ conversationId: () => props.conversationId, identityEpoch: executionIdentity })
const execution = usePersonalWorkspaceExecution({ identityEpoch: executionIdentity })
const executionInstruction = ref('')
const executionOutputMime = ref('')
const selectedExecutionFileId = ref('')
const selectedExecutionVersion = ref(null)
const executionMaterials = ref([])
const executionLoading = computed(() => workspace.loading.value || conversationLinks.loading.value || execution.rosterState.value === 'loading' || execution.capabilityState.value === 'loading')
const selectedExecutionVersionDetail = computed(() => workspace.detail.value?.versions?.find(version => Number(version.version) === Number(selectedExecutionVersion.value)) || null)
const activeTaskInputLinks = computed(() => taskLinks.links.value.filter(link => link.state === 'ACTIVE' && link.role === 'INPUT'))
const activeConversationInputLinks = computed(() => conversationLinks.links.value.filter(link => link.state === 'ACTIVE' && link.role === 'INPUT'))
const executionWorkspaceFiles = computed(() => workspace.items.value)
const selectedTaskInputLinked = computed(() => {
  const fileId = workspace.detail.value?.file?.fileId
  const version = Number(selectedExecutionVersion.value)
  return Boolean(fileId && Number.isSafeInteger(version) && activeTaskInputLinks.value.some(link => link.fileId === fileId && Number(link.version) === version))
})
const canAddExecutionMaterial = computed(() => Boolean(workspace.detail.value?.file?.fileId && selectedExecutionVersionDetail.value && !executionMaterials.value.some(material => material.fileId === workspace.detail.value.file.fileId) && taskLinks.actionState.value !== 'saving'))
const canCreateExecution = computed(() => Boolean(
  executionEnabled.value && props.conversationId && executionTargetId.value && execution.selectedAgent.value &&
  executionOutputMime.value && execution.allowedMimeTypes.value.includes(executionOutputMime.value) &&
  executionInstruction.value.trim() && execution.executionState.value !== 'creating' &&
  (executionMaterials.value.length || execution.generationEnabled.value)
))
const conversationMaterialLabel = link => {
  const file = workspace.items.value.find(item => item.fileId === link.fileId)
  return `${file?.displayName || link.fileId} · v${link.version}`
}
const outputMimeLabel = mime => ({
  'image/png': 'PNG 图片', 'image/jpeg': 'JPEG 图片', 'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word（DOCX）',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel（XLSX）',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPT（PPTX）'
})[mime] || mime
const syncExecutionTarget = async () => {
  await execution.loadAgents()
  if (executionTargetId.value) execution.selectAgent(executionTargetId.value)
}
const refreshExecutionMaterials = async () => {
  await Promise.all([workspace.refresh({ state: 'ACTIVE' }), conversationLinks.load(), taskExecutionMode.value ? taskLinks.load() : Promise.resolve(false), execution.loadCapabilities(), syncExecutionTarget()])
  if (!execution.allowedMimeTypes.value.includes(executionOutputMime.value)) executionOutputMime.value = execution.allowedMimeTypes.value[0] || ''
}
const selectExecutionFile = async fileId => {
  const detail = await workspace.select(fileId)
  if (!detail || detail.file.state !== 'ACTIVE') return
  selectedExecutionFileId.value = detail.file.fileId
  selectedExecutionVersion.value = detail.latestVersion.version
}
const addExecutionMaterial = async () => {
  const file = workspace.detail.value?.file
  const version = selectedExecutionVersionDetail.value
  if (!file?.fileId || !version || executionMaterials.value.some(material => material.fileId === file.fileId)) return
  if (taskExecutionMode.value && !selectedTaskInputLinked.value) {
    const linked = await taskLinks.attach({ fileId: file.fileId, version: Number(version.version), role: 'INPUT' })
    if (!linked) return
  }
  executionMaterials.value = [...executionMaterials.value, { fileId: file.fileId, version: String(version.version), label: `${file.displayName} · v${version.version}` }]
}
const removeExecutionMaterial = fileId => { executionMaterials.value = executionMaterials.value.filter(material => material.fileId !== fileId) }
const detachConversationInput = link => { void conversationLinks.detach(link) }
const ensureConversationInputs = async () => {
  for (const material of executionMaterials.value) {
    const alreadyLinked = conversationLinks.links.value.some(link => link.state === 'ACTIVE' &&
      link.role === 'INPUT' && link.fileId === material.fileId && String(link.version) === String(material.version))
    if (!alreadyLinked && !await conversationLinks.attach({ fileId: material.fileId, version: Number(material.version), role: 'INPUT' })) return false
  }
  return true
}
const createExecution = async () => {
  // Selection remains a local draft until this one explicit confirmation.  The confirmed
  // execution first pins every input to this authorized conversation; task mode also pins
  // the same exact versions to the bounty before the runtime request is created.
  if (!await ensureConversationInputs()) return
  const result = await execution.create({
    inputs: executionMaterials.value.map(({ fileId, version }) => ({ fileId, version })),
    instruction: executionInstruction.value,
    outputContentMimeType: executionOutputMime.value,
    taskId: taskExecutionMode.value ? selectedTaskId.value : null,
    conversationId: props.conversationId
  })
  if (result) executionInstruction.value = ''
}
const adoptReworkExecution = result => {
  if (!execution.adoptExecution(result)) return
  executionInstruction.value = ''
  void deliverables.refresh()
}
const revokeExecutionInputs = () => { void execution.revokeInputs() }
const formatBytes = value => Number.isSafeInteger(value) ? `${value} 字节` : '大小待确认'
const refreshDeliverables = () => { void deliverables.refresh() }
const deliveryStateText = item => {
  if (item?.publicationState !== 'PUBLISHED') return '已归档到个人空间，非正式验收。'
  return ({ submitted: '已提交正式待验收。', accepted: '已正式验收通过。', changes_requested: '已要求修改，需按指定版本返工。' })[item.formalDeliveryState] || '正式交付状态待确认。'
}
const deliverableReference = item => Object.freeze({
  conversationId: props.conversationId,
  outputId: item.outputId,
  executionId: item.executionId,
  fileRef: item.fileRef ? Object.freeze({ fileId: item.fileRef.fileId, fileVersion: item.fileRef.fileVersion }) : null,
  artifactRef: item.artifactRef ? Object.freeze({ artifactId: item.artifactRef.artifactId, artifactVersion: item.artifactRef.artifactVersion, taskId: item.artifactRef.taskId }) : null
})
const downloadDeliverable = async item => {
  downloadingOutputId.value = item.outputId
  deliverableActionError.value = ''
  try {
    const blob = await deliverables.download(item)
    saveOutputBlob({ blob, item })
  } catch (error) {
    if (error?.name !== 'AbortError') deliverableActionError.value = error?.message || '下载失败，请刷新后确认。'
  } finally {
    if (downloadingOutputId.value === item.outputId) downloadingOutputId.value = ''
  }
}
const emitDeliverableAction = (action, item) => {
  if (!item || !props.conversationId || (action === 'download' && !item.canDownload) || (action === 'preview' && !item.canPreview)) return
  // Reference-only compatibility event: never retain or render URLs, storage locations, leases, credentials, or prompt content.
  emit(action === 'preview' ? 'preview-deliverable' : 'download-deliverable', deliverableReference(item))
  if (action === 'preview') { previewItem.value = previewItem.value === item ? null : item; deliverableActionError.value = '' }
  else void downloadDeliverable(item)
}
const historyOpen = ref(false)
const pendingAuthor = '聚义厅'
const toggleHistory = () => {
  historyOpen.value = !historyOpen.value
  if (historyOpen.value) emit('load-history')
}
const taskText = computed(() => props.selectedTask?.title || '未选榜文')
const resolvedSubtitle = computed(() => {
  if (props.subtitle) return props.subtitle
  if (props.discussionVariant === 'bounty') return taskText.value
  if (props.discussionVariant === 'private') return props.targetText
  if (props.selectedTask) return taskText.value
  if (props.selectedAgent) return props.targetText
  return props.scopeHint === 'public' ? '未 @ 时由宋江分拨' : props.scopeHint
})
const displayStatus = computed(() => {
  if (props.eventStreamRecovering) return '正在续上传令'
  return props.connectionStatus || (props.isAwaitingReply ? pendingLabel.value : '传令畅通')
})
const pendingLabel = computed(() => {
  if (props.pendingAgentName) return `${props.pendingAgentName} 正在回话...`
  return '正在整理回报...'
})
const renderMarkdown = (content = '') => DOMPurify.sanitize(marked(String(content || '')))

watch(() => props.eventStreamRecovering, (recovering, wasRecovering) => {
  if (wasRecovering && !recovering && props.conversationId) refreshDeliverables()
})

watch(() => props.conversationId, () => {
  previewItem.value = null
  downloadingOutputId.value = ''
  deliverableActionError.value = ''
})

watch(executionIdentity, () => {
  selectedExecutionFileId.value = ''
  selectedExecutionVersion.value = null
  executionMaterials.value = []
  executionInstruction.value = ''
  if (executionEnabled.value && props.conversationId) void refreshExecutionMaterials()
}, { flush: 'sync' })

watch(() => execution.execution.value?.state, state => {
  if (state === 'OUTPUT_COMMITTED') refreshDeliverables()
})

onMounted(() => { if (executionEnabled.value && props.conversationId) void refreshExecutionMaterials() })
onBeforeUnmount(() => { workspace.dispose(); taskLinks.dispose(); conversationLinks.dispose(); execution.dispose() })

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

.icon-button {
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


<style scoped>
.deliverable-directory {
  margin: 12px 0 4px;
  padding: 10px;
  border: 1px solid rgba(116, 75, 35, 0.16);
  border-radius: 8px;
  background: rgba(255, 253, 246, 0.9);
  color: #4a3423;
}

.deliverable-directory-head,
.deliverable-actions,
.deliverable-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.deliverable-directory-head strong { font-size: 13px; }
.deliverable-directory button {
  padding: 4px 8px;
  border: 1px solid rgba(109, 63, 31, 0.45);
  border-radius: 5px;
  background: transparent;
  color: #6d3f1f;
  font-size: 12px;
}
.deliverable-list { display: grid; gap: 8px; margin: 8px 0 0; padding: 0; list-style: none; }
.deliverable-card { padding: 8px; border-radius: 6px; background: #fff8e8; }
.deliverable-card > div:first-child { display: flex; justify-content: space-between; gap: 8px; }
.deliverable-card small { color: #8a6f4b; overflow-wrap: anywhere; }
.deliverable-card p, .deliverable-empty, .deliverable-syncing { margin: 6px 0 0; color: #765f40; font-size: 12px; }
.deliverable-syncing { color: #9a6e40; }
.deliverable-error { margin-top: 8px; color: #a23f32; font-size: 12px; }
.deliverable-actions { justify-content: flex-end; margin-top: 8px; }
.execution-directory { display: grid; gap: 8px; margin-top: 12px; padding: 10px; border: 1px solid #d7c3a2; border-radius: 7px; background: #fffdf6; }
.execution-note { margin: 0; color: #765f40; font-size: 12px; line-height: 1.5; }
.execution-field { display: grid; gap: 4px; color: #4a3423; font-size: 12px; }
.execution-field select,.execution-field textarea { box-sizing: border-box; width: 100%; border: 1px solid #d7c3a2; border-radius: 6px; background: #fff; color: #4a3423; font: inherit; }
.execution-field textarea { min-height: 72px; padding: 7px; resize: vertical; }
.execution-materials { display: grid; gap: 6px; }.execution-materials > strong { font-size: 12px; }.execution-file-list { display: grid; max-height: 140px; gap: 5px; overflow: auto; }
.execution-file-list button,.execution-material-list button { text-align: left; border: 1px solid #d7c3a2; border-radius: 5px; background: #fff; color: #4a3423; padding: 5px 7px; }.execution-file-list button.selected { border-color: #7c1f1b; background: #f3e0bc; }
.execution-material-list { display: grid; gap: 4px; margin: 0; padding-left: 18px; color: #765f40; font-size: 12px; }.execution-material-list li { display: flex; justify-content: space-between; gap: 8px; }
.execution-material-list button { padding: 1px 5px; }
</style>
