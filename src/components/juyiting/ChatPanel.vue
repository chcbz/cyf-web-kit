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
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 11-2l3 3M4 16l3 3a7 7 0 0 0 11-2" /></svg>
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
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 5v5h5M3 10a9 9 0 1 1 2 8M12 7v5l3 2" /></svg>
        </button>
        <button
          class="icon-button primary"
          type="button"
          title="另起话头"
          aria-label="另起话头"
          :disabled="conversationBusy || voice?.voiceInteractionLocked"
          @click="$emit('new-conversation')"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <button
          v-if="durableCancelTarget"
          class="icon-button"
          type="button"
          title="取消待处理回话"
          aria-label="取消待处理回话"
          @click="$emit('cancel-deliberation', durableCancelTarget)"
        ><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
        <button
          v-else-if="legacyCancelAvailable"
          class="icon-button"
          type="button"
          title="停止旧版回话等待"
          aria-label="停止旧版回话等待"
          @click="$emit('cancel-legacy-transport')"
        ><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18" /></svg></button>

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
        <ArchiveMaintenanceReceiptCard v-if="isArchiveMaintenanceReceipt(message.content, message.sender)" :content="message.content" :api="archiveApi"
          @open-maintenance="$emit('open-maintenance-job', $event)" @open-edition="$emit('open-archive-edition', $event)" />
        <div v-else-if="message.content" class="message-content" v-html="renderMarkdown(message.content)"></div>
        <div v-if="isTaskDiscussion && message.typedTaskId === taskId && message.typedSourceSelectors?.length" class="message-parts" aria-label="本条消息资料">
          <article v-for="(source, index) in message.typedSourceSelectors" :key="index" class="task-material-reference">
            <template v-if="source.kind === 'TASK_LINKED_WORKSPACE_VERSION'">
              <strong>{{ materialName(source) }}</strong><span>版本 {{ source.version }} · {{ source.purpose === 'INPUT' ? '输入资料' : '参考资料' }}</span>
            </template>
            <template v-else><strong>会话资料 {{ source.assetId }}</strong><span>修订 {{ source.assetRevision }}</span></template>
          </article>
        </div>
        <BountyTextSelectionArchive
          v-if="isTaskDiscussion"
          :conversation-id="conversationId"
          :identity-key="materialIdentityKey"
          :message="message"
        />
        <HallMessageParts
          :parts="message.parts"
          :conversation-id="conversationId"
          :identity-key="materialIdentityKey"
          :identity-scope="identityScope"
        />
        <BountyTypedOutcomeCard
          v-for="projection in typedForMessage(message)"
          :key="projection.key"
          :projection="projection"
          @reply="$emit('typed-reply', $event)"
        />
        <small v-if="message.statusText" class="message-status">{{ message.statusText }}</small>
      </div>
      <slot name="bounty-results"></slot>
      <p v-if="deliberationStatus" class="deliberation-status">{{ deliberationStatus }}</p>
      <div v-if="isAwaitingReply" class="hall-message SYSTEM is-pending">
        <strong>{{ pendingAuthor }}</strong>
        <div class="message-content" v-html="renderMarkdown(pendingLabel)"></div>
      </div>
      <div v-if="!messages.length" class="empty-list">{{ emptyText }}</div>


    </div>

    <HallChatComposer
      :agents="agents"
      :discussion-variant="discussionVariant"
      :draft="draft"
      :has-typed-attachments="typedEnabled && discussionVariant === 'bounty' && typedSourceSelectors.length > 0"
      :interaction-locked="conversationBusy || serverTaskCompleted"
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
      @clear-target="$emit('clear-target', $event)"
      @mention-agent="$emit('mention-agent', $event)"
      @send-message="$emit('send-message', typedEnabled && discussionVariant === 'bounty' ? { sourceSelectors: typedSourceSelectors } : undefined)"
      @update:draft="$emit('update:draft', $event)"
      @voice-apply="$emit('voice-apply', $event)"
      @open-materials="toggleMaterialPicker"
      @open-workspace="$emit('open-workspace')"
    >
      <template #materials>
        <section v-if="materialPickerOpen && !serverTaskCompleted" class="material-reference-picker" aria-label="引用议事资料">
          <div class="material-reference-heading">
            <div>
              <strong>{{ isTaskDiscussion ? '本次需求的资料' : '引用资料' }}</strong>
              <small>{{ isTaskDiscussion ? '图片、文档、音频等都可以作为资料，由 Agent 按需求使用。' : '引用固定到当前话头及所选版本；不会把资料内容或假摘要写入消息。' }}</small>
            </div>
            <button type="button" aria-label="收起引用资料" @click="materialPickerOpen = false">
              <var-icon name="close" />
            </button>
          </div>
          <p v-if="!hasMaterialScope" class="material-reference-notice">
            {{ isTaskDiscussion ? '未确认当前事项标识，不能读取或展示资料。' : '请先发送一条消息建立话头，再从百宝箱引用资料。' }}
          </p>
          <template v-else>
            <p v-if="materialError" class="material-reference-error" role="alert">{{ materialError }}</p>
            <div v-if="materialLoading" class="material-reference-state">正在查找百宝箱资料…</div>
            <div v-if="isTaskDiscussion" class="task-material-directory">
              <p v-if="!activeMaterialLinks.length" class="material-reference-state">暂未添加资料，不影响继续讨论。</p>
              <article v-for="link in activeMaterialLinks" :key="link.relationId" class="task-material-reference">
                <div><strong>{{ materialName(link) }}</strong><small>v{{ link.version }} · {{ link.role === 'INPUT' ? '用于办理' : '参考资料' }}</small></div>
                <p>可随消息发送，Agent 会按需求使用。</p>
                <label v-if="typedEnabled" class="typed-source-selector"><input type="checkbox" :checked="typedSelectedSourceIds.has(`${link.fileId}\u0000${link.version}`)" @change="toggleTypedSource(link, $event.target.checked)" /> 随本条消息发送</label>
              </article>
              <p class="material-reference-notice">资料可选；直接描述你想要的结果即可。</p>
            </div>
            <template v-else>
              <div v-if="!workspace.items.value?.length" class="material-reference-state">
                百宝箱暂无可引用资料。
                <button type="button" @click="$emit('open-workspace')">去百宝箱添加</button>
              </div>
              <ul v-else class="material-reference-list">
                <li v-for="file in workspace.items.value" :key="file.fileId">
                  <div class="material-reference-file">
                    <strong :title="file.displayName">{{ file.displayName }}</strong>
                    <small>版本 {{ file.latestVersion }}</small>
                  </div>
                  <button
                    v-if="linkedFileIds.has(`${file.fileId}:${file.latestVersion}`)"
                    type="button"
                    class="material-reference-linked"
                    :disabled="materialActionBusy"
                    @click="removeMaterialReference(linkFor(file))"
                  >移除引用</button>
                  <button
                    v-else
                    type="button"
                    :disabled="materialActionBusy"
                    @click="addMaterialReference(file)"
                  >引用</button>
                </li>
              </ul>
              <div v-if="activeMaterialLinks.length" class="active-material-references">
                <span>本话头已引用：</span>
                <button
                  v-for="link in activeMaterialLinks"
                  :key="link.relationId"
                  type="button"
                  :disabled="materialActionBusy"
                  @click="removeMaterialReference(link)"
                >{{ materialName(link) }} · v{{ link.version }} <var-icon name="close" /></button>
              </div>
            </template>
          </template>
        </section>
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
import HallConversationHistory from './HallConversationHistory.vue'
import ArchiveMaintenanceReceiptCard from './archive/ArchiveMaintenanceReceiptCard.vue'
import BountyTypedOutcomeCard from './BountyTypedOutcomeCard.vue'
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
  archiveApi: { type: Object, default: null },
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
  legacyCancelAvailable: { type: Boolean, default: false },
  conversationId: { type: String, default: '' },
  discussionVariant: { type: String, default: 'public' },
  draft: { type: String, default: '' },
  emptyText: { type: String, default: '厅中暂无话头，可先传一句。' },
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
  typedOutcomes: { type: Array, default: () => [] },
  typedPendingQuestion: { type: Object, default: null },
  typedEnabled: { type: Boolean, default: false }
})

