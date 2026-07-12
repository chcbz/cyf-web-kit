import { expect } from 'chai'

import { createHallSceneClass } from '../src/game/scenes/HallScene.js'
import { JuyitingGame } from '../src/game/JuyitingGame.js'

describe('HallScene melonJS runtime compatibility', () => {
  it('delegates the camera and input migration facade safely', () => {
    const calls = []
    const game = new JuyitingGame()
    game._hallScene = {
      resizeViewport: change => calls.push(['resize', change]),
      setInteractionLocked: (locked, reason) => calls.push(['lock', locked, reason]),
      getCameraSnapshot: () => ({ presetKey: 'desktop' }),
      inputSnapshot: () => ({ interactionLocked: true }),
      resetToMainHall: () => calls.push(['reset'])
    }

    game.resizeViewport({ width: 800, height: 600, kind: 'layout' })
    game.setInteractionLocked(true, 'panel')
    expect(game.getCameraSnapshot()).to.deep.equal({ presetKey: 'desktop' })
    expect(game.getInputSnapshot()).to.deep.equal({ interactionLocked: true })
    game.resetToMainHall()

    expect(calls).to.deep.equal([
      ['resize', { width: 800, height: 600, kind: 'layout' }],
      ['lock', true, 'panel'],
      ['reset']
    ])
  })

  it('uses non-container image layers so melonJS broadphase does not recurse into them', () => {
    const added = []

    class Stage {
      update() {}
    }

    class Renderable {
      constructor(x, y, width, height) {
        this.pos = { x, y }
        this.width = width
        this.height = height
        this.anchorPoint = { set: () => {} }
      }
    }

    class ImageLayer {
      constructor() {
        this.addChild = () => {}
      }
    }

    const me = {
      ImageLayer,
      Renderable,
      Stage,
      game: {
        viewport: { width: 1672, height: 941 },
        world: {
          addChild: child => added.push(child),
          currentTransform: {
            identity() { return this },
            translate() { return this },
            scale() { return this }
          }
        }
      },
      input: {
        registerPointerEvent: () => {}
      },
      loader: {
        getImage: () => ({ width: 1672, height: 941 })
      }
    }

    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()
    scene.setMapData({
      imageLayers: {
        'mid-occluders': { width: 1672, height: 941 },
        'foreground-occluders': { width: 1672, height: 941 },
        'lighting-overlay': { width: 1672, height: 941 }
      },
      tileLayers: [],
      tilesets: [],
      hotspots: []
    })

    scene._buildScene()

    const imageLayers = added.filter(child => child.image)

    const renderLayerCount = Object.keys(scene._mapData.imageLayers).length
    expect(imageLayers).to.have.length(renderLayerCount)
    expect(imageLayers.every(layer => typeof layer.addChild === 'function')).to.equal(false)
    expect(imageLayers.every(layer => layer.isKinematic === true)).to.equal(true)
    expect(added.filter(child => child.data).every(marker => marker.isKinematic === true)).to.equal(true)
  })

  it('skips image layer removal when the melonJS world no longer owns the layer', () => {
    const warnings = []
    const originalWarn = console.warn

    class Stage {
      update() {}
    }

    class Renderable {
      constructor(x, y, width, height) {
        this.pos = { x, y }
        this.width = width
        this.height = height
        this.anchorPoint = { set: () => {} }
      }
    }

    const me = {
      Renderable,
      Stage,
      game: {
        viewport: { width: 1672, height: 941 },
        world: {
          addChild: () => {},
          currentTransform: {
            identity() { return this },
            translate() { return this },
            scale() { return this }
          },
          hasChild: () => false,
          removeChild: () => {
            throw new Error('Child is not mine.')
          }
        }
      },
      input: {
        registerPointerEvent: () => {},
        releaseAllPointerEvents: () => {}
      },
      loader: {
        getImage: () => ({ width: 1672, height: 941 })
      }
    }

    console.warn = (...args) => warnings.push(args)
    try {
      const HallScene = createHallSceneClass(me, class {})
      const scene = new HallScene()

      scene._buildScene()
      scene.onDestroyEvent()
    } finally {
      console.warn = originalWarn
    }

    expect(warnings).to.deep.equal([])
  })
})
