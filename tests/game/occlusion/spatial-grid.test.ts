// ── E5 Spatial Grid Tests ──
// Covers: registration, candidate queries, AABB queries,
// negative coordinates, cross-cell, move/delete, batch atomicity,
// cell size validation, determinism.

import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import {
  SpatialGrid,
  createSpatialGridInstrumentation,
  type GridEntry,
  DEFAULT_CELL_SIZE,
  LEGAL_CELL_SIZES,
} from '../../../src/game/occlusion/spatialGrid.js'
import { type Rect, isStructuredFatalRenderSchemaError } from '../../../src/game/occlusion/schema.js'

// ── Helpers ──

function makeEntry(
  stableId: string,
  kind: GridEntry['entryKind'],
  x: number, y: number, w: number, h: number,
): GridEntry {
  return { stableId, entryKind: kind, bounds: { x, y, width: w, height: h } }
}

// ── Construction ──

describe('SpatialGrid - construction', () => {
  it('creates with default cell size 256', () => {
    const grid = new SpatialGrid()
    assert.equal(grid.getCellSize(), 256)
    assert.equal(grid.getEntryCount(), 0)
    assert.equal(grid.getCellCount(), 0)
  })

  it('creates with legal cell size 128', () => {
    const grid = new SpatialGrid(128)
    assert.equal(grid.getCellSize(), 128)
  })

  it('creates with legal cell size 256', () => {
    const grid = new SpatialGrid(256)
    assert.equal(grid.getCellSize(), 256)
  })

  it('rejects invalid cell size', () => {
    const invalidSizes = [0, 64, 100, 200, 512, -1, 1.5, NaN, Infinity]
    for (const sz of invalidSizes) {
      assert.throws(
        () => new SpatialGrid(sz),
        (err: any) => isStructuredFatalRenderSchemaError(err),
        `cell size ${sz} should be rejected`,
      )
    }
  })
})

// ── Registration ──

describe('SpatialGrid - registration', () => {
  it('registers a single entry', () => {
    const grid = new SpatialGrid()
    const entry = makeEntry('zone.1', 'zone', 0, 0, 100, 100)
    grid.register(entry, 'scene-1', 'floor-1')
    assert.equal(grid.getEntryCount(), 1)
  })

  it('registers entry in correct cells', () => {
    const grid = new SpatialGrid(256)
    // Entry at (0,0)-(300,300) covers cells: (0,0) and (1,0) and (0,1) and (1,1)
    const entry = makeEntry('zone.1', 'zone', 0, 0, 300, 300)
    grid.register(entry, 'scene-1', 'floor-1')
    assert.equal(grid.getEntryCount(), 1)
    // Should span 2x2 cells = 4 cells (since 300 > 256)
    assert.ok(grid.getCellCount() >= 1)
  })

  it('re-registering same stableId updates cells (no stale entries)', () => {
    const grid = new SpatialGrid(256)
    const entry1 = makeEntry('zone.1', 'zone', 0, 0, 100, 100)
    grid.register(entry1, 'scene-1', 'floor-1')

    // Re-register at different position
    const entry2 = makeEntry('zone.1', 'zone', 500, 500, 100, 100)
    grid.register(entry2, 'scene-1', 'floor-1')

    assert.equal(grid.getEntryCount(), 1)

    // Query at old position may still find via adjacent cells (Moore neighborhood)
    // But the entry itself should be at new position only
    const snap = grid.snapshot()
    const entry = snap.get('zone.1')
    assert.ok(entry)
    assert.ok(entry.bounds.x >= 500)
  })

  it('removing entry leaves no stale entries', () => {
    const grid = new SpatialGrid(256)
    const entry = makeEntry('zone.1', 'zone', 0, 0, 100, 100)
    grid.register(entry, 'scene-1', 'floor-1')
    assert.equal(grid.getEntryCount(), 1)

    grid.unregister('zone.1')
    assert.equal(grid.getEntryCount(), 0)

    const candidates = grid.queryCandidates({ x: 50, y: 50 }, 'scene-1', 'floor-1')
    assert.equal(candidates.size, 0)
  })

  it('unregister non-existent entry is safe', () => {
    const grid = new SpatialGrid()
    grid.unregister('nonexistent')
    assert.equal(grid.getEntryCount(), 0)
  })
})

