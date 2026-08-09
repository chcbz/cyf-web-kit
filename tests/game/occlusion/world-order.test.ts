// ── E5 World Order Tests ──
// Covers: sort key computation, full-key comparison, ASCII byte order,
// validation, determinism, base order output.

import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import {
  computeWorldSortKey,
  compareWorldSortKeys,
  baseOrderSort,
  computeAllWorldSortKeys,
  worldSortKeyToString,
  parseWorldSortKeyString,
  type WorldSortKey,
} from '../../../src/game/occlusion/worldOrder.js'
import {
  type SceneObject,
  DEFAULT_FLOOR_REGISTRY,
  RENDER_BAND_ORDER,
  isStructuredFatalRenderSchemaError,
} from '../../../src/game/occlusion/schema.js'

// ── Helpers ──

function makeObj(overrides: Partial<SceneObject> = {}): SceneObject {
  return {
    stableId: 'tst.obj.default.v1',
    sceneId: 'test-scene',
    chunkId: 'chunk-1',
    kind: 'prop',
    renderBand: 'world',
    floorId: 'floor-1',
    elevation: 0,
    sortMode: 'fixed',
    sortAnchor: { x: 100, y: 200 },
    tieBias: 0,
    ...overrides,
  }
}

function assertFatal(fn: () => void, expectedCode: string): void {
  try {
    fn()
    assert.fail(`expected fatal with code ${expectedCode}`)
  } catch (err) {
    assert.ok(isStructuredFatalRenderSchemaError(err), `expected RenderSchemaError, got ${String(err)}`)
    if (isStructuredFatalRenderSchemaError(err)) {
      assert.equal(err.errorCode, expectedCode, `expected ${expectedCode}, got ${err.errorCode}: ${err.technicalMessage}`)
    }
  }
}

// ── Key computation ──

describe('WorldSortKey - computation', () => {
  it('computes key for a world-band prop with defaults', () => {
    const key = computeWorldSortKey(makeObj(), DEFAULT_FLOOR_REGISTRY)
    assert.equal(key.renderBandOrder, 100)
    assert.equal(key.floorOrder, 0)
    assert.equal(key.elevation, 0)
    assert.equal(key.fixedPointY, Math.round(200 * 256)) // 51200
    assert.equal(key.tieBias, 0)
    assert.equal(key.stableId, 'tst.obj.default.v1')
  })

  it('computes key for background band', () => {
    const key = computeWorldSortKey(makeObj({ renderBand: 'background' }), DEFAULT_FLOOR_REGISTRY)
    assert.equal(key.renderBandOrder, 0)
  })

  it('computes key for overhead band', () => {
    const key = computeWorldSortKey(makeObj({ renderBand: 'overhead' }), DEFAULT_FLOOR_REGISTRY)
    assert.equal(key.renderBandOrder, 200)
  })

  it('computes key for lighting band', () => {
    const key = computeWorldSortKey(makeObj({ renderBand: 'lighting' }), DEFAULT_FLOOR_REGISTRY)
    assert.equal(key.renderBandOrder, 300)
  })

  it('computes key for world-ui band', () => {
    const key = computeWorldSortKey(makeObj({ renderBand: 'world-ui' }), DEFAULT_FLOOR_REGISTRY)
    assert.equal(key.renderBandOrder, 400)
  })

  it('computes key for screen-ui band', () => {
    const key = computeWorldSortKey(makeObj({ renderBand: 'screen-ui' }), DEFAULT_FLOOR_REGISTRY)
    assert.equal(key.renderBandOrder, 500)
  })

  it('computes fixedPointY correctly for various Y values', () => {
    const cases: Array<[number, number]> = [
      [0, 0],
      [100, 25600],
      [200.5, 51328], // round(200.5 * 256) = round(51328.0) = 51328
      [-10, -2560],
      [0.001, 0], // round(0.256) = 0
      [0.002, 1], // round(0.512) = 1
      [-0.001, 0], // round(-0.256) = 0
      [-0.002, -1], // round(-0.512) = -1
    ]
    for (const [y, expected] of cases) {
      const key = computeWorldSortKey(makeObj({ sortAnchor: { x: 0, y } }), DEFAULT_FLOOR_REGISTRY)
      assert.equal(key.fixedPointY, expected, `y=${y} → fixedPointY=${key.fixedPointY}, expected=${expected}`)
    }
  })

  it('normalizes -0 to 0 in fixedPointY', () => {
    // round(-0.001 * 256) = round(-0.256) = 0 but could be -0
    const key = computeWorldSortKey(makeObj({ sortAnchor: { x: 0, y: -0.0001 } }), DEFAULT_FLOOR_REGISTRY)
    assert.equal(key.fixedPointY, 0)
    assert.ok(Object.is(key.fixedPointY, 0))
    assert.ok(!Object.is(key.fixedPointY, -0))
  })

  it('computes elevation from object', () => {
    const key = computeWorldSortKey(makeObj({ elevation: 5 }), DEFAULT_FLOOR_REGISTRY)
    assert.equal(key.elevation, 5)
  })

  it('computes tieBias from object', () => {
    const key = computeWorldSortKey(makeObj({ tieBias: 10 }), DEFAULT_FLOOR_REGISTRY)
    assert.equal(key.tieBias, 10)
  })

  it('uses negative elevation', () => {
    const key = computeWorldSortKey(makeObj({ elevation: -3 }), DEFAULT_FLOOR_REGISTRY)
    assert.equal(key.elevation, -3)
  })
})

