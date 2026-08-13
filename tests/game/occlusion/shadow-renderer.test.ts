// ── E6 Shadow Renderer Tests (E16A V2-native) ──
// Covers: P1 debug-only enable, P2 lazy init, P2 deep-immutable snapshot,
// P2 truncation report, P2 production counters immutable copy,
// P2 both-off zero construct, map reload recovery, and the E16A removal of
// migration-only V1/behindMask semantics.

import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import {
  createShadowRenderer,
  collectRuntimeSnapshots,
  parseOcclusionDebugFlag,
  type RuntimeObjectSnapshot,
} from '../../../src/game/occlusion/shadowRenderer.js'

// ── Runtime snapshot helpers ──

function makeRuntimeAgent(id: string, x: number, y: number, depth: number, stableId?: string): RuntimeObjectSnapshot {
  return { objectId: id, sourceId: `src-${id}`, stableId, runtimeDepth: depth, x, y, width: 32, height: 32, kind: 'agent', visible: true }
}
function makeRuntimeProp(id: string, depth: number): RuntimeObjectSnapshot {
  return { objectId: id, runtimeDepth: depth, x: 0, y: 0, kind: 'prop', visible: true }
}
function makeRuntimeLayer(id: string, depth: number): RuntimeObjectSnapshot {
  return { objectId: id, runtimeDepth: depth, x: 0, y: 0, kind: 'layer', visible: true }
}
function makeRuntimeFragment(id: string, depth: number): RuntimeObjectSnapshot {
  return { objectId: id, runtimeDepth: depth, x: 0, y: 0, kind: 'fragment', visible: true }
}

// ── Minimal v2 map data fixture ──

function makeV2MapData(): Record<string, unknown> {
  return {
    properties: [
      { name: 'renderSchemaVersion', value: '2' },
      { name: 'sceneId', value: 'juyiting-main' },
    ],
    width: 104, height: 58, tilewidth: 16, tileheight: 16,
    layers: [
      {
        name: 'v2-fragments-test', type: 'objectgroup',
        objects: [{
          name: 'test-pillar', type: 'occluder-fragment',
          x: 200, y: 300, width: 32, height: 64,
          properties: [
            { name: 'stableId', value: 'jyt.occ.center.pillar-01.v1' },
            { name: 'sceneId', value: 'juyiting-main' },
            { name: 'chunkId', value: 'center' },
            { name: 'kind', value: 'occluder-fragment' },
            { name: 'floorId', value: 'floor-1' },
            { name: 'elevation', value: '0' },
            { name: 'renderBand', value: 'world' },
            { name: 'sortMode', value: 'fixed' },
            { name: 'sortAnchorX', value: '216' },
            { name: 'sortAnchorY', value: '364' },
            { name: 'tieBias', value: '0' },
            { name: 'assetRef', value: 'jyt.occlusion-source.hall-v3' },
            { name: 'sourceRectX', value: '0' },
            { name: 'sourceRectY', value: '0' },
            { name: 'sourceRectW', value: '32' },
            { name: 'sourceRectH', value: '64' },
          ],
        }],
      },
      {
        name: 'v2-zones-test', type: 'objectgroup',
        objects: [{
          name: 'test-railing-behind', type: 'occlusion-zone',
          x: 0, y: 0, width: 400, height: 200,
          properties: [
            { name: 'stableId', value: 'jyt.zone.center.railing-01.behind.v1' },
            { name: 'sceneId', value: 'juyiting-main' },
            { name: 'chunkId', value: 'center' },
            { name: 'kind', value: 'occlusion-zone' },
            { name: 'floorId', value: 'floor-1' },
            { name: 'targetFragmentId', value: 'jyt.occ.center.pillar-01.v1' },
            { name: 'relation', value: 'behind' },
            { name: 'priority', value: '10' },
          ],
          polygon: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }],
        }],
      },
    ],
  }
}

// ── Tests ──

