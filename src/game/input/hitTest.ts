import type { Point, PointerSample } from './pointerGesture.js'

export type HitArea = {
  id: string
  kind: 'agent' | 'hotspot'
  contains(point: Point): boolean
  touchSlop?: number
  containsWithSlop?(point: Point, slop: number): boolean
  bounds?: { x: number; y: number; width: number; height: number }
}

export type HitResult =
  | { kind: 'agent'; id: string }
  | { kind: 'hotspot'; id: string }
  | { kind: 'blank' }

const containsWithTouchSlop = (area: HitArea, point: Point): boolean => {
  if (area.contains(point)) return true
  const slop = Number.isFinite(area.touchSlop) && (area.touchSlop as number) > 0
    ? area.touchSlop as number
    : 0
  if (slop === 0) return false
  if (area.containsWithSlop !== undefined) return area.containsWithSlop(point, slop)
  if (area.bounds === undefined) return false
  const { x, y, width, height } = area.bounds
  if (![x, y, width, height].every(Number.isFinite) || width < 0 || height < 0) return false
  const dx = Math.max(x - point.x, 0, point.x - (x + width))
  const dy = Math.max(y - point.y, 0, point.y - (y + height))
  return Math.hypot(dx, dy) <= slop
}

export const resolveHit = (
  point: Point,
  agents: readonly HitArea[],
  hotspots: readonly HitArea[],
  pointerType: PointerSample['type'] = 'mouse'
): HitResult => {
  const matches = (area: HitArea): boolean =>
    pointerType === 'touch' ? containsWithTouchSlop(area, point) : area.contains(point)
  const agent = agents.find(matches)
  if (agent !== undefined) return { kind: 'agent', id: agent.id }
  const hotspot = hotspots.find(matches)
  if (hotspot !== undefined) return { kind: 'hotspot', id: hotspot.id }
  return { kind: 'blank' }
}
