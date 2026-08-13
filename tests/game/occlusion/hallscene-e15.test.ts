/* eslint-disable @typescript-eslint/no-explicit-any -- the melonJS fake and mapData fixtures are intentionally dynamic test doubles */
// ── E15 HallScene Atomic V2 Switch Fault-Injection Tests ──
// Exercises the real HallScene active-path switch through a minimal melonJS
// fake: repeated activation, in-flight activation, resource failure, frame
// rollback, and roster-replacement failure. No fake fixtures — real hall.tmx
// and the accepted TMX SHA are used.

// @ts-expect-error chai ships no bundled declarations in this tsconfig
import { expect } from 'chai'
import { describe, it } from 'mocha'
import { readFileSync } from 'fs'
import { JSDOM } from 'jsdom'
import { webcrypto } from 'node:crypto'

import { ACCEPTED_TMX_SHA256 } from '../../../src/game/occlusion/hallSceneAssembly.js'
// @ts-expect-error hallSceneDepthBands is an existing JavaScript runtime module without declarations
import { HALL_SCENE_DEPTH_BANDS } from '../../../src/game/occlusion/hallSceneDepthBands.js'
// @ts-expect-error HallScene is an existing JavaScript runtime module without declarations
import { createHallSceneClass } from '../../../src/game/scenes/HallScene.js'
// @ts-expect-error tiledMap is an existing JavaScript runtime module without declarations
import { parseJuyiHallTmx } from '../../../src/game/tiledMap.js'

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost' } as any);
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).navigator = (dom.window as any).navigator;
(globalThis as any).DOMParser = (dom.window as any).DOMParser;

if (!(globalThis as any).crypto) {
  ;(globalThis as any).crypto = webcrypto
}

const HALL_TMX_XML = readFileSync('public/juyiting/hall.tmx', 'utf-8')