describe('E6 Shadow Renderer', () => {
  describe('Lazy init (P2)', () => {
    it('does not parse v2 on construction (lazy)', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      // Not enabled → no init → state is disabled
      assert.equal(sr.state, 'disabled')
      assert.equal(sr.enabled, false)
      assert.equal(sr.canonicalIr, null)
      assert.equal(sr.spatialGrid, null)
      sr.dispose()
    })

    it('parses v2 on first enable()', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      assert.equal(sr.state, 'ready')
      assert.notEqual(sr.canonicalIr, null)
      assert.notEqual(sr.spatialGrid, null)
      sr.dispose()
    })
  })

  describe('P1: debug flag alone enables shadow', () => {
    it('parseOcclusionDebugFlag returns true for jytOcclusionDebug=1', () => {
      assert.equal(parseOcclusionDebugFlag('?jytOcclusionDebug=1'), true)
    })
    it('parseOcclusionDebugFlag returns true for jytOcclusionDebug=true', () => {
      assert.equal(parseOcclusionDebugFlag('?jytOcclusionDebug=true'), true)
    })
    it('parseOcclusionDebugFlag returns false for missing', () => {
      assert.equal(parseOcclusionDebugFlag('?foo=bar'), false)
    })
    it('parseOcclusionDebugFlag is fail-safe', () => {
      assert.equal(parseOcclusionDebugFlag(''), false)
      assert.equal(parseOcclusionDebugFlag(null as unknown as string), false)
    })
  })

  describe('Disabled / Not-ready state', () => {
    it('returns disabled when not enabled', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      const snap = sr.computeSnapshot([])
      assert.equal(snap.state, 'disabled')
      sr.dispose()
    })

    it('returns not-ready when map data has no v2 schema', () => {
      const sr = createShadowRenderer({ mapData: { properties: [{ name: 'renderSchemaVersion', value: '1' }] } })
      sr.enable()
      const snap = sr.computeSnapshot([])
      assert.equal(snap.state, 'not-ready')
      sr.dispose()
    })

    it('returns disabled when no map data', () => {
      const sr = createShadowRenderer()
      sr.enable()
      const snap = sr.computeSnapshot([])
      assert.equal(snap.state, 'disabled')
      sr.dispose()
    })
  })

  describe('Ready state with v2 schema', () => {
    it('produces V2-native diagnostics for runtime agents', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      const snap = sr.computeSnapshot([makeRuntimeAgent('agent-001', 100, 200, 103.5)])
      assert.equal(snap.state, 'ready')
      assert.ok(snap.hasV2Schema)
      assert.ok(snap.diagnostics.length >= 1)
      const d = snap.diagnostics[0]
      assert.equal(d.runtimeDepth, 103.5)
      assert.ok(d.v2SortKey.length > 0)
      assert.ok(!('behindMask' in snap.diagnostics[0] as unknown as Record<string, unknown>))
      sr.dispose()
    })

    it('produces diagnostics for props, fragments, and layers', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      const snap = sr.computeSnapshot([
        makeRuntimeAgent('a1', 100, 100, 103.0),
        makeRuntimeProp('main-seat', 3.0),
        makeRuntimeFragment('pillar', 104.0),
        makeRuntimeLayer('lighting-overlay', 300.0),
      ])
      assert.equal(snap.state, 'ready')
      const prop = snap.diagnostics.find(d => d.objectId === 'main-seat')
      assert.ok(prop)
      assert.ok(prop!.diffReason.includes('runtime prop'))
      const fragment = snap.diagnostics.find(d => d.objectId === 'pillar')
      assert.ok(fragment)
      assert.ok(fragment!.diffReason.includes('runtime fragment'))
      const layer = snap.diagnostics.find(d => d.objectId === 'lighting-overlay')
      assert.ok(layer)
      assert.ok(layer!.diffReason.includes('runtime layer'))
      sr.dispose()
    })

    it('zone and fragment counts populated', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      const snap = sr.computeSnapshot([makeRuntimeAgent('a1', 100, 100, 103.0)])
      assert.equal(snap.zoneCount, 1)
      assert.equal(snap.fragmentCount, 1)
      sr.dispose()
    })

    it('membership candidates contain zones only', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      const snap = sr.computeSnapshot([makeRuntimeAgent('a1', 100, 100, 103.0)])
      const diagnostic = snap.diagnostics.find(d => d.objectId === 'a1')
      assert.ok(diagnostic)
      assert.deepEqual(diagnostic!.membershipCandidates, ['jyt.zone.center.railing-01.behind.v1'])
      sr.dispose()
    })

    it('instrumentation shows provider as trusted', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      const snap = sr.computeSnapshot([makeRuntimeAgent('a1', 100, 100, 103.0)])
      if (snap.instrumentation) {
        assert.equal(snap.instrumentation.providerTrusted, true)
      }
      sr.dispose()
    })
  })

  describe('P2: Deep immutability', () => {
    it('snapshot root is frozen', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      const snap = sr.computeSnapshot([makeRuntimeAgent('a1', 100, 100, 103.0)])
      assert.ok(Object.isFrozen(snap))
      sr.dispose()
    })

    it('diagnostic entries are deep-frozen', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      const snap = sr.computeSnapshot([makeRuntimeAgent('a1', 100, 100, 103.0)])
      const d = snap.diagnostics[0]
      assert.ok(Object.isFrozen(d))
      if (d.v2SortKeyDetail) assert.ok(Object.isFrozen(d.v2SortKeyDetail))
      assert.ok(Object.isFrozen(d.constraintEdges))
      assert.ok(Object.isFrozen(d.membershipCandidates))
      sr.dispose()
    })

    it('errors array is deep-frozen', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      const snap = sr.computeSnapshot([makeRuntimeAgent('a1', 100, 100, 103.0)])
      assert.ok(Object.isFrozen(snap.errors))
      sr.dispose()
    })

    it('instrumentation is deep-frozen', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      const snap = sr.computeSnapshot([makeRuntimeAgent('a1', 100, 100, 103.0)])
      if (snap.instrumentation) assert.ok(Object.isFrozen(snap.instrumentation))
      sr.dispose()
    })

    it('production counters return immutable copy', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      sr.computeSnapshot([makeRuntimeAgent('a1', 100, 100, 103.0)])
      const c1 = sr.productionCounters
      assert.ok(Object.isFrozen(c1))
      // Mutating the returned copy must not affect internals
      const c2 = sr.productionCounters
      assert.equal(c1.computeCount, c2.computeCount)
      sr.dispose()
    })
  })

  describe('P2: Truncation report', () => {
    it('diagnosticsTruncation reports original/retained/truncated', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      const snap = sr.computeSnapshot([makeRuntimeAgent('a1', 100, 100, 103.0)])
      const t = snap.diagnosticsTruncation
      assert.ok('originalCount' in t)
      assert.ok('retainedCount' in t)
      assert.ok('truncatedCount' in t)
      assert.ok(t.originalCount >= t.retainedCount)
      assert.equal(t.truncatedCount, t.originalCount - t.retainedCount)
      sr.dispose()
    })

    it('errorsTruncation reports original/retained/truncated', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      const snap = sr.computeSnapshot([makeRuntimeAgent('a1', 100, 100, 103.0)])
      const t = snap.errorsTruncation
      assert.ok('originalCount' in t)
      assert.ok('retainedCount' in t)
      assert.ok('truncatedCount' in t)
      assert.ok(t.originalCount >= t.retainedCount)
      sr.dispose()
    })

    it('truncatedCount > 0 when input exceeds 500', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      const manyAgents = Array.from({ length: 600 }, (_, i) => makeRuntimeAgent(`agent-${i}`, i * 2, i * 3, 100.0 + i * 0.01))
      const snap = sr.computeSnapshot(manyAgents)
      assert.equal(snap.diagnostics.length, 500)
      // originalCount should be >= 600 (includes adapted agents)
      assert.ok(snap.diagnosticsTruncation.originalCount >= 600, `originalCount should be >= 600, got ${snap.diagnosticsTruncation.originalCount}`)
      assert.equal(snap.diagnosticsTruncation.retainedCount, 500)
      assert.ok(snap.diagnosticsTruncation.truncatedCount > 0)
      sr.dispose()
    })

    it('snapshot is deep-frozen including truncation', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      const snap = sr.computeSnapshot([makeRuntimeAgent('a1', 100, 100, 103.0)])
      assert.ok(Object.isFrozen(snap.diagnosticsTruncation))
      assert.ok(Object.isFrozen(snap.errorsTruncation))
      sr.dispose()
    })
  })

  describe('Fatal isolation', () => {
    it('runtime objects not modified by shadow compute', () => {
      const frozenAgent = Object.freeze({ ...makeRuntimeAgent('a1', 100, 100, 103.5) })
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      sr.computeSnapshot([frozenAgent])
      assert.equal(frozenAgent.runtimeDepth, 103.5)
      sr.dispose()
    })

    it('recovery after error: next valid compute succeeds', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      sr.computeSnapshot([makeRuntimeAgent('a1', 100, 100, 103.0)])
      sr.invalidate()
      const snap2 = sr.computeSnapshot([makeRuntimeAgent('a1', 150, 150, 104.0)])
      assert.equal(snap2.state, 'ready')
      sr.dispose()
    })
  })

  describe('Production counters', () => {
    it('counters increment on compute', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      sr.computeSnapshot([makeRuntimeAgent('a1', 100, 100, 103.0)])
      assert.ok(sr.productionCounters.computeCount >= 1)
      sr.dispose()
    })

    it('counters available even when never enabled', () => {
      const sr = createShadowRenderer()
      assert.equal(sr.productionCounters.computeCount, 0)
      sr.dispose()
    })
  })

  describe('Dispose', () => {
    it('dispose clears state', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      sr.computeSnapshot([makeRuntimeAgent('a1', 100, 100, 103.0)])
      sr.dispose()
      const snap = sr.computeSnapshot([])
      assert.equal(snap.state, 'disabled')
      sr.dispose()
    })

    it('dispose is idempotent', () => {
      const sr = createShadowRenderer()
      sr.dispose()
      sr.dispose()
      assert.equal(sr.computeSnapshot([]).state, 'disabled')
    })
  })

  describe('Throttle', () => {
    it('returns cached version within throttle window', () => {
      let fakeTime = 0
      const sr = createShadowRenderer({ mapData: makeV2MapData(), now: () => fakeTime, throttleMs: 200 })
      sr.enable()
      const snap1 = sr.computeSnapshot([makeRuntimeAgent('a1', 100, 100, 103.0)])
      const v1 = snap1.version
      fakeTime = 50
      const snap2 = sr.computeSnapshot([makeRuntimeAgent('a1', 100, 100, 103.0)])
      assert.equal(snap2.version, v1, 'version should not change within throttle window')
      fakeTime = 300
      const snap3 = sr.computeSnapshot([makeRuntimeAgent('a1', 100, 100, 103.0)])
      assert.ok(snap3.version > v1, 'version should increment after throttle window')
      sr.dispose()
    })
  })

  describe('enable/disable toggle', () => {
    it('disable then enable works (with setMapData)', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      const snap1 = sr.computeSnapshot([makeRuntimeAgent('a1', 100, 100, 103.0)])
      assert.equal(snap1.state, 'ready')
      sr.disable()
      assert.equal(sr.computeSnapshot([]).state, 'disabled')
      sr.enable()
      sr.invalidate()
      const snap3 = sr.computeSnapshot([makeRuntimeAgent('a1', 100, 100, 103.0)])
      assert.equal(snap3.state, 'ready', `expected ready after re-enable, got ${snap3.state}`)
      sr.dispose()
    })
  })

  describe('Map reload recovery', () => {
    it('setMapData with invalid then valid recovers', () => {
      const sr = createShadowRenderer()
      sr.enable()
      sr.setMapData({ properties: [{ name: 'renderSchemaVersion', value: '99' }] })
      const snap1 = sr.computeSnapshot([])
      assert.ok(snap1.state === 'error' || snap1.state === 'fatal' || snap1.state === 'not-ready')
      sr.setMapData(makeV2MapData())
      const snap2 = sr.computeSnapshot([makeRuntimeAgent('a1', 100, 100, 103.0)])
      assert.equal(snap2.state, 'ready', `should recover, got ${snap2.state}`)
      sr.dispose()
    })

    it('setMapData propagates to existing renderer', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      assert.equal(sr.state, 'ready')
      // Set new valid map data
      sr.setMapData(makeV2MapData())
      assert.equal(sr.state, 'ready')
      sr.dispose()
    })
  })

  describe('Error accumulation', () => {
    it('errors accumulate correctly on bad data', () => {
      const sr = createShadowRenderer()
      sr.enable()
      sr.setMapData({
        properties: [{ name: 'renderSchemaVersion', value: '2' }, { name: 'sceneId', value: 'juyiting-main' }],
        width: 104, height: 58, tilewidth: 16, tileheight: 16,
        layers: [{ name: 'v2-bad', type: 'objectgroup', objects: [{ name: 'bad-frag', type: 'occluder-fragment', x: 0, y: 0, width: 0, height: 0, properties: [{ name: 'stableId', value: 'bad.frag.v1' }] }] }],
      })
      sr.computeSnapshot([])
      const snap = sr.computeSnapshot([])
      assert.ok(snap.state === 'error' || snap.state === 'fatal')
      assert.ok(snap.errors.length >= 1, `should have errors, got ${snap.errors.length}`)
      sr.dispose()
    })
  })
})

