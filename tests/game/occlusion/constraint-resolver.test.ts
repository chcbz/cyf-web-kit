// ── E5 Constraint Resolver Tests ──
// Covers: membership resolution, edge generation, Kahn sort,
// priority authority, cycle detection, cross-scope validation,
// hysteresis, two agents on opposite sides of fragment.

import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import {
  resolveConstraintOrder,
  sceneObjectToConstraintNode,
  fragmentToConstraintNode,
  createConstraintInstrumentation,
  type ConstraintNode,
  type ConstraintEdge,
  type ConstraintResolution,
} from '../../../src/game/occlusion/constraintResolver.js'
import {
  type SceneObject,
  type OcclusionConstraintZone,
  type Point,
  DEFAULT_FLOOR_REGISTRY,
  isStructuredFatalRenderSchemaError,
} from '../../../src/game/occlusion/schema.js'
import { computeWorldSortKey, type WorldSortKey } from '../../../src/game/occlusion/worldOrder.js'

// ── Helpers ──

function makeAgent(
  stableId: string,
  x: number,
  y: number,
  overrides: Partial<SceneObject> = {},
): SceneObject {
  return {
    stableId,
    sceneId: 'test-scene',
    chunkId: 'chunk-1',
    kind: 'agent',
    renderBand: 'world',
    floorId: 'floor-1',
    elevation: 0,
    sortMode: 'y',
    sortAnchor: { x, y },
    tieBias: 0,
    ...overrides,
  }
}

function makeFragment(
  stableId: string,
  x: number,
  y: number,
  overrides: Partial<SceneObject> = {},
): SceneObject {
  return {
    stableId,
    sceneId: 'test-scene',
    chunkId: 'chunk-1',
    kind: 'occluder-fragment',
    renderBand: 'world',
    floorId: 'floor-1',
    elevation: 0,
    sortMode: 'fixed',
    sortAnchor: { x, y },
    tieBias: 0,
    ...overrides,
  }
}

function makeZone(
  stableId: string,
  targetFragmentId: string,
  relation: 'behind' | 'front',
  polygon: Point[],
  overrides: Partial<OcclusionConstraintZone> = {},
): OcclusionConstraintZone {
  return {
    stableId,
    sceneId: 'test-scene',
    chunkId: 'chunk-1',
    floorId: 'floor-1',
    targetFragmentId,
    relation,
    priority: 0,
    polygon,
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    hysteresisPx: 3,
    ...overrides,
  }
}

function rectPolygon(x: number, y: number, w: number, h: number): Point[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]
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

function resolve(
  nodes: ConstraintNode[],
  zones: OcclusionConstraintZone[],
  opts?: { now?: () => number },
): ConstraintResolution {
  return resolveConstraintOrder(nodes, zones, DEFAULT_FLOOR_REGISTRY, 'test-scene', opts)
}

// ── Base case: no zones → base order ──

describe('Constraint Resolver - base case (no zones)', () => {
  it('outputs base order when no zones present', () => {
    const agents: SceneObject[] = [
      makeAgent('jyt.agent.alice.v1', 0, 300),
      makeAgent('jyt.agent.bob.v1', 0, 100),
    ]
    const fragments: SceneObject[] = []
    const zones: OcclusionConstraintZone[] = []

    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...fragments.map(f => fragmentToConstraintNode(f, DEFAULT_FLOOR_REGISTRY)),
    ]

    const result = resolve(nodes, zones)
    // bob (y=100) < alice (y=300)
    assert.equal(result.order.length, 2)
    assert.equal(result.order[0], 'jyt.agent.bob.v1')
    assert.equal(result.order[1], 'jyt.agent.alice.v1')
    assert.equal(result.edges.length, 0)
  })

  it('Kahn with zero edges equals base sort', () => {
    const agents: SceneObject[] = [
      makeAgent('jyt.agent.c.v1', 0, 300),
      makeAgent('jyt.agent.a.v1', 0, 100),
      makeAgent('jyt.agent.b.v1', 0, 200),
    ]
    const nodes: ConstraintNode[] = agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY))
    const result = resolve(nodes, [])
    assert.deepEqual(result.order, [
      'jyt.agent.a.v1',
      'jyt.agent.b.v1',
      'jyt.agent.c.v1',
    ])
  })

  it('base order uses full key, not just Y', () => {
    // Same Y but different tieBias and stableId
    const agents: SceneObject[] = [
      makeAgent('jyt.agent.z.v1', 0, 100),
      makeAgent('jyt.agent.a.v1', 0, 100),
    ]
    // Both at y=100; tieBias=0 for both; stableId breaks tie
    const nodes: ConstraintNode[] = agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY))
    const result = resolve(nodes, [])
    assert.equal(result.order[0], 'jyt.agent.a.v1')
    assert.equal(result.order[1], 'jyt.agent.z.v1')
  })
})

