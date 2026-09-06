import { expect } from 'chai'
import {
  calculateContainTransform,
  resolveLiveMapPreviewActivation
} from '../../../src/composables/juyiting/liveMapPreviewPolicy.js'

describe('live map preview policy', () => {
  it('contains a non-zero-origin world around the viewport center', () => {
    const result = calculateContainTransform(
      { height: 100, width: 400, x: 100, y: 50 },
      { height: 300, width: 300 }
    )

    expect(result).to.include({ ready: true, scale: 0.75 })
    expect(100 * result.scale + result.offsetX).to.equal(0)
    expect((100 + 400) * result.scale + result.offsetX).to.equal(300)
    expect(50 * result.scale + result.offsetY).to.equal(112.5)
    expect((50 + 100) * result.scale + result.offsetY).to.equal(187.5)
  })

  it('returns an unready transform rather than NaN or Infinity for invalid dimensions', () => {
    for (const worldBounds of [
      { height: 100, width: 0, x: 0, y: 0 },
      { height: Infinity, width: 100, x: 0, y: 0 },
      { height: 100, width: 100, x: NaN, y: 0 }
    ]) {
      const result = calculateContainTransform(worldBounds, { height: 100, width: 100 })
      expect(result).to.deep.equal({ offsetX: null, offsetY: null, ready: false, scale: null })
    }
    expect(calculateContainTransform({ height: 100, width: 100, x: 0, y: 0 }, { height: 0, width: 100 }).ready).to.equal(false)
    expect(calculateContainTransform(
      { height: Number.MAX_VALUE, width: Number.MAX_VALUE, x: 0, y: 0 },
      { height: Number.MIN_VALUE, width: Number.MIN_VALUE }
    ).ready).to.equal(false)
  })

  it('uses a 20fps target only for a visible, ready portrait preview', () => {
    expect(resolveLiveMapPreviewActivation({ ready: true })).to.deep.equal({
      reason: 'portrait-visible', shouldRender: true, state: 'ready', targetFps: 20
    })
  })

  it('pauses drawing for not-ready, hidden, covered, and portrait-offscreen states', () => {
    for (const input of [
      {},
      { documentHidden: true, ready: true },
      { overlayCovered: true, ready: true },
      { portraitOffscreen: true, ready: true }
    ]) {
      const result = resolveLiveMapPreviewActivation(input)
      expect(result.shouldRender).to.equal(false)
      expect(result.targetFps).to.equal(0)
    }
  })

  it('does not pause the landscape scene because its portrait slot is offscreen', () => {
    expect(resolveLiveMapPreviewActivation({ landscapeActive: true, portraitOffscreen: true, ready: true })).to.deep.equal({
      reason: 'landscape-active', shouldRender: true, state: 'ready', targetFps: null
    })
  })
})
