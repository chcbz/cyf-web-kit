<template>
  <section class="formal-task-delivery-panel" aria-label="正式成果办理">
    <div class="formal-task-delivery-intro">
      <p v-if="!source">返工前请进入本榜文议事，并明确选定已指派好汉；不会使用私人会话或其他榜文成果。</p>
      <button v-if="!source" type="button" @click="$emit('discuss-task')">进入本榜文议事</button>
      <p v-else>返工承办人：{{ executionContext.targetAgentId }} · 使用本榜文议事中的固定成果版本。</p>
      <p v-if="source && ['unavailable', 'forbidden', 'syncing'].includes(outputs.state.value)" role="status">{{ outputs.message.value }}</p>
    </div>
    <FormalDeliveryList
      :key="`${taskId}:${identityFingerprint}:${source?.id || ''}:${selectedAgentId}`"
      :task-id="taskId"
      :identity-fingerprint="identityFingerprint"
      :focus-delivery-id="focusDeliveryId"
      :conversation-id="source?.id || ''"
      :target-agent-id="source ? executionContext.targetAgentId : ''"
      :outputs="source ? outputs.items.value : []"
      :read-outputs="taskOutputs.items.value"
      :preview-output-key="previewOutputKey"
      :adapter="deliveryAdapter"
      @refreshed="refreshOutputs"
      @preview-output="togglePreview"
      @download-output="downloadOutput"
      @rework-created="$emit('rework-created', $event)"
    >
      <template #preview="{ output }">
        <OutputPreview :item="output" :load="taskOutputs.preview" :context-key="taskOutputs.cacheKey.value" />
      </template>
    </FormalDeliveryList>
    <div class="formal-task-delivery-status">
      <p v-if="taskOutputs.loading.value" class="formal-output-state" role="status">正在核对可下载的固定成果版本…</p>
      <p v-else-if="actionError" class="formal-output-state is-error" role="alert">{{ actionError }} <button type="button" @click="retryDownload">重试</button></p>
    </div>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import FormalDeliveryList from './FormalDeliveryList.vue'
import OutputPreview from '../outputs/OutputPreview.vue'
import { useOutputs } from '../../composables/useOutputs.js'
import { saveOutputBlob } from '../../utils/outputDownload.js'

const props = defineProps({
  taskId: { type: String, required: true },
  identityFingerprint: { type: String, required: true },
  focusDeliveryId: { type: String, default: '' },
  executionContext: { type: Object, default: () => ({}) },
  selectedAgentId: { type: String, default: '' },
  outputAdapter: { type: Object, default: undefined },
  deliveryAdapter: { type: Object, default: undefined }
})
defineEmits(['discuss-task', 'rework-created'])
// The Hall proves the task/conversation/assignment relationship. Viewing a
// delivery alone must never choose an actor or borrow an unrelated conversation.
const source = computed(() => {
  const scope = props.executionContext
  return props.identityFingerprint && scope.taskId === props.taskId && scope.conversationConfirmed === true &&
    scope.conversationId && scope.targetAgentId && scope.targetAgentId === props.selectedAgentId
    ? { type: 'conversation', id: scope.conversationId } : null
})
const outputs = useOutputs({
  source, taskId: () => props.taskId, identityFingerprint: () => props.identityFingerprint,
  adapter: props.outputAdapter, pageSize: 100
})
const taskSource = computed(() => props.identityFingerprint && props.taskId ? { type: 'task', id: props.taskId } : null)
const taskOutputs = useOutputs({
  source: taskSource, identityFingerprint: () => props.identityFingerprint,
  adapter: props.outputAdapter, pageSize: 100
})
const previewItem = ref(null)
const outputKey = item => item ? `${item.artifactId}:${item.artifactVersion}:${item.sha256}` : ''
const previewOutputKey = computed(() => outputKey(previewItem.value))
const actionError = ref('')
const retryItem = ref(null)
watch(() => `${props.taskId}:${props.identityFingerprint}`, () => {
  previewItem.value = null
  actionError.value = ''
  retryItem.value = null
})
const refreshOutputs = () => {
  if (source.value) void outputs.refresh()
  void taskOutputs.refresh()
}
const togglePreview = item => { previewItem.value = previewOutputKey.value === outputKey(item) ? null : item }
const downloadOutput = async item => {
  actionError.value = ''
  retryItem.value = null
  try {
    const result = await taskOutputs.download(item)
    saveOutputBlob({ blob: result instanceof Blob ? result : result?.blob, item })
  } catch (error) {
    if (error?.name !== 'AbortError') {
      actionError.value = error?.message || '下载失败，请刷新确认。'
      retryItem.value = item
    }
  }
}
const retryDownload = () => retryItem.value ? void downloadOutput(retryItem.value) : void taskOutputs.refresh()
</script>

<style scoped>
.formal-task-delivery-panel{display:grid;grid-template-rows:auto minmax(0,1fr) auto;flex:1 1 auto;min-width:0;min-height:0;overflow:hidden}.formal-task-delivery-intro,.formal-task-delivery-status{min-width:0}.formal-task-delivery-intro{display:grid;gap:6px}.formal-task-delivery-intro p{margin:0}.formal-output-state{margin:10px 0 0;padding:8px;border-radius:6px;background:#f7edcf;color:#765d2d;font-size:13px}.formal-output-state.is-error{background:#fae7e1;color:#7a3026}.formal-output-state button{min-height:36px;margin-left:6px;border:1px solid #315d4e;border-radius:5px;padding:5px 9px;color:#fff;background:#315d4e}
</style>
