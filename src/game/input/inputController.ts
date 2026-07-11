import { resolveHit, type HitArea } from './hitTest.js'
import type { InteractionLock } from './interactionLock.js'
import {
  createPointerGesture,
  type ActiveGesture,
  type Point,
  type PointerSample
} from './pointerGesture.js'

type InputListener = (event: never) => void
type InputListenerOptions = { passive?: boolean; capture?: boolean }

export type InputEventTarget = {
  addEventListener(type: string, listener: InputListener, options?: InputListenerOptions | boolean): void
  removeEventListener(type: string, listener: InputListener, options?: InputListenerOptions | boolean): void
  setPointerCapture?(pointerId: number): void
  releasePointerCapture?(pointerId: number): void
}

export type InputCamera = {
  beginUserGesture(): void
  panBy(dx: number, dy: number): unknown
  zoomAt(point: Point, factor: number): unknown
  resetToMainHall?(): unknown
}

export type InputControllerOptions = {
  target: InputEventTarget
  camera: InputCamera
  interactionLock: InteractionLock
  viewport(): { width: number; height: number }
  hitProvider(): { agents: readonly HitArea[]; hotspots: readonly HitArea[] }
  onAgentClick?(id: string): void
  onHotspotClick?(id: string): void
  onBlankClick?(point: Point): void
  reset?(): void
  mouseThreshold?: number
  touchThreshold?: number
}

export type InputController = {
  cleanup(): void
  cancelGesture(): void
  snapshot(): { activeGesture: ActiveGesture; interactionLocked: boolean }
}

type PointerLike = {
  pointerId: number
  pointerType: string
  clientX: number
  clientY: number
  button?: number
  preventDefault?(): void
}

type WheelLike = { clientX: number; clientY: number; deltaY: number; deltaMode?: number; preventDefault?(): void }
type KeyLike = { key: string; repeat?: boolean; target?: unknown; preventDefault?(): void }

const pointerType = (value: string): PointerSample['type'] | null =>
  value === 'mouse' || value === 'touch' || value === 'pen' ? value : null

const validPointerId = (id: number): boolean => Number.isSafeInteger(id) && id >= 0

