<template>
  <section class="hall-stage">
    <div class="stage-header">
      <div class="stage-heading">
        <div class="eyebrow">梁山泊传令中枢</div>
        <h1>聚义厅</h1>
      </div>
      <div class="stage-tools">
        <button
          class="tool-action refresh-action"
          :class="{ 'is-refreshing': refreshing }"
          :disabled="refreshing"
          title="点验厅中动静"
          @click="$emit('refresh-hall')"
        >
          <var-icon name="refresh" />
          <span class="tool-label">{{ refreshing ? '点验中' : '点验' }}</span>
        </button>
        <button
          class="tool-action sound-toggle"
          :title="soundEnabled ? '歇下声响' : '开起声响'"
          @click="$emit('toggle-sound')"
        >
          <var-icon :name="soundEnabled ? 'bell' : 'bell-outline'" />
          <span class="tool-label">{{ soundEnabled ? '声响开' : '声响歇' }}</span>
        </button>
        <button
          class="tool-action orientation-action"
          :disabled="isSceneMounting || orientationRequestPending"
          :title="sceneMode === 'landscape' ? '切回竖屏视图' : '切到横屏视图'"
          @click="toggleOrientationMode"
        >
          <span
            class="orientation-glyph"
            :class="{
              'is-glyph-portrait': sceneMode === 'landscape',
              'is-glyph-landscape': sceneMode !== 'landscape'
            }"
            aria-hidden="true"
          ></span>
          <span class="tool-label">{{ sceneMode === 'landscape' ? '竖屏视图' : '横屏全景' }}</span>
        </button>
      </div>
    </div>

    <div
      class="hall-board"
      :class="{
        'is-melon-ready': melonReady,
        'has-scene-error': Boolean(sceneError),
        'is-device-landscape': deviceLandscape,
        'is-app-landscape': orientationMode === 'landscape',
        'is-scene-landscape': sceneMode === 'landscape',
        'is-scene-portrait': sceneMode === 'portrait'
      }"
      tabindex="0"
      aria-label="聚义厅 melonJS 场景，可使用加减号缩放，0 复位"
      @keydown="handleSceneKeydown"
      @wheel="scheduleReturnRefresh"
      @pointerup="scheduleReturnRefresh"
      @pointercancel="scheduleReturnRefresh"
    >
      <div ref="melonContainerRef" class="melon-layer" aria-hidden="true"></div>
      <div
        v-if="isSceneMounting && !sceneError"
        class="scene-loading"
        role="status"
      >
        <span class="scene-spinner" aria-hidden="true"></span>
        <span>聚义厅地图加载中…</span>
      </div>
      <div v-if="sceneError" class="scene-error" role="status">
        <strong>聚义厅场景暂不可用</strong>
        <span>{{ sceneError }}</span>
        <button type="button" :disabled="isSceneMounting" @click="retryScene">
          {{ isSceneMounting ? '重试中' : '重试' }}
        </button>
      </div>
      <button
        v-if="showReturnButton && !interactionLocked"
        class="return-main-hall"
        :class="{ 'is-raised': Boolean(selectedAgent) }"
        type="button"
        aria-label="回主厅"
        title="回主厅"
        @click="returnToMainHall"
      >
        <span aria-hidden="true">⌂</span>
      </button>
      <div v-if="orientationHint" class="orientation-hint" role="status">{{ orientationHint }}</div>
    </div>

    <slot></slot>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { juyitingGame } from '@/game/index.js'
import { classifyViewportResize } from '@/game/camera/resizePolicy.js'

const props = defineProps({
  agentBubbles: { type: Object, default: () => ({}) },
  agentKey: { type: Function, required: true },
  agentStyle: { type: Function, required: true },
  hiddenAgentCount: { type: Number, default: 0 },
  interactionLocked: { type: Boolean, default: false },
  portraitName: { type: Function, required: true },
  portraitShortName: { type: Function, required: true },
  portraitStyle: { type: Function, required: true },
  refreshing: { type: Boolean, default: false },
  roleClass: { type: Function, required: true },
  simulationEnabled: { type: Boolean, default: true },
  sceneAgents: { type: Array, default: () => [] },
  sceneHotspots: { type: Array, default: () => [] },
  selectedAgent: { type: Object, default: null },
  soundEnabled: { type: Boolean, default: true },
  statusClass: { type: Function, required: true },
  statusText: { type: Function, required: true },
  tasksTotal: { type: Number, default: 0 },
  visibleAgents: { type: Array, default: () => [] }
})

