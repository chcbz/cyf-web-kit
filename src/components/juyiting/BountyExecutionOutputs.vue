<template>
  <section v-if="enabled && scopedSteps.length" class="bounty-output-gallery" aria-label="悬赏议事成果">
    <strong>议事成果</strong>
    <p v-if="error" role="alert">{{ error }} <button type="button" @click="refresh">重新读取</button></p>
    <p v-else-if="!items.length" role="status">{{ loading ? '正在读取已提交成果…' : '尚无已校验的成果；生成完成后将在此显示。' }}</p>
    <div v-for="item in items" :key="outputItemKey(item)" class="bounty-output">
      <label class="result-choice"><input v-model="selectedKeys" type="checkbox" :value="outputItemKey(item)" /> 最终成果</label>
      <strong>{{ previewKind(item.contentMimeType) === 'image' ? '图片' : previewKind(item.contentMimeType) === 'audio' ? '音频' : previewKind(item.contentMimeType) === 'text' ? '文本' : '文件' }}</strong>
      <span>{{ item.contentMimeType }} · {{ item.byteLength }} 字节</span>
      <button v-if="item.previewUrl && previewKind(item.contentMimeType) !== 'file'" type="button" @click="loadPreview(item)">预览</button>
      <button type="button" @click="download(item)">下载</button>
      <button type="button" :disabled="archiveState(item).busy || archiveState(item).state === 'saved'" @click="archive(item)">{{ archiveState(item).state === 'saved' ? '已保存到工作空间' : archiveState(item).busy ? '正在保存…' : '保存到工作空间' }}</button>
      <button v-if="archiveState(item).state === 'unknown'" type="button" @click="archive(item, true)">重试原保存</button>
      <p v-if="archiveState(item).message" :role="archiveState(item).state === 'saved' ? 'status' : 'alert'">{{ archiveState(item).message }}</p>
      <p v-if="itemErrors[outputItemKey(item)]" role="alert">{{ itemErrors[outputItemKey(item)] }}</p>
      <p v-if="textPreviews[outputItemKey(item)]" class="bounty-output-text">{{ textPreviews[outputItemKey(item)] }}</p>
      <template v-if="previewUrls[outputItemKey(item)]">
        <button v-if="previewKind(item.contentMimeType) === 'image'" class="image-preview" type="button" @click="expandedUrl = previewUrls[outputItemKey(item)]"><img :src="previewUrls[outputItemKey(item)]" alt="议事生成图片" /></button>
        <audio v-else-if="previewKind(item.contentMimeType) === 'audio'" :src="previewUrls[outputItemKey(item)]" controls preload="none" aria-label="议事生成音频" />
        <span v-else>此格式请下载查看。</span>
      </template>
      <form v-if="previewKind(item.contentMimeType) === 'image'" class="image-rework" @submit.prevent="editImage(item)">
        <label>引用此稿修改 <input v-model="editDrafts[outputItemKey(item)]" :readonly="Boolean(editIntents[outputItemKey(item)])" maxlength="4000" placeholder="例如：把羽毛改成蓝色" /></label>
        <button type="submit" :disabled="editState(item).busy || (!editDrafts[outputItemKey(item)]?.trim() && !editIntents[outputItemKey(item)])">{{ editState(item).busy ? '正在提交…' : editIntents[outputItemKey(item)] ? '重试原修改' : '同会话生成新稿' }}</button>
        <p v-if="editState(item).message" :role="editState(item).state === 'accepted' ? 'status' : 'alert'">{{ editState(item).message }}</p>
      </form>
    </div>
    <button v-if="selectedKeys.length" type="button" class="finalize-button" :disabled="finalizeState.busy" @click="finalizeSelected">{{ finalizeState.busy ? '正在正式提交并验收…' : `验收选中的 ${selectedKeys.length} 项成果` }}</button>
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
import { exactOutputId, outputCatalogItems, outputItemKey, previewKind, scopedExecutionSteps } from '../../composables/juyiting/bountyOutputCatalog.js'
import { saveOutputBlob } from '../../utils/outputDownload.js'
import { readOutputRecovery, writeOutputRecovery } from '../../composables/juyiting/bountyOutputRecovery.js'