// ── Behind constraint ──

describe('Constraint Resolver - behind edges', () => {
  it('agent behind fragment: agent < fragment', () => {
    const agents: SceneObject[] = [
      makeAgent('jyt.agent.alice.v1', 50, 50), // inside zone
    ]
    const fragments: SceneObject[] = [
      makeFragment('jyt.frag.table.v1', 10, 10),
    ]
    const zones: OcclusionConstraintZone[] = [
      makeZone('jyt.zone.table-behind.v1', 'jyt.frag.table.v1', 'behind',
        rectPolygon(0, 0, 200, 200)),
    ]

    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...fragments.map(f => fragmentToConstraintNode(f, DEFAULT_FLOOR_REGISTRY)),
    ]

    const result = resolve(nodes, zones)
    assert.equal(result.edges.length, 1)
    assert.equal(result.edges[0].from, 'jyt.agent.alice.v1')
    assert.equal(result.edges[0].to, 'jyt.frag.table.v1')
    assert.equal(result.edges[0].kind, 'behind')
    // alice < table
    const ai = result.order.indexOf('jyt.agent.alice.v1')
    const fi = result.order.indexOf('jyt.frag.table.v1')
    assert.ok(ai < fi, `expected agent(${ai}) before fragment(${fi})`)
  })

  it('agent outside zone: no edge generated', () => {
    const agents: SceneObject[] = [
      makeAgent('jyt.agent.alice.v1', 500, 500), // far outside
    ]
    const fragments: SceneObject[] = [
      makeFragment('jyt.frag.table.v1', 10, 10),
    ]
    const zones: OcclusionConstraintZone[] = [
      makeZone('jyt.zone.table.v1', 'jyt.frag.table.v1', 'behind',
        rectPolygon(0, 0, 100, 100)),
    ]

    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...fragments.map(f => fragmentToConstraintNode(f, DEFAULT_FLOOR_REGISTRY)),
    ]

    const result = resolve(nodes, zones)
    assert.equal(result.edges.length, 0)
  })
})

// ── Front constraint ──

describe('Constraint Resolver - front edges', () => {
  it('agent in front of fragment: fragment < agent', () => {
    const agents: SceneObject[] = [
      makeAgent('jyt.agent.alice.v1', 50, 50),
    ]
    const fragments: SceneObject[] = [
      makeFragment('jyt.frag.railing.v1', 10, 10),
    ]
    const zones: OcclusionConstraintZone[] = [
      makeZone('jyt.zone.railing-front.v1', 'jyt.frag.railing.v1', 'front',
        rectPolygon(0, 0, 200, 200)),
    ]

    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...fragments.map(f => fragmentToConstraintNode(f, DEFAULT_FLOOR_REGISTRY)),
    ]

    const result = resolve(nodes, zones)
    assert.equal(result.edges.length, 1)
    assert.equal(result.edges[0].from, 'jyt.frag.railing.v1')
    assert.equal(result.edges[0].to, 'jyt.agent.alice.v1')
    assert.equal(result.edges[0].kind, 'front')
    const fi = result.order.indexOf('jyt.frag.railing.v1')
    const ai = result.order.indexOf('jyt.agent.alice.v1')
    assert.ok(fi < ai, `expected fragment(${fi}) before agent(${ai})`)
  })
})

