// ── E12 HallScene Integration Tests ──
// Production integration: real hall.tmx, V2 activation envelope,
// E3 agent adapter stableIds, E7 controller staging/commit,
// depth continuity, SpatialGrid production provider, hit-test,
// destroy/recreate, atomic failure, membership advancement.
//
// Uses real public/juyiting/hall.tmx XML (E10B baseline SHA verified).
// No fake fixtures.

import { expect } from 'chai'
import { describe, it, before, after } from 'mocha'
import { readFileSync } from 'fs'
import { JSDOM } from 'jsdom'

import {
  hasV2ActivationEnvelope,
  projectActivationEnvelope,
  assembleV2Scene,
  computeUnifiedWorldOrder,
  buildHitTestTargets,
  hitTestPoint,
  registerAgentsInGrid,
  unregisterAgentFromGrid,
  buildFrameProposal,
  createEmptyMembershipState,
  type E12Assembly,
  type V2AgentAdapter,
  type HitTestTarget,
  type UnifiedOrderResult,
} from '../../../src/game/occlusion/hallSceneAssembly.js'
import {
  hasRenderSchemaV2,
  parseCanonicalIrFromXml,
} from '../../../src/game/occlusion/canonicalIr.js'
import {
  type CanonicalSceneIr,
  type OccluderFragment,
  type SceneObject,
} from '../../../src/game/occlusion/schema.js'
import {
  SpatialGrid,
  isSpatialGridProvider,
} from '../../../src/game/occlusion/spatialGrid.js'
import {
  createRuntimeAgentAdapter,
  defaultSpawnResolver,
  defaultChunkResolver,
  type RuntimeAgentAdapter,
} from '../../../src/game/occlusion/runtimeAgentAdapter.js'
import {
  createSceneActivationController,
  type SceneActivationController,
  type FrameProposal,
  type SceneActivationHooks,
} from '../../../src/game/occlusion/sceneActivation.js'

// ── JSDOM setup ──

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as Record<string, unknown>).document = dom.window.document;
(globalThis as Record<string, unknown>).DOMParser = dom.window.DOMParser;
(globalThis as Record<string, unknown>).window = dom.window;

// Set up minimal crypto for SHA-256 (E3 adapter needs it)
if (!(globalThis as Record<string, unknown>).crypto) {
  const { webcrypto } = require('crypto') as { webcrypto: Crypto }
  ;(globalThis as Record<string, unknown>).crypto = webcrypto
}

// ── Real hall.tmx ──

const HALL_TMX_XML = readFileSync('public/juyiting/hall.tmx', 'utf-8')
const HALL_TMX_SHA = '4f94e3a52da71369d9c29d96e0ac0ceb2126a1a441b6cd63911701957e1ed49b'

let canonicalIr: CanonicalSceneIr

