<template>
  <section class="formal-task-delivery-panel" aria-label="正式成果办理">
    <div class="formal-task-delivery-intro">
      <p>正式交付记录仅供核对；修改要求请在原事项议事中说明，验收统一使用事项的“查看成果并验收”。</p>
      <button type="button" @click="$emit('discuss-task')">继续议事</button>
    </div>
    <FormalDeliveryList
      :key="`${taskId}:${identityFingerprint}`"
      :task-id="taskId"
      :identity-fingerprint="identityFingerprint"
      :focus-delivery-id="focusDeliveryId"
      :read-outputs="taskOutputs.items.value"
      :preview-output-key="previewOutputKey"
      :adapter="deliveryAdapter"
      @refreshed="refreshOutputs"
      @preview-output="togglePreview"
    >
      <template #preview="{ output }">
        <OutputPreview :item="output" :load="taskOutputs.preview" :context-key="taskOutputs.cacheKey.value" />
      </template>
    </FormalDeliveryList>
    <div class="formal-task-delivery-status">
      <p v-if="taskOutputs.loading.value" class="formal-output-state" role="status">正在核对固定成果版本…</p>
      <p v-else-if="taskOutputs.state.value === 'unavailable' || taskOutputs.state.value === 'forbidden'" class="formal-output-state is-error" role="alert">{{ taskOutputs.message.value }} <button type="button" @click="taskOutputs.refresh">重新读取</button></p>
    </div>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import FormalDeliveryList from './FormalDeliveryList.vue'
import OutputPreview from '../outputs/OutputPreview.vue'
import { useOutputs } from '../../composables/useOutputs.js'

const props = defineProps({
  taskId: { type: String, required: true },
  identityFingerprint: { type: String, required: true },
  focusDeliveryId: { type: String, default: '' },
  outputAdapter: { type: Object, default: undefined },
  deliveryAdapter: { type: Object, default: undefined }
})
defineEmits(['discuss-task'])
const taskSource = computed(() => props.identityFingerprint && props.taskId ? { type: 'task', id: props.taskId } : null)
const taskOutputs = useOutputs({
  source: taskSource, identityFingerprint: () => props.identityFingerprint,
  adapter: props.outputAdapter, pageSize: 100
})
const previewItem = ref(null)
const outputKey = item => item ? `${item.artifactId}:${item.artifactVersion}:${item.sha256}` : ''
const previewOutputKey = computed(() => outputKey(previewItem.value))
watch(() => `${props.taskId}:${props.identityFingerprint}`, () => { previewItem.value = null }, { flush: 'sync' })
const refreshOutputs = () => { void taskOutputs.refresh() }
const togglePreview = item => { previewItem.value = previewOutputKey.value === outputKey(item) ? null : item }
</script>
<style scoped>
.formal-task-delivery-panel {
  --formal-ground: var(--work-ground, #f3f3ed);
  --formal-paper: var(--work-paper, #fffefa);
  --formal-ink: var(--work-ink, #242e2b);
  --formal-muted: var(--work-muted, #68716b);
  --formal-line: var(--work-line, #d8d8ce);
  --formal-brand: var(--work-brand, #923f30);
  --formal-brand-surface: var(--hall-surface-brand, #f6eee8);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--formal-ground);
  color: var(--formal-ink);
}
.formal-task-delivery-intro,.formal-task-delivery-status { min-width: 0; }
.formal-task-delivery-intro {
  display: grid;
  gap: 8px;
  margin: 16px 20px 0;
  padding: 14px 16px;
  border: 1px solid var(--formal-line);
  border-radius: 10px;
  background: var(--formal-paper);
}
.formal-task-delivery-intro p { margin: 0; color: var(--formal-muted); font-size: 14px; line-height: 1.55; }
.formal-task-delivery-intro button,.formal-output-state button {
  min-height: 44px;
  border: 1px solid var(--formal-brand);
  border-radius: 8px;
  padding: 7px 12px;
  background: var(--formal-brand);
  color: var(--formal-paper);
  font: inherit;
  cursor: pointer;
}
.formal-task-delivery-intro button { justify-self: start; }
.formal-output-state {
  margin: 10px 20px 16px;
  padding: 10px 12px;
  border: 1px solid #ead8aa;
  border-radius: 8px;
  background: #fbf4df;
  color: #765d2d;
  font-size: 13px;
  line-height: 1.5;
}
.formal-output-state.is-error { border-color: #e9beb5; background: #fae7e1; color: #7a3026; }
.formal-output-state button { min-height: 44px; margin-left: 8px; padding: 4px 9px; }
.formal-task-delivery-panel button:focus-visible { outline: 3px solid color-mix(in srgb, var(--formal-brand) 52%, transparent); outline-offset: 2px; }
@media (max-width: 760px) {
  .formal-task-delivery-intro { margin: 12px 16px 0; padding: 12px; }
  .formal-output-state { margin: 10px 16px 12px; }
  .formal-task-delivery-intro button { width: 100%; }
}
</style>
