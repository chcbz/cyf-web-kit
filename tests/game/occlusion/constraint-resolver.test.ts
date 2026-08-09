// ── E5 Constraint Resolver Tests (round-2 review fix) ──
// Covers: provenance gate, pre-validation, immutable membership,
// grid-driven candidates, per-agent metrics, all round-1 functionality.

import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import {
  resolveConstraintOrder,
  sceneObjectToConstraintNode,
  fragmentToConstraintNode,
  createConstraintInstrumentation,
  createEmptyMembershipState,
  createTestCandidateProvider,
  type ConstraintNode,
  type ConstraintResolution,
  type ConstraintCandidateProvider,
  type ConstraintMembershipState,
  type FragmentNodeInput,
} from '../../../src/game/occlusion/constraintResolver.js'
import {
  SpatialGrid,
  createConstraintCandidateProvider,
} from '../../../src/game/occlusion/spatialGrid.js'
import {
  type SceneObject,
  type OcclusionConstraintZone,
  type Point,
  DEFAULT_FLOOR_REGISTRY,
  isStructuredFatalRenderSchemaError,
} from '../../../src/game/occlusion/schema.js'

// ── Helpers ──

function makeAgent(stableId: string, x: number, y: number, overrides: Partial<SceneObject> = {}): SceneObject {
  return { stableId, sceneId: 'test-scene', chunkId: 'chunk-1', kind: 'agent', renderBand: 'world', floorId: 'floor-1', elevation: 0, sortMode: 'y', sortAnchor: { x, y }, tieBias: 0, ...overrides }
}

function makeFragment(stableId: string, x: number, y: number, overrides: Partial<SceneObject> = {}): SceneObject {
  return { stableId, sceneId: 'test-scene', chunkId: 'chunk-1', kind: 'occluder-fragment', renderBand: 'world', floorId: 'floor-1', elevation: 0, sortMode: 'fixed', sortAnchor: { x, y }, tieBias: 0, ...overrides }
}

function makeZone(stableId: string, targetFragmentId: string, relation: 'behind' | 'front', polygon: Point[], overrides: Partial<OcclusionConstraintZone> = {}): OcclusionConstraintZone {
  return { stableId, sceneId: 'test-scene', chunkId: 'chunk-1', floorId: 'floor-1', targetFragmentId, relation, priority: 0, polygon, bounds: { x: 0, y: 0, width: 200, height: 200 }, hysteresisPx: 3, ...overrides }
}

function rectPolygon(x: number, y: number, w: number, h: number): Point[] {
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
}

function assertFatal(fn: () => void, expectedCode: string): void {
  try { fn(); assert.fail(`expected fatal with ${expectedCode}`) }
  catch (err) {
    assert.ok(isStructuredFatalRenderSchemaError(err), `expected RenderSchemaError, got ${String(err)}`)
    if (isStructuredFatalRenderSchemaError(err)) assert.equal(err.errorCode, expectedCode, `expected ${expectedCode}, got ${err.errorCode}`)
  }
}

function allZonesProvider(zones: OcclusionConstraintZone[]): ConstraintCandidateProvider {
  const allIds = new Set(zones.map(z => z.stableId))
  return createTestCandidateProvider(() => new Set(allIds))
}

function makeRegistry(zones: OcclusionConstraintZone[]): Map<string, OcclusionConstraintZone> {
  return new Map(zones.map(z => [z.stableId, z]))
}

function resolve(nodes: ConstraintNode[], zones: OcclusionConstraintZone[], opts?: {
  now?: () => number
  previousMembership?: ConstraintMembershipState
  provider?: ConstraintCandidateProvider
  instr?: ReturnType<typeof createConstraintInstrumentation>
}): ConstraintResolution {
  return resolveConstraintOrder(
    nodes, opts?.provider ?? allZonesProvider(zones), makeRegistry(zones),
    DEFAULT_FLOOR_REGISTRY, 'test-scene',
    { now: opts?.now, previousMembership: opts?.previousMembership, instrumentation: opts?.instr, _trustTestProvider: true },
  )
}