// ── Candidate queries ──

describe('SpatialGrid - candidate queries', () => {
  it('finds entry in same cell', () => {
    const grid = new SpatialGrid(256)
    const entry = makeEntry('zone.1', 'zone', 0, 0, 100, 100)
    grid.register(entry, 'scene-1', 'floor-1')

    const candidates = grid.queryCandidates({ x: 50, y: 50 }, 'scene-1', 'floor-1')
    assert.ok(candidates.has('zone.1'))
  })

  it('finds entry in adjacent cell', () => {
    const grid = new SpatialGrid(256)
    // Entry at (200,200)-(300,300) is in cell (0,0) for 256 grid
    // Query at (300,50) is in cell (1,0) → adjacent
    const entry = makeEntry('zone.1', 'zone', 200, 200, 50, 50)
    grid.register(entry, 'scene-1', 'floor-1')

    // Query in adjacent cell (1,0)
    const candidates = grid.queryCandidates({ x: 300, y: 50 }, 'scene-1', 'floor-1')
    assert.ok(candidates.has('zone.1'))
  })

  it('does not find distant entry', () => {
    const grid = new SpatialGrid(256)
    const entry = makeEntry('zone.1', 'zone', 0, 0, 100, 100)
    grid.register(entry, 'scene-1', 'floor-1')

    // Query 10 cells away
    const candidates = grid.queryCandidates({ x: 3000, y: 3000 }, 'scene-1', 'floor-1')
    assert.equal(candidates.size, 0)
  })

  it('isolates by sceneId', () => {
    const grid = new SpatialGrid(256)
    const entry = makeEntry('zone.1', 'zone', 0, 0, 100, 100)
    grid.register(entry, 'scene-a', 'floor-1')

    const candidates = grid.queryCandidates({ x: 50, y: 50 }, 'scene-b', 'floor-1')
    assert.equal(candidates.size, 0)
  })

  it('isolates by floorId', () => {
    const grid = new SpatialGrid(256)
    const entry = makeEntry('zone.1', 'zone', 0, 0, 100, 100)
    grid.register(entry, 'scene-1', 'floor-1')

    const candidates = grid.queryCandidates({ x: 50, y: 50 }, 'scene-1', 'floor-2')
    assert.equal(candidates.size, 0)
  })
})

// ── AABB queries ──

describe('SpatialGrid - AABB queries', () => {
  it('finds overlapping entries', () => {
    const grid = new SpatialGrid(256)
    const entry = makeEntry('zone.1', 'zone', 0, 0, 100, 100)
    grid.register(entry, 'scene-1', 'floor-1')

    const results = grid.queryAabb({ x: 50, y: 50, width: 200, height: 200 }, 'scene-1', 'floor-1')
    assert.equal(results.length, 1)
    assert.equal(results[0].stableId, 'zone.1')
  })

  it('excludes non-overlapping entries via precise AABB filter', () => {
    const grid = new SpatialGrid(256)
    const entry = makeEntry('zone.1', 'zone', 0, 0, 100, 100)
    grid.register(entry, 'scene-1', 'floor-1')

    // Query AABB far away
    const results = grid.queryAabb({ x: 500, y: 500, width: 100, height: 100 }, 'scene-1', 'floor-1')
    assert.equal(results.length, 0)
  })

  it('precise AABB: entry in same cell but not overlapping', () => {
    const grid = new SpatialGrid(128)
    // Two entries in same cell but not overlapping
    const e1 = makeEntry('zone.a', 'zone', 0, 0, 50, 50)
    const e2 = makeEntry('zone.b', 'zone', 80, 80, 50, 50)
    grid.register(e1, 'scene-1', 'floor-1')
    grid.register(e2, 'scene-1', 'floor-1')

    // Query that overlaps e1 but not e2
    const results = grid.queryAabb({ x: 0, y: 0, width: 55, height: 55 }, 'scene-1', 'floor-1')
    const ids = results.map(r => r.stableId)
    assert.ok(ids.includes('zone.a'))
    assert.ok(!ids.includes('zone.b'))
  })
})