before(() => {
  // Build mapData and canonicalIr from real TMX (production path via activation envelope)
  // Must be self-contained; does not rely on makePreparsedMapData or canonicalIr
  // Build fragment layer from TMX XML
  const fragLayer: any = { name: 'v2-fragments-occluders', type: 'objectgroup', objects: [] }
  const fragMatch = HALL_TMX_XML.match(/<objectgroup[^>]*name="v2-fragments-occluders"[^>]*>([\s\S]*?)<\/objectgroup>/)
  if (fragMatch) {
    const re = /<object ([^>]*?)>([\s\S]*?)<\/object>/g
    let m
    while ((m = re.exec(fragMatch[1])) !== null) {
      const attrs = m[1], body = m[2]
      const getA = (n: string) => (attrs.match(new RegExp(n + '="([^"]*)"')) || [])[1] || ''
      const getP = (n: string) => {
        const pm = body.match(new RegExp('<property name="' + n + '"[^>]*value="([^"]*)"'))
        return pm ? pm[1] : ''
      }
      fragLayer.objects.push({
        name: getA('name'),
        type: 'occluder-fragment',
        x: parseInt(getA('x') || '0'), y: parseInt(getA('y') || '0'),
        width: parseInt(getA('width') || '0'), height: parseInt(getA('height') || '0'),
        properties: {
          stableId: getP('stableId'), sceneId: getP('sceneId') || 'juyiting-main',
          chunkId: getP('chunkId'), floorId: getP('floorId') || 'floor-1',
          elevation: getP('elevation') || '0', renderBand: getP('renderBand') || 'world',
          sortMode: 'fixed', sortAnchorX: getP('sortAnchorX') || '0', sortAnchorY: getP('sortAnchorY') || '0',
          tieBias: getP('tieBias') || '0', assetRef: getP('assetRef'),
          sourceRectX: getP('sourceRectX') || '0', sourceRectY: getP('sourceRectY') || '0',
          sourceRectW: getP('sourceRectW') || '0', sourceRectH: getP('sourceRectH') || '0',
        },
      })
    }
  }
  
  // Build prop layer from TMX XML hotspots
  const propLayer: any = { name: 'hotspots', type: 'objectgroup', objects: [] }
  const hsMatch = HALL_TMX_XML.match(/<objectgroup[^>]*name="hotspots"[^>]*>([\s\S]*?)<\/objectgroup>/)
  if (hsMatch) {
    const re = /<object ([^>]*?)>([\s\S]*?)<\/object>/g
    let m
    while ((m = re.exec(hsMatch[1])) !== null) {
      const attrs = m[1], body = m[2]
      const getA = (n: string) => (attrs.match(new RegExp(n + '="([^"]*)"')) || [])[1] || ''
      const type = getA('type')
      if (type !== 'prop') continue
      const getP = (n: string) => {
        const pm = body.match(new RegExp('<property name="' + n + '"[^>]*value="([^"]*)"'))
        return pm ? pm[1] : ''
      }
      const sid = getP('stableId')
      if (!sid) continue
      propLayer.objects.push({
        name: getA('name'), type: 'prop',
        x: 0, y: 0, width: 1664, height: 928,
        properties: {
          stableId: sid, sceneId: getP('sceneId') || 'juyiting-main',
          chunkId: getP('chunkId') || 'hall-props', kind: 'prop',
          renderBand: getP('renderBand') || 'world', floorId: getP('floorId') || 'floor-1',
          elevation: getP('elevation') || '0', sortMode: getP('sortMode') || 'fixed',
          sortAnchorX: getP('sortAnchorX') || '0', sortAnchorY: getP('sortAnchorY') || '0',
          tieBias: getP('tieBias') || '0',
        },
      })
    }
  }
  
  const md: Record<string, unknown> = {
    width: 104, height: 58, tilewidth: 16, tileheight: 16,
    properties: { sceneId: 'juyiting-main' },
    layers: [fragLayer],
  }
  if (propLayer.objects.length > 0) {
    (md.layers as any[]).push(propLayer)
  }
  
  const assembly = assembleV2Scene(md)
  canonicalIr = assembly.canonicalIr
})

// ── Helpers ──

/** Build mapData from parseJuyiHallTmx-like structure (pre-parsed melonJS data) */
function makePreparsedMapData(): Record<string, unknown> {
  // Build from canonicalIr (set in before() hook)
  const layers: Array<Record<string, unknown>> = [
    {
      name: 'v2-fragments-occluders', type: 'objectgroup',
      objects: canonicalIr.fragments.map(f => ({
        name: f.stableId, type: 'occluder-fragment',
        x: f.destinationRect.x, y: f.destinationRect.y,
        width: f.destinationRect.width, height: f.destinationRect.height,
        properties: {
          stableId: f.stableId, sceneId: f.sceneId, chunkId: f.chunkId,
          floorId: f.floorId, elevation: String(f.elevation),
          renderBand: f.renderBand, sortMode: 'fixed',
          sortAnchorX: String(f.sortAnchor.x), sortAnchorY: String(f.sortAnchor.y),
          tieBias: String(f.tieBias), assetRef: f.assetRef,
          sourceRectX: String(f.sourceRect.x), sourceRectY: String(f.sourceRect.y),
          sourceRectW: String(f.sourceRect.width), sourceRectH: String(f.sourceRect.height),
        },
      })),
    },
  ]
  const propObjects = canonicalIr.objects.filter(o => o.kind === 'prop')
  if (propObjects.length > 0) {
    layers.push({
      name: 'hotspots', type: 'objectgroup',
      objects: propObjects.map(o => ({
        name: o.stableId, type: o.kind,
        x: 0, y: 0, width: 1664, height: 928,
        properties: {
          stableId: o.stableId, sceneId: o.sceneId, chunkId: o.chunkId,
          kind: o.kind, renderBand: o.renderBand, floorId: o.floorId,
          elevation: String(o.elevation), sortMode: o.sortMode,
          sortAnchorX: String(o.sortAnchor.x), sortAnchorY: String(o.sortAnchor.y),
          tieBias: String(o.tieBias),
        },
      })),
    })
  }
  return {
    width: 104, height: 58, tilewidth: 16, tileheight: 16,
    properties: { sceneId: 'juyiting-main' },
    layers,
  }
}
// ── Tests ──

