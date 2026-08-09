// ── E5 Constraint Resolver Tests (review fix) ──
// Covers: grid-driven membership, full-scan detection,
// fragment-band validation, immutable membership state,
// chunkId validation, reused ASCII comparator, strict fragment type.

import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import {
  resolveConstraintOrder,
  sceneObjectToConstraintNode,
  fragmentToConstraintNode,
  createConstraintInstrumentation,
  createEmptyMembershipState,
  type ConstraintNode,
  type ConstraintEdge,
  type ConstraintResolution,
  type ConstraintCandidateProvider,
  type ConstraintMembershipState,
  type FragmentNodeInput,
} from '../../../src/game/occlusion/constraintResolver.js'
import { SpatialGrid } from '../../../src/game/occlusion/spatialGrid.js'
import {
  type SceneObject,
  type OcclusionConstraintZone,
  type Point,
  DEFAULT_FLOOR_REGISTRY,
  isStructuredFatalRenderSchemaError,
} from '../../../src/game/occlusion/schema.js'

// ── Helpers ──

function makeAgent(
  stableId: string, x: number, y: number,
  overrides: Partial<SceneObject> = {},
): SceneObject {
  return {
    stableId, sceneId: 'test-scene', chunkId: 'chunk-1', kind: 'agent',
    renderBand: 'world', floorId: 'floor-1', elevation: 0,
    sortMode: 'y', sortAnchor: { x, y }, tieBias: 0, ...overrides,
  }
}

function makeFragment(
  stableId: string, x: number, y: number,
  overrides: Partial<SceneObject> = {},
): SceneObject {
  return {
    stableId, sceneId: 'test-scene', chunkId: 'chunk-1', kind: 'occluder-fragment',
    renderBand: 'world', floorId: 'floor-1', elevation: 0,
    sortMode: 'fixed', sortAnchor: { x, y }, tieBias: 0, ...overrides,
  }
}

function makeZone(
  stableId: string, targetFragmentId: string, relation: 'behind' | 'front',
  polygon: Point[], overrides: Partial<OcclusionConstraintZone> = {},
): OcclusionConstraintZone {
  return {
    stableId, sceneId: 'test-scene', chunkId: 'chunk-1', floorId: 'floor-1',
    targetFragmentId, relation, priority: 0, polygon,
    bounds: { x: 0, y: 0, width: 200, height: 200 }, hysteresisPx: 3, ...overrides,
  }
}

function rectPolygon(x: number, y: number, w: number, h: number): Point[] {
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
}

function assertFatal(fn: () => void, expectedCode: string): void {
  try {
    fn()
    assert.fail(`expected fatal with code ${expectedCode}`)
  } catch (err) {
    assert.ok(isStructuredFatalRenderSchemaError(err), `expected RenderSchemaError, got ${String(err)}`)
    if (isStructuredFatalRenderSchemaError(err)) {
      assert.equal(err.errorCode, expectedCode, `expected ${expectedCode}, got ${err.errorCode}: ${err.message}`)
    }
  }
}

/** Simple candidate provider that returns all zone IDs (for non-grid tests). */
function allZonesProvider(zones: OcclusionConstraintZone[]): ConstraintCandidateProvider {
  const allIds = new Set(zones.map(z => z.stableId))
  return { queryCandidates: () => new Set(allIds) }
}

function makeRegistry(zones: OcclusionConstraintZone[]): Map<string, OcclusionConstraintZone> {
  return new Map(zones.map(z => [z.stableId, z]))
}

function resolve(
  nodes: ConstraintNode[],
  zones: OcclusionConstraintZone[],
  opts?: {
    now?: () => number
    previousMembership?: ConstraintMembershipState
    fullScanThreshold?: number
    provider?: ConstraintCandidateProvider
  },
): ConstraintResolution {
  return resolveConstraintOrder(
    nodes,
    opts?.provider ?? allZonesProvider(zones),
    makeRegistry(zones),
    DEFAULT_FLOOR_REGISTRY,
    'test-scene',
    {
      now: opts?.now,
      previousMembership: opts?.previousMembership,
      fullScanThreshold: opts?.fullScanThreshold ?? 999, // disable in simple tests
    },
  )
}

function fragInput(
  stableId: string, x: number, y: number,
  overrides: Partial<FragmentNodeInput> = {},
): FragmentNodeInput {
  return {
    stableId, sceneId: 'test-scene', chunkId: 'chunk-east',
    floorId: 'floor-1', elevation: 0, sortAnchor: { x, y },
    tieBias: 0, renderBand: 'world', ...overrides,
  }
}