const emit = defineEmits([
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
  'update:draft',
  'voice-apply',
  'typed-reply',
])

const messageBoxRef = ref(null)
const historyOpen = ref(false)
const materialPickerOpen = ref(false)
const pendingAuthor = '聚义厅'
const materialIdentityKey = computed(() => `${props.identityEpoch}\u0000${props.identityScope}`)
const taskId = computed(() => String(props.selectedTask?.id || '').trim())
const serverTaskCompleted = computed(() => props.discussionVariant === 'bounty' && props.selectedTask?.status === 'completed')
const typedForMessage = message => props.typedOutcomes.filter(projection =>
  projection?.outcome?.assistantMessageId === String(message?.localId || ''))

const isTaskDiscussion = computed(() => props.discussionVariant === 'bounty')
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
const typedSelectedSourceIds = ref(new Set())
const hasMaterialScope = computed(() => isTaskDiscussion.value ? Boolean(taskId.value) : Boolean(props.conversationId))
const selectedMaterialDirectory = computed(() => isTaskDiscussion.value ? taskMaterialLinks : conversationMaterialLinks)
const materialLoading = computed(() => workspace.loading.value || selectedMaterialDirectory.value.loading.value)
const materialActionBusy = computed(() => ['saving', 'removing'].includes(selectedMaterialDirectory.value.actionState.value))
const materialError = computed(() => selectedMaterialDirectory.value.error.value || workspace.error.value)
const activeMaterialLinks = computed(() => selectedMaterialDirectory.value.links.value.filter(link => link.state === 'ACTIVE' &&
  (isTaskDiscussion.value ? ['INPUT', 'REFERENCE'].includes(link.role) : link.role === 'REFERENCE')))