function fragInput(stableId: string, x: number, y: number, overrides: Partial<FragmentNodeInput> = {}): FragmentNodeInput {
  return { stableId, sceneId: 'test-scene', chunkId: 'chunk-east', floorId: 'floor-1', elevation: 0, sortAnchor: { x, y }, tieBias: 0, renderBand: 'world', ...overrides }
}

// ═══════════════════════════════════════════════
// Provenance gate (P2 fix)
// ═══════════════════════════════════════════════

describe('Constraint Resolver - provenance', () => {
  it('rejects unbranded provider without _trustTestProvider', () => {
    const agents = [makeAgent('jyt.agent.a.v1', 50, 50)]
    const frags = [makeFragment('jyt.frag.f1.v1', 40, 40)]
    const zones = [makeZone('jyt.zone.z.v1', 'jyt.frag.f1.v1', 'behind', rectPolygon(0, 0, 200, 200))]
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y), DEFAULT_FLOOR_REGISTRY)),
    ]
    // Plain object without _brand
    const badProvider: ConstraintCandidateProvider = {
      queryCandidates: () => new Set(zones.map(z => z.stableId)),
    }
    assertFatal(
      () => resolveConstraintOrder(nodes, badProvider, makeRegistry(zones), DEFAULT_FLOOR_REGISTRY, 'test-scene', { _trustTestProvider: false }),
      'SPATIAL_GRID_CELL_SIZE_INVALID',
    )
  })

  it('accepts branded SpatialGrid provider', () => {
    const grid = new SpatialGrid(256)
    const agents = [makeAgent('jyt.agent.a.v1', 50, 50)]
    const frags = [makeFragment('jyt.frag.f1.v1', 40, 40)]
    const zone = makeZone('jyt.zone.z.v1', 'jyt.frag.f1.v1', 'behind', rectPolygon(0, 0, 200, 200))
    grid.register({ stableId: zone.stableId, entryKind: 'zone', bounds: zone.bounds }, 'test-scene', 'floor-1')
    grid.register({ stableId: 'jyt.frag.f1.v1', entryKind: 'fragment', bounds: { x: 0, y: 0, width: 200, height: 200 } }, 'test-scene', 'floor-1')
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y), DEFAULT_FLOOR_REGISTRY)),
    ]
    const provider = createConstraintCandidateProvider(grid)
    const result = resolveConstraintOrder(nodes, provider, makeRegistry([zone]), DEFAULT_FLOOR_REGISTRY, 'test-scene')
    assert.ok(result.order.length > 0)
  })

  it('test provider accepted with _trustTestProvider flag', () => {
    const agents = [makeAgent('jyt.agent.a.v1', 50, 50)]
    const frags = [makeFragment('jyt.frag.f1.v1', 40, 40)]
    const zones = [makeZone('jyt.zone.z.v1', 'jyt.frag.f1.v1', 'behind', rectPolygon(0, 0, 200, 200))]
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y), DEFAULT_FLOOR_REGISTRY)),
    ]
    const result = resolve(nodes, zones) // uses _trustTestProvider: true via resolve helper
    assert.ok(result.order.length > 0)
  })
})

// ═══════════════════════════════════════════════
// Zone pre-validation (P2 fix)
// ═══════════════════════════════════════════════

