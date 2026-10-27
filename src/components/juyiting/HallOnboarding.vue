<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      ref="overlayRef"
      class="onboarding-overlay"
      :class="{ 'has-target': Boolean(targetRect), 'is-virtual-landscape': virtualLandscape, 'is-workbench': activeMode.endsWith('workbench') }"
      @pointerdown.self="later"
    >
      <div
        v-if="targetRect"
        class="onboarding-spotlight"
        :style="spotlightStyle"
        aria-hidden="true"
      ></div>
      <div
        v-if="arrowStyle"
        class="onboarding-arrow"
        :class="`is-${dialogPlacement}`"
        :style="arrowStyle"
        aria-hidden="true"
      ></div>

      <section
        ref="dialogRef"
        class="onboarding-dialog"
        :style="dialogStyle"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hall-onboarding-title"
        aria-describedby="hall-onboarding-description"
        tabindex="-1"
      >
        <div class="dialog-heading">
          <div>
            <p class="eyebrow">聚义厅 · {{ modeLabel }}使用指导</p>
            <h1 id="hall-onboarding-title">{{ currentStep.title }}</h1>
          </div>
          <button class="close-button" type="button" aria-label="稍后查看新手引导" @click="later">×</button>
        </div>

        <p id="hall-onboarding-description" class="intro">{{ currentStep.description }}</p>
        <p class="sr-only" aria-live="polite" aria-atomic="true">{{ currentStep.title }}。{{ currentStep.description }}</p>
        <p v-if="!targetRect && (currentStep.target || currentStep.hotspotId)" class="target-note" role="status">{{ targetNote }}</p>
        <p class="guide-note">只介绍入口，不会替你提交需求或发送消息。</p>
        <p class="step-progress">第 {{ stepIndex + 1 }} 步，共 {{ steps.length }} 步</p>
        <p v-if="templateLabel" class="template-note">访客体验参考：{{ templateLabel }}</p>

        <div class="dialog-actions">
          <button class="later-button" type="button" @click="later">稍后</button>
          <button class="skip-button" type="button" @click="$emit('skip')">跳过本版本</button>
          <button v-if="stepIndex > 0" class="previous-button" type="button" @click="previous">上一步</button>
          <button
            v-if="stepIndex < steps.length - 1"
            class="next-button complete-button"
            type="button"
            @click="next"
          >下一步</button>
          <button v-else class="complete-button" type="button" @click="$emit('complete')">我知道了</button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { guestDemoTemplates } from '@/constants/publicBetaDemo'
import { juyitingGame } from '@/game/index.js'
import { paddedTargetRect, positionOnboardingDialog, rectFromEdges, viewportBoundsToClientRect } from './hallOnboardingGeometry.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  template: { type: String, default: null },
  returnFocusTarget: { type: Object, default: null }
})

const emit = defineEmits(['update:modelValue', 'later', 'skip', 'complete'])

