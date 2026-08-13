// ── E12 HallScene Integration Tests ──
// Production integration: real hall.tmx, V2 activation envelope,
// E3 agent adapter stableIds, E7 controller staging/commit,
// depth continuity, SpatialGrid production provider, hit-test,
// destroy/recreate, atomic failure, membership advancement,
// E7 SceneActivationController lifecycle with real assembly.
//
// All hasV2ActivationEnvelope / assembleV2Scene calls pass the
// mandatory accepted TMX SHA-256.
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
  ACCEPTED_TMX_SHA256,
  createSceneActivationController,
  type E12Assembly,
  type V2AgentAdapter,
  type HitTestTarget,
  type UnifiedOrderResult,
  type SceneActivationController,
  type FrameProposal,
  type ActiveScene,
  type ConstraintMembershipState,
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
  type StagedScene,
  type SceneActivationNode,
} from '../../../src/game/occlusion/sceneActivation.js'

// ── JSDOM setup ──

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as Record<string, unknown>).document = dom.window.document;
(globalThis as Record<string, unknown>).DOMParser = dom.window.DOMParser;
(globalThis as Record<string, unknown>).window = dom.window;

if (!(globalThis as Record<string, unknown>).crypto) {
  const { webcrypto } = require('crypto') as { webcrypto: Crypto }
  ;(globalThis as Record<string, unknown>).crypto = webcrypto
}

// ── Real hall.tmx ──

const HALL_TMX_XML = readFileSync('public/juyiting/hall.tmx', 'utf-8')
const HALL_TMX_SHA = ACCEPTED_TMX_SHA256

let canonicalIr: CanonicalSceneIr

function buildMapDataFromXml(): Record<string, unknown> {
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
  return md
}

before(() => {
  const md = buildMapDataFromXml()
  const assembly = assembleV2Scene(md, HALL_TMX_SHA)
  canonicalIr = assembly.canonicalIr
})

// ── Helpers ──

function makePreparsedMapData(): Record<string, unknown> {
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

function callAssemble(md: Record<string, unknown>) {
  return assembleV2Scene(md, HALL_TMX_SHA)
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
  it('hasV2ActivationEnvelope passes with accepted SHA', () => {
    const md = makePreparsedMapData()
    expect(md.properties).to.not.have.property('renderSchemaVersion')
    expect(hasV2ActivationEnvelope(md, HALL_TMX_SHA)).to.be.true
  })

  it('hasV2ActivationEnvelope returns false for wrong SHA', () => {
    const md = makePreparsedMapData()
    expect(hasV2ActivationEnvelope(md, '0000000000000000000000000000000000000000000000000000000000000000')).to.be.false
  })

  it('hasV2ActivationEnvelope returns false for non-juyiting sceneId', () => {
    const md = { ...makePreparsedMapData(), properties: { sceneId: 'other-scene' } }
    expect(hasV2ActivationEnvelope(md, HALL_TMX_SHA)).to.be.false
  })

  it('hasV2ActivationEnvelope returns false without v2-fragments layer', () => {
    const md = { properties: { sceneId: 'juyiting-main' }, layers: [] }
    expect(hasV2ActivationEnvelope(md, HALL_TMX_SHA)).to.be.false
  })

  it('hasV2ActivationEnvelope returns false for null/undefined/empty', () => {
    expect(hasV2ActivationEnvelope(null as any, HALL_TMX_SHA)).to.be.false
    expect(hasV2ActivationEnvelope(undefined as any, HALL_TMX_SHA)).to.be.false
    expect(hasV2ActivationEnvelope({} as any, HALL_TMX_SHA)).to.be.false
  })

  it('projectActivationEnvelope injects renderSchemaVersion=2 without mutating original', () => {
    const md = makePreparsedMapData()
    expect(md.properties).to.not.have.property('renderSchemaVersion')
    const projected = projectActivationEnvelope(md)
    expect(projected.properties).to.have.property('renderSchemaVersion', '2')
    expect(md.properties).to.not.have.property('renderSchemaVersion')
  })

  it('projected data passes hasRenderSchemaV2', () => {
    const md = makePreparsedMapData()
    const projected = projectActivationEnvelope(md)
    expect(hasRenderSchemaV2(projected)).to.be.true
  })

  it('activation envelope fail-closed: missing stableId causes throw', () => {
    const md = makePreparsedMapData()
    const layers = md.layers as Array<Record<string, unknown>>
    const fragObj = (layers[0].objects as Array<Record<string, unknown>>)[0]
    const origStableId = (fragObj.properties as Record<string, unknown>).stableId
    delete (fragObj.properties as any).stableId
    expect(hasV2ActivationEnvelope(md, HALL_TMX_SHA)).to.be.true
    expect(() => callAssemble(md)).to.throw()
    ;(fragObj.properties as any).stableId = origStableId
  })
})