const emit = defineEmits([
  'new-conversation',
  'open-panel',
  'refresh-hall',
  'select-agent',
  'simulation-phase-events',
  'simulation-ready',
  'simulation-reset',
  'toggle-sound'
])

const melonContainerRef = ref(null)
const melonReady = ref(false)
const sceneError = ref('')
const isSceneMounting = ref(false)
const showReturnButton = ref(false)
const orientationHint = ref('')
const orientationRequestPending = ref(false)
const deviceLandscape = ref(false)
const orientationMode = ref('auto')
let sceneMountAttempt = 0
let isUnmounted = false
let orientationMedia = null
let orientationMediaHandler = null
let mountTimeout = null
let previousLayoutViewport = { width: 0, height: 0 }
let previousVisualHeight = 0
let keyboardActive = false
let resizeFrame = null
let resizeSettlePass = 0
let pendingOrientationSignal = false
let lastResizeSignature = ''
let lastOrientationDimensions = ''
let stageResizeObserver = null
let returnFrame = null
let resetPollRemaining = 0
let orientationRequestGeneration = 0
let currentGameDestroyed = false
let ownsFullscreen = false
let ownsOrientationLock = false
let fallbackFrameId = 0
const fallbackFrames = new Map()

const requestStageFrame = callback => {
  if (typeof window.requestAnimationFrame === 'function') return window.requestAnimationFrame(callback)
  const id = `fallback-${++fallbackFrameId}`
  fallbackFrames.set(id, callback)
  Promise.resolve().then(() => {
    const pending = fallbackFrames.get(id)
    if (!pending) return
    fallbackFrames.delete(id)
    pending(Date.now())
  })
  return id
}

const cancelStageFrame = id => {
  if (typeof id === 'string') fallbackFrames.delete(id)
  else window.cancelAnimationFrame?.(id)
}
const loadingUnlockedAttempts = new Set()

const presetZooms = { mobilePortrait: 1.25, mobileLandscape: 1.05, tabletLandscape: 0.92, desktop: 0.84 }

const sceneMode = computed(() => {
  if (orientationMode.value === 'landscape' || orientationMode.value === 'portrait') {
    return orientationMode.value
  }
  return deviceLandscape.value ? 'landscape' : 'portrait'
})

const sceneDebugRequested = () => (
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('scene-debug') === '1'
)

const isCurrentMountAttempt = (attemptId) => (
  !isUnmounted && attemptId === sceneMountAttempt
)

const handleAgentClick = (agentData) => {
  const full = (props.sceneAgents || []).find(a =>
    a.agentId === agentData.agentId || a.personaCode === agentData.personaCode
  ) || agentData
  emit('select-agent', full)
}

const handleHotspotClick = (hotspot) => {
  emit('open-panel', hotspot.panel)
}

const unlockLoading = (attemptId) => {
  if (loadingUnlockedAttempts.has(attemptId)) return
  loadingUnlockedAttempts.add(attemptId)
  juyitingGame.setInteractionLocked?.(false, 'loading')
}

const handleSceneReady = (attemptId) => {
  clearMountTimeout()
  sceneError.value = ''
  melonReady.value = true
  isSceneMounting.value = false
  unlockLoading(attemptId)
  juyitingGame.syncAgents(props.sceneAgents)
  juyitingGame.syncHotspots?.(props.sceneHotspots)
  juyitingGame.setSelectedAgent(props.selectedAgent?.agentId || null)
  lastResizeSignature = ''
  scheduleViewportResize()
  scheduleReturnRefresh()
}

const clearMountTimeout = () => {
  if (mountTimeout !== null) window.clearTimeout(mountTimeout)
  mountTimeout = null
}

const editableFocused = () => {
  const element = document.activeElement
  return Boolean(element && (element.matches?.('input, textarea, select, [contenteditable="true"]') || element.isContentEditable))
}

const viewportNow = () => ({ width: window.innerWidth, height: window.innerHeight })

