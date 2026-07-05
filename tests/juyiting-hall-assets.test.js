import { expect } from 'chai'
import { readFileSync } from 'fs'

import { createGameConfig, HALL_SCENE_HEIGHT, HALL_SCENE_WIDTH } from '../src/game/config.js'
import { HALL_SCENE_IMAGE_LAYERS, HALL_SCENE_PROP_LAYERS } from '../src/game/hallSceneLayers.js'
import { HALL_RESOURCES } from '../src/game/resources.js'

const pngSize = (path) => {
  const bytes = readFileSync(path)
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  }
}

describe('Juyiting hall scene assets', () => {
  it('uses the background native dimensions as the melonJS scene size', () => {
    const bg = pngSize('public/juyiting/images/liangshan-hall-bg-v2.png')
    const config = createGameConfig()

    expect(HALL_SCENE_WIDTH).to.equal(bg.width)
    expect(HALL_SCENE_HEIGHT).to.equal(bg.height)
    expect(config.width).to.equal(bg.width)
    expect(config.height).to.equal(bg.height)
  })

  it('loads a foreground layer extracted from the matching hall background', () => {
    const fg = HALL_RESOURCES.find(resource => resource.name === 'liangshan-hall-fg')
    const fgSize = pngSize('public/juyiting/images/liangshan-hall-foreground-extracted-v1.png')
    const bgSize = pngSize('public/juyiting/images/liangshan-hall-bg-v2.png')

    expect(fg?.src).to.equal('/juyiting/images/liangshan-hall-foreground-extracted-v1.png')
    expect(fgSize).to.deep.equal(bgSize)
  })

  it('declares a 2.5D layer manifest from base to lighting overlay', () => {
    expect(HALL_SCENE_IMAGE_LAYERS.map(layer => layer.id)).to.deep.equal([
      'baseClean',
      'midOccluders',
      'foregroundOccluders',
      'lightingOverlay'
    ])

    expect(HALL_SCENE_IMAGE_LAYERS.map(layer => layer.resourceName)).to.deep.equal([
      'liangshan-hall-base-clean',
      'liangshan-hall-mid-occluders',
      'liangshan-hall-foreground-occluders',
      'liangshan-hall-lighting-overlay'
    ])

    expect(HALL_SCENE_IMAGE_LAYERS.map(layer => layer.depth)).to.deep.equal([0, 2, 5, 8])
  })

  it('exposes interactive prop layers for hall hotspots', () => {
    expect(HALL_SCENE_PROP_LAYERS.map(layer => layer.id)).to.include.members([
      'prop-main-seat',
      'prop-bounty-board',
      'prop-library-shelf',
      'prop-agent-roster',
      'prop-gate'
    ])

    HALL_SCENE_PROP_LAYERS.forEach(layer => {
      expect(layer.hotspotId).to.be.a('string').and.not.equal('')
      expect(layer.resourceName).to.match(/^liangshan-hall-prop-/)
      expect(layer.depth).to.equal(4)
    })
  })

  it('loads every declared scene layer as a melonJS image resource', () => {
    const resourceNames = HALL_RESOURCES.map(resource => resource.name)

    HALL_SCENE_IMAGE_LAYERS.concat(HALL_SCENE_PROP_LAYERS).forEach(layer => {
      expect(resourceNames).to.include(layer.resourceName)
      expect(layer.src).to.match(/^\/juyiting\/images\//)
    })
  })

  it('keeps generated scene layers aligned to the hall background dimensions', () => {
    const bgSize = pngSize('public/juyiting/images/liangshan-hall-bg-v2.png')

    HALL_SCENE_IMAGE_LAYERS.concat(HALL_SCENE_PROP_LAYERS).forEach(layer => {
      const relativePath = layer.src.replace('/juyiting/', 'public/juyiting/')
      expect(pngSize(relativePath), layer.id).to.deep.equal(bgSize)
    })
  })
})
