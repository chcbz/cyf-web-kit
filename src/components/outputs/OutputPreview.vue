<template>
  <section v-if="item" class="output-preview" :aria-label="`${item.title} 预览`">
    <p v-if="loading">正在读取预览…</p>
    <p v-else-if="message" class="output-preview-error">{{ message }}</p>
    <pre v-else-if="text" v-text="text"></pre>
    <img
      v-else-if="imageUrl"
      :src="imageUrl"
      :alt="item.title"
      @error="failImage"
    />
    <iframe
      v-else-if="pdfUrl"
      class="output-preview-pdf"
      :src="pdfUrl"
      :title="`${item.title} PDF 预览`"
      sandbox
      referrerpolicy="no-referrer"
    />
    <p v-else>此格式仅支持下载查看；DOCX、XLSX、PPTX 暂不提供网页预览。</p>
  </section>
</template>

<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import { outputPreviewKind } from '../../composables/useOutputs.js'

const MAX_PREVIEW_BYTES = 1024 * 1024
const PDF_MIME = 'application/pdf'
const props = defineProps({ item: { type: Object, default: null }, load: { type: Function, required: true }, contextKey: { type: String, default: '' } })
const loading = ref(false)
const text = ref('')
const imageUrl = ref('')
const pdfUrl = ref('')
const message = ref('')
let controller = null
let generation = 0
const release = () => {
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
  if (pdfUrl.value) URL.revokeObjectURL(pdfUrl.value)
  imageUrl.value = ''
  pdfUrl.value = ''
}
const reset = () => { generation += 1; controller?.abort(); controller = null; release(); text.value = ''; message.value = ''; loading.value = false }
const failImage = () => { release(); message.value = '图片预览不可用，请下载文件查看。' }
const previewKind = item => {
  const kind = outputPreviewKind(item)
  if (kind !== 'none') return kind
  return item?.mimeType === PDF_MIME && Number.isSafeInteger(item.byteLength) && item.byteLength >= 0 && item.byteLength <= MAX_PREVIEW_BYTES ? 'pdf' : 'none'
}
const validateImageDimensions = (url, signal) => new Promise((resolve, reject) => {
  const image = new Image()
  const abort = () => finish(() => reject(signal?.reason || new DOMException('Preview cancelled', 'AbortError')))
  const finish = callback => {
    signal?.removeEventListener('abort', abort)
    image.onload = null
    image.onerror = null
    callback()
  }
  image.onload = () => finish(() => {
    const width = Number(image.naturalWidth)
    const height = Number(image.naturalHeight)
    if (!width || !height || width > 4096 || height > 4096 || width * height > 16_000_000) reject(new Error('图片尺寸超过安全预览边界，请下载文件查看。'))
    else resolve()
  })
  image.onerror = () => finish(() => reject(new Error('图片解码失败，请下载文件查看。')))
  if (signal?.aborted) abort()
  else image.src = url
})

watch(() => [props.item?.artifactId, props.item?.artifactVersion, props.item?.mimeType, props.item?.byteLength, props.contextKey], async () => {
  reset()
  const item = props.item
  const kind = previewKind(item)
  if (!item || kind === 'none') return
  const current = generation
  const requestController = new AbortController()
  controller = requestController
  loading.value = true
  try {
    const result = await props.load(item, { signal: requestController.signal })
    if (current !== generation || requestController.signal.aborted) return
    const blob = result instanceof Blob ? result : result?.blob
    if (!(blob instanceof Blob) || blob.size > MAX_PREVIEW_BYTES) throw new Error('预览内容超过安全边界，请下载文件查看。')
    if (blob.type !== item.mimeType) throw new Error('文件类型不匹配，请下载文件查看。')
    if (kind === 'text') {
      const decoded = await blob.text()
      if (current === generation && !requestController.signal.aborted) text.value = decoded
    } else {
      const url = URL.createObjectURL(blob)
      if (kind === 'pdf') {
        if (current !== generation || requestController.signal.aborted) URL.revokeObjectURL(url)
        else pdfUrl.value = url
      } else {
        try {
          await validateImageDimensions(url, requestController.signal)
          if (current !== generation || requestController.signal.aborted) URL.revokeObjectURL(url)
          else imageUrl.value = url
        } catch (error) {
          URL.revokeObjectURL(url)
          throw error
        }
      }
    }
  } catch (error) {
    if (current === generation && error?.name !== 'AbortError') message.value = error?.message || '预览不可用，请下载文件查看。'
  } finally { if (current === generation) loading.value = false }
}, { immediate: true })
onBeforeUnmount(reset)
</script>

<style scoped>
.output-preview { margin-top: 8px; max-height: 260px; overflow: auto; padding: 8px; border-radius: 6px; background: #f7f3ea; font-size: 12px; }
.output-preview pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.output-preview img { display: block; max-width: 100%; max-height: 240px; object-fit: contain; }
.output-preview-pdf { display: block; width: 100%; height: 240px; border: 0; background: #fff; }
.output-preview-error { color: #9b3a28; }
</style>
