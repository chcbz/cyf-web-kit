// ── E4 Polygon Geometry Tests ──
// Covers: fixed-point conversion, even-odd containment, signed distance,
// hysteresis, AABB, bounds.

import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import {
  FIXED_SCALE,
  toFixedPoint,
  fromFixedPoint,
  evenOddContainment,
  signedDistanceToPolygon,
  computeHysteresis,
  fixedPolygonBounds,
  aabbContains,
  polygonWorldArea,
  polygonOrientation,
  type FixedPoint,
  type FixedPolygon,
} from '../../../src/game/occlusion/polygonGeometry.js'
import { isStructuredFatalRenderSchemaError } from '../../../src/game/occlusion/schema.js'

// ── Helpers ──

function fixedPoly(...coords: number[]): FixedPolygon {
  // coords: [x0, y0, x1, y1, ...]
  const result: FixedPolygon = []
  for (let i = 0; i < coords.length; i += 2) {
    result.push({ x: coords[i], y: coords[i + 1] })
  }
  return result
}

const SCENE = 'test-scene'
const OBJ = 'test-obj'

// ── Fixed-point conversion ──

describe('FixedPoint conversion', () => {
  it('converts simple world coords to fixed', () => {
    assert.equal(toFixedPoint(0, SCENE, OBJ, 'x'), 0)
    assert.equal(toFixedPoint(1, SCENE, OBJ, 'x'), 256)
    assert.equal(toFixedPoint(0.5, SCENE, OBJ, 'x'), 128)
    assert.equal(toFixedPoint(1.5, SCENE, OBJ, 'x'), 384)
  })

  it('rounds ties: 0.5 rounds up, test at boundaries', () => {
    // Math.round: 0.5 → 1, -0.5 → -0 (then normalized to 0)
    assert.equal(toFixedPoint(0.5 / 256, SCENE, OBJ, 'x'), 1)  // 0.5 rounds to 1? No, Math.round(0.001953125) = 0
    // Actually let's use values at 1/256 boundary
    assert.equal(toFixedPoint(0.5, SCENE, OBJ, 'x'), 128) // 0.5 * 256 = 128 exactly
    // Test tie at 0.5/256 boundary: 1.5/256 = 0.005859375
    // Math.round(1.5) = 2
    assert.equal(toFixedPoint(1.5 / 256, SCENE, OBJ, 'x'), 2)
  })

  it('handles negative zero', () => {
    const result = toFixedPoint(0, SCENE, OBJ, 'x')
    assert.equal(result, 0)
    assert.equal(Object.is(result, -0), false)
  })

  it('handles negative values', () => {
    assert.equal(toFixedPoint(-1, SCENE, OBJ, 'x'), -256)
    assert.equal(toFixedPoint(-0.5, SCENE, OBJ, 'x'), -128)
  })

  it('fatal on non-finite', () => {
    for (const val of [NaN, Infinity, -Infinity]) {
      try {
        toFixedPoint(val, SCENE, OBJ, 'x')
        assert.fail(`expected fatal for ${val}`)
      } catch (e) {
        assert.ok(isStructuredFatalRenderSchemaError(e))
        assert.equal((e as any).errorCode, 'POLYGON_NON_FINITE')
      }
    }
  })

  it('fatal on overflow beyond safe integer', () => {
    try {
      toFixedPoint(1e15, SCENE, OBJ, 'x')
      assert.fail('expected fatal')
    } catch (e) {
      assert.ok(isStructuredFatalRenderSchemaError(e))
      assert.equal((e as any).errorCode, 'POLYGON_FIXED_OVERFLOW')
    }
  })

  it('fromFixedPoint round-trips', () => {
    for (const w of [0, 1, -1, 0.5, -0.5, 3.14159, 100.25]) {
      const fp = toFixedPoint(w, SCENE, OBJ, 'x')
      const back = fromFixedPoint(fp)
      // Should be within 1/512 of original (half a fixed unit)
      assert.ok(Math.abs(back - w) <= 1 / 512 + 1e-12, `${w} → ${fp} → ${back}`)
    }
  })

  it('same world → same fixed (determinism)', () => {
    const a = toFixedPoint(1.234, SCENE, OBJ, 'x')
    const b = toFixedPoint(1.234, SCENE, OBJ, 'x')
    assert.equal(a, b)
  })
})