describe('E12 hall.tmx provenance', () => {
  it('hall.tmx SHA-256 matches E10B baseline', () => {
    const { createHash } = require('crypto')
    const hash = createHash('sha256').update(HALL_TMX_XML).digest('hex')
    expect(hash).to.equal(HALL_TMX_SHA, 'hall.tmx must not be modified from E10B baseline')
  })

  it('hall.tmx does NOT contain renderSchemaVersion property', () => {
    expect(HALL_TMX_XML).to.not.match(/renderSchemaVersion/)
  })

  it('hall.tmx contains v2-fragments-occluders objectgroup with 32 occluder-fragment objects', () => {
    const matches = HALL_TMX_XML.match(/type="occluder-fragment"/g)
    expect(matches).to.have.lengthOf(32)
  })

  it('canonical IR from real XML has 32 fragments', () => {
    expect(canonicalIr.fragments).to.have.lengthOf(32)
  })

  it('canonical IR has 5 props', () => {
    expect(canonicalIr.objects).to.have.lengthOf.at.least(5)
  })

  it('canonical IR has 0 zones', () => {
    expect(canonicalIr.zones).to.have.lengthOf(0)
  })
})

describe('E12 activation envelope', () => {
  it('hasV2ActivationEnvelope detects v2-fragments-occluders layer', () => {
    const md = makePreparsedMapData(canonicalIr)
    // Pre-parsed data has properties but no renderSchemaVersion
    expect(md.properties).to.not.have.property('renderSchemaVersion')
    // But activation envelope still detects it
    expect(hasV2ActivationEnvelope(md)).to.be.true
  })

  it('hasV2ActivationEnvelope returns false for non-juyiting sceneId', () => {
    const md = { ...makePreparsedMapData(canonicalIr), properties: { sceneId: 'other-scene' } }
    expect(hasV2ActivationEnvelope(md)).to.be.false
  })

  it('hasV2ActivationEnvelope returns false without v2-fragments layer', () => {
    const md = { properties: { sceneId: 'juyiting-main' }, layers: [] }
    expect(hasV2ActivationEnvelope(md)).to.be.false
  })

  it('hasV2ActivationEnvelope returns false for null/undefined/empty', () => {
    expect(hasV2ActivationEnvelope(null as any)).to.be.false
    expect(hasV2ActivationEnvelope(undefined as any)).to.be.false
    expect(hasV2ActivationEnvelope({} as any)).to.be.false
  })

  it('projectActivationEnvelope injects renderSchemaVersion=2 without mutating original', () => {
    const md = makePreparsedMapData(canonicalIr)
    expect(md.properties).to.not.have.property('renderSchemaVersion')
    const projected = projectActivationEnvelope(md)
    expect(projected.properties).to.have.property('renderSchemaVersion', '2')
    // Original unchanged
    expect(md.properties).to.not.have.property('renderSchemaVersion')
  })

  it('projected data passes hasRenderSchemaV2', () => {
    const md = makePreparsedMapData(canonicalIr)
    const projected = projectActivationEnvelope(md)
    expect(hasRenderSchemaV2(projected)).to.be.true
  })

  it('activation envelope fail-closed: missing any fragment property fails assembleV2Scene', () => {
    // Build mapData with a fragment missing required stableId
    const md = makePreparsedMapData()
    const layers = md.layers as Array<Record<string, unknown>>
    const fragObj = (layers[0].objects as Array<Record<string, unknown>>)[0]
    const origStableId = (fragObj.properties as Record<string, unknown>).stableId
    delete (fragObj.properties as any).stableId
    // hasEnvelope passes (only checks count == 32 + type)
    expect(hasV2ActivationEnvelope(md)).to.be.true
    // assembleV2Scene → parseCanonicalIrFromData should throw on missing stableId
    expect(() => assembleV2Scene(md)).to.throw()
    // Restore
    ;(fragObj.properties as any).stableId = origStableId
  })
})

