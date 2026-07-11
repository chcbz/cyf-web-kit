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

  const touchPair = (): [PointerState, PointerState] | null => {
    const touches = [...pointers.values()].filter(pointer => pointer.type === 'touch')
    return touches.length >= 2 ? [touches[0], touches[1]] : null
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
  }

  return {
    down(sample) {
      if (!validSample(sample) || pointers.has(sample.id)) return NONE
      pointers.set(sample.id, { ...sample, startX: sample.x, startY: sample.y })
      if (primaryId === null) {
        primaryId = sample.id
        activeGesture = 'click'
      }

      const pair = touchPair()
      if (pair !== null) {
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

      if (activeGesture === 'pinch' || pinchSuppressedClick) {
        activeGesture = pointers.size === 0 ? 'none' : 'drag'
      } else if (wasPrimary) {
        activeGesture = 'none'
      }
      if (pointers.size === 0) {
        primaryId = null
        activeGesture = 'none'
        pinchStartDistance = 0
        pinchSuppressedClick = false
      }
      return shouldClick ? { kind: 'click', point: { x: sample.x, y: sample.y } } : NONE
    },

    cancel(id) {
      if (!Number.isSafeInteger(id) || id < 0 || !pointers.has(id)) return
      if (id === primaryId || activeGesture === 'pinch') cancelAll()
      else pointers.delete(id)
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