// ── Even-odd containment ──

describe('Even-odd containment', () => {
  // Unit square at (0,0)-(256,256) in fixed coords = (0,0)-(1,1) world
  const square: FixedPolygon = fixedPoly(0, 0, 256, 0, 256, 256, 0, 256)

  it('inside point', () => {
    assert.ok(evenOddContainment(square, 128, 128))
  })

  it('outside point', () => {
    assert.equal(evenOddContainment(square, -1, 128), false)
    assert.equal(evenOddContainment(square, 300, 128), false)
    assert.equal(evenOddContainment(square, 128, 300), false)
    assert.equal(evenOddContainment(square, 128, -1), false)
  })

  it('vertex point is on boundary (ray cast may give either result)', () => {
    // Vertex points are on boundary; even-odd may return either.
    // For signed distance, boundary is detected by distance check.
    const result = evenOddContainment(square, 0, 0)
    assert.ok(typeof result === 'boolean')
  })

  it('concave polygon', () => {
    // Concave "L" shape in fixed coords (10x10 world = 2560x2560 fixed)
    const L: FixedPolygon = fixedPoly(0, 0, 2560, 0, 2560, 1280, 1280, 1280, 1280, 2560, 0, 2560)
    // Inside the "foot" of the L
    assert.ok(evenOddContainment(L, 640, 1920))
    // In the notch (outside polygon)
    assert.equal(evenOddContainment(L, 1920, 1920), false)
  })

  it('convex polygon CW orientation', () => {
    // Same square but CW order
    const cwSquare: FixedPolygon = fixedPoly(0, 0, 0, 256, 256, 256, 256, 0)
    assert.ok(evenOddContainment(cwSquare, 128, 128))
    assert.equal(evenOddContainment(cwSquare, 300, 128), false)
  })

  it('point in AABB but outside polygon', () => {
    // Triangle from (0,0) to (512,0) to (256,512)
    const tri: FixedPolygon = fixedPoly(0, 0, 512, 0, 256, 512)
    // In AABB but outside triangle
    assert.equal(evenOddContainment(tri, 0, 256), false) // left of triangle
    assert.equal(evenOddContainment(tri, 512, 256), false) // right of triangle
    // Inside
    assert.ok(evenOddContainment(tri, 256, 128))
  })
})

// ── Signed distance ──