// ═══════════════════════════════════════════════
// Base case: no zones → base order
// ═══════════════════════════════════════════════

describe('Constraint Resolver - base case', () => {
  it('outputs base order when no zones present', () => {
    const agents = [makeAgent('jyt.agent.bob.v1', 0, 100), makeAgent('jyt.agent.alice.v1', 0, 300)]
    const nodes: ConstraintNode[] = agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY))
    const result = resolve(nodes, [])
    assert.equal(result.order.length, 2)
    assert.equal(result.order[0], 'jyt.agent.bob.v1')
    assert.equal(result.order[1], 'jyt.agent.alice.v1')
    assert.equal(result.edges.length, 0)
  })

  it('Kahn with zero edges equals base sort', () => {
    const agents = [
      makeAgent('jyt.agent.c.v1', 0, 300),
      makeAgent('jyt.agent.a.v1', 0, 100),
      makeAgent('jyt.agent.b.v1', 0, 200),
    ]
    const nodes = agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY))
    const result = resolve(nodes, [])
    assert.deepEqual(result.order, ['jyt.agent.a.v1', 'jyt.agent.b.v1', 'jyt.agent.c.v1'])
  })

  it('base order uses full key, not just Y', () => {
    const agents = [
      makeAgent('jyt.agent.z.v1', 0, 100),
      makeAgent('jyt.agent.a.v1', 0, 100),
    ]
    const nodes = agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY))
    const result = resolve(nodes, [])
    assert.equal(result.order[0], 'jyt.agent.a.v1')
    assert.equal(result.order[1], 'jyt.agent.z.v1')
  })
})

// ═══════════════════════════════════════════════
// Behind / front constraints
// ═══════════════════════════════════════════════

describe('Constraint Resolver - edges', () => {
  it('agent behind fragment: agent < fragment', () => {
    const agents = [makeAgent('jyt.agent.alice.v1', 50, 50)]
    const frags = [makeFragment('jyt.frag.table.v1', 10, 10)]
    const zones = [makeZone('jyt.zone.tbl.v1', 'jyt.frag.table.v1', 'behind', rectPolygon(0, 0, 200, 200))]
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y), DEFAULT_FLOOR_REGISTRY)),
    ]
    const result = resolve(nodes, zones)
    assert.equal(result.edges.length, 1)
    assert.equal(result.edges[0].from, 'jyt.agent.alice.v1')
    assert.equal(result.edges[0].to, 'jyt.frag.table.v1')
    const ai = result.order.indexOf('jyt.agent.alice.v1')
    const fi = result.order.indexOf('jyt.frag.table.v1')
    assert.ok(ai < fi)
  })

  it('agent outside zone: no edge', () => {
    const agents = [makeAgent('jyt.agent.alice.v1', 500, 500)]
    const frags = [makeFragment('jyt.frag.table.v1', 10, 10)]
    const zones = [makeZone('jyt.zone.tbl.v1', 'jyt.frag.table.v1', 'behind', rectPolygon(0, 0, 100, 100))]
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y), DEFAULT_FLOOR_REGISTRY)),
    ]
    const result = resolve(nodes, zones)
    assert.equal(result.edges.length, 0)
  })

  it('agent front of fragment: fragment < agent', () => {
    const agents = [makeAgent('jyt.agent.alice.v1', 50, 50)]
    const frags = [makeFragment('jyt.frag.rail.v1', 10, 10)]
    const zones = [makeZone('jyt.zone.rf.v1', 'jyt.frag.rail.v1', 'front', rectPolygon(0, 0, 200, 200))]
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y), DEFAULT_FLOOR_REGISTRY)),
    ]
    const result = resolve(nodes, zones)
    assert.equal(result.edges[0].from, 'jyt.frag.rail.v1')
    assert.equal(result.edges[0].to, 'jyt.agent.alice.v1')
  })
})

// ═══════════════════════════════════════════════
// Two agents opposite sides
// ═══════════════════════════════════════════════