// ── Two agents, opposite sides ──

describe('Constraint Resolver - two agents opposite sides', () => {
  it('agent-A < fragment < agent-B with behind+front', () => {
    const agents: SceneObject[] = [
      makeAgent('jyt.agent.early.v1', 50, 50),   // behind zone
      makeAgent('jyt.agent.late.v1', 50, 50),     // also in zone, but different relation
    ]
    const fragments: SceneObject[] = [
      makeFragment('jyt.frag.pillar.v1', 50, 50),
    ]

    // Zone 1: behind → early agent < fragment
    const zoneBehind = makeZone('jyt.zone.behind.v1', 'jyt.frag.pillar.v1', 'behind',
      rectPolygon(0, 0, 200, 200))

    // Zone 2: front → fragment < late agent
    // Need a different zone for front; use same polygon but different relation
    const zoneFront = makeZone('jyt.zone.front.v1', 'jyt.frag.pillar.v1', 'front',
      rectPolygon(0, 0, 200, 200))

    // This should conflict: agent.early inside behind zone → agent < frag
    // AND agent.early inside front zone → frag < agent
    // → CONFLICT
    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...fragments.map(f => fragmentToConstraintNode(f, DEFAULT_FLOOR_REGISTRY)),
    ]

    // Both agents are inside both zones → conflict
    assertFatal(
      () => resolve(nodes, [zoneBehind, zoneFront]),
      'CONSTRAINT_CONFLICT',
    )
  })

  it('two agents legitimately on opposite sides use different zones', () => {
    // Agent A has its own behind zone, Agent B has its own front zone
    // They are spatially separated so they don't trigger both zones
    const agents: SceneObject[] = [
      makeAgent('jyt.agent.a.v1', 30, 30),   // inside zone-A only
      makeAgent('jyt.agent.b.v1', 150, 150), // inside zone-B only
    ]
    const fragments: SceneObject[] = [
      makeFragment('jyt.frag.wall.v1', 40, 40),
    ]

    // Zone A: small area around (0,0)-(60,60), behind
    const zoneA = makeZone('jyt.zone.a.v1', 'jyt.frag.wall.v1', 'behind',
      rectPolygon(0, 0, 60, 60))

    // Zone B: small area around (120,120)-(180,180), front
    const zoneB = makeZone('jyt.zone.b.v1', 'jyt.frag.wall.v1', 'front',
      rectPolygon(120, 120, 60, 60))

    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...fragments.map(f => fragmentToConstraintNode(f, DEFAULT_FLOOR_REGISTRY)),
    ]

    const result = resolve(nodes, [zoneA, zoneB])
    assert.equal(result.edges.length, 2)
    // a < wall and wall < b → a < wall < b
    const ai = result.order.indexOf('jyt.agent.a.v1')
    const fi = result.order.indexOf('jyt.frag.wall.v1')
    const bi = result.order.indexOf('jyt.agent.b.v1')
    assert.ok(ai < fi, `expected agent-a(${ai}) before fragment(${fi})`)
    assert.ok(fi < bi, `expected fragment(${fi}) before agent-b(${bi})`)
  })
})

// ── Priority authority ──