const stageViewportNow = () => {
  const rect = melonContainerRef.value?.getBoundingClientRect?.()
  if (rect?.width > 0 && rect?.height > 0) {
    return { width: Math.round(rect.width), height: Math.round(rect.height) }
  }
  return viewportNow()
}

const evaluateViewportResize = () => {
  resizeFrame = null
  const nextLayoutViewport = viewportNow()
  const nextStageViewport = stageViewportNow()
  const nextVisualHeight = window.visualViewport?.height || nextLayoutViewport.height
  const widthStable = Math.abs(nextLayoutViewport.width - previousLayoutViewport.width) <= 2
  const layoutHeightChanged = Math.abs(nextLayoutViewport.height - previousLayoutViewport.height) >= 120
  const visualHeightSettled = Math.abs(nextVisualHeight - previousVisualHeight) >= 120
  const layoutKeyboardRace = widthStable && layoutHeightChanged && !visualHeightSettled && (editableFocused() || keyboardActive)
  if (
    resizeSettlePass < 2 &&
    layoutKeyboardRace
  ) {
    resizeSettlePass += 1
    resizeFrame = requestStageFrame(evaluateViewportResize)
    return
  }
  resizeSettlePass = 0
  const classifiedKind = classifyViewportResize({
    previous: previousLayoutViewport,
    next: nextLayoutViewport,
    previousVisualHeight,
    nextVisualHeight,
    editableFocused: editableFocused() || keyboardActive,
    orientationChanged: pendingOrientationSignal
  })
  const keyboardTransition = keyboardActive && widthStable && visualHeightSettled
  const kind = pendingOrientationSignal
    ? 'orientation'
    : ((keyboardTransition || layoutKeyboardRace) ? 'keyboard' : classifiedKind)
  const resizeHeight = kind === 'keyboard'
    ? Math.min(nextStageViewport.height, nextVisualHeight)
    : nextStageViewport.height
  document.documentElement.style.setProperty('--hall-visual-height', `${nextVisualHeight}px`)
  const change = {
    width: nextStageViewport.width,
    height: resizeHeight,
    kind,
    orientationChanged: pendingOrientationSignal
  }
  const signature = `${change.width}:${change.height}:${change.kind}:${change.orientationChanged}`
  const dimensions = `${change.width}:${change.height}`
  const duplicateOrientationLayout = kind === 'layout' && dimensions === lastOrientationDimensions
  if (signature !== lastResizeSignature && !duplicateOrientationLayout) {
    lastResizeSignature = signature
    juyitingGame.resizeViewport?.(change)
  }
  if (kind === 'orientation') lastOrientationDimensions = dimensions
  else if (dimensions !== lastOrientationDimensions) lastOrientationDimensions = ''
  if (kind !== 'keyboard') {
    previousLayoutViewport = nextLayoutViewport
    keyboardActive = false
  } else {
    keyboardActive = Math.abs(previousLayoutViewport.height - nextVisualHeight) >= 120
  }
  previousVisualHeight = nextVisualHeight
  pendingOrientationSignal = false
  scheduleReturnRefresh()
}

const scheduleViewportResize = ({ orientationChanged = false } = {}) => {
  pendingOrientationSignal = pendingOrientationSignal || orientationChanged
  if (resizeFrame !== null) return
  resizeFrame = requestStageFrame(evaluateViewportResize)
}

const updateDeviceOrientation = (event) => {
  const mediaMatches = typeof event?.matches === 'boolean' ? event.matches : orientationMedia?.matches
  deviceLandscape.value = typeof mediaMatches === 'boolean' ? mediaMatches : window.innerWidth > window.innerHeight
  scheduleViewportResize({ orientationChanged: Boolean(event) })
}

const setupOrientationTracking = () => {
  if (typeof window === 'undefined') return
  orientationMedia = window.matchMedia?.('(orientation: landscape)') || null
  previousLayoutViewport = viewportNow()
  previousVisualHeight = window.visualViewport?.height || previousLayoutViewport.height
  orientationMediaHandler = event => updateDeviceOrientation(event)
  orientationMedia?.addEventListener?.('change', orientationMediaHandler)
  window.addEventListener?.('resize', handleWindowResize)
  window.visualViewport?.addEventListener?.('resize', handleVisualResize)
  updateDeviceOrientation()
}

const handleWindowResize = () => scheduleViewportResize()
const handleVisualResize = () => scheduleViewportResize()

