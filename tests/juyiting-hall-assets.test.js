import { expect } from 'chai'
import { readFileSync } from 'fs'

import { createGameConfig, HALL_SCENE_HEIGHT, HALL_SCENE_WIDTH } from '../src/game/config.js'
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
})