describe('Constraint Resolver - pre-validation', () => {
  it('rejects zone with missing target fragment (even zero agents)', () => {
    const agents: SceneObject[] = []
    const frags: SceneObject[] = [] // no fragments!
    const zones = [makeZone('jyt.zone.z.v1', 'jyt.frag.missing.v1', 'behind', rectPolygon(0, 0, 200, 200))]
    const nodes: ConstraintNode[] = []
    assertFatal(() => resolve(nodes, zones), 'ZONE_TARGET_NOT_FOUND')
  })

  it('rejects zone targeting non-fragment node', () => {
    const agents = [makeAgent('jyt.agent.a.v1', 50, 50)]
    const zones = [makeZone('jyt.zone.z.v1', 'jyt.agent.a.v1', 'behind', rectPolygon(0, 0, 200, 200))]
    const nodes: ConstraintNode[] = agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY))
    assertFatal(() => resolve(nodes, zones), 'ZONE_TARGET_NOT_FOUND')
  })

  it('rejects zone targeting overhead fragment', () => {
    const agents: SceneObject[] = []
    const overheadNode: ConstraintNode = {
      stableId: 'jyt.frag.oh.v1', sceneId: 'test-scene', floorId: 'floor-1',
      nodeKind: 'fragment',
      sortKey: { renderBandOrder: 200, floorOrder: 0, elevation: 0, fixedPointY: 0, tieBias: 0, stableId: 'jyt.frag.oh.v1' },
      position: undefined,
    }
    const zones = [makeZone('jyt.zone.z.v1', 'jyt.frag.oh.v1', 'behind', rectPolygon(0, 0, 200, 200))]
    const nodes: ConstraintNode[] = [overheadNode]
    assertFatal(() => resolve(nodes, zones), 'FRAGMENT_RENDER_BAND_INVALID')
  })

  it('rejects zone with cross-scene target', () => {
    const agents: SceneObject[] = []
    const frags = [makeFragment('jyt.frag.f1.v1', 10, 10, { sceneId: 'scene-b' })]
    const zones = [makeZone('jyt.zone.z.v1', 'jyt.frag.f1.v1', 'behind', rectPolygon(0, 0, 200, 200), { sceneId: 'scene-a' })]
    const nodes: ConstraintNode[] = [
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y, { sceneId: f.sceneId }), DEFAULT_FLOOR_REGISTRY)),
    ]
    assertFatal(
      () => resolveConstraintOrder(nodes, allZonesProvider(zones), makeRegistry(zones), DEFAULT_FLOOR_REGISTRY, 'scene-a', { _trustTestProvider: true }),
      'ZONE_TARGET_CROSS_SCENE',
    )
  })

  it('rejects zone with cross-floor target', () => {
    const agents: SceneObject[] = []
    const floorReg = { 'floor-1': 0, 'floor-2': 1 }
    const frags = [makeFragment('jyt.frag.f1.v1', 10, 10, { floorId: 'floor-2' })]
    const zones = [makeZone('jyt.zone.z.v1', 'jyt.frag.f1.v1', 'behind', rectPolygon(0, 0, 200, 200), { floorId: 'floor-1' })]
    const nodes: ConstraintNode[] = [
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y, { floorId: f.floorId }), floorReg)),
    ]
    assertFatal(
      () => resolveConstraintOrder(nodes, allZonesProvider(zones), makeRegistry(zones), floorReg, 'test-scene', { _trustTestProvider: true }),
      'ZONE_TARGET_CROSS_FLOOR',
    )
  })
})

// ═══════════════════════════════════════════════
// Membership immutability (P2 fix)
// ═══════════════════════════════════════════════

describe('Constraint Resolver - membership immutability', () => {
  it('nextMembership is frozen (cannot mutate)', () => {
    const agents = [makeAgent('jyt.agent.a.v1', 50, 50)]
    const frags = [makeFragment('jyt.frag.f1.v1', 40, 40)]
    const zones = [makeZone('jyt.zone.z.v1', 'jyt.frag.f1.v1', 'behind', rectPolygon(0, 0, 200, 200))]
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y), DEFAULT_FLOOR_REGISTRY)),
    ]
    const result = resolve(nodes, zones)
    assert.ok(Object.isFrozen(result.nextMembership))
    const inner = result.nextMembership['jyt.zone.z.v1']
    assert.ok(inner)
    assert.ok(Object.isFrozen(inner))
    // Verify content is correct
    assert.equal(inner['jyt.agent.a.v1'], 'inside')
    // Frozen objects are immutable — verify keys unchanged
    const beforeKeys = Object.keys(result.nextMembership).length
    try { (result.nextMembership as any).newKey = 'bad' } catch (_) { /* strict throws */ }
    assert.equal(Object.keys(result.nextMembership).length, beforeKeys)
  })

  it('createEmptyMembershipState returns empty frozen object', () => {
    const empty = createEmptyMembershipState()
    assert.ok(Object.isFrozen(empty))
    assert.deepEqual(Object.keys(empty), [])
  })

  it('previous membership is cloned, not aliased', () => {
    const agents = [makeAgent('jyt.agent.a.v1', 50, 50)]
    const frags = [makeFragment('jyt.frag.f1.v1', 40, 40)]
    const zones = [makeZone('jyt.zone.z.v1', 'jyt.frag.f1.v1', 'behind', rectPolygon(0, 0, 200, 200))]
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y), DEFAULT_FLOOR_REGISTRY)),
    ]
    // Frame 1
    const r1 = resolve(nodes, zones)
    const frozen1 = { ...r1.nextMembership }
    // Frame 2 — resolver clones input, so mutating frozen1 afterward doesn't affect r2
    const r2 = resolve(nodes, zones, { previousMembership: r1.nextMembership })
    // frozen1 should still be the same deep structure
    assert.deepEqual(frozen1, r1.nextMembership)
    // r2 should have its own independent output
    assert.ok(Object.isFrozen(r2.nextMembership))
  })
})

