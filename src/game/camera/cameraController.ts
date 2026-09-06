import {
  clampTransform,
  preserveFocus,
  screenToWorld,
  transformForFocus,
  zoomAt as zoomTransformAt,
  type CameraBounds,
  type CameraTransform,
  type Point,
  type VisibleViewport,
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
  presetViewport?(): Viewport
  visibleViewport?(): VisibleViewport
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
  restore(snapshot: Partial<CameraSnapshot> | null | undefined, nextViewport: Viewport): CameraTransform
  resetTo(presetKey: ViewPresetKey, durationMs?: number): void
  applyPreviewContain(bounds: { x?: number; y?: number; width: number; height: number }): CameraTransform | null
  clearPreviewContain(): CameraTransform
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
  const currentPresetViewport = (): Viewport => copyViewport(adapter.presetViewport?.() ?? viewport)
  let presetKey = selectViewPreset(currentPresetViewport(), coarsePointer)
  let transform: CameraTransform = { zoom: 1, offsetX: 0, offsetY: 0 }
  let animation: CameraSnapshot['animation'] = null
  let frameId: number | null = null
  let disposed = false
  let animationGeneration = 0
  let preservedMinimum: number | null = null
  let previewSnapshot: { transform: CameraTransform; viewport: Viewport; preservedMinimum: number | null } | null = null
  let previewWorldBounds: { x: number; y: number; width: number; height: number } | null = null

  const normalBounds = (key = presetKey): CameraBounds => {
    const maxZoom = Math.min(positiveOr(configuredBounds.maxZoom, MAX_ZOOM), MAX_ZOOM)
    const configuredMinimum = positiveOr(configuredBounds.minZoom, 0)
    return {
      minZoom: Math.min(maxZoom, Math.max(configuredMinimum, VIEW_PRESETS[key].zoom)),
      maxZoom,
      roundingTolerance: configuredBounds.roundingTolerance
    }
  }

  const bounds = (key = presetKey, minimum = preservedMinimum): CameraBounds => {
    const normal = normalBounds(key)
    if (minimum === null) return normal
    const configuredMinimum = Math.min(
      normal.maxZoom,
      positiveOr(configuredBounds.minZoom, 0)
    )
    return {
      ...normal,
      minZoom: Math.min(
        normal.minZoom,
        Math.max(configuredMinimum, Math.min(normal.maxZoom, positiveOr(minimum, configuredMinimum)))
      )
    }
  }

  const apply = (
    candidate: CameraTransform,
    operationBounds = bounds()
  ): CameraTransform => {
    transform = clampTransform(candidate, viewport, adapter.sceneSize(), operationBounds, adapter.visibleViewport?.())
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
      normalBounds(key),
      adapter.visibleViewport?.()
    )
  }

  const cancelAnimation = (): void => {
    const wasAnimating = animation !== null
    animationGeneration += 1
    if (frameId !== null) adapter.cancelFrame(frameId)
    frameId = null
    animation = null
    if (wasAnimating) {
      preservedMinimum = Math.min(normalBounds().minZoom, transform.zoom)
    }
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
      if (previewWorldBounds !== null) return controller.applyPreviewContain(previewWorldBounds) || { ...transform }
      const preserved = preserveFocus(transform, oldViewport, viewport)
      presetKey = selectViewPreset(currentPresetViewport(), coarsePointer)
      preservedMinimum = transform.zoom
      const resized = apply(preserved)
      preservedMinimum = Math.min(normalBounds().minZoom, resized.zoom)
      return resized
    },

    restore(snapshot, nextViewport) {
      if (disposed) return { ...transform }
      cancelAnimation()
      viewport = copyViewport(nextViewport)
      const requestedPreset = snapshot?.presetKey
      presetKey = requestedPreset && Object.prototype.hasOwnProperty.call(VIEW_PRESETS, requestedPreset)
        ? requestedPreset
        : selectViewPreset(currentPresetViewport(), coarsePointer)
      preservedMinimum = null
      const candidate = snapshot?.transform
      if (!Number.isFinite(candidate?.zoom) || !Number.isFinite(candidate?.offsetX) || !Number.isFinite(candidate?.offsetY)) {
        return apply(presetTransform(presetKey), normalBounds())
      }
      return apply({ zoom: candidate.zoom, offsetX: candidate.offsetX, offsetY: candidate.offsetY }, normalBounds())
    },

    applyPreviewContain(worldBounds) {
      if (disposed) return null
      const width = Number(worldBounds?.width)
      const height = Number(worldBounds?.height)
      const x = Number(worldBounds?.x)
      const y = Number(worldBounds?.y)
      if (![x, y, width, height, viewport.width, viewport.height].every(Number.isFinite) || width <= 0 || height <= 0 || viewport.width <= 0 || viewport.height <= 0) return null
      const zoom = Math.min(viewport.width / width, viewport.height / height)
      if (!Number.isFinite(zoom) || zoom <= 0) return null
      cancelAnimation()
      if (previewSnapshot === null) previewSnapshot = { transform: { ...transform }, viewport: { ...viewport }, preservedMinimum }
      previewWorldBounds = { x, y, width, height }
      const containOffsetX = viewport.width / 2 - (x + width / 2) * zoom
      const containOffsetY = viewport.height / 2 - (y + height / 2) * zoom
      return apply({ zoom, offsetX: containOffsetX - viewport.width / 2 * (1 - zoom), offsetY: containOffsetY - viewport.height / 2 * (1 - zoom) }, { minZoom: zoom, maxZoom: Math.max(normalBounds().maxZoom, zoom) })
    },

    clearPreviewContain() {
      if (disposed || previewSnapshot === null) return { ...transform }
      cancelAnimation()
      const snapshot = previewSnapshot
      previewSnapshot = null
      previewWorldBounds = null
      preservedMinimum = snapshot.preservedMinimum
      return apply(preserveFocus(snapshot.transform, snapshot.viewport, viewport), normalBounds())
    },

    resetTo(nextPresetKey, durationMs = DEFAULT_RESET_DURATION_MS) {
      if (disposed) return
      cancelAnimation()
      presetKey = nextPresetKey
      const start = { ...transform }
      const target = presetTransform(presetKey)
      const transitionMinimum = Math.min(start.zoom, target.zoom)
      const transitionBounds = bounds(presetKey, transitionMinimum)
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
        if (progress >= 1) {
          preservedMinimum = null
          apply(target, normalBounds())
          if (generation !== animationGeneration || animation === null || disposed) return
          animation = null
          return
        }
        apply({
          zoom: start.zoom + (target.zoom - start.zoom) * eased,
          offsetX: start.offsetX + (target.offsetX - start.offsetX) * eased,
          offsetY: start.offsetY + (target.offsetY - start.offsetY) * eased
        }, transitionBounds)
        if (generation !== animationGeneration || animation === null || disposed) return
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
