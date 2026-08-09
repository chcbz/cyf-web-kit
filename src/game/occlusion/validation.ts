// ── E4 Polygon Validator ──
// Fail-closed validation for OcclusionConstraintZone polygons.
// Checks: unique points, degenerate edges, self-intersection, area,
// and 3px erosion non-empty interior.

import { type FixedPoint, type FixedPolygon, type FixedBounds } from './polygonGeometry.js'
import {
  FIXED_SCALE,
  fromFixedPoint,
  polygonWorldArea,
  evenOddContainment,
  fixedPolygonBounds,
} from './polygonGeometry.js'
import { renderSchemaError, type Point } from './schema.js'

// ── Validation error helpers ──

function fatalPolygon(
  code: 'POLYGON_DEGENERATE_EDGE' | 'POLYGON_SELF_INTERSECTING' | 'POLYGON_AREA_TOO_SMALL' | 'POLYGON_EROSION_EMPTY',
  sceneId: string,
  objectId: string,
  technicalMessage: string,
): never {
  const userMessages: Record<string, string> = {
    POLYGON_DEGENERATE_EDGE: 'zone polygon 存在退化边（相邻重复点或零长度边）。',
    POLYGON_SELF_INTERSECTING: 'zone polygon 存在自相交（含共线重叠/T型接触/非相邻顶点触碰）。',
    POLYGON_AREA_TOO_SMALL: 'zone polygon 绝对面积小于 1 平方世界像素。',
    POLYGON_EROSION_EMPTY: 'zone polygon 经 3px erosion 后没有非空内部面积。',
  }
  throw renderSchemaError(
    code,
    sceneId,
    objectId,
    'polygon',
    userMessages[code],
    technicalMessage,
  )
}

// ── Segment intersection (exact integer arithmetic) ──

/**
 * Orientation of ordered triplet (ax,ay), (bx,by), (cx,cy).
 * >0: CCW, <0: CW, =0: collinear.
 */
function orient2d(
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
}

/**
 * Check if point (cx,cy) lies on closed segment (ax,ay)-(bx,by)
 * when the three points are already known to be collinear.
 */
function onSegmentCollinear(
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
): boolean {
  return (
    cx >= Math.min(ax, bx) && cx <= Math.max(ax, bx) &&
    cy >= Math.min(ay, by) && cy <= Math.max(ay, by)
  )
}

/**
 * Check if segments (a1)-(b1) and (a2)-(b2) intersect.
 * Returns true if they share any point (including endpoints and collinear overlap).
 * Uses exact integer arithmetic.
 */
function segmentsIntersect(
  a1x: number, a1y: number, b1x: number, b1y: number,
  a2x: number, a2y: number, b2x: number, b2y: number,
): boolean {
  const o1 = orient2d(a1x, a1y, b1x, b1y, a2x, a2y)
  const o2 = orient2d(a1x, a1y, b1x, b1y, b2x, b2y)
  const o3 = orient2d(a2x, a2y, b2x, b2y, a1x, a1y)
  const o4 = orient2d(a2x, a2y, b2x, b2y, b1x, b1y)

  // General case: segments straddle each other
  if ((o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0)) return true

  // Collinear cases
  if (o1 === 0 && onSegmentCollinear(a1x, a1y, b1x, b1y, a2x, a2y)) return true
  if (o2 === 0 && onSegmentCollinear(a1x, a1y, b1x, b1y, b2x, b2y)) return true
  if (o3 === 0 && onSegmentCollinear(a2x, a2y, b2x, b2y, a1x, a1y)) return true
  if (o4 === 0 && onSegmentCollinear(a2x, a2y, b2x, b2y, b1x, b1y)) return true

  return false
}

// ── Degenerate edge check ──

/**
 * Check for adjacent duplicate vertices (including consecutive zero-length edges).
 * Returns index of first degenerate edge, or -1 if none.
 */
function findDegenerateEdge(poly: FixedPolygon): number {
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    if (poly[i].x === poly[j].x && poly[i].y === poly[j].y) {
      return i
    }
  }
  return -1
}

// ── Self-intersection check ──

/**
 * Check for self-intersection: any non-adjacent edge pair that intersects,
 * including collinear overlap, T-junctions, and non-adjacent vertex touches.
 * Adjacent edges sharing a vertex are NOT considered self-intersecting.
 */
