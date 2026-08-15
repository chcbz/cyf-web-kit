import assert from 'node:assert/strict'
import {
  clientToViewport,
  clockwiseRectToViewport,
  createViewportTransform,
  localToViewport,
  quadToViewport,
  viewportToClient
} from '../../src/game/viewportTransform.js'

const closeTo = (actual: number, expected: number, tolerance = 0.001): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} was not within ${tolerance} of ${expected}`)
}

describe('viewport transform', () => {
  it('uses cover scaling to fill a portrait display without vertical letterboxing', () => {
    const transform = createViewportTransform(
      { left: 0, top: 0, width: 390, height: 844 },
      { width: 1664, height: 928 }
    )

    closeTo(transform.scale, 844 / 928)
    assert.ok(transform.offsetX < 0)
    closeTo(transform.offsetY, 0)
  })

  it('round-trips client coordinates through a shifted cover display', () => {
    const display = { left: 24, top: 38, width: 390, height: 844 }
    const viewport = { width: 1664, height: 928 }
    const client = { x: 217, y: 464 }

    const point = clientToViewport(client.x, client.y, display, viewport)
    const restored = viewportToClient(point.x, point.y, display, viewport)

    closeTo(restored.x, client.x)
    closeTo(restored.y, client.y)
  })

  it('keeps an already cover-sized melon viewport aligned with its display', () => {
    const display = { left: 0, top: 0, width: 390, height: 844 }
    const viewport = { width: 429, height: 928 }
    const point = clientToViewport(195, 422, display, viewport)

    closeTo(point.x, viewport.width / 2)
    closeTo(point.y, viewport.height / 2)
  })

  it('inverts a clockwise CSS rotation so virtual-landscape drag axes stay visual', () => {
    const viewport = { width: 844, height: 390 }
    const quad = {
      p1: { x: 390, y: 0 },
      p2: { x: 390, y: 844 },
      p4: { x: 0, y: 0 }
    }

    const start = quadToViewport(340, 100, quad, viewport)
    const draggedLeft = quadToViewport(340, 80, quad, viewport)

    assert.ok(start)
    assert.ok(draggedLeft)
    closeTo(start.x, 100)
    closeTo(start.y, 50)
    closeTo(draggedLeft.x, 80)
    closeTo(draggedLeft.y, 50)
  })


  it('uses a 90-degree rectangle fallback for embedded browsers without box quads', () => {
    const start = clockwiseRectToViewport(340, 100, { left: 0, top: 0, width: 390, height: 844 }, { width: 844, height: 390 })
    const draggedLeft = clockwiseRectToViewport(340, 80, { left: 0, top: 0, width: 390, height: 844 }, { width: 844, height: 390 })

    assert.deepEqual(start, { x: 100, y: 50 })
    assert.deepEqual(draggedLeft, { x: 80, y: 50 })
  })

  it('maps target-local pointer coordinates without using a rotated bounding rect', () => {
    assert.deepEqual(
      localToViewport(211, 97.5, { width: 422, height: 195 }, { width: 844, height: 390 }),
      { x: 422, y: 195 }
    )
  })

})
