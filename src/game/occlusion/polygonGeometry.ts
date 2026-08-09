// ── E4 Polygon Geometry ──
// 1/256 world-pixel fixed-point, even-odd containment, signed distance,
// 3px hysteresis. All containment/orientation decisions use exact BigInt arithmetic.

import { type Point, type Rect, renderSchemaError } from './schema.js'

// ── Fixed-point types ──

export type FixedPoint = number

export function assertFixedPoint(
  value: number,
  sceneId: string,
  objectId: string,
  field: string,
): asserts value is FixedPoint {
  if (!Number.isSafeInteger(value)) {
    throw renderSchemaError(
      'POLYGON_FIXED_OVERFLOW',
      sceneId, objectId, field,
      `fixed-point coordinate ${value} is not a safe integer`,
      `fixed-point coordinate ${value} is not a safe integer`,
    )
  }
}

export interface FixedPointVec { x: FixedPoint; y: FixedPoint }
export type FixedPolygon = FixedPointVec[]

export interface FixedBounds {
  minX: FixedPoint; minY: FixedPoint
  maxX: FixedPoint; maxY: FixedPoint
}

export const FIXED_SCALE = 256
export const HYSTERESIS_WORLD_PX = 3

// ── BigInt helpers ──

function bigInt(v: number): bigint { return BigInt(v) }

// ── Fixed-point conversion ──

export function toFixedPoint(world: number, sceneId: string, objectId: string, field: string): FixedPoint {
  if (!Number.isFinite(world)) {
    throw renderSchemaError('POLYGON_NON_FINITE', sceneId, objectId, field,
      `polygon coordinate must be finite, got ${String(world)}`,
      `polygon coordinate must be finite, got ${String(world)}`)
  }
  const fp = Math.round(world * FIXED_SCALE)
  const normalized = Object.is(fp, -0) ? 0 : fp
  if (!Number.isSafeInteger(normalized)) {
    throw renderSchemaError('POLYGON_FIXED_OVERFLOW', sceneId, objectId, field,
      `fixed-point coordinate ${normalized} exceeds safe integer range`,
      `fixed-point coordinate ${normalized} exceeds safe integer range`)
  }
  return normalized
}

export function fromFixedPoint(fp: FixedPoint): number { return fp / FIXED_SCALE }

// ── BigInt exact orientation ──

export function bigOrient2d(
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
): -1 | 0 | 1 {
  const v = (bigInt(bx) - bigInt(ax)) * (bigInt(cy) - bigInt(ay))
          - (bigInt(by) - bigInt(ay)) * (bigInt(cx) - bigInt(ax))
  return v > 0n ? 1 : v < 0n ? -1 : 0
}

// ── BigInt signed double area ──

export function bigSignedDoubleArea(poly: FixedPolygon): bigint {
  // Standard shoelace formula: sum(x_i*y_{i+1} - x_{i+1}*y_i)
  // CCW polygon → positive, CW → negative.
  let area = 0n
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += bigInt(poly[i].x) * bigInt(poly[j].y) - bigInt(poly[j].x) * bigInt(poly[i].y)
  }
  return area
}

export function polygonWorldArea(poly: FixedPolygon): number {
  const da = bigSignedDoubleArea(poly)
  const daAbs = da < 0n ? -da : da
  return Number(daAbs) / (2 * FIXED_SCALE * FIXED_SCALE)
}

export function polygonAreaCompare(poly: FixedPolygon, thresholdWorldPx2: number): -1 | 0 | 1 {
  const daAbs = bigSignedDoubleArea(poly)
  const daAbsPos = daAbs < 0n ? -daAbs : daAbs
  const threshFixed = bigInt(Math.round(thresholdWorldPx2 * 2 * FIXED_SCALE * FIXED_SCALE))
  if (daAbsPos > threshFixed) return 1
  if (daAbsPos < threshFixed) return -1
  return 0
}

export function polygonOrientation(poly: FixedPolygon): number {
  const da = bigSignedDoubleArea(poly)
  return da > 0n ? 1 : da < 0n ? -1 : 0
}

