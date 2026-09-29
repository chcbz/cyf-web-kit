<template>
  <section v-if="enabled && scopedSteps.length" class="bounty-output-gallery" aria-label="悬赏议事成果">
    <strong>议事成果</strong>
    <p v-if="error" role="alert">{{ error }} <button type="button" @click="refresh">重新读取</button></p>
    <p v-else-if="!items.length" role="status">{{ loading ? '正在读取已提交成果…' : '尚无已校验的成果；生成完成后将在此显示。' }}</p>
    <div v-for="item in items" :key="outputItemKey(item)" class="bounty-output">
      <strong>{{ previewKind(item.contentMimeType) === 'image' ? '图片' : previewKind(item.contentMimeType) === 'audio' ? '音频' : '文件' }}</strong>
      <span>{{ item.contentMimeType }} · {{ item.byteLength }} 字节</span>
      <button v-if="item.previewUrl && previewKind(item.contentMimeType) !== 'file'" type="button" @click="loadPreview(item)">预览</button>
      <button type="button" @click="download(item)">下载</button>
      <p v-if="itemErrors[outputItemKey(item)]" role="alert">{{ itemErrors[outputItemKey(item)] }}</p>
      <p v-if="textPreviews[outputItemKey(item)]" class="bounty-output-text">{{ textPreviews[outputItemKey(item)] }}</p>
      <template v-if="previewUrls[outputItemKey(item)]">
        <img v-if="previewKind(item.contentMimeType) === 'image'" :src="previewUrls[outputItemKey(item)]" alt="议事生成图片" />
        <audio v-else-if="previewKind(item.contentMimeType) === 'audio'" :src="previewUrls[outputItemKey(item)]" controls preload="none" aria-label="议事生成音频" />
        <span v-else>此格式请下载查看。</span>
      </template>
    </div>
    <small>这里仅展示已由服务端按任务和所属人校验的字节；保存工作空间与正式交付是后续独立操作。</small>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { createApi } from '../../composables/useHttp.js'
import { exactOutputId, outputCatalogItems, outputItemKey, previewKind, scopedExecutionSteps } from '../../composables/juyiting/bountyOutputCatalog.js'
import { saveOutputBlob } from '../../utils/outputDownload.js'

const props = defineProps({
  enabled: { type: Boolean, default: false },
  request: { type: Object, default: null },
  conversationId: { type: String, default: '' },
  identityKey: { type: String, default: '' }
})
const api = createApi('/chat')
const hydratedRequest = ref(null)
const scopedSteps = computed(() => props.enabled ? scopedExecutionSteps(hydratedRequest.value, props.conversationId) : [])
const scopedExecutionStepsSafeRequest = (request, conversationId) =>
  exactOutputId(request?.requestId) && request?.conversationId === conversationId