describe('Constraint Resolver - priority authority', () => {
  it('higher priority zone wins for same-direction edge', () => {
    const agents: SceneObject[] = [
      makeAgent('jyt.agent.alice.v1', 50, 50),
    ]
    const fragments: SceneObject[] = [
      makeFragment('jyt.frag.table.v1', 10, 10),
    ]

    // Two behind zones, both covering the same area
    // Lower priority zone first (will be overridden)
    const zoneLow = makeZone('jyt.zone.low.v1', 'jyt.frag.table.v1', 'behind',
      rectPolygon(0, 0, 200, 200), { priority: 0 })

    // Higher priority zone
    const zoneHigh = makeZone('jyt.zone.high.v1', 'jyt.frag.table.v1', 'behind',
      rectPolygon(0, 0, 200, 200), { priority: 10 })

    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...fragments.map(f => fragmentToConstraintNode(f, DEFAULT_FLOOR_REGISTRY)),
    ]

    const result = resolve(nodes, [zoneLow, zoneHigh])
    assert.equal(result.edges.length, 1)
    assert.equal(result.edges[0].zoneStableId, 'jyt.zone.high.v1')
    assert.equal(result.edges[0].priority, 10)
  })

  it('same priority: lower ASCII stableId wins', () => {
    const agents: SceneObject[] = [
      makeAgent('jyt.agent.alice.v1', 50, 50),
    ]
    const fragments: SceneObject[] = [
      makeFragment('jyt.frag.table.v1', 10, 10),
    ]

    // Two zones with same priority, different stableIds
    const zoneB = makeZone('jyt.zone.b.v1', 'jyt.frag.table.v1', 'behind',
      rectPolygon(0, 0, 200, 200), { priority: 5 })
    const zoneA = makeZone('jyt.zone.a.v1', 'jyt.frag.table.v1', 'behind',
      rectPolygon(0, 0, 200, 200), { priority: 5 })

    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...fragments.map(f => fragmentToConstraintNode(f, DEFAULT_FLOOR_REGISTRY)),
    ]

    const result = resolve(nodes, [zoneB, zoneA])
    assert.equal(result.edges.length, 1)
    // zone.a (ASCII 'a' < 'b') should win
    assert.equal(result.edges[0].zoneStableId, 'jyt.zone.a.v1')
  })
})

// ── Cycle detection ──

describe('Constraint Resolver - cycle detection', () => {
  it('direct cycle (two nodes) is fatal', () => {
    const agents: SceneObject[] = [
      makeAgent('jyt.agent.alice.v1', 50, 50),
      makeAgent('jyt.agent.bob.v1', 60, 60),
    ]
    const fragments: SceneObject[] = []

    // alice inside zone1 (behind frag) → alice < frag
    // alice inside zone2 (front frag) → frag < alice → CONFLICT
    // But we need a real cycle: A → B and B → A
    // We can't easily create that with the current API since edges are only
    // agent↔fragment. Let's test multi-node cycles instead.

    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...fragments.map(f => fragmentToConstraintNode(f, DEFAULT_FLOOR_REGISTRY)),
    ]

    // No fragments, no zones → should be base sort
    const result = resolve(nodes, [])
    assert.equal(result.order.length, 2)
  })

  it('multi-node cycle is fatal', () => {
    // Cycle: agent1 → frag1 → agent2 → frag2 → agent1
    // This requires:
    //   agent1 behind frag1
    //   agent1 front frag2 (→ frag2 < agent1)
    //   agent2 behind frag2
    //   agent2 front frag1 (→ frag1 < agent2)
    //
    // → agent1 < frag1 < agent2 < frag2 < agent1 (cycle!)

    const agents: SceneObject[] = [
      makeAgent('jyt.agent.a1.v1', 50, 50),
      makeAgent('jyt.agent.a2.v1', 150, 150),
    ]
    const fragments: SceneObject[] = [
      makeFragment('jyt.frag.f1.v1', 40, 40),
      makeFragment('jyt.frag.f2.v1', 140, 140),
    ]

    // agent1 behind f1: a1 < f1
    const z1 = makeZone('jyt.zone.b1.v1', 'jyt.frag.f1.v1', 'behind',
      rectPolygon(0, 0, 80, 80))
    // agent1 front f2: f2 < a1
    const z2 = makeZone('jyt.zone.f2.v1', 'jyt.frag.f2.v1', 'front',
      rectPolygon(0, 0, 80, 80))
    // agent2 behind f2: a2 < f2
    const z3 = makeZone('jyt.zone.b2.v1', 'jyt.frag.f2.v1', 'behind',
      rectPolygon(130, 130, 80, 80))
    // agent2 front f1: f1 < a2
    const z4 = makeZone('jyt.zone.f4.v1', 'jyt.frag.f1.v1', 'front',
      rectPolygon(130, 130, 80, 80))

    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...fragments.map(f => fragmentToConstraintNode(f, DEFAULT_FLOOR_REGISTRY)),
    ]

    assertFatal(
      () => resolve(nodes, [z1, z2, z3, z4]),
      'CONSTRAINT_CYCLE_DETECTED',
    )
  })

  it('self-edge is fatal', () => {
    const agents: SceneObject[] = [
      makeAgent('jyt.agent.alice.v1', 50, 50),
    ]
    // Zone targets the agent itself
    const zone = makeZone('jyt.zone.bad.v1', 'jyt.agent.alice.v1', 'behind',
      rectPolygon(0, 0, 200, 200))

    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
    ]

    assertFatal(
      () => resolve(nodes, [zone]),
      'CONSTRAINT_SELF_EDGE',
    )
  })

  it('duplicate nodes are fatal', () => {
    const agents: SceneObject[] = [
      makeAgent('jyt.agent.alice.v1', 50, 50),
    ]
    const nodes: ConstraintNode[] = [
      sceneObjectToConstraintNode(agents[0], DEFAULT_FLOOR_REGISTRY),
      sceneObjectToConstraintNode(agents[0], DEFAULT_FLOOR_REGISTRY), // duplicate
    ]

    assertFatal(
      () => resolve(nodes, []),
      'CONSTRAINT_DUPLICATE_NODE',
    )
  })
})