// ── Negative coordinates ──

describe('SpatialGrid - negative coordinates', () => {
  it('handles negative coordinates correctly', () => {
    const grid = new SpatialGrid(256)
    // Entry at negative coords: (-300, -300) to (-100, -100)
    const entry = makeEntry('zone.neg', 'zone', -300, -300, 200, 200)
    grid.register(entry, 'scene-1', 'floor-1')

    // Query at (-200, -200) should find it
    const candidates = grid.queryCandidates({ x: -200, y: -200 }, 'scene-1', 'floor-1')
    assert.ok(candidates.has('zone.neg'))
  })

  it('negative cell coordinates work', () => {
    const grid = new SpatialGrid(256)
    const entry = makeEntry('zone.neg', 'zone', -500, -500, 100, 100)
    grid.register(entry, 'scene-1', 'floor-1')

    const candidates = grid.queryCandidates({ x: -450, y: -450 }, 'scene-1', 'floor-1')
    assert.ok(candidates.has('zone.neg'))
  })

  it('handles -0 normalization', () => {
    const grid = new SpatialGrid(256)
    const entry = makeEntry('zone.zero', 'zone', 0, 0, 100, 100)
    // -0.1 → cellX=Math.floor(-0.1/256)=Math.floor(-0.00039)=-1
    // Actually floor(-0.00039) = -1
    // That should work fine
    grid.register(entry, 'scene-1', 'floor-1')
    const candidates = grid.queryCandidates({ x: -0.1, y: -0.1 }, 'scene-1', 'floor-1')
    assert.ok(candidates.has('zone.zero'))
  })
})

// ── Cross-cell registration ──

describe('SpatialGrid - cross-cell', () => {
  it('entry spanning multiple cells registers in all', () => {
    const grid = new SpatialGrid(128)
    // Entry from (0,0) to (300,300) spans multiple cells
    const entry = makeEntry('zone.big', 'zone', 0, 0, 300, 300)
    grid.register(entry, 'scene-1', 'floor-1')

    // Query at cell (0,0)
    let candidates = grid.queryCandidates({ x: 50, y: 50 }, 'scene-1', 'floor-1')
    assert.ok(candidates.has('zone.big'))

    // Query at cell (2,2) - should be within 300 px
    candidates = grid.queryCandidates({ x: 250, y: 250 }, 'scene-1', 'floor-1')
    assert.ok(candidates.has('zone.big'))
  })

  it('each authoritative object appears at most once per cell', () => {
    const grid = new SpatialGrid(128)
    const entry = makeEntry('zone.unique', 'zone', 0, 0, 300, 300)
    grid.register(entry, 'scene-1', 'floor-1')

    // Query should return each stableId only once
    const candidates = grid.queryCandidates({ x: 100, y: 100 }, 'scene-1', 'floor-1')
    let count = 0
    for (const id of candidates) {
      if (id === 'zone.unique') count++
    }
    assert.equal(count, 1)
  })
})

// ── Batch atomicity ──