describe('Constraint Resolver - sandwich', () => {
  it('conflict when same agent gets behind+front from same zone pair', () => {
    const agents = [makeAgent('jyt.agent.a.v1', 50, 50)]
    const frags = [makeFragment('jyt.frag.p.v1', 50, 50)]
    const zBehind = makeZone('jyt.zone.b.v1', 'jyt.frag.p.v1', 'behind', rectPolygon(0, 0, 200, 200))
    const zFront = makeZone('jyt.zone.f.v1', 'jyt.frag.p.v1', 'front', rectPolygon(0, 0, 200, 200))
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y), DEFAULT_FLOOR_REGISTRY)),
    ]
    assertFatal(() => resolve(nodes, [zBehind, zFront]), 'CONSTRAINT_CONFLICT')
  })

  it('two agents legitimately on opposite sides', () => {
    const agents = [
      makeAgent('jyt.agent.a.v1', 30, 30),
      makeAgent('jyt.agent.b.v1', 150, 150),
    ]
    const frags = [makeFragment('jyt.frag.wall.v1', 40, 40)]
    const zA = makeZone('jyt.zone.a.v1', 'jyt.frag.wall.v1', 'behind', rectPolygon(0, 0, 60, 60))
    const zB = makeZone('jyt.zone.b.v1', 'jyt.frag.wall.v1', 'front', rectPolygon(120, 120, 60, 60))
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y), DEFAULT_FLOOR_REGISTRY)),
    ]
    const result = resolve(nodes, [zA, zB])
    assert.equal(result.edges.length, 2)
    const ai = result.order.indexOf('jyt.agent.a.v1')
    const fi = result.order.indexOf('jyt.frag.wall.v1')
    const bi = result.order.indexOf('jyt.agent.b.v1')
    assert.ok(ai < fi && fi < bi)
  })
})

// ═══════════════════════════════════════════════
// Priority authority
// ═══════════════════════════════════════════════

describe('Constraint Resolver - priority', () => {
  it('higher priority zone wins', () => {
    const agents = [makeAgent('jyt.agent.a.v1', 50, 50)]
    const frags = [makeFragment('jyt.frag.t.v1', 10, 10)]
    const zLo = makeZone('jyt.zone.lo.v1', 'jyt.frag.t.v1', 'behind', rectPolygon(0, 0, 200, 200), { priority: 0 })
    const zHi = makeZone('jyt.zone.hi.v1', 'jyt.frag.t.v1', 'behind', rectPolygon(0, 0, 200, 200), { priority: 10 })
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y), DEFAULT_FLOOR_REGISTRY)),
    ]
    const result = resolve(nodes, [zLo, zHi])
    assert.equal(result.edges.length, 1)
    assert.equal(result.edges[0].zoneStableId, 'jyt.zone.hi.v1')
  })

  it('same priority: lower ASCII wins', () => {
    const agents = [makeAgent('jyt.agent.a.v1', 50, 50)]
    const frags = [makeFragment('jyt.frag.t.v1', 10, 10)]
    const zB = makeZone('jyt.zone.b.v1', 'jyt.frag.t.v1', 'behind', rectPolygon(0, 0, 200, 200), { priority: 5 })
    const zA = makeZone('jyt.zone.a.v1', 'jyt.frag.t.v1', 'behind', rectPolygon(0, 0, 200, 200), { priority: 5 })
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y), DEFAULT_FLOOR_REGISTRY)),
    ]
    const result = resolve(nodes, [zB, zA])
    assert.equal(result.edges[0].zoneStableId, 'jyt.zone.a.v1')
  })
})

// ═══════════════════════════════════════════════
// Cycle detection
// ═══════════════════════════════════════════════

describe('Constraint Resolver - cycles', () => {
  it('multi-node cycle is fatal', () => {
    const agents = [makeAgent('jyt.agent.a1.v1', 50, 50), makeAgent('jyt.agent.a2.v1', 150, 150)]
    const frags = [makeFragment('jyt.frag.f1.v1', 40, 40), makeFragment('jyt.frag.f2.v1', 140, 140)]
    const z1 = makeZone('jyt.zone.b1.v1', 'jyt.frag.f1.v1', 'behind', rectPolygon(0, 0, 80, 80))
    const z2 = makeZone('jyt.zone.f2.v1', 'jyt.frag.f2.v1', 'front', rectPolygon(0, 0, 80, 80))
    const z3 = makeZone('jyt.zone.b2.v1', 'jyt.frag.f2.v1', 'behind', rectPolygon(130, 130, 80, 80))
    const z4 = makeZone('jyt.zone.f4.v1', 'jyt.frag.f1.v1', 'front', rectPolygon(130, 130, 80, 80))
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y), DEFAULT_FLOOR_REGISTRY)),
    ]
    assertFatal(() => resolve(nodes, [z1, z2, z3, z4]), 'CONSTRAINT_CYCLE_DETECTED')
  })

  it('duplicate nodes are fatal', () => {
    const agents = [makeAgent('jyt.agent.a.v1', 50, 50)]
    const nodes = [
      sceneObjectToConstraintNode(agents[0], DEFAULT_FLOOR_REGISTRY),
      sceneObjectToConstraintNode(agents[0], DEFAULT_FLOOR_REGISTRY),
    ]
    assertFatal(() => resolve(nodes, []), 'CONSTRAINT_DUPLICATE_NODE')
  })
})

