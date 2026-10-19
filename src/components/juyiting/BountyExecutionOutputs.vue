<template>
  <section v-if="enabled && (acceptance || scopedSteps.length || skillResults.results.value.length || skillResults.error.value)" class="bounty-output-gallery" aria-label="悬赏议事成果">
    <header class="output-gallery-heading">
      <strong>议事成果</strong>
      <button
        type="button"
        class="output-refresh hall-output-action"
        :disabled="loading"
        @click="refreshFromUser"
      >重新读取成果</button>
    </header>
    <p v-if="error" role="alert">{{ error }} <button type="button" @click="refreshFromUser">重新读取</button></p>
    <p v-else-if="!displayItems.length" role="status">{{ loading ? '正在读取已提交成果…' : deliveryMessage || '结果完成后会显示在这里。' }}</p>
    <p v-if="skillResults.error.value" role="alert">{{ skillResults.error.value }} <button type="button" @click="skillResults.refresh">重新读取</button></p>
    <article v-for="result in skillResults.results.value" :key="result.executionId" class="bounty-output">
      <strong>技能结果</strong><span>{{ result.complete ? '已归档' : result.phase === 'ARCHIVING' ? '正在归档（尚未完成）' : result.phase }}</span>
      <pre v-if="result.complete && result.data !== null" class="bounty-output-text">{{ skillResultDataText(result.data) }}</pre>
      <small v-if="result.complete && result.data !== null">数据结果不制造文件资产，不表示任务已验收。</small>
    </article>
    <div v-for="item in displayItems" :key="outputItemKey(item)" class="bounty-output">
      <strong>{{ previewKind(item.contentMimeType) === 'image' ? '图片' : previewKind(item.contentMimeType) === 'audio' ? '音频' : previewKind(item.contentMimeType) === 'text' ? '文本' : '文件' }}</strong>
      <p v-if="item.messageSource" class="bounty-output-text">{{ item.text }}</p>
      <span>{{ item.contentMimeType }} · {{ item.byteLength }} 字节</span>
      <button v-if="item.previewUrl && previewKind(item.contentMimeType) !== 'file'" type="button" @click="loadPreview(item)">预览</button>
      <p v-if="itemErrors[outputItemKey(item)]" role="alert">{{ itemErrors[outputItemKey(item)] }}</p>
      <p v-if="textPreviews[outputItemKey(item)]" class="bounty-output-text">{{ textPreviews[outputItemKey(item)] }}</p>
      <template v-if="previewUrls[outputItemKey(item)]">
        <button
          v-if="previewKind(item.contentMimeType) === 'image'"
          class="image-preview"
          type="button"
          @click="expandedUrl = previewUrls[outputItemKey(item)]"
        ><img :src="previewUrls[outputItemKey(item)]" alt="议事生成图片" /></button>
        <audio
          v-else-if="previewKind(item.contentMimeType) === 'audio'"
          :src="previewUrls[outputItemKey(item)]"
          controls
          preload="none"
          aria-label="议事生成音频"
        ></audio>
        <span v-else>此格式请下载查看。</span>
      </template>
      <small v-if="item.replaces">改稿关联：{{ item.replaces.outputId }}（原稿仍保留）</small>
      <small v-if="!effectiveTaskCompleted">需要调整？直接在会话中告诉 Agent。</small>
    </div>
    <p v-if="effectiveTaskCompleted" role="status">事项已完成，此处仅供查看成果。</p>
    <div
      v-if="expandedUrl"
      class="image-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="放大查看议事图片"
      @click.self="expandedUrl = ''"
      @keydown.esc="expandedUrl = ''"
    >
      <button type="button" @click="expandedUrl = ''">关闭</button><img :src="expandedUrl" alt="放大后的议事图片" />
    </div>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { createApi } from '../../composables/useHttp.js'
import { exactOutputId, outputCatalogItems, outputItemKey, previewKind, scopedExecutionSteps, currentOutputDelivery, completedTextItem, completedExecutionDelivery, outputRequestPending } from '../../composables/juyiting/bountyOutputCatalog.js'
import { revisionProgressPending } from '../../composables/juyiting/hallTypedDeliberation.js'
import { useHallSkillResults } from '../../composables/juyiting/useHallSkillResults.js'
import { skillResultDataText } from '../../composables/juyiting/hallSkillResults.js'

const emit = defineEmits(['catalog-refresh-needed'])
const props = defineProps({
  acceptance: { type: Boolean, default: false },
  taskCompleted: { type: Boolean, default: false },
  enabled: { type: Boolean, default: false }, request: { type: Object, default: null },
  conversationId: { type: String, default: '' }, identityKey: { type: String, default: '' },
  typedOutcomes: { type: Array, default: () => [] }, conversationGeneration: { type: String, default: '' },
  catalog: { type: Array, default: () => [] },
  taskVersion: { type: [String, Number], default: '' }, taskId: { type: String, default: '' }
})
const api = createApi('/chat')
const skillResults = useHallSkillResults({ api, getContext: () => ({ conversationId: props.conversationId,
  conversationGeneration: props.conversationGeneration, taskId: props.taskId }), getOutcomes: () => props.typedOutcomes,
  identityKey: () => props.identityKey, enabled: () => props.enabled && !!props.identityKey })