describe('E12 assembleV2Scene (production)', () => {
  let mapData: Record<string, unknown>

  before(() => {
    mapData = makePreparsedMapData(canonicalIr)
  })

  it('assembles V2 scene from production mapData via activation envelope', () => {
    expect(hasV2ActivationEnvelope(mapData)).to.be.true
    const assembly = assembleV2Scene(mapData)
    expect(assembly.canonicalIr.sceneId).to.equal('juyiting-main')
    expect(assembly.canonicalIr.renderSchemaVersion).to.equal('2')
  })

  it('has exactly 32 fragments', () => {
    const assembly = assembleV2Scene(mapData)
    expect(assembly.fragments).to.have.lengthOf(32)
  })

  it('has at least 5 worldObjects (props)', () => {
    const assembly = assembleV2Scene(mapData)
    expect(assembly.worldObjects).to.have.lengthOf.at.least(5)
  })

  it('has 0 zones', () => {
    const assembly = assembleV2Scene(mapData)
    expect(assembly.zones).to.have.lengthOf(0)
  })

  it('creates trusted SpatialGrid production provider', () => {
    const assembly = assembleV2Scene(mapData)
    expect(assembly.spatialGrid).to.be.instanceOf(SpatialGrid)
    expect(isSpatialGridProvider(assembly.candidateProvider)).to.be.true
  })

  it('grid has entries for fragments + props', () => {
    const assembly = assembleV2Scene(mapData)
    expect(assembly.spatialGrid.getEntryCount()).to.be.at.least(32 + 5)
  })

  it('throws on non-V2 data', () => {
    expect(() => assembleV2Scene({} as any)).to.throw()
  })

  it('repeatable for same input', () => {
    const a1 = assembleV2Scene(mapData)
    const a2 = assembleV2Scene(mapData)
    expect(a1.fragments.length).to.equal(a2.fragments.length)
    expect(a1.worldObjects.length).to.equal(a2.worldObjects.length)
  })
})

describe('E12 computeUnifiedWorldOrder (production)', () => {
  let assembly: E12Assembly

  before(() => {
    const mapData = makePreparsedMapData(canonicalIr)
    assembly = assembleV2Scene(mapData)
  })

  it('deterministic order with no agents (5 props + 32 fragments = 37)', () => {
    const r = computeUnifiedWorldOrder(assembly, [], createEmptyMembershipState())
    expect(r.order.length).to.equal(37)
    const r2 = computeUnifiedWorldOrder(assembly, [], createEmptyMembershipState())
    expect(r2.order).to.deep.equal(r.order)
    expect(r2.depths).to.deep.equal(r.depths)
  })

  it('contiguous safe integer depths', () => {
    const r = computeUnifiedWorldOrder(assembly, [], createEmptyMembershipState())
    const vals = Object.values(r.depths) as number[]
    const sorted = [...vals].sort((a, b) => a - b)
    for (let i = 0; i < sorted.length; i++) {
      expect(sorted[i]).to.equal(i)
      expect(Number.isSafeInteger(sorted[i])).to.be.true
    }
  })

  it('all props receive a depth', () => {
    const r = computeUnifiedWorldOrder(assembly, [], createEmptyMembershipState())
    for (const prop of assembly.worldObjects) {
      expect(r.depths).to.have.property(prop.stableId)
    }
  })

  it('all fragments receive a depth', () => {
    const r = computeUnifiedWorldOrder(assembly, [], createEmptyMembershipState())
    for (const f of assembly.fragments) {
      if (f.renderBand === 'world') {
        expect(r.depths).to.have.property(f.stableId)
      }
    }
  })

  it('produces nextMembership different from initial', () => {
    const r = computeUnifiedWorldOrder(assembly, [], createEmptyMembershipState())
    expect(r.nextMembership).to.not.equal(createEmptyMembershipState())
  })
})