// ── Is polygon convex? (all interior angles ≤ 180°) ──

export function isPolygonConvex(poly: FixedPolygon): boolean {
  const n = poly.length
  if (n < 3) return false
  const da = bigSignedDoubleArea(poly)
  if (da === 0n) return false
  const sign = da > 0n ? 1 : -1
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const k = (i + 2) % n
    const o = bigOrient2d(poly[i].x, poly[i].y, poly[j].x, poly[j].y, poly[k].x, poly[k].y)
    if (o === -sign) return false
  }
  return true
}

// ── Bounds ──

export function fixedPolygonBounds(poly: FixedPolygon): FixedBounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of poly) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

export function aabbContains(bounds: FixedBounds, fx: FixedPoint, fy: FixedPoint): boolean {
  return fx >= bounds.minX && fx <= bounds.maxX && fy >= bounds.minY && fy <= bounds.maxY
}

export function boundsToRect(bounds: FixedBounds): Rect {
  return { x: fromFixedPoint(bounds.minX), y: fromFixedPoint(bounds.minY), width: fromFixedPoint(bounds.maxX - bounds.minX), height: fromFixedPoint(bounds.maxY - bounds.minY) }
}

// ── Even-odd containment (exact BigInt rational) ──

export function evenOddContainment(poly: FixedPolygon, fx: FixedPoint, fy: FixedPoint): boolean {
  let inside = false
  const n = poly.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y
    if ((yi > fy) !== (yj > fy)) {
      const denom = bigInt(yj) - bigInt(yi)
      const lhs = (bigInt(fx) - bigInt(xi)) * denom
      const rhs = (bigInt(fy) - bigInt(yi)) * (bigInt(xj) - bigInt(xi))
      if ((denom > 0n && lhs < rhs) || (denom < 0n && lhs > rhs)) inside = !inside
    }
  }
  return inside
}

// ── Point-to-segment distance ──

function pointToSegmentWorld(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax, aby = by - ay, abLen2 = abx * abx + aby * aby
  if (abLen2 === 0) { const dx = px - ax, dy = py - ay; return Math.sqrt(dx * dx + dy * dy) }
  const apx = px - ax, apy = py - ay, t = (apx * abx + apy * aby) / abLen2
  if (t <= 0) return Math.sqrt(apx * apx + apy * apy)
  if (t >= 1) { const dx = px - bx, dy = py - by; return Math.sqrt(dx * dx + dy * dy) }
  const projX = ax + t * abx, projY = ay + t * aby
  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2)
}

// ── Exact point-on-segment ──

export function isPointOnSegmentExact(
  fx: FixedPoint, fy: FixedPoint, ax: FixedPoint, ay: FixedPoint, bx: FixedPoint, by: FixedPoint,
): boolean {
  if (bigOrient2d(ax, ay, bx, by, fx, fy) !== 0) return false
  return (
    bigInt(fx) >= (bigInt(ax) < bigInt(bx) ? bigInt(ax) : bigInt(bx)) &&
    bigInt(fx) <= (bigInt(ax) > bigInt(bx) ? bigInt(ax) : bigInt(bx)) &&
    bigInt(fy) >= (bigInt(ay) < bigInt(by) ? bigInt(ay) : bigInt(by)) &&
    bigInt(fy) <= (bigInt(ay) > bigInt(by) ? bigInt(ay) : bigInt(by))
  )
}

// ── Signed distance ──

export function signedDistanceToPolygon(poly: FixedPolygon, fx: FixedPoint, fy: FixedPoint): number {
  const wx = fromFixedPoint(fx), wy = fromFixedPoint(fy)
  const n = poly.length
  let minDist = Infinity
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    if (isPointOnSegmentExact(fx, fy, poly[i].x, poly[i].y, poly[j].x, poly[j].y)) return 0
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const d = pointToSegmentWorld(wx, wy,
      fromFixedPoint(poly[i].x), fromFixedPoint(poly[i].y),
      fromFixedPoint(poly[j].x), fromFixedPoint(poly[j].y))
    if (d < minDist) minDist = d
  }
  const inside = evenOddContainment(poly, fx, fy)
  return inside ? minDist : -minDist
}