const workbenchSteps = mobile => {
  const navigation = mobile ? '底部导航' : '左侧导航'
  const navTarget = mobile ? '.workbench-mobile-nav' : '.hall-workbench-sidebar'
  return Object.freeze([
    { title: '从办事页开始', target: '[data-tour="workbench-request"]', description: '在“办事”页写下目标，按需添加资料。点击“开始办事”先保存需求，确认承办后才交给好汉。' },
    { title: '确认承办，再协作验收', target: `${navTarget} [data-workbench-tab="tasks"]`, description: `从${navigation}进入“事项”，打开需求，确认推荐好汉或另选。之后在原议事补充要求、查看结果和提出修改；成果提交后，查看并明确确认验收才算完成。` },
    { title: '在资料页查找与复用', target: `${navTarget} [data-workbench-tab="treasure"]`, description: `从${navigation}进入“资料”，管理文件、查看成果，选择需要引用的固定版本。资料不是必选，添加资料不等于已经发送给好汉。` },
    { title: '更多入口与使用帮助', target: `${navTarget} [data-workbench-tab="mine"]`, description: mobile
      ? '底部“我的”汇集好汉名册、典籍阁、待办提醒和厅中实景，也能重新打开“使用帮助”。点“稍后”仅收起本次引导；“跳过本版本”不影响手动重看。'
      : '左侧“我的”汇集好汉名册、典籍阁和待办提醒；侧栏下方可进入厅中实景、重看“使用帮助”。点“稍后”仅收起本次引导；“跳过本版本”不影响手动重看。' }
  ])
}
const MAP_STEPS = Object.freeze([
  { title: '回到办事工作台', description: '厅中实景是另一种浏览方式。收起引导后，选择“办事概览”回到工作台，在“办事”页描述目标并按需添加资料。' },
  { title: '确认承办好汉', description: '点击“开始办事”先保存需求，确认推荐好汉或另选后才交给好汉办理；提交成功不代表已经开工。' },
  { title: '在议事中协作与验收', description: '澄清、查看结果和提出修改都在原议事中完成。成果提交后，查看并明确确认验收才算完成。' },
  { title: '找回事项与资料', description: '工作台的“事项”可继续办理，“资料”可查找文件与固定版本成果；“我的”中可重看使用帮助。' }
])
const TOUR_STEPS = Object.freeze({
  'mobile-workbench': workbenchSteps(true),
  'desktop-workbench': workbenchSteps(false),
  'portrait-command': MAP_STEPS,
  'landscape-map': MAP_STEPS
})

const dialogRef = ref(null)
const overlayRef = ref(null)
const stepIndex = ref(0)
const activeMode = ref('portrait-command')
const virtualLandscape = ref(false)
const targetRect = ref(null)
const viewportSize = ref({ width: 0, height: 0 })
const dialogIntrinsicHeight = ref(280)

let previousActiveElement = null
let backgroundState = null
let dialogActive = false
let restoreFocusPending = false
let modalListenersActive = false
let geometryFrame = null
let geometryObserver = null
let resizeObserver = null
let observedPage = null
let observedGeometryTarget = null
let focusedHotspotKey = null
let scrolledTargetKey = null

const templateLabel = computed(() => guestDemoTemplates.find(item => item.id === props.template)?.eyebrow || '')
const steps = computed(() => TOUR_STEPS[activeMode.value] || TOUR_STEPS['portrait-command'])
const currentStep = computed(() => steps.value[Math.min(stepIndex.value, steps.value.length - 1)])
const modeLabel = computed(() => ({ 'mobile-workbench': '手机端', 'desktop-workbench': 'PC端', 'landscape-map': '厅中实景', 'portrait-command': '厅中实景' })[activeMode.value])
const targetNote = computed(() => currentStep.value?.optional
  ? '当前设备没有显示这个可选按钮，可继续下一步。'
  : '当前页面未显示这个入口。可继续阅读，收起引导后按说明进入；引导不会自动切页或提交需求。')
const dialogCssWidth = computed(() => Math.max(0, Math.min(360, (virtualLandscape.value ? viewportSize.value.height : viewportSize.value.width) - 24)))
const dialogFootprint = computed(() => virtualLandscape.value
  ? { width: dialogIntrinsicHeight.value, height: dialogCssWidth.value }
  : { width: dialogCssWidth.value, height: dialogIntrinsicHeight.value })
const dialogLayout = computed(() => positionOnboardingDialog({
  targetRect: targetRect.value,
  dialogSize: dialogFootprint.value,
  viewport: viewportSize.value
}))
const dialogPlacement = computed(() => dialogLayout.value?.placement || 'center')
const spotlightStyle = computed(() => targetRect.value ? {
  left: `${targetRect.value.left}px`, top: `${targetRect.value.top}px`,
  width: `${targetRect.value.width}px`, height: `${targetRect.value.height}px`
} : {})
const dialogStyle = computed(() => {
  const dialog = dialogLayout.value?.dialog
  if (!dialog) return {}
  const maximumHeight = Math.max(0, (virtualLandscape.value ? viewportSize.value.width : viewportSize.value.height) - 24)
  return {
    left: `${virtualLandscape.value ? dialog.left + dialog.width : dialog.left}px`,
    top: `${dialog.top}px`,
    width: `${dialogCssWidth.value}px`,
    maxHeight: `${maximumHeight}px`,
    transform: virtualLandscape.value ? 'rotate(90deg)' : 'none',
    transformOrigin: 'top left'
  }
})
const arrowStyle = computed(() => {
  const arrow = dialogLayout.value?.arrow
  return arrow ? { left: `${arrow.left}px`, top: `${arrow.top}px` } : null
})

