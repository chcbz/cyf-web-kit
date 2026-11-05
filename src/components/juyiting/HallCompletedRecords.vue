<template>
  <section class="completed-records" aria-label="成果与验收记录">
    <header><h3>成果与验收记录</h3><p class="muted">{{ archived ? '已归档' : '已完成' }} · 只读</p><p>{{ title }}</p><p class="muted">已验收的版本固定保留。其他历史成果不代表已验收。</p></header>
    <p v-if="loading" role="status">正在读取成果与验收记录…</p>
    <p v-else-if="error" role="alert">{{ error }} <button type="button" @click="retry">重试</button></p>
    <template v-else>
      <p v-if="!records.complete" role="status">验收记录暂未完整加载，请重新核对。<button type="button" @click="retry">重新核对</button></p>
      <section aria-label="已验收成果">
        <h4>已验收成果（{{ records.accepted.length }}）</h4>
        <p v-if="!records.accepted.length" class="muted">尚未核对到已验收的固定成果。</p>
        <template v-for="group in groups" :key="group.name">
          <component
            :is="group.history ? 'details' : 'div'"
            :class="{ 'completed-history': group.history }"
            :open="group.history && group.rows.some(row => row.key === expandedKey)"
            @toggle="group.history && $event.target.open && $emit('open-history')"
          >
            <summary v-if="group.history">其他历史成果（已加载 {{ group.rows.length }} 项）</summary>
            <p v-if="group.history" class="muted">仅供查阅，不属于上方已验收的固定版本。</p>
            <article v-for="(row, index) in group.rows" :key="row.key" class="completed-result">
              <div class="completed-result-heading">
                <div><strong>{{ rowTitle(row, index) }}</strong><p class="muted">{{ group.name }} {{ index + 1 }} · 版本 {{ row.item.artifactVersion }}</p><small v-if="!exactOutput(row)">成果编号：{{ row.item.artifactId }}</small></div>
                <div class="completed-result-actions">
                  <button
                    type="button"
                    :disabled="!!row.item.unavailableReason"
                    :aria-expanded="expandedKey === row.key"
                    :aria-controls="previewId(row)"
                    @click="togglePreview(row)"
                  >{{ expandedKey === row.key ? '收起预览' : '预览' }}</button>
                  <button type="button" :disabled="!canTransfer(row) || !!busy" @click="transfer(row, index, 'download')">{{ busy === `download:${row.key}` ? '下载中…' : '下载' }}</button>
                  <button type="button" :disabled="!canTransfer(row) || !!busy || savedKeys.includes(row.key)" @click="transfer(row, index, 'save')">{{ savedKeys.includes(row.key) ? '已保存' : busy === `save:${row.key}` ? '保存中…' : unknownKeys.includes(row.key) ? '核对保存结果' : '保存' }}</button>
                </div>
              </div>
              <p v-if="actionMessages[row.key]" role="status">{{ actionMessages[row.key] }}</p>
              <p v-if="!row.item.unavailableReason && !canTransfer(row)" class="muted">{{ outputs.loading.value ? '正在读取固定成果…' : '此固定成果暂不可领取，请重新核对。' }} <button v-if="!outputs.loading.value" type="button" @click="retryPreview">重新核对成果</button></p>
              <p v-if="row.item.unavailableReason" role="status">该成果暂时无法预览，验收记录仍保留。</p>
              <section
                v-if="expandedKey === row.key"
                :id="previewId(row)"
                class="completed-inline-preview"
                aria-label="对应成果预览"
              >
                <p>正在预览：{{ rowTitle(row, index) }} · 版本 {{ row.item.artifactVersion }}</p>
                <p v-if="outputs.loading.value" role="status">正在读取此固定成果…</p>
                <OutputPreview
                  v-else-if="exactOutput(row)?.canPreview"
                  :key="row.key"
                  :item="exactOutput(row)"
                  :load="outputs.preview"
                  :context-key="outputs.cacheKey.value"
                />
                <p v-else role="status">{{ outputs.message.value && ['error', 'forbidden', 'unavailable'].includes(outputs.state.value) ? outputs.message.value : '此固定成果暂不可预览，不会换用其他版本。' }} <button type="button" @click="retryPreview">重试预览</button></p>
              </section>
            </article>
            <p v-if="group.history && historyLoaded && !historyHasMore && !historyError && !group.rows.length" class="muted">没有其他正式交付历史成果。</p>
            <template v-if="group.history">
              <p v-if="historyLoading" role="status">正在读取历史交付…</p>
              <p v-if="historyError" role="alert">{{ historyError }}</p>
              <button
                v-if="historyError || !historyLoaded || historyHasMore"
                type="button"
                :disabled="historyLoading || loading"
                @click="$emit('load-history')"
              >{{ historyError ? '重试当前页' : historyLoaded ? '加载更多历史交付' : '读取历史交付' }}</button>
            </template>
          </component>
        </template>
      </section>
      <details class="completed-receipt"><summary>验收记录</summary>
        <p v-if="!records.accepted.length">验收成果关联待核对。</p>
        <div v-for="batch in records.acceptedBatches" :key="batch.deliveryId">
          <p>验收状态：已通过 · {{ batch.items.filter(item => item.displayRole === 'RESULT').length }} 份固定成果</p>
          <p>第 {{ batch.deliveryVersion }} 版</p>
        </div>
      </details>
    </template>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { artifactRegistrationRequest, confirmedArtifactRegistration } from '../../composables/juyiting/taskArtifactRegistration.js'