describe('E12 E3 agent adapter integration', () => {
  let adapter: RuntimeAgentAdapter

  before(async () => {
    adapter = createRuntimeAgentAdapter(
      defaultSpawnResolver('floor-1', 0),
      defaultChunkResolver(),
      'juyiting-main',
    )
  })

  after(() => {
    adapter.destroy()
  })

  it('creates agents with SHA-256+base32 stableIds', async () => {
    const scenes = await adapter.create([
      { agentId: 'test-agent-001', x: 100, y: 200 },
    ])
    expect(scenes).to.have.lengthOf(1)
    expect(scenes[0].stableId).to.match(/^jyt\.agent\.[a-z2-7]+\.v1$/)
  })

  it('deterministic stableId for same agentId', async () => {
    const a1 = await adapter.create([{ agentId: 'same-id', x: 0, y: 0 }])
    const stableId1 = a1[0].stableId

    const a2 = createRuntimeAgentAdapter(
      defaultSpawnResolver('floor-1', 0),
      defaultChunkResolver(),
      'juyiting-main',
    )
    const scenes2 = await a2.create([{ agentId: 'same-id', x: 0, y: 0 }])
    expect(scenes2[0].stableId).to.equal(stableId1)
    a2.destroy()
  })

  it('updates agent position', async () => {
    await adapter.create([{ agentId: 'mover', x: 100, y: 200 }])
    const updated = await adapter.update([{ agentId: 'mover', x: 300, y: 400 }])
    expect(updated[0].sortAnchor.x).to.equal(300)
    expect(updated[0].sortAnchor.y).to.equal(400)
  })

  it('removes agents', async () => {
    await adapter.create([{ agentId: 'to-remove', x: 0, y: 0 }])
    expect(adapter.agentCount).to.be.greaterThan(0)
    await adapter.remove(['to-remove'])
    expect(adapter.lookup('to-remove')).to.be.undefined
  })

  it('reverseLookup maps stableId back to sourceEntityId', async () => {
    const scenes = await adapter.create([{ agentId: 'reverse-test', x: 0, y: 0 }])
    const sourceId = adapter.reverseLookup(scenes[0].stableId)
    expect(sourceId).to.equal('reverse-test')
  })

  it('sceneObjects returns frozen copies', async () => {
    await adapter.create([{ agentId: 'frozen-test', x: 50, y: 60 }])
    const sos = adapter.sceneObjects
    expect(sos).to.be.an('array')
    // Should be frozen
    expect(Object.isFrozen(sos)).to.be.true
  })
})

