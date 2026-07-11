import assert from 'node:assert/strict'
import {
  clampTransform,
  clampZoom,
  preserveFocus,
  screenToWorld,
  transformForFocus,
  zoomAt
} from '../../../src/game/camera/cameraTransform.js'

const closeTo = (actual: number, expected: number, tolerance: number): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} was not within ${tolerance} of ${expected}`)
}

describe('camera transforms', () => {
  it('keeps the focal world point within two CSS pixels', () => {
    const viewport = { width: 390, height: 720 }
    const focalPoint = { x: 240, y: 320 }
    const before = { zoom: 1, offsetX: 0, offsetY: 0 }

    const after = zoomAt(before, focalPoint, 1.5, viewport)
    const oldWorld = screenToWorld(focalPoint, before, viewport)
    const newWorld = screenToWorld(focalPoint, after, viewport)

    closeTo(newWorld.x, oldWorld.x, 2)
    closeTo(newWorld.y, oldWorld.y, 2)
  })

  it('builds a transform that places a native world point at a CSS screen point', () => {
    const viewport = { width: 800, height: 600 }
    const transform = transformForFocus({ x: 832, y: 390 }, { x: 175, y: 240 }, 1.25, viewport)

    assert.deepEqual(screenToWorld({ x: 175, y: 240 }, transform, viewport), { x: 832, y: 390 })
  })

  it('preserves the old center world point and zoom after orientation change', () => {
    const before = { zoom: 1.25, offsetX: 30, offsetY: -20 }
    const oldViewport = { width: 390, height: 720 }
    const newViewport = { width: 720, height: 390 }

    const next = preserveFocus(before, oldViewport, newViewport)

    assert.equal(next.zoom, before.zoom)
    assert.deepEqual(
      screenToWorld({ x: 360, y: 195 }, next, newViewport),
      screenToWorld({ x: 195, y: 360 }, before, oldViewport)
    )
  })

  it('bounds zoom and normalizes invalid values deterministically', () => {
    assert.equal(clampZoom(9, 0.8, 3.3), 3.3)
    assert.equal(clampZoom(0.2, 0.8, 3.3), 0.8)
    assert.equal(clampZoom(Number.NaN, 0.8, 3.3), 0.8)
    assert.equal(clampZoom(1, 4, 2), 2)
  })

  it('clamps offsets so a covered scene leaves no more than two CSS pixels blank', () => {
    const viewport = { width: 400, height: 300 }
    const scene = { width: 1000, height: 800 }

    const clamped = clampTransform(
      { zoom: 1, offsetX: 9999, offsetY: -9999 },
      viewport,
      scene,
      { minZoom: 0.4, maxZoom: 3.3 }
    )

    const topLeft = {
      x: viewport.width / 2 + clamped.offsetX - viewport.width / 2 * clamped.zoom,
      y: viewport.height / 2 + clamped.offsetY - viewport.height / 2 * clamped.zoom
    }
    assert.ok(topLeft.x <= 2)
    assert.ok(topLeft.y + scene.height * clamped.zoom >= viewport.height - 2)
  })

  it('never accepts an offset rounding tolerance above two CSS pixels', () => {
    const clamped = clampTransform(
      { zoom: 1, offsetX: 9999, offsetY: 0 },
      { width: 400, height: 300 },
      { width: 1000, height: 800 },
      { minZoom: 1, maxZoom: 3, roundingTolerance: 50 }
    )

    assert.ok(clamped.offsetX <= 2)
  })

  it('centers undersized scenes and handles zero dimensions deterministically', () => {
    assert.deepEqual(clampTransform(
      { zoom: 1, offsetX: 50, offsetY: -50 },
      { width: 400, height: 300 },
      { width: 100, height: 0 },
      { minZoom: 1, maxZoom: 3 }
    ), { zoom: 1, offsetX: 150, offsetY: 0 })

    assert.deepEqual(screenToWorld(
      { x: 10, y: 20 },
      { zoom: 0, offsetX: 5, offsetY: 5 },
      { width: 0, height: 0 }
    ), { x: 5, y: 15 })
  })
})
