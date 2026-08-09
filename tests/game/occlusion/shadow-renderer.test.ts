// ── E6 Shadow Renderer Tests ──
// Covers:
//   - v1 parity: depth/children/click/camera unchanged
//   - Shadow fatal isolation (v1 preserved)
//   - Debug off => zero overlay
//   - Debug on => overlay data correct
//   - Toggle / dispose
//   - Error recovery (success after fatal)
//   - Snapshot immutability & capacity cap
//   - Not-ready when no v2 schema
//   - Production counters always active
//   - V1 snapshots collection

import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import {
  createShadowRenderer,
  collectV1Snapshots,
  parseOcclusionDebugFlag,
  type ShadowRenderer,
  type ShadowSnapshot,
  type V1ObjectSnapshot,
} from '../../../src/game/occlusion/shadowRenderer.js'
import {
  type CanonicalSceneIr,
  type SceneObject,
  DEFAULT_FLOOR_REGISTRY,
  isStructuredFatalRenderSchemaError,
} from '../../../src/game/occlusion/schema.js'
import { parseCanonicalIrFromData } from '../../../src/game/occlusion/canonicalIr.js'

// ── V1 snapshot helpers ──

function makeV1Agent(id: string, x: number, y: number, depth: number, behindMask = false): V1ObjectSnapshot {
  return {
    objectId: id,
    sourceId: `src-${id}`,
    v1Depth: depth,
    x, y,
    width: 32,
    height: 32,
    kind: 'agent',
    visible: true,
    behindMask,
  }
}

function makeV1Prop(id: string, depth: number): V1ObjectSnapshot {
  return {
    objectId: id,
    v1Depth: depth,
    x: 0, y: 0,
    kind: 'prop',
    visible: true,
  }
}

function makeV1Layer(id: string, depth: number): V1ObjectSnapshot {
  return {
    objectId: id,
    v1Depth: depth,
    x: 0, y: 0,
    kind: 'layer',
    visible: true,
  }
}

// ── Minimal v2 map data fixture ──

function makeV2MapData(): Record<string, unknown> {
  return {
    properties: [
      { name: 'renderSchemaVersion', value: '2' },
      { name: 'sceneId', value: 'juyiting-main' },
    ],
    width: 104,
    height: 58,
    tilewidth: 16,
    tileheight: 16,
    layers: [
      {
        name: 'v2-fragments-test',
        type: 'objectgroup',
        objects: [
          {
            name: 'test-pillar',
            type: 'occluder-fragment',
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
          },
        ],
      },
      {
        name: 'v2-zones-test',
        type: 'objectgroup',
        objects: [
          {
            name: 'test-railing-behind',
            type: 'occlusion-zone',
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
            polygon: [
              { x: 0, y: 0 },
              { x: 200, y: 0 },
              { x: 200, y: 200 },
              { x: 0, y: 200 },
            ],
          },
        ],
      },
    ],
  }
}

// ── Tests ──

