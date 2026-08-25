<template>
  <div v-if="modelValue" class="onboarding-overlay" @pointerdown.self="later">
    <section
      ref="dialogRef"
      class="onboarding-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hall-onboarding-title"
      aria-describedby="hall-onboarding-description"
      tabindex="-1"
      @keydown="handleDialogKeydown"
    >
      <div class="dialog-heading">
        <div>
          <p class="eyebrow">聚义厅 · 新手引导</p>
          <h1 id="hall-onboarding-title">从一件小事开始协作</h1>
        </div>
        <button class="close-button" type="button" aria-label="稍后查看新手引导" @click="later">×</button>
      </div>

      <p id="hall-onboarding-description" class="intro">这是一份操作地图，不会替你创建任务、选择帮手或执行工作。</p>

      <ol class="onboarding-steps">
        <li>
          <strong>先熟悉聚义厅</strong>
          <span>地图用于查看厅内动态；点将册、悬赏榜和案卷阁分别承载帮手、任务与可复用资料。</span>
        </li>
        <li>
          <strong>从任务或模板起步</strong>
          <span>可在悬赏榜新建一件明确的事，再按需要补充目标和验收标准。</span>
          <em v-if="template">访客体验带来的参考模板：{{ templateLabel }}</em>
        </li>
        <li>
          <strong>选择帮手或托管选项</strong>
          <span>在点将册挑选合适帮手；如需托管方式，可到招贤令查看可用选项。</span>
        </li>
        <li>
          <strong>回到案卷阁复用结果</strong>
          <span>可沉淀和检索的资料会在案卷阁中持续可见，便于下一次任务引用。</span>
        </li>
      </ol>

      <div class="dialog-actions">
        <button class="later-button" type="button" @click="later">稍后</button>
        <button class="skip-button" type="button" @click="$emit('skip')">跳过本版本</button>
        <button class="complete-button" type="button" @click="$emit('complete')">我知道了</button>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { guestDemoTemplates } from '@/constants/publicBetaDemo'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  template: { type: String, default: null },
  backgroundTarget: { type: Object, default: null },
  returnFocusTarget: { type: Object, default: null }
})

const emit = defineEmits(['update:modelValue', 'later', 'skip', 'complete'])

const dialogRef = ref(null)
let previousActiveElement = null
let backgroundState = null
const templateLabel = computed(() => guestDemoTemplates.find(item => item.id === props.template)?.eyebrow || props.template)

const focusableSelector = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])'
].join(',')

const focusableElements = () => [...(dialogRef.value?.querySelectorAll(focusableSelector) || [])]
  .filter(element => !element.hasAttribute('disabled') && element.getClientRects().length > 0)

const restoreBackground = () => {
  const state = backgroundState
  backgroundState = null
  if (!state?.target?.isConnected) return

  if (state.hadInert) state.target.setAttribute('inert', state.inertValue)
  else state.target.removeAttribute('inert')
  if ('inert' in state.target) state.target.inert = state.inertProperty

  if (state.hadAriaHidden) state.target.setAttribute('aria-hidden', state.ariaHidden)
  else state.target.removeAttribute('aria-hidden')
}

const makeBackgroundInert = () => {
  const target = props.backgroundTarget
  if (!target || backgroundState) return

  backgroundState = {
    target,
    hadInert: target.hasAttribute('inert'),
    inertValue: target.getAttribute('inert'),
    inertProperty: 'inert' in target ? target.inert : false,
    hadAriaHidden: target.hasAttribute('aria-hidden'),
    ariaHidden: target.getAttribute('aria-hidden')
  }
  target.setAttribute('inert', '')
  if ('inert' in target) target.inert = true
  target.setAttribute('aria-hidden', 'true')
}

const restoreFocus = () => {
  const target = previousActiveElement?.isConnected
    ? previousActiveElement
    : props.returnFocusTarget?.isConnected
      ? props.returnFocusTarget
      : null
  previousActiveElement = null
  target?.focus?.()
}

const openDialog = async () => {
  previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
  makeBackgroundInert()
  await nextTick()
  dialogRef.value?.focus()
}

const closeDialog = () => {
  restoreBackground()
  restoreFocus()
}

const handleDialogKeydown = event => {
  if (event.key === 'Escape') {
    event.preventDefault()
    later()
    return
  }
  if (event.key !== 'Tab') return

  const elements = focusableElements()
  if (elements.length === 0) {
    event.preventDefault()
    dialogRef.value?.focus()
    return
  }

  const first = elements[0]
  const last = elements[elements.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(() => props.modelValue, visible => {
  if (visible) openDialog()
  else closeDialog()
}, { flush: 'post' })

onBeforeUnmount(() => {
  restoreBackground()
  restoreFocus()
})

const later = () => {
  // A close is intentionally equivalent to session-only "later" behavior.
  emit('later')
}
</script>

<style scoped>
.onboarding-overlay { position: fixed; inset: 0; z-index: 260; display: grid; place-items: center; padding: 20px; background: rgba(13, 25, 23, 0.56); }
.onboarding-dialog { box-sizing: border-box; width: min(100%, 680px); max-height: min(760px, calc(100vh - 40px)); overflow: auto; padding: clamp(22px, 4vw, 34px); border: 1px solid rgba(255, 255, 255, 0.28); border-radius: 22px; color: #173936; background: #fffdf8; box-shadow: 0 28px 80px rgba(0, 0, 0, 0.28); outline: none; }
.dialog-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
.eyebrow { margin: 0 0 8px; color: #2e6854; font-size: 12px; font-weight: 800; letter-spacing: 0.08em; }
h1 { margin: 0; font-size: clamp(26px, 5vw, 38px); line-height: 1.16; letter-spacing: -0.04em; }
.close-button { width: 36px; height: 36px; border: 0; border-radius: 50%; color: #285a50; font-size: 28px; line-height: 1; background: #edf3e9; cursor: pointer; }
.intro { margin: 18px 0 20px; color: #5d6861; line-height: 1.65; }
.onboarding-steps { display: grid; gap: 12px; padding: 0; margin: 0; list-style: none; counter-reset: onboarding; }
.onboarding-steps li { position: relative; min-width: 0; padding: 15px 16px 15px 54px; border: 1px solid #e3ded1; border-radius: 14px; background: #fffefa; counter-increment: onboarding; }
.onboarding-steps li::before { position: absolute; top: 16px; left: 16px; display: grid; place-items: center; width: 25px; height: 25px; border-radius: 50%; color: #fff; font-size: 12px; font-weight: 800; content: counter(onboarding); background: #2e6854; }
.onboarding-steps strong, .onboarding-steps span, .onboarding-steps em { display: block; }
.onboarding-steps strong { margin-bottom: 5px; font-size: 15px; }
.onboarding-steps span { color: #58645d; font-size: 14px; line-height: 1.55; }
.onboarding-steps em { margin-top: 8px; color: #2e6854; font-size: 13px; font-style: normal; font-weight: 700; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap; margin-top: 24px; }
.dialog-actions button { min-height: 42px; padding: 0 16px; border-radius: 999px; font-size: 14px; font-weight: 800; cursor: pointer; }
.later-button, .skip-button { border: 1px solid #cfdacf; color: #285a50; background: #fffdf8; }
.complete-button { border: 1px solid #f6c64a; color: #173936; background: #f6c64a; }
@media (max-width: 480px) { .onboarding-overlay { padding: 10px; } .onboarding-dialog { max-height: calc(100vh - 20px); border-radius: 16px; } .dialog-actions button { flex: 1 1 100%; } }
</style>