const focusableSelector = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])'
].join(',')
const focusableElements = () => [...(dialogRef.value?.querySelectorAll(focusableSelector) || [])]
  .filter(element => !element.hasAttribute('disabled') && element.getClientRects().length > 0)
const modalIsolationBoundary = () => overlayRef.value?.parentElement || document.body

const restoreBackground = () => {
  const states = backgroundState
  backgroundState = null
  if (!states) return
  for (const state of states) {
    const { target } = state
    if (state.hadInert) target.setAttribute('inert', state.inertValue)
    else target.removeAttribute('inert')
    if (state.hadAriaHidden) target.setAttribute('aria-hidden', state.ariaHidden)
    else target.removeAttribute('aria-hidden')
  }
}

const isolateBackground = () => {
  const boundary = modalIsolationBoundary()
  const overlay = overlayRef.value
  if (!boundary || !overlay || backgroundState) return
  const states = [...boundary.children].filter(target => target !== overlay).map(target => ({
    target,
    hadInert: target.hasAttribute('inert'),
    inertValue: target.getAttribute('inert'),
    hadAriaHidden: target.hasAttribute('aria-hidden'),
    ariaHidden: target.getAttribute('aria-hidden')
  }))
  backgroundState = states
  try {
    for (const { target } of states) {
      target.setAttribute('inert', '')
      target.setAttribute('aria-hidden', 'true')
    }
  } catch (error) {
    restoreBackground()
    throw error
  }
}

const isValidReturnFocusTarget = target => target instanceof HTMLElement && target.isConnected &&
  target !== document.body && target !== document.documentElement
const restoreFocus = () => {
  const target = isValidReturnFocusTarget(previousActiveElement)
    ? previousActiveElement
    : isValidReturnFocusTarget(props.returnFocusTarget) ? props.returnFocusTarget : null
  previousActiveElement = null
  target?.focus?.()
}
const focusFirstElement = () => {
  const [first] = focusableElements()
  ;(first || dialogRef.value)?.focus?.()
}
const handleDocumentFocusin = event => {
  if (dialogRef.value && !dialogRef.value.contains(event.target)) focusFirstElement()
}
const handleDocumentKeydown = event => {
  if (event.key === 'Escape') {
    event.preventDefault()
    later()
    return
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    next()
    return
  }
  if (event.key === 'ArrowLeft' && stepIndex.value > 0) {
    event.preventDefault()
    previous()
    return
  }
  if (event.key !== 'Tab') return
  const elements = focusableElements()
  if (!elements.length) {
    event.preventDefault()
    dialogRef.value?.focus()
    return
  }
  const first = elements[0]
  const last = elements[elements.length - 1]
  const activeElement = document.activeElement
  const insideDialog = dialogRef.value?.contains(activeElement)
  if (event.shiftKey && (!insideDialog || activeElement === dialogRef.value || activeElement === overlayRef.value || activeElement === first)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (!insideDialog || activeElement === dialogRef.value || activeElement === overlayRef.value || activeElement === last)) {
    event.preventDefault()
    first.focus()
  }
}
const addModalListeners = () => {
  if (modalListenersActive) return
  modalListenersActive = true
  document.addEventListener('keydown', handleDocumentKeydown, true)
  document.addEventListener('focusin', handleDocumentFocusin, true)
}
const removeModalListeners = () => {
  if (!modalListenersActive) return
  modalListenersActive = false
  document.removeEventListener('keydown', handleDocumentKeydown, true)
  document.removeEventListener('focusin', handleDocumentFocusin, true)
}