const props = defineProps({
  enabled: { type: Boolean, default: false }, request: { type: Object, default: null },
  conversationId: { type: String, default: '' }, identityKey: { type: String, default: '' },
  taskVersion: { type: [String, Number], default: '' }
})
const api = createApi('/chat')
const agentApi = createApi('/agent')
const requestSnapshots = ref([])
const followupRequestIds = ref([])
const scopedSteps = computed(() => requestSnapshots.value.flatMap(request => scopedExecutionSteps(request, props.conversationId)))
const items = ref([]); const loading = ref(false); const error = ref('')
const previewUrls = ref({}); const textPreviews = ref({}); const itemErrors = ref({})
const archiveStates = ref({}); const editStates = ref({}); const editDrafts = ref({}); const editIntents = ref({}); const selectedKeys = ref([])
const expandedUrl = ref('')
const finalizeState = ref({ state: 'idle', busy: false, message: '', intent: null })
let abort = null; let timer = null; let epoch = 0
const inFlight = new Set()
const validRootRequest = () => props.enabled && exactOutputId(props.request?.requestId) && props.request?.conversationId === props.conversationId
const uuid = prefix => { const value = globalThis.crypto?.randomUUID?.(); if (!value) throw new Error('当前环境不能生成安全幂等键。'); return `${prefix}-${value}` }
const sha256Blob = async blob => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('')
const patchMap = (target, key, value) => { target.value = { ...target.value, [key]: value } }
const archiveState = item => archiveStates.value[outputItemKey(item)] || { state: 'idle', busy: false, message: '' }
const editState = item => editStates.value[outputItemKey(item)] || (editIntents.value[outputItemKey(item)]
  ? { state: 'unknown', busy: false, message: '此前修改请求的结果不明确；请重试原请求，勿创建新生成。' }
  : { state: 'idle', busy: false, message: '' })
