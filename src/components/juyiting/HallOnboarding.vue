<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      ref="overlayRef"
      class="onboarding-overlay"
      :class="{ 'has-target': Boolean(targetRect), 'is-virtual-landscape': virtualLandscape }"
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
            <p class="eyebrow">聚义厅 · {{ modeLabel }}引导</p>
            <h1 id="hall-onboarding-title">{{ currentStep.title }}</h1>
          </div>
          <button class="close-button" type="button" aria-label="稍后查看新手引导" @click="later">×</button>
        </div>

        <p id="hall-onboarding-description" class="intro">{{ currentStep.description }}</p>
        <p class="sr-only" aria-live="polite" aria-atomic="true">{{ currentStep.title }}。{{ currentStep.description }}</p>
        <p v-if="!targetRect" class="target-note" role="status">{{ targetNote }}</p>
        <p class="step-progress">第 {{ stepIndex + 1 }} 步，共 {{ steps.length }} 步</p>
        <p v-if="template" class="template-note">访客体验参考：{{ templateLabel }}</p>

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

const TOUR_STEPS = Object.freeze({
  'portrait-command': Object.freeze([
    {
      target: '[data-tour="portrait-preview"]',
      title: '先看厅中只读实景',
      description: '这里用来浏览厅中动态。实景窗口本身不接收点击，请从下方点将册选择协作好汉。'
    },
    {
      target: '[data-tour="portrait-landscape"]',
      title: '横屏看全景',
      description: '需要查看完整地图和厅中场所时，点这里切换横屏全景；横屏界面会使用另一套对应引导。'
    },
    {
      target: '[data-tour="portrait-action-agents"]',
      title: '点将册：挑选协作好汉',
      description: '在点将册查看好汉状态和能力，选定合适的人手。'
    },
    {
      target: '[data-tour="portrait-action-tasks"]',
      title: '悬赏榜：处理待办任务',
      description: '在悬赏榜查看、创建和指派榜文。'
    },
    {
      target: '[data-tour="portrait-action-discussion"]',
      title: '厅前议事：发起协作',
      description: '围绕当前好汉和榜文发起讨论。'
    },
    {
      target: '[data-tour="portrait-action-catalog"]',
      title: '招贤令：补充可用人手',
      description: '需要新的协作对象时，从招贤令查看可用选项。'
    },
    {
      target: '[data-tour="portrait-action-library"]',
      title: '案卷阁：复用已有资料',
      description: '在案卷阁沉淀和检索可复用的协作成果。'
    },
    {
      target: '[data-tour="portrait-action-refresh"]',
      title: '点验刷新：更新厅中状态',
      description: '需要最新的好汉和榜文状态时，使用点验刷新。'
    },
    {
      target: '[data-tour="portrait-todos"]',
      title: '从待办榜文进入任务',
      description: '待办榜文集中显示尚待处理的事；点开一条可查看详情，再决定是否进入悬赏榜或议事。'
    },
    {
      target: '[data-tour="portrait-context"]',
      title: '确认当前协作上下文',
      description: '这里汇总当前好汉和榜文；发起厅前议事前，先确认对象是否正确。'
    }
  ]),
  'landscape-map': Object.freeze([
    {
      target: '[data-tour="landscape-map"]',
      title: '地图是厅中动态的入口',
      description: '拖动地图浏览各处，用加减号缩放、0 键复位；点地图中的场所可直接打开对应功能。'
    },
    {
      hotspotId: 'main-seat',
      title: '忠义堂公议：进入厅前议事',
      description: '点击忠义堂公议，围绕当前上下文发起协作讨论。'
    },
    {
      hotspotId: 'agent-roster',
      title: '点将册：挑选协作好汉',
      description: '点击点将册查看好汉状态、能力与详情。'
    },
    {
      hotspotId: 'bounty-board',
      title: '悬赏榜：处理待办任务',
      description: '点击悬赏榜查看、创建和指派榜文。'
    },
    {
      hotspotId: 'roster-book',
      title: '招贤令：补充可用人手',
      description: '点击招贤令查看可用的协作对象。'
    },
    {
      hotspotId: 'library-shelf',
      title: '案卷阁：复用已有资料',
      description: '点击案卷阁查找和沉淀可复用资料。'
    },
    {
      target: '[data-tour="landscape-refresh"]',
      title: '点验获取最新状态',
      description: '需要刷新厅中人手与榜文时使用点验；引导只介绍位置，不会替你触发刷新。'
    },
    {
      target: '[data-tour="landscape-sound"]',
      title: '控制厅中声响',
      description: '用声响按钮开启或歇下提示音，当前状态会直接显示在按钮上。'
    },
    {
      target: '[data-tour="landscape-onboarding"]',
      title: '随时重看引导',
      description: '以后需要复习地图和工具位置时，可从这里重新打开引导。'
    },
    {
      target: '[data-tour="landscape-orientation"]',
      optional: true,
      title: '手机可切回竖屏视图',
      description: '手机全景模式会显示视图切换按钮；桌面端没有此按钮时可直接继续。'
    }
  ])
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

const templateLabel = computed(() => guestDemoTemplates.find(item => item.id === props.template)?.eyebrow || props.template)
const steps = computed(() => TOUR_STEPS[activeMode.value] || TOUR_STEPS['portrait-command'])
const currentStep = computed(() => steps.value[Math.min(stepIndex.value, steps.value.length - 1)])
const modeLabel = computed(() => activeMode.value === 'landscape-map' ? '横屏全景' : '竖屏掌上')
const targetNote = computed(() => currentStep.value?.optional
  ? '当前设备没有显示这个可选按钮，可继续下一步。'
  : '当前区域仍在加载或暂未显示，可继续、返回上一步或跳过本版本。')
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
const experienceMode = page => page?.classList?.contains('experience-landscape-map') ? 'landscape-map' : 'portrait-command'
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
    const target = page?.querySelector?.(step?.target)
    updateObservedTarget(target || null)
    rect = rectFromEdges(target?.getBoundingClientRect?.())
    const canFitInViewport = rect && rect.height <= viewportSize.value.height - 24
    const needsScroll = rect && (rect.bottom < 8 || rect.top > viewportSize.value.height - 8 ||
      (canFitInViewport && (rect.top < 8 || rect.bottom > viewportSize.value.height - 8)))
    if (needsScroll) {
      if (scrolledTargetKey !== key) {
        scrolledTargetKey = key
        target.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'auto' })
      }
      rect = null
      scheduleGeometry()
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
.target-note { margin: 0 0 10px; padding: 9px 11px; border-radius: 10px; color: #70551a; background: #fff5d7; font-size: 13px; line-height: 1.45; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.step-progress, .template-note { margin: 0; color: #637168; font-size: 13px; }
.template-note { margin-top: 8px; color: #2e6854; font-weight: 700; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; margin-top: 20px; }
.dialog-actions button { min-height: 40px; padding: 0 13px; border-radius: 999px; font-size: 14px; font-weight: 800; cursor: pointer; }
.later-button, .skip-button { border: 1px solid #cfdacf; color: #285a50; background: #fffdf8; }
.previous-button { border: 1px solid #9db9aa; color: #285a50; background: #edf3e9; }
.complete-button { border: 1px solid #f6c64a; color: #173936; background: #f6c64a; }
@media (max-width: 480px) { .onboarding-dialog { padding: 18px; border-radius: 15px; } .dialog-actions button { flex: 1 1 auto; } }
@media (prefers-reduced-motion: reduce) { .onboarding-spotlight { transition: none; } }
</style>