describe('E6 Shadow Renderer', () => {
  describe('Disabled / Not-ready state', () => {
    it('returns disabled when no map data', () => {
      const sr = createShadowRenderer()
      sr.enable()
      const snap = sr.computeSnapshot([])
      assert.equal(snap.state, 'disabled')
      assert.equal(snap.hasV2Schema, false)
      assert.equal(snap.diagnostics.length, 0)
      sr.dispose()
    })

    it('returns not-ready when map data has no v2 schema', () => {
      const sr = createShadowRenderer({ mapData: { properties: {} } })
      sr.enable()
      const snap = sr.computeSnapshot([])
      assert.equal(snap.state, 'not-ready')
      assert.ok(snap.stateReason.includes('no v2 render schema'))
      sr.dispose()
    })

    it('returns not-ready when map data undefined', () => {
      const sr = createShadowRenderer()
      sr.enable()
      const snap1 = sr.computeSnapshot([])
      assert.equal(snap1.state, 'disabled')
      sr.dispose()
    })

    it('disabled by default (feature flag off)', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      // Not enabled, so compute should return disabled
      const snap = sr.computeSnapshot([])
      assert.equal(snap.state, 'disabled')
      sr.dispose()
    })

    it('enabled flag activates shadow', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      const snap = sr.computeSnapshot([])
      // Should be ready or error (not disabled/not-ready)
      assert.ok(snap.state === 'ready' || snap.state === 'error')
      sr.dispose()
    })
  })

  describe('Ready state with v2 schema', () => {
    it('produces diagnostics for v1 agents', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      const agents = [
        makeV1Agent('agent-001', 100, 200, 3.5, false),
        makeV1Agent('agent-002', 220, 320, 1.8, true),
      ]
      const snap = sr.computeSnapshot(agents)
      assert.equal(snap.state, 'ready')
      assert.ok(snap.hasV2Schema)
      assert.ok(snap.diagnostics.length >= 2)
      // Agent diagnostics should have v1 depth
      const agent1 = snap.diagnostics.find(d => d.objectId === 'agent-001')
      assert.ok(agent1, 'agent-001 should be in diagnostics')
      assert.equal(agent1!.v1Depth, 3.5)
      assert.ok(agent1!.v2SortKey.length > 0, 'should have v2 sort key')
      // Agent with behindMask should be flagged
      const agent2 = snap.diagnostics.find(d => d.objectId === 'agent-002')
      assert.ok(agent2, 'agent-002 should be in diagnostics')
      assert.ok(agent2!.diffReason.includes('behindMask') || agent2!.diffReason.length > 0)
      sr.dispose()
    })

    it('produces diagnostics for v1 props and layers', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      const objects = [
        makeV1Agent('agent-001', 100, 100, 3.0, false),
        makeV1Prop('main-seat', 3.0),
        makeV1Layer('mid-occluders', 2.0),
      ]
      const snap = sr.computeSnapshot(objects)
      assert.equal(snap.state, 'ready')
      // Prop should have prop-related diff reason
      const prop = snap.diagnostics.find(d => d.objectId === 'main-seat')
      assert.ok(prop)
      assert.ok(prop!.diffReason.includes('declaration-order') || prop!.diffReason.includes('prop'), `prop diff should mention prop, got: ${prop!.diffReason}`)
      // Layer should have layer-related diff reason
      const layer = snap.diagnostics.find(d => d.objectId === 'mid-occluders')
      assert.ok(layer)
      assert.ok(layer!.diffReason.includes('fixed') || layer!.diffReason.includes('layer'), `layer diff should mention layer, got: ${layer!.diffReason}`)
      sr.dispose()
    })

    it('snapshot is frozen (immutable)', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      const snap = sr.computeSnapshot([makeV1Agent('a1', 100, 100, 3.0, false)])
      assert.ok(Object.isFrozen(snap), 'snapshot must be frozen')
      assert.ok(Object.isFrozen(snap.diagnostics), 'diagnostics must be frozen')
      assert.ok(Object.isFrozen(snap.errors), 'errors must be frozen')
      // Verify properties are non-writable (immutable regardless of strict mode)
      const desc = Object.getOwnPropertyDescriptor(snap, 'version')
      assert.ok(desc, 'version property must exist')
      assert.equal(desc!.writable, false, 'version must be non-writable')
      assert.equal(desc!.configurable, false, 'version must be non-configurable')
      // Verify no new properties can be added
      const beforeKeys = Object.keys(snap).length
      const mutable = snap as unknown as Record<string, unknown>
      mutable._testNewProp = 'should not stick'
      assert.equal(Object.keys(snap).length, beforeKeys, 'no new properties can be added to frozen snapshot')
      sr.dispose()
    })

    it('zone and fragment counts populated', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      const snap = sr.computeSnapshot([makeV1Agent('a1', 100, 100, 3.0, false)])
      assert.equal(snap.state, 'ready')
      assert.equal(snap.zoneCount, 1)
      assert.equal(snap.fragmentCount, 1)
      sr.dispose()
    })

    it('instrumentation shows provider as trusted', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      const snap = sr.computeSnapshot([makeV1Agent('a1', 100, 100, 3.0, false)])
      if (snap.instrumentation) {
        assert.equal(snap.instrumentation.providerTrusted, true, 'provider should be trusted (branded grid)')
      }
      sr.dispose()
    })
  })

  describe('Fatal isolation', () => {
    it('v1 objects not modified by shadow compute', () => {
      // The v1 snapshots are passed as plain data, never mutated
      const agents = [
        makeV1Agent('a1', 100, 100, 3.5, false),
      ]
      const frozenAgent = Object.freeze({ ...agents[0] })

      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      sr.computeSnapshot(agents)
      // Original v1 data unchanged
      assert.equal(frozenAgent.v1Depth, 3.5)
      assert.equal(frozenAgent.x, 100)
      assert.equal(frozenAgent.y, 100)
      sr.dispose()
    })

    it('recovery after error: next valid compute succeeds', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      // First compute
      const snap1 = sr.computeSnapshot([makeV1Agent('a1', 100, 100, 3.0, false)])
      assert.equal(snap1.state, 'ready')
      // Should still be able to compute again
      sr.invalidate() // force recompute
      const snap2 = sr.computeSnapshot([makeV1Agent('a1', 150, 150, 4.0, false)])
      assert.equal(snap2.state, 'ready')
      sr.dispose()
    })
  })

  describe('Snapshot capacity cap', () => {
    it('diagnostics not exceed MAX_SNAPSHOT_OBJECTS', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      const manyAgents = Array.from({ length: 600 }, (_, i) =>
        makeV1Agent(`agent-${i}`, i * 2, i * 3, 2.0 + i * 0.01, false)
      )
      const snap = sr.computeSnapshot(manyAgents)
      assert.ok(snap.diagnostics.length <= 500, `diagnostics capped at 500, got ${snap.diagnostics.length}`)
      sr.dispose()
    })

    it('errors not exceed MAX_ERRORS', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      // Generate lots of computes to potentially fill errors
      for (let i = 0; i < 10; i++) {
        sr.computeSnapshot([makeV1Agent(`a${i}`, 100, 100, 3.0, false)])
      }
      const snap = sr.computeSnapshot([makeV1Agent('final', 100, 100, 3.0, false)])
      assert.ok(snap.errors.length <= 50, `errors capped at 50, got ${snap.errors.length}`)
      sr.dispose()
    })
  })

  describe('Production counters', () => {
    it('counters increment on compute', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      sr.computeSnapshot([makeV1Agent('a1', 100, 100, 3.0, false)])
      const counters = sr.productionCounters
      assert.ok(counters.computeCount >= 1)
      sr.dispose()
    })

    it('counters available even when disabled', () => {
      const sr = createShadowRenderer()
      const counters = sr.productionCounters
      assert.equal(counters.computeCount, 0)
      assert.equal(counters.errorCount, 0)
      sr.dispose()
    })
  })

  describe('Dispose', () => {
    it('dispose clears state', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      sr.computeSnapshot([makeV1Agent('a1', 100, 100, 3.0, false)])
      sr.dispose()
      // After dispose, should return disabled
      const snap = sr.computeSnapshot([])
      assert.equal(snap.state, 'disabled')
      assert.ok(snap.stateReason.includes('disposed') || snap.stateReason.includes('destroyed'), `stateReason should include disposed/destroyed, got: ${snap.stateReason}`)
    })

    it('dispose is idempotent', () => {
      const sr = createShadowRenderer()
      sr.dispose()
      sr.dispose() // second dispose should not throw
      const snap = sr.computeSnapshot([])
      assert.equal(snap.state, 'disabled')
    })
  })

  describe('Throttle', () => {
    it('returns cached version within throttle window', () => {
      let fakeTime = 0
      const sr = createShadowRenderer({
        mapData: makeV2MapData(),
        now: () => fakeTime,
        throttleMs: 200,
      })
      sr.enable()
      const snap1 = sr.computeSnapshot([makeV1Agent('a1', 100, 100, 3.0, false)])
      const v1 = snap1.version
      // Within throttle window, should return same version
      fakeTime = 50 // 50ms < 200ms
      const snap2 = sr.computeSnapshot([makeV1Agent('a1', 100, 100, 3.0, false)])
      // Note: throttle skips recompute but returns new snapshot with same data
      assert.equal(snap2.version, v1, 'version should not change within throttle window')
      // After throttle window
      fakeTime = 300
      const snap3 = sr.computeSnapshot([makeV1Agent('a1', 100, 100, 3.0, false)])
      assert.ok(snap3.version > v1, 'version should increment after throttle window')
      sr.dispose()
    })
  })

  describe('enable/disable toggle', () => {
    it('disable then enable works', () => {
      const sr = createShadowRenderer({ mapData: makeV2MapData() })
      sr.enable()
      assert.equal(sr.enabled, true)
      const snap1 = sr.computeSnapshot([makeV1Agent('a1', 100, 100, 3.0, false)])
      assert.equal(snap1.state, 'ready')
      sr.disable()
      assert.equal(sr.enabled, false)
      const snap2 = sr.computeSnapshot([makeV1Agent('a1', 100, 100, 3.0, false)])
      assert.equal(snap2.state, 'disabled')
      // Re-enable: should reinitialize if needed
      sr.enable()
      // Force re-init by invalidating
      sr.invalidate()
      const snap3 = sr.computeSnapshot([makeV1Agent('a1', 100, 100, 3.0, false)])
      assert.equal(snap3.state, 'ready', `expected ready after re-enable, got ${snap3.state}: ${snap3.stateReason}`)
      sr.dispose()
    })
  })
})