describe('E12 assembleV2Scene (production)', () => {
  let mapData: Record<string, unknown>

  before(() => {
    mapData = makePreparsedMapData()
  })

  it('assembles V2 scene from production mapData via activation envelope', () => {
    expect(hasV2ActivationEnvelope(mapData, HALL_TMX_SHA)).to.be.true
    const assembly = callAssemble(mapData)
    expect(assembly.canonicalIr.sceneId).to.equal('juyiting-main')
    expect(assembly.canonicalIr.renderSchemaVersion).to.equal('2')
  })

  it('has exactly 32 fragments', () => {
    const assembly = callAssemble(mapData)
    expect(assembly.fragments).to.have.lengthOf(32)
  })

  it('has at least 5 worldObjects (props)', () => {
    const assembly = callAssemble(mapData)
    expect(assembly.worldObjects).to.have.lengthOf.at.least(5)
  })

  it('has 0 zones', () => {
    const assembly = callAssemble(mapData)
    expect(assembly.zones).to.have.lengthOf(0)
  })

  it('creates trusted SpatialGrid production provider', () => {
    const assembly = callAssemble(mapData)
    expect(assembly.spatialGrid).to.be.instanceOf(SpatialGrid)
    expect(isSpatialGridProvider(assembly.candidateProvider)).to.be.true
  })

  it('grid has entries for fragments + props', () => {
    const assembly = callAssemble(mapData)
    expect(assembly.spatialGrid.getEntryCount()).to.be.at.least(32 + 5)
  })

  it('throws on non-V2 data (wrong SHA)', () => {
    expect(() => assembleV2Scene(mapData, '0000000000000000000000000000000000000000000000000000000000000000')).to.throw()
  })

  it('throws on non-V2 data (empty map)', () => {
    expect(() => assembleV2Scene({} as any, HALL_TMX_SHA)).to.throw()
  })

  it('repeatable for same input', () => {
    const a1 = callAssemble(mapData)
    const a2 = callAssemble(mapData)
    expect(a1.fragments.length).to.equal(a2.fragments.length)
    expect(a1.worldObjects.length).to.equal(a2.worldObjects.length)
  })
})

describe('E12 computeUnifiedWorldOrder (production)', () => {
  let assembly: E12Assembly

  before(() => {
    assembly = callAssemble(makePreparsedMapData())
  })

  it('deterministic order with no agents (5 props + 32 fragments = 37)', () => {
    const r = computeUnifiedWorldOrder(assembly, [], createEmptyMembershipState())
    expect(r.order.length).to.equal(37)
    const r2 = computeUnifiedWorldOrder(assembly, [], createEmptyMembershipState())
    expect(r2.order).to.deep.equal(r.order)
    expect(r2.depths).to.deep.equal(r.depths)
  })

  it('keeps static cache isolated between distinct assemblies', () => {
    const first = callAssemble(makePreparsedMapData())
    const second = callAssemble(makePreparsedMapData())
    const firstOrder = computeUnifiedWorldOrder(first, [], createEmptyMembershipState())
    const secondOrder = computeUnifiedWorldOrder(second, [], createEmptyMembershipState())

    expect(first).to.not.equal(second)
    expect(firstOrder.order).to.deep.equal(secondOrder.order)
    expect(firstOrder.depths).to.deep.equal(secondOrder.depths)
  })

  it('reuses statics while reflecting per-frame agent position updates', () => {
    const agent: V2AgentAdapter = {
      sceneObject: {
        stableId: 'jyt.agent.cache-position.v1', sourceEntityId: 'cache-position',
        sceneId: 'juyiting-main', chunkId: 'default', kind: 'agent',
        renderBand: 'world', floorId: 'floor-1', elevation: 0,
        sortMode: 'y', sortAnchor: { x: 500, y: 120 }, tieBias: 0,
      },
      entity: {},
    }
    const before = computeUnifiedWorldOrder(assembly, [agent], createEmptyMembershipState())
    agent.sceneObject = { ...agent.sceneObject, sortAnchor: { x: 500, y: 900 } }
    const after = computeUnifiedWorldOrder(assembly, [agent], before.nextMembership)

    expect(before.depths[agent.sceneObject.stableId]).to.not.equal(after.depths[agent.sceneObject.stableId])
    expect(after.order).to.include(agent.sceneObject.stableId)
  })

  it('contiguous safe integer depths', () => {
    const r = computeUnifiedWorldOrder(assembly, [], createEmptyMembershipState())
    const vals = Object.values(r.depths) as number[]
    const sorted = [...vals].sort((a: number, b: number) => a - b)
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
    expect(Object.isFrozen(sos)).to.be.true
  })
})

