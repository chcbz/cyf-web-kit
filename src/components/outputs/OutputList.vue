<template>
  <section class="output-list" aria-label="成果文件">
    <header>
      <strong>成果文件</strong>
      <button type="button" :disabled="loading" @click="outputs.refresh">刷新</button>
    </header>
    <p class="output-hint">共享成果可下载；悬赏分享不代表已正式验收。</p>
    <p v-if="error" role="alert">
      {{ error.message }}
      <small v-if="error.requestId">（请求 {{ error.requestId }}）</small>
      <button v-if="error.retryable" type="button" @click="outputs.refresh">重试</button>
    </p>
    <p v-if="downloadError" class="output-download-error" role="alert">
      {{ downloadError.message }}
      <small v-if="downloadError.requestId">（请求 {{ downloadError.requestId }}）</small>
      <button v-if="downloadError.retryable" type="button" @click="retryDownload">重试下载</button>
    </p>
    <p v-if="resourceError" class="output-download-error" role="alert">
      {{ resourceError.message }}
      <small v-if="resourceError.requestId">（请求 {{ resourceError.requestId }}）</small>
      <button v-if="resourceError.retryable" type="button" @click="loadRequestedResource">重试定位</button>
    </p>
    <OutputCard
      v-for="item in displayItems"
      :key="`${item.outputId}:${item.version}`"
      :highlighted="isRequested(item)"
      :item="item"
      :show-resource-route="isWechat"
      @download="download"
      @preview="previewItem = $event"
      @resource-route="copyResourceRoute"
      @versions="toggleVersions"
    />
    <p v-if="loading && !items.length">正在读取成果…</p>
    <p v-if="!loading && !items.length && !error">暂无已发布成果。</p>
    <button
      v-if="nextCursor"
      type="button"
      :disabled="loading"
      @click="outputs.loadMore"
    >加载更多</button>

    <section v-if="versionTarget" class="output-versions" aria-label="历史版本">
      <header>
        <strong>{{ versionTarget.title }}的历史版本</strong>
        <button type="button" @click="outputs.clearVersions">收起</button>
      </header>
      <p v-if="versionsError" role="alert">
        {{ versionsError.message }}
        <small v-if="versionsError.requestId">（请求 {{ versionsError.requestId }}）</small>
        <button v-if="versionsError.retryable" type="button" @click="outputs.loadVersions(versionTarget)">重试</button>
      </p>
      <OutputCard
        v-for="item in versions"
        :key="`history:${item.outputId}:${item.version}`"
        :highlighted="isRequested(item)"
        :item="item"
        :show-history="false"
        :show-resource-route="isWechat"
        @download="download"
        @preview="previewItem = $event"
        @resource-route="copyResourceRoute"
      />
      <p v-if="versionsLoading && !versions.length">正在读取历史版本…</p>
      <button
        v-if="versionNextCursor"
        type="button"
        :disabled="versionsLoading"
        @click="outputs.loadVersions(versionTarget, { more: true })"
      >更多历史版本</button>
    </section>

    <OutputPreview
      :item="previewItem"
      :detail="outputs.detail"
      :load-blob="outputs.downloadBlob"
      :source-key="previewSourceKey"
    />
    <section v-if="isWechat && resourceRoute" class="wechat-hint" aria-label="浏览器取件地址">
      <p>{{ copyStatus || '请复制以下地址，在浏览器登录后下载。' }}</p>
      <input
        :value="resourceRoute"
        readonly
        aria-label="精确成果取件地址"
        @focus="$event.target.select()"
      />
      <button type="button" @click="copyText(resourceRoute)">复制地址</button>
    </section>
  </section>
</template>
<script setup>
import { computed, ref, unref, watch } from 'vue'
import { parseOutputResourceQuery } from '../../composables/useOutputs.js'
import OutputCard from './OutputCard.vue'
import OutputPreview from './OutputPreview.vue'

