import assert from 'node:assert/strict'

import { resolveHit, type HitArea } from '../../../src/game/input/hitTest.js'
import { createInteractionLock } from '../../../src/game/input/interactionLock.js'
import { createPointerGesture } from '../../../src/game/input/pointerGesture.js'

describe('pointer gesture', () => {
  it('emits a primary mouse click below the threshold', () => {
    const gesture = createPointerGesture()
    gesture.down({ id: 1, type: 'mouse', x: 10, y: 10 })

    assert.deepEqual(gesture.up({ id: 1, type: 'mouse', x: 14, y: 10 }), {
      kind: 'click',
      point: { x: 14, y: 10 }
    })
  })

  it('does not click when mouse displacement crosses the threshold only on pointer up', () => {
    const gesture = createPointerGesture()
    gesture.down({ id: 1, type: 'mouse', x: 10, y: 10 })

    assert.deepEqual(gesture.up({ id: 1, type: 'mouse', x: 17, y: 10 }), { kind: 'none' })
  })

  it('does not click when touch displacement crosses the threshold only on pointer up', () => {
    const gesture = createPointerGesture()
    gesture.down({ id: 1, type: 'touch', x: 10, y: 10 })

    assert.deepEqual(gesture.up({ id: 1, type: 'touch', x: 22, y: 10 }), { kind: 'none' })
  })

  it('cancels click after mouse drag exceeds six pixels and reports incremental deltas', () => {
    const gesture = createPointerGesture({ mouseThreshold: 6, touchThreshold: 11 })
    gesture.down({ id: 1, type: 'mouse', x: 10, y: 10 })

    assert.deepEqual(gesture.move({ id: 1, type: 'mouse', x: 17, y: 10 }), {
      kind: 'drag', dx: 7, dy: 0
    })
    assert.deepEqual(gesture.move({ id: 1, type: 'mouse', x: 20, y: 12 }), {
      kind: 'drag', dx: 3, dy: 2
    })
    assert.deepEqual(gesture.up({ id: 1, type: 'mouse', x: 20, y: 12 }), { kind: 'none' })
  })

  it('uses the larger touch threshold', () => {
    const gesture = createPointerGesture()
    gesture.down({ id: 1, type: 'touch', x: 0, y: 0 })
    assert.deepEqual(gesture.move({ id: 1, type: 'touch', x: 10, y: 0 }), { kind: 'none' })
    assert.equal(gesture.move({ id: 1, type: 'touch', x: 12, y: 0 }).kind, 'drag')
  })

  it('starts pinch immediately on the second touch and scales from its starting distance', () => {
    const gesture = createPointerGesture()
    gesture.down({ id: 1, type: 'touch', x: 0, y: 0 })

    assert.deepEqual(gesture.down({ id: 2, type: 'touch', x: 10, y: 0 }), {
      kind: 'pinch', center: { x: 5, y: 0 }, scale: 1
    })
    assert.deepEqual(gesture.move({ id: 2, type: 'touch', x: 20, y: 0 }), {
      kind: 'pinch', center: { x: 10, y: 0 }, scale: 2
    })
    assert.deepEqual(gesture.up({ id: 2, type: 'touch', x: 20, y: 0 }), { kind: 'none' })
    assert.deepEqual(gesture.up({ id: 1, type: 'touch', x: 0, y: 0 }), { kind: 'none' })
  })

  it('ignores malformed samples without moving or corrupting the gesture', () => {
    const gesture = createPointerGesture()
    gesture.down({ id: 1, type: 'mouse', x: 5, y: 5 })
    assert.deepEqual(gesture.move({ id: Number.NaN, type: 'mouse', x: 100, y: 100 }), { kind: 'none' })
    assert.deepEqual(gesture.move({ id: 1, type: 'mouse', x: Number.NaN, y: 100 }), { kind: 'none' })
    assert.deepEqual(gesture.up({ id: 1, type: 'mouse', x: 5, y: 5 }), {
      kind: 'click', point: { x: 5, y: 5 }
    })
  })

  it('cancels individual and all pointers and snapshots the active gesture', () => {
    const gesture = createPointerGesture()
    assert.equal(gesture.snapshot().activeGesture, 'none')
    gesture.down({ id: 1, type: 'mouse', x: 0, y: 0 })
    assert.equal(gesture.snapshot().activeGesture, 'click')
    gesture.cancel(1)
    assert.equal(gesture.snapshot().activeGesture, 'none')
    gesture.down({ id: 2, type: 'touch', x: 0, y: 0 })
    gesture.down({ id: 3, type: 'touch', x: 10, y: 0 })
    assert.equal(gesture.snapshot().activeGesture, 'pinch')
    gesture.cancelAll()
    assert.equal(gesture.snapshot().activeGesture, 'none')
  })
})

describe('hit testing', () => {
  const rectangle = (
    id: string,
    kind: HitArea['kind'],
    left: number,
    top: number,
    right: number,
    bottom: number,
    touchSlop?: number
  ): HitArea => ({
    id,
    kind,
    touchSlop,
    contains: point => point.x >= left && point.x <= right && point.y >= top && point.y <= bottom
  })

  it('prioritizes agent, then hotspot, then blank map in candidate order', () => {
    const point = { x: 5, y: 5 }
    const agents = [rectangle('first', 'agent', 0, 0, 10, 10), rectangle('second', 'agent', 0, 0, 10, 10)]
    const hotspots = [rectangle('door', 'hotspot', 0, 0, 10, 10)]

    assert.deepEqual(resolveHit(point, agents, hotspots, 'mouse'), { kind: 'agent', id: 'first' })
    assert.deepEqual(resolveHit(point, [], hotspots, 'mouse'), { kind: 'hotspot', id: 'door' })
    assert.deepEqual(resolveHit(point, [], [], 'mouse'), { kind: 'blank' })
  })

  it('applies touch slop only to touch pointers', () => {
    const agent = rectangle('agent', 'agent', 10, 10, 20, 20, 5)
    const point = { x: 6, y: 15 }

    assert.deepEqual(resolveHit(point, [agent], [], 'touch'), { kind: 'agent', id: 'agent' })
    assert.deepEqual(resolveHit(point, [agent], [], 'mouse'), { kind: 'blank' })
    assert.deepEqual(resolveHit(point, [agent], [], 'pen'), { kind: 'blank' })
  })
})

describe('interaction lock', () => {
  it('keeps independent reason reference counts and returns a sorted immutable snapshot', () => {
    const lock = createInteractionLock()
    lock.lock('loading')
    lock.lock('panel')
    lock.lock('panel')
    lock.lock('   ')

    const reasons = lock.reasons()
    assert.deepEqual(reasons, ['loading', 'panel'])
    assert.equal(Object.isFrozen(reasons), true)
    lock.unlock('panel')
    assert.equal(lock.isLocked(), true)
    assert.deepEqual(lock.reasons(), ['loading', 'panel'])
    lock.unlock('panel')
    lock.unlock('loading')
    assert.equal(lock.isLocked(), false)
  })
})
