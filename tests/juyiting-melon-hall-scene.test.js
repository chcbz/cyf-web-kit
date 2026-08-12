import { expect } from 'chai'
import { readFileSync } from 'fs'

import { createHallSceneClass } from '../src/game/scenes/HallScene.js'
import { parseJuyiHallTmx } from '../src/game/tiledMap.js'
import { ACCEPTED_TMX_SHA256 } from '../src/game/occlusion/hallSceneAssembly.js'
import { HALL_SCENE_DEPTH_BANDS, hallV2WorldDepth } from '../src/game/occlusion/hallSceneDepthBands.js'

const createFakeMelon = () => {
  const registered = []
  const removed = []
  const children = []
  const matrixOps = []
  let canvasRect = null
  let layerRect = null
  const listeners = new Map()

  const canvas = {
    style: {},
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(callback)
      registered.push({ type, region: canvas, callback })
    },
    removeEventListener(type, callback) {
      listeners.get(type)?.delete(callback)
      removed.push({ type, region: canvas, callback })
    },
    dispatch(type, event = {}) {
      for (const callback of [...(listeners.get(type) || [])]) callback(event)
    },
    setPointerCapture() {},
    releasePointerCapture() {},
    get parentElement() {
      return layerRect ? { getBoundingClientRect: () => layerRect } : null
    },
    getBoundingClientRect: () => canvasRect
  }

  const currentTransform = {
    identity: () => {
      matrixOps.push(['identity'])
      return currentTransform
    },
    translate: (x, y) => {
      matrixOps.push(['translate', x, y])
      return currentTransform
    },
    scale: (x, y) => {
      matrixOps.push(['scale', x, y])
      return currentTransform
    }
  }

  class Stage { update() {} }

  class Renderable {
    constructor(x, y, w, h) {
      this.pos = { x, y }
      this.width = w
      this.height = h
      this.anchorPoint = { set: () => {} }
    }

    getBounds() {
      return {
        x: this.pos.x - this.width / 2,
        y: this.pos.y - this.height / 2,
        width: this.width,
        height: this.height,
        contains: (x, y) => (
          x >= this.pos.x - this.width / 2 &&
          x <= this.pos.x + this.width / 2 &&
          y >= this.pos.y - this.height / 2 &&
          y <= this.pos.y + this.height / 2
        )
      }
    }
  }

  class Rect {
    constructor(x, y, w, h) {
      this.x = x
      this.y = y
      this.width = w
      this.height = h
    }
  }

  class Sprite {
    constructor(x, y) {
      this.pos = { x, y }
      this.width = 960
      this.height = 640
      this.anchorPoint = { set: () => {} }
      this.floating = false
    }

    scale() {}
  }

  class Vector2d {
    constructor(x, y) {
      this.x = x
      this.y = y
    }
  }

  const viewport = {
    width: 960,
    height: 640,
    getBounds: () => ({
      x: 0,
      y: 0,
      width: 960,
      height: 640,
      contains: (x, y) => x >= 0 && x <= 960 && y >= 0 && y <= 640
    })
  }

  return {
    Rect,
    Renderable,
    Sprite,
    Stage,
    Vector2d,
    game: {
      viewport,
      world: {
        currentTransform,
        addChild: (child, depth) => {
          if (!children.some(item => item.child === child)) children.push({ child, depth })
          if (depth !== undefined) child.depth = depth
          return child
        },
        removeChild: child => {
          const index = children.findIndex(item => item.child === child)
          if (index >= 0) children.splice(index, 1)
        },
        sort: () => {},
        hasChild: child => children.some(item => item.child === child)
      }
    },
    input: {},
    loader: {
      getImage: () => null
    },
    video: {
      getCanvas: () => canvas
    },
    setCanvasRect: rect => { canvasRect = rect },
    setLayerRect: rect => { layerRect = rect },
    registered,
    removed,
    canvas,
    listenerCount: type => listeners.get(type)?.size || 0,
    children,
    matrixOps
  }
}

const modularMapData = () => ({
  imageLayers: {
    'mid-occluders': { width: 1672, height: 941 },
    'foreground-occluders': { width: 1672, height: 941 },
    'lighting-overlay': { width: 1672, height: 941, opacity: 0.85, tintcolor: '#ffd8a0' }
  },
  tileLayers: [],
  tilesets: [],
  hotspots: []
})

const hotspotMapData = () => ({
  imageLayers: {},
  tileLayers: [],
  tilesets: [],
  hotspots: [
    { id: 'mainSeat', panel: 'chat', shape: 'rect', x: 50, y: 40, w: 12, h: 8 },
    { id: 'bountyBoard', panel: 'tasks', shape: 'rect', x: 76, y: 47, w: 16, h: 14 }
  ]
})