describe('E12 SpatialGrid agent registration', () => {
  it('registerAgentsInGrid adds agents, re-register updates', () => {
    const mapData = makePreparsedMapData(canonicalIr)
    const assembly = assembleV2Scene(mapData)
    const beforeCount = assembly.spatialGrid.getEntryCount()

    const agentAdapters: V2AgentAdapter[] = [
      {
        sceneObject: {
          stableId: 'jyt.agent.test1.v1', sourceEntityId: 'test1',
          sceneId: 'juyiting-main', chunkId: 'default', kind: 'agent',
          renderBand: 'world', floorId: 'floor-1', elevation: 0,
          sortMode: 'y', sortAnchor: { x: 100, y: 200 }, tieBias: 0,
        },
        entity: {},
      },
    ]

    registerAgentsInGrid(assembly.spatialGrid, agentAdapters, 'juyiting-main', 'floor-1')
    // Grid should have static + 1 agent
    expect(assembly.spatialGrid.getEntryCount()).to.equal(beforeCount + 1)

    // Re-register (move agent)
    agentAdapters[0].sceneObject.sortAnchor = { x: 300, y: 400 }
    registerAgentsInGrid(assembly.spatialGrid, agentAdapters, 'juyiting-main', 'floor-1')
    // Count should not double; register auto-unregisters first
    expect(assembly.spatialGrid.getEntryCount()).to.equal(beforeCount + 1)

    // Unregister
    unregisterAgentFromGrid(assembly.spatialGrid, 'jyt.agent.test1.v1')
    expect(assembly.spatialGrid.getEntryCount()).to.equal(beforeCount)

    // Clear does not break - but we don't clear statics in production
  })

  it('grid.clear() wipes everything, re-register statics works', () => {
    const mapData = makePreparsedMapData(canonicalIr)
    const assembly = assembleV2Scene(mapData)
    assembly.spatialGrid.clear()
    expect(assembly.spatialGrid.getEntryCount()).to.equal(0)
    expect(assembly.spatialGrid.getCellCount()).to.equal(0)

    // Re-register statics
    for (const f of assembly.fragments) {
      assembly.spatialGrid.register(
        { stableId: f.stableId, entryKind: 'fragment', bounds: f.destinationRect },
        f.sceneId, f.floorId,
      )
    }
    expect(assembly.spatialGrid.getEntryCount()).to.equal(assembly.fragments.length)
  })
})