function hasSelfIntersection(poly: FixedPolygon): boolean {
  const n = poly.length

  for (let i = 0; i < n; i++) {
    const iNext = (i + 1) % n
    const a1x = poly[i].x, a1y = poly[i].y
    const b1x = poly[iNext].x, b1y = poly[iNext].y

    // Check against non-adjacent edges
    // j starts at i+2 to skip the adjacent edge at i+1
    // j ends before wrapping around to i-1 (which is adjacent to i)
    for (let j = i + 2; j < n; j++) {
      // Skip if j wraps to be adjacent to i (first and last edges are adjacent)
      if (i === 0 && j === n - 1) continue

      const jNext = (j + 1) % n
      const a2x = poly[j].x, a2y = poly[j].y
      const b2x = poly[jNext].x, b2y = poly[jNext].y

      if (segmentsIntersect(a1x, a1y, b1x, b1y, a2x, a2y, b2x, b2y)) {
        return true
      }
    }
  }

  return false
}

// ── Erosion check ──
//
// Compute whether the polygon, after Minkowski erosion by a disk of
// radius erosionWorldPx, has non-empty interior area.
//
// Approach: offset each edge inward by the erosion radius, then clip
// using Sutherland-Hodgman against each offset half-plane.
// Start with the polygon's AABB, clip inward against each offset edge.
// The result is the eroded polygon. Check its signed double area.

function erodedInteriorNonEmpty(
  poly: FixedPolygon,
  erosionWorldPx: number,
): boolean {
  const n = poly.length
  if (n < 3) return false

  // Orientation: we need inward normals
  const doubleArea = signedDoubleAreaFixed(poly)
  const isCCW = doubleArea > 0
  if (doubleArea === 0) return false

  // Convert polygon to world coordinates for edge normal computation
  const worldPts: { x: number; y: number }[] = poly.map(p => ({
    x: fromFixedPoint(p.x),
    y: fromFixedPoint(p.y),
  }))

  // Build offset half-plane for each edge
  // For an edge a→b with CCW orientation, the interior is to the left.
  // The inward normal is rotate(edge, -90°) / |edge| for CCW.
  // For CW, interior is to the right, inward normal is rotate(edge, +90°).
  interface HalfPlane {
    // Line equation: normal · point >= d  (points satisfying this are inside)
    nx: number // normal x (unit inward normal)
    ny: number // normal y
    d: number  // offset distance along normal
  }

  const halfPlanes: HalfPlane[] = []

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const ax = worldPts[i].x, ay = worldPts[i].y
    const bx = worldPts[j].x, by = worldPts[j].y

    const dx = bx - ax
    const dy = by - ay
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len === 0) continue // degenerate edge, skip

    // Unit edge direction
    const ex = dx / len
    const ey = dy / len

    // Inward normal: for CCW, interior is left of edge → normal = rotate(edge, -90°) = (ey, -ex)
    // For CW, interior is right of edge → normal = rotate(edge, +90°) = (-ey, ex)
    let nx: number, ny: number
    if (isCCW) {
      nx = ey
      ny = -ex
    } else {
      nx = -ey
      ny = ex
    }

    // The inward-offset half-plane: normal · p >= normal · a + erosion
    // (offset edge inward by erosion radius)
    const d = nx * ax + ny * ay + erosionWorldPx

    halfPlanes.push({ nx, ny, d })
  }

  if (halfPlanes.length < 3) return false

  // Start with the polygon's AABB expanded to ensure it covers the erosion
  const bounds = fixedPolygonBounds(poly)
  const wMinX = fromFixedPoint(bounds.minX)
  const wMinY = fromFixedPoint(bounds.minY)
  const wMaxX = fromFixedPoint(bounds.maxX)
  const wMaxY = fromFixedPoint(bounds.maxY)

  // Initial clip polygon: the original AABB (this is guaranteed to contain
  // the eroded polygon since erosion only shrinks)
  let clipPoly: { x: number; y: number }[] = [
    { x: wMinX, y: wMinY },
    { x: wMaxX, y: wMinY },
    { x: wMaxX, y: wMaxY },
    { x: wMinX, y: wMaxY },
  ]

  // Sutherland-Hodgman clipping against each half-plane
  for (const hp of halfPlanes) {
    if (clipPoly.length === 0) break

    const input = clipPoly
    clipPoly = []

    for (let i = 0; i < input.length; i++) {
      const j = (i + 1) % input.length
      const sx = input[i].x, sy = input[i].y
      const ex = input[j].x, ey = input[j].y

      const sInside = hp.nx * sx + hp.ny * sy >= hp.d - 1e-12
      const eInside = hp.nx * ex + hp.ny * ey >= hp.d - 1e-12

      if (sInside) {
        clipPoly.push({ x: sx, y: sy })
      }

      if (sInside !== eInside) {
        // Edge crosses the half-plane boundary, compute intersection
        const sVal = hp.nx * sx + hp.ny * sy
        const eVal = hp.nx * ex + hp.ny * ey
        const t = (hp.d - sVal) / (eVal - sVal)
        clipPoly.push({
          x: sx + t * (ex - sx),
          y: sy + t * (ey - sy),
        })
      }
    }
  }

  // Compute area of the clipped polygon (>0 means non-empty interior)
  if (clipPoly.length < 3) return false

  let area = 0
  for (let i = 0, j = clipPoly.length - 1; i < clipPoly.length; j = i++) {
    area += (clipPoly[j].x + clipPoly[i].x) * (clipPoly[j].y - clipPoly[i].y)
  }
  // Require a practical area threshold: at least 1e-6 world px²
  return Math.abs(area) / 2 > 1e-6
}

