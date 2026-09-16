<template>
  <section class="output-list" aria-label="已分享成果">
    <header><strong>已分享成果</strong><button type="button" :disabled="outputs.loading.value" @click="outputs.refresh">刷新</button></header>
    <p v-if="outputs.state.value === 'available' && outputs.items.value.length" class="output-hint">已分享，非正式验收。</p>
    <p v-if="outputs.state.value === 'empty' && !outputs.loading.value" class="output-state">暂无可领取成果。</p>
    <p v-else-if="outputs.state.value === 'syncing'" class="output-state">成果同步中，聊天和悬赏主体不受影响。</p>
    <p v-else-if="outputs.state.value === 'forbidden'" class="output-state is-error">无访问权限。</p>
    <p v-else-if="outputs.state.value === 'unavailable'" class="output-state is-error">{{ outputs.message.value }} <button type="button" @click="outputs.refresh">刷新</button></p>
    <p v-else-if="outputs.loading.value" class="output-state">成果目录读取中…</p>
    <article v-for="item in outputs.items.value" :key="`${item.artifactId}:${item.artifactVersion}`" class="output-card">
      <div><strong>{{ item.title }}</strong><span>{{ item.artifactType }}</span></div>
      <p>版本 {{ item.artifactVersion }} · {{ sizeText(item.byteLength) }}<template v-if="item.sha256"> · {{ item.sha256.slice(0, 12) }}</template></p>
      <p v-if="formatDate(item.createdAt)">{{ formatDate(item.createdAt) }}</p>
      <div class="output-actions">
        <button v-if="previewKind(item) !== 'none'" type="button" @click="previewItem = item">预览</button>
        <button type="button" :disabled="!item.canDownload || item.state !== 'AVAILABLE'" @click="download(item)">下载</button>
      </div>
    </article>
    <button
      v-if="outputs.nextCursor.value"
      type="button"
      :disabled="outputs.loading.value"
      @click="outputs.loadMore"
    >加载更多</button>
    <p v-if="actionError" class="output-state is-error">{{ actionError }} <button type="button" @click="retry">重试</button></p>
    <OutputPreview :item="previewItem" :load="outputs.preview" :context-key="outputs.cacheKey.value" />
  </section>
</template>

<script setup>
import { ref } from 'vue'
import { outputPreviewKind, useOutputs } from '../../composables/useOutputs.js'
import { saveOutputBlob } from '../../utils/outputDownload.js'
import OutputPreview from './OutputPreview.vue'

const props = defineProps({ source: { type: [Object, Function], default: null }, identityFingerprint: { type: [String, Object, Function], default: '' }, adapter: { type: Object, default: undefined } })
const outputs = useOutputs({ source: () => props.source, identityFingerprint: () => props.identityFingerprint, adapter: props.adapter })
const previewItem = ref(null)
const actionError = ref('')
const retryItem = ref(null)
const previewKind = outputPreviewKind
const sizeText = bytes => bytes == null ? '大小未知' : bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
const formatDate = value => { const time = typeof value === 'number' ? value : Date.parse(value); return Number.isFinite(time) ? new Date(time).toLocaleString('zh-CN', { hour12: false }) : '' }
const download = async item => {
  actionError.value = ''; retryItem.value = null
  try { const result = await outputs.download(item); saveOutputBlob({ blob: result instanceof Blob ? result : result?.blob, item }) } catch (error) { if (error?.name !== 'AbortError') { actionError.value = error?.message || '下载失败，请刷新确认。'; retryItem.value = item } }
}
const retry = () => { if (retryItem.value) void download(retryItem.value); else void outputs.refresh() }
</script>

<style scoped>
.output-list { margin-top: 12px; padding: 10px; border: 1px solid rgba(116,75,35,.18); border-radius: 8px; background: #fffaf0; }
.output-list header,.output-card > div:first-child,.output-actions { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.output-list button { border:1px solid #b99862; border-radius:5px; background:#fff8eb; color:#4a3423; padding:3px 8px; }
.output-hint,.output-card p,.output-card span,.output-state { color:#765f40; font-size:12px; }
.output-card { margin-top:8px; padding:8px; border:1px solid #e4d8c7; border-radius:6px; background:#fffdf8; }
.output-card p { margin:4px 0; }
.output-actions { justify-content:flex-start; }
.is-error { color:#9b3a28; }
</style>