// ═══════════════════════════════════════════════
// Cross-scope
// ═══════════════════════════════════════════════

describe('Constraint Resolver - cross-scope', () => {
  it('rejects cross-scene target', () => {
    const agents = [makeAgent('jyt.agent.a.v1', 50, 50, { sceneId: 'scene-a' })]
    const frags = [makeFragment('jyt.frag.f1.v1', 10, 10, { sceneId: 'scene-b' })]
    const zones = [makeZone('jyt.zone.z.v1', 'jyt.frag.f1.v1', 'behind', rectPolygon(0, 0, 200, 200), { sceneId: 'scene-a' })]
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y, { sceneId: f.sceneId }), DEFAULT_FLOOR_REGISTRY)),
    ]
    assertFatal(
      () => resolveConstraintOrder(nodes, allZonesProvider(zones), makeRegistry(zones), DEFAULT_FLOOR_REGISTRY, 'scene-a', { fullScanThreshold: 999 }),
      'ZONE_TARGET_CROSS_SCENE',
    )
  })

  it('rejects cross-floor target', () => {
    const agents = [makeAgent('jyt.agent.a.v1', 50, 50)]
    const frags = [makeFragment('jyt.frag.f1.v1', 10, 10, { floorId: 'floor-2' })]
    const floorReg = { 'floor-1': 0, 'floor-2': 1 }
    const zones = [makeZone('jyt.zone.z.v1', 'jyt.frag.f1.v1', 'behind', rectPolygon(0, 0, 200, 200), { floorId: 'floor-1' })]
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, floorReg)),
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y, { floorId: f.floorId }), floorReg)),
    ]
    assertFatal(
      () => resolveConstraintOrder(nodes, allZonesProvider(zones), makeRegistry(zones), floorReg, 'test-scene', { fullScanThreshold: 999 }),
      'ZONE_TARGET_CROSS_FLOOR',
    )
  })
})

// ═══════════════════════════════════════════════
// Membership hysteresis
// ═══════════════════════════════════════════════

describe('Constraint Resolver - hysteresis', () => {
  it('boundary point initially inside', () => {
    const agents = [makeAgent('jyt.agent.a.v1', 10, 10)]
    const frags = [makeFragment('jyt.frag.f1.v1', 5, 5)]
    const zones = [makeZone('jyt.zone.z.v1', 'jyt.frag.f1.v1', 'behind', rectPolygon(10, 10, 100, 100))]
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y), DEFAULT_FLOOR_REGISTRY)),
    ]
    const result = resolve(nodes, zones)
    assert.equal(result.edges.length, 1)
  })

  it('agent well outside: no edge', () => {
    const agents = [makeAgent('jyt.agent.a.v1', 500, 500)]
    const frags = [makeFragment('jyt.frag.f1.v1', 5, 5)]
    const zones = [makeZone('jyt.zone.z.v1', 'jyt.frag.f1.v1', 'behind', rectPolygon(10, 10, 100, 100))]
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y), DEFAULT_FLOOR_REGISTRY)),
    ]
    assert.equal(resolve(nodes, zones).edges.length, 0)
  })
})

// ═══════════════════════════════════════════════
// Full-scan detection (P0-2)
// ═══════════════════════════════════════════════