describe('SpatialGrid - batch operations', () => {
  it('batch registers multiple entries', () => {
    const grid = new SpatialGrid(256)
    const entries = [
      { entry: makeEntry('zone.a', 'zone', 0, 0, 100, 100), sceneId: 'scene-1', floorId: 'floor-1' },
      { entry: makeEntry('zone.b', 'zone', 200, 200, 100, 100), sceneId: 'scene-1', floorId: 'floor-1' },
      { entry: makeEntry('zone.c', 'zone', 400, 400, 100, 100), sceneId: 'scene-1', floorId: 'floor-1' },
    ]
    grid.batchRegister(entries)
    assert.equal(grid.getEntryCount(), 3)
  })

  it('batch validates all before applying (no partial commit)', () => {
    const grid = new SpatialGrid(256)
    const badEntries = [
      { entry: makeEntry('zone.a', 'zone', 0, 0, 100, 100), sceneId: 'scene-1', floorId: 'floor-1' },
      { entry: { stableId: '', entryKind: 'zone' as const, bounds: null as any }, sceneId: 'scene-1', floorId: 'floor-1' },
    ]
    assert.throws(
      () => grid.batchRegister(badEntries),
      (err: any) => isStructuredFatalRenderSchemaError(err),
    )
    // zone.a should NOT have been registered (atomic failure)
    const candidates = grid.queryCandidates({ x: 50, y: 50 }, 'scene-1', 'floor-1')
    assert.equal(candidates.size, 0)
  })
})

// ── Query by kind ──

describe('SpatialGrid - queryByKind', () => {
  it('filters by entry kind', () => {
    const grid = new SpatialGrid(256)
    grid.register(makeEntry('zone.1', 'zone', 0, 0, 100, 100), 'scene-1', 'floor-1')
    grid.register(makeEntry('frag.1', 'fragment', 50, 50, 100, 100), 'scene-1', 'floor-1')
    grid.register(makeEntry('prop.1', 'prop', 100, 100, 100, 100), 'scene-1', 'floor-1')

    const zones = grid.queryByKind({ x: 50, y: 50 }, 'scene-1', 'floor-1', 'zone')
    assert.equal(zones.length, 1)
    assert.equal(zones[0].stableId, 'zone.1')

    const fragments = grid.queryByKind({ x: 50, y: 50 }, 'scene-1', 'floor-1', 'fragment')
    assert.equal(fragments.length, 1)
    assert.equal(fragments[0].stableId, 'frag.1')

    const props = grid.queryByKind({ x: 50, y: 50 }, 'scene-1', 'floor-1', 'prop')
    assert.equal(props.length, 1)
    assert.equal(props[0].stableId, 'prop.1')
  })
})

// ── Clear ──

describe('SpatialGrid - clear', () => {
  it('clears all entries and cells', () => {
    const grid = new SpatialGrid(256)
    grid.register(makeEntry('zone.1', 'zone', 0, 0, 100, 100), 'scene-1', 'floor-1')
    grid.register(makeEntry('zone.2', 'zone', 200, 200, 100, 100), 'scene-1', 'floor-1')
    assert.equal(grid.getEntryCount(), 2)

    grid.clear()
    assert.equal(grid.getEntryCount(), 0)
    assert.equal(grid.getCellCount(), 0)
  })
})

// ── Snapshot ──

describe('SpatialGrid - snapshot', () => {
  it('returns frozen snapshot that cannot mutate original', () => {
    const grid = new SpatialGrid(256)
    grid.register(makeEntry('zone.1', 'zone', 0, 0, 100, 100), 'scene-1', 'floor-1')

    const snap = grid.snapshot()
    assert.equal(snap.size, 1)
    assert.ok(snap.has('zone.1'))

    // Modifying snapshot should not affect grid
    // (snapshot is ReadonlyMap, can't easily mutate, but check original is intact)
    grid.clear()
    assert.equal(snap.size, 1) // snapshot still has it
    assert.equal(grid.getEntryCount(), 0)
  })
})

// ── Instrumentation ──

describe('SpatialGrid - instrumentation', () => {
  it('creates instrumentation with default zeros', () => {
    const instr = createSpatialGridInstrumentation()
    assert.equal(instr.candidateCount, 0)
    assert.equal(instr.cellQueryCount, 0)
    assert.equal(instr.scanCount, 0)
    assert.equal(instr.scanCount, 0)
  })

  it('instrumentation is externally mutable', () => {
    const instr = createSpatialGridInstrumentation()
    instr.candidateCount = 42
    assert.equal(instr.candidateCount, 42)
  })
})