// ── Key validation ──

describe('WorldSortKey - validation', () => {
  it('rejects unknown renderBand', () => {
    assertFatal(
      () => computeWorldSortKey(makeObj({ renderBand: 'unknown' as any }), DEFAULT_FLOOR_REGISTRY),
      'RENDER_BAND_INVALID',
    )
  })

  it('rejects unknown floorId', () => {
    assertFatal(
      () => computeWorldSortKey(makeObj({ floorId: 'floor-99' }), DEFAULT_FLOOR_REGISTRY),
      'FLOOR_ID_UNKNOWN',
    )
  })

  it('rejects non-integer elevation', () => {
    assertFatal(
      () => computeWorldSortKey(makeObj({ elevation: 1.5 }), DEFAULT_FLOOR_REGISTRY),
      'ELEVATION_INVALID',
    )
  })

  it('rejects NaN elevation', () => {
    assertFatal(
      () => computeWorldSortKey(makeObj({ elevation: NaN }), DEFAULT_FLOOR_REGISTRY),
      'ELEVATION_INVALID',
    )
  })

  it('rejects Infinity elevation', () => {
    assertFatal(
      () => computeWorldSortKey(makeObj({ elevation: Infinity }), DEFAULT_FLOOR_REGISTRY),
      'ELEVATION_INVALID',
    )
  })

  it('rejects non-safe-integer elevation', () => {
    assertFatal(
      () => computeWorldSortKey(makeObj({ elevation: Number.MAX_SAFE_INTEGER + 1 }), DEFAULT_FLOOR_REGISTRY),
      'ELEVATION_INVALID',
    )
  })

  it('rejects missing sortAnchor', () => {
    assertFatal(
      () => computeWorldSortKey(makeObj({ sortAnchor: undefined as any }), DEFAULT_FLOOR_REGISTRY),
      'SORT_ANCHOR_INVALID',
    )
  })

  it('rejects NaN sortAnchor.y', () => {
    assertFatal(
      () => computeWorldSortKey(makeObj({ sortAnchor: { x: 0, y: NaN } }), DEFAULT_FLOOR_REGISTRY),
      'SORT_ANCHOR_INVALID',
    )
  })

  it('rejects Infinity sortAnchor.y', () => {
    assertFatal(
      () => computeWorldSortKey(makeObj({ sortAnchor: { x: 0, y: Infinity } }), DEFAULT_FLOOR_REGISTRY),
      'SORT_ANCHOR_INVALID',
    )
  })

  it('rejects tieBias below -32', () => {
    assertFatal(
      () => computeWorldSortKey(makeObj({ tieBias: -33 }), DEFAULT_FLOOR_REGISTRY),
      'TIE_BIAS_OUT_OF_RANGE',
    )
  })

  it('rejects tieBias above 32', () => {
    assertFatal(
      () => computeWorldSortKey(makeObj({ tieBias: 33 }), DEFAULT_FLOOR_REGISTRY),
      'TIE_BIAS_OUT_OF_RANGE',
    )
  })

  it('rejects non-integer tieBias', () => {
    assertFatal(
      () => computeWorldSortKey(makeObj({ tieBias: 1.5 }), DEFAULT_FLOOR_REGISTRY),
      'TIE_BIAS_OUT_OF_RANGE',
    )
  })

  it('accepts tieBias at -32 boundary', () => {
    const key = computeWorldSortKey(makeObj({ tieBias: -32 }), DEFAULT_FLOOR_REGISTRY)
    assert.equal(key.tieBias, -32)
  })

  it('accepts tieBias at 32 boundary', () => {
    const key = computeWorldSortKey(makeObj({ tieBias: 32 }), DEFAULT_FLOOR_REGISTRY)
    assert.equal(key.tieBias, 32)
  })

  it('rejects invalid stableId pattern', () => {
    assertFatal(
      () => computeWorldSortKey(makeObj({ stableId: 'INVALID' }), DEFAULT_FLOOR_REGISTRY),
      'STABLE_ID_INVALID_PATTERN',
    )
  })

  it('rejects uppercase stableId', () => {
    assertFatal(
      () => computeWorldSortKey(makeObj({ stableId: 'A.test.v1' }), DEFAULT_FLOOR_REGISTRY),
      'STABLE_ID_INVALID_PATTERN',
    )
  })

  it('rejects empty stableId', () => {
    assertFatal(
      () => computeWorldSortKey(makeObj({ stableId: '' }), DEFAULT_FLOOR_REGISTRY),
      'STABLE_ID_INVALID_PATTERN',
    )
  })
})