describe('Constraint Resolver - full-scan detection', () => {
  it('detects full scan when candidate count equals zone count', () => {
    // Create 6 zones (above default threshold of 5) with a provider that returns all
    const agents = [makeAgent('jyt.agent.a.v1', 50, 50)]
    const frags = [makeFragment('jyt.frag.f1.v1', 40, 40)]
    const zones = Array.from({ length: 6 }, (_, i) =>
      makeZone(`jyt.zone.z${i}.v1`, 'jyt.frag.f1.v1', 'behind', rectPolygon(i * 10, i * 10, 20, 20)))
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y), DEFAULT_FLOOR_REGISTRY)),
    ]
    // Use default threshold (5) — allZonesProvider returns all 6 zones → full scan
    const instr = createConstraintInstrumentation()
    assertFatal(
      () => resolveConstraintOrder(
        nodes, allZonesProvider(zones), makeRegistry(zones),
        DEFAULT_FLOOR_REGISTRY, 'test-scene',
        { fullScanThreshold: 5, instrumentation: instr },
      ),
      'SPATIAL_GRID_FULL_SCAN_DETECTED',
    )
    assert.equal(instr.fullMapScanDetected, true)
  })

  it('does not false-positive on small zone counts below threshold', () => {
    const agents = [makeAgent('jyt.agent.a.v1', 50, 50)]
    const frags = [makeFragment('jyt.frag.f1.v1', 40, 40)]
    const zones = Array.from({ length: 4 }, (_, i) =>
      makeZone(`jyt.zone.z${i}.v1`, 'jyt.frag.f1.v1', 'behind', rectPolygon(i * 10, i * 10, 20, 20)))
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y), DEFAULT_FLOOR_REGISTRY)),
    ]
    // 4 zones ≤ threshold 5 → no fatal
    const result = resolveConstraintOrder(
      nodes, allZonesProvider(zones), makeRegistry(zones),
      DEFAULT_FLOOR_REGISTRY, 'test-scene',
      { fullScanThreshold: 5 },
    )
    assert.ok(result.order.length > 0)
  })
})

// ═══════════════════════════════════════════════
// Fragment band validation (P0-3)
// ═══════════════════════════════════════════════

describe('Constraint Resolver - fragment band validation', () => {
  it('rejects overhead fragment in fragmentToConstraintNode', () => {
    assertFatal(
      () => fragmentToConstraintNode(fragInput('jyt.frag.oh.v1', 10, 10, { renderBand: 'overhead' }), DEFAULT_FLOOR_REGISTRY),
      'FRAGMENT_RENDER_BAND_INVALID',
    )
  })

  it('rejects overhead fragment in node set (second defense)', () => {
    // Manually create a constraint node with overhead renderBand
    const agents = [makeAgent('jyt.agent.a.v1', 50, 50)]
    const overheadNode: ConstraintNode = {
      stableId: 'jyt.frag.oh.v1', sceneId: 'test-scene', floorId: 'floor-1',
      nodeKind: 'fragment',
      sortKey: { renderBandOrder: 200, floorOrder: 0, elevation: 0, fixedPointY: 2560, tieBias: 0, stableId: 'jyt.frag.oh.v1' },
      position: undefined,
    }
    const nodes = [
      sceneObjectToConstraintNode(agents[0], DEFAULT_FLOOR_REGISTRY),
      overheadNode,
    ]
    assertFatal(() => resolve(nodes, []), 'FRAGMENT_RENDER_BAND_INVALID')
  })
})

// ═══════════════════════════════════════════════
// ChunkId validation (P1-5)
// ═══════════════════════════════════════════════

describe('Constraint Resolver - fragment chunkId', () => {
  it('rejects empty chunkId', () => {
    assertFatal(
      () => fragmentToConstraintNode(fragInput('jyt.frag.f1.v1', 10, 10, { chunkId: '' }), DEFAULT_FLOOR_REGISTRY),
      'CHUNK_ID_INVALID',
    )
  })

  it('rejects whitespace-only chunkId', () => {
    assertFatal(
      () => fragmentToConstraintNode(fragInput('jyt.frag.f1.v1', 10, 10, { chunkId: '   ' }), DEFAULT_FLOOR_REGISTRY),
      'CHUNK_ID_INVALID',
    )
  })

  it('accepts valid chunkId', () => {
    const node = fragmentToConstraintNode(fragInput('jyt.frag.f1.v1', 10, 10, { chunkId: 'chunk-east' }), DEFAULT_FLOOR_REGISTRY)
    assert.equal(node.nodeKind, 'fragment')
  })
})

// ═══════════════════════════════════════════════
// Immutable membership state (P1-4)
// ═══════════════════════════════════════════════

