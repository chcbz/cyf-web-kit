<template>
  <dialog ref="dialog" class="hall-review-dialog" aria-labelledby="hall-review-title" tabindex="-1" @keydown.tab="trapFocus" @cancel.prevent="back" @close="restoreFocus">
    <header>
      <button type="button" class="review-back" :disabled="pending" @click="back"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m14 5-7 7 7 7" /></svg> 返回</button>
      <h2 id="hall-review-title">{{ selectionMode ? '选择成果并验收' : '查看成果并验收' }}</h2>
    </header>
    <section v-if="selectionMode" class="review-content">
      <p>选择要验收的成果（已选 {{ selectedKeys.length }} 项），也可以选择历史版本。</p>
      <p v-if="!choices.length" role="status">暂无可验收成果，请关闭后重新读取成果。</p>
      <ul><li v-for="(item, index) in choices" :key="item.key">
        <label><input type="checkbox" :checked="selectedKeys.includes(item.key)" :disabled="pending || selectionLocked" @change="$emit('toggle', item.key)" />
          <strong>{{ item.title || item.outputId || '文字成果' }}</strong><small>成果 {{ index + 1 }}</small></label>
        <button
          type="button"
          class="review-selection-preview"
          :disabled="pending"
          :aria-expanded="activeSelectionKey === item.key"
          :aria-controls="`review-selection-preview-${index}`"
          :aria-label="`${activeSelectionKey === item.key ? '收起' : '预览'}成果 ${index + 1}：${item.title || item.outputId || '文字成果'}`"
          @click="toggleSelectionPreview(item)"
        >{{ activeSelectionKey === item.key ? '收起预览' : '预览' }}</button>
        <section
          v-if="activeSelectionKey === item.key"
          :id="`review-selection-preview-${index}`"
          class="review-inline-preview"
          :aria-label="`成果 ${index + 1} 预览`"
        >
          <h3>正在预览：成果 {{ index + 1 }} · {{ item.title || item.outputId || '文字成果' }}</h3>
          <slot name="selection-preview" :item="item" :index="index"></slot>
        </section>
      </li></ul>
      <p class="review-help">确认后，仅验收所选 {{ selectedKeys.length }} 项成果，事项随即完成，不再继续办理。此操作不会重新生成成果；关闭窗口不提交、不验收。</p>
      <p v-if="error" class="review-error" role="status">{{ error }}</p>
    </section>
    <section v-else-if="frozenBatch" class="review-content">
      <p>{{ frozenBatch.summary }}</p>
      <p>本次验收包含 {{ resultCount }} 项成果，将确认整个提交批次。</p>
      <ul>
        <li v-for="item in frozenBatch.items.filter(value => value.displayRole === 'RESULT')" :key="`${item.artifactId}:${item.artifactVersion}`">
          <div><strong>{{ item.purpose }}</strong><small>版本 {{ item.artifactVersion }}</small></div>
          <button type="button" class="review-preview" :disabled="!!item.unavailableReason || pending" @click="$emit('preview', item)">预览</button>
          <p v-if="item.unavailableReason" role="status">原始成果来源暂不可用，请重新核对。</p>
        </li>
      </ul>
      <slot name="preview" />
      <p class="review-help">需要修改？返回议事，告诉好汉具体要求。</p>
      <p v-if="error" class="review-error" role="alert">{{ error }}</p>
    </section>
    <footer>
      <button type="button" class="review-confirm" :disabled="pending || (selectionMode ? !selectedKeys.length : !frozenBatch || !!error)" @click="$emit('confirm')">{{ pending ? '正在提交…' : '确认验收' }}</button>
    </footer>
  </dialog>
</template>
<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
const props = defineProps({ open: { type: Boolean, default: false }, context: { type: Object, default: null },
  selectionMode: { type: Boolean, default: false }, choices: { type: Array, default: () => [] },
  selectedKeys: { type: Array, default: () => [] }, selectionLocked: { type: Boolean, default: false },
  frozenBatch: { type: Object, default: null }, pending: { type: Boolean, default: false }, error: { type: String, default: '' } })