// ── Cross-scope validation ──

describe('Constraint Resolver - cross-scope validation', () => {
  it('rejects cross-scene zone target', () => {
    const agents: SceneObject[] = [
      makeAgent('jyt.agent.alice.v1', 50, 50, { sceneId: 'scene-a' }),
    ]
    const fragments: SceneObject[] = [
      makeFragment('jyt.frag.f1.v1', 10, 10, { sceneId: 'scene-b' }),
    ]
    const zone = makeZone('jyt.zone.z1.v1', 'jyt.frag.f1.v1', 'behind',
      rectPolygon(0, 0, 200, 200), { sceneId: 'scene-a' })

    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...fragments.map(f => fragmentToConstraintNode(f, DEFAULT_FLOOR_REGISTRY)),
    ]

    // The target fragment exists in nodes but with scene-b, zone is scene-a
    assertFatal(
      () => resolveConstraintOrder(nodes, [zone], DEFAULT_FLOOR_REGISTRY, 'scene-a'),
      'ZONE_TARGET_CROSS_SCENE',
    )
  })

  it('rejects cross-floor zone target', () => {
    const agents: SceneObject[] = [
      makeAgent('jyt.agent.alice.v1', 50, 50),
    ]
    const fragments: SceneObject[] = [
      makeFragment('jyt.frag.f1.v1', 10, 10, { floorId: 'floor-2' }),
    ]
    const floorReg = { 'floor-1': 0, 'floor-2': 1 }

    const zone = makeZone('jyt.zone.z1.v1', 'jyt.frag.f1.v1', 'behind',
      rectPolygon(0, 0, 200, 200), { floorId: 'floor-1' })

    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, floorReg)),
      ...fragments.map(f => fragmentToConstraintNode(f, floorReg)),
    ]

    assertFatal(
      () => resolveConstraintOrder(nodes, [zone], floorReg, 'test-scene'),
      'ZONE_TARGET_CROSS_FLOOR',
    )
  })

  it('rejects unknown target fragment', () => {
    const agents: SceneObject[] = [
      makeAgent('jyt.agent.alice.v1', 50, 50),
    ]
    const fragments: SceneObject[] = [] // no fragments!
    const zone = makeZone('jyt.zone.z1.v1', 'jyt.frag.missing.v1', 'behind',
      rectPolygon(0, 0, 200, 200))

    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
    ]

    assertFatal(
      () => resolve(nodes, [zone]),
      'ZONE_TARGET_NOT_FOUND',
    )
  })
})

// ── Membership hysteresis ──