const setupStageResizeObserver = () => {
  const ResizeObserverImpl = window.ResizeObserver || globalThis.ResizeObserver
  if (!ResizeObserverImpl || !melonContainerRef.value) return
  stageResizeObserver = new ResizeObserverImpl(() => scheduleViewportResize())
  stageResizeObserver.observe(melonContainerRef.value)
}

const teardownStageResizeObserver = () => {
  stageResizeObserver?.disconnect?.()
  stageResizeObserver = null
}

const teardownOrientationTracking = () => {
  orientationMedia?.removeEventListener?.('change', orientationMediaHandler)
  window.removeEventListener?.('resize', handleWindowResize)
  window.visualViewport?.removeEventListener?.('resize', handleVisualResize)
  orientationMedia = null
  orientationMediaHandler = null
  if (resizeFrame !== null) cancelStageFrame(resizeFrame)
  resizeFrame = null
}

const isCurrentOrientationRequest = token => (
  !isUnmounted && token === orientationRequestGeneration && orientationMode.value === 'landscape'
)

const releaseAcquiredOrientation = async ({ fullscreen = false, orientation = false } = {}) => {
  if (orientation) {
    try {
      screen.orientation?.unlock?.()
    } catch { /* best-effort orientation cleanup */ }
  }
  if (fullscreen) {
    try {
      await document.exitFullscreen?.()
    } catch { /* best-effort fullscreen cleanup */ }
  }
}

const releaseOwnedOrientation = async () => {
  const acquired = { fullscreen: ownsFullscreen, orientation: ownsOrientationLock }
  ownsFullscreen = false
  ownsOrientationLock = false
  await releaseAcquiredOrientation(acquired)
}

const requestLandscapeLock = async (token) => {
  let failed = false
  let acquiredFullscreen = false
  let acquiredOrientation = false
  const requestFullscreen = document.documentElement.requestFullscreen
  const lockOrientation = screen.orientation?.lock
  const hostFullscreen = Boolean(document.fullscreenElement)
  if (!hostFullscreen && typeof requestFullscreen !== 'function') failed = true
  else if (!hostFullscreen) {
    try {
      await requestFullscreen.call(document.documentElement)
      acquiredFullscreen = true
      ownsFullscreen = true
    } catch { failed = true }
  }
  if (!isCurrentOrientationRequest(token)) {
    await releaseAcquiredOrientation({ fullscreen: acquiredFullscreen })
    if (acquiredFullscreen) ownsFullscreen = false
    return
  }
  if (typeof lockOrientation !== 'function') failed = true
  else {
    try {
      await lockOrientation.call(screen.orientation, 'landscape')
      acquiredOrientation = true
      ownsOrientationLock = true
    } catch { failed = true }
  }
  if (!isCurrentOrientationRequest(token)) {
    await releaseAcquiredOrientation({ fullscreen: acquiredFullscreen, orientation: acquiredOrientation })
    if (acquiredFullscreen) ownsFullscreen = false
    if (acquiredOrientation) ownsOrientationLock = false
    return
  }
  if (isCurrentOrientationRequest(token)) orientationHint.value = failed ? '请旋转手机横屏查看' : ''
}

const toggleOrientationMode = async () => {
  if (isSceneMounting.value || orientationRequestPending.value) return
  const nextMode = sceneMode.value === 'landscape' ? 'portrait' : 'landscape'
  const requestToken = ++orientationRequestGeneration
  orientationRequestPending.value = true
  orientationMode.value = nextMode
  try {
    if (nextMode === 'landscape') await requestLandscapeLock(requestToken)
    if (nextMode === 'portrait') {
      orientationHint.value = ''
      await releaseOwnedOrientation()
    }
  } finally {
    if (!isUnmounted && requestToken === orientationRequestGeneration) orientationRequestPending.value = false
  }
}