// ── Hysteresis ──

export interface HysteresisState { inside: boolean; signedDistance: number }

export function computeHysteresis(
  poly: FixedPolygon, fx: FixedPoint, fy: FixedPoint, previousWasInside: boolean | null,
): HysteresisState {
  const sd = signedDistanceToPolygon(poly, fx, fy)
  let inside: boolean
  if (previousWasInside === null) inside = sd >= 0
  else if (previousWasInside) inside = sd > -HYSTERESIS_WORLD_PX
  else inside = sd >= HYSTERESIS_WORLD_PX
  return { inside, signedDistance: sd }
}

// ── Convex erosion: fast exact half-plane clipping ──
// Clip the polygon itself against inward-offset half-planes.
// This is exact for convex polygons.

function convexErodedInteriorNonEmpty(poly: FixedPolygon): boolean {
  const n = poly.length
  const da = bigSignedDoubleArea(poly)
  const isCCW = da > 0n

  const worldPts = poly.map(p => ({ x: fromFixedPoint(p.x), y: fromFixedPoint(p.y) }))

  // Build inward-offset half-planes
  const halfPlanes: { nx: number; ny: number; d: number }[] = []
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const ax = worldPts[i].x, ay = worldPts[i].y, bx = worldPts[j].x, by = worldPts[j].y
    const dx = bx - ax, dy = by - ay, len = Math.sqrt(dx * dx + dy * dy)
    if (len === 0) continue
    const ex = dx / len, ey = dy / len
    // CCW interior is left of each edge → inward normal = (-ey, ex)
    // CW interior is right of each edge → inward normal = (ey, -ex)
    const nx = isCCW ? -ey : ey
    const ny = isCCW ? ex : -ex
    halfPlanes.push({ nx, ny, d: nx * ax + ny * ay + HYSTERESIS_WORLD_PX })
  }
  if (halfPlanes.length < 3) return false

  // Start from polygon vertices in world
  let clipPoly = worldPts.map(p => ({ x: p.x, y: p.y }))

  for (const hp of halfPlanes) {
    if (clipPoly.length === 0) break
    const input = clipPoly
    clipPoly = []
    for (let i = 0; i < input.length; i++) {
      const j = (i + 1) % input.length
      const sx = input[i].x, sy = input[i].y, ex = input[j].x, ey = input[j].y
      const sInside = hp.nx * sx + hp.ny * sy >= hp.d - 1e-12
      const eInside = hp.nx * ex + hp.ny * ey >= hp.d - 1e-12
      if (sInside) clipPoly.push({ x: sx, y: sy })
      if (sInside !== eInside) {
        const sVal = hp.nx * sx + hp.ny * sy, eVal = hp.nx * ex + hp.ny * ey
        const t = (hp.d - sVal) / (eVal - sVal)
        clipPoly.push({ x: sx + t * (ex - sx), y: sy + t * (ey - sy) })
      }
    }
  }

  if (clipPoly.length < 3) return false
  let area = 0
  for (let i = 0, j = clipPoly.length - 1; i < clipPoly.length; j = i++) {
    area += (clipPoly[j].x + clipPoly[i].x) * (clipPoly[j].y - clipPoly[i].y)
  }
  return Math.abs(area) / 2 > 1e-6
}

// ── Concave erosion: Polylabel-style quadtree search ──
// Uses priority queue ordered by potential = sd(center) + cell radius.
// Upper bound is sd(center) + radius (by 1-Lipschitz property of signed distance).
// This finds the global maximum clearance efficiently and exactly (to resolution).

