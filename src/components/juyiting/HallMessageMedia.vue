<template>
  <div class="media-asset">
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="previewUrl && mediaKind === 'image'">
      <button type="button" class="image-button" aria-label="放大查看图片" @click="expanded = true"><img :src="previewUrl" :alt="part.filename || '会话图片'" /></button>
      <div v-if="expanded" class="image-overlay" role="dialog" aria-modal="true" aria-label="放大查看会话图片" @click.self="expanded = false" @keydown.esc="expanded = false">
        <button type="button" aria-label="关闭图片预览" @click="expanded = false">关闭</button>
        <img :src="previewUrl" :alt="part.filename || '会话图片'" />
      </div>
    </template>
    <template v-else-if="mediaKind === 'image'"><span>{{ loading ? '正在读取图片…' : '图片暂不可预览，可尝试下载。' }}</span></template>
    <template v-if="mediaKind === 'audio'">
      <audio v-if="previewUrl" :src="previewUrl" controls preload="none" aria-label="会话音频" />
      <button v-else type="button" :disabled="loading" @click="loadPreview">{{ loading ? '正在读取音频…' : '播放音频' }}</button>
    </template>
    <span v-if="mediaKind === 'file'">暂不支持在线预览，可下载查看。</span>
    <button type="button" :disabled="loading" @click="download">下载</button>
  </div>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { createApi } from '../../composables/useHttp.js'
import { conversationAssetContentPath, safeMediaKind } from '../../composables/juyiting/hallMessageParts.js'
import { saveOutputBlob } from '../../utils/outputDownload.js'

const props = defineProps({
  part: { type: Object, required: true },
  conversationId: { type: String, required: true },
  identityKey: { type: String, required: true }
})
const api = createApi('/chat')
const previewUrl = ref('')
const loading = ref(false)
const error = ref('')
const expanded = ref(false)
const mediaKind = computed(() => safeMediaKind(props.part))
let controller = null
let requestGeneration = 0
const discard = () => {
  requestGeneration++
  controller?.abort()
  controller = null
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = ''
  expanded.value = false
  loading.value = false
  error.value = ''
}
const getBlob = async signal => {
  const url = conversationAssetContentPath({ conversationId: props.conversationId, assetId: props.part.assetId })
  const response = await api.execute({ url, method: 'GET', responseType: 'blob', autoLoading: false, needAuth: true, signal })
  if (!(response?.data instanceof Blob)) throw new Error('无法读取会话资产。')
  return response.data
}
const loadPreview = async () => {
  if (previewUrl.value || loading.value || mediaKind.value === 'file') return
  const generation = ++requestGeneration
  controller?.abort()
  const pending = new AbortController()
  controller = pending
  loading.value = true
  error.value = ''
  try {
    const blob = await getBlob(pending.signal)
    if (pending.signal.aborted || generation !== requestGeneration) return
    const actualMime = String(blob.type || '').toLowerCase().split(';')[0].trim()
    if (actualMime !== props.part.mime || safeMediaKind({ ...props.part, mime: actualMime }) !== mediaKind.value) {
      throw new Error('媒体类型与服务端声明不一致，暂不预览。')
    }
    previewUrl.value = URL.createObjectURL(blob)
  } catch (cause) {
    if (!pending.signal.aborted && generation === requestGeneration) error.value = cause?.message || '读取内容失败，请重试。'
  } finally {
    if (generation === requestGeneration) { loading.value = false; controller = null }
  }
}
const download = async () => {
  if (loading.value) return
  const generation = ++requestGeneration
  const pending = new AbortController()
  controller = pending
  loading.value = true
  error.value = ''
  try {
    const blob = await getBlob(pending.signal)
    if (pending.signal.aborted || generation !== requestGeneration) return
    saveOutputBlob({ blob, item: { name: props.part.filename || `${props.part.partId}` } })
  } catch (cause) {
    if (!pending.signal.aborted && generation === requestGeneration) error.value = cause?.message || '下载失败，请重试。'
  } finally {
    if (generation === requestGeneration) { loading.value = false; controller = null }
  }
}
watch(() => `${props.identityKey}\u0000${props.conversationId}\u0000${props.part.partId}\u0000${props.part.revision}\u0000${props.part.assetId}`, () => {
  discard()
  if (mediaKind.value === 'image' && props.part.assetId) void loadPreview()
}, { immediate: true })
onBeforeUnmount(discard)
</script>
<style scoped>
.media-asset { display: flex; flex-direction: column; gap: 8px; max-width: min(100%, 380px); }
.media-asset p { color: #a14132; margin: 0; }
.image-button { display: block; max-width: 100%; padding: 0; background: transparent; cursor: zoom-in; }
.image-button img { display: block; max-width: min(100%, 280px); max-height: 230px; object-fit: contain; }
.image-overlay { position: fixed; inset: 0; z-index: 1000; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 18px; background: rgba(9, 19, 19, 0.88); }
.image-overlay img { max-width: 95vw; max-height: 83vh; object-fit: contain; }
.media-asset audio { max-width: 100%; }
</style>
