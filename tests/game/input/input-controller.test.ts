import assert from 'node:assert/strict'

import { createInputController, type InputEventTarget } from '../../../src/game/input/inputController.js'
import { createInteractionLock } from '../../../src/game/input/interactionLock.js'
import type { HitArea } from '../../../src/game/input/hitTest.js'

type Listener = (event: Record<string, unknown>) => void

const createTarget = () => {
  const listeners = new Map<string, Set<Listener>>()
  const captures: number[] = []
  const releases: number[] = []
  const target: InputEventTarget = {
    addEventListener(type, listener) {
      const entries = listeners.get(type) ?? new Set<Listener>()
      entries.add(listener as Listener)
      listeners.set(type, entries)
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener as Listener)
    },
    setPointerCapture: id => captures.push(id),
    releasePointerCapture: id => releases.push(id)
  }
  return {
    target,
    captures,
    releases,
    count: (type: string) => listeners.get(type)?.size ?? 0,
    dispatch: (type: string, event: Record<string, unknown>) => {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event)
    }
  }
}

const pointer = (overrides: Record<string, unknown> = {}) => {
  let prevented = false
  return {
    pointerId: 1,
    pointerType: 'mouse',
    clientX: 10,
    clientY: 10,
    button: 0,
    preventDefault: () => { prevented = true },
    prevented: () => prevented,
    ...overrides
  }
}

const createHarness = () => {
  const eventTarget = createTarget()
  const calls = {
    begin: 0,
    pans: [] as Array<[number, number]>,
    zooms: [] as Array<[{ x: number; y: number }, number]>,
    resets: 0,
    agents: [] as string[],
    hotspots: [] as string[],
    blanks: [] as Array<{ x: number; y: number }>
  }
  const lock = createInteractionLock()
  let viewport = { width: 200, height: 100 }
  let agents: HitArea[] = []
  let hotspots: HitArea[] = []
  const controller = createInputController({
    target: eventTarget.target,
    camera: {
      beginUserGesture: () => { calls.begin += 1 },
      panBy: (dx, dy) => { calls.pans.push([dx, dy]) },
      zoomAt: (point, factor) => { calls.zooms.push([point, factor]) },
      resetToMainHall: () => { calls.resets += 1 }
    },
    interactionLock: lock,
    viewport: () => ({ ...viewport }),
    hitProvider: () => ({ agents, hotspots }),
    onAgentClick: id => calls.agents.push(id),
    onHotspotClick: id => calls.hotspots.push(id),
    onBlankClick: point => calls.blanks.push(point)
  })
  return {
    ...eventTarget,
    calls,
    lock,
    controller,
    setViewport: (next: { width: number; height: number }) => { viewport = next },
    setHits: (nextAgents: HitArea[], nextHotspots: HitArea[]) => {
      agents = nextAgents
      hotspots = nextHotspots
    }
  }
}

