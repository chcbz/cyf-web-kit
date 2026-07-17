import assert from 'node:assert/strict'

import { MAIN_HALL_FOCUS, VIEW_PRESETS } from '../../src/game/camera/viewPresets.js'

describe('Juyiting game TypeScript tooling', () => {
  it('imports the typed camera view presets', () => {
    assert.deepEqual(MAIN_HALL_FOCUS, { x: 832, y: 390 })
    assert.deepEqual(VIEW_PRESETS, {
      mobilePortrait: { id: 'main-hall-mobile', zoom: 1.25 },
      mobileLandscape: { id: 'main-hall-mobile-landscape', zoom: 1.05 },
      tabletLandscape: { id: 'main-hall-tablet-landscape', zoom: 0.92 },
      desktop: { id: 'main-hall-desktop', zoom: 0.84 }
    })
  })
})