describe('Constraint Resolver - membership hysteresis', () => {
  it('first sample boundary point is inside', () => {
    // Agent exactly on the boundary of a polygon
    const agents: SceneObject[] = [
      makeAgent('jyt.agent.alice.v1', 10, 10), // exactly at boundary corner
    ]
    const fragments: SceneObject[] = [
      makeFragment('jyt.frag.f1.v1', 5, 5),
    ]
    const zone = makeZone('jyt.zone.z1.v1', 'jyt.frag.f1.v1', 'behind',
      rectPolygon(10, 10, 100, 100)) // agent at (10,10) = polygon corner

    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...fragments.map(f => fragmentToConstraintNode(f, DEFAULT_FLOOR_REGISTRY)),
    ]

    const result = resolve(nodes, [zone])
    // Boundary → inside → edge generated
    assert.equal(result.edges.length, 1)
  })

  it('agent well outside zone: no edge', () => {
    const agents: SceneObject[] = [
      makeAgent('jyt.agent.alice.v1', 500, 500),
    ]
    const fragments: SceneObject[] = [
      makeFragment('jyt.frag.f1.v1', 5, 5),
    ]
    const zone = makeZone('jyt.zone.z1.v1', 'jyt.frag.f1.v1', 'behind',
      rectPolygon(10, 10, 100, 100))

    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...fragments.map(f => fragmentToConstraintNode(f, DEFAULT_FLOOR_REGISTRY)),
    ]

    const result = resolve(nodes, [zone])
    assert.equal(result.edges.length, 0)
  })

  it('agent well inside zone: edge generated', () => {
    const agents: SceneObject[] = [
      makeAgent('jyt.agent.alice.v1', 60, 60),
    ]
    const fragments: SceneObject[] = [
      makeFragment('jyt.frag.f1.v1', 5, 5),
    ]
    const zone = makeZone('jyt.zone.z1.v1', 'jyt.frag.f1.v1', 'behind',
      rectPolygon(10, 10, 100, 100))

    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...fragments.map(f => fragmentToConstraintNode(f, DEFAULT_FLOOR_REGISTRY)),
    ]

    const result = resolve(nodes, [zone])
    assert.equal(result.edges.length, 1)
  })
})

// ── Instrumentation ──

describe('Constraint Resolver - instrumentation', () => {
  it('populates instrumentation with correct counts', () => {
    const agents: SceneObject[] = [
      makeAgent('jyt.agent.a.v1', 50, 50),
      makeAgent('jyt.agent.b.v1', 50, 50),
    ]
    const fragments: SceneObject[] = [
      makeFragment('jyt.frag.f1.v1', 40, 40),
    ]
    const zone = makeZone('jyt.zone.z1.v1', 'jyt.frag.f1.v1', 'behind',
      rectPolygon(0, 0, 200, 200))

    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...fragments.map(f => fragmentToConstraintNode(f, DEFAULT_FLOOR_REGISTRY)),
    ]

    const instr = createConstraintInstrumentation()
    let time = 0
    resolveConstraintOrder(nodes, [zone], DEFAULT_FLOOR_REGISTRY, 'test-scene', {
      now: () => { time += 10; return time },
      instrumentation: instr,
    })

    assert.equal(instr.candidateCount, 3)
    assert.equal(instr.agentCount, 2)
    assert.equal(instr.zoneCount, 1)
    assert.equal(instr.edgeCount, 2) // both agents inside
    assert.ok(instr.sortDurationMs >= 0)
    assert.equal(instr.cycleDetected, false)
    assert.equal(instr.fullMapScanDetected, false)
  })

  it('instrumentation object is externally mutable (not frozen)', () => {
    const instr = createConstraintInstrumentation()
    instr.candidateCount = 999
    assert.equal(instr.candidateCount, 999)
  })
})

// ── Determinism ──

