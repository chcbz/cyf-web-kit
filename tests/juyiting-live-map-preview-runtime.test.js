import { expect } from 'chai'
import { JuyitingGame } from '../src/game/JuyitingGame.js'

describe('live map preview runtime adapter', () => {
  it('throttles preview draws to 20fps without changing update ownership and restores only its wrapper', () => {
    const game = new JuyitingGame()
    const calls = []
    game._me = { game: { draw (...args) { calls.push(args) } } }
    game.setPreviewDrawPolicy({ enabled: true, visible: true })
    const draw = game._me.game.draw
    const clock = { now: 0 }
    const performanceDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'performance')
    Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => clock.now } })
    let now = 0
    try {
      for (now = 0; now < 1000; now += 10) { clock.now = now; draw.call(game._me.game, now) }
      expect(calls.length).to.be.within(19, 21)
      game.setPreviewDrawPolicy({ enabled: true, visible: false })
      draw.call(game._me.game, 1000)
      expect(calls.length).to.be.within(19, 21)
      game.clearPreviewDrawPolicy()
      expect(game._me.game.draw).not.to.equal(draw)
    } finally { Object.defineProperty(globalThis, 'performance', performanceDescriptor); game.clearPreviewDrawPolicy() }
  })
})