describe('input controller', () => {
  it('binds each listener exactly once and cleanup is idempotent with no leaks', () => {
    const harness = createHarness()
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel', 'keydown', 'dblclick']) {
      assert.equal(harness.count(type), 1)
    }

    harness.dispatch('pointerdown', pointer({ pointerId: 7 }))
    harness.controller.cleanup()
    harness.controller.cleanup()

    assert.deepEqual(harness.releases, [7])
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel', 'keydown', 'dblclick']) {
      assert.equal(harness.count(type), 0)
    }
  })

  it('pans mouse drags by incremental deltas and starts the user gesture', () => {
    const harness = createHarness()
    harness.dispatch('pointerdown', pointer())
    harness.dispatch('pointermove', pointer({ clientX: 17 }))
    harness.dispatch('pointermove', pointer({ clientX: 20, clientY: 12 }))
    harness.dispatch('pointerup', pointer({ clientX: 20, clientY: 12 }))

    assert.deepEqual(harness.calls.pans, [[7, 0], [3, 2]])
    assert.equal(harness.calls.begin, 1)
    assert.deepEqual(harness.calls.blanks, [])
  })

  it('pinch zooms incrementally around its center without panning and prevents touch scroll', () => {
    const harness = createHarness()
    const first = pointer({ pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 })
    const second = pointer({ pointerId: 2, pointerType: 'touch', clientX: 10, clientY: 0 })
    const moved = pointer({ pointerId: 2, pointerType: 'touch', clientX: 20, clientY: 0 })
    harness.dispatch('pointerdown', first)
    harness.dispatch('pointerdown', second)
    harness.dispatch('pointermove', moved)

    assert.deepEqual(harness.calls.zooms, [[{ x: 10, y: 0 }, 2]])
    assert.deepEqual(harness.calls.pans, [])
    assert.equal(moved.prevented(), true)
    assert.equal(harness.calls.begin, 1)
  })

  it('zooms wheel around the pointer with bounded normalized factors', () => {
    const harness = createHarness()
    const wheelIn = pointer({ clientX: 25, clientY: 30, deltaY: -10000 })
    const wheelOut = pointer({ clientX: 25, clientY: 30, deltaY: 10000 })
    harness.dispatch('wheel', wheelIn)
    harness.dispatch('wheel', wheelOut)

    assert.equal(wheelIn.prevented(), true)
    assert.equal(wheelOut.prevented(), true)
    assert.deepEqual(harness.calls.zooms.map(entry => entry[0]), [{ x: 25, y: 30 }, { x: 25, y: 30 }])
    assert.ok(harness.calls.zooms[0][1] > 1 && harness.calls.zooms[0][1] <= 1.25)
    assert.ok(harness.calls.zooms[1][1] < 1 && harness.calls.zooms[1][1] >= 0.8)
    assert.equal(harness.calls.begin, 2)
  })

  it('handles zoom and reset keys at viewport center while filtering repeat and editable targets', () => {
    const harness = createHarness()
    harness.dispatch('keydown', { key: '+', repeat: false, target: null, preventDefault() {} })
    harness.dispatch('keydown', { key: '_', repeat: false, target: null, preventDefault() {} })
    harness.dispatch('keydown', { key: '0', repeat: false, target: null, preventDefault() {} })
    harness.dispatch('keydown', { key: '+', repeat: true, target: null, preventDefault() {} })
    harness.dispatch('keydown', { key: '+', repeat: false, target: { tagName: 'INPUT' }, preventDefault() {} })

    assert.deepEqual(harness.calls.zooms.map(entry => entry[0]), [{ x: 100, y: 50 }, { x: 100, y: 50 }])
    assert.ok(harness.calls.zooms[0][1] > 1)
    assert.ok(harness.calls.zooms[1][1] < 1)
    assert.equal(harness.calls.resets, 1)
    assert.equal(harness.calls.begin, 3)
  })

  it('routes clicks agent before hotspot before blank, with touch slop and mouse precision', () => {
    const harness = createHarness()
    const area = (id: string, kind: HitArea['kind'], touchSlop?: number): HitArea => ({
      id,
      kind,
      touchSlop,
      contains: point => point.x >= 10 && point.x <= 20 && point.y >= 10 && point.y <= 20
    })
    harness.setHits([area('agent', 'agent', 5)], [area('hotspot', 'hotspot', 5)])

    harness.dispatch('pointerdown', pointer({ clientX: 15, clientY: 15 }))
    harness.dispatch('pointerup', pointer({ clientX: 15, clientY: 15 }))
    harness.dispatch('pointerdown', pointer({ pointerType: 'touch', clientX: 6, clientY: 15 }))
    harness.dispatch('pointerup', pointer({ pointerType: 'touch', clientX: 6, clientY: 15 }))
    harness.dispatch('pointerdown', pointer({ clientX: 6, clientY: 15 }))
    harness.dispatch('pointerup', pointer({ clientX: 6, clientY: 15 }))

    assert.deepEqual(harness.calls.agents, ['agent', 'agent'])
    assert.deepEqual(harness.calls.hotspots, [])
    assert.deepEqual(harness.calls.blanks, [{ x: 6, y: 15 }])
  })

  it('ignores locked input and cancels an active gesture without affecting the lock owner', () => {
    const harness = createHarness()
    harness.dispatch('pointerdown', pointer({ pointerId: 3 }))
    harness.dispatch('pointerdown', pointer({ pointerId: 4, pointerType: 'touch' }))
    harness.lock.lock('panel')
    harness.dispatch('pointermove', pointer({ clientX: 30 }))
    harness.dispatch('wheel', pointer({ deltaY: -10 }))
    harness.dispatch('keydown', { key: '+', repeat: false, target: null, preventDefault() {} })

    assert.deepEqual(harness.calls.pans, [])
    assert.deepEqual(harness.calls.zooms, [])
    assert.deepEqual(harness.lock.reasons(), ['panel'])
    assert.equal(harness.controller.snapshot().activeGesture, 'none')
    assert.deepEqual(harness.releases, [3, 4])
  })

  it('cancels explicitly and suppresses browser double click behavior', () => {
    const harness = createHarness()
    harness.dispatch('pointerdown', pointer({ pointerId: 8 }))
    harness.dispatch('pointerdown', pointer({ pointerId: 9, pointerType: 'touch' }))
    harness.controller.cancelGesture()
    const doubleClick = pointer()
    harness.dispatch('dblclick', doubleClick)

    assert.equal(harness.controller.snapshot().activeGesture, 'none')
    assert.deepEqual(harness.releases, [8, 9])
    assert.equal(doubleClick.prevented(), true)
  })

  it('rejects malformed pointer events before camera, capture, prevention, or click side effects', () => {
    const harness = createHarness()
    const malformed = [
      pointer({ pointerId: Number.NaN }),
      pointer({ pointerId: -1 }),
      pointer({ pointerId: 1.5 }),
      pointer({ pointerId: Number.MAX_SAFE_INTEGER + 1 }),
      pointer({ clientX: Number.NaN }),
      pointer({ clientY: Number.POSITIVE_INFINITY })
    ]

    for (const event of malformed) {
      harness.dispatch('pointerdown', event)
      harness.dispatch('pointermove', event)
      harness.dispatch('pointerup', event)
      harness.dispatch('pointercancel', event)
      assert.equal(event.prevented(), false)
    }

    assert.equal(harness.calls.begin, 0)
    assert.deepEqual(harness.captures, [])
    assert.deepEqual(harness.releases, [])
    assert.deepEqual(harness.calls.pans, [])
    assert.deepEqual(harness.calls.zooms, [])
    assert.deepEqual(harness.calls.agents, [])
    assert.deepEqual(harness.calls.hotspots, [])
    assert.deepEqual(harness.calls.blanks, [])
  })

  it('rejects malformed wheel coordinates and delta before camera or prevention side effects', () => {
    const harness = createHarness()
    const malformed = [
      pointer({ clientX: Number.NaN, deltaY: -1 }),
      pointer({ clientY: Number.NEGATIVE_INFINITY, deltaY: -1 }),
      pointer({ deltaY: Number.NaN })
    ]

    for (const event of malformed) {
      harness.dispatch('wheel', event)
      assert.equal(event.prevented(), false)
    }

    assert.equal(harness.calls.begin, 0)
    assert.deepEqual(harness.calls.zooms, [])
  })
})