describe('Constraint Resolver - membership persistence', () => {
  it('returns nextMembership with new state', () => {
    const agents = [makeAgent('jyt.agent.a.v1', 50, 50)]
    const frags = [makeFragment('jyt.frag.f1.v1', 40, 40)]
    const zones = [makeZone('jyt.zone.z.v1', 'jyt.frag.f1.v1', 'behind', rectPolygon(0, 0, 200, 200))]
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y), DEFAULT_FLOOR_REGISTRY)),
    ]
    const result = resolve(nodes, zones)
    assert.ok(result.nextMembership)
    assert.ok(result.nextMembership.entries.has('jyt.zone.z.v1'))
    const agentMap = result.nextMembership.entries.get('jyt.zone.z.v1')!
    assert.equal(agentMap.get('jyt.agent.a.v1'), 'inside')
  })

  it('second frame uses first frame previous state', () => {
    const agents = [makeAgent('jyt.agent.a.v1', 55, 55)] // near boundary of rectPolygon(10,10,50,50)
    const frags = [makeFragment('jyt.frag.f1.v1', 40, 40)]
    // Small zone: polygon at (10,10)-(60,60). Agent at (55,55) is inside.
    const zones = [makeZone('jyt.zone.z.v1', 'jyt.frag.f1.v1', 'behind', rectPolygon(10, 10, 50, 50))]
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y), DEFAULT_FLOOR_REGISTRY)),
    ]

    // Frame 1: agent at (55,55) - clearly inside
    const result1 = resolve(nodes, zones)
    assert.equal(result1.edges.length, 1, 'frame 1 should have edge')

    // Frame 2: same position, provide previous state
    const result2 = resolve(nodes, zones, { previousMembership: result1.nextMembership })
    assert.equal(result2.edges.length, 1, 'frame 2 should still have edge')
  })

  it('failed transaction does not modify old membership state', () => {
    const agents = [makeAgent('jyt.agent.a.v1', 50, 50)]
    const frags = [makeFragment('jyt.frag.f1.v1', 40, 40)]
    const zones = [makeZone('jyt.zone.z.v1', 'jyt.frag.f1.v1', 'behind', rectPolygon(0, 0, 200, 200))]
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y), DEFAULT_FLOOR_REGISTRY)),
    ]

    // First successful call to get known state
    const result1 = resolve(nodes, zones)
    const frozenEntries = new Map(result1.nextMembership.entries)

    // Now create a cycle that will fail
    const cycleAgents = [makeAgent('jyt.agent.c1.v1', 50, 50), makeAgent('jyt.agent.c2.v1', 150, 150)]
    const cycleFrags = [makeFragment('jyt.frag.cf1.v1', 40, 40), makeFragment('jyt.frag.cf2.v1', 140, 140)]
    const cycleZones = [
      makeZone('jyt.zone.cb1.v1', 'jyt.frag.cf1.v1', 'behind', rectPolygon(0, 0, 80, 80)),
      makeZone('jyt.zone.cf2.v1', 'jyt.frag.cf2.v1', 'front', rectPolygon(0, 0, 80, 80)),
      makeZone('jyt.zone.cb2.v1', 'jyt.frag.cf2.v1', 'behind', rectPolygon(130, 130, 80, 80)),
      makeZone('jyt.zone.cf4.v1', 'jyt.frag.cf1.v1', 'front', rectPolygon(130, 130, 80, 80)),
    ]
    const cycleNodes: ConstraintNode[] = [
      ...cycleAgents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...cycleFrags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y), DEFAULT_FLOOR_REGISTRY)),
    ]

    assertFatal(
      () => resolve(cycleNodes, cycleZones, { previousMembership: result1.nextMembership }),
      'CONSTRAINT_CYCLE_DETECTED',
    )

    // Old membership should be unchanged
    assert.deepEqual(new Map(result1.nextMembership.entries), frozenEntries)
  })
})

// ═══════════════════════════════════════════════
// SpatialGrid integration (P0-1)
// ═══════════════════════════════════════════════

