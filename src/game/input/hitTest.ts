import type { Point, PointerSample } from './pointerGesture.js'

export type HitArea = {
  id: string
  kind: 'agent' | 'hotspot'
  contains(point: Point): boolean
  touchSlop?: number
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
  const diagonal = slop / Math.SQRT2
  return [
    { x: point.x + slop, y: point.y },
    { x: point.x - slop, y: point.y },
    { x: point.x, y: point.y + slop },
    { x: point.x, y: point.y - slop },
    { x: point.x + diagonal, y: point.y + diagonal },
    { x: point.x + diagonal, y: point.y - diagonal },
    { x: point.x - diagonal, y: point.y + diagonal },
    { x: point.x - diagonal, y: point.y - diagonal }
  ].some(candidate => area.contains(candidate))
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