const items = ref([])
const loading = ref(false)
const error = ref('')
const previewUrls = ref({})
const textPreviews = ref({})
const itemErrors = ref({})
let abort = null
let timer = null
const inFlight = new Set()
let epoch = 0
const cleanup = () => {
  epoch++
  if (timer != null) clearTimeout(timer)
  timer = null
  abort?.abort()
  abort = null
  for (const controller of inFlight) controller.abort()
  inFlight.clear()
  hydratedRequest.value = null
  for (const url of Object.values(previewUrls.value)) URL.revokeObjectURL(url)
  previewUrls.value = {}
  textPreviews.value = {}
  itemErrors.value = {}
  items.value = []
  loading.value = false
  error.value = ''
}
const list = async () => {
  if (!props.enabled || !scopedExecutionStepsSafeRequest(props.request, props.conversationId) || abort) return
  const generation = epoch
  const controller = new AbortController()
  abort = controller
  loading.value = true
  try {
    // Re-read the owner-scoped request on each refresh: a later EXECUTE step can
    // be attached after the first output and must not be hidden by the old snapshot.
    const response = await api.get(`/requests/${encodeURIComponent(props.request.requestId)}`, {},
      { autoLoading: false, needAuth: true, signal: controller.signal })
    const value = response?.data?.data ?? response?.data
    if (generation !== epoch || controller.signal.aborted) return
    if (value?.requestId !== props.request.requestId || value?.conversationId !== props.conversationId) {
      throw new Error('议事请求范围不匹配')
    }
    hydratedRequest.value = value
    const catalog = []
    for (const step of scopedSteps.value) {
      const path = `/requests/${encodeURIComponent(step.requestId)}/steps/${encodeURIComponent(step.stepId)}/outputs`
      try {
        const response = await api.get(path, {}, { autoLoading: false, needAuth: true, signal: controller.signal })
        const data = response?.data?.data ?? response?.data
        if (Array.isArray(data) && outputCatalogItems(data, step.requestId, step.stepId).length === data.length) {
          catalog.push(...outputCatalogItems(data, step.requestId, step.stepId))
        } else if (Array.isArray(data) && data.length) throw new Error('服务端成果目录格式不可信')
      } catch (cause) {
        // A queued or running execution has no committed output yet; do not turn a 404 into success.
        if (controller.signal.aborted) return
        if (cause?.response?.status !== 404 && cause?.status !== 404) throw cause
      }
    }
    if (generation !== epoch || controller.signal.aborted) return
    // A revoked/replaced output must not leave an older preview URL in this panel.
    const current = new Map(catalog.map(item => [outputItemKey(item), item.sha256]))
    for (const previous of items.value) {
      const key = outputItemKey(previous)
      if (current.get(key) === previous.sha256) continue
      if (previewUrls.value[key]) URL.revokeObjectURL(previewUrls.value[key])
      const { [key]: ignoredPreview, ...previews } = previewUrls.value
      const { [key]: ignoredText, ...texts } = textPreviews.value
      const { [key]: ignoredError, ...errors } = itemErrors.value
      previewUrls.value = previews
      textPreviews.value = texts
      itemErrors.value = errors
    }
    items.value = catalog
    error.value = ''
  } catch (cause) {
    if (!controller.signal.aborted && generation === epoch) error.value = cause?.message || '读取成果失败'
  } finally {
    if (generation === epoch) {
      abort = null
      loading.value = false
      // Poll only the current owner request while the panel is mounted. Never start a new
      // execution when checking progress, and never stop a transport due to an elapsed SLO.
      if (props.enabled && scopedExecutionStepsSafeRequest(props.request, props.conversationId) && !error.value) timer = setTimeout(list, 2500)
    }
  }
}
const refresh = () => { error.value = ''; if (timer != null) clearTimeout(timer); timer = null; void list() }
const bytes = async (item, preview) => {
  const generation = epoch
  const controller = new AbortController()
  inFlight.add(controller)
  // List and content each require fresh owner auth on the server. Browser stores only a short-lived blob URL.
  const url = preview ? item.previewUrl : item.downloadUrl
  let response
  try {
    response = await api.execute({ url: url.replace(/^\/chat/, ''), method: 'GET', responseType: 'blob',
      autoLoading: false, needAuth: true, signal: controller.signal })
  } finally { inFlight.delete(controller) }
  if (controller.signal.aborted || generation !== epoch || !(response?.data instanceof Blob) ||
      response.data.size !== item.byteLength) return null
  const blob = response.data
  if (preview && blob.type !== item.contentMimeType) throw new Error('媒体类型不匹配，已拒绝预览')
  return blob
}
const loadPreview = async item => {
  if (!item.previewUrl || previewUrls.value[outputItemKey(item)]) return
  const generation = epoch
  try {
    const blob = await bytes(item, true)
    if (!blob) return
    if (previewKind(item.contentMimeType) === 'file') return
    if (previewKind(item.contentMimeType) === 'text') {
      if (blob.size > 2 * 1024 * 1024) throw new Error('文本较大，请下载查看')
      const text = await blob.text()
      if (generation !== epoch || !items.value.some(current => outputItemKey(current) === outputItemKey(item) && current.sha256 === item.sha256)) return
      textPreviews.value = { ...textPreviews.value, [outputItemKey(item)]: text }
      return
    }
    if (generation !== epoch || !items.value.some(current => outputItemKey(current) === outputItemKey(item) && current.sha256 === item.sha256)) return
    previewUrls.value = { ...previewUrls.value, [outputItemKey(item)]: URL.createObjectURL(blob) }
    itemErrors.value = { ...itemErrors.value, [outputItemKey(item)]: '' }
  } catch (cause) {
    if (generation === epoch && items.value.some(current => outputItemKey(current) === outputItemKey(item) && current.sha256 === item.sha256)) {
      itemErrors.value = { ...itemErrors.value, [outputItemKey(item)]: cause?.message || '预览失败' }
    }
  }
}
const download = async item => {
  const generation = epoch
  try {
    const blob = await bytes(item, false)
    if (blob && generation === epoch && items.value.some(current => outputItemKey(current) === outputItemKey(item) && current.sha256 === item.sha256)) {
      saveOutputBlob({ blob, item: { name: item.outputId } })
    }
  } catch (cause) {
    if (generation === epoch && items.value.some(current => outputItemKey(current) === outputItemKey(item) && current.sha256 === item.sha256)) {
      itemErrors.value = { ...itemErrors.value, [outputItemKey(item)]: cause?.message || '下载失败' }
    }
  }
}
watch(() => `${props.enabled}\u0000${props.identityKey}\u0000${props.conversationId}\u0000${props.request?.requestId}\u0000${props.request?.stateVersion}`, () => {
  cleanup()
  hydratedRequest.value = props.request
  if (props.enabled && scopedExecutionStepsSafeRequest(props.request, props.conversationId)) void list()
}, { immediate: true })
onBeforeUnmount(cleanup)
</script>
<style scoped>
.bounty-output-gallery { display: grid; gap: 8px; padding: 10px; background: #f7fbf7; }
.bounty-output { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; border: 1px solid #c9d9d2; border-radius: 7px; padding: 8px; }
.bounty-output img { display: block; flex-basis: 100%; max-width: min(100%, 400px); max-height: 360px; object-fit: contain; }
.bounty-output audio { max-width: 100%; }
.bounty-output-text { flex-basis: 100%; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