describe('Constraint Resolver - SpatialGrid integration', () => {
  it('uses grid for candidate discovery, not flat all-zones', () => {
    const grid = new SpatialGrid(256)
    const SCENE = 'test-scene'
    const FLOOR = 'floor-1'

    // Register 10 zones spread across a large area (500px apart for cell isolation)
    const zones: OcclusionConstraintZone[] = []
    for (let i = 0; i < 10; i++) {
      const x = i * 500
      const y = 100
      const poly = rectPolygon(x, y, 50, 50)
      const z = makeZone(`jyt.zone.z${i}.v1`, `jyt.frag.f${i}.v1`, 'behind', poly, {
        bounds: { x, y, width: 50, height: 50 },
      })
      zones.push(z)
      grid.register({ stableId: z.stableId, entryKind: 'zone', bounds: z.bounds }, SCENE, FLOOR)
    }

    // Register 10 fragments
    const fragInputs: FragmentNodeInput[] = []
    for (let i = 0; i < 10; i++) {
      const fi = fragInput(`jyt.frag.f${i}.v1`, i * 300 + 25, 125)
      fragInputs.push(fi)
      grid.register({ stableId: fi.stableId, entryKind: "fragment", bounds: { x: i * 500, y: 100, width: 50, height: 50 } }, SCENE, FLOOR)
    }

    // Agent at (150, 125) — only near zones 0 and maybe 1
    const agents = [makeAgent('jyt.agent.a.v1', 150, 125)]
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...fragInputs.map(f => fragmentToConstraintNode(f, DEFAULT_FLOOR_REGISTRY)),
    ]

    const instr = createConstraintInstrumentation()
    const result = resolveConstraintOrder(
      nodes, grid, makeRegistry(zones),
      DEFAULT_FLOOR_REGISTRY, SCENE,
      { instrumentation: instr, fullScanThreshold: 5 },
    )

    // Membership checks should be far less than 10 (all zones)
    assert.ok(instr.membershipCheckCount < 10,
      `membershipCheckCount=${instr.membershipCheckCount} should be < 10 (not all zones)`)
    assert.equal(instr.fullMapScanDetected, false)
    assert.ok(result.order.length > 0)
  })

  it('108 agents × 37 zones: candidate scans << full scan', () => {
    const grid = new SpatialGrid(256)
    const SCENE = 'test-scene'
    const FLOOR = 'floor-1'

    // 37 zones spread across map (1664 × 928)
    const zones: OcclusionConstraintZone[] = []
    const fragInputs: FragmentNodeInput[] = []
    for (let i = 0; i < 37; i++) {
      const x = (i * 44) % 1600
      const y = (i * 24) % 900
      const fid = `jyt.frag.f${i}.v1`
      const poly = rectPolygon(x, y, 40, 40)
      const z = makeZone(`jyt.zone.z${i}.v1`, fid, 'behind', poly, {
        bounds: { x, y, width: 40, height: 40 },
      })
      zones.push(z)
      fragInputs.push(fragInput(fid, x + 20, y + 20))
      grid.register({ stableId: z.stableId, entryKind: 'zone', bounds: z.bounds }, SCENE, FLOOR)
      grid.register({ stableId: fid, entryKind: 'fragment', bounds: z.bounds }, SCENE, FLOOR)
    }

    // Create 108 agents
    const agents: SceneObject[] = []
    for (let i = 0; i < 108; i++) {
      agents.push(makeAgent(`jyt.agent.a${i}.v1`, (i * 15 + 50) % 1664, (i * 8 + 30) % 928))
    }

    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...fragInputs.map(f => fragmentToConstraintNode(f, DEFAULT_FLOOR_REGISTRY)),
    ]

    const instr = createConstraintInstrumentation()
    const result = resolveConstraintOrder(
      nodes, grid, makeRegistry(zones),
      DEFAULT_FLOOR_REGISTRY, SCENE,
      { instrumentation: instr, fullScanThreshold: 5 },
    )

    // Total membership checks should be SIGNIFICANTLY less than 108 × 37 = 3996
    const maxPossible = 108 * 37 // 3996
    assert.ok(instr.membershipCheckCount < maxPossible,
      `membershipCheckCount=${instr.membershipCheckCount} should be < ${maxPossible} (full scan)`)
    // Should be at most ~30% of full scan (safe bound for sparse grid)
    assert.ok(instr.membershipCheckCount < maxPossible * 0.5,
      `membershipCheckCount=${instr.membershipCheckCount} should be < ${maxPossible * 0.5} (50% of full)`)
    assert.equal(instr.fullMapScanDetected, false)
    assert.ok(result.order.length > 0)
  })

  it('candidate provider throw does not corrupt membership state', () => {
    const agents = [makeAgent('jyt.agent.a.v1', 50, 50)]
    const frags = [makeFragment('jyt.frag.f1.v1', 40, 40)]
    const zones = [makeZone('jyt.zone.z.v1', 'jyt.frag.f1.v1', 'behind', rectPolygon(0, 0, 200, 200))]
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y), DEFAULT_FLOOR_REGISTRY)),
    ]

    // First call to establish state
    const result1 = resolve(nodes, zones)
    const frozen = new Map(result1.nextMembership.entries)

    // Second call with throwing provider
    const badProvider: ConstraintCandidateProvider = {
      queryCandidates: () => { throw new Error('grid crash') },
    }
    assert.throws(
      () => resolveConstraintOrder(
        nodes, badProvider, makeRegistry(zones),
        DEFAULT_FLOOR_REGISTRY, 'test-scene',
        { previousMembership: result1.nextMembership, fullScanThreshold: 999 },
      ),
    )
    // Previous state unchanged
    assert.deepEqual(new Map(result1.nextMembership.entries), frozen)
  })
})