const requestFrame = callback => window.requestAnimationFrame?.(callback) ?? window.setTimeout(callback, 16)
const cancelFrame = handle => {
  window.cancelAnimationFrame?.(handle)
  window.clearTimeout?.(handle)
}
const readViewport = () => ({
  width: Math.max(0, Number(window.visualViewport?.width) || Number(window.innerWidth) || 0),
  height: Math.max(0, Number(window.visualViewport?.height) || Number(window.innerHeight) || 0)
})
// Match the workbench's CSS breakpoint, not orientation or keyboard-shrunk visualViewport.
const experienceMode = page => page?.classList?.contains('home-overview')
  ? (window.innerWidth <= 760 ? 'mobile-workbench' : 'desktop-workbench')
  : page?.classList?.contains('experience-landscape-map') ? 'landscape-map' : 'portrait-command'
const stepKey = step => `${activeMode.value}:${stepIndex.value}:${step?.hotspotId || step?.target || 'missing'}`
const updateObservedTarget = target => {
  if (!resizeObserver || observedGeometryTarget === target) return
  if (observedGeometryTarget) resizeObserver.unobserve?.(observedGeometryTarget)
  observedGeometryTarget = target || null
  if (observedGeometryTarget) resizeObserver.observe(observedGeometryTarget)
}
const measureDialog = () => {
  const height = Number(dialogRef.value?.offsetHeight)
  if (Number.isFinite(height) && height > 0) dialogIntrinsicHeight.value = height
}
const hotspotClientRect = (hotspotId, page) => viewportBoundsToClientRect({
  bounds: juyitingGame.getHotspotScreenBounds?.(hotspotId),
  canvasRect: page?.querySelector?.('.hall-board .melon-layer canvas')?.getBoundingClientRect?.(),
  viewport: juyitingGame.getRenderSnapshot?.()?.viewport,
  virtualLandscape: page?.classList?.contains('is-virtual-landscape') === true
})

const syncGeometry = () => {
  geometryFrame = null
  if (!dialogActive) return
  viewportSize.value = readViewport()
  const page = document.querySelector?.('.juyi-page')
  const mode = experienceMode(page)
  const nextVirtualLandscape = mode === 'landscape-map' && page?.classList?.contains('is-virtual-landscape') === true
  if (mode !== activeMode.value || nextVirtualLandscape !== virtualLandscape.value) {
    activeMode.value = mode
    virtualLandscape.value = nextVirtualLandscape
    stepIndex.value = 0
    targetRect.value = null
    focusedHotspotKey = null
    scrolledTargetKey = null
    updateObservedTarget(null)
  }
  const step = currentStep.value
  const key = stepKey(step)
  let rect = null
  if (step?.hotspotId) {
    if (focusedHotspotKey !== key) {
      let focused = false
      try { focused = juyitingGame.focusHotspot?.(step.hotspotId) === true } catch { focused = false }
      if (focused) focusedHotspotKey = key
    }
    if (focusedHotspotKey === key) rect = hotspotClientRect(step.hotspotId, page)
    updateObservedTarget(page?.querySelector?.('.hall-board .melon-layer canvas') || null)
  } else {
    const target = step?.target ? [...(page?.querySelectorAll?.(step.target) || [])].find(element => element.getClientRects().length > 0) : null
    updateObservedTarget(target || null)
    rect = rectFromEdges(target?.getBoundingClientRect?.())
    const canFitInViewport = rect && rect.height <= viewportSize.value.height - 24
    const needsScroll = rect && (rect.bottom <= 0 || rect.top >= viewportSize.value.height ||
      rect.right <= 0 || rect.left >= viewportSize.value.width ||
      (canFitInViewport && (rect.top < 0 || rect.bottom > viewportSize.value.height)))
    if (needsScroll) {
      if (scrolledTargetKey !== key) {
        scrolledTargetKey = key
        target.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'auto' })
        scheduleGeometry()
      }
      rect = null
    }
  }
  targetRect.value = paddedTargetRect(rect, viewportSize.value)
  measureDialog()
  if (step?.hotspotId) scheduleGeometry()
}
const scheduleGeometry = () => {
  if (!dialogActive || geometryFrame !== null || typeof window === 'undefined') return
  geometryFrame = requestFrame(syncGeometry)
}
const startGeometryTracking = () => {
  if (typeof window === 'undefined') return
  observedPage = document.querySelector?.('.juyi-page') || null
  window.addEventListener('resize', scheduleGeometry)
  window.addEventListener('scroll', scheduleGeometry, true)
  window.visualViewport?.addEventListener?.('resize', scheduleGeometry)
  window.visualViewport?.addEventListener?.('scroll', scheduleGeometry)
  const ResizeObserverImpl = window.ResizeObserver || globalThis.ResizeObserver
  if (ResizeObserverImpl) {
    resizeObserver = new ResizeObserverImpl(scheduleGeometry)
    if (dialogRef.value) resizeObserver.observe(dialogRef.value)
    if (observedPage) resizeObserver.observe(observedPage)
  }
  if (typeof MutationObserver !== 'undefined' && observedPage) {
    geometryObserver = new MutationObserver(scheduleGeometry)
    geometryObserver.observe(observedPage, { attributes: true, attributeFilter: ['class'] })
  }
  scheduleGeometry()
}
const stopGeometryTracking = () => {
  if (geometryFrame !== null && typeof window !== 'undefined') cancelFrame(geometryFrame)
  geometryFrame = null
  geometryObserver?.disconnect?.()
  geometryObserver = null
  resizeObserver?.disconnect?.()
  resizeObserver = null
  observedPage = null
  observedGeometryTarget = null
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', scheduleGeometry)
    window.removeEventListener('scroll', scheduleGeometry, true)
    window.visualViewport?.removeEventListener?.('resize', scheduleGeometry)
    window.visualViewport?.removeEventListener?.('scroll', scheduleGeometry)
  }
}