const waitFor = async (predicate, timeoutMs = 2000) => {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for HallScene state')
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

const productionV2MapData = ({ withBase = false } = {}) => {
  const mapData = parseJuyiHallTmx(
    readFileSync('public/juyiting/hall.tmx', 'utf8'),
    { movementEnabled: false }
  )
  if (!withBase) mapData.tileLayers = []
  return mapData
}

const installProductionImages = (me, mapData) => {
  const images = new Map()
  for (const tileset of mapData.tilesets || []) {
    if (tileset.tiles?.length) {
      for (const tile of tileset.tiles) {
        if (tile?.resourceName) images.set(tile.resourceName, { width: tile.width, height: tile.height })
      }
    } else if (tileset.tilesetResourceName) {
      images.set(tileset.tilesetResourceName, { width: tileset.imagewidth, height: tileset.imageheight })
    }
  }
  for (const layer of Object.values(mapData.imageLayers || {})) {
    images.set(layer.resourceName, { width: layer.width, height: layer.height })
  }
  for (const layer of mapData.layers || []) {
    for (const object of layer.objects || []) {
      const assetRef = object.properties?.assetRef
      if (assetRef) images.set(assetRef, { width: 1664, height: 928 })
    }
  }
  me.loader.getImage = name => images.get(name) || null
}

class V2HallAgent {
  constructor(data) {
    this.personaCode = data.personaCode
    this.pos = { x: data.x || 0, y: data.y || 0 }
    this.depth = 3
    this._sourceData = data
  }
  static supports() { return true }
  syncState(data) {
    this._sourceData = data
    this.pos.x = data.x || 0
    this.pos.y = data.y || 0
  }
  setSelected() {}
  getBounds() {
    return { x: this.pos.x - 8, y: this.pos.y - 8, width: 16, height: 16, contains: () => true }
  }
  containsPoint() { return true }
}

const runPendingFrames = (frames, now) => {
  const pending = [...frames.entries()]
  expect(pending).not.to.be.empty
  pending.forEach(([id, callback]) => {
    frames.delete(id)
    callback(now)
  })
}

describe('HallScene melonJS pointer routing', () => {
  it('starts from the approved camera preset and exposes controller snapshots', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()

    scene.onResetEvent()

    expect(scene.getCameraSnapshot()).to.include({ presetKey: 'desktop', presetId: 'main-hall-desktop' })
    expect(scene.getTransform()).to.deep.equal(scene.getCameraSnapshot().transform)
    expect(scene.inputSnapshot()).to.deep.equal({ activeGesture: 'none', interactionLocked: false })
    expect(scene).not.to.have.property('_dragState')
    expect(scene).not.to.have.property('_touchPointers')
    expect(scene).not.to.have.property('_pinchState')
    expect(scene).not.to.have.property('_pendingClick')
  })

  it('locks panel interaction without stopping scene updates', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()
    scene.onResetEvent()

    scene.setInteractionLocked(true)
    scene.setInteractionLocked(true)
    expect(scene.inputSnapshot().interactionLocked).to.equal(true)
    const beforeWheel = scene.getTransform()
    me.canvas.dispatch('wheel', { deltaY: -120, clientX: 480, clientY: 320, preventDefault: () => {} })
    expect(scene.getTransform()).to.deep.equal(beforeWheel)
    expect(scene.update(16)).to.equal(true)
    scene.setInteractionLocked(false)
    expect(scene.inputSnapshot().interactionLocked).to.equal(false)
  })

  it('persists a lock set before scene construction and replays it once when input is built', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()

    scene.setInteractionLocked(true, 'panel')
    scene.setInteractionLocked(true, 'panel')
    expect(me.listenerCount('pointerdown')).to.equal(0)

    scene.onResetEvent()
    expect(scene.inputSnapshot().interactionLocked).to.equal(true)
    expect(me.listenerCount('pointerdown')).to.equal(1)

    scene.setInteractionLocked(false, 'panel')
    expect(scene.inputSnapshot().interactionLocked).to.equal(false)
  })

  it('preserves camera focus and zoom across an orientation resize without replaying the default', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()
    scene.onResetEvent()
    scene.zoomBy(0.4)
    scene.panBy(70, -30)
    const before = scene.getCameraSnapshot()

    me.game.viewport.width = 640
    me.game.viewport.height = 960
    scene.resizeViewport({ width: 640, height: 960, kind: 'orientation', orientationChanged: true })
    const after = scene.getCameraSnapshot()

    expect(after.presetKey).to.equal('desktop')
    expect(after.transform.zoom).to.equal(before.transform.zoom)
    expect(after.transform).not.to.deep.equal({ zoom: 0.84, offsetX: 0, offsetY: 0 })
  })

  it('uses the supplied fractional viewport as the single source for camera, matrix, display and hit conversion', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()
    const clicks = []
    scene.onHotspotClick(item => clicks.push(item))
    scene.setMapData(hotspotMapData())
    scene.onResetEvent()
    const before = scene.getCameraSnapshot().transform
    const oldCenterWorld = {
      x: (480 - 480 - before.offsetX) / before.zoom + 480,
      y: (320 - 320 - before.offsetY) / before.zoom + 320
    }
    const viewport = { width: 700.5, height: 500.25 }
    const rect = { left: 10.25, top: 20.5, width: 1000.75, height: 401.5 }
    me.setLayerRect(rect)

    scene.resizeViewport({ ...viewport, kind: 'layout' })
    const after = scene.getCameraSnapshot().transform
    const newCenterWorld = {
      x: (viewport.width / 2 - viewport.width / 2 - after.offsetX) / after.zoom + viewport.width / 2,
      y: (viewport.height / 2 - viewport.height / 2 - after.offsetY) / after.zoom + viewport.height / 2
    }
    expect(newCenterWorld.x).to.be.closeTo(oldCenterWorld.x, 0.01)
    expect(newCenterWorld.y).to.be.closeTo(oldCenterWorld.y, 0.01)
    expect(me.game.viewport.width).to.equal(960)

    const world = { x: 730, y: 300 }
    const screen = {
      x: (world.x - viewport.width / 2) * after.zoom + viewport.width / 2 + after.offsetX,
      y: (world.y - viewport.height / 2) * after.zoom + viewport.height / 2 + after.offsetY
    }
    const scale = Math.max(rect.width / viewport.width, rect.height / viewport.height)
    const client = {
      x: rect.left + (rect.width - viewport.width * scale) / 2 + screen.x * scale,
      y: rect.top + (rect.height - viewport.height * scale) / 2 + screen.y * scale
    }
    me.canvas.dispatch('pointerdown', { pointerId: 31, pointerType: 'mouse', clientX: client.x, clientY: client.y })
    me.canvas.dispatch('pointerup', { pointerId: 31, pointerType: 'mouse', clientX: client.x, clientY: client.y })

    expect(clicks).to.deep.equal([{ id: 'bountyBoard', panel: 'tasks' }])
    const lastTranslate = me.matrixOps.filter(op => op[0] === 'translate').slice(-2)[0]
    expect(lastTranslate[1]).to.be.closeTo(viewport.width / 2 + after.offsetX, 0.001)
    expect(lastTranslate[2]).to.be.closeTo(viewport.height / 2 + after.offsetY, 0.001)
  })

  it('isolates keyboard visual-height changes from the authoritative camera viewport', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()
    const clicks = []
    scene.onHotspotClick(item => clicks.push(item))
    scene.setMapData(hotspotMapData())
    me.setLayerRect({ left: 0, top: 0, width: 960, height: 640 })
    scene.onResetEvent()
    const before = scene.getCameraSnapshot()
    const matrixCount = me.matrixOps.length
    const world = { x: 730, y: 300 }
    const screen = {
      x: (world.x - 480) * before.transform.zoom + 480 + before.transform.offsetX,
      y: (world.y - 320) * before.transform.zoom + 320 + before.transform.offsetY
    }

    scene.resizeViewport({ width: 960, height: 360, kind: 'keyboard' })
    expect(scene.getCameraSnapshot()).to.deep.equal(before)
    expect(me.matrixOps).to.have.length(matrixCount)
    me.canvas.dispatch('pointerdown', { pointerId: 32, pointerType: 'mouse', clientX: screen.x, clientY: screen.y })
    me.canvas.dispatch('pointerup', { pointerId: 32, pointerType: 'mouse', clientX: screen.x, clientY: screen.y })
    expect(clicks).to.deep.equal([{ id: 'bountyBoard', panel: 'tasks' }])
    scene.resizeViewport({ width: 960, height: 640, kind: 'keyboard' })
    expect(scene.getCameraSnapshot()).to.deep.equal(before)
    expect(me.matrixOps).to.have.length(matrixCount)

    scene.resizeViewport({ width: 800, height: 500, kind: 'layout' })
    const afterLayout = scene.getCameraSnapshot().transform
    const layoutTranslate = me.matrixOps.filter(op => op[0] === 'translate').slice(-2)[0]
    expect(layoutTranslate[1]).to.be.closeTo(400 + afterLayout.offsetX, 0.001)
    expect(layoutTranslate[2]).to.be.closeTo(250 + afterLayout.offsetY, 0.001)
  })

  it('keeps custom image layers inside the transformed world scene', () => {
    const me = createFakeMelon()
    me.loader.getImage = name => name === 'mid-occluders' ? { width: 960, height: 640 } : null
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()
    scene.setMapData({
      imageLayers: { 'mid-occluders': { width: 960, height: 640 } },
      tileLayers: [],
      tilesets: [],
      hotspots: []
    })

    scene.onResetEvent()

    const background = me.children.find(item => item.depth === 2)?.child
    expect(background).to.exist
    expect(background.floating).not.to.equal(true)
  })

  it('renders declared hall image layers without a prop-gate layer', () => {
    const me = createFakeMelon()
    const expectedResourceNames = ['mid-occluders', 'foreground-occluders', 'lighting-overlay']
    me.loader.getImage = name => expectedResourceNames.includes(name)
      ? { width: 1672, height: 941, resourceName: name }
      : null
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()
    scene.setMapData(modularMapData())

    scene.onResetEvent()

    const renderedLayers = me.children
      .filter(item => item.child.image?.resourceName)
      .map(item => ({ name: item.child.image.resourceName, depth: item.depth }))

    expect(renderedLayers).to.deep.equal([
      { name: 'mid-occluders', depth: 2 },
      { name: 'foreground-occluders', depth: 5 },
      { name: 'lighting-overlay', depth: 8 }
    ])
  })

  it('renders tile-layer cells with the tileset that owns each gid', () => {
    const me = createFakeMelon()
    const drawCalls = []
    const originalDocument = globalThis.document
    globalThis.document = { createElement: (tagName, ...args) => {
      if (tagName === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage: (image, sx, sy, sw, sh, dx, dy, dw, dh) => {
              drawCalls.push({ image, sx, sy, sw, sh, dx, dy, dw, dh })
            }
          })
        }
      }
      return originalDocument?.createElement?.(tagName, ...args)
    } }

    try {
      me.loader.getImage = name => ({ width: 32, height: 16, resourceName: name })
      const HallScene = createHallSceneClass(me, class {})
      const scene = new HallScene()
      scene.setMapData({
        tileLayers: [
          { name: 'mixed', width: 2, height: 1, data: [1, 101] }
        ],
        tilesets: [
          { name: 'first-tileset', firstgid: 1, tilewidth: 16, tileheight: 16, columns: 2, imagewidth: 32 },
          { name: 'second-tileset', firstgid: 100, tilewidth: 16, tileheight: 16, columns: 2, imagewidth: 32 }
        ],
        imageLayers: {},
        hotspots: []
      })

      scene.onResetEvent()
    } finally {
      globalThis.document = originalDocument
    }

    expect(drawCalls.map(call => call.image.resourceName)).to.deep.equal(['first-tileset', 'second-tileset'])
    expect(drawCalls.map(call => call.sx)).to.deep.equal([0, 16])
  })

  it('keeps transform state inside the melonJS scene', () => {
    const me = createFakeMelon()
    const frames = new Map()
    let nextFrameId = 0
    const originalRequest = globalThis.requestAnimationFrame
    const originalCancel = globalThis.cancelAnimationFrame
    globalThis.requestAnimationFrame = callback => { const id = ++nextFrameId; frames.set(id, callback); return id }
    globalThis.cancelAnimationFrame = id => frames.delete(id)
    try {
      const HallScene = createHallSceneClass(me, class {})
      const scene = new HallScene()
      scene.onResetEvent()
      const initial = scene.getCameraSnapshot()
      scene.zoomBy(0.5)
      scene.panBy(120, -80)

      const cancelledFrame = globalThis.requestAnimationFrame(() => {})
      globalThis.cancelAnimationFrame(cancelledFrame)
      globalThis.requestAnimationFrame(() => {})
      scene.resetTransform()
      const animation = scene.getCameraSnapshot().animation
      runPendingFrames(frames, animation.startedAt + animation.durationMs + 1)

      expect(scene.getCameraSnapshot().animation).to.equal(null)
      expect(scene.getCameraSnapshot().presetKey).to.equal(initial.presetKey)
      expect(scene.getTransform()).to.deep.equal(initial.transform)
      expect(me.matrixOps.filter(op => op[0] === 'scale').at(-1)).to.deep.equal(['scale', initial.transform.zoom, initial.transform.zoom])
    } finally {
      globalThis.requestAnimationFrame = originalRequest
      globalThis.cancelAnimationFrame = originalCancel
    }
  })

  it('fits the scene using the melonJS viewport instead of DOM container pixels', () => {
    const me = createFakeMelon()
    const frames = new Map()
    let nextFrameId = 0
    const originalRequest = globalThis.requestAnimationFrame
    const originalCancel = globalThis.cancelAnimationFrame
    globalThis.requestAnimationFrame = callback => { const id = ++nextFrameId; frames.set(id, callback); return id }
    globalThis.cancelAnimationFrame = id => frames.delete(id)
    try {
      const HallScene = createHallSceneClass(me, class {})
      const scene = new HallScene()
      scene.onResetEvent()
      const initial = scene.getCameraSnapshot()
      scene.zoomBy(0.4)

      scene.fitToViewport()
      const animation = scene.getCameraSnapshot().animation
      runPendingFrames(frames, animation.startedAt + animation.durationMs + 1)

      expect(scene.getCameraSnapshot().animation).to.equal(null)
      expect(scene.getTransform()).to.deep.equal(initial.transform)
    } finally {
      globalThis.requestAnimationFrame = originalRequest
      globalThis.cancelAnimationFrame = originalCancel
    }
  })

  it('keeps using the authoritative viewport when the melon viewport reference disappears', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()

    me.game.viewport = null
    expect(scene.zoomBy(0.5).zoom).to.equal(1.34)
    const beforePan = scene.getTransform()
    const afterPan = scene.panBy(120, -80)
    expect(afterPan.offsetX - beforePan.offsetX).to.equal(120)
    expect(afterPan.offsetY - beforePan.offsetY).to.be.closeTo(-80, 0.001)
  })

  it('registers hotspot renderables and the viewport click router', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()
    const hotspotClicks = []

    scene.onHotspotClick(hotspot => hotspotClicks.push(hotspot))
    scene.setMapData(hotspotMapData())
    scene.onResetEvent()

    const hotspotRenderable = me.children.find(item => item.child.data?.id === 'mainSeat')?.child
    expect(hotspotRenderable).to.exist
    expect(hotspotRenderable).to.be.instanceOf(me.Renderable)

    const downRegistration = me.registered.find(item => item.type === 'pointerdown' && item.region === me.canvas)
    const upRegistration = me.registered.find(item => item.type === 'pointerup' && item.region === me.canvas)
    expect(downRegistration).to.exist
    expect(upRegistration).to.exist
    me.canvas.dispatch('pointerdown', { pointerId: 1, pointerType: 'mouse', clientX: 10, clientY: 10 })
    me.canvas.dispatch('pointerup', { pointerId: 1, pointerType: 'mouse', clientX: 10, clientY: 10 })
    expect(hotspotClicks).to.deep.equal([])

    scene._agents.set('missing-coordinate-guard', {
      containsPoint: () => {
        throw new Error('agent hit test should not run without finite coordinates')
      }
    })
    me.canvas.dispatch('pointerdown', { pointerId: 2, pointerType: 'mouse' })
    me.canvas.dispatch('pointerup', { pointerId: 2, pointerType: 'mouse' })
  })

  it('stores polygon hotspot draw points relative to the renderable bounds', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()

    scene.setMapData({
      coordinateWidth: 1664,
      coordinateHeight: 928,
      imageLayers: {},
      tileLayers: [],
      tilesets: [],
      hotspots: [
        {
          id: 'roster-book',
          panel: 'catalog',
          shape: 'polygon',
          x: 18.389,
          y: 30.981,
          w: 10.697,
          h: 20.582,
          polygon: [
            { x: 329, y: 362 },
            { x: 351, y: 287 },
            { x: 395, y: 383 },
            { x: 217, y: 383 }
          ]
        }
      ]
    })
    scene.onResetEvent()

    const marker = me.children.find(item => item.child.data?.id === 'roster-book')?.child

    expect(marker).to.exist
    expect(marker.polygon[0].x).to.be.closeTo(64.62, 0.01)
    expect(marker.polygon[0].y).to.be.closeTo(117.24, 0.01)
    expect(marker.polygon[1].x).to.be.closeTo(77.31, 0.01)
    expect(marker.polygon[1].y).to.be.closeTo(65.51, 0.01)
  })

  it('does not register prop tiles as interactive hotspots', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()

    scene.setMapData({
      coordinateWidth: 1664,
      coordinateHeight: 928,
      imageLayers: {},
      tileLayers: [],
      tilesets: [],
      hotspots: [
        { id: 'roster-book', panel: 'catalog', shape: 'rect', x: 20, y: 30, w: 10, h: 12 },
        { id: 'roster-book-rect', type: 'prop', panel: 'catalog', shape: 'rect', x: 20, y: 30, w: 10, h: 12 }
      ]
    })
    scene.onResetEvent()

    expect(scene._hotspots.map(({ data }) => data.id)).to.deep.equal(['roster-book'])
    expect(me.children.find(item => item.child.data?.id === 'roster-book-rect')).to.equal(undefined)
  })

  it('draws active hotspot feedback at the marker world position', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()

    scene.setMapData({
      coordinateWidth: 1664,
      coordinateHeight: 928,
      imageLayers: {},
      tileLayers: [],
      tilesets: [],
      hotspots: [
        {
          id: 'roster-book',
          panel: 'catalog',
          shape: 'polygon',
          x: 18.389,
          y: 30.981,
          w: 10.697,
          h: 20.582,
          polygon: [
            { x: 329, y: 362 },
            { x: 351, y: 287 },
            { x: 395, y: 383 },
            { x: 217, y: 383 }
          ]
        }
      ]
    })
    scene.onResetEvent()

    const marker = scene._hotspots[0].marker
    const operations = []
    marker.setFeedback({ state: 'active', feedbackText: '打开名册' })
    marker.draw({
      getContext: () => ({
        save: () => operations.push(['save']),
        restore: () => operations.push(['restore']),
        beginPath: () => operations.push(['beginPath']),
        moveTo: (x, y) => operations.push(['moveTo', x, y]),
        lineTo: (x, y) => operations.push(['lineTo', x, y]),
        closePath: () => operations.push(['closePath']),
        fill: () => operations.push(['fill']),
        stroke: () => operations.push(['stroke']),
        fillText: (text, x, y) => operations.push(['fillText', text, x, y]),
        set fillStyle(value) { operations.push(['fillStyle', value]) },
        set strokeStyle(value) { operations.push(['strokeStyle', value]) },
        set lineWidth(value) { operations.push(['lineWidth', value]) },
        set font(value) { operations.push(['font', value]) },
        set textAlign(value) { operations.push(['textAlign', value]) },
        set textBaseline(value) { operations.push(['textBaseline', value]) }
      })
    })

    const firstPoint = operations.find(([operation]) => operation === 'moveTo')
    const feedbackText = operations.find(([operation]) => operation === 'fillText')
    expect(firstPoint[1]).to.be.closeTo(marker.pos.x + marker.polygon[0].x, 0.01)
    expect(firstPoint[2]).to.be.closeTo(marker.pos.y + marker.polygon[0].y, 0.01)
    expect(feedbackText).to.deep.equal(['fillText', '打开名册', marker.pos.x + marker.width / 2, marker.pos.y - 8])
  })

  it('routes hotspot clicks on release after DOM rooms are removed', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()
    const clicked = []

    scene.onHotspotClick(item => clicked.push(item))
    scene.setMapData(hotspotMapData())
    scene.onResetEvent()

    const downRegistration = me.registered.find(item => item.type === 'pointerdown' && item.region === me.canvas)
    const upRegistration = me.registered.find(item => item.type === 'pointerup' && item.region === me.canvas)

    const point = scene._worldToScreen({ x: 730, y: 300 })
    me.canvas.dispatch('pointerdown', { pointerId: 7, pointerType: 'mouse', clientX: point.x, clientY: point.y })
    expect(clicked).to.deep.equal([])
    me.canvas.dispatch('pointerup', { pointerId: 7, pointerType: 'mouse', clientX: point.x, clientY: point.y })

    expect(clicked[0]).to.deep.equal({ id: 'bountyBoard', panel: 'tasks' })
  })

  it('does not activate a hotspot when the press turns into a drag', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()
    const clicked = []

    scene.onHotspotClick(item => clicked.push(item))
    scene.setMapData(hotspotMapData())
    scene.onResetEvent()

    const downRegistration = me.registered.find(item => item.type === 'pointerdown' && item.region === me.canvas)
    const moveRegistration = me.registered.find(item => item.type === 'pointermove' && item.region === me.canvas)
    const upRegistration = me.registered.find(item => item.type === 'pointerup' && item.region === me.canvas)

    me.canvas.dispatch('pointerdown', { pointerId: 7, pointerType: 'mouse', clientX: 730, clientY: 300 })
    me.canvas.dispatch('pointermove', { pointerId: 7, pointerType: 'mouse', clientX: 746, clientY: 318, preventDefault: () => {} })
    me.canvas.dispatch('pointerup', { pointerId: 7, pointerType: 'mouse', clientX: 746, clientY: 318 })

    expect(clicked).to.deep.equal([])
  })

  it('does not activate a hotspot when the press turns into a pinch', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()
    const clicked = []

    scene.onHotspotClick(item => clicked.push(item))
    scene.setMapData(hotspotMapData())
    scene.onResetEvent()

    const downRegistration = me.registered.find(item => item.type === 'pointerdown' && item.region === me.canvas)
    const moveRegistration = me.registered.find(item => item.type === 'pointermove' && item.region === me.canvas)
    const upRegistration = me.registered.find(item => item.type === 'pointerup' && item.region === me.canvas)

    me.canvas.dispatch('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 730, clientY: 300 })
    me.canvas.dispatch('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 780, clientY: 300, preventDefault: () => {} })
    me.canvas.dispatch('pointermove', { pointerId: 2, pointerType: 'touch', clientX: 820, clientY: 300, preventDefault: () => {} })
    me.canvas.dispatch('pointerup', { pointerId: 1, pointerType: 'touch', clientX: 730, clientY: 300 })
    me.canvas.dispatch('pointerup', { pointerId: 2, pointerType: 'touch', clientX: 820, clientY: 300 })

    expect(clicked).to.deep.equal([])
  })

  it('hit-tests the scaled polygon with exact mouse and touch edge geometry', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()
    const clicks = []
    scene.onHotspotClick(item => clicks.push(item))
    scene.setMapData({
      coordinateWidth: 1664,
      coordinateHeight: 928,
      imageLayers: {}, tileLayers: [], tilesets: [],
      hotspots: [{
        id: 'triangle', panel: 'catalog', shape: 'polygon', x: 50, y: 50, w: 50, h: 50,
        polygon: [{ x: 416, y: 232 }, { x: 1248, y: 232 }, { x: 832, y: 696 }]
      }]
    })
    scene.onResetEvent()
    const clickAt = (pointerId, pointerType, world) => {
      const point = scene._worldToScreen(world)
      me.canvas.dispatch('pointerdown', { pointerId, pointerType, clientX: point.x, clientY: point.y })
      me.canvas.dispatch('pointerup', { pointerId, pointerType, clientX: point.x, clientY: point.y })
    }

    clickAt(40, 'mouse', { x: 480, y: 200 })
    expect(clicks).to.have.length(1)
    clickAt(41, 'mouse', { x: 250, y: 470 })
    expect(clicks).to.have.length(1)
    clickAt(45, 'pen', { x: 250, y: 470 })
    expect(clicks).to.have.length(1)
    clickAt(42, 'touch', { x: 250, y: 470 })
    expect(clicks).to.have.length(1)
    clickAt(43, 'touch', { x: 458, y: 470 })

    expect(clicks).to.deep.equal([
      { id: 'triangle', panel: 'catalog' },
      { id: 'triangle', panel: 'catalog' }
    ])
  })

  it('prioritizes an agent over an overlapping hotspot', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()
    const clicks = []
    scene.onHotspotClick(item => clicks.push(['hotspot', item.id]))
    scene.setMapData(hotspotMapData())
    scene.onResetEvent()
    scene._agents.set('agent-1', {
      containsPoint: () => true,
      getBounds: () => ({ x: 700, y: 270, width: 60, height: 60, contains: () => true }),
      onPointerDown: () => clicks.push(['agent', 'agent-1'])
    })
    const point = scene._worldToScreen({ x: 730, y: 300 })

    me.canvas.dispatch('pointerdown', { pointerId: 9, pointerType: 'mouse', clientX: point.x, clientY: point.y })
    me.canvas.dispatch('pointerup', { pointerId: 9, pointerType: 'mouse', clientX: point.x, clientY: point.y })

    expect(clicks).to.deep.equal([['agent', 'agent-1']])
  })

  it('marks only the selected agent as selected', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()
    const selected = []
    scene._agents.set('agent-1', { setSelected: value => selected.push(['agent-1', value]) })
    scene._agents.set('agent-2', { setSelected: value => selected.push(['agent-2', value]) })

    scene.setSelectedAgent('agent-2')

    expect(selected).to.deep.equal([
      ['agent-1', false],
      ['agent-2', true]
    ])
  })

  it('orders overlapping agents by visual depth instead of insertion order', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()
    const clicks = []
    scene.onResetEvent()
    const bounds = { x: 400, y: 250, width: 100, height: 100, contains: () => true }
    scene._agents.set('front', { depth: 10, pos: { y: 300 }, containsPoint: () => true, getBounds: () => bounds, onPointerDown: () => clicks.push('front') })
    scene._agents.set('back', { depth: 1, pos: { y: 350 }, containsPoint: () => true, getBounds: () => bounds, onPointerDown: () => clicks.push('back') })
    const point = scene._worldToScreen({ x: 430, y: 300 })

    me.canvas.dispatch('pointerdown', { pointerId: 44, pointerType: 'mouse', clientX: point.x, clientY: point.y })
    me.canvas.dispatch('pointerup', { pointerId: 44, pointerType: 'mouse', clientX: point.x, clientY: point.y })

    expect(clicks).to.deep.equal(['front'])
  })

  it('keeps one listener set across repeated builds and removes it exactly once on destroy', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()

    scene.onResetEvent()
    scene.onResetEvent()
    expect(me.listenerCount('pointerdown')).to.equal(1)
    expect(me.listenerCount('wheel')).to.equal(1)

    scene.onDestroyEvent()
    scene.onDestroyEvent()
    expect(me.listenerCount('pointerdown')).to.equal(0)
    expect(me.listenerCount('wheel')).to.equal(0)
    expect(me.removed.filter(item => item.type === 'pointerdown')).to.have.length(1)
  })

  it('cancels camera frames and ignores late callbacks after destroy', () => {
    const me = createFakeMelon()
    const frames = new Map()
    const cancelled = []
    const originalRequest = globalThis.requestAnimationFrame
    const originalCancel = globalThis.cancelAnimationFrame
    globalThis.requestAnimationFrame = callback => {
      const id = frames.size + 1
      frames.set(id, callback)
      return id
    }
    globalThis.cancelAnimationFrame = id => cancelled.push(id)
    try {
      const HallScene = createHallSceneClass(me, class {})
      const scene = new HallScene()
      scene.onResetEvent()
      scene.zoomBy(0.4)
      scene.resetToMainHall()
      const callback = frames.get(1)

      scene.onDestroyEvent()
      const operationCount = me.matrixOps.length
      callback?.(1000)

      expect(cancelled).to.deep.equal([1])
      expect(me.matrixOps).to.have.length(operationCount)
    } finally {
      globalThis.requestAnimationFrame = originalRequest
      globalThis.cancelAnimationFrame = originalCancel
    }
  })

  it('keeps destroy terminal when late engine build and update callbacks arrive', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()
    let readyCalls = 0
    scene.onReady(() => { readyCalls += 1 })
    scene.onResetEvent()
    expect(readyCalls).to.equal(1)

    scene.onDestroyEvent()
    const childCount = me.children.length
    const registrationCount = me.registered.length
    scene._buildScene()
    scene.update(16)

    expect(me.children).to.have.length(childCount)
    expect(me.registered).to.have.length(registrationCount)
    expect(me.listenerCount('pointerdown')).to.equal(0)
    expect(readyCalls).to.equal(1)
    expect(scene.getCameraSnapshot()).to.equal(null)
  })

  it('applies the scene transform to the melonJS world container', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()

    scene.onResetEvent()
    me.matrixOps.length = 0
    scene.zoomBy(0.5)
    scene.panBy(120, -80)

    expect(me.matrixOps.filter(op => op[0] === 'scale')).to.deep.equal([
      ['scale', 1.34, 1.34],
      ['scale', 1.34, 1.34]
    ])
    expect(me.matrixOps.filter(op => op[0] === 'identity')).to.have.length(2)
  })

  it('clamps fractional cover-cropped edges to the exact two-pixel tolerance', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()
    scene.onResetEvent()
    const viewport = { width: 1000.5, height: 500.25 }
    scene.resizeViewport({ ...viewport, kind: 'layout' })
    scene.panBy(9999, 9999)
    const transform = scene.getTransform()

    expect(transform).to.deep.equal({ zoom: 0.84, offsetX: -78.04, offsetY: -38.02 })
    const left = viewport.width / 2 * (1 - transform.zoom) + transform.offsetX
    const top = viewport.height / 2 * (1 - transform.zoom) + transform.offsetY
    const right = left + 1672 * transform.zoom
    const bottom = top + 941 * transform.zoom
    expect(left).to.be.closeTo(2, 0.001)
    expect(top).to.be.closeTo(2, 0.001)
    expect(right).to.be.at.least(viewport.width - 2)
    expect(bottom).to.be.at.least(viewport.height - 2)
  })

  it('retains the visible canvas crop through later layout resizes', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()
    const viewport = { width: 1664, height: 928 }
    const visibleViewport = { x: 617.2, y: 0, width: 429.6, height: 928 }
    scene.onResetEvent()
    scene.resizeViewport({ ...viewport, visibleViewport, kind: 'layout' })
    scene.zoomBy(0.41)
    scene.panBy(9999, 0)
    const leftTransform = scene.getTransform()
    const leftWorld = (visibleViewport.x - viewport.width / 2 - leftTransform.offsetX) / leftTransform.zoom + viewport.width / 2

    scene.resizeViewport({ ...viewport, kind: 'layout' })
    scene.panBy(-19999, 0)
    const rightTransform = scene.getTransform()
    const rightWorld = (visibleViewport.x + visibleViewport.width - viewport.width / 2 - rightTransform.offsetX) / rightTransform.zoom + viewport.width / 2

    expect(leftWorld).to.be.closeTo(0, 2)
    expect(rightWorld).to.be.closeTo(1664, 2)
  })

  it('zooms with wheel and pans with pointer drag inside the melonJS viewport', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()

    scene.onResetEvent()
    const wheelRegistration = me.registered.find(item => item.type === 'wheel' && item.region === me.canvas)
    const moveRegistration = me.registered.find(item => item.type === 'pointermove' && item.region === me.canvas)
    const downRegistrations = me.registered.filter(item => item.type === 'pointerdown' && item.region === me.canvas)
    const upRegistration = me.registered.find(item => item.type === 'pointerup' && item.region === me.canvas)

    expect(wheelRegistration).to.exist
    expect(moveRegistration).to.exist
    expect(downRegistrations).to.have.length(1)
    expect(upRegistration).to.exist

    me.canvas.dispatch('wheel', { deltaY: -120, clientX: 480, clientY: 320, preventDefault: () => {} })
    expect(scene.getTransform().zoom).to.equal(0.945)
    const beforeDrag = scene.getTransform()

    me.canvas.dispatch('pointerdown', { pointerId: 7, pointerType: 'mouse', clientX: 100, clientY: 100 })
    me.canvas.dispatch('pointermove', { pointerId: 7, pointerType: 'mouse', clientX: 140, clientY: 120, preventDefault: () => {} })
    expect(scene.getTransform().offsetX - beforeDrag.offsetX).to.equal(40)
    expect(scene.getTransform().offsetY - beforeDrag.offsetY).to.be.closeTo(20, 0.001)
    me.canvas.dispatch('pointerup', { pointerId: 7, pointerType: 'mouse' })
  })

  it('zooms with two touch pointers for mobile pinch gestures', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()

    scene.onResetEvent()
    const moveRegistration = me.registered.find(item => item.type === 'pointermove' && item.region === me.canvas)
    const downRegistrations = me.registered.filter(item => item.type === 'pointerdown' && item.region === me.canvas)

    me.canvas.dispatch('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 })
    me.canvas.dispatch('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 200, clientY: 100 })
    me.canvas.dispatch('pointermove', { pointerId: 2, pointerType: 'touch', clientX: 260, clientY: 100, preventDefault: () => {} })

    expect(scene.getTransform().zoom).to.equal(1.344)
  })

  it('atomically maps V2 above base, removes legacy duplicate layers, and restores V1 ownership', async () => {
    const me = createFakeMelon()
    const mapData = productionV2MapData({ withBase: true })
    installProductionImages(me, mapData)
    const HallScene = createHallSceneClass(me, V2HallAgent)
    const scene = new HallScene()
    const previousGate = window.__JYT_V2_ENABLED
    const originalCreateElement = document.createElement.bind(document)
    document.createElement = tag => tag === 'canvas'
      ? { width: 0, height: 0, getContext: () => ({ drawImage: () => {} }) }
      : originalCreateElement(tag)
    window.__JYT_V2_ENABLED = true
    try {
      scene.setTmxSha256(ACCEPTED_TMX_SHA256)
      scene.setMapData(mapData)
      scene.syncAgents([{ agentId: 'a', personaCode: 'a', x: 300, y: 200 }])
      scene.onResetEvent()
      scene.update(16)
      await waitFor(() => scene.activeRendererMode === 'v2')

      const fragments = scene._v2Assembly.canonicalIr.fragments
      const handles = [...scene._v2StagingRenderables]
      const logicalDepths = fragments.map(fragment => scene._v2Depths[fragment.stableId])
      const mappedDepths = fragments.map(fragment => hallV2WorldDepth(scene._v2Depths[fragment.stableId]))
      const layer = name => scene._imageLayersByName.get(name)
      const base = me.children.find(item => item.depth === HALL_SCENE_DEPTH_BANDS.BASE_MIN && !item.child.image?.resourceName)?.child
      expect(base).to.exist
      expect(base.depth).to.equal(0)
      expect(handles).to.have.length(32)
      expect(handles.map(handle => handle.depth).sort((a, b) => a - b)).to.deep.equal([...mappedDepths].sort((a, b) => a - b))
      expect(Object.values(scene._v2Depths).sort((a, b) => a - b)).to.deep.equal(Array.from({ length: Object.keys(scene._v2Depths).length }, (_, index) => index))
      expect(logicalDepths.every(Number.isSafeInteger)).to.equal(true)
      expect([...scene._v2RenderableHandles.values()].every(handle => handle.depth >= HALL_SCENE_DEPTH_BANDS.V2_WORLD_START && handle.depth < HALL_SCENE_DEPTH_BANDS.LIGHTING)).to.equal(true)
      expect(layer('mid-occluders').attached).to.equal(false)
      expect(layer('foreground-occluders').attached).to.equal(false)
      expect(me.game.world.hasChild(layer('mid-occluders').handle)).to.equal(false)
      expect(me.game.world.hasChild(layer('foreground-occluders').handle)).to.equal(false)
      expect(me.game.world.hasChild(layer('lighting-overlay').handle)).to.equal(true)
      expect(layer('lighting-overlay').handle.depth).to.equal(HALL_SCENE_DEPTH_BANDS.LIGHTING)

      await scene.deactivateV2()
      expect(scene.activeRendererMode).to.equal('v1')
      expect(layer('mid-occluders').attached).to.equal(true)
      expect(layer('foreground-occluders').attached).to.equal(true)
      expect(me.children.filter(item => item.child === layer('mid-occluders').handle)).to.have.length(1)
      expect(me.children.filter(item => item.child === layer('foreground-occluders').handle)).to.have.length(1)
      expect(layer('lighting-overlay').handle.depth).to.equal(8)
      expect(scene._agents.get('a').depth).to.be.lessThan(6)
    } finally {
      window.__JYT_V2_ENABLED = previousGate
      document.createElement = originalCreateElement
      await scene.deactivateV2()
    }
  })

  it('keeps the full legacy V1 image-layer stack when V2 is disabled', () => {
    const me = createFakeMelon()
    const mapData = productionV2MapData()
    installProductionImages(me, mapData)
    const HallScene = createHallSceneClass(me, V2HallAgent)
    const scene = new HallScene()
    const previousGate = window.__JYT_V2_ENABLED
    window.__JYT_V2_ENABLED = false
    try {
      scene.setTmxSha256(ACCEPTED_TMX_SHA256)
      scene.setMapData(mapData)
      scene.onResetEvent()
      expect(scene.activeRendererMode).to.equal('v1')
      for (const name of ['mid-occluders', 'foreground-occluders', 'lighting-overlay']) {
        const record = scene._imageLayersByName.get(name)
        expect(record.attached).to.equal(true)
        expect(me.game.world.hasChild(record.handle)).to.equal(true)
      }
    } finally {
      window.__JYT_V2_ENABLED = previousGate
      scene.onDestroyEvent()
    }
  })

  it('rolls an initial V2 sort failure back to the complete V1 stack', async () => {
    const me = createFakeMelon()
    const mapData = productionV2MapData()
    installProductionImages(me, mapData)
    const HallScene = createHallSceneClass(me, V2HallAgent)
    const scene = new HallScene()
    const previousGate = window.__JYT_V2_ENABLED
    window.__JYT_V2_ENABLED = true
    me.game.world.sort = () => { throw new Error('initial sort failed') }
    try {
      scene.setTmxSha256(ACCEPTED_TMX_SHA256)
      scene.setMapData(mapData)
      scene.onResetEvent()
      await waitFor(() => scene._v2Controller === null && scene._v2Assembly === null)
      expect(scene.activeRendererMode).to.equal('v1')
      for (const name of ['mid-occluders', 'foreground-occluders', 'lighting-overlay']) {
        const record = scene._imageLayersByName.get(name)
        expect(record.attached).to.equal(true)
        expect(me.game.world.hasChild(record.handle)).to.equal(true)
      }
      expect(scene._v2StagingRenderables).to.equal(null)
    } finally {
      window.__JYT_V2_ENABLED = previousGate
      me.game.world.sort = () => {}
      await scene.deactivateV2()
    }
  })

  it('destroys active V2 ownership without re-adding legacy layers', async () => {
    const me = createFakeMelon()
    const mapData = productionV2MapData()
    installProductionImages(me, mapData)
    const HallScene = createHallSceneClass(me, V2HallAgent)
    const scene = new HallScene()
    const previousGate = window.__JYT_V2_ENABLED
    window.__JYT_V2_ENABLED = true
    try {
      scene.setTmxSha256(ACCEPTED_TMX_SHA256)
      scene.setMapData(mapData)
      scene.onResetEvent()
      await waitFor(() => scene.activeRendererMode === 'v2')
      const legacyHandles = ['mid-occluders', 'foreground-occluders'].map(name => scene._imageLayersByName.get(name).handle)
      scene.onDestroyEvent()
      await scene._v2DestroyPromise
      expect(scene.activeRendererMode).to.equal('v1')
      expect(legacyHandles.every(handle => !me.game.world.hasChild(handle))).to.equal(true)
      expect(me.children).to.have.length(0)
    } finally {
      window.__JYT_V2_ENABLED = previousGate
    }
  })

  it('replaces roster atomically, commits later frames, and preserves the old scene on sort failure', async () => {
    const me = createFakeMelon()
    const mapData = productionV2MapData()
    installProductionImages(me, mapData)
    const HallScene = createHallSceneClass(me, V2HallAgent)
    const scene = new HallScene()
    const previousGate = window.__JYT_V2_ENABLED
    window.__JYT_V2_ENABLED = true
    try {
      scene.setTmxSha256(ACCEPTED_TMX_SHA256)
      scene.setMapData(mapData)
      scene.syncAgents([{ agentId: 'a', personaCode: 'a', x: 300, y: 200 }])
      scene.onResetEvent()
      scene.update(16)
      await waitFor(() => scene.activeRendererMode === 'v2')
      await scene._doApplyV2Depths(scene._v2Generation)
      await waitFor(() => scene._v2AgentAdapter?.sourceEntityIds.includes('a'))

      scene.syncAgents([
        { agentId: 'a', personaCode: 'a', x: 300, y: 200 },
        { agentId: 'b', personaCode: 'b', x: 300, y: 600 },
      ])
      scene.update(16)
      scene.update(16)
      await scene._v2FrameSerial
      await waitFor(() => scene._v2AgentAdapter?.sourceEntityIds.includes('b'))
      expect(scene._v2Controller.active.children).to.have.length(39)
      expect(scene._imageLayersByName.get('mid-occluders').attached).to.equal(false)
      expect(scene._imageLayersByName.get('foreground-occluders').attached).to.equal(false)

      const agentA = scene._agents.get('a')
      const beforeFrameDepth = agentA.depth
      agentA.pos.y = 850
      await scene._doApplyV2Depths(scene._v2Generation)
      expect(agentA.depth).not.to.equal(beforeFrameDepth)
      expect(agentA.depth).to.equal(hallV2WorldDepth(scene._v2Depths[scene._v2AgentAdapter.lookup('a').stableId]))

      const oldController = scene._v2Controller
      const oldAdapter = scene._v2AgentAdapter
      const oldAssembly = scene._v2Assembly
      const oldFragments = scene._v2StagingRenderables
      const oldDepths = scene._v2Depths
      const oldMembership = scene._v2Membership
      const oldHitTargets = scene._v2HitTargets
      scene._agents.delete('b')
      const originalSort = me.game.world.sort
      me.game.world.sort = () => { throw new Error('sort failed') }
      await scene._reactivateV2ForRoster()
      me.game.world.sort = originalSort

      expect(scene._v2Controller).to.equal(oldController)
      expect(scene._v2AgentAdapter).to.equal(oldAdapter)
      expect(scene._v2Assembly).to.equal(oldAssembly)
      expect(scene._v2StagingRenderables).to.equal(oldFragments)
      expect(scene._v2Depths).to.equal(oldDepths)
      expect(scene._v2Membership).to.equal(oldMembership)
      expect(scene._v2HitTargets).to.equal(oldHitTargets)
      expect(scene.activeRendererMode).to.equal('v2')
      expect([...oldFragments].every(handle => me.children.some(item => item.child === handle))).to.equal(true)
      expect(scene._imageLayersByName.get('mid-occluders').attached).to.equal(false)
      expect(scene._imageLayersByName.get('foreground-occluders').attached).to.equal(false)
    } finally {
      window.__JYT_V2_ENABLED = previousGate
      me.game.world.sort = () => {}
      await scene.deactivateV2()
    }
  })

})