const recoveryScope = () => ({ identityKey: props.identityKey, conversationId: props.conversationId, rootRequestId: props.request?.requestId })
const persistRecovery = () => writeOutputRecovery(recoveryScope(), { followups: followupRequestIds.value, edits: editIntents.value })
const cleanup = () => {
  epoch++; if (timer != null) clearTimeout(timer); timer = null; abort?.abort(); abort = null
  for (const controller of inFlight) controller.abort(); inFlight.clear()
  for (const url of Object.values(previewUrls.value)) URL.revokeObjectURL(url)
  requestSnapshots.value = []; followupRequestIds.value = []; items.value = []; previewUrls.value = {}; textPreviews.value = {}
  itemErrors.value = {}; archiveStates.value = {}; editStates.value = {}; editDrafts.value = {}; editIntents.value = {}; selectedKeys.value = []
  expandedUrl.value = ''; finalizeState.value = { state: 'idle', busy: false, message: '', intent: null }; loading.value = false; error.value = ''
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
    const ids = [...new Set([props.request.requestId, ...followupRequestIds.value])]
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
    items.value = catalog; selectedKeys.value = selectedKeys.value.filter(key => current.has(key)); error.value = ''
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
    if (blob.type !== item.contentMimeType) throw new Error('媒体类型不匹配，已拒绝使用。')
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
const download = async item => { const key = outputItemKey(item); try { const blob = await bytes(item, false); if (blob) saveOutputBlob({ blob, item: { name: item.outputId } }) } catch (cause) { patchMap(itemErrors, key, cause?.message || '下载失败') } }
const archive = async (item, retry = false) => {
  const key = outputItemKey(item); const prior = archiveState(item); if (prior.busy || prior.state === 'saved') return
  let intent = prior.intent
  try {
    if (!intent) intent = { idempotencyKey: uuid('conversation-archive'), body: { mode: 'CREATE', displayName: item.outputId, targetFileId: null, expectedVersion: null, outputRef: { requestId: item.requestId, stepId: item.stepId, outputId: item.outputId, sha256: item.sha256 } } }
    patchMap(archiveStates, key, { ...prior, intent, busy: true, state: 'saving', message: retry ? '正在重放原保存操作…' : '正在保存真实成果字节…' })
    const response = await api.execute({ url: `/conversations/${encodeURIComponent(props.conversationId)}/archive-operations`, method: 'POST', headers: { 'Idempotency-Key': intent.idempotencyKey }, data: intent.body, autoLoading: false, needAuth: true })
    const value = response?.data?.data ?? response?.data
    if (value?.state !== 'saved' || value?.outputRef?.requestId !== item.requestId || value?.outputRef?.stepId !== item.stepId || value?.outputRef?.outputId !== item.outputId || value?.sha256 !== item.sha256 || !exactOutputId(value?.fileId) || !Number.isInteger(value?.version) || value.version < 1) throw new Error('保存回执无法确认精确成果。')
    patchMap(archiveStates, key, { intent, busy: false, state: 'saved', message: `已保存到工作空间：${value.fileId} v${value.version}` })
  } catch (cause) {
    const unknown = cause?.requestErrorClass === 'network' || cause instanceof TypeError || cause?.status >= 500 || cause?.response?.status >= 500
    patchMap(archiveStates, key, { intent, busy: false, state: unknown ? 'unknown' : 'error', message: unknown ? '保存结果不明确；请重试原操作，不要另存副本。' : (cause?.message || '保存失败。') })
  }
}
const stepFor = item => requestSnapshots.value.find(request => request.requestId === item.requestId)?.steps?.find(step => step.stepId === item.stepId)
const finalizeSelected = async () => {
  if (finalizeState.value.busy || !selectedKeys.value.length) return
  const selected = items.value.filter(item => selectedKeys.value.includes(outputItemKey(item)))
  const steps = selected.map(stepFor)
  if (selected.length !== selectedKeys.value.length || steps.some(step => !step)) { finalizeState.value = { state: 'error', busy: false, message: '最终成果范围已变化，请刷新后重选。', intent: null }; return }
  const assignmentRevisions = steps.map(step => Number(step.assignmentRevision))
  if (assignmentRevisions.some(value => !Number.isSafeInteger(value) || value < 0) || new Set(assignmentRevisions).size !== 1) { finalizeState.value = { state: 'error', busy: false, message: '任务版本无法安全确认，请刷新后重试。', intent: null }; return }
  const taskVersion = Number(props.taskVersion)
  if (!Number.isSafeInteger(taskVersion) || taskVersion < 0) { finalizeState.value = { state: 'error', busy: false, message: '任务版本无法安全确认，请刷新任务后重试。', intent: null }; return }
  const taskIds = [...new Set(steps.map(step => step.taskId))]
  if (taskIds.length !== 1 || !exactOutputId(taskIds[0])) { finalizeState.value = { state: 'error', busy: false, message: '最终成果不属于同一任务。', intent: null }; return }
  let intent = finalizeState.value.intent
  try {
    if (!intent) intent = { idempotencyKey: uuid('conversation-finalize'), taskId: taskIds[0], body: { expectedTaskVersion: taskVersion, expectedAssignmentRevision: assignmentRevisions[0], conversationId: props.conversationId, summary: '聚义厅会话选定成果验收', selectedOutputs: selected.map(item => ({ requestId: item.requestId, stepId: item.stepId, outputId: item.outputId, sha256: item.sha256, title: item.outputId, purpose: '用户选定最终成果' })) } }
    finalizeState.value = { state: 'submitting', busy: true, message: '正在按精确摘要晋升、正式提交并验收…', intent }
    const response = await agentApi.execute({ url: `/tasks/${encodeURIComponent(intent.taskId)}/finalizations`, method: 'POST', headers: { 'Idempotency-Key': intent.idempotencyKey }, data: intent.body, autoLoading: false, needAuth: true })
    const value = response?.data?.data ?? response?.data
    if (value?.stage !== 'TASK_COMPLETED' || value?.deliveryState !== 'accepted' || !exactOutputId(value?.deliveryId)) throw new Error('服务端尚未确认任务完成。')
    finalizeState.value = { state: 'completed', busy: false, message: `正式成果已验收，任务已完成：${value.deliveryId}`, intent }
  } catch (cause) {
    const unknown = cause?.requestErrorClass === 'network' || cause instanceof TypeError || cause?.status >= 500 || cause?.response?.status >= 500
    finalizeState.value = { state: unknown ? 'unknown' : 'error', busy: false, message: unknown ? '验收结果不明确；再次点击将重放同一操作，不会重复生成或重复验收。' : (cause?.message || '正式验收失败。'), intent }
  }
}
const editImage = async item => {
  const key = outputItemKey(item); const content = editDrafts.value[key]?.trim(); const step = stepFor(item)
  const previous = editIntents.value[key]
  if ((!content && !previous) || !step || editState(item).busy || editState(item).state === 'accepted') return
  let intent = previous
  try {
    if (!intent) intent = { idempotencyKey: uuid('conversation-edit'), content, requestId: item.requestId, stepId: item.stepId, outputId: item.outputId, sha256: item.sha256, taskId: step.taskId, assignmentRevision: Number(step.assignmentRevision) }
    if (intent.sha256 !== item.sha256 || intent.taskId !== step.taskId || intent.assignmentRevision !== Number(step.assignmentRevision)) throw new Error('源稿或任务指派已变化，请刷新后重新选择。')
    patchMap(editIntents, key, intent)
    if (!persistRecovery()) throw new Error('无法保存修改请求的恢复凭据，已拒绝发起生成。')
  } catch (cause) { patchMap(editStates, key, { state: 'error', busy: false, message: cause.message }); return }
  patchMap(editStates, key, { state: 'submitting', busy: true, message: '正在提交同会话引用修改…' })
  try {
    const response = await api.execute({ url: `/conversations/${encodeURIComponent(props.conversationId)}/interactions`, method: 'POST', headers: { 'Idempotency-Key': intent.idempotencyKey }, data: { schemaVersion: 2, taskId: intent.taskId, expectedAssignmentRevision: intent.assignmentRevision, content: intent.content, inputRefs: [{ type: 'conversation_output', requestId: item.requestId, stepId: item.stepId, outputId: item.outputId, sha256: item.sha256 }], replyTo: null, continuationOf: item.requestId, actionProposal: { kind: 'edit_image' } }, autoLoading: false, needAuth: true })
    const value = response?.data?.data ?? response?.data
    if (!exactOutputId(value?.requestId) || !exactOutputId(value?.stepId)) throw new Error('服务端未返回可恢复的修改请求。')
    followupRequestIds.value = [...new Set([...followupRequestIds.value, value.requestId])]
    const remaining = { ...editIntents.value }; delete remaining[key]; editIntents.value = remaining
    const remainingDrafts = { ...editDrafts.value }; delete remainingDrafts[key]; editDrafts.value = remainingDrafts
    persistRecovery()
    patchMap(editStates, key, { state: 'accepted', busy: false, message: '修改请求已受理；新稿就绪后会在同一成果区出现。' })
    refresh()
  } catch (cause) {
    const unknown = cause?.requestErrorClass === 'network' || cause instanceof TypeError || cause?.status >= 500 || cause?.response?.status >= 500
    // Even a malformed receipt can follow a successful charged execution. Keep the
    // original key and exact payload until a server status lookup proves otherwise.
    patchMap(editStates, key, { state: unknown ? 'unknown' : 'error', busy: false, message: unknown ? '修改结果不明确；再次点击仅重试原请求，不会创建新生成。' : (cause?.message || '修改未确认；只能重试原请求。') })
  }
}
watch(() => `${props.enabled}\u0000${props.identityKey}\u0000${props.conversationId}\u0000${props.request?.requestId}\u0000${props.request?.stateVersion}`, () => {
  cleanup()
  if (validRootRequest()) {
    const recovered = readOutputRecovery(recoveryScope())
    followupRequestIds.value = recovered.followups; editIntents.value = recovered.edits
    editDrafts.value = Object.fromEntries(Object.entries(recovered.edits).map(([key, intent]) => [key, intent.content]))
    requestSnapshots.value = [props.request]; void list()
  }
}, { immediate: true })
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