const sampleFrom = (event: PointerLike): PointerSample | null => {
  const type = pointerType(event.pointerType)
  if (type === null || !validPointerId(event.pointerId) ||
    !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null
  return { id: event.pointerId, type, x: event.clientX, y: event.clientY }
}

const editableTarget = (target: unknown): boolean => {
  if (target === null || typeof target !== 'object') return false
  const element = target as { tagName?: unknown; isContentEditable?: unknown }
  const tagName = typeof element.tagName === 'string' ? element.tagName.toUpperCase() : ''
  return element.isContentEditable === true || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT'
}

export const createInputController = (options: InputControllerOptions): InputController => {
  const gesture = createPointerGesture(options)
  const captured = new Set<number>()
  let bound = false
  let disposed = false
  let lastPinchScale = 1

  const releaseCapture = (id: number): void => {
    if (!captured.delete(id)) return
    try {
      options.target.releasePointerCapture?.(id)
    } catch {
      // The browser may have already released capture.
    }
  }

  const cancelAndReleaseAll = (): void => {
    for (const id of [...captured]) releaseCapture(id)
    gesture.cancelAll()
    lastPinchScale = 1
  }

  const locked = (): boolean => {
    if (!options.interactionLock.isLocked()) return false
    cancelAndReleaseAll()
    return true
  }

  const routeClick = (point: Point, type: PointerSample['type']): void => {
    const hits = options.hitProvider()
    const hit = resolveHit(point, hits.agents, hits.hotspots, type)
    if (hit.kind === 'agent') options.onAgentClick?.(hit.id)
    else if (hit.kind === 'hotspot') options.onHotspotClick?.(hit.id)
    else options.onBlankClick?.(point)
  }

  const pointerDown = ((raw: PointerLike): void => {
    const sample = sampleFrom(raw)
    if (sample === null) return
    if (locked()) return
    if (raw.button !== undefined && raw.button !== 0) return
    const wasActive = gesture.snapshot().activePointerIds.includes(sample.id)
    if (gesture.snapshot().activeGesture === 'none') options.camera.beginUserGesture()
    const result = gesture.down(sample)
    const accepted = !wasActive && gesture.snapshot().activePointerIds.includes(sample.id)
    if (!accepted) return
    try {
      options.target.setPointerCapture?.(sample.id)
      captured.add(sample.id)
    } catch {
      // Pointer capture is optional and can reject detached targets.
    }
    if (sample.type === 'touch') raw.preventDefault?.()
    if (result.kind === 'pinch') lastPinchScale = result.scale
  }) as InputListener

  const pointerMove = ((raw: PointerLike): void => {
    const sample = sampleFrom(raw)
    if (sample === null) return
    if (locked()) return
    const result = gesture.move(sample)
    if (sample.type === 'touch' && gesture.snapshot().activeGesture !== 'none') raw.preventDefault?.()
    if (result.kind === 'drag') options.camera.panBy(result.dx, result.dy)
    if (result.kind === 'pinch') {
      const factor = lastPinchScale > 0 ? result.scale / lastPinchScale : 1
      lastPinchScale = result.scale
      if (Number.isFinite(factor) && factor > 0 && factor !== 1) {
        options.camera.zoomAt(result.center, factor)
      }
      raw.preventDefault?.()
    }
  }) as InputListener

  const pointerUp = ((raw: PointerLike): void => {
    if (!validPointerId(raw.pointerId)) return
    const sample = sampleFrom(raw)
    if (sample === null) {
      gesture.cancel(raw.pointerId)
      releaseCapture(raw.pointerId)
      return
    }
    if (locked()) {
      releaseCapture(sample.id)
      return
    }
    const wasCaptured = captured.has(sample.id)
    const result = gesture.up(sample)
    releaseCapture(sample.id)
    if (sample.type === 'touch' && wasCaptured) raw.preventDefault?.()
    if (result.kind === 'click') routeClick(result.point, sample.type)
    if (gesture.snapshot().activeGesture !== 'pinch') lastPinchScale = 1
  }) as InputListener

  const pointerCancel = ((raw: PointerLike): void => {
    if (!validPointerId(raw.pointerId)) return
    gesture.cancel(raw.pointerId)
    releaseCapture(raw.pointerId)
  }) as InputListener

  const lostPointerCapture = ((raw: { pointerId: number }): void => {
    if (!validPointerId(raw.pointerId)) return
    gesture.cancel(raw.pointerId)
    releaseCapture(raw.pointerId)
  }) as InputListener

  const wheel = ((raw: WheelLike): void => {
    if (!Number.isFinite(raw.clientX) || !Number.isFinite(raw.clientY) ||
      !Number.isFinite(raw.deltaY)) return
    const deltaUnit = raw.deltaMode === 1
      ? 16
      : raw.deltaMode === 2 ? options.viewport().height : 1
    const effectiveDelta = raw.deltaY * deltaUnit
    if (!Number.isFinite(effectiveDelta) || effectiveDelta === 0 || locked()) return
    raw.preventDefault?.()
    options.camera.beginUserGesture()
    const magnitude = Math.min(Math.abs(effectiveDelta), 240) / 240
    const factor = effectiveDelta < 0 ? 1 + 0.25 * magnitude : 1 - 0.2 * magnitude
    options.camera.zoomAt({ x: raw.clientX, y: raw.clientY }, factor)
  }) as InputListener

  const keyDown = ((raw: KeyLike): void => {
    if (locked() || raw.repeat === true || editableTarget(raw.target)) return
    const viewport = options.viewport()
    const center = { x: viewport.width / 2, y: viewport.height / 2 }
    if (raw.key === '+' || raw.key === '=') {
      raw.preventDefault?.()
      options.camera.beginUserGesture()
      options.camera.zoomAt(center, 1.15)
    } else if (raw.key === '-' || raw.key === '_') {
      raw.preventDefault?.()
      options.camera.beginUserGesture()
      options.camera.zoomAt(center, 1 / 1.15)
    } else if (raw.key === '0') {
      raw.preventDefault?.()
      options.camera.beginUserGesture()
      if (options.reset !== undefined) options.reset()
      else options.camera.resetToMainHall?.()
    }
  }) as InputListener

  const doubleClick = ((raw: { preventDefault?(): void }): void => raw.preventDefault?.()) as InputListener
  const listeners = [
    ['pointerdown', pointerDown, { passive: false }],
    ['pointermove', pointerMove, { passive: false }],
    ['pointerup', pointerUp, { passive: false }],
    ['pointercancel', pointerCancel, { passive: false }],
    ['lostpointercapture', lostPointerCapture, false],
    ['wheel', wheel, { passive: false }],
    ['keydown', keyDown, false],
    ['dblclick', doubleClick, false]
  ] as const

  const bind = (): void => {
    if (bound || disposed) return
    bound = true
    for (const [type, listener, listenerOptions] of listeners) {
      options.target.addEventListener(type, listener, listenerOptions)
    }
  }

  const cleanup = (): void => {
    if (disposed) return
    disposed = true
    if (bound) {
      for (const [type, listener] of listeners) {
        options.target.removeEventListener(type, listener)
      }
      bound = false
    }
    cancelAndReleaseAll()
  }

  bind()
  return {
    cleanup,
    cancelGesture: cancelAndReleaseAll,
    snapshot: () => Object.freeze({
      activeGesture: gesture.snapshot().activeGesture,
      interactionLocked: options.interactionLock.isLocked()
    })
  }
}
