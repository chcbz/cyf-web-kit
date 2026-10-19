<template>
  <dialog ref="dialog" class="hall-review-dialog" aria-labelledby="hall-review-title" tabindex="-1" @keydown.tab="trapFocus" @cancel.prevent="back" @close="restoreFocus">
    <header>
      <button type="button" class="review-back" :disabled="pending" @click="back"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m14 5-7 7 7 7" /></svg> 返回</button>
      <h2 id="hall-review-title">查看成果并验收</h2>
    </header>
    <section v-if="frozenBatch" class="review-content">
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
      <p class="review-help">需要调整？返回议事，直接告诉 Agent 修改要求。</p>
      <p v-if="error" class="review-error" role="alert">{{ error }}</p>
    </section>
    <footer>
      <button type="button" class="review-confirm" :disabled="pending || !frozenBatch || !!error" @click="$emit('confirm')">{{ pending ? '正在提交…' : '确认验收' }}</button>
    </footer>
  </dialog>
</template>
<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
const props = defineProps({ open: { type: Boolean, default: false }, context: { type: Object, default: null },
  frozenBatch: { type: Object, default: null }, pending: { type: Boolean, default: false }, error: { type: String, default: '' } })
const emit = defineEmits(['confirm', 'preview', 'back'])
const dialog = ref(null)
const resultCount = computed(() => props.frozenBatch?.items.filter(item => item.displayRole === 'RESULT').length || 0)
let previousFocus = null
const restoreFocus = () => {
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
.review-error { color: var(--hall-danger, #a13f35); }
@media (max-width: 600px) { .hall-review-dialog { width: calc(100vw - 16px); max-height: calc(100dvh - 16px); } .review-confirm { width: 100%; } }
</style>
