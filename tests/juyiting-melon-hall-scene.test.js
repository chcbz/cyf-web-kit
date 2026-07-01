import { expect } from 'chai'

import { createHallSceneClass } from '../src/game/scenes/HallScene.js'

const createFakeMelon = () => {
  const registered = []
  const children = []

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
    registered,
    children
  }
}

describe('HallScene melonJS pointer routing', () => {
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
})
