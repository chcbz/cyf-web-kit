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
          <component :is="group.history ? 'details' : 'div'" :class="{ 'completed-history': group.history }" :open="group.history && group.rows.some(row => row.key === expandedKey)">
            <summary v-if="group.history">其他历史成果（{{ group.rows.length }}）</summary>
            <p v-if="group.history" class="muted">仅供查阅，不属于上方已验收的固定版本。</p>
            <article v-for="(row, index) in group.rows" :key="row.key" class="completed-result">
              <div class="completed-result-heading">
                <div><strong>{{ rowTitle(row, index) }}</strong><p class="muted">{{ group.name }} {{ index + 1 }} · 版本 {{ row.item.artifactVersion }}</p><small v-if="!exactOutput(row)">成果编号：{{ row.item.artifactId }}</small></div>
                <button
                  type="button"
                  :disabled="!!row.item.unavailableReason"
                  :aria-expanded="expandedKey === row.key"
                  :aria-controls="previewId(row)"
                  @click="togglePreview(row)"
                >{{ expandedKey === row.key ? '收起预览' : '预览' }}</button>
              </div>
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
            <p v-if="group.history && !group.rows.length" class="muted">没有其他正式交付历史成果。</p>
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
import { computed, ref, watch } from 'vue'
import OutputPreview from '../outputs/OutputPreview.vue'
import { useOutputs } from '../../composables/useOutputs.js'
import { completedReviewRecords, exactReviewOutput } from '../../composables/juyiting/completedReviewRecords.js'
const props = defineProps({
  taskId: { type: String, required: true }, taskVersion: { type: [String, Number], default: '' },
  identityKey: { type: String, required: true }, title: { type: String, default: '' }, archived: { type: Boolean, default: false },
  context: { type: Object, default: null }, loading: { type: Boolean, default: false }, error: { type: String, default: '' }
})
const emit = defineEmits(['refresh'])
const records = computed(() => completedReviewRecords(props.context, props.taskId))
const outputs = useOutputs({ source: () => props.identityKey ? { type: 'task', id: props.taskId } : null, identityFingerprint: () => props.identityKey, pageSize: 100 })
const expandedKey = ref('')
const groups = computed(() => [{ name: '已验收成果', history: false, rows: records.value.accepted }, { name: '其他历史成果', history: true, rows: records.value.history }])
const exactOutput = row => exactReviewOutput(outputs.items.value, row.item)
const rowTitle = (row, index) => exactOutput(row)?.title || (!['result', 'output'].includes(row.item.purpose?.toLowerCase()) ? row.item.purpose : '') || `成果 ${index + 1}`
const previewId = row => `completed-preview-${encodeURIComponent(row.key)}`
const togglePreview = row => { expandedKey.value = expandedKey.value === row.key ? '' : row.key }
const retry = () => { expandedKey.value = ''; emit('refresh') }
// Follow the existing output cursor only while fixed records lack their exact metadata.
// A repeated cursor must not create an automatic read loop; errors remain explicit retry.
const seenCursors = new Set()
const retryPreview = () => { seenCursors.clear(); void outputs.refresh() }
watch(() => [props.taskId, props.identityKey, props.taskVersion, props.context], () => { expandedKey.value = ''; seenCursors.clear() }, { flush: 'sync' })
watch(() => [outputs.loading.value, outputs.nextCursor.value, records.value], () => {
  const cursor = outputs.nextCursor.value
  if (!outputs.loading.value && cursor && !seenCursors.has(cursor) && [...records.value.accepted, ...records.value.history].some(row => !exactOutput(row))) {
    seenCursors.add(cursor); void outputs.loadMore()
  }
}, { flush: 'post' })
watch(() => [props.loading, props.error], () => { if (props.loading || props.error) expandedKey.value = '' }, { flush: 'sync' })
</script>
<style scoped>
.completed-records { flex: 1; min-height: 0; min-width: 0; overflow-y: auto; overflow-x: hidden; padding: 16px; background: var(--hall-surface, #fffefa); color: var(--hall-text, #242e2b); }
header { margin-bottom: 20px; } h3 { margin: 0 0 16px; } p, strong, small { overflow-wrap: anywhere; } .muted { color: var(--hall-text-muted, #68716b); font-size: 13px; }
button { min-height: 44px; padding: 8px 12px; border: 1px solid var(--hall-border-strong, #ccd2c5); border-radius: 7px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
button:focus-visible, summary:focus-visible { outline: 3px solid var(--hall-focus-ring, #923f3052); outline-offset: 2px; }
.completed-result { border: 1px solid var(--hall-border, #e3e5dc); border-radius: 10px; padding: 14px; margin: 12px 0; }
.completed-result-heading { display: flex; align-items: center; gap: 12px; } .completed-result-heading > div { flex: 1; min-width: 0; } .completed-result-heading button { flex-shrink: 0; } .completed-result-heading p { margin: 6px 0 0; }
.completed-inline-preview { border-top: 1px solid var(--hall-border, #e3e5dc); margin-top: 14px; padding-top: 12px; }
.completed-history, .completed-receipt { border-top: 1px solid var(--hall-border, #e3e5dc); margin-top: 16px; padding-top: 12px; } summary { min-height: 44px; cursor: pointer; }
</style>