const moveToStep = index => {
  stepIndex.value = Math.max(0, Math.min(index, steps.value.length - 1))
  targetRect.value = null
  focusedHotspotKey = null
  scrolledTargetKey = null
  updateObservedTarget(null)
  nextTick(scheduleGeometry)
}
const previous = () => moveToStep(stepIndex.value - 1)
const next = () => stepIndex.value < steps.value.length - 1 ? moveToStep(stepIndex.value + 1) : emit('complete')
const openDialog = async () => {
  if (dialogActive) return
  const activeElement = document.activeElement
  previousActiveElement = isValidReturnFocusTarget(activeElement) ? activeElement : null
  const page = document.querySelector?.('.juyi-page')
  dialogActive = true
  restoreFocusPending = true
  activeMode.value = experienceMode(page)
  virtualLandscape.value = activeMode.value === 'landscape-map' && page?.classList?.contains('is-virtual-landscape') === true
  stepIndex.value = 0
  targetRect.value = null
  focusedHotspotKey = null
  scrolledTargetKey = null
  viewportSize.value = readViewport()
  try {
    isolateBackground()
    addModalListeners()
    await nextTick()
    if (!dialogActive) return
    startGeometryTracking()
    focusFirstElement()
  } catch {
    closeDialog()
  }
}
const closeDialog = () => {
  const shouldRestoreFocus = restoreFocusPending
  dialogActive = false
  restoreFocusPending = false
  stopGeometryTracking()
  removeModalListeners()
  try { restoreBackground() } finally { if (shouldRestoreFocus) restoreFocus() }
}

onMounted(() => props.modelValue && openDialog())
watch(() => props.modelValue, visible => visible ? openDialog() : closeDialog(), { flush: 'post' })
onBeforeUnmount(closeDialog)
const later = () => emit('later')
</script>

<style scoped>
.onboarding-overlay {
  position: fixed;
  z-index: 260;
  inset: 0;
  background: transparent;
}

.onboarding-overlay:not(.has-target) {
  background: rgba(10, 20, 18, 0.58);
}

