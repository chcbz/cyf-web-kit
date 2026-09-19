<template>
  <section v-if="item" class="output-preview" :aria-label="`${item.title} 预览`">
    <p v-if="loading">正在读取预览…</p>
    <p v-else-if="message" class="output-preview-error">{{ message }}</p>
    <template v-else-if="currentPart">
      <div v-if="parts.length > 1" class="output-preview-navigation" aria-label="预览分片导航">
        <button type="button" :disabled="selectedPartIndex === 0" @click="selectedPartIndex -= 1">上一页</button>
        <span>第 {{ selectedPartIndex + 1 }} / {{ parts.length }} {{ currentPart.contentMimeType === 'text/plain' ? '项' : '页' }}</span>
        <button type="button" :disabled="selectedPartIndex >= parts.length - 1" @click="selectedPartIndex += 1">下一页</button>
      </div>
      <pre v-if="typeof currentPart.text === 'string'" v-text="currentPart.text"></pre>
      <img v-else-if="currentPart.imageUrl" :src="currentPart.imageUrl" :alt="`${item.title} 第 ${selectedPartIndex + 1} 页`" @error="failImage" />
      <iframe v-else-if="currentPart.pdfUrl" class="output-preview-pdf" :src="currentPart.pdfUrl" :title="`${item.title} PDF 预览`" sandbox referrerpolicy="no-referrer" />
      <p v-else>此预览分片不可用，请下载原文件查看。</p>
      <p v-if="previewNote" class="output-preview-note">{{ previewNote }}</p>
    </template>
    <p v-else>此格式仅支持下载查看。</p>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { outputPreviewKind } from '../../composables/useOutputs.js'

const MAX_PREVIEW_BYTES = 1024 * 1024
const PDF_MIME = 'application/pdf'
const TEXT_PREVIEW_MIME = 'text/plain'
const documentPreviewMimeTypes = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
])
const props = defineProps({ item: { type: Object, default: null }, load: { type: Function, required: true }, contextKey: { type: String, default: '' } })
const loading = ref(false)
const parts = ref([])
const selectedPartIndex = ref(0)
const message = ref('')
const previewNote = ref('')
const currentPart = computed(() => parts.value[selectedPartIndex.value] || null)
let controller = null
let generation = 0
const release = () => {
  for (const part of parts.value) {
    if (part.imageUrl) URL.revokeObjectURL(part.imageUrl)
    if (part.pdfUrl) URL.revokeObjectURL(part.pdfUrl)
  }
  parts.value = []
}
const reset = () => { generation += 1; controller?.abort(); controller = null; release(); selectedPartIndex.value = 0; message.value = ''; previewNote.value = ''; loading.value = false }
const failImage = () => { release(); message.value = '图片预览不可用，请下载文件查看。' }
const isDocumentTextPreview = item => documentPreviewMimeTypes.has(item?.mimeType)
const previewKind = item => {
  const kind = outputPreviewKind(item)
  if (kind !== 'none') return kind
  return item?.mimeType === PDF_MIME && Number.isSafeInteger(item.byteLength) && item.byteLength >= 0 && item.byteLength <= MAX_PREVIEW_BYTES ? 'pdf' : 'none'
}
const validateImageDimensions = (url, signal) => new Promise((resolve, reject) => {
  const image = new Image()
  const abort = () => finish(() => reject(signal?.reason || new DOMException('Preview cancelled', 'AbortError')))
  const finish = callback => { signal?.removeEventListener('abort', abort); image.onload = null; image.onerror = null; callback() }
  image.onload = () => finish(() => {
    const width = Number(image.naturalWidth); const height = Number(image.naturalHeight)
    if (!width || !height || width > 4096 || height > 4096 || width * height > 16_000_000) reject(new Error('图片尺寸超过安全预览边界，请下载文件查看。'))
    else resolve()
  })
  image.onerror = () => finish(() => reject(new Error('图片解码失败，请下载文件查看。')))
  if (signal?.aborted) abort(); else image.src = url
})
const legacyPart = (result, kind, item) => {
  const blob = result instanceof Blob ? result : result?.blob
  if (!(blob instanceof Blob)) return []
  const expectedMime = kind === 'text' && isDocumentTextPreview(item) ? TEXT_PREVIEW_MIME : item.mimeType
  if (blob.type !== expectedMime) throw new Error('文件类型不匹配，请下载文件查看。')
  return [{ partId: 'content', contentMimeType: blob.type, blob, legacyPdf: kind === 'pdf' }]
}
const previewParts = (result, kind, item) => Array.isArray(result?.parts) ? result.parts : legacyPart(result, kind, item)

watch(() => [props.item?.artifactId, props.item?.artifactVersion, props.item?.fileRef?.fileId, props.item?.fileRef?.fileVersion, props.item?.mimeType, props.item?.byteLength, props.contextKey], async () => {
  reset()
  const item = props.item
  const kind = previewKind(item)
  if (!item || kind === 'none') return
  const current = generation
  const requestController = new AbortController()
  controller = requestController
  loading.value = true
  let rendered = []
  try {
    const result = await props.load(item, { signal: requestController.signal })
    const received = previewParts(result, kind, item)
    if (!received.length) throw new Error('预览内容为空，请下载原文件查看。')
    for (const part of received) {
      if (!part || typeof part.partId !== 'string' || !['text/plain', 'image/png', item.mimeType].includes(part.contentMimeType) || !(part.blob instanceof Blob) || part.blob.type !== part.contentMimeType || (part.legacyPdf && part.blob.size > MAX_PREVIEW_BYTES)) {
        throw new Error('预览分片无效，请下载原文件查看。')
      }
      if (part.contentMimeType === TEXT_PREVIEW_MIME) rendered.push({ partId: part.partId, contentMimeType: part.contentMimeType, text: await part.blob.text(), imageUrl: '', pdfUrl: '' })
      else {
        const url = URL.createObjectURL(part.blob)
        if (part.legacyPdf) rendered.push({ partId: part.partId, contentMimeType: part.contentMimeType, text: null, imageUrl: '', pdfUrl: url })
        else {
          try { await validateImageDimensions(url, requestController.signal); rendered.push({ partId: part.partId, contentMimeType: part.contentMimeType, text: null, imageUrl: url, pdfUrl: '' }) }
          catch (error) { URL.revokeObjectURL(url); throw error }
        }
      }
    }
    if (current !== generation || requestController.signal.aborted) { for (const part of rendered) if (part.imageUrl || part.pdfUrl) URL.revokeObjectURL(part.imageUrl || part.pdfUrl); return }
    parts.value = rendered
    if (isDocumentTextPreview(item)) previewNote.value = rendered.length > 1 ? '这是服务端提供的分页/分表预览；版式、分页与公式计算请以下载原文件为准。' : '这是文档内容预览；版式、分页与公式计算请以下载原文件为准。'
  } catch (error) {
    for (const part of rendered) if (part.imageUrl || part.pdfUrl) URL.revokeObjectURL(part.imageUrl || part.pdfUrl)
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
.output-preview-navigation { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.output-preview-navigation button { border: 1px solid #b99862; border-radius: 4px; padding: 3px 7px; background: #fff8eb; color: #4a3423; }
.output-preview-error { color: #9b3a28; }
.output-preview-note { margin: 8px 0 0; color: #765f40; }
</style>