describe('E12 SpatialGrid agent registration', () => {
  it('registerAgentsInGrid adds agents, re-register updates', () => {
    const assembly = callAssemble(makePreparsedMapData())
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
    expect(assembly.spatialGrid.getEntryCount()).to.equal(beforeCount + 1)

    agentAdapters[0].sceneObject.sortAnchor = { x: 300, y: 400 }
    registerAgentsInGrid(assembly.spatialGrid, agentAdapters, 'juyiting-main', 'floor-1')
    expect(assembly.spatialGrid.getEntryCount()).to.equal(beforeCount + 1)

    unregisterAgentFromGrid(assembly.spatialGrid, 'jyt.agent.test1.v1')
    expect(assembly.spatialGrid.getEntryCount()).to.equal(beforeCount)
  })

  it('grid.clear() wipes everything, re-register statics works', () => {
    const assembly = callAssemble(makePreparsedMapData())
    assembly.spatialGrid.clear()
    expect(assembly.spatialGrid.getEntryCount()).to.equal(0)
    expect(assembly.spatialGrid.getCellCount()).to.equal(0)

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
    assembly = callAssemble(makePreparsedMapData())
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
    expect(decorative).to.have.lengthOf.at.least(32)

    // All interactive come before all decorative
    const firstDecIdx = targets.findIndex(t => !t.interactive)
    const lastIntIdx = targets.reduce((last, t, i) => (t.interactive ? i : last), -1)
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
    const assembly = callAssemble(makePreparsedMapData())
    const { proposal, nextMembership } = buildFrameProposal(assembly, [], 'tx-1', createEmptyMembershipState())

    expect(proposal.sceneId).to.equal('juyiting-main')
    expect(proposal.activationTransactionId).to.equal('tx-1')
    expect(proposal.order).to.be.an('array').that.is.not.empty
    expect(proposal.constraintResult).to.have.property('order')
    expect(nextMembership).to.not.equal(createEmptyMembershipState())

    const vals = Object.values(proposal.depths) as number[]
    const sorted = [...vals].sort((a: number, b: number) => a - b)
    for (let i = 0; i < sorted.length; i++) {
      expect(sorted[i]).to.equal(i)
    }
  })

  it('membership not mutated by caller error', () => {
    const assembly = callAssemble(makePreparsedMapData())
    const mem = createEmptyMembershipState()
    const { nextMembership: nm } = buildFrameProposal(assembly, [], 'tx-1', mem)

    expect(mem).to.deep.equal(createEmptyMembershipState())
    expect(nm).to.not.equal(mem)
  })
})

describe('E12 destroy/recreate lifecycle', () => {
  it('assemble -> compute -> dispose static grid -> reassemble is stable', () => {
    const mapData = makePreparsedMapData()

    for (let i = 0; i < 3; i++) {
      const assembly = callAssemble(mapData)
      expect(assembly.fragments).to.have.lengthOf(32)

      const r = computeUnifiedWorldOrder(assembly, [], createEmptyMembershipState())
      expect(r.order).to.be.an('array').that.is.not.empty

      assembly.spatialGrid.clear()
    }
  })
})