describe('Signed distance to polygon', () => {
  // 3-4-5 triangle in world coords: (0,0)-(4,0)-(0,3)
  const tri4: FixedPolygon = fixedPoly(
    0, 0,
    toFixedPoint(4, SCENE, OBJ, 'x'), 0,
    0, toFixedPoint(3, SCENE, OBJ, 'y'),
  )

  it('inside returns positive distance', () => {
    // Point (1,1) inside 3-4-5 triangle
    const fx = toFixedPoint(1, SCENE, OBJ, 'x')
    const fy = toFixedPoint(1, SCENE, OBJ, 'y')
    const sd = signedDistanceToPolygon(tri4, fx, fy)
    assert.ok(sd > 0, `expected positive, got ${sd}`)
    // Distance to nearest edge (hypotenuse): point to line from (0,3) to (4,0)
    // Line: 3x + 4y - 12 = 0, distance = |3*1 + 4*1 - 12| / 5 = 5/5 = 1
    assert.ok(Math.abs(sd - 1) < 0.01, `expected ~1, got ${sd}`)
  })

  it('outside returns negative distance', () => {
    const fx = toFixedPoint(-1, SCENE, OBJ, 'x')
    const fy = toFixedPoint(-1, SCENE, OBJ, 'y')
    const sd = signedDistanceToPolygon(tri4, fx, fy)
    assert.ok(sd < 0, `expected negative, got ${sd}`)
    // Distance to nearest edge (vertical leg from (0,0) to (0,3))
    // Point (-1,-1) closest to (0,0): distance = sqrt(1+1) ≈ 1.414
    assert.ok(Math.abs(sd + 1.414) < 0.01 || Math.abs(sd + Math.SQRT2) < 0.01, `got ${sd}`)
  })

  it('boundary returns zero', () => {
    // Point exactly on edge: (2,0) is on the base
    const fx = toFixedPoint(2, SCENE, OBJ, 'x')
    const fy = toFixedPoint(0, SCENE, OBJ, 'y')
    const sd = signedDistanceToPolygon(tri4, fx, fy)
    assert.ok(Math.abs(sd) < 1e-6, `expected ~0, got ${sd}`)
  })

  it('vertex returns zero', () => {
    const fx = toFixedPoint(0, SCENE, OBJ, 'x')
    const fy = toFixedPoint(0, SCENE, OBJ, 'y')
    const sd = signedDistanceToPolygon(tri4, fx, fy)
    assert.ok(Math.abs(sd) < 1e-6, `expected ~0, got ${sd}`)
  })

  it('distance to segment interior vs endpoint', () => {
    // Horizontal segment from (0,0) to (10,0) with vertices at (10,0)-(10,10)-(0,10)
    const sq: FixedPolygon = fixedPoly(0, 0, 2560, 0, 2560, 2560, 0, 2560)
    // Point below segment interior: (5, -2) world
    const fx = toFixedPoint(5, SCENE, OBJ, 'x')
    const fy = toFixedPoint(-2, SCENE, OBJ, 'y')
    const sd = signedDistanceToPolygon(sq, fx, fy)
    // Distance should be 2 (perpendicular to bottom edge)
    assert.ok(Math.abs(Math.abs(sd) - 2) < 0.01, `expected ~2, got ${sd}`)
  })

  it('point near segment endpoint uses endpoint distance', () => {
    // Square as above, point at (12, -5) - closest to corner (10,0)
    const sq: FixedPolygon = fixedPoly(0, 0, 2560, 0, 2560, 2560, 0, 2560)
    const fx = toFixedPoint(12, SCENE, OBJ, 'x')
    const fy = toFixedPoint(-5, SCENE, OBJ, 'y')
    const sd = signedDistanceToPolygon(sq, fx, fy)
    // Distance to (10,0): sqrt(2^2 + 5^2) = sqrt(29) ≈ 5.385
    assert.ok(Math.abs(Math.abs(sd) - Math.sqrt(29)) < 0.01, `expected ~${Math.sqrt(29)}, got ${sd}`)
  })

  it('concave polygon signed distance uses segment min', () => {
    // L-shape; point in the notch
    const L: FixedPolygon = fixedPoly(0, 0, 2560, 0, 2560, 1280, 1280, 1280, 1280, 2560, 0, 2560)
    // Point (1920, 1920) in notch = outside
    const fx = 1920
    const fy = 1920
    const sd = signedDistanceToPolygon(L, fx, fy)
    assert.ok(sd < 0, `expected negative, got ${sd}`)
  })
})

// ── Hysteresis ──
//
// Hysteresis contract:
//   signed distance = +d inside, 0 boundary, -d outside
//   initial: sd >= 0 → inside, sd < 0 → outside
//   previous outside: switch to inside only if sd >= +3
//   previous inside:  switch to outside only if sd <= -3
//   at exactly +/-3: switch