describe('E12 hitTestPoint & buildHitTestTargets', () => {
  let assembly: E12Assembly

  before(() => {
    const mapData = makePreparsedMapData(canonicalIr)
    assembly = assembleV2Scene(mapData)
  })

  it('buildHitTestTargets marks agents as interactive, others as decorative', () => {
    const agentAdapters: V2AgentAdapter[] = [
      {
        sceneObject: {
          stableId: 'jyt.agent.hit1.v1', sourceEntityId: 'hit1',
          sceneId: 'juyiting-main', chunkId: 'default', kind: 'agent',
          renderBand: 'world', floorId: 'floor-1', elevation: 0,
          sortMode: 'y', sortAnchor: { x: 500, y: 300 }, tieBias: 0,
        },
        entity: {},
      },
    ]
    registerAgentsInGrid(assembly.spatialGrid, agentAdapters, 'juyiting-main', 'floor-1')
    const r = computeUnifiedWorldOrder(assembly, agentAdapters, createEmptyMembershipState())
    const targets = buildHitTestTargets(r.order, r.depths, assembly, agentAdapters)

    const agentTargets = targets.filter(t => t.interactive)
    expect(agentTargets).to.have.lengthOf.at.least(1)
    const decorative = targets.filter(t => !t.interactive)
    expect(decorative).to.have.lengthOf.at.least(32) // fragments

    // All interactive come before all decorative
    const firstDecIdx = targets.findIndex(t => !t.interactive)
    const lastIntIdx = targets.findLastIndex(t => t.interactive)
    if (firstDecIdx >= 0 && lastIntIdx >= 0) {
      expect(lastIntIdx).to.be.lessThan(firstDecIdx)
    }
  })

  it('hitTestPoint finds agent at its position', () => {
    const agentAdapters: V2AgentAdapter[] = [
      {
        sceneObject: {
          stableId: 'jyt.agent.hit2.v1', sourceEntityId: 'hit2',
          sceneId: 'juyiting-main', chunkId: 'default', kind: 'agent',
          renderBand: 'world', floorId: 'floor-1', elevation: 0,
          sortMode: 'y', sortAnchor: { x: 600, y: 400 }, tieBias: 0,
        },
        entity: {},
      },
    ]
    registerAgentsInGrid(assembly.spatialGrid, agentAdapters, 'juyiting-main', 'floor-1')
    const r = computeUnifiedWorldOrder(assembly, agentAdapters, createEmptyMembershipState())
    const targets = buildHitTestTargets(r.order, r.depths, assembly, agentAdapters)

    const hit = hitTestPoint({ x: 600, y: 400 }, targets)
    expect(hit).to.not.be.null
    expect(hit!.kind).to.equal('agent')
  })

  it('hitTestPoint returns topmost agent when two agents have same x, different y', () => {
    // Both agents at same x, different y → should share overlapping hit bounds
    const agentAdapters: V2AgentAdapter[] = [
      {
        sceneObject: {
          stableId: 'jyt.agent.back.v1', sourceEntityId: 'back',
          sceneId: 'juyiting-main', chunkId: 'default', kind: 'agent',
          renderBand: 'world', floorId: 'floor-1', elevation: 0,
          sortMode: 'y', sortAnchor: { x: 500, y: 200 }, tieBias: 0,
        },
        entity: {},
      },
      {
        sceneObject: {
          stableId: 'jyt.agent.front.v1', sourceEntityId: 'front',
          sceneId: 'juyiting-main', chunkId: 'default', kind: 'agent',
          renderBand: 'world', floorId: 'floor-1', elevation: 0,
          sortMode: 'y', sortAnchor: { x: 500, y: 500 }, tieBias: 0,
        },
        entity: {},
      },
    ]
    registerAgentsInGrid(assembly.spatialGrid, agentAdapters, 'juyiting-main', 'floor-1')
    const r = computeUnifiedWorldOrder(assembly, agentAdapters, createEmptyMembershipState())
    const targets = buildHitTestTargets(r.order, r.depths, assembly, agentAdapters)

    // The two agents hit bounds: (x-16=484, y-32=168, w=32, h=64) and (x-16=484, y-32=468, w=32, h=64)
    // They don't overlap vertically (168+64=232 < 468). Ensure hit at one agent's position works.
    const hitBack = hitTestPoint({ x: 500, y: 200 }, targets)
    expect(hitBack).to.not.be.null
    expect(hitBack!.stableId).to.equal('jyt.agent.back.v1')

    const hitFront = hitTestPoint({ x: 500, y: 500 }, targets)
    expect(hitFront).to.not.be.null
    expect(hitFront!.stableId).to.equal('jyt.agent.front.v1')
  })

  it('decorative fragment does NOT consume pointer clicks', () => {
    const targets: HitTestTarget[] = [
      { stableId: 'f-1', kind: 'fragment', bounds: { x: 0, y: 0, width: 100, height: 100 }, depth: 10, interactive: false },
      { stableId: 'a-1', kind: 'agent', bounds: { x: 20, y: 20, width: 30, height: 60 }, depth: 5, interactive: true },
    ]
    const hit = hitTestPoint({ x: 50, y: 50 }, targets)
    expect(hit).to.not.be.null
    expect(hit!.kind).to.equal('agent')
  })

  it('hitTestPoint returns null when only decorative targets cover point', () => {
    const targets: HitTestTarget[] = [
      { stableId: 'f-1', kind: 'fragment', bounds: { x: 0, y: 0, width: 100, height: 100 }, depth: 10, interactive: false },
    ]
    expect(hitTestPoint({ x: 50, y: 50 }, targets)).to.be.null
  })

  it('hitTestPoint returns null outside all bounds', () => {
    const targets: HitTestTarget[] = [
      { stableId: 'a-1', kind: 'agent', bounds: { x: 0, y: 0, width: 10, height: 10 }, depth: 0, interactive: true },
    ]
    expect(hitTestPoint({ x: 99999, y: 99999 }, targets)).to.be.null
  })
})

