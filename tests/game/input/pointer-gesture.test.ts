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

  it('promotes the second touch to incremental drag when the first pinch pointer lifts', () => {
    const gesture = createPointerGesture()
    gesture.down({ id: 1, type: 'touch', x: 0, y: 0 })
    gesture.down({ id: 2, type: 'touch', x: 10, y: 0 })
    gesture.move({ id: 2, type: 'touch', x: 20, y: 0 })

    assert.deepEqual(gesture.up({ id: 1, type: 'touch', x: 0, y: 0 }), { kind: 'none' })
    assert.equal(gesture.snapshot().activeGesture, 'drag')
    assert.deepEqual(gesture.move({ id: 2, type: 'touch', x: 23, y: 2 }), {
      kind: 'drag', dx: 3, dy: 2
    })
    assert.deepEqual(gesture.up({ id: 2, type: 'touch', x: 23, y: 2 }), { kind: 'none' })
  })

  it('promotes the first touch to incremental drag when the second pinch pointer lifts', () => {
    const gesture = createPointerGesture()
    gesture.down({ id: 1, type: 'touch', x: 0, y: 0 })
    gesture.down({ id: 2, type: 'touch', x: 10, y: 0 })
    gesture.move({ id: 1, type: 'touch', x: -5, y: 0 })

    assert.deepEqual(gesture.up({ id: 2, type: 'touch', x: 10, y: 0 }), { kind: 'none' })
    assert.equal(gesture.snapshot().activeGesture, 'drag')
    assert.deepEqual(gesture.move({ id: 1, type: 'touch', x: -2, y: 4 }), {
      kind: 'drag', dx: 3, dy: 4
    })
    assert.deepEqual(gesture.up({ id: 1, type: 'touch', x: -2, y: 4 }), { kind: 'none' })
  })

  it('ignores a third touch without changing or ending the active pinch', () => {
    const gesture = createPointerGesture()
    gesture.down({ id: 1, type: 'touch', x: 0, y: 0 })
    gesture.down({ id: 2, type: 'touch', x: 10, y: 0 })

    assert.deepEqual(gesture.down({ id: 3, type: 'touch', x: 100, y: 100 }), { kind: 'none' })
    assert.deepEqual(gesture.snapshot().activePointerIds, [1, 2])
    assert.deepEqual(gesture.up({ id: 3, type: 'touch', x: 100, y: 100 }), { kind: 'none' })
    assert.equal(gesture.snapshot().activeGesture, 'pinch')
    assert.deepEqual(gesture.move({ id: 2, type: 'touch', x: 20, y: 0 }), {
      kind: 'pinch', center: { x: 10, y: 0 }, scale: 2
    })
  })

  it('ignores two touches while a mouse is primary without leaving stale pointer state', () => {
    const gesture = createPointerGesture()
    gesture.down({ id: 1, type: 'mouse', x: 0, y: 0 })

    assert.deepEqual(gesture.down({ id: 2, type: 'touch', x: 10, y: 0 }), { kind: 'none' })
    assert.deepEqual(gesture.down({ id: 3, type: 'touch', x: 20, y: 0 }), { kind: 'none' })
    assert.deepEqual(gesture.snapshot().activePointerIds, [1])
    assert.equal(gesture.snapshot().activeGesture, 'click')
    assert.deepEqual(gesture.up({ id: 1, type: 'mouse', x: 0, y: 0 }), {
      kind: 'click', point: { x: 0, y: 0 }
    })
    assert.equal(gesture.snapshot().activeGesture, 'none')
  })

  it('ignores touch while a pen is primary and keeps pen drag state deterministic', () => {
    const gesture = createPointerGesture()
    gesture.down({ id: 1, type: 'pen', x: 0, y: 0 })

    assert.deepEqual(gesture.down({ id: 2, type: 'touch', x: 10, y: 0 }), { kind: 'none' })
    assert.deepEqual(gesture.snapshot().activePointerIds, [1])
    assert.deepEqual(gesture.move({ id: 1, type: 'pen', x: 7, y: 2 }), {
      kind: 'drag', dx: 7, dy: 2
    })
    assert.deepEqual(gesture.up({ id: 1, type: 'pen', x: 7, y: 2 }), { kind: 'none' })
    assert.equal(gesture.snapshot().activeGesture, 'none')
  })

  it('ignores secondary mouse and pen pointers while preserving touch pinch admission', () => {
    const gesture = createPointerGesture()
    gesture.down({ id: 1, type: 'touch', x: 0, y: 0 })

    assert.deepEqual(gesture.down({ id: 2, type: 'mouse', x: 5, y: 0 }), { kind: 'none' })
    assert.deepEqual(gesture.down({ id: 3, type: 'pen', x: 5, y: 0 }), { kind: 'none' })
    assert.deepEqual(gesture.snapshot().activePointerIds, [1])
    assert.deepEqual(gesture.down({ id: 4, type: 'touch', x: 10, y: 0 }), {
      kind: 'pinch', center: { x: 5, y: 0 }, scale: 1
    })
    assert.deepEqual(gesture.snapshot().activePointerIds, [1, 4])
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
    bounds: { x: left, y: top, width: right - left, height: bottom - top },
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

  it('uses exact slop callbacks for corner hits while keeping mouse precise', () => {
    const agent: HitArea = {
      id: 'agent',
      kind: 'agent',
      touchSlop: 5,
      contains: point => point.x >= 10 && point.x <= 20 && point.y >= 10 && point.y <= 20,
      containsWithSlop: (point, slop) => {
        const nearestX = Math.max(10, Math.min(20, point.x))
        const nearestY = Math.max(10, Math.min(20, point.y))
        return Math.hypot(point.x - nearestX, point.y - nearestY) <= slop
      }
    }
    const cornerPoint = { x: 6, y: 8 }

    assert.deepEqual(resolveHit(cornerPoint, [agent], [], 'touch'), { kind: 'agent', id: 'agent' })
    assert.deepEqual(resolveHit(cornerPoint, [agent], [], 'mouse'), { kind: 'blank' })
  })

  it('uses Euclidean distance for rectangular touch slop corners', () => {
    const agent: HitArea = {
      id: 'agent',
      kind: 'agent',
      touchSlop: 5,
      bounds: { x: 10, y: 10, width: 10, height: 10 },
      contains: point => point.x >= 10 && point.x <= 20 && point.y >= 10 && point.y <= 20
    }

    assert.deepEqual(resolveHit({ x: 6, y: 8 }, [agent], [], 'touch'), {
      kind: 'agent', id: 'agent'
    })
    assert.deepEqual(resolveHit({ x: 5, y: 5 }, [agent], [], 'touch'), { kind: 'blank' })
    assert.deepEqual(resolveHit({ x: 6, y: 8 }, [agent], [], 'mouse'), { kind: 'blank' })
  })

  it('does not approximate touch slop when no exact callback or bounds are provided', () => {
    const agent: HitArea = {
      id: 'agent',
      kind: 'agent',
      touchSlop: 5,
      contains: point => point.x >= 10 && point.x <= 20 && point.y >= 10 && point.y <= 20
    }

    assert.deepEqual(resolveHit({ x: 6, y: 15 }, [agent], [], 'touch'), { kind: 'blank' })
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
