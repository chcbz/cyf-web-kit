<template>
  <section
    ref="container"
    class="pdf-document-preview"
    aria-label="PDF 原文件预览"
    :aria-busy="busy"
  >
    <p v-if="busy" role="status">正在读取 PDF…</p>
    <p v-if="state.status === 'error'" role="alert">{{ state.message }}</p>
    <canvas
      v-show="state.status === 'ready'"
      ref="canvas"
      role="img"
      :aria-label="`PDF 第 ${state.page} 页`"
    ></canvas>
    <div
      v-if="state.pageCount"
      class="pdf-page-navigation"
      role="group"
      aria-label="PDF 分页"
    >
      <button type="button" :disabled="busy || state.page <= 1" @click="showPage(state.page - 1)">上一页</button>
      <span role="status">第 {{ state.page }} / {{ state.pageCount }} 页</span>
      <button type="button" :disabled="busy || state.page >= state.pageCount" @click="showPage(state.page + 1)">下一页</button>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createPdfPreviewSession } from '@/utils/pdfPreviewSession'
const props = defineProps({ blob: { type: Object, required: true } })
const container = ref(null), canvas = ref(null)
const state = ref({ status: 'loading', page: 1, pageCount: 0, message: '' })
const busy = computed(() => ['loading', 'loaded', 'rendering'].includes(state.value.status))
const session = createPdfPreviewSession({ onState: value => { state.value = value } })
let disposed = false, observer = null, lastWidth = 0, sourceGeneration = 0
const showPage = number => {
  if (disposed || !canvas.value || !container.value) return
  const width = container.value.clientWidth
  if (width <= 0) return
  lastWidth = width
  return session.render(canvas.value, width, number, window.devicePixelRatio || 1)
}
watch(() => props.blob, async blob => {
  // Clear the previous source synchronously, before the next Vue paint.
  const current = ++sourceGeneration
  session.close()
  state.value = { status: 'loading', page: 1, pageCount: 0, message: '' }
  await nextTick()
  if (!disposed && current === sourceGeneration && await session.open(blob) && current === sourceGeneration) await showPage(1)
}, { immediate: true })
onMounted(() => {
  if (typeof ResizeObserver === 'undefined') return
  observer = new ResizeObserver(() => {
    const width = container.value?.clientWidth
    if (width > 0 && width !== lastWidth && ['loaded', 'ready', 'rendering'].includes(state.value.status)) void showPage(state.value.page)
  })
  observer.observe(container.value)
})
onBeforeUnmount(() => { disposed = true; observer?.disconnect(); session.close() })
</script>

<style scoped>
.pdf-document-preview { width: 100%; min-width: 0; }
.pdf-document-preview canvas { display: block; max-width: 100%; margin: 0 auto; }
.pdf-page-navigation { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 12px; margin-top: 12px; }
.pdf-page-navigation button { min-height: 44px; }
</style>