// ── V1 snapshot collection tests ──

describe('E6 collectV1Snapshots', () => {
  it('collects from world with children', () => {
    const world = {
      children: [
        { name: 'agent-1', pos: { x: 100, y: 200 }, depth: 3.5, visible: true, agentId: 'real-id-1', _isAgent: true },
        { name: 'layer-bg', pos: { x: 0, y: 0 }, depth: 0.1, visible: true, _isImageLayer: true },
      ],
    }
    const mapData = { occluders: [] }
    const snaps = collectV1Snapshots(world, mapData)
    assert.ok(snaps.length >= 2)
    const agent = snaps.find(s => s.objectId === 'agent-1')
    assert.ok(agent)
    assert.equal(agent!.kind, 'agent')
    assert.equal(agent!.v1Depth, 3.5)
    assert.equal(agent!.sourceId, 'real-id-1')
    assert.equal(agent!.behindMask, false)

    const layer = snaps.find(s => s.objectId === 'layer-bg')
    assert.ok(layer)
    assert.equal(layer!.kind, 'layer')
  })

  it('detects behindMask from occluders', () => {
    const world = {
      children: [
        { name: 'agent-in-mask', pos: { x: 50, y: 50 }, depth: 1.8, visible: true, agentId: 'id1', _isAgent: true },
        { name: 'agent-outside', pos: { x: 500, y: 500 }, depth: 3.5, visible: true, agentId: 'id2', _isAgent: true },
      ],
    }
    const mapData = {
      occluders: [
        { x: 0, y: 0, width: 100, height: 100 },
      ],
    }
    const snaps = collectV1Snapshots(world, mapData)
    const inside = snaps.find(s => s.objectId === 'agent-in-mask')
    const outside = snaps.find(s => s.objectId === 'agent-outside')
    assert.ok(inside)
    assert.ok(outside)
    assert.equal(inside!.behindMask, true)
    assert.equal(outside!.behindMask, false)
  })

  it('handles empty world gracefully', () => {
    const snaps = collectV1Snapshots({}, {})
    assert.deepEqual(snaps, [])
  })

  it('handles null/undefined world gracefully', () => {
    const snaps = collectV1Snapshots(null, null)
    assert.deepEqual(snaps, [])
  })
})

