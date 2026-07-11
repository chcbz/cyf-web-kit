export type Point = { x: number; y: number }

export type PointerSample = {
  id: number
  type: 'mouse' | 'touch' | 'pen'
  x: number
  y: number
}

export type GestureResult =
  | { kind: 'none' }
  | { kind: 'click'; point: Point }
  | { kind: 'drag'; dx: number; dy: number }
  | { kind: 'pinch'; center: Point; scale: number }

export type ActiveGesture = 'none' | 'click' | 'drag' | 'pinch'

export type PointerGesture = {
  down(sample: PointerSample): GestureResult
  move(sample: PointerSample): GestureResult
  up(sample: PointerSample): GestureResult
  cancel(id: number): void
  cancelAll(): void
  snapshot(): { activeGesture: ActiveGesture; activePointerIds: readonly number[] }
}

type PointerState = PointerSample & { startX: number; startY: number }

const NONE: GestureResult = Object.freeze({ kind: 'none' })

const validSample = (sample: PointerSample): boolean =>
  Number.isSafeInteger(sample.id) && sample.id >= 0 &&
  Number.isFinite(sample.x) && Number.isFinite(sample.y) &&
  (sample.type === 'mouse' || sample.type === 'touch' || sample.type === 'pen')

const thresholdOr = (value: number | undefined, fallback: number): number =>
  Number.isFinite(value) && (value as number) >= 0 ? value as number : fallback

export const createPointerGesture = (
  options: { mouseThreshold?: number; touchThreshold?: number } = {}
): PointerGesture => {
  const mouseThreshold = thresholdOr(options.mouseThreshold, 6)
  const touchThreshold = thresholdOr(options.touchThreshold, 11)
  const pointers = new Map<number, PointerState>()
  let primaryId: number | null = null
  let activeGesture: ActiveGesture = 'none'
  let pinchStartDistance = 0
  let pinchSuppressedClick = false
  let pinchIds: readonly [number, number] | null = null

  const touchPair = (): [PointerState, PointerState] | null => {
    if (pinchIds === null) return null
    const first = pointers.get(pinchIds[0])
    const second = pointers.get(pinchIds[1])
    return first === undefined || second === undefined ? null : [first, second]
  }

  const pinchResult = (): GestureResult => {
    const pair = touchPair()
    if (pair === null) return NONE
    const [first, second] = pair
    const distance = Math.hypot(second.x - first.x, second.y - first.y)
    return {
      kind: 'pinch',
      center: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
      scale: pinchStartDistance > 0 ? distance / pinchStartDistance : 1
    }
  }

  const cancelAll = (): void => {
    pointers.clear()
    primaryId = null
    activeGesture = 'none'
    pinchStartDistance = 0
    pinchSuppressedClick = false
    pinchIds = null
  }

  const promoteRemainingPinchTouch = (releasedId: number): void => {
    if (pinchIds === null || !pinchIds.includes(releasedId)) return
    const remainingId = pinchIds[0] === releasedId ? pinchIds[1] : pinchIds[0]
    const remaining = pointers.get(remainingId)
    pinchIds = null
    pinchStartDistance = 0
    if (remaining === undefined) {
      primaryId = null
      activeGesture = 'none'
      return
    }
    primaryId = remainingId
    remaining.startX = remaining.x
    remaining.startY = remaining.y
    activeGesture = 'drag'
    pinchSuppressedClick = true
  }

  return {
    down(sample) {
      if (!validSample(sample) || pointers.has(sample.id)) return NONE
      if (activeGesture === 'pinch' && sample.type === 'touch') return NONE
      pointers.set(sample.id, { ...sample, startX: sample.x, startY: sample.y })
      if (primaryId === null) {
        primaryId = sample.id
        activeGesture = 'click'
      }

      const touches = [...pointers.values()].filter(pointer => pointer.type === 'touch')
      if (touches.length === 2) {
        pinchIds = [touches[0].id, touches[1].id]
        const pair = touchPair() as [PointerState, PointerState]
        pinchStartDistance = Math.hypot(pair[1].x - pair[0].x, pair[1].y - pair[0].y)
        activeGesture = 'pinch'
        pinchSuppressedClick = true
        return pinchResult()
      }
      return NONE
    },

    move(sample) {
      if (!validSample(sample)) return NONE
      const pointer = pointers.get(sample.id)
      if (pointer === undefined) return NONE
      const previous = { x: pointer.x, y: pointer.y }
      pointer.x = sample.x
      pointer.y = sample.y

      if (activeGesture === 'pinch') return pinchResult()
      if (sample.id !== primaryId) return NONE
      if (activeGesture === 'click') {
        const threshold = pointer.type === 'touch' ? touchThreshold : mouseThreshold
        if (Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) <= threshold) return NONE
        activeGesture = 'drag'
      }
      if (activeGesture === 'drag') {
        return { kind: 'drag', dx: pointer.x - previous.x, dy: pointer.y - previous.y }
      }
      return NONE
    },

    up(sample) {
      if (!validSample(sample)) return NONE
      const pointer = pointers.get(sample.id)
      if (pointer === undefined) return NONE
      pointer.x = sample.x
      pointer.y = sample.y
      const wasPrimary = sample.id === primaryId
      const threshold = pointer.type === 'touch' ? touchThreshold : mouseThreshold
      const withinClickThreshold = Math.hypot(
        pointer.x - pointer.startX,
        pointer.y - pointer.startY
      ) <= threshold
      const shouldClick = wasPrimary && activeGesture === 'click' &&
        !pinchSuppressedClick && withinClickThreshold
      pointers.delete(sample.id)

      if (activeGesture === 'pinch') {
        promoteRemainingPinchTouch(sample.id)
      } else if (pinchSuppressedClick) {
        activeGesture = pointers.size === 0 ? 'none' : 'drag'
      } else if (wasPrimary) {
        activeGesture = 'none'
      }
      if (pointers.size === 0) {
        primaryId = null
        activeGesture = 'none'
        pinchStartDistance = 0
        pinchSuppressedClick = false
        pinchIds = null
      }
      return shouldClick ? { kind: 'click', point: { x: sample.x, y: sample.y } } : NONE
    },

    cancel(id) {
      if (!Number.isSafeInteger(id) || id < 0 || !pointers.has(id)) return
      pointers.delete(id)
      if (activeGesture === 'pinch') promoteRemainingPinchTouch(id)
      else if (id === primaryId) cancelAll()
    },

    cancelAll,

    snapshot() {
      return Object.freeze({
        activeGesture,
        activePointerIds: Object.freeze([...pointers.keys()].sort((a, b) => a - b))
      })
    }
  }
}
