import { expect } from 'chai'

import { JuyitingGame } from '../src/game/JuyitingGame.js'

const rect = (width, height) => ({ left: 0, top: 0, right: width, bottom: height, width, height })

const canvas = () => ({
  parentElement: null,
  style: { setProperty: () => {} },
  getBoundingClientRect: () => rect(390, 844)
})

describe('JuyitingGame screen lifecycle regressions', () => {
  it('resumes the Hall-paused state after a remount so world updates run again', () => {
    const game = new JuyitingGame()
    let paused = false
    let pauseCalls = 0
    let updateCalls = 0
    let changes = 0
    const child = { update: () => { updateCalls += 1 } }
    const state = {
      pause: () => { pauseCalls += 1; paused = true },
      isPaused: () => paused,
      change: () => { changes += 1 },
      resume: () => {
        paused = false
        child.update()
      }
    }
    game._me = { state }
    game._hallScene = { onDestroyEvent: () => {} }
    game._initialized = true
    game._stateId = 101

    game._cleanupRuntime(game._me)
    // A fatal cleanup can be followed by destroy; it must not lose ownership
    // just because the state is already paused on the second pass.
    game._cleanupRuntime(game._me)
    expect(paused).to.equal(true)
    expect(pauseCalls).to.equal(1)
    expect(game._pausedByHallCleanup).to.equal(true)

    // Simulate the fresh state installed by the following map mount.
    game._initialized = true
    game._stateId = 102
    game.start()

    expect(changes).to.equal(1)
    expect(paused).to.equal(false)
    expect(updateCalls).to.equal(1)
    expect(game._pausedByHallCleanup).to.equal(false)
  })

  it('observes only the current reparented container and requests melon native reflow there', () => {
    const originalResizeObserver = globalThis.ResizeObserver
    const observers = []
    class FakeResizeObserver {
      constructor (callback) { this.callback = callback; this.disconnected = false; observers.push(this) }
      observe (target) { this.target = target }
      disconnect () { this.disconnected = true }
    }
    globalThis.ResizeObserver = FakeResizeObserver
    try {
      const game = new JuyitingGame()
      const first = { id: 'A' }
      const second = { id: 'B' }
      let reflows = 0
      let commits = 0
      game._mountToken = 7
      game._container = first
      game._me = {
        game: { parentElement: first, settings: {}, renderer: { settings: {} } },
        event: { WINDOW_ONRESIZE: 'resize', emit: name => { if (name === 'resize') reflows += 1 } }
      }
      game._scheduleViewportCommit = () => { commits += 1 }

      game._observeContainerResize()
      const firstObserver = observers[0]
      game._container = second
      game._rebindEngineContainer(second)
      game._observeContainerResize()
      const secondObserver = observers[1]

      expect(firstObserver.disconnected).to.equal(true)
      expect(secondObserver.target).to.equal(second)
      firstObserver.callback()
      expect(reflows).to.equal(0)
      expect(commits).to.equal(0)

      secondObserver.callback()
      expect(reflows).to.equal(1)
      expect(commits).to.equal(1)
      expect(game._me.game.parentElement).to.equal(second)
      expect(game._me.game.settings.scaleTarget).to.equal(second)
    } finally {
      if (originalResizeObserver === undefined) delete globalThis.ResizeObserver
      else globalThis.ResizeObserver = originalResizeObserver
    }
  })

  it('restores native renderer scale after virtual landscape is removed', () => {
    const game = new JuyitingGame()
    const targetCanvas = canvas()
    const scaleRatio = {
      x: 1.25,
      y: 1.5,
      set (x, y) { this.x = x; this.y = y }
    }
    game._canvas = targetCanvas
    game._container = { getBoundingClientRect: () => rect(390, 844) }
    game._mountToken = 3
    game._scheduleViewportCommit = () => {}
    game._me = { game: { viewport: { width: 844, height: 390 }, renderer: { scaleRatio } } }

    game.setVirtualViewport({ width: 844, height: 390 })
    game._applyCanvasCover()
    expect(scaleRatio.x).to.not.equal(1.25)

    game.setVirtualViewport(null)
    expect(scaleRatio).to.include({ x: 1.25, y: 1.5 })
  })

  it('transfers the global pointer adapter between Hall owners and restores the original method exactly once', () => {
    const received = []
    const pointerPrototype = {
      setEvent (...args) { received.push(args) }
    }
    const pointer = Object.create(pointerPrototype)
    const originalSetEvent = pointerPrototype.setEvent
    const createOwner = canvas => {
      const game = new JuyitingGame()
      game._canvas = canvas
      game._mountToken = 1
      game._scheduleViewportCommit = () => {}
      game._me = { input: { pointer } }
      return game
    }
    const firstCanvas = canvas()
    const secondCanvas = canvas()
    const first = createOwner(firstCanvas)
    const second = createOwner(secondCanvas)
    const firstEvent = Object.freeze({ target: firstCanvas, type: 'pointerdown' })
    const secondEvent = Object.freeze({ target: secondCanvas, type: 'pointerdown' })

    first.setVirtualViewport({ width: 844, height: 390 })
    const firstWrapper = pointerPrototype.setEvent
    second.setVirtualViewport({ width: 844, height: 390 })
    const secondWrapper = pointerPrototype.setEvent
    expect(secondWrapper).to.not.equal(firstWrapper)

    first.setVirtualViewport(null)
    expect(pointerPrototype.setEvent).to.equal(secondWrapper)
    pointer.setEvent(secondEvent, 92, 37, 92, 37, 3)
    expect(received.at(-1).slice(1, 5)).to.deep.equal([37, 298, 37, 298])

    second.setVirtualViewport(null)
    expect(pointerPrototype.setEvent).to.equal(originalSetEvent)
    pointer.setEvent(firstEvent, 92, 37, 92, 37, 3)
    expect(received.at(-1).slice(1, 5)).to.deep.equal([92, 37, 92, 37])
  })

  it('maps only pointer numeric arguments and restores the exact prototype without mutating readonly host events', () => {
    const game = new JuyitingGame()
    const targetCanvas = canvas()
    const received = []
    const pointerPrototype = {
      setEvent (event, pageX, pageY, clientX, clientY, pointerId) {
        received.push({ event, pageX, pageY, clientX, clientY, pointerId })
      }
    }
    const pointer = Object.create(pointerPrototype)
    game._canvas = targetCanvas
    game._mountToken = 4
    game._scheduleViewportCommit = () => {}
    game._me = { input: { pointer } }
    const readonlyEvent = Object.freeze({ target: targetCanvas, type: 'pointerdown', clientX: 92, clientY: 37 })

    game.setVirtualViewport({ width: 844, height: 390 })
    pointer.setEvent(readonlyEvent, 92, 37, 92, 37, 9)

    expect(readonlyEvent).to.include({ clientX: 92, clientY: 37 })
    expect(received[0]).to.include({ pageX: 37, pageY: 298, clientX: 37, clientY: 298, pointerId: 9 })
    game.setVirtualViewport(null)
    expect(pointerPrototype.setEvent).to.not.equal(undefined)
    pointer.setEvent(readonlyEvent, 92, 37, 92, 37, 9)
    expect(received[1]).to.include({ pageX: 92, pageY: 37, clientX: 92, clientY: 37 })
  })
})