const mountScene = async () => {
  if (isUnmounted || isSceneMounting.value) return
  const container = melonContainerRef.value
  if (!container) return

  const attemptId = ++sceneMountAttempt
  isSceneMounting.value = true
  sceneError.value = ''
  juyitingGame.setInteractionLocked?.(true, 'loading')
  clearMountTimeout()
  mountTimeout = window.setTimeout(() => {
    if (!isCurrentMountAttempt(attemptId)) return
    sceneMountAttempt += 1
    isSceneMounting.value = false
    melonReady.value = false
    sceneError.value = '地图加载超时，请重试'
    unlockLoading(attemptId)
    emit('simulation-reset')
    currentGameDestroyed = true
    juyitingGame.destroy()
  }, 15000)
  try {
    await juyitingGame.mount(container, {
      simulationEnabled: props.simulationEnabled,
      onAgentClick: (agentData) => {
        if (isCurrentMountAttempt(attemptId)) handleAgentClick(agentData)
      },
      onHotspotClick: (hotspot) => {
        if (isCurrentMountAttempt(attemptId)) handleHotspotClick(hotspot)
      },
      onReady: () => {
        if (isCurrentMountAttempt(attemptId)) handleSceneReady(attemptId)
      },
      onSimulationPhaseEvents: events => {
        if (isCurrentMountAttempt(attemptId)) emit('simulation-phase-events', events)
      }
    })
    if (!isCurrentMountAttempt(attemptId)) return
    emit('simulation-ready', {
      movementRuntime: juyitingGame.getMovementRuntime?.(),
      simulation: {
        enqueue: command => juyitingGame.enqueueMovementCommands?.([command])?.[0],
        cancel: (agentId, stateVersion) => juyitingGame.cancelMovement?.(agentId, stateVersion)
      }
    })
    if (!melonReady.value) juyitingGame.setInteractionLocked?.(true, 'loading')
    juyitingGame.start()
  } catch (err) {
    if (isCurrentMountAttempt(attemptId)) {
      clearMountTimeout()
      melonReady.value = false
      sceneError.value = err?.message || '请稍后重试'
      console.warn('[HallStage] melonJS:', err?.message || err)
      isSceneMounting.value = false
      unlockLoading(attemptId)
    }
  }
}

const retryScene = async () => {
  if (isSceneMounting.value) return
  emit('simulation-reset')
  sceneMountAttempt += 1
  clearMountTimeout()
  melonReady.value = false
  if (!currentGameDestroyed) juyitingGame.destroy()
  currentGameDestroyed = false
  await mountScene()
}

const handleSceneKeydown = (event) => {
  if (event.defaultPrevented || isSceneMounting.value) return
  if (event.key === '+' || event.key === '=') {
    juyitingGame.zoomBy?.(0.12)
    event.preventDefault()
    scheduleReturnRefresh()
    return
  }
  if (event.key === '-' || event.key === '_') {
    juyitingGame.zoomBy?.(-0.12)
    event.preventDefault()
    scheduleReturnRefresh()
    return
  }
  if (event.key === '0') {
    returnToMainHall()
    event.preventDefault()
  }
}

const worldCenterFromSnapshot = (viewport, transform) => {
  const screenX = viewport.width / 2
  const screenY = viewport.height / 2
  return {
    x: ((screenX - viewport.width / 2 - transform.offsetX) / transform.zoom) + viewport.width / 2,
    y: ((screenY - viewport.height / 2 - transform.offsetY) / transform.zoom) + viewport.height / 2
  }
}

const refreshReturnButton = () => {
  if (isUnmounted) return null
  const snapshot = juyitingGame.getCameraSnapshot?.()
  if (!snapshot?.transform) {
    showReturnButton.value = false
    return null
  }
  const viewport = previousLayoutViewport.width ? previousLayoutViewport : viewportNow()
  const { zoom } = snapshot.transform
  const centerWorld = worldCenterFromSnapshot(viewport, snapshot.transform)
  const focusDistance = Math.hypot(centerWorld.x - 832, centerWorld.y - 390)
  showReturnButton.value = focusDistance > 48 || Math.abs(zoom - (presetZooms[snapshot.presetKey] ?? zoom)) > 0.08
  return snapshot
}

const runReturnRefresh = () => {
  returnFrame = null
  const snapshot = refreshReturnButton()
  if (resetPollRemaining > 0 && snapshot?.animation) {
    resetPollRemaining -= 1
    returnFrame = requestStageFrame(runReturnRefresh)
  } else {
    resetPollRemaining = 0
  }
}

const scheduleReturnRefresh = () => {
  if (isUnmounted || returnFrame !== null) return
  returnFrame = requestStageFrame(runReturnRefresh)
}