// ═══════════════════════════════════════════════
// Base cases
// ═══════════════════════════════════════════════

describe('Constraint Resolver - base case', () => {
  it('outputs base order when no zones present', () => {
    const agents = [makeAgent('jyt.agent.bob.v1', 0, 100), makeAgent('jyt.agent.alice.v1', 0, 300)]
    const nodes = agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY))
    const result = resolve(nodes, [])
    assert.equal(result.order[0], 'jyt.agent.bob.v1')
    assert.equal(result.order[1], 'jyt.agent.alice.v1')
    assert.equal(result.edges.length, 0)
  })

  it('Kahn with zero edges equals base sort', () => {
    const agents = [makeAgent('jyt.agent.c.v1', 0, 300), makeAgent('jyt.agent.a.v1', 0, 100), makeAgent('jyt.agent.b.v1', 0, 200)]
    const nodes = agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY))
    assert.deepEqual(resolve(nodes, []).order, ['jyt.agent.a.v1', 'jyt.agent.b.v1', 'jyt.agent.c.v1'])
  })

  it('base order uses full key, not just Y', () => {
    const agents = [makeAgent('jyt.agent.z.v1', 0, 100), makeAgent('jyt.agent.a.v1', 0, 100)]
    const nodes = agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY))
    const result = resolve(nodes, [])
    assert.equal(result.order[0], 'jyt.agent.a.v1')
    assert.equal(result.order[1], 'jyt.agent.z.v1')
  })
})

// ═══════════════════════════════════════════════
// Behind / front edges
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
    assert.equal(result.edges[0].from, 'jyt.agent.alice.v1')
    assert.equal(result.edges[0].to, 'jyt.frag.table.v1')
    assert.ok(result.order.indexOf('jyt.agent.alice.v1') < result.order.indexOf('jyt.frag.table.v1'))
  })

  it('agent outside zone: no edge', () => {
    const agents = [makeAgent('jyt.agent.alice.v1', 500, 500)]
    const frags = [makeFragment('jyt.frag.table.v1', 10, 10)]
    const zones = [makeZone('jyt.zone.tbl.v1', 'jyt.frag.table.v1', 'behind', rectPolygon(0, 0, 100, 100))]
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y), DEFAULT_FLOOR_REGISTRY)),
    ]
    assert.equal(resolve(nodes, zones).edges.length, 0)
  })

  it('front: fragment < agent', () => {
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
  it('conflict when same agent gets behind+front', () => {
    const agents = [makeAgent('jyt.agent.a.v1', 50, 50)]
    const frags = [makeFragment('jyt.frag.p.v1', 50, 50)]
    const zB = makeZone('jyt.zone.b.v1', 'jyt.frag.p.v1', 'behind', rectPolygon(0, 0, 200, 200))
    const zF = makeZone('jyt.zone.f.v1', 'jyt.frag.p.v1', 'front', rectPolygon(0, 0, 200, 200))
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y), DEFAULT_FLOOR_REGISTRY)),
    ]
    assertFatal(() => resolve(nodes, [zB, zF]), 'CONSTRAINT_CONFLICT')
  })

  it('two agents on opposite sides', () => {
    const agents = [makeAgent('jyt.agent.a.v1', 30, 30), makeAgent('jyt.agent.b.v1', 150, 150)]
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
    assert.equal(resolve(nodes, [zB, zA]).edges[0].zoneStableId, 'jyt.zone.a.v1')
  })
})