// ── Runtime snapshot collection tests ──

describe('E6 collectRuntimeSnapshots', () => {
  it('collects live V2 world objects without occluder/behindMask logic', () => {
    const world = {
      children: [
        { name: 'agent-1', pos: { x: 100, y: 200 }, depth: 103.5, visible: true, agentId: 'real-id-1', _isAgent: true, stableId: 'jyt.agent.test.one.v1' },
        { name: 'fragment-1', pos: { x: 0, y: 0 }, depth: 104.0, visible: true, _isFragment: true, stableId: 'jyt.occ.center.pillar-01.v1' },
        { name: 'layer-bg', pos: { x: 0, y: 0 }, depth: 0.1, visible: true, _isImageLayer: true },
      ],
    }
    const snaps = collectRuntimeSnapshots(world)
    assert.ok(snaps.length >= 3)
    const agent = snaps.find(s => s.objectId === 'agent-1')
    assert.ok(agent)
    assert.equal(agent!.kind, 'agent')
    assert.equal(agent!.runtimeDepth, 103.5)
    assert.equal(agent!.stableId, 'jyt.agent.test.one.v1')
    assert.equal('behindMask' in agent!, false)
    const fragment = snaps.find(s => s.objectId === 'fragment-1')
    assert.equal(fragment!.kind, 'fragment')
    assert.equal(fragment!.stableId, 'jyt.occ.center.pillar-01.v1')
  })

  it('handles empty world gracefully', () => {
    assert.deepEqual(collectRuntimeSnapshots({}), [])
    assert.deepEqual(collectRuntimeSnapshots(null), [])
  })
})