// ── Comparison ──

describe('WorldSortKey - comparison', () => {
  it('compares by renderBandOrder first', () => {
    const a: WorldSortKey = { renderBandOrder: 0, floorOrder: 0, elevation: 0, fixedPointY: 0, tieBias: 0, stableId: 'a' }
    const b: WorldSortKey = { renderBandOrder: 100, floorOrder: 0, elevation: 0, fixedPointY: 0, tieBias: 0, stableId: 'a' }
    assert.equal(compareWorldSortKeys(a, b), -1)
    assert.equal(compareWorldSortKeys(b, a), 1)
  })

  it('compares by floorOrder second', () => {
    const a: WorldSortKey = { renderBandOrder: 100, floorOrder: 0, elevation: 0, fixedPointY: 0, tieBias: 0, stableId: 'a' }
    const b: WorldSortKey = { renderBandOrder: 100, floorOrder: 1, elevation: 0, fixedPointY: 0, tieBias: 0, stableId: 'a' }
    assert.equal(compareWorldSortKeys(a, b), -1)
  })

  it('compares by elevation third', () => {
    const a: WorldSortKey = { renderBandOrder: 100, floorOrder: 0, elevation: -5, fixedPointY: 0, tieBias: 0, stableId: 'a' }
    const b: WorldSortKey = { renderBandOrder: 100, floorOrder: 0, elevation: 0, fixedPointY: 0, tieBias: 0, stableId: 'a' }
    assert.equal(compareWorldSortKeys(a, b), -1)
  })

  it('compares negative elevation correctly', () => {
    // -10 < -5
    const a: WorldSortKey = { renderBandOrder: 100, floorOrder: 0, elevation: -10, fixedPointY: 0, tieBias: 0, stableId: 'a' }
    const b: WorldSortKey = { renderBandOrder: 100, floorOrder: 0, elevation: -5, fixedPointY: 0, tieBias: 0, stableId: 'a' }
    assert.equal(compareWorldSortKeys(a, b), -1)
  })

  it('compares by fixedPointY fourth', () => {
    const a: WorldSortKey = { renderBandOrder: 100, floorOrder: 0, elevation: 0, fixedPointY: 100, tieBias: 0, stableId: 'a' }
    const b: WorldSortKey = { renderBandOrder: 100, floorOrder: 0, elevation: 0, fixedPointY: 200, tieBias: 0, stableId: 'a' }
    assert.equal(compareWorldSortKeys(a, b), -1)
  })

  it('compares negative fixedPointY correctly', () => {
    // -100 < -50
    const a: WorldSortKey = { renderBandOrder: 100, floorOrder: 0, elevation: 0, fixedPointY: -100, tieBias: 0, stableId: 'a' }
    const b: WorldSortKey = { renderBandOrder: 100, floorOrder: 0, elevation: 0, fixedPointY: -50, tieBias: 0, stableId: 'a' }
    assert.equal(compareWorldSortKeys(a, b), -1)
  })

  it('compares by tieBias fifth (only when first 4 equal)', () => {
    const a: WorldSortKey = { renderBandOrder: 100, floorOrder: 0, elevation: 0, fixedPointY: 100, tieBias: -5, stableId: 'a' }
    const b: WorldSortKey = { renderBandOrder: 100, floorOrder: 0, elevation: 0, fixedPointY: 100, tieBias: 5, stableId: 'a' }
    assert.equal(compareWorldSortKeys(a, b), -1)
  })

  it('tieBias does not override earlier differences', () => {
    // a has lower fixedPointY (higher priority), even though b has lower tieBias
    const a: WorldSortKey = { renderBandOrder: 100, floorOrder: 0, elevation: 0, fixedPointY: 100, tieBias: 32, stableId: 'a' }
    const b: WorldSortKey = { renderBandOrder: 100, floorOrder: 0, elevation: 0, fixedPointY: 200, tieBias: -32, stableId: 'a' }
    assert.equal(compareWorldSortKeys(a, b), -1)
  })

  it('compares by stableId ASCII byte order last', () => {
    const a: WorldSortKey = { renderBandOrder: 100, floorOrder: 0, elevation: 0, fixedPointY: 0, tieBias: 0, stableId: 'a.v1' }
    const b: WorldSortKey = { renderBandOrder: 100, floorOrder: 0, elevation: 0, fixedPointY: 0, tieBias: 0, stableId: 'b.v1' }
    assert.equal(compareWorldSortKeys(a, b), -1)
  })

  it('ASCII comparison: A (65) < Z (90) < a (97) < z (122)', () => {
    // Note: stableId pattern only allows lowercase, but the comparison uses ASCII
    // Let's test with valid lowercase: 'a' < 'z'
    const a: WorldSortKey = { renderBandOrder: 0, floorOrder: 0, elevation: 0, fixedPointY: 0, tieBias: 0, stableId: 'aaa.v1' }
    const b: WorldSortKey = { renderBandOrder: 0, floorOrder: 0, elevation: 0, fixedPointY: 0, tieBias: 0, stableId: 'zzz.v1' }
    assert.equal(compareWorldSortKeys(a, b), -1)
  })

  it('ASCII comparison: digit < letter', () => {
    // '0' (48) < 'a' (97)
    const a: WorldSortKey = { renderBandOrder: 0, floorOrder: 0, elevation: 0, fixedPointY: 0, tieBias: 0, stableId: '0aa.v1' }
    const b: WorldSortKey = { renderBandOrder: 0, floorOrder: 0, elevation: 0, fixedPointY: 0, tieBias: 0, stableId: 'aaa.v1' }
    assert.equal(compareWorldSortKeys(a, b), -1)
  })

  it('ASCII comparison: shorter prefix sorts first', () => {
    // 'a' < 'aa'
    const a: WorldSortKey = { renderBandOrder: 0, floorOrder: 0, elevation: 0, fixedPointY: 0, tieBias: 0, stableId: 'a.v1' }
    const b: WorldSortKey = { renderBandOrder: 0, floorOrder: 0, elevation: 0, fixedPointY: 0, tieBias: 0, stableId: 'aa.v1' }
    assert.equal(compareWorldSortKeys(a, b), -1)
  })

  it('returns 0 for identical keys', () => {
    const a: WorldSortKey = { renderBandOrder: 100, floorOrder: 0, elevation: 0, fixedPointY: 51200, tieBias: 0, stableId: 'tst.x.v1' }
    const b: WorldSortKey = { ...a }
    assert.equal(compareWorldSortKeys(a, b), 0)
  })

  it('is deterministic: same inputs → same comparison result', () => {
    const a: WorldSortKey = { renderBandOrder: 100, floorOrder: 0, elevation: 1, fixedPointY: 25600, tieBias: -2, stableId: 'tst.c.v1' }
    const b: WorldSortKey = { renderBandOrder: 100, floorOrder: 0, elevation: 2, fixedPointY: 25600, tieBias: -2, stableId: 'tst.d.v1' }
    for (let i = 0; i < 100; i++) {
      assert.equal(compareWorldSortKeys(a, b), -1, `determinism check failed at iteration ${i}`)
    }
  })
})

