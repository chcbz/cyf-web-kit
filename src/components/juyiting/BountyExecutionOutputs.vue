<template>
  <section v-if="enabled && (acceptance || scopedSteps.length || finalizeState.intent || finalizeState.message)" class="bounty-output-gallery" aria-label="悬赏议事成果">
    <strong>{{ acceptance ? '本次成果与验收' : '议事成果' }}</strong>
    <p v-if="error" role="alert">{{ error }} <button type="button" @click="refresh">重新读取</button></p>
    <p v-else-if="!displayItems.length" role="status">{{ loading ? '正在读取已提交成果…' : deliveryMessage || '结果完成后会显示在这里。' }}</p>
    <div v-for="item in displayItems" :key="outputItemKey(item)" class="bounty-output">
      <strong>{{ previewKind(item.contentMimeType) === 'image' ? '图片' : previewKind(item.contentMimeType) === 'audio' ? '音频' : previewKind(item.contentMimeType) === 'text' ? '文本' : '文件' }}</strong>
      <p v-if="item.messageSource" class="bounty-output-text">{{ item.text }}</p>
      <span>{{ item.contentMimeType }} · {{ item.byteLength }} 字节</span>
      <button v-if="item.previewUrl && previewKind(item.contentMimeType) !== 'file'" type="button" @click="loadPreview(item)">预览</button>
      <button type="button" @click="download(item)">下载</button>
      <button
        v-if="!item.messageSource"
        type="button"
        :disabled="!outputAssetPart(item) || archiveState(item).busy || archiveState(item).state === 'saved'"
        @click="archive(item)"
      >{{ archiveState(item).state === 'saved' ? '已保存到工作空间' : archiveState(item).busy ? '正在保存…' : !outputAssetPart(item) ? '等待资产登记' : '保存到工作空间' }}</button>
      <button v-if="archiveState(item).state === 'unknown'" type="button" @click="archive(item)">重试原保存</button>
      <p v-if="!item.messageSource && archiveState(item).message" :role="['saved', 'waiting_asset', 'pending', 'saving'].includes(archiveState(item).state) ? 'status' : 'alert'">{{ archiveState(item).message }}</p>
      <p v-if="itemErrors[outputItemKey(item)]" role="alert">{{ itemErrors[outputItemKey(item)] }}</p>
      <p v-if="textPreviews[outputItemKey(item)]" class="bounty-output-text">{{ textPreviews[outputItemKey(item)] }}</p>
      <template v-if="previewUrls[outputItemKey(item)]">
        <button v-if="previewKind(item.contentMimeType) === 'image'" class="image-preview" type="button" @click="expandedUrl = previewUrls[outputItemKey(item)]"><img :src="previewUrls[outputItemKey(item)]" alt="议事生成图片" /></button>
        <audio v-else-if="previewKind(item.contentMimeType) === 'audio'" :src="previewUrls[outputItemKey(item)]" controls preload="none" aria-label="议事生成音频" />
        <span v-else>此格式请下载查看。</span>
      </template>
      <small v-if="item.replaces">改稿关联：{{ item.replaces.outputId }}（原稿仍保留）</small>
      <small v-if="!effectiveTaskCompleted">需要调整？直接在会话中告诉 Agent。</small>
    </div>
    <button v-if="acceptance && (effectiveTaskCompleted || displayItems.length || finalizeState.intent)" type="button" class="finalize-button" :disabled="effectiveTaskCompleted || loading || !!error || finalizeState.busy || finalizeState.state === 'recovery_error' || (finalizeState.receipt?.state === 'failed' && !finalizeState.receipt.retryable)" @click="finalizeSelected">{{ effectiveTaskCompleted ? '需求已完成' : finalizeState.busy ? '正在验收…' : finalizeState.intent ? '继续验收' : '确认验收' }}</button>
    <button v-if="acceptance && !effectiveTaskCompleted && finalizeState.intent" type="button" class="finalize-status-button" :disabled="finalizeState.busy" @click="finalizations.check">查询验收状态</button>
    <small v-if="acceptance && !effectiveTaskCompleted && finalizeState.intent">本次验收已冻结 {{ finalizeState.intent.body.selectedOutputs.length }} 项成果；可刷新查看进度。</small>
    <p v-if="finalizeState.message" :role="finalizeState.state === 'completed' ? 'status' : 'alert'">{{ finalizeState.message }}</p>
    <button
      v-if="acceptance && !effectiveTaskCompleted"
      type="button"
      class="continue-modification"
      @click="$emit('continue-modification')"
    >继续修改</button>
    <small>可以预览、下载或保存；保存不是验收前置。</small>
    <div v-if="expandedUrl" class="image-overlay" role="dialog" aria-modal="true" aria-label="放大查看议事图片" @click.self="expandedUrl = ''" @keydown.esc="expandedUrl = ''">
      <button type="button" @click="expandedUrl = ''">关闭</button><img :src="expandedUrl" alt="放大后的议事图片" />
    </div>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { createApi } from '../../composables/useHttp.js'