import { saveOutputBlob, safeOutputFilename } from '../../utils/outputDownload.js'
import OutputPreview from '../outputs/OutputPreview.vue'
import { useOutputs } from '../../composables/useOutputs.js'
import { completedReviewRecords, exactReviewOutput, completedRecordTitle, reviewItemOutput } from '../../composables/juyiting/completedReviewRecords.js'
import { createApi } from '../../composables/useHttp.js'
const props = defineProps({
  taskId: { type: String, required: true }, taskVersion: { type: [String, Number], default: '' },
  identityKey: { type: String, required: true }, title: { type: String, default: '' }, archived: { type: Boolean, default: false },
  historyLoaded: { type: Boolean, default: true }, historyLoading: { type: Boolean, default: false },
  historyHasMore: { type: Boolean, default: false }, historyError: { type: String, default: '' },
  context: { type: Object, default: null }, loading: { type: Boolean, default: false }, error: { type: String, default: '' }
})
const emit = defineEmits(['refresh', 'open-history', 'load-history'])
const records = computed(() => completedReviewRecords(props.context, props.taskId))
const projectedOutputs = computed(previous => {
  // Preserve existing item identities when another history page is appended so an
  // open preview does not download the same fixed version again. No extra retained cache.
  const prior = new Map((previous || []).map(item => [JSON.stringify([item.artifactId, item.artifactVersion, item.sha256]), item]))
  return [...records.value.accepted, ...records.value.history].map(row => {
    const item = reviewItemOutput(row.item)
    if (!item) return null
    const old = prior.get(JSON.stringify([item.artifactId, item.artifactVersion, item.sha256]))
    return old && old.title === item.title && old.mimeType === item.mimeType && old.byteLength === item.byteLength ? old : item
  }).filter(Boolean)
})
const outputs = useOutputs({ source: () => props.identityKey ? { type: 'task', id: props.taskId } : null,
  identityFingerprint: () => props.identityKey, providedItems: projectedOutputs })
