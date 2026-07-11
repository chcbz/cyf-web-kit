import assert from 'node:assert/strict'

import { classifyViewportResize } from '../../../src/game/camera/resizePolicy.js'

describe('viewport resize policy', () => {
  it('classifies a large visual-height-only change with editable focus as keyboard', () => {
    assert.equal(classifyViewportResize({
      previous: { width: 390, height: 720 },
      next: { width: 391.9, height: 500 },
      previousVisualHeight: 720,
      nextVisualHeight: 590,
      editableFocused: true
    }), 'keyboard')
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