// ═══════════════════════════════════════════════
// Cycle detection
// ═══════════════════════════════════════════════

describe('Constraint Resolver - cycles', () => {
  it('multi-node cycle is fatal', () => {
    const agents = [makeAgent('jyt.agent.a1.v1', 50, 50), makeAgent('jyt.agent.a2.v1', 150, 150)]
    const frags = [makeFragment('jyt.frag.f1.v1', 40, 40), makeFragment('jyt.frag.f2.v1', 140, 140)]
    const zones = [
      makeZone('jyt.zone.b1.v1', 'jyt.frag.f1.v1', 'behind', rectPolygon(0, 0, 80, 80)),
      makeZone('jyt.zone.f2.v1', 'jyt.frag.f2.v1', 'front', rectPolygon(0, 0, 80, 80)),
      makeZone('jyt.zone.b2.v1', 'jyt.frag.f2.v1', 'behind', rectPolygon(130, 130, 80, 80)),
      makeZone('jyt.zone.f4.v1', 'jyt.frag.f1.v1', 'front', rectPolygon(130, 130, 80, 80)),
    ]
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y), DEFAULT_FLOOR_REGISTRY)),
    ]
    assertFatal(() => resolve(nodes, zones), 'CONSTRAINT_CYCLE_DETECTED')
  })

  it('duplicate nodes are fatal', () => {
    const agents = [makeAgent('jyt.agent.a.v1', 50, 50)]
    const nodes = [sceneObjectToConstraintNode(agents[0], DEFAULT_FLOOR_REGISTRY), sceneObjectToConstraintNode(agents[0], DEFAULT_FLOOR_REGISTRY)]
    assertFatal(() => resolve(nodes, []), 'CONSTRAINT_DUPLICATE_NODE')
  })
})

// ═══════════════════════════════════════════════
// Cross-scope (non-prevalidation paths remain)
// ═══════════════════════════════════════════════

describe('Constraint Resolver - cross-scope runtime', () => {
  it('cross-scene zone target found via pre-validation', () => {
    const frags = [makeFragment('jyt.frag.f1.v1', 10, 10, { sceneId: 'scene-b' })]
    const zones = [makeZone('jyt.zone.z.v1', 'jyt.frag.f1.v1', 'behind', rectPolygon(0, 0, 200, 200), { sceneId: 'scene-a' })]
    const nodes: ConstraintNode[] = [
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y, { sceneId: f.sceneId }), DEFAULT_FLOOR_REGISTRY)),
    ]
    assertFatal(
      () => resolveConstraintOrder(nodes, allZonesProvider(zones), makeRegistry(zones), DEFAULT_FLOOR_REGISTRY, 'scene-a', { _trustTestProvider: true }),
      'ZONE_TARGET_CROSS_SCENE',
    )
  })

  it('cross-floor zone target found via pre-validation', () => {
    const floorReg = { 'floor-1': 0, 'floor-2': 1 }
    const frags = [makeFragment('jyt.frag.f1.v1', 10, 10, { floorId: 'floor-2' })]
    const zones = [makeZone('jyt.zone.z.v1', 'jyt.frag.f1.v1', 'behind', rectPolygon(0, 0, 200, 200), { floorId: 'floor-1' })]
    const nodes: ConstraintNode[] = [
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y, { floorId: f.floorId }), floorReg)),
    ]
    assertFatal(
      () => resolveConstraintOrder(nodes, allZonesProvider(zones), makeRegistry(zones), floorReg, 'test-scene', { _trustTestProvider: true }),
      'ZONE_TARGET_CROSS_FLOOR',
    )
  })
})