const expandedKey = ref('')
const groups = computed(() => [{ name: '已验收成果', history: false, rows: records.value.accepted }, { name: '其他历史成果', history: true, rows: records.value.history }])
const exactOutput = row => exactReviewOutput(outputs.items.value, row.item)
const rowTitle = (row, index) => completedRecordTitle(row, index, outputs.items.value)
// File actions reuse the existing authenticated read and owner-scoped upload adapters.
// Only the view owns feedback; no acceptance/task state is mutated here.
const registrationApi = createApi('/agent')
const busy = ref('')
const savedKeys = ref([])
const actionMessages = ref({})
const unknownKeys = ref([])
const registrationRequests = new Map()
let actionEpoch = 0
let actionController = null
const canTransfer = row => !row.item.unavailableReason && !!exactOutput(row)?.canDownload
const rowStillPresent = key => [...records.value.accepted, ...records.value.history].some(row => row.key === key)
const resetActions = () => {
  actionEpoch++
  actionController?.abort()
  actionController = null
  busy.value = ''; savedKeys.value = []; actionMessages.value = {}; unknownKeys.value = []; registrationRequests.clear()
}
watch(() => [props.taskId, props.identityKey], resetActions, { flush: 'sync' })
onBeforeUnmount(resetActions)
const transfer = async (row, index, kind) => {
  if (busy.value || !canTransfer(row) || (kind === 'save' && (savedKeys.value.includes(row.key)))) return
  const epoch = actionEpoch
  const controller = new AbortController()
  actionController = controller
  const isCurrent = () => epoch === actionEpoch && !controller.signal.aborted && rowStillPresent(row.key)
  const item = exactOutput(row)
  const filename = safeOutputFilename({ title: rowTitle(row, index) })
  busy.value = `${kind}:${row.key}`; actionMessages.value[row.key] = ''
  try {
    if (kind === 'download') {
      const result = await outputs.download(item, { signal: controller.signal })
      if (!isCurrent()) return
      await saveOutputBlob({ blob: result instanceof Blob ? result : result?.blob, item: { title: filename }, signal: controller.signal, isCurrent })
    } else {
      let request = registrationRequests.get(row.key)
      if (!request) {
        request = await artifactRegistrationRequest({ taskId: props.taskId, item: row.item, filename })
        if (!isCurrent()) return
        registrationRequests.set(row.key, request)
      }
      const receipt = await registrationApi.post('/personal-workspace/task-artifact-registrations', request.data,
        { headers: { 'Idempotency-Key': request.key }, signal: controller.signal, autoLoading: false })
      if (!isCurrent()) return
      if (!confirmedArtifactRegistration(receipt, request)) throw new Error('保存结果尚未确认，请核对保存结果。')
      savedKeys.value.push(row.key)
      unknownKeys.value = unknownKeys.value.filter(key => key !== row.key)
      actionMessages.value[row.key] = receipt.file.state === 'TRASHED'
        ? '该成果已保存，但位于回收站；请到个人资料库恢复，不会重复创建。'
        : '已保存到个人资料库，可在“资料 → 成果”中查看；原成果及验收记录保持不变。'
    }
  } catch (cause) {
    if (isCurrent() && cause?.name !== 'AbortError') {
      actionMessages.value[row.key] = cause?.message || '操作失败，请重试。'
      if (kind === 'save' && !(cause?.status >= 400 && cause?.status < 500)) {
        if (!unknownKeys.value.includes(row.key)) unknownKeys.value.push(row.key)
        actionMessages.value[row.key] += ' 请点击“核对保存结果”，不会重复创建文件。'
      }
    }
  } finally {
    if (epoch === actionEpoch) { busy.value = ''; actionController = null }
  }
}
const previewId = row => `completed-preview-${encodeURIComponent(row.key)}`
const togglePreview = row => { expandedKey.value = expandedKey.value === row.key ? '' : row.key }
const retry = () => { expandedKey.value = ''; emit('refresh') }
// Missing metadata is retried at its authoritative page, never through a task-wide catalog.
const retryPreview = () => emit('refresh')
watch(() => [props.taskId, props.identityKey, props.taskVersion], () => { expandedKey.value = '' }, { flush: 'sync' })
watch(() => [props.loading, props.error], () => { if (props.loading || props.error) expandedKey.value = '' }, { flush: 'sync' })
</script>
<style scoped>
.completed-records { flex: 1; min-height: 0; min-width: 0; overflow-y: auto; overflow-x: hidden; padding: 16px; background: var(--hall-surface, #fffefa); color: var(--hall-text, #242e2b); }
header { margin-bottom: 20px; } h3 { margin: 0 0 16px; } p, strong, small { overflow-wrap: anywhere; } .muted { color: var(--hall-text-muted, #68716b); font-size: 13px; }
button { min-height: 44px; padding: 8px 12px; border: 1px solid var(--hall-border-strong, #ccd2c5); border-radius: 7px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
button:focus-visible, summary:focus-visible { outline: 3px solid var(--hall-focus-ring, #923f3052); outline-offset: 2px; }
.completed-result { border: 1px solid var(--hall-border, #e3e5dc); border-radius: 10px; padding: 14px; margin: 12px 0; }
.completed-result-heading { display: flex; align-items: center; gap: 12px; } .completed-result-heading > div { flex: 1; min-width: 0; } .completed-result-heading button { flex-shrink: 0; } .completed-result-heading > .completed-result-actions { display: flex; flex: 0 1 auto; flex-wrap: wrap; gap: 8px; }
button:disabled { opacity: .55; cursor: not-allowed; }
.completed-result-heading p { margin: 6px 0 0; }
.completed-inline-preview { border-top: 1px solid var(--hall-border, #e3e5dc); margin-top: 14px; padding-top: 12px; }
.completed-history, .completed-receipt { border-top: 1px solid var(--hall-border, #e3e5dc); margin-top: 16px; padding-top: 12px; } summary { min-height: 44px; cursor: pointer; }
@media (max-width: 600px) { .completed-result-heading { flex-wrap: wrap; align-items: flex-start; } .completed-result-heading > div:first-child, .completed-result-heading > .completed-result-actions { flex-basis: 100%; } }
</style>