const waitFor = async (predicate: () => boolean, timeoutMs = 2000) => {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for HallScene state')
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

function createFakeMelon() {
  const children: Array<{ child: any; depth: number }> = []
  const currentTransform = {
    identity: () => currentTransform,
    translate: () => currentTransform,
    scale: () => currentTransform,
  }
  const canvas = {
    style: {},
    addEventListener: () => {},
    removeEventListener: () => {},
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    getBoundingClientRect: () => ({ width: 960, height: 640, left: 0, top: 0 }),
    closest: () => null,
    parentElement: null,
  }

  class Stage { update() {} }
  class Renderable {
    pos: { x: number; y: number }
    width: number
    height: number
    depth: number
    anchorPoint: { set: (...args: any[]) => void }
    image: any
    constructor(x = 0, y = 0, w = 0, h = 0) {
      this.pos = { x, y }
      this.width = w
      this.height = h
      this.depth = 0
      this.anchorPoint = { set: () => {} }
      this.image = null
    }
    getBounds() {
      return { x: this.pos.x, y: this.pos.y, width: this.width, height: this.height, contains: () => true }
    }
    draw() {}
  }

  const me: any = {
    Stage,
    Renderable,
    game: {
      viewport: { width: 960, height: 640 },
      world: {
        currentTransform,
        addChild: (child: any, depth?: number) => {
          if (!children.some(item => item.child === child)) children.push({ child, depth: depth ?? 0 })
          if (depth !== undefined) child.depth = depth
          return child
        },
        removeChild: (child: any) => {
          const index = children.findIndex(item => item.child === child)
          if (index >= 0) children.splice(index, 1)
        },
        hasChild: (child: any) => children.some(item => item.child === child),
        sort: () => {},
      },
    },
    input: {},
    loader: { getImage: () => null },
    video: { getCanvas: () => canvas },
    children,
  }
  return me
}

function productionMapData() {
  const mapData = parseJuyiHallTmx(HALL_TMX_XML, { movementEnabled: false })
  // Skip the base tile compositing path so JSDOM does not need a real canvas
  // context; the V1/V2 layer stack under test is image-layer driven.
  mapData.tileLayers = []
  return mapData
}

function installProductionImages(me: any, mapData: any) {
  const images = new Map<string, any>()
  for (const tileset of mapData.tilesets || []) {
    if (tileset.tiles?.length) {
      for (const tile of tileset.tiles) {
        if (tile?.resourceName) images.set(tile.resourceName, { width: tile.width, height: tile.height })
      }
    } else if (tileset.tilesetResourceName) {
      images.set(tileset.tilesetResourceName, { width: tileset.imagewidth, height: tileset.imageheight })
    }
  }
  for (const layer of Object.values<any>(mapData.imageLayers || {})) {
    if (layer.resourceName) images.set(layer.resourceName, { width: layer.width, height: layer.height })
  }
  for (const layer of mapData.layers || []) {
    for (const object of layer.objects || []) {
      const assetRef = object.properties?.assetRef
      if (assetRef) images.set(assetRef, { width: 1664, height: 928 })
    }
  }
  me.loader.getImage = (name: string) => images.get(name) || null
  return images
}

class V2HallAgent {
  personaCode: string
  pos: { x: number; y: number }
  depth: number
  _sourceData: any
  constructor(data: any) {
    this.personaCode = data.personaCode
    this.pos = { x: data.x || 0, y: data.y || 0 }
    this.depth = 3
    this._sourceData = data
  }
  static supports() { return true }
  syncState(data: any) {
    this._sourceData = data
    this.pos.x = data.x || 0
    this.pos.y = data.y || 0
  }
  setSelected() {}
  getBounds() { return { x: this.pos.x - 8, y: this.pos.y - 8, width: 16, height: 16, contains: () => true } }
  containsPoint() { return true }
}

function makeScene(me: any, mapData: any) {
  const HallScene = createHallSceneClass(me, V2HallAgent)
  const scene = new HallScene()
  scene.setTmxSha256(ACCEPTED_TMX_SHA256)
  scene.setMapData(mapData)
  return scene
}

function gridSnapshotEntries(assembly: any): Array<{ stableId: string; entryKind: string }> {
  return [...assembly.spatialGrid.snapshot().entries()]
    .map(([stableId, entry]: [string, any]) => ({ stableId, entryKind: entry.entryKind }))
    .sort((a, b) => a.stableId.localeCompare(b.stableId))
}

function assertAgentPublishedInV2(scene: any, agentId: string) {
  const adapter = scene._v2AgentAdapter
  const sourceIds = new Set(adapter.sourceEntityIds)
  expect(sourceIds.has(agentId), `agent ${agentId} should be in adapter.sourceEntityIds`).to.equal(true)
  const sceneObject = adapter.lookup(agentId)
  expect(sceneObject, `agent ${agentId} should have an adapter sceneObject`).to.not.equal(undefined)
  const handle = scene._v2RenderableHandles.get(sceneObject.stableId)
  expect(handle, `agent ${agentId} should have a committed renderable handle`).to.not.equal(undefined)
  expect(scene._v2Depths[sceneObject.stableId], `agent ${agentId} should have a logical depth`).to.not.equal(undefined)
  expect(handle.depth).to.be.at.least(HALL_SCENE_DEPTH_BANDS.V2_WORLD_START)
  expect(handle.depth).to.be.below(HALL_SCENE_DEPTH_BANDS.LIGHTING)
}

describe('E15 HallScene atomic V2 switch', () => {
  it('one-shot renderSchemaVersion=2 switch and idempotent repeated activation', async () => {
    const me = createFakeMelon()
    const mapData = productionMapData()
    installProductionImages(me, mapData)
    const previousGate = (window as any).__JYT_V2_ENABLED
    ;(window as any).__JYT_V2_ENABLED = true
    try {
      const scene = makeScene(me, mapData)
      scene.syncAgents([{ agentId: 'a', personaCode: 'a', x: 300, y: 200 }])
      scene.onResetEvent()
      scene.update(16)
      await waitFor(() => scene.activeRendererMode === 'v2')

      expect(scene.activeRendererMode).to.equal('v2')
      expect(scene.renderSchemaVersion).to.equal('2')

      const controller = scene._v2Controller
      const assembly = scene._v2Assembly
      const adapter = scene._v2AgentAdapter
      const fragments = scene._v2StagingRenderables
      const depths = scene._v2Depths
      const handles = scene._v2RenderableHandles

      const ret = scene.activateV2()
      expect(ret).to.equal(true)
      expect(scene._v2Controller).to.equal(controller)
      expect(scene._v2Assembly).to.equal(assembly)
      expect(scene._v2AgentAdapter).to.equal(adapter)
      expect(scene._v2StagingRenderables).to.equal(fragments)
      expect(scene._v2Depths).to.equal(depths)
      expect(scene._v2RenderableHandles).to.equal(handles)
      expect(scene.activeRendererMode).to.equal('v2')

      // Whole-map switch: legacy duplicate layers removed, fragments + props in
      // one V2 world band, no mixed v1/v2 objects.
      expect(scene._imageLayersByName.get('mid-occluders')?.attached).to.equal(false)
      expect(scene._imageLayersByName.get('foreground-occluders')?.attached).to.equal(false)
      expect([...fragments].every((handle: any) => me.game.world.hasChild(handle))).to.equal(true)
      for (const handle of [...handles.values()]) {
        expect(handle.depth).to.be.at.least(HALL_SCENE_DEPTH_BANDS.V2_WORLD_START)
        expect(handle.depth).to.be.below(HALL_SCENE_DEPTH_BANDS.LIGHTING)
      }
      const logicalDepths = Object.values(scene._v2Depths)
      expect([...logicalDepths].sort((a, b) => (a as number) - (b as number))).to.deep.equal(
        Array.from({ length: logicalDepths.length }, (_, index) => index),
      )
    } finally {
      ;(window as any).__JYT_V2_ENABLED = previousGate
    }
  })

  it('first activation publishes every pending/current agent into the adapter, handles, and V2 depths', async () => {
    const me = createFakeMelon()
    const mapData = productionMapData()
    installProductionImages(me, mapData)
    const previousGate = (window as any).__JYT_V2_ENABLED
    ;(window as any).__JYT_V2_ENABLED = true
    try {
      const scene = makeScene(me, mapData)
      scene.syncAgents([
        { agentId: 'songjiang', personaCode: 'songjiang', x: 240, y: 220 },
        { agentId: 'lujunyi', personaCode: 'lujunyi', x: 420, y: 460 },
      ])
      scene.onResetEvent()
      scene.update(16)
      await waitFor(() => scene.activeRendererMode === 'v2')

      expect(scene.activeRendererMode).to.equal('v2')
      expect(scene.renderSchemaVersion).to.equal('2')

      // Both pending agents must already be committed into the first V2 scene.
      assertAgentPublishedInV2(scene, 'songjiang')
      assertAgentPublishedInV2(scene, 'lujunyi')

      // Their actual render depth is pinned into the V2 world band (not V1).
      const songjiangHandle = scene._v2RenderableHandles.get(scene._v2AgentAdapter.lookup('songjiang').stableId)
      const lujunyiHandle = scene._v2RenderableHandles.get(scene._v2AgentAdapter.lookup('lujunyi').stableId)
      for (const handle of [songjiangHandle, lujunyiHandle]) {
        expect(handle.depth).to.be.at.least(HALL_SCENE_DEPTH_BANDS.V2_WORLD_START)
        expect(handle.depth).to.be.below(HALL_SCENE_DEPTH_BANDS.LIGHTING)
      }
    } finally {
      ;(window as any).__JYT_V2_ENABLED = previousGate
    }
  })

  it('repeated activation while a switch is in flight is a no-op', async () => {
    const me = createFakeMelon()
    const mapData = productionMapData()
    installProductionImages(me, mapData)
    const previousGate = (window as any).__JYT_V2_ENABLED
    ;(window as any).__JYT_V2_ENABLED = false
    try {
      const scene = makeScene(me, mapData)
      scene.onResetEvent()
      expect(scene.activeRendererMode).to.equal('v1')

      ;(window as any).__JYT_V2_ENABLED = true
      const first = scene.activateV2()
      const second = scene.activateV2()
      expect(first).to.equal(true)
      expect(second).to.equal(false)
      await waitFor(() => scene.activeRendererMode === 'v2')
      expect(scene.renderSchemaVersion).to.equal('2')
    } finally {
      ;(window as any).__JYT_V2_ENABLED = previousGate
    }
  })

  it('fragment resource failure keeps the complete V1 scene (no partial switch)', async () => {
    const me = createFakeMelon()
    const mapData = productionMapData()
    const images = installProductionImages(me, mapData)
    const fragmentLayer = mapData.layers.find((layer: any) => layer.name === 'v2-fragments-occluders')
    const firstFragment = fragmentLayer.objects[0]
    images.delete(firstFragment.properties.assetRef)
    const previousGate = (window as any).__JYT_V2_ENABLED
    ;(window as any).__JYT_V2_ENABLED = true
    try {
      const scene = makeScene(me, mapData)
      scene.syncAgents([{ agentId: 'a', personaCode: 'a', x: 300, y: 200 }])
      scene.onResetEvent()
      await waitFor(() => scene._v2Assembly === null && scene._v2Controller === null)

      expect(scene.activeRendererMode).to.equal('v1')
      expect(scene.renderSchemaVersion).to.equal('1')
      expect(scene._v2Active).to.equal(false)
      expect(scene._v2StagingRenderables).to.equal(null)
      expect(scene._v2AgentAdapter).to.equal(null)
      expect(scene._v2PropRenderables.size).to.equal(5)
      // Legacy V1 layers remain the only visible stack.
      expect(scene._imageLayersByName.get('mid-occluders')?.attached).to.equal(true)
      expect(scene._imageLayersByName.get('foreground-occluders')?.attached).to.equal(true)
      expect(me.children.some((item: any) => item.child === scene._imageLayersByName.get('lighting-overlay')?.handle)).to.equal(true)
    } finally {
      ;(window as any).__JYT_V2_ENABLED = previousGate
    }
  })

  it('map refresh re-activates one whole-v2 scene without v1/v2 mixing', async () => {
    const me = createFakeMelon()
    const mapData = productionMapData()
    installProductionImages(me, mapData)
    const previousGate = (window as any).__JYT_V2_ENABLED
    ;(window as any).__JYT_V2_ENABLED = true
    try {
      const scene = makeScene(me, mapData)
      scene.syncAgents([{ agentId: 'a', personaCode: 'a', x: 300, y: 200 }])
      scene.onResetEvent()
      scene.update(16)
      await waitFor(() => scene.activeRendererMode === 'v2')

      const oldController = scene._v2Controller
      const oldAssembly = scene._v2Assembly
      const oldAdapter = scene._v2AgentAdapter
      const oldFragments = scene._v2StagingRenderables
      const oldMapData = scene._mapData

      // Refresh with a fresh, valid mapData object.
      const newMapData = productionMapData()
      scene.setMapData(newMapData)

      // E15 P2: refresh must NOT synchronously fall back to V1 or publish the
      // new mapData. The previous complete V2 scene stays live until commit.
      expect(scene.activeRendererMode).to.equal('v2')
      expect(scene.renderSchemaVersion).to.equal('2')
      expect(scene._v2Controller).to.equal(oldController)
      expect(scene._v2Assembly).to.equal(oldAssembly)
      expect(scene._v2AgentAdapter).to.equal(oldAdapter)
      expect(scene._mapData).to.equal(oldMapData)
      expect(scene.hasV2Support()).to.equal(true)
      expect([...oldFragments].every((handle: any) => me.game.world.hasChild(handle))).to.equal(true)

      await waitFor(() => scene.activeRendererMode === 'v2' && scene._v2Controller !== oldController)

      // mapData is published exactly once, with the committed scene.
      expect(scene._mapData).to.equal(newMapData)
      expect(scene.hasV2Support()).to.equal(true)

      expect(scene.renderSchemaVersion).to.equal('2')
      expect(scene._v2StagingRenderables).to.not.equal(oldFragments)
      expect([...scene._v2StagingRenderables].every((handle: any) => me.game.world.hasChild(handle))).to.equal(true)
      expect([...oldFragments].every((handle: any) => !me.game.world.hasChild(handle))).to.equal(true)
      expect(scene._imageLayersByName.get('mid-occluders')?.attached).to.equal(false)
      expect(scene._imageLayersByName.get('foreground-occluders')?.attached).to.equal(false)
      for (const handle of [...scene._v2RenderableHandles.values()]) {
        expect(handle.depth).to.be.at.least(HALL_SCENE_DEPTH_BANDS.V2_WORLD_START)
        expect(handle.depth).to.be.below(HALL_SCENE_DEPTH_BANDS.LIGHTING)
      }
    } finally {
      ;(window as any).__JYT_V2_ENABLED = previousGate
    }
  })

  it('active V2 refresh with invalid provenance keeps old mapData and old active scene', async () => {
    const me = createFakeMelon()
    const mapData = productionMapData()
    installProductionImages(me, mapData)
    const previousGate = (window as any).__JYT_V2_ENABLED
    ;(window as any).__JYT_V2_ENABLED = true
    try {
      const scene = makeScene(me, mapData)
      scene.syncAgents([{ agentId: 'a', personaCode: 'a', x: 300, y: 200 }])
      scene.onResetEvent()
      scene.update(16)
      await waitFor(() => scene.activeRendererMode === 'v2')

      const oldAssembly = scene._v2Assembly
      const oldMapData = scene._mapData
      const invalidMapData = productionMapData()
      invalidMapData.properties = { ...(invalidMapData.properties || {}), sceneId: 'not-juyiting-main' }

      scene.setMapData(invalidMapData)
      await waitFor(() => scene.getV2Diagnostics().some((d: any) => d.code === 'V2_MAP_REFRESH_FAILED'))

      expect(scene._mapData).to.equal(oldMapData)
      expect(scene.hasV2Support()).to.equal(true)
      expect(scene._v2Assembly).to.equal(oldAssembly)
      expect(scene.activeRendererMode).to.equal('v2')
      expect(scene.renderSchemaVersion).to.equal('2')
      expect(scene.getV2Diagnostics().some((d: any) => d.code === 'V2_MAP_REFRESH_FAILED')).to.equal(true)
    } finally {
      ;(window as any).__JYT_V2_ENABLED = previousGate
    }
  })

  it('active V2 refresh with missing asset keeps old mapData and old active scene', async () => {
    const me = createFakeMelon()
    const mapData = productionMapData()
    const images = installProductionImages(me, mapData)
    const previousGate = (window as any).__JYT_V2_ENABLED
    ;(window as any).__JYT_V2_ENABLED = true
    try {
      const scene = makeScene(me, mapData)
      scene.syncAgents([{ agentId: 'a', personaCode: 'a', x: 300, y: 200 }])
      scene.onResetEvent()
      scene.update(16)
      await waitFor(() => scene.activeRendererMode === 'v2')

      const oldAssembly = scene._v2Assembly
      const oldMapData = scene._mapData

      const newMapData = productionMapData()
      const fragmentLayer = newMapData.layers.find((layer: any) => layer.name === 'v2-fragments-occluders')
      const firstFragment = fragmentLayer.objects[0]
      images.delete(firstFragment.properties.assetRef)

      scene.setMapData(newMapData)
      await waitFor(() => scene.getV2Diagnostics().some((d: any) => d.code === 'V2_MAP_REFRESH_FAILED'))

      expect(scene._mapData).to.equal(oldMapData)
      expect(scene.hasV2Support()).to.equal(true)
      expect(scene._v2Assembly).to.equal(oldAssembly)
      expect(scene.activeRendererMode).to.equal('v2')
      expect(scene.renderSchemaVersion).to.equal('2')
      expect(scene.getV2Diagnostics().some((d: any) => d.code === 'V2_MAP_REFRESH_FAILED')).to.equal(true)
    } finally {
      ;(window as any).__JYT_V2_ENABLED = previousGate
    }
  })

  it('commitFrame rollback never throws when world.sort fails', async () => {
    const me = createFakeMelon()
    const mapData = productionMapData()
    installProductionImages(me, mapData)
    const previousGate = (window as any).__JYT_V2_ENABLED
    ;(window as any).__JYT_V2_ENABLED = true
    try {
      const scene = makeScene(me, mapData)
      scene.syncAgents([{ agentId: 'a', personaCode: 'a', x: 300, y: 200 }])
      scene.onResetEvent()
      scene.update(16)
      await waitFor(() => scene.activeRendererMode === 'v2')

      const oldController = scene._v2Controller
      const oldDepths = scene._v2Depths
      const oldMembership = scene._v2Membership
      const oldHitTargets = scene._v2HitTargets

      me.game.world.sort = () => { throw new Error('frame sort failed') }
      await scene._doApplyV2Depths(scene._v2Generation)
      me.game.world.sort = () => {}

      expect(scene.activeRendererMode).to.equal('v2')
      expect(scene._v2Controller).to.equal(oldController)
      expect(scene._v2Depths).to.equal(oldDepths)
      expect(scene._v2Membership).to.equal(oldMembership)
      expect(scene._v2HitTargets).to.equal(oldHitTargets)
      expect(scene._v2PendingFrame).to.equal(null)
      expect(scene._v2Controller.snapshot.diagnostics.filter((d: any) => d.code === 'FRAME_ROLLBACK_FAILED')).to.have.length(0)
    } finally {
      ;(window as any).__JYT_V2_ENABLED = previousGate
      me.game.world.sort = () => {}
    }
  })

  it('roster replacement resource failure preserves the previous complete V2 scene', async () => {
    const me = createFakeMelon()
    const mapData = productionMapData()
    const images = installProductionImages(me, mapData)
    const previousGate = (window as any).__JYT_V2_ENABLED
    ;(window as any).__JYT_V2_ENABLED = true
    try {
      const scene = makeScene(me, mapData)
      scene.syncAgents([{ agentId: 'a', personaCode: 'a', x: 300, y: 200 }])
      scene.onResetEvent()
      scene.update(16)
      await waitFor(() => scene.activeRendererMode === 'v2')

      const oldController = scene._v2Controller
      const oldAdapter = scene._v2AgentAdapter
      const oldAssembly = scene._v2Assembly
      const oldFragments = scene._v2StagingRenderables
      const oldDepths = scene._v2Depths
      const oldMembership = scene._v2Membership
      const oldHitTargets = scene._v2HitTargets

      // Remove a fragment asset BEFORE the roster change is observed, so the
      // replacement hits the staging asset-failure path (never commit/sort).
      const fragmentLayer = mapData.layers.find((layer: any) => layer.name === 'v2-fragments-occluders')
      const firstFragment = fragmentLayer.objects[0]
      images.delete(firstFragment.properties.assetRef)

      scene.syncAgents([
        { agentId: 'a', personaCode: 'a', x: 300, y: 200 },
        { agentId: 'b', personaCode: 'b', x: 300, y: 600 },
      ])
      scene.update(16)
      await scene._v2FrameSerial

      expect(scene._v2Controller).to.equal(oldController)
      expect(scene._v2AgentAdapter).to.equal(oldAdapter)
      expect(scene._v2Assembly).to.equal(oldAssembly)
      expect(scene._v2StagingRenderables).to.equal(oldFragments)
      expect(scene._v2Depths).to.equal(oldDepths)
      expect(scene._v2Membership).to.equal(oldMembership)
      expect(scene._v2HitTargets).to.equal(oldHitTargets)
      expect(scene.activeRendererMode).to.equal('v2')
      expect(scene.renderSchemaVersion).to.equal('2')
      expect([...oldFragments].every((handle: any) => me.game.world.hasChild(handle))).to.equal(true)
      expect(scene.getV2Diagnostics().filter((d: any) => d.code === 'V2_ROSTER_REPLACE_FAILED')).to.have.length(1)
    } finally {
      ;(window as any).__JYT_V2_ENABLED = previousGate
    }
  })

  it('roster commit rollback preserves the old active V2 scene and rebuilds the trusted spatial-grid snapshot', async () => {
    const me = createFakeMelon()
    const mapData = productionMapData()
    installProductionImages(me, mapData)
    const previousGate = (window as any).__JYT_V2_ENABLED
    ;(window as any).__JYT_V2_ENABLED = true
    try {
      const scene = makeScene(me, mapData)
      scene.syncAgents([{ agentId: 'a', personaCode: 'a', x: 300, y: 200 }])
      scene.onResetEvent()
      scene.update(16)
      await waitFor(() => scene.activeRendererMode === 'v2')

      const oldController = scene._v2Controller
      const oldAdapter = scene._v2AgentAdapter
      const oldAssembly = scene._v2Assembly
      const oldFragments = scene._v2StagingRenderables
      const oldDepths = scene._v2Depths
      const oldMembership = scene._v2Membership
      const oldHitTargets = scene._v2HitTargets
      const oldRenderableHandles = scene._v2RenderableHandles

      // Trusted pre-attempt grid probe: exactly these entries must survive the
      // failed replacement and its clear+rebuild rollback.
      const preGridEntries = gridSnapshotEntries(oldAssembly)

      scene.syncAgents([
        { agentId: 'a', personaCode: 'a', x: 300, y: 200 },
        { agentId: 'b', personaCode: 'b', x: 300, y: 600 },
      ])

      // Assets are valid, so the replacement reaches the commit callback; the
      // sort throw forces commit.apply to fail and the E7 rollback path runs.
      me.game.world.sort = () => { throw new Error('sort failed during roster commit') }
      scene.update(16)
      await scene._v2FrameSerial
      me.game.world.sort = () => {}

      expect(scene._v2Controller).to.equal(oldController)
      expect(scene._v2AgentAdapter).to.equal(oldAdapter)
      expect(scene._v2Assembly).to.equal(oldAssembly)
      expect(scene._v2StagingRenderables).to.equal(oldFragments)
      expect(scene._v2Depths).to.equal(oldDepths)
      expect(scene._v2Membership).to.equal(oldMembership)
      expect(scene._v2HitTargets).to.equal(oldHitTargets)
      expect(scene._v2RenderableHandles).to.equal(oldRenderableHandles)
      expect(scene.activeRendererMode).to.equal('v2')
      expect(scene.renderSchemaVersion).to.equal('2')
      expect([...oldFragments].every((handle: any) => me.game.world.hasChild(handle))).to.equal(true)

      // Grid probe: count and stableId/kind pairs must exactly match the
      // trusted pre-attempt snapshot, with no stale agent entries left behind.
      expect(gridSnapshotEntries(oldAssembly)).to.deep.equal(preGridEntries)
      expect(oldAssembly.spatialGrid.getEntryCount()).to.equal(preGridEntries.length)

      // The failure must have reached the commit callback, not an early asset
      // failure, and grid rollback itself must not have failed.
      const diagnostics = scene.getV2Diagnostics()
      const failedDiagnostics = diagnostics.filter((d: any) => d.code === 'V2_ROSTER_REPLACE_FAILED')
      expect(failedDiagnostics).to.have.length(1)
      expect(failedDiagnostics[0].message).to.match(/sort|commit/)
      expect(diagnostics.some((d: any) => d.code === 'V2_ROSTER_GRID_ROLLBACK_FAILED')).to.equal(false)
    } finally {
      ;(window as any).__JYT_V2_ENABLED = previousGate
      me.game.world.sort = () => {}
    }
  })

  it('transient roster failure is retryable and does not permanently latch the same roster', async () => {
    const me = createFakeMelon()
    const mapData = productionMapData()
    installProductionImages(me, mapData)
    const previousGate = (window as any).__JYT_V2_ENABLED
    ;(window as any).__JYT_V2_ENABLED = true
    try {
      const scene = makeScene(me, mapData)
      scene.syncAgents([{ agentId: 'a', personaCode: 'a', x: 300, y: 200 }])
      scene.onResetEvent()
      scene.update(16)
      await waitFor(() => scene.activeRendererMode === 'v2')

      const oldController = scene._v2Controller
      const roster = [
        { agentId: 'a', personaCode: 'a', x: 300, y: 200 },
        { agentId: 'b', personaCode: 'b', x: 300, y: 600 },
      ]
      scene.syncAgents(roster)

      // First attempt fails at commit (valid assets, throwing sort).
      me.game.world.sort = () => { throw new Error('transient roster sort failure') }
      scene.update(16)
      await scene._v2FrameSerial
      me.game.world.sort = () => {}
      expect(scene._v2Controller).to.equal(oldController)
      expect(scene._v2LastRosterFailure).to.not.equal(null)

      // Wait out the controlled cooldown and retry the SAME roster.
      await new Promise(resolve => setTimeout(resolve, 300))
      scene.update(16)
      await scene._v2FrameSerial

      expect(scene.activeRendererMode).to.equal('v2')
      expect(scene.renderSchemaVersion).to.equal('2')
      expect(scene._v2Controller).to.not.equal(oldController)
      const newSourceIds = new Set(scene._v2AgentAdapter.sourceEntityIds)
      expect(newSourceIds.has('a')).to.equal(true)
      expect(newSourceIds.has('b')).to.equal(true)
      expect(scene._v2LastRosterFailure).to.equal(null)
    } finally {
      ;(window as any).__JYT_V2_ENABLED = previousGate
      me.game.world.sort = () => {}
    }
  })
})
