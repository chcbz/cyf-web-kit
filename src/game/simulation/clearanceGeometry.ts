import type { MapPoint, MapPolygon } from '../map/movementSchema.js'

/** Extra world-pixel clearance kept between an agent collider and every obstacle. */
export const CLEARANCE_SAFETY_MARGIN = 6
const EPSILON = 1e-9

export function requiredClearance(colliderWidth: number): number {
  if (!Number.isFinite(colliderWidth) || colliderWidth <= 0) {
    throw new TypeError('colliderWidth must be positive and finite')
  }
  return colliderWidth / 2 + CLEARANCE_SAFETY_MARGIN
}

/** Minimum channel width that leaves the safety margin on both collider sides. */
export function requiredChannelWidth(colliderWidth: number): number {
  requiredClearance(colliderWidth)
  return colliderWidth + CLEARANCE_SAFETY_MARGIN * 2
}

/**
 * Returns the true Euclidean distance from a point to the solid polygon. Points on or
 * inside a polygon have zero clearance.
 */
export function pointClearance(point: MapPoint, polygons: readonly MapPolygon[]): number {
  if (!finitePoint(point)) return 0
  let clearance = Number.POSITIVE_INFINITY
  for (const polygon of polygons) {
    if (polygon.points.length < 3) continue
    if (pointInPolygon(point, polygon)) return 0
    clearance = Math.min(clearance, pointToPolygonDistance(point, polygon))
  }
  return clearance
}

/**
 * Returns the minimum true Euclidean clearance along a polyline. Any intersection
 * or segment running through a polygon has zero clearance.
 */
export function polylineClearance(points: readonly MapPoint[], polygons: readonly MapPolygon[]): number {
  if (points.length === 0 || points.some(point => !finitePoint(point))) return 0
  if (points.length === 1) return pointClearance(points[0], polygons)
  let clearance = Number.POSITIVE_INFINITY
  for (let index = 1; index < points.length; index += 1) {
    clearance = Math.min(clearance, segmentClearance(points[index - 1], points[index], polygons))
    if (clearance <= EPSILON) return 0
  }
  return clearance
}

export function hasRequiredPointClearance(
  point: MapPoint,
  polygons: readonly MapPolygon[],
  clearance: number,
): boolean {
  return pointClearance(point, polygons) + EPSILON >= clearance
}

export function hasRequiredPolylineClearance(
  points: readonly MapPoint[],
  polygons: readonly MapPolygon[],
  clearance: number,
): boolean {
  const actual = polylineClearance(points, polygons)
  return clearance <= EPSILON ? actual > EPSILON : actual + EPSILON >= clearance
}

function segmentClearance(start: MapPoint, end: MapPoint, polygons: readonly MapPolygon[]): number {
  let clearance = Number.POSITIVE_INFINITY
  for (const polygon of polygons) {
    if (polygon.points.length < 3) continue
    if (pointInPolygon(start, polygon) || pointInPolygon(end, polygon)) return 0
    for (let index = 0; index < polygon.points.length; index += 1) {
      const edgeStart = polygon.points[index]
      const edgeEnd = polygon.points[(index + 1) % polygon.points.length]
      if (segmentsIntersect(start, end, edgeStart, edgeEnd)) return 0
      clearance = Math.min(clearance, segmentToSegmentDistance(start, end, edgeStart, edgeEnd))
    }
  }
  return clearance
}

function pointToPolygonDistance(point: MapPoint, polygon: MapPolygon): number {
  let distance = Number.POSITIVE_INFINITY
  for (let index = 0; index < polygon.points.length; index += 1) {
    distance = Math.min(distance, pointToSegmentDistance(
      point, polygon.points[index], polygon.points[(index + 1) % polygon.points.length],
    ))
  }
  return distance
}

function segmentToSegmentDistance(a: MapPoint, b: MapPoint, c: MapPoint, d: MapPoint): number {
  return Math.min(
    pointToSegmentDistance(a, c, d), pointToSegmentDistance(b, c, d),
    pointToSegmentDistance(c, a, b), pointToSegmentDistance(d, a, b),
  )
}

function pointToSegmentDistance(point: MapPoint, start: MapPoint, end: MapPoint): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared <= EPSILON) return Math.hypot(point.x - start.x, point.y - start.y)
  const ratio = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
  return Math.hypot(point.x - (start.x + ratio * dx), point.y - (start.y + ratio * dy))
}

function pointInPolygon(point: MapPoint, polygon: MapPolygon): boolean {
  let inside = false
  for (let index = 0, previous = polygon.points.length - 1;
    index < polygon.points.length; previous = index, index += 1) {
    const current = polygon.points[index]
    const before = polygon.points[previous]
    if (pointOnSegment(point, before, current)) return true
    if ((current.y > point.y) !== (before.y > point.y)
      && point.x < ((before.x - current.x) * (point.y - current.y))
        / (before.y - current.y) + current.x) inside = !inside
  }
  return inside
}

function segmentsIntersect(a: MapPoint, b: MapPoint, c: MapPoint, d: MapPoint): boolean {
  const abC = cross(a, b, c)
  const abD = cross(a, b, d)
  const cdA = cross(c, d, a)
  const cdB = cross(c, d, b)
  if (((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON))
    && ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))) return true
  return (Math.abs(abC) <= EPSILON && pointOnSegment(c, a, b))
    || (Math.abs(abD) <= EPSILON && pointOnSegment(d, a, b))
    || (Math.abs(cdA) <= EPSILON && pointOnSegment(a, c, d))
    || (Math.abs(cdB) <= EPSILON && pointOnSegment(b, c, d))
}

function pointOnSegment(point: MapPoint, start: MapPoint, end: MapPoint): boolean {
  return Math.abs(cross(start, end, point)) <= EPSILON
    && point.x >= Math.min(start.x, end.x) - EPSILON && point.x <= Math.max(start.x, end.x) + EPSILON
    && point.y >= Math.min(start.y, end.y) - EPSILON && point.y <= Math.max(start.y, end.y) + EPSILON
}

function cross(a: MapPoint, b: MapPoint, c: MapPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function finitePoint(point: MapPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
}