// ── Base order sort ──

describe('WorldSortKey - baseOrderSort', () => {
  it('sorts objects by full key (no constraints)', () => {
    const objects: SceneObject[] = [
      makeObj({ stableId: 'tst.c.v1', sortAnchor: { x: 0, y: 300 } }),
      makeObj({ stableId: 'tst.a.v1', sortAnchor: { x: 0, y: 100 } }),
      makeObj({ stableId: 'tst.b.v1', sortAnchor: { x: 0, y: 200 } }),
    ]
    const sorted = baseOrderSort(objects, DEFAULT_FLOOR_REGISTRY)
    assert.equal(sorted[0].stableId, 'tst.a.v1')
    assert.equal(sorted[1].stableId, 'tst.b.v1')
    assert.equal(sorted[2].stableId, 'tst.c.v1')
  })

  it('uses tieBias when fixedPointY equal', () => {
    const objects: SceneObject[] = [
      makeObj({ stableId: 'tst.b.v1', tieBias: 5, sortAnchor: { x: 0, y: 100 } }),
      makeObj({ stableId: 'tst.a.v1', tieBias: -5, sortAnchor: { x: 0, y: 100 } }),
    ]
    const sorted = baseOrderSort(objects, DEFAULT_FLOOR_REGISTRY)
    assert.equal(sorted[0].stableId, 'tst.a.v1')
    assert.equal(sorted[1].stableId, 'tst.b.v1')
  })

  it('uses stableId as final tie-break', () => {
    const objects: SceneObject[] = [
      makeObj({ stableId: 'tst.z.v1', sortAnchor: { x: 0, y: 100 } }),
      makeObj({ stableId: 'tst.a.v1', sortAnchor: { x: 0, y: 100 } }),
    ]
    const sorted = baseOrderSort(objects, DEFAULT_FLOOR_REGISTRY)
    assert.equal(sorted[0].stableId, 'tst.a.v1')
    assert.equal(sorted[1].stableId, 'tst.z.v1')
  })

  it('sorts by renderBand before Y', () => {
    const objects: SceneObject[] = [
      makeObj({ stableId: 'tst.world.v1', renderBand: 'world', sortAnchor: { x: 0, y: 0 } }),
      makeObj({ stableId: 'tst.bg.v1', renderBand: 'background', sortAnchor: { x: 0, y: 500 } }),
    ]
    const sorted = baseOrderSort(objects, DEFAULT_FLOOR_REGISTRY)
    // background (0) < world (100), regardless of Y
    assert.equal(sorted[0].stableId, 'tst.bg.v1')
    assert.equal(sorted[1].stableId, 'tst.world.v1')
  })

  it('non-world objects sort before world objects when band lower', () => {
    const objects: SceneObject[] = [
      makeObj({ stableId: 'tst.ui.v1', renderBand: 'world-ui' }),
      makeObj({ stableId: 'tst.bg.v1', renderBand: 'background' }),
      makeObj({ stableId: 'tst.world.v1', renderBand: 'world' }),
    ]
    const sorted = baseOrderSort(objects, DEFAULT_FLOOR_REGISTRY)
    assert.equal(sorted[0].stableId, 'tst.bg.v1')
    assert.equal(sorted[1].stableId, 'tst.world.v1')
    assert.equal(sorted[2].stableId, 'tst.ui.v1')
  })

  it('produces deterministic output order', () => {
    const objects: SceneObject[] = Array.from({ length: 20 }, (_, i) =>
      makeObj({
        stableId: `tst.${String.fromCharCode(97 + (i % 26))}${i}.v1`,
        sortAnchor: { x: i * 10, y: 200 - i * 5 },
        tieBias: (i % 7) - 3,
      }),
    )

    // Sort twice and compare
    const sorted1 = baseOrderSort(objects, DEFAULT_FLOOR_REGISTRY)
    const sorted2 = baseOrderSort([...objects].reverse(), DEFAULT_FLOOR_REGISTRY)

    assert.equal(sorted1.length, sorted2.length)
    for (let i = 0; i < sorted1.length; i++) {
      assert.equal(sorted1[i].stableId, sorted2[i].stableId, `position ${i}`)
    }
  })

  it('preserves all input objects', () => {
    const objects: SceneObject[] = [
      makeObj({ stableId: 'tst.a.v1' }),
      makeObj({ stableId: 'tst.b.v1' }),
      makeObj({ stableId: 'tst.c.v1' }),
    ]
    const sorted = baseOrderSort(objects, DEFAULT_FLOOR_REGISTRY)
    assert.equal(sorted.length, 3)
    const ids = sorted.map(o => o.stableId).sort()
    assert.deepEqual(ids, ['tst.a.v1', 'tst.b.v1', 'tst.c.v1'])
  })
})

