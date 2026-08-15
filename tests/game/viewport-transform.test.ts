import assert from 'node:assert/strict'
import {
  clientToViewport,
  createViewportTransform,
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
})