const returnToMainHall = () => {
  juyitingGame.resetToMainHall?.()
  resetPollRemaining = 30
  scheduleReturnRefresh()
}

onMounted(() => {
  if (sceneDebugRequested()) window.__JYTING_GAME__ = juyitingGame
  setupOrientationTracking()
  setupStageResizeObserver()
  mountScene()
})

onBeforeUnmount(() => {
  isUnmounted = true
  sceneMountAttempt += 1
  orientationRequestGeneration += 1
  orientationRequestPending.value = false
  teardownStageResizeObserver()
  if (window.__JYTING_GAME__ === juyitingGame) delete window.__JYTING_GAME__
  void releaseOwnedOrientation()
  clearMountTimeout()
  teardownOrientationTracking()
  if (returnFrame !== null) cancelStageFrame(returnFrame)
  returnFrame = null
  resetPollRemaining = 0
  fallbackFrames.clear()
  juyitingGame.setInteractionLocked?.(false, 'panel')
  juyitingGame.setInteractionLocked?.(false, 'loading')
  emit('simulation-reset')
  if (!currentGameDestroyed) juyitingGame.destroy()
  currentGameDestroyed = true
})

watch(() => props.interactionLocked, value => {
  juyitingGame.setInteractionLocked?.(Boolean(value), 'panel')
  if (value) showReturnButton.value = false
  else scheduleReturnRefresh()
}, { immediate: true })

watch(() => props.sceneAgents, (agents) => {
  if (melonReady.value) juyitingGame.syncAgents(agents || [])
}, { deep: true })

watch(() => props.sceneHotspots, (hotspots) => {
  if (melonReady.value) juyitingGame.syncHotspots?.(hotspots || [])
}, { deep: true })

watch(() => props.selectedAgent, (agent) => {
  if (melonReady.value) juyitingGame.setSelectedAgent(agent?.agentId || null)
  scheduleReturnRefresh()
})
</script>

<style scoped>
.hall-stage {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  background: #211812;
}

.stage-header {
  position: absolute;
  top: 10px;
  left: 18px;
  right: auto;
  z-index: 12;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  width: fit-content;
  max-width: min(420px, calc(100% - 36px));
  padding: 7px 8px;
  border: 1px solid rgba(255, 240, 202, 0.12);
  border-radius: 8px;
  background: rgba(35, 24, 16, 0.38);
  color: #fff4d4;
  backdrop-filter: blur(8px);
}

.stage-heading {
  min-width: 0;
}

.eyebrow {
  display: none;
  font-size: 12px;
  color: #d7b875;
}

h1 {
  margin: 0;
  font-size: 20px;
  line-height: 1.1;
  letter-spacing: 0;
}

.stage-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  margin-top: 1px;
}

button {
  border: 0;
  cursor: pointer;
  font: inherit;
}

.tool-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 10px;
  border-radius: 8px;
  background: rgba(255, 244, 212, 0.16);
  color: #fff4d4;
  white-space: nowrap;
}

.sound-toggle {
  background: rgba(215, 184, 117, 0.24);
  color: #fff8de;
}

.orientation-action {
  background: rgba(104, 161, 139, 0.3);
  color: #effff6;
}

.orientation-glyph {
  position: relative;
  display: inline-block;
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
}

.orientation-glyph::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 13px;
  height: 18px;
  border: 2px solid currentColor;
  border-radius: 4px;
  transform: translate(-50%, -50%);
}

.orientation-glyph::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 2px;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: currentColor;
  transform: translateX(-50%);
}

.orientation-glyph.is-glyph-landscape::before {
  width: 18px;
  height: 13px;
}

.orientation-glyph.is-glyph-landscape::after {
  left: auto;
  right: 2px;
  bottom: 50%;
  transform: translateY(50%);
}

.refresh-action {
  background: rgba(255, 244, 212, 0.2);
}

.tool-action:disabled {
  cursor: default;
  opacity: 0.72;
}

.refresh-action.is-refreshing :deep(.var-icon) {
  animation: refreshSpin 0.8s linear infinite;
}

.tool-action :deep(.var-icon) {
  font-size: 18px;
}

.tool-action span {
  font-size: 13px;
  font-weight: 600;
}