.onboarding-spotlight {
  position: fixed;
  z-index: 1;
  border: 2px solid #f6c64a;
  border-radius: 12px;
  background: transparent;
  box-shadow: 0 0 0 100vmax rgba(10, 20, 18, 0.58), 0 0 0 5px rgba(246, 198, 74, 0.2);
  pointer-events: none;
  transition: inset 140ms ease-out, width 140ms ease-out, height 140ms ease-out;
}

.onboarding-arrow {
  position: fixed;
  z-index: 3;
  width: 16px;
  height: 16px;
  box-sizing: border-box;
  background: #fffdf8;
  transform: rotate(45deg);
}

.onboarding-arrow.is-below {
  border-top: 1px solid #e3ded1;
  border-left: 1px solid #e3ded1;
}

.onboarding-arrow.is-above {
  border-right: 1px solid #e3ded1;
  border-bottom: 1px solid #e3ded1;
}

.onboarding-arrow.is-right {
  border-bottom: 1px solid #e3ded1;
  border-left: 1px solid #e3ded1;
}

.onboarding-arrow.is-left {
  border-top: 1px solid #e3ded1;
  border-right: 1px solid #e3ded1;
}

.onboarding-dialog {
  position: fixed;
  z-index: 4;
  box-sizing: border-box;
  overflow: auto;
  padding: 20px;
  border: 1px solid #e3ded1;
  border-radius: 18px;
  color: #173936;
  background: #fffdf8;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.32);
  outline: none;
}
.dialog-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.eyebrow { margin: 0 0 6px; color: #2e6854; font-size: 12px; font-weight: 800; letter-spacing: 0.08em; }
h1 { margin: 0; font-size: clamp(22px, 5vw, 30px); line-height: 1.16; }
.close-button { width: 34px; height: 34px; flex: 0 0 auto; border: 0; border-radius: 50%; color: #285a50; font-size: 26px; line-height: 1; background: #edf3e9; cursor: pointer; }
.intro { margin: 16px 0 10px; color: #49574f; line-height: 1.65; }
.guide-note { margin: 0 0 10px; color: #68716b; font-size: 12px; line-height: 1.5; }
.target-note { margin: 0 0 10px; padding: 9px 11px; border-radius: 10px; color: #70551a; background: #fff5d7; font-size: 13px; line-height: 1.45; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.step-progress, .template-note { margin: 0; color: #637168; font-size: 13px; }
.template-note { margin-top: 8px; color: #2e6854; font-weight: 700; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; margin-top: 20px; }
.dialog-actions button { min-height: 40px; padding: 0 13px; border-radius: 999px; font-size: 14px; font-weight: 800; cursor: pointer; }
.later-button, .skip-button { border: 1px solid #cfdacf; color: #285a50; background: #fffdf8; }
.previous-button { border: 1px solid #9db9aa; color: #285a50; background: #edf3e9; }
.complete-button { border: 1px solid #f6c64a; color: #173936; background: #f6c64a; }
.is-workbench .onboarding-dialog { color: #242e2b; background: #fffefa; border-color: #e3e5dc; border-radius: 12px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
.is-workbench .close-button, .is-workbench .previous-button { color: #242e2b; background: #f3f3ed; }
.is-workbench .later-button, .is-workbench .skip-button { color: #242e2b; background: #fffefa; border-color: #ccd2c5; }
.is-workbench .eyebrow { color: #923f30; }
.is-workbench .intro { color: #68716b; }
.is-workbench h1 { font-size: 22px; line-height: 1.35; }
.is-workbench .complete-button { color: #fffefa; background: #923f30; border-color: #923f30; }
.is-workbench .onboarding-spotlight { border-color: #923f30; }
.dialog-actions button { min-height: 44px; font-family: inherit; }
.dialog-actions button:focus-visible, .close-button:focus-visible { outline: 3px solid #923f3080; outline-offset: 2px; }
@media (max-width: 480px) { .onboarding-dialog { padding: 18px; border-radius: 15px; } .dialog-actions button { flex: 1 1 auto; } }
@media (prefers-reduced-motion: reduce) { .onboarding-spotlight { transition: none; } }
</style>