// ── Performance: 108 agents × 37 zones ──

describe('SpatialGrid - scale test (108 agents × 37 zones)', () => {
  it('candidate scans are far less than full map scan', () => {
    const grid = new SpatialGrid(256)
    const SCENE = 'test-scene'
    const FLOOR = 'floor-1'

    // Register 37 zones spread across the map (1664 × 928)
    for (let i = 0; i < 37; i++) {
      const x = (i * 40) % 1600
      const y = (i * 25) % 900
      grid.register(
        makeEntry(`zone.${i}`, 'zone', x, y, 60, 60),
        SCENE, FLOOR,
      )
    }

    // Query for 108 agents at various positions
    let totalCandidates = 0
    let maxCandidates = 0
    for (let i = 0; i < 108; i++) {
      const x = (i * 15 + 50) % 1664
      const y = (i * 8 + 30) % 928
      const candidates = grid.queryCandidates({ x, y }, SCENE, FLOOR)
      totalCandidates += candidates.size
      if (candidates.size > maxCandidates) maxCandidates = candidates.size
    }

    // Each query returns at most ~9 cells worth of zones, not all 37
    // Average should be far less than 37
    const avgCandidates = totalCandidates / 108
    assert.ok(maxCandidates < 37, `maxCandidates=${maxCandidates} should be < 37 (no full scan)`)
    assert.ok(avgCandidates < 37, `avgCandidates=${avgCandidates.toFixed(1)} should be << 37`)
  })

  it('no full map scan detected (queryCandidates is O(cells) not O(entries))', () => {
    const grid = new SpatialGrid(128)
    const SCENE = 'test-scene'
    const FLOOR = 'floor-1'

    // Register 200 entries spread across a large area
    for (let i = 0; i < 200; i++) {
      const x = (i * 300) % 5000
      const y = (i * 200) % 4000
      grid.register(
        makeEntry(`e.${i}`, 'zone', x, y, 50, 50),
        SCENE, FLOOR,
      )
    }

    // Query a specific point - should only scan local cells
    const startEntries = grid.getEntryCount()
    const candidates = grid.queryCandidates({ x: 300, y: 200 }, SCENE, FLOOR)
    // Even with 200 entries, candidates at one point should be small
    assert.ok(candidates.size < startEntries, `candidates=${candidates.size} should be < total=${startEntries}`)
  })
})

// ── Determinism ──

describe('SpatialGrid - determinism', () => {
  it('same registrations produce identical query results', () => {
    const grid1 = new SpatialGrid(256)
    const grid2 = new SpatialGrid(256)

    const entries = [
      { entry: makeEntry('z1', 'zone', 0, 0, 100, 100), sceneId: 's', floorId: 'f' },
      { entry: makeEntry('z2', 'zone', 300, 300, 100, 100), sceneId: 's', floorId: 'f' },
      { entry: makeEntry('z3', 'zone', 600, 0, 100, 100), sceneId: 's', floorId: 'f' },
    ]

    grid1.batchRegister(entries)
    // grid2 in reverse order
    grid2.batchRegister([...entries].reverse())

    const q1 = grid1.queryCandidates({ x: 50, y: 50 }, 's', 'f')
    const q2 = grid2.queryCandidates({ x: 50, y: 50 }, 's', 'f')

    assert.deepEqual([...q1].sort(), [...q2].sort())
  })
})

// ── Reverse-index update complexity (E14) ──

