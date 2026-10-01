<template>
  <section v-if="enabled && (scopedSteps.length || finalizeState.intent || finalizeState.message)" class="bounty-output-gallery" aria-label="悬赏议事成果">
    <strong>议事成果</strong>
    <p v-if="error" role="alert">{{ error }} <button type="button" @click="refresh">重新读取</button></p>
    <p v-else-if="!items.length" role="status">{{ loading ? '正在读取已提交成果…' : '尚无已校验的成果；生成完成后将在此显示。' }}</p>
    <div v-for="item in items" :key="outputItemKey(item)" class="bounty-output">
      <label class="result-choice"><input v-model="selectedKeys" type="checkbox" :value="outputItemKey(item)" :disabled="!currentWritable(item) || !!finalizeState.intent || finalizeState.busy || finalizeState.state === 'recovery_error'" /> 最终成果</label>
      <strong>{{ previewKind(item.contentMimeType) === 'image' ? '图片' : previewKind(item.contentMimeType) === 'audio' ? '音频' : previewKind(item.contentMimeType) === 'text' ? '文本' : '文件' }}</strong>
      <span>{{ item.contentMimeType }} · {{ item.byteLength }} 字节</span>
      <button v-if="item.previewUrl && previewKind(item.contentMimeType) !== 'file'" type="button" @click="loadPreview(item)">预览</button>
      <button type="button" @click="download(item)">下载</button>
      <button type="button" :disabled="!outputAssetPart(item) || archiveState(item).busy || archiveState(item).state === 'saved'" @click="archive(item)">{{ archiveState(item).state === 'saved' ? '已保存到工作空间' : archiveState(item).busy ? '正在保存…' : !outputAssetPart(item) ? '等待资产登记' : '保存到工作空间' }}</button>
      <button v-if="archiveState(item).state === 'unknown'" type="button" @click="archive(item)">重试原保存</button>
      <p v-if="archiveState(item).message" :role="['saved', 'waiting_asset', 'pending', 'saving'].includes(archiveState(item).state) ? 'status' : 'alert'">{{ archiveState(item).message }}</p>
      <p v-if="itemErrors[outputItemKey(item)]" role="alert">{{ itemErrors[outputItemKey(item)] }}</p>
      <p v-if="textPreviews[outputItemKey(item)]" class="bounty-output-text">{{ textPreviews[outputItemKey(item)] }}</p>
      <template v-if="previewUrls[outputItemKey(item)]">
        <button v-if="previewKind(item.contentMimeType) === 'image'" class="image-preview" type="button" @click="expandedUrl = previewUrls[outputItemKey(item)]"><img :src="previewUrls[outputItemKey(item)]" alt="议事生成图片" /></button>
        <audio v-else-if="previewKind(item.contentMimeType) === 'audio'" :src="previewUrls[outputItemKey(item)]" controls preload="none" aria-label="议事生成音频" />
        <span v-else>此格式请下载查看。</span>
      </template>
      <form v-if="previewKind(item.contentMimeType) === 'image'" class="image-rework" @submit.prevent="editImage(item)">
        <label>引用此稿修改 <input v-model="editDrafts[outputItemKey(item)]" maxlength="4000" placeholder="例如：把羽毛改成蓝色" /></label>
        <button type="submit" :disabled="!followupEnabled || !currentWritable(item) || !outputAssetPart(item) || !editDrafts[outputItemKey(item)]?.trim()">{{ followupEnabled ? '请求受控修改预览' : '受控修改未启用' }}</button>
      </form>
    </div>
    <button v-if="selectedKeys.length || finalizeState.intent" type="button" class="finalize-button" :disabled="finalizeState.busy || finalizeState.state === 'completed' || finalizeState.state === 'recovery_error' || (finalizeState.receipt?.state === 'failed' && !finalizeState.receipt.retryable)" @click="finalizeSelected">{{ finalizeState.busy ? '正在确认原验收操作…' : finalizeState.state === 'completed' ? '需求已完成' : finalizeState.intent ? '继续原验收' : `验收选中的 ${selectedKeys.length} 项成果` }}</button>
    <button v-if="finalizeState.intent" type="button" class="finalize-status-button" :disabled="finalizeState.busy" @click="finalizations.check">查询验收状态</button>
    <small v-if="finalizeState.intent">原验收已固定 {{ finalizeState.intent.body.selectedOutputs.length }} 项成果；查询不会重新生成、提交或验收。</small>
    <p v-if="finalizeState.message" :role="finalizeState.state === 'completed' ? 'status' : 'alert'">{{ finalizeState.message }}</p>
    <small>这里只使用服务端按所属人校验并持久保存的真实字节；个人保存与正式验收是独立操作。</small>
    <div v-if="expandedUrl" class="image-overlay" role="dialog" aria-modal="true" aria-label="放大查看议事图片" @click.self="expandedUrl = ''" @keydown.esc="expandedUrl = ''">
      <button type="button" @click="expandedUrl = ''">关闭</button><img :src="expandedUrl" alt="放大后的议事图片" />
    </div>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { createApi } from '../../composables/useHttp.js'
import { exactOutputId, outputCatalogItems, outputItemKey, previewKind, scopedExecutionSteps, downloadMimeType, outputDownloadName, outputAssetPart } from '../../composables/juyiting/bountyOutputCatalog.js'
import { saveOutputBlob } from '../../utils/outputDownload.js'
import { useHallConversationArchive } from '../../composables/juyiting/useHallConversationArchive.js'
import { useHallBountyFinalization, safeFinalizationVersion } from '../../composables/juyiting/useHallBountyFinalization.js'