const emit = defineEmits(['confirm', 'preview', 'back', 'toggle', 'preview-selection'])
const dialog = ref(null)
const activeSelectionKey = ref(null)
const resetSelectionPreview = () => {
  if (activeSelectionKey.value === null) return
  activeSelectionKey.value = null
  emit('preview-selection', null)
}
const toggleSelectionPreview = item => {
  if (props.pending) return
  if (activeSelectionKey.value === item.key) return resetSelectionPreview()
  activeSelectionKey.value = item.key
  emit('preview-selection', item)
}
watch(() => [props.open, props.selectionMode, props.context], resetSelectionPreview, { flush: 'sync' })
watch(() => props.choices.map(item => item.key), keys => {
  if (!keys.includes(activeSelectionKey.value)) resetSelectionPreview()
}, { flush: 'sync' })
const resultCount = computed(() => props.frozenBatch?.items.filter(item => item.displayRole === 'RESULT').length || 0)
let previousFocus = null
const restoreFocus = () => {
  resetSelectionPreview()
  const target = previousFocus?.isConnected ? previousFocus : document.querySelector('.panel-toolbar button:not(:disabled)')
  target?.focus(); previousFocus = null
}
const back = () => { if (!props.pending) emit('back') }
const trapFocus = event => {
  const el = dialog.value
  if (!el?.open) return
  const controls = [...el.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
    .filter(control => control.getClientRects().length)
  const first = controls[0]; const last = controls.at(-1)
  if (!first) { event.preventDefault(); el.focus(); return }
  if (event.shiftKey ? document.activeElement === first || !el.contains(document.activeElement)
    : document.activeElement === last || !el.contains(document.activeElement)) {
    event.preventDefault()
    const target = event.shiftKey ? last : first
    target.focus()
  }
}
watch(() => props.open, async open => {
  await nextTick()
  const el = dialog.value
  if (!el) return
  if (open && !el.open) { previousFocus = document.activeElement; el.showModal(); el.querySelector('button')?.focus() }
  else if (!open && el.open) el.close()
}, { immediate: true })
onBeforeUnmount(() => { if (dialog.value?.open) dialog.value.close(); restoreFocus() })
</script>
<style scoped>
.hall-review-dialog { box-sizing: border-box; width: min(640px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); padding: 0; border: 1px solid var(--hall-border, #e3e5dc); border-radius: var(--hall-radius-lg, 12px); color: var(--hall-text, #242e2b); background: var(--hall-surface, #fffefa); overflow: auto; font: inherit; }
.hall-review-dialog::backdrop { background: #16231e80; }
header, footer { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: var(--hall-surface, #fffefa); }
header { position: sticky; top: 0; border-bottom: 1px solid var(--hall-border, #e3e5dc); }
header h2 { font-size: 16px; margin: 0; }
footer { position: sticky; bottom: 0; justify-content: flex-end; border-top: 1px solid var(--hall-border, #e3e5dc); }
button { min-height: 44px; border: 1px solid var(--hall-border-strong, #ccd2c5); border-radius: 7px; padding: 8px 12px; color: inherit; background: transparent; font: inherit; cursor: pointer; }
button:hover:not(:disabled) { background: var(--hall-surface-subtle, #f3f3ed); }
button:focus-visible { outline: 3px solid var(--hall-focus-ring, #923f3052); outline-offset: 2px; }
button:disabled { opacity: .55; cursor: not-allowed; }
.review-back { display: inline-flex; align-items: center; gap: 4px; border-color: transparent; }
.review-confirm { color: var(--hall-surface, #fffefa); background: var(--hall-brand, #923f30); border-color: var(--hall-brand, #923f30); }
.review-confirm:hover:not(:disabled) { background: var(--hall-brand-hover, #793326); }
.review-content { padding: 12px 16px; overflow-wrap: anywhere; }
ul { margin: 12px 0; padding: 0; list-style: none; }
li { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 0; border-bottom: 1px solid var(--hall-border, #e3e5dc); }
li > div { flex: 1; min-width: 0; }
li strong, li small { display: block; }
small, .review-help { color: var(--hall-text-muted, #68716b); font-size: 13px; }
li p { flex-basis: 100%; }
.review-inline-preview { flex: 0 0 100%; min-width: 0; box-sizing: border-box; padding: 12px; border: 1px solid var(--hall-border, #e3e5dc); border-radius: 8px; background: var(--hall-surface-subtle, #f3f3ed); }
.review-inline-preview h3 { margin: 0 0 8px; font-size: 13px; overflow-wrap: anywhere; }
.review-selection-preview[aria-expanded="true"] { color: var(--hall-brand, #923f30); border-color: currentColor; }
.review-error { color: var(--hall-danger, #a13f35); }
@media (max-width: 600px) { .hall-review-dialog { width: calc(100vw - 16px); max-height: calc(100dvh - 16px); } .review-confirm { width: 100%; } }
</style>

<style scoped>
li label{display:flex;align-items:center;gap:8px;flex:1;min-width:0;overflow-wrap:anywhere}li input{width:20px;height:20px;accent-color:var(--hall-brand,#923f30);flex-shrink:0}
</style>
