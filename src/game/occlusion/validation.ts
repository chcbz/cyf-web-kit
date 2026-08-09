// ── E4 Polygon Validator ──
// Fail-closed validation for OcclusionConstraintZone polygons.
// Checks: unique points, degenerate edges, self-intersection, area,
// and 3px erosion non-empty interior.
// All geometric predicates use BigInt exact arithmetic.

import { type FixedPoint, type FixedPointVec, type FixedPolygon, type FixedBounds } from './polygonGeometry.js'
import {
  FIXED_SCALE,
  fromFixedPoint,
  polygonWorldArea,
  polygonAreaCompare,
  evenOddContainment,
  fixedPolygonBounds,
  maxSignedDistanceGt,
  bigOrient2d,
  toFixedPoint,
  assertFixedPoint,
} from './polygonGeometry.js'
import { renderSchemaError, type Point } from './schema.js'

// ── Validation error helpers ──

type PolygonFatalCode =
  | 'POLYGON_TOO_FEW_UNIQUE_POINTS'
  | 'POLYGON_DEGENERATE_EDGE'
  | 'POLYGON_SELF_INTERSECTING'
  | 'POLYGON_AREA_TOO_SMALL'
  | 'POLYGON_EROSION_EMPTY'

function fatalPolygon(
  code: PolygonFatalCode,
  sceneId: string,
  objectId: string,
  technicalMessage: string,
): never {
  const userMessages: Record<string, string> = {
    POLYGON_TOO_FEW_UNIQUE_POINTS: 'zone polygon 去重后唯一点少于 3 个。',
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

// ── BigInt helpers ──

function bigInt(v: number): bigint {
  return BigInt(v)
}

// ── Segment intersection (BigInt exact) ──

function onSegmentCollinear(
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
): boolean {
  return (
    bigInt(cx) >= (bigInt(ax) < bigInt(bx) ? bigInt(ax) : bigInt(bx)) &&
    bigInt(cx) <= (bigInt(ax) > bigInt(bx) ? bigInt(ax) : bigInt(bx)) &&
    bigInt(cy) >= (bigInt(ay) < bigInt(by) ? bigInt(ay) : bigInt(by)) &&
    bigInt(cy) <= (bigInt(ay) > bigInt(by) ? bigInt(ay) : bigInt(by))
  )
}

function segmentsIntersect(
  a1x: number, a1y: number, b1x: number, b1y: number,
  a2x: number, a2y: number, b2x: number, b2y: number,
): boolean {
  const o1 = bigOrient2d(a1x, a1y, b1x, b1y, a2x, a2y)
  const o2 = bigOrient2d(a1x, a1y, b1x, b1y, b2x, b2y)
  const o3 = bigOrient2d(a2x, a2y, b2x, b2y, a1x, a1y)
  const o4 = bigOrient2d(a2x, a2y, b2x, b2y, b1x, b1y)

  // General case: segments straddle each other
  if ((o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0)) return true

  // Collinear cases
  if (o1 === 0 && onSegmentCollinear(a1x, a1y, b1x, b1y, a2x, a2y)) return true
  if (o2 === 0 && onSegmentCollinear(a1x, a1y, b1x, b1y, b2x, b2y)) return true
  if (o3 === 0 && onSegmentCollinear(a2x, a2y, b2x, b2y, a1x, a1y)) return true
  if (o4 === 0 && onSegmentCollinear(a2x, a2y, b2x, b2y, b1x, b1y)) return true

  return false
}

// ── Deduplicate adjacent identical vertices after quantization ──
// When world points are quantized to fixed-point, adjacent points may merge.
// This must run AFTER compilation but BEFORE edge/self-intersection checks.

export function deduplicateAdjacentFixed(poly: FixedPolygon): FixedPolygon {
  if (poly.length === 0) return []
  const result: FixedPolygon = [poly[0]]
  for (let i = 1; i < poly.length; i++) {
    const prev = result[result.length - 1]
    if (prev.x === poly[i].x && prev.y === poly[i].y) continue
    result.push(poly[i])
  }
  // Also check if last matches first (closing duplicate)
  while (result.length >= 2) {
    const first = result[0]
    const last = result[result.length - 1]
    if (first.x === last.x && first.y === last.y) {
      result.pop()
    } else {
      break
    }
  }
  return result
}

// ── Degenerate edge check ──

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

function hasSelfIntersection(poly: FixedPolygon): boolean {
  const n = poly.length

  for (let i = 0; i < n; i++) {
    const iNext = (i + 1) % n
    const a1x = poly[i].x, a1y = poly[i].y
    const b1x = poly[iNext].x, b1y = poly[iNext].y

    for (let j = i + 2; j < n; j++) {
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

// ── Main validator ──

export function validateZonePolygon(
  rawPoly: FixedPolygon,
  sceneId: string,
  objectId: string,
): void {
  // 0. Ensure all coordinates are safe integers
  for (let i = 0; i < rawPoly.length; i++) {
    assertFixedPoint(rawPoly[i].x, sceneId, objectId, `polygon[${i}].x`)
    assertFixedPoint(rawPoly[i].y, sceneId, objectId, `polygon[${i}].y`)
  }

  // 1. Deduplicate adjacent identical vertices (post-quantization merge)
  const poly = deduplicateAdjacentFixed(rawPoly)

  // 2. At least 3 unique vertices
  if (poly.length < 3) {
    fatalPolygon(
      'POLYGON_TOO_FEW_UNIQUE_POINTS',
      sceneId,
      objectId,
      `zone polygon requires at least 3 unique vertices after dedup, got ${poly.length}`,
    )
  }

  // 3. No degenerate edges (adjacent duplicates or zero-length)
  const degenIdx = findDegenerateEdge(poly)
  if (degenIdx >= 0) {
    fatalPolygon(
      'POLYGON_DEGENERATE_EDGE',
      sceneId,
      objectId,
      `zone polygon has degenerate edge at index ${degenIdx} (vertices identical)`,
    )
  }

  // 4. No self-intersection (all predicates in BigInt)
  if (hasSelfIntersection(poly)) {
    fatalPolygon(
      'POLYGON_SELF_INTERSECTING',
      sceneId,
      objectId,
      `zone polygon has self-intersection`,
    )
  }

  // 5. Area >= 1 world px² (exact BigInt comparison; <1 fatal, ==1 OK)
  if (polygonAreaCompare(poly, 1) < 0) {
    fatalPolygon(
      'POLYGON_AREA_TOO_SMALL',
      sceneId,
      objectId,
      `zone polygon area is less than 1 world px²`,
    )
  }

  // 6. After 3px erosion, non-empty interior.
  // Uses branch-and-bound max-signed-distance search (correct for concave).
  if (!maxSignedDistanceGt(poly, HYSTERESIS_WORLD_PX)) {
    fatalPolygon(
      'POLYGON_EROSION_EMPTY',
      sceneId,
      objectId,
      `zone polygon has no point with signed distance > ${HYSTERESIS_WORLD_PX} (no non-empty interior after 3px erosion)`,
    )
  }
}

// ── Public API ──

const HYSTERESIS_WORLD_PX = 3

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

/** Convert a FixedPolygon back to world-coordinate Point array (quantized). */
export function fixedPolygonToWorldPoints(poly: FixedPolygon): Point[] {
  return poly.map(p => ({
    x: fromFixedPoint(p.x),
    y: fromFixedPoint(p.y),
  }))
}

export function validateAndCompilePolygon(
  worldPoints: Point[],
  sceneId: string,
  objectId: string,
): FixedPolygon {
  const fixed = compileFixedPolygon(worldPoints, sceneId, objectId)
  validateZonePolygon(fixed, sceneId, objectId)
  return fixed
}

// ── Full flow: world points → validate → canonical world points + bounds ──

export interface CanonicalPolygonResult {
  polygon: Point[]        // quantized world coords (fixed/256)
  bounds: { x: number; y: number; width: number; height: number }
}

export function validateAndCanonicalizePolygon(
  worldPoints: Point[],
  sceneId: string,
  objectId: string,
): CanonicalPolygonResult {
  const fixed = compileFixedPolygon(worldPoints, sceneId, objectId)
  validateZonePolygon(fixed, sceneId, objectId)

  // Build canonical polygon: quantized world coords from fixed
  const polygon = fixedPolygonToWorldPoints(fixed)

  // Compute bounds from canonical fixed polygon
  const fb = fixedPolygonBounds(fixed)
  const bounds = {
    x: fromFixedPoint(fb.minX),
    y: fromFixedPoint(fb.minY),
    width: fromFixedPoint(fb.maxX - fb.minX),
    height: fromFixedPoint(fb.maxY - fb.minY),
  }

  return { polygon, bounds }
}