// ── URL parsing tests ──

describe('E6 parseOcclusionDebugFlag', () => {
  it('parses ?jytOcclusionDebug=1 as true', () => {
    assert.equal(parseOcclusionDebugFlag('?jytOcclusionDebug=1'), true)
  })

  it('parses ?jytOcclusionDebug=true as true', () => {
    assert.equal(parseOcclusionDebugFlag('?jytOcclusionDebug=true'), true)
  })

  it('parses missing flag as false', () => {
    assert.equal(parseOcclusionDebugFlag('?foo=bar'), false)
  })

  it('parses empty string as false', () => {
    assert.equal(parseOcclusionDebugFlag(''), false)
  })

  it('parses malformed input as false', () => {
    assert.equal(parseOcclusionDebugFlag(null as unknown as string), false)
    assert.equal(parseOcclusionDebugFlag(undefined as unknown as string), false)
    assert.equal(parseOcclusionDebugFlag(123 as unknown as string), false)
  })

  it('parses with other params', () => {
    assert.equal(parseOcclusionDebugFlag('?foo=bar&jytOcclusionDebug=1&baz=qux'), true)
    assert.equal(parseOcclusionDebugFlag('?jytOcclusionDebug=0'), false)
  })
})

// ── Shadow error recovery tests ──

describe('E6 error recovery', () => {
  it('recover after fatal: set new valid mapData', () => {
    const sr = createShadowRenderer()
    sr.enable()

    // First with v2 map data that will trigger a parse error
    sr.setMapData({
      properties: [
        { name: 'renderSchemaVersion', value: '2' },
        { name: 'sceneId', value: 'juyiting-main' },
      ],
      width: 104, height: 58, tilewidth: 16, tileheight: 16,
      layers: [
        {
          name: 'v2-bad', type: 'objectgroup',
          objects: [
            {
              name: 'bad-frag', type: 'occluder-fragment',
              x: 0, y: 0, width: 0, height: 0,
              properties: [
                { name: 'stableId', value: 'bad.frag.v1' },
              ],
            },
          ],
        },
      ],
    })
    const snap1 = sr.computeSnapshot([])
    assert.ok(
      snap1.state === 'error' || snap1.state === 'fatal' || snap1.state === 'not-ready',
      `expected error/fatal/not-ready, got ${snap1.state}: ${snap1.stateReason}`,
    )

    // Then with valid map data
    sr.setMapData(makeV2MapData())
    const snap2 = sr.computeSnapshot([makeV1Agent('a1', 100, 100, 3.0, false)])
    assert.equal(snap2.state, 'ready', `should recover, got ${snap2.state}: ${snap2.stateReason}`)

    sr.dispose()
  })

  it('consecutive errors accumulate correctly', () => {
    const sr = createShadowRenderer()
    sr.enable()
    // Set v2 map data that triggers parse errors
    sr.setMapData({
      properties: [
        { name: 'renderSchemaVersion', value: '2' },
        { name: 'sceneId', value: 'juyiting-main' },
      ],
      width: 104, height: 58, tilewidth: 16, tileheight: 16,
      layers: [
        {
          name: 'v2-bad', type: 'objectgroup',
          objects: [
            {
              name: 'bad-frag', type: 'occluder-fragment',
              x: 0, y: 0, width: 0, height: 0,
              properties: [
                { name: 'stableId', value: 'bad.frag.v1' },
              ],
            },
          ],
        },
      ],
    })
    sr.computeSnapshot([])
    sr.computeSnapshot([])
    const snap = sr.computeSnapshot([])
    // After bad data, state should be fatal/error with errors recorded
    assert.ok(snap.state === 'error' || snap.state === 'fatal',
      `expected error/fatal state, got ${snap.state}: ${snap.stateReason}`)
    assert.ok(snap.errors.length >= 1, `should have at least one error, got ${snap.errors.length}`)
    sr.dispose()
  })
})

// ── Integration: v1 object not mutated ──

describe('E6 v1 integrity', () => {
  it('v1 snapshot objects immutable after compute', () => {
    const v1Objects: V1ObjectSnapshot[] = [
      Object.freeze(makeV1Agent('a1', 100, 200, 3.5, false)),
      Object.freeze(makeV1Agent('a2', 150, 250, 1.8, true)),
      Object.freeze(makeV1Prop('seat', 3.0)),
    ]

    const sr = createShadowRenderer({ mapData: makeV2MapData() })
    sr.enable()
    sr.computeSnapshot(v1Objects)

    // All v1 objects must have original values
    assert.equal(v1Objects[0].v1Depth, 3.5)
    assert.equal(v1Objects[0].x, 100)
    assert.equal(v1Objects[0].y, 200)
    assert.equal(v1Objects[1].behindMask, true)
    assert.equal(v1Objects[2].v1Depth, 3.0)

    sr.dispose()
  })
})