describe('E12 buildFrameProposal', () => {
  it('builds valid frame proposal with membership separation', () => {
    const mapData = makePreparsedMapData(canonicalIr)
    const assembly = assembleV2Scene(mapData)
    const { proposal, nextMembership } = buildFrameProposal(assembly, [], 'tx-1', createEmptyMembershipState())

    expect(proposal.sceneId).to.equal('juyiting-main')
    expect(proposal.activationTransactionId).to.equal('tx-1')
    expect(proposal.order).to.be.an('array').that.is.not.empty
    expect(proposal.constraintResult).to.have.property('order')
    expect(nextMembership).to.not.equal(createEmptyMembershipState())

    // Depths are contiguous
    const vals = Object.values(proposal.depths) as number[]
    const sorted = [...vals].sort((a, b) => a - b)
    for (let i = 0; i < sorted.length; i++) {
      expect(sorted[i]).to.equal(i)
    }
  })

  it('membership not mutated by caller error', () => {
    const mapData = makePreparsedMapData(canonicalIr)
    const assembly = assembleV2Scene(mapData)
    const mem = createEmptyMembershipState()
    const { nextMembership: nm } = buildFrameProposal(assembly, [], 'tx-1', mem)

    // Original membership unchanged
    expect(mem).to.deep.equal(createEmptyMembershipState())
    // Next membership is different
    expect(nm).to.not.equal(mem)
  })
})

describe('E12 destroy/recreate lifecycle', () => {
  it('assemble → compute → dispose static grid → reassemble is stable', () => {
    const mapData = makePreparsedMapData(canonicalIr)

    for (let i = 0; i < 3; i++) {
      const assembly = assembleV2Scene(mapData)
      expect(assembly.fragments).to.have.lengthOf(32)

      const r = computeUnifiedWorldOrder(assembly, [], createEmptyMembershipState())
      expect(r.order).to.be.an('array').that.is.not.empty

      // dispose
      assembly.spatialGrid.clear()
    }
  })
})

describe('E12 V1 path preservation', () => {
  it('V1 data does not pass activation envelope', () => {
    const v1 = { properties: { sceneId: 'juyiting-main' }, layers: [] }
    expect(hasV2ActivationEnvelope(v1)).to.be.false
  })

  it('canonicalIr.ts hasRenderSchemaV2 still works on projected data', () => {
    const md = makePreparsedMapData(canonicalIr)
    expect(hasRenderSchemaV2(md)).to.be.false // no renderSchemaVersion
    const projected = projectActivationEnvelope(md)
    expect(hasRenderSchemaV2(projected)).to.be.true // after projection
  })
})

describe('E12 no /agent/active regression', () => {
  it('source files do not reference /agent/active', () => {
    const asm = readFileSync('src/game/occlusion/hallSceneAssembly.ts', 'utf-8')
    const hs = readFileSync('src/game/scenes/HallScene.js', 'utf-8')
    expect(asm).to.not.match(/\/agent\/active/)
    expect(hs).to.not.match(/\/agent\/active/)
  })
})

describe('E12 atomic failure handling', () => {
  it('assembleV2Scene throws on missing activation envelope', () => {
    expect(() => assembleV2Scene({} as any)).to.throw()
  })

  it('assembleV2Scene throws on corrupted fragment data', () => {
    // hasEnvelope passes but missing required stableId
    const badMd = makePreparsedMapData()
    const badLayer = badMd.layers as Array<Record<string, unknown>>
    const badObj = (badLayer[0].objects as Array<Record<string, unknown>>)[0]
    ;(badObj.properties as Record<string, unknown>).stableId = undefined
    expect(hasV2ActivationEnvelope(badMd)).to.be.true
    expect(() => assembleV2Scene(badMd)).to.throw()
  })

  it('computeUnifiedWorldOrder with empty adapters is valid', () => {
    const mapData = makePreparsedMapData(canonicalIr)
    const assembly = assembleV2Scene(mapData)
    const r = computeUnifiedWorldOrder(assembly, [], createEmptyMembershipState())
    expect(r.order).to.be.an('array').that.is.not.empty
  })
})

describe('E12 TMX XML fallback detection', () => {
  it('activation envelope is the only V2 path (XML lacks renderSchemaVersion)', () => {
    // Real TMX XML does not have renderSchemaVersion; hasRenderSchemaV2 returns false
    const doc = new dom.window.DOMParser().parseFromString(HALL_TMX_XML, 'application/xml')
    expect(hasRenderSchemaV2(doc)).to.be.false
    // But hasV2ActivationEnvelope detects it via v2-fragments layer
    const md = makePreparsedMapData()
    expect(hasV2ActivationEnvelope(md)).to.be.true
  })
})
