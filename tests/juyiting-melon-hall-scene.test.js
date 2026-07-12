import { expect } from 'chai'

import { createHallSceneClass } from '../src/game/scenes/HallScene.js'

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
        addChild: (child, depth) => children.push({ child, depth }),
        removeChild: () => {}
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
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()

    scene.onResetEvent()
    scene.panBy(120, -80)
    expect(scene.getTransform().zoom).to.equal(0.84)

    scene.zoomBy(0.5)
    scene.panBy(120, -80)

    expect(scene.getTransform().zoom).to.equal(1.34)

    scene.resetTransform()
    expect(scene.getCameraSnapshot().animation).not.to.equal(null)
  })

  it('fits the scene using the melonJS viewport instead of DOM container pixels', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()

    scene.onResetEvent()
    scene.zoomBy(0.4)
    scene.fitToViewport({ width: 390, height: 720 })
    expect(scene.getCameraSnapshot().animation).not.to.equal(null)
  })

  it('keeps transform state unchanged when viewport bounds are unavailable', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()

    me.game.viewport = null
    expect(scene.zoomBy(0.5)).to.deep.equal({ offsetX: 0, offsetY: 0, zoom: 0.84 })
    expect(scene.panBy(120, -80)).to.deep.equal({ offsetX: 0, offsetY: 0, zoom: 0.84 })
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

  it('uses the current visible melon layer size for cover-cropped drag bounds', () => {
    const me = createFakeMelon()
    me.game.viewport.width = 1672
    me.game.viewport.height = 941
    me.setCanvasRect({ left: 0, top: 0, width: 390, height: 720 })
    me.setLayerRect({ left: 0, top: 0, width: 1280, height: 360 })
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()

    scene.panBy(0, 999)

    expect(scene.getTransform().offsetY).to.be.greaterThan(0)
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
})