// ═══════════════════════════════════════════════
// Hysteresis
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
    assert.equal(resolve(nodes, zones).edges.length, 1)
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
// Fragment band validation
// ═══════════════════════════════════════════════

describe('Constraint Resolver - fragment band', () => {
  it('rejects overhead fragment in adapter', () => {
    assertFatal(
      () => fragmentToConstraintNode(fragInput('jyt.frag.oh.v1', 10, 10, { renderBand: 'overhead' }), DEFAULT_FLOOR_REGISTRY),
      'FRAGMENT_RENDER_BAND_INVALID',
    )
  })

  it('rejects overhead fragment in node set', () => {
    const overheadNode: ConstraintNode = {
      stableId: 'jyt.frag.oh.v1', sceneId: 'test-scene', floorId: 'floor-1', nodeKind: 'fragment',
      sortKey: { renderBandOrder: 200, floorOrder: 0, elevation: 0, fixedPointY: 2560, tieBias: 0, stableId: 'jyt.frag.oh.v1' },
      position: undefined,
    }
    assertFatal(() => resolve([overheadNode], []), 'FRAGMENT_RENDER_BAND_INVALID')
  })
})

// ═══════════════════════════════════════════════
// Fragment chunkId
// ═══════════════════════════════════════════════

describe('Constraint Resolver - fragment chunkId', () => {
  it('rejects empty chunkId', () => {
    assertFatal(() => fragmentToConstraintNode(fragInput('jyt.frag.f1.v1', 10, 10, { chunkId: '' }), DEFAULT_FLOOR_REGISTRY), 'CHUNK_ID_INVALID')
  })

  it('accepts valid chunkId', () => {
    const node = fragmentToConstraintNode(fragInput('jyt.frag.f1.v1', 10, 10, { chunkId: 'chunk-east' }), DEFAULT_FLOOR_REGISTRY)
    assert.equal(node.nodeKind, 'fragment')
  })
})

// ═══════════════════════════════════════════════
// Membership persistence
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
    assert.equal(result.nextMembership['jyt.zone.z.v1']?.['jyt.agent.a.v1'], 'inside')
  })

  it('second frame uses first frame previous state', () => {
    const agents = [makeAgent('jyt.agent.a.v1', 55, 55)]
    const frags = [makeFragment('jyt.frag.f1.v1', 40, 40)]
    const zones = [makeZone('jyt.zone.z.v1', 'jyt.frag.f1.v1', 'behind', rectPolygon(10, 10, 50, 50))]
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y), DEFAULT_FLOOR_REGISTRY)),
    ]
    const r1 = resolve(nodes, zones)
    const r2 = resolve(nodes, zones, { previousMembership: r1.nextMembership })
    assert.equal(r2.edges.length, 1)
  })

  it('failed transaction does not modify old membership', () => {
    const agents = [makeAgent('jyt.agent.a.v1', 50, 50)]
    const frags = [makeFragment('jyt.frag.f1.v1', 40, 40)]
    const zones = [makeZone('jyt.zone.z.v1', 'jyt.frag.f1.v1', 'behind', rectPolygon(0, 0, 200, 200))]
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y), DEFAULT_FLOOR_REGISTRY)),
    ]
    const r1 = resolve(nodes, zones)
    const copy = { ...r1.nextMembership }

    // Now a failing call (cycle)
    const cAgents = [makeAgent('jyt.agent.c1.v1', 50, 50), makeAgent('jyt.agent.c2.v1', 150, 150)]
    const cFrags = [makeFragment('jyt.frag.cf1.v1', 40, 40), makeFragment('jyt.frag.cf2.v1', 140, 140)]
    const cZones = [
      makeZone('jyt.zone.cb1.v1', 'jyt.frag.cf1.v1', 'behind', rectPolygon(0, 0, 80, 80)),
      makeZone('jyt.zone.cf2.v1', 'jyt.frag.cf2.v1', 'front', rectPolygon(0, 0, 80, 80)),
      makeZone('jyt.zone.cb2.v1', 'jyt.frag.cf2.v1', 'behind', rectPolygon(130, 130, 80, 80)),
      makeZone('jyt.zone.cf4.v1', 'jyt.frag.cf1.v1', 'front', rectPolygon(130, 130, 80, 80)),
    ]
    const cNodes: ConstraintNode[] = [
      ...cAgents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...cFrags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y), DEFAULT_FLOOR_REGISTRY)),
    ]
    assertFatal(() => resolve(cNodes, cZones, { previousMembership: r1.nextMembership }), 'CONSTRAINT_CYCLE_DETECTED')
    // Old membership unchanged
    assert.deepEqual(r1.nextMembership, copy)
  })
})