import { exactOutputId, outputCatalogItems, outputItemKey, previewKind, scopedExecutionSteps, downloadMimeType, outputDownloadName, outputAssetPart, currentOutputDelivery, completedTextItem, completedExecutionDelivery } from '../../composables/juyiting/bountyOutputCatalog.js'
import { saveOutputBlob } from '../../utils/outputDownload.js'
import { useHallConversationArchive } from '../../composables/juyiting/useHallConversationArchive.js'
import { useHallBountyFinalization, safeFinalizationVersion } from '../../composables/juyiting/useHallBountyFinalization.js'

const emit = defineEmits(['task-completed', 'continue-modification'])
const props = defineProps({
  acceptance: { type: Boolean, default: false },
  taskCompleted: { type: Boolean, default: false },
  enabled: { type: Boolean, default: false }, request: { type: Object, default: null },
  conversationId: { type: String, default: '' }, identityKey: { type: String, default: '' },
  catalog: { type: Array, default: () => [] },
  taskVersion: { type: [String, Number], default: '' }, taskId: { type: String, default: '' }
})
const api = createApi('/chat')
const agentApi = createApi('/agent')
const archives = useHallConversationArchive({ api,
  conversationId: () => props.enabled && props.identityKey ? props.conversationId : null,
  identityEpoch: () => `${props.enabled}\u0000${props.identityKey}`,
  identityScope: () => props.identityKey
})
const requestSnapshots = ref([])
const catalogRequests = computed(() => Array.isArray(props.catalog) && props.catalog.length
  ? props.catalog.map(entry => entry?.request).filter(Boolean)
  : (props.request ? [props.request] : []))
const scopedSteps = computed(() => requestSnapshots.value.flatMap(request => scopedExecutionSteps(request, props.conversationId)))
const executionDeliveries = ref([])
const items = ref([]); const loading = ref(false); const error = ref('')
const previewUrls = ref({}); const textPreviews = ref({}); const itemErrors = ref({})
const expandedUrl = ref('')
const finalizations = useHallBountyFinalization({ api: agentApi,
  conversationId: () => props.enabled ? props.conversationId : null, identityKey: () => props.identityKey
})
const finalizeState = finalizations.status
// A validated completed receipt is immediate terminal authority even while the parent task DTO is stale.
const effectiveTaskCompleted = computed(() => props.taskCompleted || (finalizeState.value.state === 'completed' &&
  finalizeState.value.receipt?.taskId === props.taskId && finalizeState.value.receipt?.conversationId === props.conversationId))