.hall-stage:has(.hall-board.is-scene-landscape) .stage-header {
  top: 4px;
  left: 8px;
  max-width: calc(100% - 16px);
  gap: 6px;
  padding: 6px 7px;
  background: rgba(35, 24, 16, 0.32);
}

.hall-stage:has(.hall-board.is-scene-landscape) .stage-heading .eyebrow {
  display: none;
}

.hall-stage:has(.hall-board.is-scene-landscape) h1 {
  font-size: 16px;
  min-height: 0;
}

.hall-stage:has(.hall-board.is-scene-landscape) .stage-tools {
  gap: 5px;
}

.hall-stage:has(.hall-board.is-scene-landscape) .tool-action {
  min-height: 30px;
  padding: 0 7px;
}

.hall-stage:has(.hall-board.is-scene-landscape) .tool-action .tool-label {
  display: none;
}

.hall-stage:has(.hall-board.is-scene-landscape) .tool-action :deep(.var-icon) {
  font-size: 16px;
}

.hall-board {
  position: relative;
  flex: 1 1 auto;
  width: 100% !important;
  min-height: 0;
  margin: 0;
  overflow: hidden;
  border-radius: 0;
  touch-action: none;
  background:
    radial-gradient(circle at 50% 48%, rgba(239, 197, 118, 0.2), transparent 34%),
    linear-gradient(135deg, #14100c, #23170f 54%, #0d0b09);
}

.hall-board::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 4;
  pointer-events: none;
  box-shadow: inset 0 0 90px rgba(0, 0, 0, 0.58);
}

.melon-layer {
  position: absolute;
  inset: 0;
  z-index: 6;
  width: 100% !important;
  height: 100% !important;
  touch-action: none;
}

.melon-layer :deep(canvas) {
  display: block;
}

.scene-error {
  position: absolute;
  left: 50%;
  top: 52%;
  z-index: 8;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: min(320px, calc(100% - 32px));
  padding: 18px;
  border: 1px solid rgba(255, 215, 145, 0.32);
  border-radius: 8px;
  background: rgba(31, 22, 16, 0.88);
  color: #fff4d4;
  text-align: center;
  transform: translate(-50%, -50%);
  backdrop-filter: blur(8px);
}

.scene-loading {
  position: absolute;
  inset: 0;
  z-index: 8;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: rgba(20, 14, 10, 0.54);
  color: #fff4d4;
}

.scene-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255, 244, 212, 0.3);
  border-top-color: #fff4d4;
  border-radius: 50%;
  animation: refreshSpin 0.8s linear infinite;
}

.return-main-hall {
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 9;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: rgba(255, 244, 212, 0.94);
  color: #3b2516;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}

.return-main-hall.is-raised {
  bottom: 132px;
}

.orientation-hint {
  position: absolute;
  left: 50%;
  bottom: 18px;
  z-index: 10;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(31, 22, 16, 0.88);
  color: #fff4d4;
  transform: translateX(-50%);
}

.scene-error strong {
  font-size: 16px;
  line-height: 1.35;
}

.scene-error span {
  font-size: 13px;
  line-height: 1.5;
  color: #d7b875;
}

.scene-error button {
  min-height: 34px;
  padding: 0 16px;
  border-radius: 8px;
  background: #d7b875;
  color: #24170f;
  font-size: 14px;
  font-weight: 700;
}

@keyframes refreshSpin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 640px) {
  .stage-header {
    top: 4px;
    left: 8px;
    right: auto;
    width: fit-content;
    max-width: calc(100% - 16px);
    align-items: center;
    gap: 8px;
    padding: 6px 7px;
    border-color: rgba(255, 240, 202, 0.1);
    background: rgba(35, 24, 16, 0.32);
  }

  .stage-heading .eyebrow {
    display: none;
  }

  h1 {
    font-size: 16px;
    min-height: 0;
  }

  .stage-tools {
    gap: 6px;
  }

  .tool-action {
    min-height: 30px;
    padding: 0 7px;
  }

  .tool-action .tool-label {
    display: none;
  }

  .tool-action :deep(.var-icon) {
    font-size: 17px;
  }
}

@media (max-width: 420px) {
  .stage-header {
    top: 2px;
  }

  .stage-tools {
    align-self: flex-end;
  }

  .eyebrow {
    font-size: 11px;
  }

  h1 {
    font-size: 16px;
    min-height: 0;
  }
}
</style>