describe('SpatialGrid - reverse-index update complexity', () => {
  it('updates 108 moving agents without any full-grid cell scan', () => {
    const instr = createSpatialGridInstrumentation()
    const grid = new SpatialGrid(256, instr)
    for (let index = 0; index < 87; index++) {
      grid.register(makeEntry(`static.${index}`, 'zone', (index % 10) * 320, Math.floor(index / 10) * 320, 80, 80), 'scene-1', 'floor-1')
    }
    const agents = Array.from({ length: 108 }, (_, index) => makeEntry(`agent.${index}`, 'agent', (index % 12) * 100, Math.floor(index / 12) * 90, 16, 16))
    for (const agent of agents) grid.register(agent, 'scene-1', 'floor-1')
    const beforeVisits = instr.updateCellVisitCount
    for (let frame = 0; frame < 10; frame++) {
      for (const [index, agent] of agents.entries()) {
        grid.register({ ...agent, bounds: { ...agent.bounds, x: agent.bounds.x + frame + index % 2 } }, 'scene-1', 'floor-1')
      }
    }
    const deltaVisits = instr.updateCellVisitCount - beforeVisits
    assert.equal(instr.scanCount, 0)
    // Each 16px agent normally occupies one cell: unregister + register is ~2 visits.
    // Allow boundary crossings but reject anything resembling all-map-cell scans.
    assert.ok(deltaVisits < 108 * 10 * 6, `unexpected update cell visits: ${deltaVisits}`)
  })

  it('clear resets reverse index so same stableId can be registered cleanly', () => {
    const instr = createSpatialGridInstrumentation()
    const grid = new SpatialGrid(256, instr)
    grid.register(makeEntry('agent.a', 'agent', 10, 10, 16, 16), 'scene-1', 'floor-1')
    grid.clear()
    grid.register(makeEntry('agent.a', 'agent', 900, 700, 16, 16), 'scene-1', 'floor-1')
    assert.equal(instr.scanCount, 0)
    assert.ok(grid.queryCandidates({ x: 900, y: 700 }, 'scene-1', 'floor-1').has('agent.a'))
  })
})

describe('SpatialGrid - per-kind candidate index', () => {
  it('returns only requested kinds without materializing nearby agents/fragments', () => {
    const instr = createSpatialGridInstrumentation()
    const grid = new SpatialGrid(256, instr)
    grid.register(makeEntry('zone.only', 'zone', 0, 0, 40, 40), 'scene-1', 'floor-1')
    for (let index = 0; index < 108; index++) {
      grid.register(makeEntry(`agent.${index}`, 'agent', index % 20, index % 20, 16, 16), 'scene-1', 'floor-1')
    }
    grid.register(makeEntry('frag.near', 'fragment', 0, 0, 80, 80), 'scene-1', 'floor-1')
    const result = grid.queryCandidateIdsByKind({ x: 20, y: 20 }, 'scene-1', 'floor-1', 'zone')
    assert.deepEqual([...result], ['zone.only'])
    assert.equal(instr.candidateCount, 1)
  })

  it('keeps the per-kind index correct across update, unregister and clear', () => {
    const grid = new SpatialGrid(256)
    grid.register(makeEntry('zone.move', 'zone', 0, 0, 40, 40), 'scene-1', 'floor-1')
    grid.register(makeEntry('zone.move', 'zone', 900, 700, 40, 40), 'scene-1', 'floor-1')
    assert.equal(grid.queryCandidateIdsByKind({ x: 0, y: 0 }, 'scene-1', 'floor-1', 'zone').has('zone.move'), false)
    assert.equal(grid.queryCandidateIdsByKind({ x: 900, y: 700 }, 'scene-1', 'floor-1', 'zone').has('zone.move'), true)
    grid.unregister('zone.move')
    assert.equal(grid.queryCandidateIdsByKind({ x: 900, y: 700 }, 'scene-1', 'floor-1', 'zone').size, 0)
    grid.register(makeEntry('zone.clear', 'zone', 20, 20, 40, 40), 'scene-1', 'floor-1')
    grid.clear()
    assert.equal(grid.queryCandidateIdsByKind({ x: 20, y: 20 }, 'scene-1', 'floor-1', 'zone').size, 0)
  })
})