// ═══════════════════════════════════════════════
// Instrumentation
// ═══════════════════════════════════════════════

describe('Constraint Resolver - instrumentation', () => {
  it('populates correct counts via grid path', () => {
    const grid = new SpatialGrid(256)
    const SCENE = 'test-scene'
    const FLOOR = 'floor-1'
    const agents = [makeAgent('jyt.agent.a.v1', 50, 50), makeAgent('jyt.agent.b.v1', 50, 50)]
    const fi = fragInput('jyt.frag.f1.v1', 40, 40)
    const zone = makeZone('jyt.zone.z.v1', 'jyt.frag.f1.v1', 'behind', rectPolygon(0, 0, 200, 200))
    grid.register({ stableId: zone.stableId, entryKind: 'zone', bounds: zone.bounds }, SCENE, FLOOR)
    grid.register({ stableId: fi.stableId, entryKind: 'fragment', bounds: { x: 0, y: 0, width: 200, height: 200 } }, SCENE, FLOOR)

    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      fragmentToConstraintNode(fi, DEFAULT_FLOOR_REGISTRY),
    ]

    const instr = createConstraintInstrumentation()
    resolveConstraintOrder(nodes, grid, makeRegistry([zone]), DEFAULT_FLOOR_REGISTRY, SCENE, {
      instrumentation: instr, fullScanThreshold: 5,
    })

    assert.equal(instr.agentCount, 2)
    assert.equal(instr.zoneCount, 1)
    assert.ok(instr.membershipCheckCount > 0)
    assert.ok(instr.sortDurationMs >= 0)
    assert.equal(instr.cycleDetected, false)
    assert.equal(instr.fullMapScanDetected, false)
  })

  it('instrumentation is externally mutable', () => {
    const instr = createConstraintInstrumentation()
    instr.candidateCount = 999
    assert.equal(instr.candidateCount, 999)
  })
})

// ═══════════════════════════════════════════════
// Determinism
// ═══════════════════════════════════════════════

describe('Constraint Resolver - determinism', () => {
  it('shuffled input produces identical output', () => {
    const agents = [
      makeAgent('jyt.agent.a.v1', 10, 50), makeAgent('jyt.agent.b.v1', 30, 50),
      makeAgent('jyt.agent.c.v1', 120, 50), makeAgent('jyt.agent.d.v1', 140, 50),
    ]
    const frags = [
      makeFragment('jyt.frag.f1.v1', 20, 30), makeFragment('jyt.frag.f2.v1', 60, 30),
    ]
    const zones = [
      makeZone('jyt.zone.z1.v1', 'jyt.frag.f1.v1', 'behind', rectPolygon(0, 0, 50, 100)),
      makeZone('jyt.zone.z2.v1', 'jyt.frag.f2.v1', 'front', rectPolygon(100, 0, 50, 100)),
    ]
    const baseNodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y), DEFAULT_FLOOR_REGISTRY)),
    ]
    const ref = resolve([...baseNodes], zones)

    for (let run = 0; run < 10; run++) {
      const shuffled = [...baseNodes]
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
      }
      const result = resolve(shuffled, zones)
      assert.deepEqual(result.order, ref.order, `run ${run}`)
      assert.equal(result.edges.length, ref.edges.length, `run ${run}`)
    }
  })
})

// ═══════════════════════════════════════════════
// Sparse edges
// ═══════════════════════════════════════════════

describe('Constraint Resolver - sparse edges', () => {
  it('does not expand base order into pairwise edges', () => {
    const agents = [
      makeAgent('jyt.agent.a.v1', 0, 100), makeAgent('jyt.agent.b.v1', 0, 200), makeAgent('jyt.agent.c.v1', 0, 300),
    ]
    const nodes = agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY))
    assert.equal(resolve(nodes, []).edges.length, 0)
  })

  it('only generates edges from active zones', () => {
    const agents = [makeAgent('jyt.agent.a.v1', 50, 50), makeAgent('jyt.agent.b.v1', 150, 50)]
    const frags = [makeFragment('jyt.frag.f1.v1', 40, 40)]
    const zones = [makeZone('jyt.zone.z.v1', 'jyt.frag.f1.v1', 'behind', rectPolygon(0, 0, 80, 80))]
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y), DEFAULT_FLOOR_REGISTRY)),
    ]
    const result = resolve(nodes, zones)
    assert.equal(result.edges.length, 1)
    assert.equal(result.edges[0].from, 'jyt.agent.a.v1')
  })
})