const emit = defineEmits(['request-followup-edit', 'task-completed'])
const props = defineProps({
  enabled: { type: Boolean, default: false }, request: { type: Object, default: null },
  conversationId: { type: String, default: '' }, identityKey: { type: String, default: '' },
  followupEnabled: { type: Boolean, default: false }, catalog: { type: Array, default: () => [] },
  taskVersion: { type: [String, Number], default: '' }
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
const items = ref([]); const loading = ref(false); const error = ref('')
const previewUrls = ref({}); const textPreviews = ref({}); const itemErrors = ref({})
const editDrafts = ref({}); const selectedKeys = ref([])
const expandedUrl = ref('')
const finalizations = useHallBountyFinalization({ api: agentApi,
  conversationId: () => props.enabled ? props.conversationId : null, identityKey: () => props.identityKey
})
const finalizeState = finalizations.status
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
const currentWritable = item => item?.requestId === props.request?.requestId
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
  requestSnapshots.value = []; items.value = []; previewUrls.value = {}; textPreviews.value = {}
  archives.reset()
  itemErrors.value = {}; editDrafts.value = {}; selectedKeys.value = []
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
    const catalog = []
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
    items.value = catalog; selectedKeys.value = finalizeState.value.intent
      ? finalizeState.value.intent.body.selectedOutputs.map(outputItemKey)
      : selectedKeys.value.filter(key => current.has(key)); error.value = ''
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
const download = async item => { const key = outputItemKey(item); const generation = epoch; try { const blob = await bytes(item, false); if (blob && generation === epoch) saveOutputBlob({ blob, item: { name: outputDownloadName(item) } }) } catch (cause) { if (generation === epoch) patchMap(itemErrors, key, cause?.message || '下载失败') } }
const archive = async item => {
  const part = outputAssetPart(item)
  if (part && props.enabled && props.identityKey) await archives.save(part)
}
const stepFor = item => requestSnapshots.value.find(request => request.requestId === item.requestId)?.steps?.find(step => step.stepId === item.stepId)
const finalizeSelected = async () => {
  if (finalizeState.value.busy) return
  if (finalizeState.value.intent) return finalizations.resume()
  if (!selectedKeys.value.length || finalizeState.value.state === 'recovery_error') return
  const invalid = message => { finalizeState.value = { ...finalizeState.value, state: 'error', busy: false, message } }
  const selected = items.value.filter(item => selectedKeys.value.includes(outputItemKey(item)))
  const steps = selected.map(stepFor)
  if (selected.length !== selectedKeys.value.length || steps.some(step => !step)) return invalid('最终成果范围已变化，请刷新后重选。')
  const assignmentRevisions = steps.map(step => safeFinalizationVersion(step.assignmentRevision))
  if (assignmentRevisions.some(value => value == null) || new Set(assignmentRevisions).size !== 1) return invalid('任务指派版本无法安全确认，请刷新后重试。')
  const taskVersion = safeFinalizationVersion(props.taskVersion)
  if (taskVersion == null) return invalid('任务版本无法安全确认，请刷新任务后重试。')
  const taskIds = [...new Set(steps.map(step => step.taskId))]
  if (taskIds.length !== 1 || !exactOutputId(taskIds[0])) return invalid('最终成果不属于同一任务。')
  return finalizations.submit({ taskId: taskIds[0], body: {
    expectedTaskVersion: taskVersion, expectedAssignmentRevision: assignmentRevisions[0],
    conversationId: props.conversationId, summary: '聚义厅会话选定成果验收',
    selectedOutputs: selected.map(item => ({ requestId: item.requestId, stepId: item.stepId,
      outputId: item.outputId, sha256: item.sha256, title: item.outputId, purpose: '用户选定最终成果' }))
  } })
}
const editImage = item => {
  if (!props.followupEnabled || !currentWritable(item)) return
  const content = editDrafts.value[outputItemKey(item)]?.trim()
  const asset = outputAssetPart(item)
  if (!content || !asset || !exactOutputId(item.requestId) || !exactOutputId(item.stepId)) return
  // The verified catalogue gives the browser only a nested asset reference and its
  // producer request/step. Hall owns context GET, preview, consent and schema-3 admit.
  emit('request-followup-edit', Object.freeze({ content, assetRef: Object.freeze({ assetId: asset.assetId, revision: asset.revision }),
    continuationOf: Object.freeze({ requestId: item.requestId, stepId: item.stepId }) }))
}
watch(() => `${props.enabled}\u0000${props.identityKey}\u0000${props.conversationId}\u0000${catalogRequests.value.map(request => request.requestId).join('\u0001')}`, () => {
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
.bounty-output audio, .bounty-output-text, .image-rework, .bounty-output > p { flex-basis: 100%; max-width: 100%; }
.bounty-output-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.image-preview { flex-basis: 100%; padding: 0; border: 0; background: transparent; cursor: zoom-in; }
.image-rework { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.image-rework label { flex: 1 1 260px; } .image-rework input { width: 100%; min-height: 36px; }
.result-choice { margin-right: auto; } .finalize-button { min-height: 40px; }
.image-overlay { position: fixed; inset: 0; z-index: 1200; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 18px; background: rgba(9, 19, 19, .9); }
.image-overlay img { max-width: 95vw; max-height: 84vh; object-fit: contain; }
</style>