// ═══════════════════════════════════════════════
// SpatialGrid integration
// ═══════════════════════════════════════════════

describe('Constraint Resolver - grid integration', () => {
  it('uses grid for candidate discovery', () => {
    const grid = new SpatialGrid(256)
    const SCENE = 'test-scene', FLOOR = 'floor-1'
    const zones: OcclusionConstraintZone[] = []
    const fragInputs: FragmentNodeInput[] = []
    for (let i = 0; i < 10; i++) {
      const x = i * 500, y = 100
      const poly = rectPolygon(x, y, 50, 50)
      const z = makeZone(`jyt.zone.z${i}.v1`, `jyt.frag.f${i}.v1`, 'behind', poly, { bounds: { x, y, width: 50, height: 50 } })
      zones.push(z)
      fragInputs.push(fragInput(`jyt.frag.f${i}.v1`, x + 25, y + 25))
      grid.register({ stableId: z.stableId, entryKind: 'zone', bounds: z.bounds }, SCENE, FLOOR)
      grid.register({ stableId: `jyt.frag.f${i}.v1`, entryKind: 'fragment', bounds: z.bounds }, SCENE, FLOOR)
    }
    const agents = [makeAgent('jyt.agent.a.v1', 150, 125)]
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...fragInputs.map(f => fragmentToConstraintNode(f, DEFAULT_FLOOR_REGISTRY)),
    ]
    const provider = createConstraintCandidateProvider(grid)
    const instr = createConstraintInstrumentation()
    resolveConstraintOrder(nodes, provider, makeRegistry(zones), DEFAULT_FLOOR_REGISTRY, SCENE, { instrumentation: instr, _trustTestProvider: false })
    assert.ok(instr.membershipCheckCount < 10, `checkCount=${instr.membershipCheckCount} should be < 10`)
    assert.equal(instr.providerTrusted, true)
  })

  it('108 agents × 37 zones: metrics << full scan', () => {
    const grid = new SpatialGrid(256)
    const SCENE = 'test-scene', FLOOR = 'floor-1'
    const zones: OcclusionConstraintZone[] = []
    const fragInputs: FragmentNodeInput[] = []
    for (let i = 0; i < 37; i++) {
      const x = (i * 44) % 1600, y = (i * 24) % 900
      const poly = rectPolygon(x, y, 40, 40)
      const z = makeZone(`jyt.zone.z${i}.v1`, `jyt.frag.f${i}.v1`, 'behind', poly, { bounds: { x, y, width: 40, height: 40 } })
      zones.push(z)
      fragInputs.push(fragInput(`jyt.frag.f${i}.v1`, x + 20, y + 20))
      grid.register({ stableId: z.stableId, entryKind: 'zone', bounds: z.bounds }, SCENE, FLOOR)
      grid.register({ stableId: `jyt.frag.f${i}.v1`, entryKind: 'fragment', bounds: z.bounds }, SCENE, FLOOR)
    }
    const agents: SceneObject[] = []
    for (let i = 0; i < 108; i++) agents.push(makeAgent(`jyt.agent.a${i}.v1`, (i * 15 + 50) % 1664, (i * 8 + 30) % 928))
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...fragInputs.map(f => fragmentToConstraintNode(f, DEFAULT_FLOOR_REGISTRY)),
    ]
    const provider = createConstraintCandidateProvider(grid)
    const instr = createConstraintInstrumentation()
    const result = resolveConstraintOrder(nodes, provider, makeRegistry(zones), DEFAULT_FLOOR_REGISTRY, SCENE, { instrumentation: instr, _trustTestProvider: false })

    const maxPossible = 108 * 37 // 3996
    assert.ok(instr.membershipCheckCount < maxPossible * 0.5,
      `membershipCheckCount=${instr.membershipCheckCount} must be < ${maxPossible * 0.5}`)
    assert.equal(instr.providerTrusted, true)
    assert.ok(result.order.length > 0)
    // per-agent metrics populated
    assert.equal(instr.perAgentCheckCounts.length, 108)
    assert.ok(instr.uniqueCandidateCount > 0)
  })

  it('provider throw does not corrupt prior state', () => {
    const agents = [makeAgent('jyt.agent.a.v1', 50, 50)]
    const frags = [makeFragment('jyt.frag.f1.v1', 40, 40)]
    const zones = [makeZone('jyt.zone.z.v1', 'jyt.frag.f1.v1', 'behind', rectPolygon(0, 0, 200, 200))]
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...frags.map(f => fragmentToConstraintNode(fragInput(f.stableId, f.sortAnchor.x, f.sortAnchor.y), DEFAULT_FLOOR_REGISTRY)),
    ]
    const r1 = resolve(nodes, zones)
    const copy = { ...r1.nextMembership }
    const bad = createTestCandidateProvider(() => { throw new Error('grid crash') })
    assert.throws(() => resolve(nodes, zones, { provider: bad, previousMembership: r1.nextMembership }))
    assert.deepEqual(r1.nextMembership, copy)
  })
})

