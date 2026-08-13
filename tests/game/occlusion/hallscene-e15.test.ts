/* eslint-disable @typescript-eslint/no-explicit-any -- the melonJS fake and mapData fixtures are intentionally dynamic test doubles */
// ── E15 HallScene Atomic V2 Switch Fault-Injection Tests ──
// Exercises the real HallScene active-path switch through a minimal melonJS
// fake: repeated activation, in-flight activation, resource failure, frame
// rollback, and roster-replacement failure. No fake fixtures — real hall.tmx
// and the accepted TMX SHA are used.

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

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).navigator = dom.window.navigator;
(globalThis as any).DOMParser = dom.window.DOMParser;

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
      const oldFragments = scene._v2StagingRenderables

      // Refresh with a fresh, valid mapData object.
      scene.setMapData(productionMapData())
      await waitFor(() => scene.activeRendererMode === 'v2' && scene._v2Controller !== oldController)

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

      // Add a second agent and remove a fragment asset, then force a frame
      // pass so roster replacement hits the resource-failure path.
      scene.syncAgents([
        { agentId: 'a', personaCode: 'a', x: 300, y: 200 },
        { agentId: 'b', personaCode: 'b', x: 300, y: 600 },
      ])
      const fragmentLayer = mapData.layers.find((layer: any) => layer.name === 'v2-fragments-occluders')
      const firstFragment = fragmentLayer.objects[0]
      images.delete(firstFragment.properties.assetRef)
      me.game.world.sort = () => { throw new Error('sort failed during roster replacement') }
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
      expect(scene.activeRendererMode).to.equal('v2')
      expect(scene.renderSchemaVersion).to.equal('2')
      expect([...oldFragments].every((handle: any) => me.game.world.hasChild(handle))).to.equal(true)
    } finally {
      ;(window as any).__JYT_V2_ENABLED = previousGate
      me.game.world.sort = () => {}
    }
  })
})