// Once acceptance starts, display only the original exact references from its durable intent.
// A new output/late poll cannot replace accepted or in-flight displayed content.
const deliveryProjection = computed(() => {
  if (!props.acceptance) return { items: items.value, message: '' }
  const frozen = finalizeState.value.intent?.body.selectedOutputs
  if (frozen) {
    const list = frozen.map(source => items.value.find(item => outputItemKey(item) === outputItemKey(source) && item.sha256 === source.sha256))
    return list.every(Boolean) ? { items: list, message: '' } : { items: [], message: '正在读取本次验收冻结的原成果；不会换用新稿。' }
  }
  try { return { items: currentOutputDelivery(items.value, executionDeliveries.value), message: '' } }
  catch (cause) { return { items: [], message: cause.message } }
})
const displayItems = computed(() => deliveryProjection.value.items)
const deliveryMessage = computed(() => deliveryProjection.value.message)
let lastCompletedOperation = ''
watch(() => finalizeState.value.receipt, receipt => {
  if (!props.enabled || finalizeState.value.state !== 'completed' || !receipt) return
  const key = JSON.stringify([props.identityKey, props.conversationId, receipt.operationId])
  if (key === lastCompletedOperation) return
  lastCompletedOperation = key
  // The composable validated original scope, exact selection, accepted delivery and domain task completion.
  // This is a request to refresh the server projection, not a local task-status mutation.
  emit('task-completed', Object.freeze({ taskId: receipt.taskId, conversationId: receipt.conversationId,
    operationId: receipt.operationId, deliveryId: receipt.deliveryId, taskVersion: receipt.taskVersion }))
}, { flush: 'sync' })
let abort = null; let timer = null; let epoch = 0
const inFlight = new Set()
const validRootRequest = () => props.enabled && catalogRequests.value.length > 0 && catalogRequests.value.every(request => exactOutputId(request?.requestId) && request.conversationId === props.conversationId)
const sha256Blob = async blob => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('')
const patchMap = (target, key, value) => { target.value = { ...target.value, [key]: value } }
const archiveState = item => {
  const part = outputAssetPart(item)
  return part ? archives.statusFor(part) : { state: 'waiting_asset', busy: false,
    message: '成果已提交，正在等待持久会话资产登记；暂不能保存。' }
}
const cleanup = () => {
  epoch++; if (timer != null) clearTimeout(timer); timer = null; abort?.abort(); abort = null
  for (const controller of inFlight) controller.abort(); inFlight.clear()
  for (const url of Object.values(previewUrls.value)) URL.revokeObjectURL(url)
  requestSnapshots.value = []; items.value = []; executionDeliveries.value = []; previewUrls.value = {}; textPreviews.value = {}
  archives.reset()
  itemErrors.value = {}
  expandedUrl.value = ''; loading.value = false; error.value = ''
}
const fetchRequest = async (requestId, controller) => {
  const response = await api.get(`/requests/${encodeURIComponent(requestId)}`, {}, { autoLoading: false, needAuth: true, signal: controller.signal })
  const value = response?.data?.data ?? response?.data
  if (value?.requestId !== requestId || value?.conversationId !== props.conversationId) throw new Error('议事请求范围不匹配')
  return value
}
const list = async () => {
  if (!validRootRequest() || abort) return
  const generation = epoch; const controller = new AbortController(); abort = controller; loading.value = true
  try {
    const ids = [...new Set(catalogRequests.value.map(request => request.requestId))]
    const snapshots = []
    for (const id of ids) snapshots.push(await fetchRequest(id, controller))
    if (generation !== epoch || controller.signal.aborted) return
    requestSnapshots.value = snapshots
    const catalog = []; const deliveries = []
    if (props.acceptance && props.taskId) for (const request of snapshots) {
      for (const turn of request.turns || []) {
        if (turn.route !== 'CHAT' || !['FINAL_PERSISTED', 'PUBLISHED'].includes(turn.state)) continue
        const response = await api.get(`/conversations/${encodeURIComponent(props.conversationId)}/requests/${encodeURIComponent(request.requestId)}/typed-outcome`, {},
          { autoLoading: false, needAuth: true, signal: controller.signal })
        const text = await completedTextItem(response?.data?.data ?? response?.data, request, turn, props.taskId)
        if (controller.signal.aborted || generation !== epoch) return
        if (text) catalog.push(text)
        const delivery = completedExecutionDelivery(response?.data?.data ?? response?.data, request, turn, snapshots, props.taskId)
        if (delivery) deliveries.push(delivery)
      }
    }
    for (const step of scopedSteps.value) {
      try {
        const response = await api.get(`/requests/${encodeURIComponent(step.requestId)}/steps/${encodeURIComponent(step.stepId)}/outputs`, {}, { autoLoading: false, needAuth: true, signal: controller.signal })
        const data = response?.data?.data ?? response?.data
        const normalized = outputCatalogItems(data, step.requestId, step.stepId)
        if (Array.isArray(data) && normalized.length === data.length) catalog.push(...normalized)
        else if (Array.isArray(data) && data.length) throw new Error('服务端成果目录格式不可信')
      } catch (cause) { if (controller.signal.aborted) return; if (cause?.response?.status !== 404 && cause?.status !== 404) throw cause }
    }
    if (generation !== epoch || controller.signal.aborted) return
    const current = new Map(catalog.map(item => [outputItemKey(item), item.sha256]))
    for (const previous of items.value) if (current.get(outputItemKey(previous)) !== previous.sha256 && previewUrls.value[outputItemKey(previous)]) URL.revokeObjectURL(previewUrls.value[outputItemKey(previous)])
    items.value = catalog; executionDeliveries.value = deliveries; error.value = ''
  } catch (cause) { if (!controller.signal.aborted && generation === epoch) error.value = cause?.message || '读取成果失败' }
  finally { if (generation === epoch) { abort = null; loading.value = false; if (validRootRequest() && !error.value) timer = setTimeout(list, 2500) } }
}
const refresh = () => { error.value = ''; if (timer != null) clearTimeout(timer); timer = null; void list() }
const bytes = async (item, preview) => {
  const generation = epoch; const controller = new AbortController(); inFlight.add(controller)
  try {
    const response = await api.execute({ url: (preview ? item.previewUrl : item.downloadUrl).replace(/^\/chat/, ''), method: 'GET', responseType: 'blob', autoLoading: false, needAuth: true, signal: controller.signal })
    if (controller.signal.aborted || generation !== epoch) return null
    if (!(response?.data instanceof Blob)) throw new Error('服务端未返回可读取的成果字节。')
    const blob = response.data
    if (blob.size !== item.byteLength) throw new Error('成果字节长度与清单不一致，已拒绝使用。')
    if (await sha256Blob(blob) !== item.sha256) throw new Error('成果摘要校验失败，已拒绝使用。')
    if (controller.signal.aborted || generation !== epoch) return null
    if (blob.type !== (preview ? item.contentMimeType : downloadMimeType(item.contentMimeType))) throw new Error('媒体类型不匹配，已拒绝使用。')
    return blob
  } finally { inFlight.delete(controller) }
}
const loadPreview = async item => {
  const key = outputItemKey(item); if (!item.previewUrl || previewUrls.value[key]) return
  const generation = epoch
  try {
    const blob = await bytes(item, true); if (!blob) return
    if (previewKind(item.contentMimeType) === 'text') { if (blob.size > 2 * 1024 * 1024) throw new Error('文本较大，请下载查看'); const text = await blob.text(); if (generation === epoch) patchMap(textPreviews, key, text); return }
    if (generation === epoch && previewKind(item.contentMimeType) !== 'file') patchMap(previewUrls, key, URL.createObjectURL(blob))
    patchMap(itemErrors, key, '')
  } catch (cause) { if (generation === epoch) patchMap(itemErrors, key, cause?.message || '预览失败') }
}
const download = async item => { const key = outputItemKey(item); const generation = epoch; try { const blob = item.messageSource ? new Blob([item.text], { type: 'text/plain' }) : await bytes(item, false); if (blob && generation === epoch) saveOutputBlob({ blob, item: { name: item.messageSource ? '文字成果.txt' : outputDownloadName(item) } }) } catch (cause) { if (generation === epoch) patchMap(itemErrors, key, cause?.message || '下载失败') } }
const archive = async item => {
  const part = outputAssetPart(item)
  if (part && props.enabled && props.identityKey) await archives.save(part)
}
const stepFor = item => requestSnapshots.value.find(request => request.requestId === item.requestId)?.steps?.find(step => step.stepId === item.stepId)
const finalizeSelected = async () => {
  if (!props.acceptance || effectiveTaskCompleted.value || loading.value || error.value || finalizeState.value.busy) return
  if (finalizeState.value.intent) return finalizations.resume()
  if (!displayItems.value.length || finalizeState.value.state === 'recovery_error') return
  const invalid = message => { finalizeState.value = { ...finalizeState.value, state: 'error', busy: false, message } }
  const selected = [...displayItems.value]
  const steps = selected.map(item => item.messageSource ? item : stepFor(item))
  if (steps.some(step => !step)) return invalid('最终成果范围已变化，请刷新后核对。')
  const assignmentRevisions = steps.map(step => safeFinalizationVersion(step.assignmentRevision))
  if (assignmentRevisions.some(value => value == null) || new Set(assignmentRevisions).size !== 1) return invalid('任务指派版本无法安全确认，请刷新后重试。')
  const taskVersion = safeFinalizationVersion(props.taskVersion)
  if (taskVersion == null) return invalid('任务版本无法安全确认，请刷新任务后重试。')
  const taskIds = [...new Set(steps.map(step => step.taskId))]
  if (taskIds.length !== 1 || !exactOutputId(taskIds[0])) return invalid('最终成果不属于同一任务。')
  return finalizations.submit({ taskId: taskIds[0], body: {
    expectedTaskVersion: taskVersion, expectedAssignmentRevision: assignmentRevisions[0],
    conversationId: props.conversationId, summary: '聚义厅本次成果验收',
    selectedOutputs: selected.map(item => item.messageSource
      ? { requestId: item.requestId, messageSource: item.messageSource, sha256: item.sha256, title: item.title, purpose: item.purpose }
      : { requestId: item.requestId, stepId: item.stepId, outputId: item.outputId, sha256: item.sha256, title: item.outputId, purpose: '本次确认交付成果' })
  } })
}
watch(() => `${props.enabled}\u0000${props.identityKey}\u0000${props.conversationId}\u0000${props.taskId}\u0000${catalogRequests.value.map(request => request.requestId).join('\u0001')}`, () => {
  cleanup()
  if (validRootRequest()) {
    // Legacy schema-2 edit records remain untouched in session storage. They are not
    // replayed, converted or used to populate a schema-3 follow-up request.
    requestSnapshots.value = catalogRequests.value; void list()
  }
}, { immediate: true })
// A new projection must refresh the list without discarding in-flight write intents.
watch(() => props.request?.stateVersion, () => { if (validRootRequest()) refresh() })
onBeforeUnmount(cleanup)
</script>
<style scoped>
.bounty-output-gallery { display: grid; gap: 8px; padding: 10px; background: #f7fbf7; }
.bounty-output { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; border: 1px solid #c9d9d2; border-radius: 7px; padding: 8px; }
.bounty-output img { display: block; max-width: min(100%, 400px); max-height: 360px; object-fit: contain; }
.bounty-output audio, .bounty-output-text, .bounty-output > p { flex-basis: 100%; max-width: 100%; }
.bounty-output-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.image-preview { flex-basis: 100%; padding: 0; border: 0; background: transparent; cursor: zoom-in; }
.finalize-button { min-height: 40px; }
.image-overlay { position: fixed; inset: 0; z-index: 1200; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 18px; background: rgba(9, 19, 19, .9); }
.image-overlay img { max-width: 95vw; max-height: 84vh; object-fit: contain; }
</style>
