<template>
  <section class="formal-delivery-list" aria-label="正式交付">
    <header>
      <strong>正式交付记录</strong>
      <button type="button" :disabled="deliveries.loading.value" @click="deliveries.refresh">刷新</button>
    </header>
    <p v-if="deliveries.state.value === 'loading'" class="formal-delivery-state" role="status">正式交付读取中…</p>
    <p v-else-if="deliveries.state.value === 'empty'" class="formal-delivery-state">暂无正式交付批次。</p>
    <p v-else-if="deliveries.state.value === 'forbidden'" class="formal-delivery-state is-error">无访问权限。</p>
    <p
      v-else-if="deliveries.message.value"
      class="formal-delivery-state"
      :class="{ 'is-error': ['conflict', 'unknown', 'error'].includes(deliveries.state.value) }"
      role="status"
    >{{ deliveries.message.value }} <button v-if="deliveries.state.value === 'conflict' || deliveries.state.value === 'unknown'" type="button" @click="deliveries.refresh">刷新确认</button></p>

    <p v-if="focusDeliveryId && !deliveries.loading.value && !deliveries.items.value.some(item => item.deliveryId === focusDeliveryId)" role="status">提示中的交付尚未在当前列表核对到，请刷新正式交付；不会用消息摘要代替验收依据。</p>
    <article
      v-for="delivery in deliveries.items.value"
      :key="delivery.deliveryId"
      class="formal-delivery-card"
      :class="{ 'is-requested-delivery': delivery.deliveryId === focusDeliveryId }"
    >
      <strong v-if="delivery.deliveryId === focusDeliveryId">本次待核对的交付</strong>
      <div class="formal-delivery-head">
        <strong>{{ stateText(delivery.state) }}</strong>
        <span>第 {{ delivery.revision }} 版</span>
      </div>
      <p class="formal-delivery-summary">{{ delivery.summary || '未提供交付摘要。' }}</p>
      <p>提交于 {{ formatTime(delivery.submittedAt) }}</p>
      <section class="formal-artifacts" aria-label="交付文件">
        <h4>交付文件</h4>
        <ul>
          <li v-for="artifact in delivery.items" :key="`${artifact.artifactId}:${artifact.artifactVersion}`">
            <div class="formal-artifact-copy">
              <strong>{{ readableArtifact(delivery, artifact)?.title || artifact.purpose || '正式成果' }}</strong>
              <span>{{ artifact.purpose || '正式成果' }} · 固定版本 v{{ artifact.artifactVersion }}</span>
            </div>
            <div v-if="readableArtifact(delivery, artifact)" class="formal-artifact-actions">
              <button
                v-if="canPreview(readableArtifact(delivery, artifact))"
                type="button"
                :aria-label="`预览第 ${delivery.revision} 版${artifact.purpose || '正式成果'}`"
                :aria-pressed="isPreviewing(delivery, artifact)"
                @click="$emit('preview-output', readableArtifact(delivery, artifact))"
              >{{ isPreviewing(delivery, artifact) ? '收起预览' : '预览' }}</button>
            </div>
            <div v-if="isPreviewing(delivery, artifact)" class="formal-inline-preview">
              <slot name="preview" :output="readableArtifact(delivery, artifact)" />
            </div>
          </li>
        </ul>
      </section>

      <section v-if="delivery.reviewedAt || delivery.reviewReason" class="formal-review" aria-label="验收意见">
        <h4>验收意见</h4>
        <p v-if="delivery.reviewedAt">{{ formatTime(delivery.reviewedAt) }}</p>
        <p>{{ delivery.reviewReason || '未填写验收意见。' }}</p>
      </section>
    </article>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, watch } from 'vue'
import { useFormalDeliveries } from '../../composables/useFormalDeliveries.js'

const props = defineProps({
  focusDeliveryId: { type: String, default: '' },
  taskId: { type: [String, Number], default: '' },
  identityFingerprint: { type: [String, Object, Function], default: '' },
  adapter: { type: Object, default: undefined },
  readOutputs: { type: Array, default: () => [] },
  previewOutputKey: { type: String, default: '' }
})
const emit = defineEmits(['refreshed', 'preview-output'])
const deliveries = useFormalDeliveries({ taskId: () => String(props.taskId || ''), identityFingerprint: () => props.identityFingerprint, adapter: props.adapter })
watch(() => deliveries.items.value, () => emit('refreshed'))
const safeReadOutputs = computed(() => Array.isArray(props.readOutputs) ? props.readOutputs : [])
const readableArtifact = (delivery, artifact) => safeReadOutputs.value.find(output => output &&
  output.artifactId === artifact.artifactId && String(output.artifactVersion) === String(artifact.artifactVersion) &&
  output.sha256 === artifact.contentHash && output.state === 'AVAILABLE') || null
