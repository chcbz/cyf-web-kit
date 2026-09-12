<template>
  <section v-if="item" class="output-preview" :aria-label="`${item.title} 预览`">
    <p v-if="loading">正在读取预览…</p>
    <p v-else-if="message" class="output-preview-error">{{ message }}</p>
    <pre v-else-if="text">{{ text }}</pre>
    <img
      v-else-if="imageUrl"
      :src="imageUrl"
      :alt="item.title"
      @error="message = '图片预览不可用，请下载文件查看。'"
    />
    <p v-else>此格式仅支持下载查看。</p>
  </section>
</template>

<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'

const MAX_TEXT_BYTES = 1024 * 1024
const MAX_IMAGE_BYTES = 50 * 1024 * 1024
const MAX_IMAGE_WIDTH = 8192
const MAX_IMAGE_HEIGHT = 8192
const MAX_IMAGE_PIXELS = 16_000_000
const supportedImageMime = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

const props = defineProps({
  item: { type: Object, default: null },
  detail: { type: Function, required: true },
  loadBlob: { type: Function, required: true },
  sourceKey: { type: [String, Number], default: '' }
})
const loading = ref(false)
const text = ref('')
const imageUrl = ref('')
const message = ref('')
let requestController = null
let generation = 0

const release = () => {
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
  imageUrl.value = ''
}
const abortActive = () => {
  generation += 1
  requestController?.abort(new DOMException('Preview changed', 'AbortError'))
  requestController = null
  release()
  text.value = ''
  message.value = ''
  loading.value = false
}
const decodeImage = async (blob, signal) => {
  if (blob.size > MAX_IMAGE_BYTES) throw new Error('图片文件过大，不支持预览，请下载查看。')
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    await new Promise((resolve, reject) => {
      const finish = callback => {
        signal?.removeEventListener('abort', onAbort)
        image.onload = null
        image.onerror = null
        callback()
      }
      const onAbort = () => finish(() => reject(signal.reason || new DOMException('Preview cancelled', 'AbortError')))
      image.onload = () => finish(resolve)
      image.onerror = () => finish(() => reject(new Error('图片解码失败')))
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) onAbort()
      else image.src = url
    })
    const width = Number(image.naturalWidth)
    const height = Number(image.naturalHeight)
    if (!width || !height || width > MAX_IMAGE_WIDTH || height > MAX_IMAGE_HEIGHT || width * height > MAX_IMAGE_PIXELS) {
      throw new Error('图片尺寸过大，不支持预览，请下载查看。')
    }
    return url
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

watch(
  () => [props.item?.outputId, props.item?.version, props.sourceKey],
  async () => {
    abortActive()
    const item = props.item
    if (!item || item.previewKind === 'NONE') return
    const requestGeneration = generation
    const controller = new AbortController()
    requestController = controller
    loading.value = true
    try {
      const value = await props.detail(item, { signal: controller.signal })
      if (requestGeneration !== generation || controller.signal.aborted) return
      if (item.previewKind === 'TEXT') {
        const content = String(value?.content || '')
        if (new Blob([content]).size > MAX_TEXT_BYTES) message.value = '文本超过 1 MiB，请下载查看。'
        else text.value = content
      } else if (item.previewKind === 'IMAGE') {
        const mime = String(value?.item?.mime || '').toLowerCase()
        if (!supportedImageMime.has(mime)) {
          message.value = '图片格式不支持预览，请下载查看。'
          return
        }
        const response = await props.loadBlob(value.item, { signal: controller.signal })
        if (requestGeneration !== generation || controller.signal.aborted) return
        const blob = new Blob([response.data], { type: mime })
        const decodedUrl = await decodeImage(blob, controller.signal)
        if (requestGeneration !== generation || controller.signal.aborted) {
          URL.revokeObjectURL(decodedUrl)
          return
        }
        imageUrl.value = decodedUrl
      }
    } catch (failure) {
      if (requestGeneration === generation && failure?.name !== 'AbortError') {
        message.value = failure?.message || '预览不可用，请下载文件查看。'
      }
    } finally {
      if (requestGeneration === generation) {
        loading.value = false
        if (requestController === controller) requestController = null
      }
    }
  },
  { immediate: true }
)
onBeforeUnmount(abortActive)
</script>

<style scoped>
.output-preview { max-height: 260px; overflow: auto; margin-top: 8px; padding: 8px; border-radius: 6px; background: #f7f3ea; font-size: 12px; }
.output-preview pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.output-preview img { display: block; max-width: 100%; max-height: 240px; object-fit: contain; }
.output-preview-error { color: #9b3a28; }
</style>