// ── Signed double area (fixed-point) ──

function signedDoubleAreaFixed(poly: FixedPolygon): number {
  let area = 0
  const n = poly.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    area += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y)
  }
  return area
}

// ── Main validator ──

/**
 * Validate an OcclusionConstraintZone polygon.
 * Checks:
 * 1. At least 3 unique vertices
 * 2. No adjacent duplicate / zero-length edges
 * 3. No self-intersection (including collinear overlap, T-junction, non-adjacent vertex touch)
 * 4. Absolute area >= 1 world px²
 * 5. After 3px erosion, non-empty interior area exists
 *
 * Throws structured RenderSchemaError on any failure.
 */
export function validateZonePolygon(
  poly: FixedPolygon,
  sceneId: string,
  objectId: string,
): void {
  const n = poly.length

  // 1. At least 3 vertices
  if (n < 3) {
    fatalPolygon(
      'POLYGON_SELF_INTERSECTING',
      sceneId,
      objectId,
      `zone polygon requires at least 3 vertices, got ${n}`,
    )
  }

  // 2. No degenerate edges
  const degenIdx = findDegenerateEdge(poly)
  if (degenIdx >= 0) {
    fatalPolygon(
      'POLYGON_DEGENERATE_EDGE',
      sceneId,
      objectId,
      `zone polygon has degenerate edge at index ${degenIdx} (vertices identical)`,
    )
  }

  // 3. No self-intersection
  if (hasSelfIntersection(poly)) {
    fatalPolygon(
      'POLYGON_SELF_INTERSECTING',
      sceneId,
      objectId,
      `zone polygon has self-intersection`,
    )
  }

  // 4. Area >= 1 world px² (contract: <1 fatal, ==1 legal)
  const area = polygonWorldArea(poly)
  if (area < 1) {
    fatalPolygon(
      'POLYGON_AREA_TOO_SMALL',
      sceneId,
      objectId,
      `zone polygon area ${area} is less than 1 world px²`,
    )
  }

  // 5. After 3px erosion, non-empty interior area
  if (!erodedInteriorNonEmpty(poly, 3)) {
    fatalPolygon(
      'POLYGON_EROSION_EMPTY',
      sceneId,
      objectId,
      `zone polygon has no non-empty interior after 3px erosion`,
    )
  }
}

// ── Public API: convert world points to fixed polygon ──

import { toFixedPoint } from './polygonGeometry.js'

export function compileFixedPolygon(
  worldPoints: Point[],
  sceneId: string,
  objectId: string,
): FixedPolygon {
  return worldPoints.map((p, i) => ({
    x: toFixedPoint(p.x, sceneId, objectId, `polygon[${i}].x`),
    y: toFixedPoint(p.y, sceneId, objectId, `polygon[${i}].y`),
  }))
}

// ── Full validation flow: world points → fixed → validate ──

export function validateAndCompilePolygon(
  worldPoints: Point[],
  sceneId: string,
  objectId: string,
): FixedPolygon {
  // Step 1: Convert to fixed-point (throws on non-finite/overflow)
  const fixed = compileFixedPolygon(worldPoints, sceneId, objectId)

  // Step 2: Validate (throws on geometric issues)
  validateZonePolygon(fixed, sceneId, objectId)

  return fixed
}
