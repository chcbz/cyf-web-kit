import { expect } from 'chai'
import { readFileSync } from 'node:fs'

const game = readFileSync(new URL('../src/game/JuyitingGame.js', import.meta.url), 'utf8')
const scene = readFileSync(new URL('../src/game/scenes/HallScene.js', import.meta.url), 'utf8')
describe('live map preview runtime contract', () => {
  it('uses explicit scene bounds and preview contain adapters', () => {
    expect(game).to.include('applyPreviewContain')
    expect(game).to.include('getSceneBounds')
    expect(scene).to.include('sceneBounds()')
  })
})