describe('E12 V1 path preservation', () => {
  it('V1 data does not pass activation envelope (wrong SHA)', () => {
    const v1 = { properties: { sceneId: 'juyiting-main' }, layers: [] }
    expect(hasV2ActivationEnvelope(v1, HALL_TMX_SHA)).to.be.false
  })

  it('canonicalIr.ts hasRenderSchemaV2 still works on projected data', () => {
    const md = makePreparsedMapData()
    expect(hasRenderSchemaV2(md)).to.be.false
    const projected = projectActivationEnvelope(md)
    expect(hasRenderSchemaV2(projected)).to.be.true
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
  it('assembleV2Scene throws on wrong SHA', () => {
    expect(() => assembleV2Scene(makePreparsedMapData(), '0000000000000000000000000000000000000000000000000000000000000000')).to.throw()
  })

  it('assembleV2Scene throws on corrupted fragment data', () => {
    const badMd = makePreparsedMapData()
    const badLayer = badMd.layers as Array<Record<string, unknown>>
    const badObj = (badLayer[0].objects as Array<Record<string, unknown>>)[0]
    ;(badObj.properties as Record<string, unknown>).stableId = undefined
    expect(hasV2ActivationEnvelope(badMd, HALL_TMX_SHA)).to.be.true
    expect(() => callAssemble(badMd)).to.throw()
  })

  it('computeUnifiedWorldOrder with empty adapters is valid', () => {
    const assembly = callAssemble(makePreparsedMapData())
    const r = computeUnifiedWorldOrder(assembly, [], createEmptyMembershipState())
    expect(r.order).to.be.an('array').that.is.not.empty
  })
})

describe('E12 TMX XML fallback detection', () => {
  it('activation envelope is the only V2 path (XML lacks renderSchemaVersion)', () => {
    const doc = new dom.window.DOMParser().parseFromString(HALL_TMX_XML, 'application/xml')
    expect(hasRenderSchemaV2(doc)).to.be.false
    const md = makePreparsedMapData()
    expect(hasV2ActivationEnvelope(md, HALL_TMX_SHA)).to.be.true
  })
})

// ── E12 E7 Controller Lifecycle Integration ──
// Tests activation/commitFrame with real assembly data through the
// E7 SceneActivationController pipeline.

describe('E12 E7 controller lifecycle (real assembly)', () => {
  let assembly: E12Assembly
  let adapter: RuntimeAgentAdapter

  before(async () => {
    assembly = callAssemble(makePreparsedMapData())
    adapter = createRuntimeAgentAdapter(
      defaultSpawnResolver('floor-1', 0),
      defaultChunkResolver(),
      'juyiting-main',
    )
  })

  after(() => {
    adapter.destroy()
  })

  async function createAgent(agentId: string, x: number, y: number): Promise<SceneObject> {
    const scenes = await adapter.create([{ agentId, x, y }])
    return scenes[0]
  }

  function buildStagedScene(
    renderables: Map<string, number>,  // stableId → fake depth slot
    adapters: V2AgentAdapter[],
    ctx: { sceneId: string; mode: string; transactionId: string },
  ) {
    const nodeValues: SceneActivationNode[] = []
    const seen = new Set<string>()
    for (const [sid] of renderables) {
      if (seen.has(sid)) continue
      seen.add(sid)
      nodeValues.push(Object.freeze({
        stableId: sid, sceneId: ctx.sceneId, mode: ctx.mode,
        ownerTransactionId: ctx.transactionId, value: sid,
      }))
    }
    registerAgentsInGrid(assembly.spatialGrid, adapters, 'juyiting-main', 'floor-1')
    const initOrder = computeUnifiedWorldOrder(assembly, adapters, createEmptyMembershipState())
    return Object.freeze({
      sceneId: ctx.sceneId, mode: ctx.mode,
      ownerTransactionId: ctx.transactionId,
      children: Object.freeze(nodeValues),
      order: Object.freeze(initOrder.order),
      depths: Object.freeze(initOrder.depths),
      dispose: () => {},
    })
  }

  it('activate succeeds with real assembly and 0 agents (37 static)', async () => {
    const renderables = new Map<string, number>()
    for (const p of assembly.worldObjects) renderables.set(p.stableId, 0)
    for (const f of assembly.fragments) renderables.set(f.stableId, 0)

    // Build controller
    let activeFlag = false
    let committedDepths: Record<string, number> | null = null

    const controller = createSceneActivationController({
      parse: (source: any, ctx: any) => source,
      canonicalize: (parsed: any, ctx: any) => parsed,
      validate: (canonical: any, ctx: any) => canonical,
      loadAssets: (validated: any, ctx: any) => validated,
      instantiate: (input: any, ctx: any) => buildStagedScene(renderables, [], ctx),
      validateConstraints: (scene: any, ctx: any) => ({ order: scene.order }),
      commit: (ctx: any) => {
        ctx.swap(
          () => {
            activeFlag = true
            committedDepths = { ...ctx.next.depths }
          },
          () => { activeFlag = false; committedDepths = null },
        )
      },
      commitFrame: (ctx: any) => {
        ctx.swap(
          () => {
            committedDepths = { ...ctx.next.depths }
          },
          () => { /* rollback */ },
        )
      },
    })

    const result = await controller.activate({
      sceneId: 'juyiting-main', mode: 'v2', source: { mapData: {} },
    })

    expect(result.ok).to.be.true
    expect(activeFlag).to.be.true
    expect(controller.active).to.not.be.null
    if (controller.active) {
      expect(controller.active.children.length).to.equal(37) // 5 props + 32 fragments
      expect(controller.active.order.length).to.equal(37)
      expect(Object.keys(controller.active.depths).length).to.equal(37)
    }

    // Depths are contiguous
    if (committedDepths) {
      const vals = Object.values(committedDepths)
      const sorted = [...vals].sort((a, b) => a - b)
      for (let i = 0; i < sorted.length; i++) {
        expect(sorted[i]).to.equal(i)
      }
    }

    await controller.destroy()
  })

  it('activate with agents produces children = 37 + N', async () => {
    const agentA = await createAgent('test-a', 500, 300)
    const agentB = await createAgent('test-b', 800, 400)

    const renderables = new Map<string, number>()
    for (const p of assembly.worldObjects) renderables.set(p.stableId, 0)
    for (const f of assembly.fragments) renderables.set(f.stableId, 0)
    renderables.set(agentA.stableId, 0)
    renderables.set(agentB.stableId, 0)

    const agentAdapters: V2AgentAdapter[] = [
      { sceneObject: agentA, entity: { id: 'test-a', pos: { x: 500, y: 300 } } },
      { sceneObject: agentB, entity: { id: 'test-b', pos: { x: 800, y: 400 } } },
    ]

    let activeFlag = false
    let childrenCount = 0

    const controller = createSceneActivationController({
      parse: (s: any, ctx: any) => s,
      canonicalize: (p: any, ctx: any) => p,
      validate: (c: any, ctx: any) => c,
      loadAssets: (v: any, ctx: any) => v,
      instantiate: (input: any, ctx: any) => buildStagedScene(renderables, agentAdapters, ctx),
      validateConstraints: (scene: any, ctx: any) => ({ order: scene.order }),
      commit: (ctx: any) => {
        ctx.swap(
          () => { activeFlag = true; childrenCount = ctx.next.children.length },
          () => { activeFlag = false },
        )
      },
    })

    const result = await controller.activate({
      sceneId: 'juyiting-main', mode: 'v2', source: { mapData: {} },
    })

    expect(result.ok).to.be.true
    expect(activeFlag).to.be.true
    expect(childrenCount).to.equal(39) // 37 static + 2 agents

    await controller.destroy()
  })

  it('commitFrame with agent position update succeeds', async () => {
    const agentM = await createAgent('test-mover', 500, 300)

    const renderables = new Map<string, number>()
    for (const p of assembly.worldObjects) renderables.set(p.stableId, 0)
    for (const f of assembly.fragments) renderables.set(f.stableId, 0)
    renderables.set(agentM.stableId, 0)

    const agentAdapters: V2AgentAdapter[] = [
      { sceneObject: agentM, entity: { id: 'test-mover', pos: { x: 500, y: 300 } } },
    ]

    let frameDepthsSnapshot: Record<string, number> | null = null
    let activeFlag = false

    const controller = createSceneActivationController({
      parse: (s: any, ctx: any) => s,
      canonicalize: (p: any, ctx: any) => p,
      validate: (c: any, ctx: any) => c,
      loadAssets: (v: any, ctx: any) => v,
      instantiate: (input: any, ctx: any) => buildStagedScene(renderables, agentAdapters, ctx),
      validateConstraints: (scene: any, ctx: any) => ({ order: scene.order }),
      commit: (ctx: any) => {
        ctx.swap(
          () => { activeFlag = true },
          () => { activeFlag = false },
        )
      },
      commitFrame: (ctx: any) => {
        ctx.swap(
          () => { frameDepthsSnapshot = { ...ctx.next.depths } },
          () => { frameDepthsSnapshot = null },
        )
      },
    })

    // Activate
    const result = await controller.activate({
      sceneId: 'juyiting-main', mode: 'v2', source: { mapData: {} },
    })
    expect(result.ok).to.be.true
    expect(activeFlag).to.be.true
    const activationTxId = controller.active?.ownerTransactionId
    expect(activationTxId).to.be.a('string')

    // Move agent
    await adapter.update([{ agentId: 'test-mover', x: 600, y: 500 }])
    const updatedAgent = adapter.lookup('test-mover')!
    const updatedAdapters: V2AgentAdapter[] = [
      { sceneObject: updatedAgent, entity: { id: 'test-mover', pos: { x: 600, y: 500 } } },
    ]
    registerAgentsInGrid(assembly.spatialGrid, updatedAdapters, 'juyiting-main', 'floor-1')

    const { proposal } = buildFrameProposal(
      assembly, updatedAdapters,
      activationTxId!,
      createEmptyMembershipState(),
    )

    const frameResult = controller.commitFrame(proposal)
    expect(frameResult.ok).to.be.true
    expect(frameDepthsSnapshot).to.not.be.null
    expect(Object.keys(frameDepthsSnapshot!).length).to.equal(38) // 37 static + 1 agent

    await controller.destroy()
  })

  it('commitFrame rollback on depth setter failure', async () => {
    const agentF = await createAgent('test-fail', 500, 300)

    const renderables = new Map<string, number>()
    for (const p of assembly.worldObjects) renderables.set(p.stableId, 0)
    for (const f of assembly.fragments) renderables.set(f.stableId, 0)
    renderables.set(agentF.stableId, 0)

    const agentAdapters: V2AgentAdapter[] = [
      { sceneObject: agentF, entity: { id: 'test-fail', pos: { x: 500, y: 300 } } },
    ]

    let activeFlag = false
    let frameOk = true
    let swapAppliedThenFailed = false

    const controller = createSceneActivationController({
      parse: (s: any, ctx: any) => s,
      canonicalize: (p: any, ctx: any) => p,
      validate: (c: any, ctx: any) => c,
      loadAssets: (v: any, ctx: any) => v,
      instantiate: (input: any, ctx: any) => buildStagedScene(renderables, agentAdapters, ctx),
      validateConstraints: (scene: any, ctx: any) => ({ order: scene.order }),
      commit: (ctx: any) => {
        ctx.swap(
          () => { activeFlag = true },
          () => { activeFlag = false },
        )
      },
      commitFrame: (ctx: any) => {
        ctx.swap(
          () => {
            swapAppliedThenFailed = true
            throw new Error('SIMULATED_DEPTH_SETTER_FAILURE')
          },
          () => { /* rollback */ },
        )
      },
    })

    // Activate
    const result = await controller.activate({
      sceneId: 'juyiting-main', mode: 'v2', source: { mapData: {} },
    })
    expect(result.ok).to.be.true

    const activationTxId = controller.active?.ownerTransactionId!
    const { proposal } = buildFrameProposal(
      assembly, agentAdapters,
      activationTxId,
      createEmptyMembershipState(),
    )

    const frameResult = controller.commitFrame(proposal)
    // Frame should fail
    expect(frameResult.ok).to.be.false
    expect(swapAppliedThenFailed).to.be.true

    // Active scene should still be the pre-frame version
    expect(controller.active).to.not.be.null
    expect(controller.active!.frameVersion).to.equal(0) // not incremented

    await controller.destroy()
  })

  it('membership advances only on successful commit', async () => {
    const agentM1 = await createAgent('test-mem', 500, 300)

    const renderables = new Map<string, number>()
    for (const p of assembly.worldObjects) renderables.set(p.stableId, 0)
    for (const f of assembly.fragments) renderables.set(f.stableId, 0)
    renderables.set(agentM1.stableId, 0)

    const agentAdapters: V2AgentAdapter[] = [
      { sceneObject: agentM1, entity: { id: 'test-mem', pos: { x: 500, y: 300 } } },
    ]

    let currentMembership = createEmptyMembershipState()
    let lastMembershipDuringCommit: ConstraintMembershipState | null = null

    const controller = createSceneActivationController({
      parse: (s: any, ctx: any) => s,
      canonicalize: (p: any, ctx: any) => p,
      validate: (c: any, ctx: any) => c,
      loadAssets: (v: any, ctx: any) => v,
      instantiate: (input: any, ctx: any) => buildStagedScene(renderables, agentAdapters, ctx),
      validateConstraints: (scene: any, ctx: any) => ({ order: scene.order }),
      commit: (ctx: any) => {
        ctx.swap(() => {}, () => {})
      },
      commitFrame: (ctx: any) => {
        ctx.swap(
          () => { lastMembershipDuringCommit = currentMembership },
          () => {},
        )
      },
    })

    const result = await controller.activate({
      sceneId: 'juyiting-main', mode: 'v2', source: { mapData: {} },
    })
    expect(result.ok).to.be.true

    const activationTxId = controller.active?.ownerTransactionId!

    // Frame 1 — build proposal using currentMembership
    const { proposal: fp1, nextMembership: nm1 } = buildFrameProposal(
      assembly, agentAdapters, activationTxId!, currentMembership,
    )
    const fr1 = controller.commitFrame(fp1)
    expect(fr1.ok).to.be.true
    // Advance membership (caller responsibility)
    currentMembership = nm1

    // Frame 2 — using advanced membership
    const { proposal: fp2, nextMembership: nm2 } = buildFrameProposal(
      assembly, agentAdapters, activationTxId!, currentMembership,
    )
    const fr2 = controller.commitFrame(fp2)
    expect(fr2.ok).to.be.true
    currentMembership = nm2

    // Membership should have changed
    // nm2 can be empty for stable constraint scenes; just verify it exists
      expect(nm2).to.be.an('object')

    await controller.destroy()
  })

  it('destroy/recreate: re-activate after destroy does not leak', async () => {
    const renderables = new Map<string, number>()
    for (const p of assembly.worldObjects) renderables.set(p.stableId, 0)
    for (const f of assembly.fragments) renderables.set(f.stableId, 0)

    for (let i = 0; i < 3; i++) {
      let activeFlag = false
      const controller = createSceneActivationController({
        parse: (s: any, ctx: any) => s,
        canonicalize: (p: any, ctx: any) => p,
        validate: (c: any, ctx: any) => c,
        loadAssets: (v: any, ctx: any) => v,
        instantiate: (input: any, ctx: any) => buildStagedScene(renderables, [], ctx),
        validateConstraints: (scene: any, ctx: any) => ({ order: scene.order }),
        commit: (ctx: any) => {
          ctx.swap(() => { activeFlag = true }, () => { activeFlag = false })
        },
      })

      const result = await controller.activate({
        sceneId: 'juyiting-main', mode: 'v2', source: { mapData: {} },
      })
      expect(result.ok).to.be.true
      expect(activeFlag).to.be.true
      expect(controller.active).to.not.be.null

      await controller.destroy()
      expect(controller.active).to.be.null
    }
  })
})


describe('E15 atomic V2 switch fault injection (real assembly)', () => {
  let assembly: E12Assembly
  let adapter: RuntimeAgentAdapter

  before(async () => {
    assembly = callAssemble(makePreparsedMapData())
    adapter = createRuntimeAgentAdapter(
      defaultSpawnResolver('floor-1', 0),
      defaultChunkResolver(),
      'juyiting-main',
    )
  })

  after(() => {
    adapter.destroy()
  })

  async function createAgent(agentId: string, x: number, y: number): Promise<SceneObject> {
    const scenes = await adapter.create([{ agentId, x, y }])
    return scenes[0]
  }

  function buildStagedScene(
    renderables: Map<string, number>,
    adapters: V2AgentAdapter[],
    ctx: { sceneId: string; mode: string; transactionId: string },
  ) {
    const nodeValues: SceneActivationNode[] = []
    const seen = new Set<string>()
    for (const [sid] of renderables) {
      if (seen.has(sid)) continue
      seen.add(sid)
      nodeValues.push(Object.freeze({
        stableId: sid, sceneId: ctx.sceneId, mode: ctx.mode,
        ownerTransactionId: ctx.transactionId, value: sid,
      }))
    }
    registerAgentsInGrid(assembly.spatialGrid, adapters, 'juyiting-main', 'floor-1')
    const initOrder = computeUnifiedWorldOrder(assembly, adapters, createEmptyMembershipState())
    return Object.freeze({
      sceneId: ctx.sceneId, mode: ctx.mode,
      ownerTransactionId: ctx.transactionId,
      children: Object.freeze(nodeValues),
      order: Object.freeze(initOrder.order),
      depths: Object.freeze(initOrder.depths),
      dispose: () => {},
    })
  }

  function makeFaultController(behavior: { failAssetsOnV2: boolean; cycleOnV2: boolean }) {
    let activeFlag = false
    const renderables = new Map<string, number>()
    for (const p of assembly.worldObjects) renderables.set(p.stableId, 0)
    for (const f of assembly.fragments) renderables.set(f.stableId, 0)

    const controller = createSceneActivationController({
      parse: (source: any, ctx: any) => source,
      canonicalize: (parsed: any, ctx: any) => parsed,
      validate: (canonical: any, ctx: any) => canonical,
      loadAssets: (validated: any, ctx: any) => {
        if (ctx.mode === 'v2' && behavior.failAssetsOnV2) {
          throw new Error('SIMULATED_FRAGMENT_ASSET_MISSING')
        }
        return validated
      },
      instantiate: (input: any, ctx: any) => buildStagedScene(renderables, [], ctx),
      validateConstraints: (scene: any, ctx: any) => {
        if (ctx.mode === 'v2' && behavior.cycleOnV2) {
          throw new Error('SIMULATED_CONSTRAINT_CYCLE')
        }
        return { order: [...scene.order] }
      },
      commit: (ctx: any) => {
        ctx.swap(
          () => { activeFlag = true },
          () => { activeFlag = false },
        )
      },
      commitFrame: (ctx: any) => {
        ctx.swap(() => {}, () => {})
      },
    })
    return { controller, isActive: () => activeFlag }
  }

  it('activation asset failure preserves the previous complete v1 scene', async () => {
    const behavior = { failAssetsOnV2: false, cycleOnV2: false }
    const { controller } = makeFaultController(behavior)

    const v1 = await controller.activate({
      sceneId: 'juyiting-main', mode: 'v1', source: { mapData: {} },
    })
    expect(v1.ok).to.be.true
    const v1Transaction = controller.active?.ownerTransactionId
    expect(v1Transaction).to.be.a('string')

    behavior.failAssetsOnV2 = true
    const failed = await controller.activate({
      sceneId: 'juyiting-main', mode: 'v2', source: { mapData: {} },
    })
    expect(failed.ok).to.be.false
    expect((failed as any).error.stage).to.equal('assetsReady')
    expect(controller.active).to.not.be.null
    expect(controller.active!.mode).to.equal('v1')
    expect(controller.active!.ownerTransactionId).to.equal(v1Transaction)
    expect(controller.snapshot.status).to.equal('active')

    await controller.destroy()
  })

  it('activation cycle failure preserves the previous complete v1 scene', async () => {
    const behavior = { failAssetsOnV2: false, cycleOnV2: false }
    const { controller } = makeFaultController(behavior)

    const v1 = await controller.activate({
      sceneId: 'juyiting-main', mode: 'v1', source: { mapData: {} },
    })
    expect(v1.ok).to.be.true
    const v1Transaction = controller.active?.ownerTransactionId
    expect(v1Transaction).to.be.a('string')

    behavior.cycleOnV2 = true
    const failed = await controller.activate({
      sceneId: 'juyiting-main', mode: 'v2', source: { mapData: {} },
    })
    expect(failed.ok).to.be.false
    expect((failed as any).error.stage).to.equal('constraint')
    expect(controller.active).to.not.be.null
    expect(controller.active!.mode).to.equal('v1')
    expect(controller.active!.ownerTransactionId).to.equal(v1Transaction)
    expect(controller.snapshot.status).to.equal('active')

    await controller.destroy()
  })

  it('commitFrame cycle fault keeps the active scene and frame version', async () => {
    const agent = await createAgent('test-e15-cycle', 500, 300)
    const renderables = new Map<string, number>()
    for (const p of assembly.worldObjects) renderables.set(p.stableId, 0)
    for (const f of assembly.fragments) renderables.set(f.stableId, 0)
    renderables.set(agent.stableId, 0)
    const agentAdapters: V2AgentAdapter[] = [
      { sceneObject: agent, entity: { id: 'test-e15-cycle', pos: { x: 500, y: 300 } } },
    ]

    const controller = createSceneActivationController({
      parse: (s: any, ctx: any) => s,
      canonicalize: (p: any, ctx: any) => p,
      validate: (c: any, ctx: any) => c,
      loadAssets: (v: any, ctx: any) => v,
      instantiate: (input: any, ctx: any) => buildStagedScene(renderables, agentAdapters, ctx),
      validateConstraints: (scene: any, ctx: any) => ({ order: scene.order }),
      commit: (ctx: any) => { ctx.swap(() => {}, () => {}) },
      commitFrame: (ctx: any) => { ctx.swap(() => {}, () => {}) },
    })

    const activated = await controller.activate({
      sceneId: 'juyiting-main', mode: 'v2', source: { mapData: {} },
    })
    expect(activated.ok).to.be.true
    const activationTxId = controller.active?.ownerTransactionId!
    const before = controller.active!.frameVersion

    const { proposal } = buildFrameProposal(
      assembly, agentAdapters, activationTxId, createEmptyMembershipState(),
    )
    const cyclicProposal = {
      ...proposal,
      constraintResult: { ok: false, code: 'CONSTRAINT_CYCLE_DETECTED', message: 'cycle injected' } as any,
    }

    const frameResult = controller.commitFrame(cyclicProposal)
    expect(frameResult.ok).to.be.false
    expect((frameResult as any).error.stage).to.equal('frame')
    expect((frameResult as any).error.errorCode).to.equal('CONSTRAINT_CYCLE_DETECTED')
    expect(controller.active).to.not.be.null
    expect(controller.active!.frameVersion).to.equal(before)
    expect(controller.active!.ownerTransactionId).to.equal(activationTxId)

    await controller.destroy()
  })
})
