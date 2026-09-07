import { expect } from 'chai'
import { JuyitingGame } from '../src/game/JuyitingGame.js'

describe('live map preview runtime adapter', () => {
  it('throttles preview draws to 20fps without changing update ownership and restores only its wrapper', () => {
    const game = new JuyitingGame()
    const calls = []
    game._me = { game: { draw (...args) { calls.push(args) } } }
    game._initialized = true
    game._mountToken = 1
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


it('restores its failed-mount draw wrapper without overwriting a foreign newer owner', () => {
  const game = new JuyitingGame()
  let originalCalls = 0
  const original = () => { originalCalls += 1; return 'original' }
  game._me = { game: { draw: original } }
  game._initialized = true
  game._mountToken = 1
  game.setPreviewDrawPolicy({ enabled: true, visible: true })
  const owned = game._me.game.draw
  expect(owned).not.to.equal(original)
  game._cleanupFailedMount(game._me)
  expect(game._me.game.draw).to.equal(original)

  game._initialized = true
  game._mountToken = 2
  game.setPreviewDrawPolicy({ enabled: true, visible: true })
  const foreign = function (...args) { return owned.apply(this, args) }
  game._me.game.draw = foreign
  game.clearPreviewDrawPolicy()
  expect(game._me.game.draw).to.equal(foreign)
  expect(game._me.game.draw()).to.equal('original')
  expect(originalCalls).to.equal(1)
})

it('keeps visible landscape draws unthrottled while suppressing hidden draws without touching update', () => {
  const game = new JuyitingGame()
  const draws = []; let updates = 0
  game._me = { game: { draw: value => draws.push(value), update: () => { updates += 1 } } }
  game._initialized = true
  game._mountToken = 1
  game.setPreviewDrawPolicy({ enabled: false, visible: true })
  const draw = game._me.game.draw
  for (let tick = 0; tick < 8; tick += 1) { draw(tick); game._me.game.update() }
  expect(draws).to.have.length(8)
  expect(updates).to.equal(8)
  game.setPreviewDrawPolicy({ enabled: false, visible: false })
  for (let tick = 8; tick < 16; tick += 1) { draw(tick); game._me.game.update() }
  expect(draws).to.have.length(8)
  expect(updates).to.equal(16)
  game.clearPreviewDrawPolicy()
})

it('returns an explicit receipt for an idempotent live viewport commit while stale cancellation remains undefined', async () => {
  const game = new JuyitingGame()
  const originalRaf = window.requestAnimationFrame
  const originalCancel = window.cancelAnimationFrame
  const frames = new Map(); let nextFrame = 0
  const variables = new Map([['--juyiting-canvas-display-width', '844px'], ['--juyiting-canvas-display-height', '390px']])
  const rect = { left: 0, top: 0, width: 844, height: 390, right: 844, bottom: 390 }
  const width = () => Number.parseFloat(variables.get('--juyiting-canvas-display-width'))
  const height = () => Number.parseFloat(variables.get('--juyiting-canvas-display-height'))
  const canvas = { style: { setProperty: (name, value) => variables.set(name, value) }, getBoundingClientRect: () => ({ left: (rect.width - width()) / 2, top: (rect.height - height()) / 2, width: width(), height: height(), right: (rect.width + width()) / 2, bottom: (rect.height + height()) / 2 }) }
  const resizes = []
  const advance = () => { const entry = frames.entries().next().value; expect(entry).to.not.equal(undefined); frames.delete(entry[0]); entry[1](); }
  try {
    window.requestAnimationFrame = callback => { const id = ++nextFrame; frames.set(id, callback); return id }
    window.cancelAnimationFrame = id => frames.delete(id)
    game._mountToken = 1
    game._isCurrentMount = token => token === game._mountToken
    game._container = { getBoundingClientRect: () => ({ ...rect }) }
    game._canvas = canvas
    game._me = { game: { viewport: { width: 1664, height: 928 } } }
    game._hallScene = { resizeViewport: change => { resizes.push(change); return { committed: true } } }
    game._markSceneDebugDirty = () => {}
    const first = game.commitViewport({ width: 844, height: 390, kind: 'orientation', orientationChanged: true })
    advance(); advance()
    expect(await first).to.deep.equal({ committed: true })
    const repeated = game.commitViewport({ width: 844, height: 390, kind: 'orientation', orientationChanged: true })
    advance(); advance()
    expect(await repeated).to.equal(true)
    expect(resizes).to.have.length(1)
    const stale = game.commitViewport({ width: 844, height: 390 })
    game._mountToken = 2
    advance()
    expect(await stale).to.equal(undefined)
  } finally {
    window.requestAnimationFrame = originalRaf
    window.cancelAnimationFrame = originalCancel
  }
})
