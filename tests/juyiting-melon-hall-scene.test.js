import { expect } from 'chai'

import { HALL_SCENE_IMAGE_LAYERS, HALL_SCENE_PROP_LAYERS } from '../src/game/hallSceneLayers.js'
import { createHallSceneClass } from '../src/game/scenes/HallScene.js'

const createFakeMelon = () => {
  const registered = []
  const children = []
  const matrixOps = []
  let canvasRect = null
  let layerRect = null

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

  class Stage {}

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
    input: {
      registerPointerEvent: (type, region, callback) => registered.push({ type, region, callback }),
      releaseAllPointerEvents: () => {}
    },
    loader: {
      getImage: () => null
    },
    video: {
      getCanvas: () => ({
        parentElement: layerRect ? { getBoundingClientRect: () => layerRect } : null,
        getBoundingClientRect: () => canvasRect
      })
    },
    setCanvasRect: rect => { canvasRect = rect },
    setLayerRect: rect => { layerRect = rect },
    registered,
    children,
    matrixOps
  }
}

describe('HallScene melonJS pointer routing', () => {
  it('keeps custom image layers inside the transformed world scene', () => {
    const me = createFakeMelon()
    me.loader.getImage = name => name === 'liangshan-hall-bg' ? { width: 960, height: 640 } : null
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()

    scene.onResetEvent()

    const background = me.children.find(item => item.depth === 0)?.child
    expect(background).to.exist
    expect(background.floating).not.to.equal(true)
  })

  it('renders declared hall image and prop layers in depth order', () => {
    const me = createFakeMelon()
    const expectedLayers = HALL_SCENE_IMAGE_LAYERS.concat(HALL_SCENE_PROP_LAYERS)
    me.loader.getImage = name => expectedLayers.some(layer => layer.resourceName === name)
      ? { width: 1672, height: 941, resourceName: name }
      : null
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()

    scene.onResetEvent()

    const renderedLayers = me.children
      .filter(item => item.child.image?.resourceName)
      .map(item => ({ name: item.child.image.resourceName, depth: item.depth }))

    expect(renderedLayers).to.deep.equal(
      expectedLayers
        .slice()
        .sort((a, b) => a.depth - b.depth)
        .map(layer => ({ name: layer.resourceName, depth: layer.depth }))
    )
  })

  it('keeps transform state inside the melonJS scene', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()

    scene.onResetEvent()
    scene.panBy(120, -80)
    expect(scene.getTransform()).to.deep.equal({ offsetX: 0, offsetY: 0, zoom: 1 })

    scene.zoomBy(0.5)
    scene.panBy(120, -80)

    expect(scene.getTransform()).to.include({ offsetX: 120, offsetY: -80, zoom: 1.5 })

    scene.resetTransform()
    expect(scene.getTransform()).to.deep.equal({ offsetX: 0, offsetY: 0, zoom: 1 })
  })

  it('fits the scene using the melonJS viewport instead of DOM container pixels', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()

    expect(scene.fitToViewport({ width: 390, height: 720 })).to.deep.equal({ offsetX: 0, offsetY: 0, zoom: 1 })
    expect(me.matrixOps.slice(-4)).to.deep.equal([
      ['identity'],
      ['translate', 480, 320],
      ['scale', 1, 1],
      ['translate', -480, -320]
    ])
  })

  it('keeps transform state unchanged when viewport bounds are unavailable', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()

    me.game.viewport = null
    expect(scene.zoomBy(0.5)).to.deep.equal({ offsetX: 0, offsetY: 0, zoom: 1 })
    expect(scene.panBy(120, -80)).to.deep.equal({ offsetX: 0, offsetY: 0, zoom: 1 })
  })

  it('registers clickable hotspots on renderables and the agent hit router on the viewport', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()
    const hotspotClicks = []

    scene.onHotspotClick(hotspot => hotspotClicks.push(hotspot))
    scene.onResetEvent()

    const hotspotRegistration = me.registered.find(item => item.region.data?.id === 'mainSeat')
    expect(hotspotRegistration).to.exist
    expect(hotspotRegistration.region).to.be.instanceOf(me.Renderable)
    expect(hotspotRegistration.callback()).to.equal(false)
    expect(hotspotClicks[0]).to.deep.equal({ id: 'mainSeat', panel: 'chat' })

    const viewportRegistration = me.registered.find(item => item.region === me.game.viewport)
    expect(viewportRegistration).to.exist
    expect(viewportRegistration.callback({ gameX: 10, gameY: 10 })).to.equal(true)

    scene._agents.set('missing-coordinate-guard', {
      containsPoint: () => {
        throw new Error('agent hit test should not run without finite coordinates')
      }
    })
    expect(viewportRegistration.callback({})).to.equal(true)
  })

  it('routes hotspot clicks through melonJS after DOM rooms are removed', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()
    const clicked = []

    scene.onHotspotClick(item => clicked.push(item))
    scene.onResetEvent()

    const hotspotRegistration = me.registered.find(item => item.region.data?.id === 'bountyBoard')
    expect(hotspotRegistration).to.exist
    hotspotRegistration.callback({ gameX: 730, gameY: 300 })

    expect(clicked[0]).to.deep.equal({ id: 'bountyBoard', panel: 'tasks' })
  })

  it('applies the scene transform to the melonJS world container', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()

    scene.zoomBy(0.5)
    scene.panBy(120, -80)

    expect(me.matrixOps).to.deep.equal([
      ['identity'],
      ['translate', 480, 320],
      ['scale', 1, 1],
      ['translate', -480, -320],
      ['identity'],
      ['translate', 480, 320],
      ['scale', 1.5, 1.5],
      ['translate', -480, -320],
      ['identity'],
      ['translate', 600, 240],
      ['scale', 1.5, 1.5],
      ['translate', -480, -320]
    ])
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

    expect(scene.getTransform()).to.deep.equal({ offsetX: 0, offsetY: 235.375, zoom: 1 })
  })

  it('zooms with wheel and pans with pointer drag inside the melonJS viewport', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()

    scene.onResetEvent()
    const wheelRegistration = me.registered.find(item => item.type === 'wheel' && item.region === me.game.viewport)
    const moveRegistration = me.registered.find(item => item.type === 'pointermove' && item.region === me.game.viewport)
    const downRegistrations = me.registered.filter(item => item.type === 'pointerdown' && item.region === me.game.viewport)
    const upRegistration = me.registered.find(item => item.type === 'pointerup' && item.region === me.game.viewport)

    expect(wheelRegistration).to.exist
    expect(moveRegistration).to.exist
    expect(downRegistrations).to.have.length.greaterThan(1)
    expect(upRegistration).to.exist

    wheelRegistration.callback({ deltaY: -120, preventDefault: () => {} })
    expect(scene.getTransform().zoom).to.equal(1.12)

    downRegistrations[1].callback({ pointerId: 7, pointerType: 'mouse', clientX: 100, clientY: 100 })
    moveRegistration.callback({ pointerId: 7, pointerType: 'mouse', clientX: 140, clientY: 120, preventDefault: () => {} })
    expect(scene.getTransform()).to.include({ offsetX: 40, offsetY: 20 })
    upRegistration.callback({ pointerId: 7, pointerType: 'mouse' })
  })

  it('zooms with two touch pointers for mobile pinch gestures', () => {
    const me = createFakeMelon()
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()

    scene.onResetEvent()
    const moveRegistration = me.registered.find(item => item.type === 'pointermove' && item.region === me.game.viewport)
    const downRegistrations = me.registered.filter(item => item.type === 'pointerdown' && item.region === me.game.viewport)

    downRegistrations[1].callback({ pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 })
    downRegistrations[1].callback({ pointerId: 2, pointerType: 'touch', clientX: 200, clientY: 100 })
    moveRegistration.callback({ pointerId: 2, pointerType: 'touch', clientX: 260, clientY: 100, preventDefault: () => {} })

    expect(scene.getTransform().zoom).to.equal(1.6)
  })
})