describe('Hysteresis (3px)', () => {
  // Large square: 100x100 world = 25600x25600 fixed at (0,0)-(25600,25600)
  const sq: FixedPolygon = fixedPoly(0, 0, 25600, 0, 25600, 25600, 0, 25600)

  it('initial sample: boundary (sd=0) → inside', () => {
    const result = computeHysteresis(sq, 0, 12800, null)
    assert.equal(result.inside, true)
    assert.ok(Math.abs(result.signedDistance) < 1e-6)
  })

  it('initial sample: clearly inside → inside', () => {
    const result = computeHysteresis(sq, 12800, 12800, null)
    assert.equal(result.inside, true)
    assert.ok(result.signedDistance > 0)
  })

  it('initial sample: clearly outside → outside', () => {
    const result = computeHysteresis(sq, -1, 12800, null)
    assert.equal(result.inside, false)
    assert.ok(result.signedDistance < 0)
  })

  it('previous=outside, sd≈2.988 (<3) → stay outside', () => {
    // Point 2.988px inside from bottom edge: sd ≈ +2.988 < 3
    const fy = Math.round(2.98828125 * 256) // y=2.98828125 → inside, sd≈2.988
    const result = computeHysteresis(sq, 12800, fy, false)
    assert.equal(result.inside, false)
    assert.ok(result.signedDistance < 3)
  })

  it('previous=outside, sd=3.0 → switch to inside', () => {
    // Point 3px inside from bottom edge: sd = +3
    const fy = Math.round(3 * 256)
    const result = computeHysteresis(sq, 12800, fy, false)
    assert.equal(result.inside, true)
    assert.ok(result.signedDistance >= 3)
  })

  it('previous=outside, sd≈3.004 (>3) → switch to inside', () => {
    const fy = Math.round(3.00390625 * 256)
    const result = computeHysteresis(sq, 12800, fy, false)
    assert.equal(result.inside, true)
    assert.ok(result.signedDistance > 3)
  })

  it('previous=inside, sd≈-2.988 (>-3) → stay inside', () => {
    // Point 2.988px outside from bottom edge: sd ≈ -2.988 > -3
    const fy = Math.round(-2.98828125 * 256)
    const result = computeHysteresis(sq, 12800, fy, true)
    assert.equal(result.inside, true)
    assert.ok(result.signedDistance > -3)
  })

  it('previous=inside, sd=-3.0 → switch to outside', () => {
    const fy = Math.round(-3 * 256)
    const result = computeHysteresis(sq, 12800, fy, true)
    assert.equal(result.inside, false)
    assert.ok(result.signedDistance <= -3)
  })

  it('previous=inside, sd≈-3.004 (<-3) → switch to outside', () => {
    const fy = Math.round(-3.00390625 * 256)
    const result = computeHysteresis(sq, 12800, fy, true)
    assert.equal(result.inside, false)
    assert.ok(result.signedDistance < -3)
  })

  it('stays outside when deep outside', () => {
    const result = computeHysteresis(sq, -50000, 12800, false)
    assert.equal(result.inside, false)
  })

  it('stays inside when deep inside', () => {
    const result = computeHysteresis(sq, 12800, 12800, true)
    assert.equal(result.inside, true)
  })
})

// ── AABB / Bounds ──

describe('AABB / bounds', () => {
  const poly: FixedPolygon = fixedPoly(-100, 0, 100, 0, 100, 200, -100, 200)

  it('computes bounds correctly', () => {
    const b = fixedPolygonBounds(poly)
    assert.equal(b.minX, -100)
    assert.equal(b.maxX, 100)
    assert.equal(b.minY, 0)
    assert.equal(b.maxY, 200)
  })

  it('AABB contains interior point', () => {
    const b = fixedPolygonBounds(poly)
    assert.ok(aabbContains(b, 0, 100))
  })

  it('AABB excludes exterior point', () => {
    const b = fixedPolygonBounds(poly)
    assert.equal(aabbContains(b, -200, 100), false)
    assert.equal(aabbContains(b, 200, 100), false)
    assert.equal(aabbContains(b, 0, -50), false)
    assert.equal(aabbContains(b, 0, 300), false)
  })

  it('AABB boundary points are contained', () => {
    const b = fixedPolygonBounds(poly)
    assert.ok(aabbContains(b, -100, 0))
    assert.ok(aabbContains(b, 100, 200))
  })
})

// ── Area / Orientation ──

describe('Area and orientation', () => {
  it('unit square area ≈ 1 world px²', () => {
    const sq: FixedPolygon = fixedPoly(0, 0, 256, 0, 256, 256, 0, 256)
    assert.ok(Math.abs(polygonWorldArea(sq) - 1) < 0.001)
  })

  it('orientation is non-zero for non-degenerate polygon', () => {
    const ccw: FixedPolygon = fixedPoly(0, 0, 256, 0, 256, 256, 0, 256)
    const cw: FixedPolygon = fixedPoly(0, 0, 0, 256, 256, 256, 256, 0)
    // Both should have non-zero area; signs opposite
    assert.ok(polygonOrientation(ccw) !== 0)
    assert.ok(polygonOrientation(cw) !== 0)
    assert.ok(polygonOrientation(ccw) !== polygonOrientation(cw))
  })

  it('area of 3-4-5 triangle = 6 world px²', () => {
    const tri: FixedPolygon = fixedPoly(
      0, 0,
      toFixedPoint(4, SCENE, OBJ, 'x'), 0,
      0, toFixedPoint(3, SCENE, OBJ, 'y'),
    )
    assert.ok(Math.abs(polygonWorldArea(tri) - 6) < 0.01)
  })
})