const props = defineProps({ outputs: { type: Object, required: true } })
const previewItem = ref(null)
const downloadError = ref(null)
const downloadErrorItem = ref(null)
const requestedItem = ref(null)
const resourceError = ref(null)
const resourceRoute = ref('')
const copyStatus = ref('')
const source = computed(() => unref(props.outputs.source))
const lifecycleKey = computed(() => unref(props.outputs.lifecycleKey) || 0)
const items = computed(() => unref(props.outputs.items) || [])
const displayItems = computed(() => {
  if (!requestedItem.value || items.value.some(item => item.outputId === requestedItem.value.outputId && item.version === requestedItem.value.version)) return items.value
  return [requestedItem.value, ...items.value]
})
const nextCursor = computed(() => unref(props.outputs.nextCursor))
const loading = computed(() => Boolean(unref(props.outputs.loading)))
const error = computed(() => unref(props.outputs.error))
const versions = computed(() => unref(props.outputs.versions) || [])
const versionTarget = computed(() => unref(props.outputs.versionTarget))
const versionNextCursor = computed(() => unref(props.outputs.versionNextCursor))
const versionsLoading = computed(() => Boolean(unref(props.outputs.versionsLoading)))
const versionsError = computed(() => unref(props.outputs.versionsError))
const previewSourceKey = computed(() => `${source.value?.type || ''}:${source.value?.id || ''}:${lifecycleKey.value}`)
const isWechat = computed(() => /MicroMessenger/i.test(navigator.userAgent || ''))
const requested = computed(() => parseOutputResourceQuery(new URLSearchParams(window.location.search)))
const isRequested = item => requested.value?.source.type === source.value?.type &&
  requested.value?.source.id === source.value?.id && requested.value?.outputId === item.outputId && requested.value?.version === item.version
const normalizeActionError = failure => ({
  message: failure?.message || '下载失败，请重试。',
  retryable: typeof failure?.retryable === 'boolean' ? failure.retryable : (!failure?.status || failure.status === 429 || failure.status >= 500),
  requestId: failure?.requestId || ''
})
const download = async item => {
  downloadError.value = null
  downloadErrorItem.value = null
  try {
    await props.outputs.download(item)
  } catch (failure) {
    if (failure?.name !== 'AbortError') {
      downloadError.value = normalizeActionError(failure)
      downloadErrorItem.value = item
    }
  }
}
const retryDownload = () => {
  if (downloadErrorItem.value) void download(downloadErrorItem.value)
}
const toggleVersions = item => {
  if (String(versionTarget.value?.outputId) === String(item.outputId)) props.outputs.clearVersions()
  else void props.outputs.loadVersions(item)
}
const copyText = async value => {
  try {
    await navigator.clipboard?.writeText(value)
    copyStatus.value = '取件地址已复制，请在浏览器登录后下载。'
  } catch {
    copyStatus.value = '请长按或选中地址复制，并在浏览器登录后下载。'
  }
}
const copyResourceRoute = item => {
  resourceRoute.value = props.outputs.resourceRoute(item)
  copyStatus.value = ''
  void copyText(resourceRoute.value)
}
const loadRequestedResource = async () => {
  const target = requested.value
  if (!target || target.source.type !== source.value?.type || target.source.id !== source.value?.id) return
  resourceError.value = null
  const listed = items.value.find(isRequested)
  if (listed) {
    requestedItem.value = listed
    if (listed.previewKind !== 'NONE') previewItem.value = listed
    return
  }
  const requestLifecycle = lifecycleKey.value
  try {
    const payload = await props.outputs.detail({ source: target.source, outputId: target.outputId, version: target.version })
    if (requestLifecycle !== lifecycleKey.value || target.source.type !== source.value?.type || target.source.id !== source.value?.id) return
    requestedItem.value = payload.item
    if (payload.item.previewKind !== 'NONE') previewItem.value = payload.item
  } catch (failure) {
    if (failure?.name !== 'AbortError' && requestLifecycle === lifecycleKey.value) resourceError.value = normalizeActionError(failure)
  }
}
const clearLocalState = () => {
  previewItem.value = null
  downloadError.value = null
  downloadErrorItem.value = null
  resourceRoute.value = ''
  copyStatus.value = ''
  requestedItem.value = null
  resourceError.value = null
}
watch(lifecycleKey, clearLocalState)
watch(source, () => {
  clearLocalState()
  void loadRequestedResource()
}, { deep: true, immediate: true })
watch(items, current => {
  const listed = current.find(isRequested)
  if (!listed) return
  requestedItem.value = listed
  if (listed.previewKind !== 'NONE') previewItem.value = listed
})
</script>
<style scoped>
.output-list { padding:8px; border-top:1px solid rgba(116,75,35,.16); background:#fffaf0; }
.output-list header { display:flex; justify-content:space-between; align-items: center; gap: 8px; }
.output-list p { font-size:12px; }
.output-hint,.wechat-hint { color:#765f40; }
.output-list button { margin-left:4px; }
.output-versions { margin-top: 10px; padding: 8px; border: 1px dashed #cbb28b; border-radius: 7px; }
.wechat-hint input { box-sizing: border-box; width: 100%; padding: 5px; }
.output-download-error { color: #9b3a28; }
</style>
