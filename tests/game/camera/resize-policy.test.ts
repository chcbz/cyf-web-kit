import assert from 'node:assert/strict'

import { classifyViewportResize } from '../../../src/game/camera/resizePolicy.js'

describe('viewport resize policy', () => {
  const classifyKeyboardBoundary = (
    visualHeightDelta: number,
    widthDelta: number,
    nextVisualHeight = 720 - visualHeightDelta
  ) => classifyViewportResize({
    previous: { width: 390, height: 720 },
    next: { width: 390 + widthDelta, height: 500 },
    previousVisualHeight: 720,
    nextVisualHeight,
    editableFocused: true
  })

  it('classifies a large visual-height-only change with editable focus as keyboard', () => {
    assert.equal(classifyViewportResize({
      previous: { width: 390, height: 720 },
      next: { width: 391.9, height: 500 },
      previousVisualHeight: 720,
      nextVisualHeight: 590,
      editableFocused: true
    }), 'keyboard')
  })

  it('applies inclusive keyboard boundaries and rejects values just outside them', () => {
    assert.equal(classifyKeyboardBoundary(119, 2), 'layout')
    assert.equal(classifyKeyboardBoundary(120, 2), 'keyboard')
    assert.equal(classifyKeyboardBoundary(120, 2.01), 'layout')
  })

  it('classifies keyboard closing as keyboard when editable focus remains', () => {
    assert.equal(classifyKeyboardBoundary(-120, 0, 840), 'keyboard')
  })

  it('does not classify a height change as keyboard without editable focus', () => {
    assert.equal(classifyViewportResize({
      previous: { width: 390, height: 720 },
      next: { width: 390, height: 500 },
      previousVisualHeight: 720,
      nextVisualHeight: 500,
      editableFocused: false
    }), 'layout')
  })

  it('classifies a portrait-landscape relation change as orientation after keyboard checks', () => {
    assert.equal(classifyViewportResize({
      previous: { width: 390, height: 720 },
      next: { width: 720, height: 390 },
      previousVisualHeight: 720,
      nextVisualHeight: 390,
      editableFocused: true
    }), 'orientation')
  })

  it('treats a near-square relation flip as layout jitter', () => {
    assert.equal(classifyViewportResize({
      previous: { width: 500, height: 501 },
      next: { width: 501, height: 500 },
      previousVisualHeight: 501,
      nextVisualHeight: 500,
      editableFocused: false
    }), 'layout')
  })

  it('accepts an explicit orientation signal only when the relation also flips', () => {
    assert.equal(classifyViewportResize({
      previous: { width: 500, height: 501 },
      next: { width: 501, height: 500 },
      previousVisualHeight: 501,
      nextVisualHeight: 500,
      editableFocused: false,
      orientationChanged: true
    }), 'orientation')

    assert.equal(classifyViewportResize({
      previous: { width: 390, height: 720 },
      next: { width: 400, height: 700 },
      previousVisualHeight: 720,
      nextVisualHeight: 700,
      editableFocused: false,
      orientationChanged: true
    }), 'layout')
  })

  it('classifies square and invalid dimensions deterministically as layout', () => {
    assert.equal(classifyViewportResize({
      previous: { width: 0, height: Number.NaN },
      next: { width: 500, height: 500 },
      previousVisualHeight: 0,
      nextVisualHeight: 0,
      editableFocused: false
    }), 'layout')
  })
})