function concaveMaxSignedDistanceGt(poly: FixedPolygon, threshold: number): boolean {
  const bounds = fixedPolygonBounds(poly)
  const minWx = fromFixedPoint(bounds.minX), minWy = fromFixedPoint(bounds.minY)
  const maxWx = fromFixedPoint(bounds.maxX), maxWy = fromFixedPoint(bounds.maxY)

  const rootHalf = Math.sqrt((maxWx - minWx) ** 2 + (maxWy - minWy) ** 2) / 2
  const rootCx = (minWx + maxWx) / 2, rootCy = (minWy + maxWy) / 2

  interface HeapCell { cx: number; cy: number; half: number; potential: number }
  const heap: HeapCell[] = []

  function cellPotential(cx: number, cy: number, half: number): number {
    const cfx = Math.round(cx * FIXED_SCALE)
    const cfy = Math.round(cy * FIXED_SCALE)
    if (!Number.isSafeInteger(cfx) || !Number.isSafeInteger(cfy)) return -Infinity
    const sd = signedDistanceToPolygon(poly, cfx, cfy)
    // For outside cells, signed distance is negative; potential = sd + half*√2.
    // If sd + half*√2 <= threshold, the cell can never beat threshold.
    return sd + half * Math.SQRT2
  }

  function pushCell(cx: number, cy: number, half: number) {
    const pot = cellPotential(cx, cy, half)
    if (pot <= threshold) return  // cell can never exceed threshold
    // Prune entirely-outside cells where even the best possible point is outside.
    // If sd(center) < 0 and -sd(center) > half*√2, all points are outside.
    const cfx = Math.round(cx * FIXED_SCALE)
    const cfy = Math.round(cy * FIXED_SCALE)
    if (Number.isSafeInteger(cfx) && Number.isSafeInteger(cfy)) {
      const sd = signedDistanceToPolygon(poly, cfx, cfy)
      if (sd < 0 && -sd > half * Math.SQRT2) return  // entirely outside
    }
    heap.push({ cx, cy, half, potential: pot })
    // Bubble up for max-heap by potential
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[p].potential >= heap[i].potential) break
      ;[heap[p], heap[i]] = [heap[i], heap[p]]
      i = p
    }
  }

  function popCell(): HeapCell | undefined {
    if (heap.length === 0) return undefined
    const top = heap[0]
    const last = heap.pop()!
    if (heap.length > 0) {
      heap[0] = last
      let i = 0
      while (true) {
        let largest = i
        const l = 2 * i + 1, r = 2 * i + 2
        if (l < heap.length && heap[l].potential > heap[largest].potential) largest = l
        if (r < heap.length && heap[r].potential > heap[largest].potential) largest = r
        if (largest === i) break
        ;[heap[i], heap[largest]] = [heap[largest], heap[i]]
        i = largest
      }
    }
    return top
  }

  pushCell(rootCx, rootCy, rootHalf)

  while (heap.length > 0) {
    const cell = popCell()!
    // Check center
    const cfx = Math.round(cell.cx * FIXED_SCALE)
    const cfy = Math.round(cell.cy * FIXED_SCALE)
    if (Number.isSafeInteger(cfx) && Number.isSafeInteger(cfy)) {
      const sd = signedDistanceToPolygon(poly, cfx, cfy)
      if (sd > threshold) return true
    }

    // Stop at fixed-point resolution
    if (cell.half < 1 / (2 * FIXED_SCALE)) continue

    const half = cell.half / 2
    pushCell(cell.cx - cell.half / 2, cell.cy - cell.half / 2, half)
    pushCell(cell.cx + cell.half / 2, cell.cy - cell.half / 2, half)
    pushCell(cell.cx - cell.half / 2, cell.cy + cell.half / 2, half)
    pushCell(cell.cx + cell.half / 2, cell.cy + cell.half / 2, half)
  }

  return false
}

// ── Public erosion API ──

/** Returns true iff any point inside poly has signed distance > threshold.
 *  Uses B&B search with provable upper bound; works for arbitrary simple polygons. */
export function maxSignedDistanceGt(poly: FixedPolygon, threshold: number): boolean {
  return concaveMaxSignedDistanceGt(poly, threshold)
}

export function erodedInteriorNonEmpty(poly: FixedPolygon): boolean {
  if (isPolygonConvex(poly)) {
    return convexErodedInteriorNonEmpty(poly)
  }
  return concaveMaxSignedDistanceGt(poly, HYSTERESIS_WORLD_PX)
}