const resultItems = computed(() => skillResults.results.value.flatMap(result => result.outputs))
const allItems = computed(() => [...new Map([...items.value, ...resultItems.value].map(item => [outputItemKey(item), item])).values()])
const allDeliveries = computed(() => {
  const map = new Map(executionDeliveries.value.map(value => [value.outcomeId, value]))
  for (const result of skillResults.results.value) if (result.complete && result.outputs.length && result.reference.progressState === 'COMPLETED')
    map.set(result.reference.outcomeId, { outcomeId: result.reference.outcomeId, finalSha256: result.reference.finalSha256,
      deliveryRelation: result.reference.deliveryRelation, requestId: result.requestId, stepId: result.stepId })
  return [...map.values()]
})
const requestSnapshots = ref([])
const catalogRequests = computed(() => Array.isArray(props.catalog) && props.catalog.length
  ? props.catalog.map(entry => entry?.request).filter(Boolean)
  : (props.request ? [props.request] : []))
const scopedSteps = computed(() => requestSnapshots.value.flatMap(request => scopedExecutionSteps(request, props.conversationId)))
const executionDeliveries = ref([])
const items = ref([]); const loading = ref(false); const error = ref('')
const previewUrls = ref({}); const textPreviews = ref({}); const itemErrors = ref({})
const expandedUrl = ref(''); const pendingAction = ref(false)
// Submission COMPLETED is not acceptance. Only the authoritative root marks read-only completion.
const effectiveTaskCompleted = computed(() => props.taskCompleted)
const deliveryProjection = computed(() => {
  if (!props.acceptance) return { items: allItems.value, message: '' }
  try { return { items: currentOutputDelivery(allItems.value, allDeliveries.value), message: '' } }
  catch (cause) { return { items: [], message: cause.message } }
})
const displayItems = computed(() => deliveryProjection.value.items)
const deliveryMessage = computed(() => deliveryProjection.value.message)
let abort = null; let timer = null; let epoch = 0; let refreshQueued = false
const inFlight = new Set()
const validRootRequest = () => props.enabled && catalogRequests.value.length > 0 && catalogRequests.value.every(request => exactOutputId(request?.requestId) && request.conversationId === props.conversationId)
const sha256Blob = async blob => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('')
const patchMap = (target, key, value) => { target.value = { ...target.value, [key]: value } }
const cleanup = () => {
  epoch++; refreshQueued = false; pendingAction.value = false; if (timer != null) clearTimeout(timer); timer = null; abort?.abort(); abort = null
  for (const controller of inFlight) controller.abort(); inFlight.clear()
  for (const url of Object.values(previewUrls.value)) URL.revokeObjectURL(url)
  requestSnapshots.value = []; items.value = []; executionDeliveries.value = []; previewUrls.value = {}; textPreviews.value = {}
  itemErrors.value = {}
  expandedUrl.value = ''; loading.value = false; error.value = ''
}
const fetchRequest = async (requestId, controller) => {
  const response = await api.get(`/requests/${encodeURIComponent(requestId)}`, {}, { autoLoading: false, needAuth: true, signal: controller.signal })
  const value = response
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
    const catalog = []; const deliveries = []; let actionPending = false
    if (props.acceptance && props.taskId) for (const request of snapshots) {
      for (const turn of request.turns || []) {
        if (turn.route !== 'CHAT' || !['FINAL_PERSISTED', 'PUBLISHED'].includes(turn.state)) continue
        const response = await api.get(`/conversations/${encodeURIComponent(props.conversationId)}/requests/${encodeURIComponent(request.requestId)}/typed-outcome`, {},
          { autoLoading: false, needAuth: true, signal: controller.signal })
        const outcome = response
        const text = await completedTextItem(outcome, request, turn, props.taskId)
        if (controller.signal.aborted || generation !== epoch) return
        if (text) catalog.push(text)
        const delivery = completedExecutionDelivery(response, request, turn, snapshots, props.taskId)
        if (delivery) deliveries.push(delivery)
        // Validated typed projections may precede a child appearing in the index.
        if (revisionProgressPending(outcome) || outcome.state === 'PENDING' || ['QUEUED', 'RUNNING'].includes(outcome.actionProgress?.state)) actionPending = true
      }
    }
    for (const step of scopedSteps.value) {
      try {
        const response = await api.get(`/requests/${encodeURIComponent(step.requestId)}/steps/${encodeURIComponent(step.stepId)}/outputs`, {}, { autoLoading: false, needAuth: true, signal: controller.signal })
        const data = response
        const normalized = outputCatalogItems(data, step.requestId, step.stepId)
        if (Array.isArray(data) && normalized.length === data.length) catalog.push(...normalized)
        else if (Array.isArray(data) && data.length) throw new Error('服务端成果目录格式不可信')
      } catch (cause) { if (controller.signal.aborted) return; if (cause?.response?.status !== 404 && cause?.status !== 404) throw cause }
    }
    if (generation !== epoch || controller.signal.aborted) return
    const current = new Map(catalog.map(item => [outputItemKey(item), item.sha256]))
    for (const previous of items.value) if (current.get(outputItemKey(previous)) !== previous.sha256 && previewUrls.value[outputItemKey(previous)]) URL.revokeObjectURL(previewUrls.value[outputItemKey(previous)])
    items.value = catalog; executionDeliveries.value = deliveries; pendingAction.value = actionPending; error.value = ''
    if (actionPending && !effectiveTaskCompleted.value) emit('catalog-refresh-needed')
  } catch (cause) { if (!controller.signal.aborted && generation === epoch) error.value = cause?.message || '读取成果失败' }
  finally {
    if (generation === epoch) {
      abort = null; loading.value = false
      if (refreshQueued) { refreshQueued = false; void list() }
      else if (validRootRequest() && !effectiveTaskCompleted.value && !error.value &&
        (pendingAction.value || requestSnapshots.value.some(outputRequestPending))) timer = setTimeout(() => { timer = null; void list() }, 2500)
    }
  }
}
const refresh = () => { error.value = ''; if (timer != null) clearTimeout(timer); timer = null; if (abort) refreshQueued = true; else void list() }
const refreshFromUser = () => { void skillResults.refresh(); emit('catalog-refresh-needed'); refresh() }
const bytes = async item => {
  const generation = epoch; const controller = new AbortController(); inFlight.add(controller)
  try {
    const response = await api.execute({ url: item.previewUrl.replace(/^\/chat/, ''), method: 'GET', responseType: 'blob', autoLoading: false, needAuth: true, signal: controller.signal })
    if (controller.signal.aborted || generation !== epoch) return null
    if (!(response instanceof Blob)) throw new Error('服务端未返回可读取的成果字节。')
    const blob = response
    if (String(blob.size) !== item.byteLength) throw new Error('成果字节长度与清单不一致，已拒绝使用。')
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
    const blob = await bytes(item); if (!blob) return
    if (previewKind(item.contentMimeType) === 'text') { if (blob.size > 2 * 1024 * 1024) throw new Error('文本较大，请下载查看'); const text = await blob.text(); if (generation === epoch) patchMap(textPreviews, key, text); return }
    if (generation === epoch && previewKind(item.contentMimeType) !== 'file') patchMap(previewUrls, key, URL.createObjectURL(blob))
    patchMap(itemErrors, key, '')
  } catch (cause) { if (generation === epoch) patchMap(itemErrors, key, cause?.message || '预览失败') }
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
watch(() => JSON.stringify(catalogRequests.value.map(request => [request.requestId, request.state, request.stateVersion,
  (request.turns || []).map(turn => [turn.turnId, turn.state, turn.stateVersion]),
  (request.steps || []).map(step => [step.stepId, step.stateVersion, step.executionState])])), () => { if (validRootRequest()) refresh() })
watch(effectiveTaskCompleted, completed => {
  if (timer != null) clearTimeout(timer); timer = null
  if (!completed && validRootRequest()) refresh()
})
onBeforeUnmount(() => { cleanup(); skillResults.dispose() })
</script>
<style scoped>
.bounty-output-gallery { display: grid; gap: 8px; padding: 10px; background: #f7fbf7; }
.bounty-output { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; border: 1px solid #c9d9d2; border-radius: 7px; padding: 8px; }
.bounty-output img { display: block; max-width: min(100%, 400px); max-height: 360px; object-fit: contain; }
.bounty-output audio, .bounty-output-text, .bounty-output > p { flex-basis: 100%; max-width: 100%; }
.bounty-output-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.image-preview { flex-basis: 100%; padding: 0; border: 0; background: transparent; cursor: zoom-in; }
.output-gallery-heading { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; }
.hall-output-action { min-height: 44px; padding: 9px 14px; border: 1px solid var(--hall-brand, #923f30); border-radius: 8px; background: var(--hall-surface, #fffefa); color: var(--hall-brand, #923f30); font: inherit; font-weight: 500; cursor: pointer; }
.hall-output-action.primary { background: var(--hall-brand, #923f30); color: #fffefa; }
.hall-output-action:hover:not(:disabled) { background: #f6eee8; border-color: #793326; }
.hall-output-action.primary:hover:not(:disabled) { background: #793326; }
.hall-output-action:focus-visible { outline: 3px solid #923f3080; outline-offset: 3px; }
.hall-output-action:disabled { opacity: .55; cursor: not-allowed; }
.image-overlay { position: fixed; inset: 0; z-index: 1200; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 18px; background: rgba(9, 19, 19, .9); }
.image-overlay img { max-width: 95vw; max-height: 84vh; object-fit: contain; }
</style>
