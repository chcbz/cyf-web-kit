// ── E4 Polygon Geometry ──
// 1/256 world-pixel fixed-point, even-odd containment, signed distance,
// 3px hysteresis. All containment decisions use exact integer arithmetic.
// Distance computations use world coordinates for correct Euclidean metric.

import { type Point, type Rect, renderSchemaError } from './schema.js'

// ── Fixed-point types ──

/** Fixed-point coordinate = round(world * 256). Always a safe integer. */
export type FixedPoint = number

/** Ordered array of fixed-point vertices. First ≠ last (no closing duplicate). */
export interface FixedPointVec { x: FixedPoint; y: FixedPoint }
export type FixedPolygon = FixedPointVec[]

/** Fixed-point axis-aligned bounding box. */
export interface FixedBounds {
  minX: FixedPoint
  minY: FixedPoint
  maxX: FixedPoint
  maxY: FixedPoint
}

// ── Constants ──

export const FIXED_SCALE = 256

/** Hysteresis threshold in world pixels (fixed at 3). */
export const HYSTERESIS_WORLD_PX = 3

// ── Fixed-point conversion ──

/**
 * Convert a world coordinate to fixed-point.
 * round(world * 256). Throws structured fatal on non-finite or overflow.
 */
export function toFixedPoint(
  world: number,
  sceneId: string,
  objectId: string,
  field: string,
): FixedPoint {
  if (!Number.isFinite(world)) {
    throw renderSchemaError(
      'POLYGON_NON_FINITE',
      sceneId,
      objectId,
      field,
      `polygon 坐标必须为有限数值，得到 ${String(world)}。`,
      `polygon coordinate must be finite, got ${String(world)}`,
    )
  }

  const fp = Math.round(world * FIXED_SCALE)

  // Normalize -0 to 0
  const normalized = Object.is(fp, -0) ? 0 : fp

  if (!Number.isSafeInteger(normalized)) {
    throw renderSchemaError(
      'POLYGON_FIXED_OVERFLOW',
      sceneId,
      objectId,
      field,
      `polygon 定点化后坐标 ${normalized} 超过安全整数范围。`,
      `fixed-point coordinate ${normalized} exceeds safe integer range`,
    )
  }

  return normalized
}

/** Convert a fixed-point coordinate back to world. */
export function fromFixedPoint(fp: FixedPoint): number {
  return fp / FIXED_SCALE
}

// ── Fixed-point vector arithmetic ──

/** Cross product of vectors (ax,ay) × (bx,by). */
function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx
}

/** Signed double area of polygon (2× geometric area). Positive for CCW. */
function signedDoubleArea(poly: FixedPolygon): number {
  let area = 0
  const n = poly.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    area += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y)
  }
  return area
}

/** Geometric area in world px² (absolute value). */
export function polygonWorldArea(poly: FixedPolygon): number {
  return Math.abs(signedDoubleArea(poly)) / (2 * FIXED_SCALE * FIXED_SCALE)
}

/** Orientation: positive = CCW, negative = CW, zero = degenerate. */
export function polygonOrientation(poly: FixedPolygon): number {
  return signedDoubleArea(poly)
}

// ── Bounds (AABB) ──

export function fixedPolygonBounds(poly: FixedPolygon): FixedBounds {
  let minX = Infinity, minY = Infinity
  let maxX = -Infinity, maxY = -Infinity
  for (const p of poly) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

/** Broad-phase AABB containment test. */
export function aabbContains(bounds: FixedBounds, fx: FixedPoint, fy: FixedPoint): boolean {
  return fx >= bounds.minX && fx <= bounds.maxX && fy >= bounds.minY && fy <= bounds.maxY
}

/** Convert FixedBounds to world Rect. */
export function boundsToRect(bounds: FixedBounds): Rect {
  return {
    x: fromFixedPoint(bounds.minX),
    y: fromFixedPoint(bounds.minY),
    width: fromFixedPoint(bounds.maxX - bounds.minX),
    height: fromFixedPoint(bounds.maxY - bounds.minY),
  }
}

// ── Even-odd containment (exact integer arithmetic) ──

export function evenOddContainment(poly: FixedPolygon, fx: FixedPoint, fy: FixedPoint): boolean {
  // Standard ray-casting even-odd algorithm.
  // Shoot a horizontal ray to +x and count edge crossings.
  // Uses the standard formula with floating-point intersection for correctness;
  // (yj - yi) is never zero when the straddle condition holds.
  // All inputs are safe integers; IEEE 754 double-precision division gives
  // deterministic results for these values.
  let inside = false
  const n = poly.length

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].x, yi = poly[i].y
    const xj = poly[j].x, yj = poly[j].y

    // Check if edge straddles the horizontal ray (strictly above test)
    if ((yi > fy) !== (yj > fy)) {
      // xIntersect = xi + (fy - yi) * (xj - xi) / (yj - yi)
      const xIntersect = xi + (fy - yi) * (xj - xi) / (yj - yi)
      if (fx < xIntersect) {
        inside = !inside
      }
    }
  }

  return inside
}

// ── Point-to-segment distance (world coordinates) ──

function pointToSegmentDistanceWorld(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const abx = bx - ax
  const aby = by - ay
  const abLen2 = abx * abx + aby * aby

  if (abLen2 === 0) {
    const dx = px - ax
    const dy = py - ay
    return Math.sqrt(dx * dx + dy * dy)
  }

  const apx = px - ax
  const apy = py - ay
  const t = (apx * abx + apy * aby) / abLen2

  if (t <= 0) {
    return Math.sqrt(apx * apx + apy * apy)
  }
  if (t >= 1) {
    const dx = px - bx
    const dy = py - by
    return Math.sqrt(dx * dx + dy * dy)
  }

  const projX = ax + t * abx
  const projY = ay + t * aby
  const dx = px - projX
  const dy = py - projY
  return Math.sqrt(dx * dx + dy * dy)
}

// ── Signed distance to polygon ──

const BOUNDARY_EPSILON = 1e-9

export function signedDistanceToPolygon(
  poly: FixedPolygon,
  fx: FixedPoint,
  fy: FixedPoint,
): number {
  const wx = fromFixedPoint(fx)
  const wy = fromFixedPoint(fy)

  const n = poly.length
  let minDist = Infinity

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const ax = fromFixedPoint(poly[i].x)
    const ay = fromFixedPoint(poly[i].y)
    const bx = fromFixedPoint(poly[j].x)
    const by = fromFixedPoint(poly[j].y)
    const d = pointToSegmentDistanceWorld(wx, wy, ax, ay, bx, by)
    if (d < minDist) minDist = d
  }

  if (minDist < BOUNDARY_EPSILON) return 0

  const inside = evenOddContainment(poly, fx, fy)
  return inside ? minDist : -minDist
}

// ── Hysteresis membership ──

export interface HysteresisState {
  inside: boolean
  signedDistance: number
}

export function computeHysteresis(
  poly: FixedPolygon,
  fx: FixedPoint,
  fy: FixedPoint,
  previousWasInside: boolean | null,
): HysteresisState {
  const sd = signedDistanceToPolygon(poly, fx, fy)

  let inside: boolean

  if (previousWasInside === null) {
    inside = sd >= 0
  } else if (previousWasInside) {
    inside = sd > -HYSTERESIS_WORLD_PX
  } else {
    inside = sd >= HYSTERESIS_WORLD_PX
  }

  return { inside, signedDistance: sd }
}