const linkedFileIds = computed(() => new Set(activeMaterialLinks.value.map(link => `${link.fileId}:${link.version}`)))
const linkFor = file => activeMaterialLinks.value.find(link => link.fileId === file.fileId && link.version === file.latestVersion)
const materialName = link => materialNames.value[link.fileId] || workspace.items.value.find(file => file.fileId === link.fileId)?.displayName || `资料 ${link.fileId}`
const typedSourceSelectors = computed(() => activeMaterialLinks.value.filter(link => typedSelectedSourceIds.value.has(`${link.fileId}\u0000${link.version}`) ).map(link => ({ kind: 'TASK_LINKED_WORKSPACE_VERSION', fileId: link.fileId, version: String(link.version), purpose: link.role, assetId: null, assetRevision: null })))
const toggleTypedSource = (link, selected) => {
  if (!props.typedEnabled || !link || !['INPUT', 'REFERENCE'].includes(link.role)) return
  const next = new Set(typedSelectedSourceIds.value); const key = `${link.fileId}\u0000${link.version}`
  if (selected) next.add(key); else next.delete(key)
  typedSelectedSourceIds.value = next
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
const refreshMaterialReferences = async () => {
  if (!hasMaterialScope.value) return
  const operationKey = `${materialIdentityKey.value}\u0000${taskId.value}\u0000${props.conversationId}`
  const directory = selectedMaterialDirectory.value
  const [, loaded] = await Promise.all([workspace.refresh({ state: 'ACTIVE' }), directory.load()])
  if (!loaded || operationKey !== `${materialIdentityKey.value}\u0000${taskId.value}\u0000${props.conversationId}`) return
  await resolveMaterialNames(operationKey)
}
const toggleMaterialPicker = async () => {
  if (serverTaskCompleted.value) { materialPickerOpen.value = false; return }
  materialPickerOpen.value = !materialPickerOpen.value
  if (materialPickerOpen.value) await refreshMaterialReferences()
}
const addMaterialReference = async file => {
  if (isTaskDiscussion.value) return
  await conversationMaterialLinks.attach({ fileId: file.fileId, version: file.latestVersion, role: 'REFERENCE' })
}
const removeMaterialReference = async link => {
  if (!link || isTaskDiscussion.value) return
  await conversationMaterialLinks.detach(link)
}
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
const isArchiveMaintenanceReceipt = (content, sender) => { try { return ['ASSISTANT', 'SYSTEM', 'AGENT', 'assistant', 'system', 'agent'].includes(sender) && JSON.parse(content)?.type === 'archive_maintenance_receipt' } catch { return false } }

watch(() => props.messages, () => {
  nextTick(() => {
    if (messageBoxRef.value) {
      messageBoxRef.value.scrollTop = messageBoxRef.value.scrollHeight
    }
  })
}, { deep: true })

watch(() => `${materialIdentityKey.value}\u0000${taskId.value}\u0000${props.conversationId}\u0000${serverTaskCompleted.value}`, () => {
  materialPickerOpen.value = false
  materialNames.value = {}
  typedSelectedSourceIds.value = new Set()
}, { flush: 'sync' })
onBeforeUnmount(() => {
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

.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 38px;
  height: 38px;
  padding: 0;
  flex: 0 0 auto;
  border-radius: 8px;
  background: transparent;
  color: #4a3423;
  white-space: nowrap;
}

.icon-button svg {
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
}

.icon-button:hover:not(:disabled) {
  background: #f2e8d8;
}

.icon-button:focus-visible {
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
</style>

<style scoped>
.task-material-directory{display:grid;gap:8px}.task-material-reference{display:grid;gap:5px;padding:10px 12px;border:1px solid #d8ded8;border-radius:8px;background:#f6faf7}.task-material-reference>div{display:flex;align-items:baseline;justify-content:space-between;gap:8px}.task-material-reference strong,.task-material-reference small{overflow-wrap:anywhere}.task-material-reference small{color:#5f746b;font-size:11px}.task-material-reference p{margin:0;color:#5b6963;font-size:12px;line-height:1.55}.material-reference-notice{line-height:1.55}
</style>