const outputKey = output => output ? `${output.artifactId}:${output.artifactVersion}:${output.sha256}` : ''
const isPreviewing = (delivery, artifact) => Boolean(props.previewOutputKey && props.previewOutputKey === outputKey(readableArtifact(delivery, artifact)))
const previewMimeTypes = new Set([
  'text/plain', 'text/markdown', 'text/csv', 'application/json', 'image/png', 'image/jpeg', 'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
])
const canPreview = output => Boolean(output?.canPreview && previewMimeTypes.has(output.mimeType) &&
  (output.mimeType.includes('officedocument') || (Number.isSafeInteger(output.byteLength) && output.byteLength <= 1024 * 1024)))
const formatTime = value => { const time = typeof value === 'number' ? value : Date.parse(value); return Number.isFinite(time) ? new Date(time).toLocaleString('zh-CN', { hour12: false }) : '时间不可用' }
const stateText = state => ({ submitted: '待验收', accepted: '已验收', changes_requested: '要求修改' })[state] || state
onBeforeUnmount(() => deliveries.dispose())
</script>

<style scoped>
.is-requested-delivery { outline: 2px solid var(--formal-brand, #923f30); outline-offset: 2px; }
.formal-delivery-list {
  display: grid;
  gap: 12px;
  align-content: start;
  min-width: 0;
  min-height: 0;
  margin-top: 12px;
  padding: 16px 20px 20px;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  background: var(--formal-ground, #f3f3ed);
  color: var(--formal-ink, #242e2b);
  scrollbar-color: var(--formal-line, #d8d8ce) transparent;
}
.formal-delivery-list header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.formal-delivery-list header strong { font-size: 16px; }
.formal-delivery-list button {
  min-height: 44px;
  border: 1px solid var(--formal-line, #d8d8ce);
  border-radius: 8px;
  padding: 6px 10px;
  background: var(--formal-paper, #fffefa);
  color: var(--formal-ink, #242e2b);
  font: inherit;
  cursor: pointer;
}
.formal-delivery-list header button { border-color: var(--formal-brand, #923f30); background: var(--formal-brand, #923f30); color: var(--formal-paper, #fffefa); }
.formal-delivery-list button[disabled] { cursor: not-allowed; opacity: .55; }
.formal-delivery-list button:focus-visible { outline: 3px solid color-mix(in srgb, var(--formal-brand, #923f30) 52%, transparent); outline-offset: 2px; }
.formal-delivery-state { margin: 0; padding: 10px 12px; border: 1px solid #ead8aa; border-radius: 8px; background: #fbf4df; color: #765d2d; line-height: 1.5; }
.formal-delivery-state.is-error { border-color: #e9beb5; background: #fae7e1; color: #7a3026; }
.formal-delivery-card { display: grid; gap: 9px; min-width: 0; padding: 14px; border: 1px solid var(--formal-line, #d8d8ce); border-radius: 10px; background: var(--formal-paper, #fffefa); box-shadow: 0 1px 2px rgba(36, 46, 43, .04); }
.formal-delivery-card p,.formal-delivery-card h4 { margin: 0; }
.formal-delivery-head { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.formal-delivery-head span,.formal-delivery-card>p { color: var(--formal-muted, #68716b); font-size: 12px; overflow-wrap: anywhere; }
.formal-delivery-summary { color: var(--formal-ink, #242e2b)!important; font-size: 14px!important; line-height: 1.55; }
.formal-artifacts,.formal-review { display: grid; gap: 8px; padding-top: 10px; border-top: 1px solid var(--formal-line, #d8d8ce); }
.formal-artifacts ul { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.formal-artifacts li { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; min-width: 0; padding: 10px; border: 1px solid var(--formal-line, #d8d8ce); border-radius: 8px; background: var(--formal-brand-surface, #f6eee8); font-size: 12px; overflow-wrap: anywhere; }
.formal-artifact-copy { display: grid; gap: 3px; min-width: 0; }
.formal-artifacts li span { color: var(--formal-muted, #68716b); }
.formal-artifact-actions { display: flex; gap: 6px; }
.formal-artifact-actions button { min-width: 52px; }
.formal-inline-preview { grid-column: 1/-1; min-width: 0; }
.formal-inline-preview :deep(.output-preview) { max-height: 320px; margin-top: 0; border-color: var(--formal-line, #d8d8ce); background: var(--formal-paper, #fffefa); }
.formal-review { font-size: 13px; }
.formal-technical { color: var(--formal-muted, #68716b); font-size: 11px; }
.formal-technical summary { cursor: pointer; }
.formal-technical ul { margin: 6px 0 0; padding-left: 18px; overflow-wrap: anywhere; }
@media (max-width: 760px) {
  .formal-delivery-list { gap: 10px; margin-top: 10px; padding: 12px 16px 16px; }
  .formal-delivery-card { padding: 12px; }
}
@media (max-width: 420px) {
  .formal-artifacts li { grid-template-columns: minmax(0, 1fr); align-items: stretch; }
  .formal-artifact-actions { display: grid; grid-template-columns: minmax(0, 1fr); }
  .formal-artifact-actions button { width: 100%; min-height: 44px; }
  .formal-inline-preview { grid-column: 1; }
}
</style>