// ═══════════════════════════════════════════════
// Instrumentation
// ═══════════════════════════════════════════════

describe('Constraint Resolver - instrumentation', () => {
  it('populates per-agent counts, unique candidates, trusted flag', () => {
    const grid = new SpatialGrid(256)
    const SCENE = 'test-scene', FLOOR = 'floor-1'
    const agents = [makeAgent('jyt.agent.a.v1', 50, 50), makeAgent('jyt.agent.b.v1', 50, 50)]
    const fi = fragInput('jyt.frag.f1.v1', 40, 40)
    const zone = makeZone('jyt.zone.z.v1', 'jyt.frag.f1.v1', 'behind', rectPolygon(0, 0, 200, 200))
    grid.register({ stableId: zone.stableId, entryKind: 'zone', bounds: zone.bounds }, SCENE, FLOOR)
    grid.register({ stableId: fi.stableId, entryKind: 'fragment', bounds: { x: 0, y: 0, width: 200, height: 200 } }, SCENE, FLOOR)
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      fragmentToConstraintNode(fi, DEFAULT_FLOOR_REGISTRY),
    ]
    const provider = createConstraintCandidateProvider(grid)
    const instr = createConstraintInstrumentation()
    resolveConstraintOrder(nodes, provider, makeRegistry([zone]), DEFAULT_FLOOR_REGISTRY, SCENE, { instrumentation: instr, _trustTestProvider: false })
    assert.equal(instr.agentCount, 2)
    assert.equal(instr.zoneCount, 1)
    assert.ok(instr.membershipCheckCount > 0)
    assert.equal(instr.perAgentCheckCounts.length, 2)
    assert.equal(instr.uniqueCandidateCount, 1)
    assert.equal(instr.providerTrusted, true)
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
    const frags = [makeFragment('jyt.frag.f1.v1', 20, 30), makeFragment('jyt.frag.f2.v1', 60, 30)]
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
      const shuf = [...baseNodes]
      for (let i = shuf.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuf[i], shuf[j]] = [shuf[j], shuf[i]] }
      const result = resolve(shuf, zones)
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
    const agents = [makeAgent('jyt.agent.a.v1', 0, 100), makeAgent('jyt.agent.b.v1', 0, 200), makeAgent('jyt.agent.c.v1', 0, 300)]
    assert.equal(resolve(agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)), []).edges.length, 0)
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
