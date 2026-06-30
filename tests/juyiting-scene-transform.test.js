import { expect } from 'chai'

import {
  clamp,
  clampSceneTransform,
  percentRectToViewport,
  screenToWorldPoint
} from '../src/game/sceneTransform.js'

describe('Juyiting scene transform helpers', () => {
  it('maps percent rectangles into viewport rectangles', () => {
    expect(percentRectToViewport({ x: 50, y: 40, w: 20, h: 10 }, { width: 1000, height: 600 })).to.deep.equal({
      x: 400,
      y: 210,
      width: 200,
      height: 60,
      centerX: 500,
      centerY: 240
    })
  })

  it('clamps pan and zoom to viewport bounds', () => {
    expect(clamp(5, 1, 3)).to.equal(3)
    expect(clampSceneTransform({
      offsetX: 900,
      offsetY: -900,
      zoom: 9
    }, {
      viewportWidth: 960,
      viewportHeight: 640,
      minZoom: 0.75,
      maxZoom: 3.3
    })).to.deep.equal({
      offsetX: 960,
      offsetY: -640,
      zoom: 3.3
    })
  })

  it('converts screen points into transformed world coordinates', () => {
    expect(screenToWorldPoint({
      x: 580,
      y: 340,
      viewportWidth: 960,
      viewportHeight: 640,
      offsetX: 100,
      offsetY: -20,
      zoom: 2
    })).to.deep.equal({ x: 480, y: 350 })
  })
})