// ── Batch key computation ──

describe('WorldSortKey - computeAllWorldSortKeys', () => {
  it('returns map from stableId to key', () => {
    const objects: SceneObject[] = [
      makeObj({ stableId: 'tst.a.v1', sortAnchor: { x: 0, y: 100 } }),
      makeObj({ stableId: 'tst.b.v1', sortAnchor: { x: 0, y: 200 } }),
    ]
    const map = computeAllWorldSortKeys(objects, DEFAULT_FLOOR_REGISTRY)
    assert.equal(map.size, 2)
    assert.ok(map.has('tst.a.v1'))
    assert.ok(map.has('tst.b.v1'))
    assert.equal(map.get('tst.a.v1')!.fixedPointY, 25600)
    assert.equal(map.get('tst.b.v1')!.fixedPointY, 51200)
  })

  it('returns empty map for empty input', () => {
    const map = computeAllWorldSortKeys([], DEFAULT_FLOOR_REGISTRY)
    assert.equal(map.size, 0)
  })
})

// ── String serialization ──

describe('WorldSortKey - serialization', () => {
  it('round-trips through string', () => {
    const key: WorldSortKey = {
      renderBandOrder: 100,
      floorOrder: 0,
      elevation: 5,
      fixedPointY: 51200,
      tieBias: -3,
      stableId: 'tst.test.v1',
    }
    const str = worldSortKeyToString(key)
    assert.equal(str, '100|0|5|51200|-3|tst.test.v1')
    const parsed = parseWorldSortKeyString(str)
    assert.deepEqual(parsed, key)
  })

  it('string format is deterministic', () => {
    const key1: WorldSortKey = { renderBandOrder: 100, floorOrder: 0, elevation: 0, fixedPointY: 0, tieBias: 0, stableId: 'a' }
    const key2: WorldSortKey = { renderBandOrder: 100, floorOrder: 0, elevation: 0, fixedPointY: 0, tieBias: 0, stableId: 'a' }
    assert.equal(worldSortKeyToString(key1), worldSortKeyToString(key2))
  })
})