// ── URL parsing tests ──

describe('E6 parseOcclusionDebugFlag', () => {
  it('parses jytOcclusionDebug=1 as true', () => { assert.equal(parseOcclusionDebugFlag('?jytOcclusionDebug=1'), true) })
  it('parses jytOcclusionDebug=true as true', () => { assert.equal(parseOcclusionDebugFlag('?jytOcclusionDebug=true'), true) })
  it('parses missing as false', () => { assert.equal(parseOcclusionDebugFlag('?foo=bar'), false) })
  it('handles empty', () => { assert.equal(parseOcclusionDebugFlag(''), false) })
  it('handles null', () => { assert.equal(parseOcclusionDebugFlag(null as unknown as string), false) })
  it('parses with other params', () => { assert.equal(parseOcclusionDebugFlag('?foo=bar&jytOcclusionDebug=1&baz=qux'), true) })
})

// ── Runtime object integrity ──

describe('E6 runtime object integrity', () => {
  it('runtime snapshots immutable after compute', () => {
    const runtimeObjects = [
      Object.freeze(makeRuntimeAgent('a1', 100, 200, 103.5)),
      Object.freeze(makeRuntimeAgent('a2', 150, 250, 104.0)),
      Object.freeze(makeRuntimeProp('seat', 3.0)),
    ]
    const sr = createShadowRenderer({ mapData: makeV2MapData() })
    sr.enable()
    sr.computeSnapshot(runtimeObjects)
    assert.equal(runtimeObjects[0].runtimeDepth, 103.5)
    assert.equal(runtimeObjects[1].runtimeDepth, 104.0)
    assert.equal(runtimeObjects[2].runtimeDepth, 3.0)
    sr.dispose()
  })
})
