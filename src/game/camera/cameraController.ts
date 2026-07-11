import {
  clampTransform,
  preserveFocus,
  screenToWorld,
  transformForFocus,
  zoomAt as zoomTransformAt,
  type CameraBounds,
  type CameraTransform,
  type Point,
  type Viewport
} from './cameraTransform.js'
import {
  MAIN_HALL_PRESETS,
  VIEW_PRESETS,
  selectViewPreset,
  type ViewPresetKey
} from './viewPresets.js'

export type CameraAdapter = {
  viewport(): Viewport
  sceneSize(): Viewport
  apply(transform: CameraTransform): void
  requestFrame(callback: (now: number) => void): number
  cancelFrame(id: number): void
  now(): number
}

export type CameraSnapshot = {
  transform: CameraTransform
  presetKey: ViewPresetKey
  presetId: typeof VIEW_PRESETS[ViewPresetKey]['id']
  animation: null | { startedAt: number; durationMs: number }
}

export type CameraController = {
  panBy(dx: number, dy: number): CameraTransform
  zoomAt(point: Point, factor: number): CameraTransform
  resize(nextViewport: Viewport, kind: 'keyboard' | 'orientation' | 'layout'): CameraTransform
  resetTo(presetKey: ViewPresetKey, durationMs?: number): void
  beginUserGesture(): void
  isAwayFromPreset(): boolean
  snapshot(): CameraSnapshot
  cleanup(): void
}

const DEFAULT_RESET_DURATION_MS = 200
const MIN_RESET_DURATION_MS = 150
const MAX_RESET_DURATION_MS = 250
const MAX_ZOOM = 3.3
const WORLD_FOCUS_TOLERANCE = 48
const ZOOM_TOLERANCE = 0.08
const COMPARISON_EPSILON = 1e-9

const finiteOr = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback

const positiveOr = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? value : fallback

const copyViewport = (viewport: Viewport): Viewport => ({
  width: positiveOr(viewport.width, 0),
  height: positiveOr(viewport.height, 0)
})

const normalizeDuration = (durationMs: number): number =>
  Number.isFinite(durationMs) && durationMs >= MIN_RESET_DURATION_MS && durationMs <= MAX_RESET_DURATION_MS
    ? durationMs
    : DEFAULT_RESET_DURATION_MS

export const createCameraController = (
  adapter: CameraAdapter,
  configuredBounds: CameraBounds,
  coarsePointer = false
): CameraController => {
  let viewport = copyViewport(adapter.viewport())
  let presetKey = selectViewPreset(viewport, coarsePointer)
  let transform: CameraTransform = { zoom: 1, offsetX: 0, offsetY: 0 }
  let animation: CameraSnapshot['animation'] = null
  let frameId: number | null = null
  let disposed = false
  let animationGeneration = 0

  const bounds = (key = presetKey): CameraBounds => {
    const maxZoom = Math.min(positiveOr(configuredBounds.maxZoom, MAX_ZOOM), MAX_ZOOM)
    const configuredMinimum = positiveOr(configuredBounds.minZoom, 0)
    return {
      minZoom: Math.min(maxZoom, Math.max(configuredMinimum, VIEW_PRESETS[key].zoom)),
      maxZoom,
      roundingTolerance: configuredBounds.roundingTolerance
    }
  }

  const apply = (candidate: CameraTransform): CameraTransform => {
    transform = clampTransform(candidate, viewport, adapter.sceneSize(), bounds())
    adapter.apply({ ...transform })
    return { ...transform }
  }

  const presetTransform = (key: ViewPresetKey): CameraTransform => {
    const preset = MAIN_HALL_PRESETS[key]
    return clampTransform(
      transformForFocus(
        preset.focus,
        { x: viewport.width / 2, y: viewport.height / 2 },
        preset.zoom,
        viewport
      ),
      viewport,
      adapter.sceneSize(),
      bounds(key)
    )
  }

  const cancelAnimation = (): void => {
    animationGeneration += 1
    if (frameId !== null) adapter.cancelFrame(frameId)
    frameId = null
    animation = null
  }

  const scheduleFrame = (callback: (now: number) => void): void => {
    frameId = adapter.requestFrame(callback)
  }

  const initial = presetTransform(presetKey)
  apply(initial)

  const controller: CameraController = {
    panBy(dx, dy) {
      if (disposed) return { ...transform }
      cancelAnimation()
      return apply({
        zoom: transform.zoom,
        offsetX: transform.offsetX + finiteOr(dx, 0),
        offsetY: transform.offsetY + finiteOr(dy, 0)
      })
    },

    zoomAt(point, factor) {
      if (disposed || !Number.isFinite(factor) || factor <= 0) return { ...transform }
      cancelAnimation()
      const targetZoom = transform.zoom * factor
      return apply(zoomTransformAt(transform, point, targetZoom, viewport, bounds()))
    },

    resize(nextViewport, kind) {
      if (disposed) return { ...transform }
      if (kind === 'keyboard') return { ...transform }
      cancelAnimation()
      const oldViewport = viewport
      viewport = copyViewport(nextViewport)
      const preserved = preserveFocus(transform, oldViewport, viewport)
      presetKey = selectViewPreset(viewport, coarsePointer)
      return apply(preserved)
    },

    resetTo(nextPresetKey, durationMs = DEFAULT_RESET_DURATION_MS) {
      if (disposed) return
      cancelAnimation()
      presetKey = nextPresetKey
      const start = { ...transform }
      const target = presetTransform(presetKey)
      const duration = normalizeDuration(durationMs)
      const rawStartedAt = adapter.now()
      const startedAt = finiteOr(rawStartedAt, 0)
      animation = { startedAt, durationMs: duration }
      const generation = animationGeneration

      const step = (frameNow: number): void => {
        if (generation !== animationGeneration || animation === null || disposed) return
        frameId = null
        const elapsed = Math.max(0, finiteOr(frameNow, startedAt) - startedAt)
        const progress = Math.min(1, elapsed / duration)
        const eased = 1 - (1 - progress) ** 2
        apply({
          zoom: start.zoom + (target.zoom - start.zoom) * eased,
          offsetX: start.offsetX + (target.offsetX - start.offsetX) * eased,
          offsetY: start.offsetY + (target.offsetY - start.offsetY) * eased
        })
        if (generation !== animationGeneration || animation === null || disposed) return
        if (progress >= 1) {
          frameId = null
          animation = null
          return
        }
        scheduleFrame(step)
      }

      scheduleFrame(step)
    },

    beginUserGesture() {
      if (disposed) return
      cancelAnimation()
    },

    isAwayFromPreset() {
      const target = presetTransform(presetKey)
      const center = { x: viewport.width / 2, y: viewport.height / 2 }
      const centerWorld = screenToWorld(
        center,
        transform,
        viewport
      )
      const targetCenterWorld = screenToWorld(center, target, viewport)
      const focusDistance = Math.hypot(
        centerWorld.x - targetCenterWorld.x,
        centerWorld.y - targetCenterWorld.y
      )
      return focusDistance > WORLD_FOCUS_TOLERANCE + COMPARISON_EPSILON ||
        Math.abs(transform.zoom - target.zoom) > ZOOM_TOLERANCE + COMPARISON_EPSILON
    },

    snapshot() {
      return {
        transform: { ...transform },
        presetKey,
        presetId: VIEW_PRESETS[presetKey].id,
        animation: animation === null ? null : { ...animation }
      }
    },

    cleanup() {
      disposed = true
      cancelAnimation()
    }
  }

  return controller
}