// ── Negative floor orders ──

describe('WorldSortKey - negative scenarios', () => {
  it('handles negative floorOrder correctly in comparison', () => {
    // Lower floor (basement) should come before ground floor
    const reg = { 'basement': -1, 'floor-1': 0, 'floor-2': 1 }
    const keyA = computeWorldSortKey(makeObj({ floorId: 'basement' }), reg)
    const keyB = computeWorldSortKey(makeObj({ floorId: 'floor-1' }), reg)
    assert.equal(keyA.floorOrder, -1)
    assert.equal(keyB.floorOrder, 0)
    assert.equal(compareWorldSortKeys(keyA, keyB), -1)
  })

  it('handles negative elevation in full key', () => {
    const key = computeWorldSortKey(makeObj({ elevation: -10 }), DEFAULT_FLOOR_REGISTRY)
    assert.equal(key.elevation, -10)
    // Verify serialization
    assert.equal(worldSortKeyToString(key).split('|')[2], '-10')
  })
})

// ── ChunkId independence ──

describe('WorldSortKey - chunkId independence', () => {
  it('chunkId does not affect sort key', () => {
    const keyA = computeWorldSortKey(makeObj({ stableId: 'tst.a.v1', chunkId: 'chunk-1' }), DEFAULT_FLOOR_REGISTRY)
    const keyB = computeWorldSortKey(makeObj({ stableId: 'tst.a.v1', chunkId: 'chunk-999' }), DEFAULT_FLOOR_REGISTRY)
    assert.equal(compareWorldSortKeys(keyA, keyB), 0)
  })
})