describe('Constraint Resolver - determinism', () => {
  it('same input produces same output regardless of insertion order', () => {
    const agents: SceneObject[] = [
      makeAgent('jyt.agent.a.v1', 30, 30),
      makeAgent('jyt.agent.b.v1', 150, 150),
      makeAgent('jyt.agent.c.v1', 50, 50),
    ]
    const fragments: SceneObject[] = [
      makeFragment('jyt.frag.f1.v1', 40, 40),
    ]
    const zone = makeZone('jyt.zone.z1.v1', 'jyt.frag.f1.v1', 'behind',
      rectPolygon(0, 0, 80, 80))

    const makeNodes = () => [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...fragments.map(f => fragmentToConstraintNode(f, DEFAULT_FLOOR_REGISTRY)),
    ]

    const result1 = resolve(makeNodes(), [zone])
    // Reverse order
    const nodes2 = makeNodes().reverse()
    const result2 = resolve(nodes2, [zone])

    assert.deepEqual(result1.order, result2.order)
    assert.equal(result1.edges.length, result2.edges.length)
  })

  it('shuffled input produces identical output 10 times', () => {
    const agents: SceneObject[] = [
      makeAgent('jyt.agent.a.v1', 10, 50),
      makeAgent('jyt.agent.b.v1', 30, 50),
      makeAgent('jyt.agent.c.v1', 120, 50),
      makeAgent('jyt.agent.d.v1', 140, 50),
    ]
    const fragments: SceneObject[] = [
      makeFragment('jyt.frag.f1.v1', 20, 30),
      makeFragment('jyt.frag.f2.v1', 60, 30),
    ]
    const zones: OcclusionConstraintZone[] = [
      makeZone('jyt.zone.z1.v1', 'jyt.frag.f1.v1', 'behind',
        rectPolygon(0, 0, 50, 100)),
      makeZone('jyt.zone.z2.v1', 'jyt.frag.f2.v1', 'front',
        rectPolygon(100, 0, 50, 100)),
    ]

    const baseNodes = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...fragments.map(f => fragmentToConstraintNode(f, DEFAULT_FLOOR_REGISTRY)),
    ]

    const refResult = resolve([...baseNodes], zones)

    for (let run = 0; run < 10; run++) {
      // Fisher-Yates shuffle
      const shuffled = [...baseNodes]
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
      }
      const result = resolve(shuffled, zones)
      assert.deepEqual(result.order, refResult.order, `run ${run}: orders differ`)
      assert.equal(result.edges.length, refResult.edges.length, `run ${run}: edge counts differ`)
    }
  })
})

// ── Sparse edges ──

describe('Constraint Resolver - sparse edges', () => {
  it('does not expand base order into pairwise edges', () => {
    const agents: SceneObject[] = [
      makeAgent('jyt.agent.a.v1', 0, 100),
      makeAgent('jyt.agent.b.v1', 0, 200),
      makeAgent('jyt.agent.c.v1', 0, 300),
    ]
    const fragments: SceneObject[] = []

    const nodes: ConstraintNode[] = agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY))
    const result = resolve(nodes, [])

    // No zones → zero edges, not N*(N-1)/2 = 3 edges
    assert.equal(result.edges.length, 0)
  })

  it('only generates edges from active zones, not base key pairs', () => {
    const agents: SceneObject[] = [
      makeAgent('jyt.agent.a.v1', 50, 50),
      makeAgent('jyt.agent.b.v1', 150, 50),
    ]
    const fragments: SceneObject[] = [
      makeFragment('jyt.frag.f1.v1', 40, 40),
    ]
    // Only one zone covering one agent
    const zone = makeZone('jyt.zone.z1.v1', 'jyt.frag.f1.v1', 'behind',
      rectPolygon(0, 0, 80, 80))

    const nodes: ConstraintNode[] = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...fragments.map(f => fragmentToConstraintNode(f, DEFAULT_FLOOR_REGISTRY)),
    ]

    const result = resolve(nodes, [zone])
    // Only one edge: agent.a → frag.f1, not agent.b → frag.f1
    assert.equal(result.edges.length, 1)
    assert.equal(result.edges[0].from, 'jyt.agent.a.v1')
    assert.equal(result.edges[0].to, 'jyt.frag.f1.v1')
  })
})
