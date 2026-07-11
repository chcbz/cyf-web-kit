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

    const after = zoomAt(before, focalPoint, 1.5, viewport, { minZoom: 0.8, maxZoom: 3.3 })
    const oldWorld = screenToWorld(focalPoint, before, viewport)
    const newWorld = screenToWorld(focalPoint, after, viewport)

    closeTo(newWorld.x, oldWorld.x, 2)
    closeTo(newWorld.y, oldWorld.y, 2)
  })

  it('clamps focal zoom before preserving the focal world point', () => {
    const viewport = { width: 390, height: 720 }
    const focalPoint = { x: 240, y: 320 }
    const before = { zoom: 1, offsetX: 14, offsetY: -9 }

    const after = zoomAt(before, focalPoint, 9, viewport, { minZoom: 0.8, maxZoom: 1.6 })

    assert.equal(after.zoom, 1.6)
    assert.deepEqual(
      screenToWorld(focalPoint, after, viewport),
      screenToWorld(focalPoint, before, viewport)
    )
  })

  it('preserves a normalized current transform for invalid focal zoom input', () => {
    const bounds = { minZoom: 0.8, maxZoom: 1.6 }
    const current = { zoom: 9, offsetX: 14, offsetY: -9 }

    for (const invalid of [
      { point: { x: Number.NaN, y: 320 }, zoom: 1.2, viewport: { width: 390, height: 720 } },
      { point: { x: 240, y: Number.POSITIVE_INFINITY }, zoom: 1.2, viewport: { width: 390, height: 720 } },
      { point: { x: 240, y: 320 }, zoom: Number.NaN, viewport: { width: 390, height: 720 } },
      { point: { x: 240, y: 320 }, zoom: 1.2, viewport: { width: 0, height: 720 } },
      { point: { x: 240, y: 320 }, zoom: 1.2, viewport: { width: 390, height: Number.NaN } }
    ]) {
      assert.deepEqual(
        zoomAt(current, invalid.point, invalid.zoom, invalid.viewport, bounds),
        { zoom: 1.6, offsetX: 14, offsetY: -9 }
      )
    }
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

  it('clamps every extreme direction with fractional CSS and native dimensions', () => {
    const viewport = { width: 400.5, height: 300.25 }
    const scene = { width: 601.75, height: 451.5 }

    for (const [offsetX, offsetY] of [
      [9999, 0],
      [-9999, 0],
      [0, 9999],
      [0, -9999]
    ]) {
      const clamped = clampTransform(
        { zoom: 1, offsetX, offsetY },
        viewport,
        scene,
        { minZoom: 0.5, maxZoom: 3.3 }
      )
      const left = viewport.width / 2 + clamped.offsetX - viewport.width / 2 * clamped.zoom
      const top = viewport.height / 2 + clamped.offsetY - viewport.height / 2 * clamped.zoom
      const right = left + scene.width * clamped.zoom
      const bottom = top + scene.height * clamped.zoom

      assert.ok(left <= 2)
      assert.ok(top <= 2)
      assert.ok(right >= viewport.width - 2)
      assert.ok(bottom >= viewport.height - 2)
    }
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

  it('raises zoom to the cover minimum and keeps all four map edges within the viewport tolerance', () => {
    const viewport = { width: 400, height: 300 }
    const scene = { width: 200, height: 200 }
    const clamped = clampTransform(
      { zoom: 0.5, offsetX: 999, offsetY: -999 },
      viewport,
      scene,
      { minZoom: 0.5, maxZoom: 3.3 }
    )
    const left = viewport.width / 2 + clamped.offsetX - viewport.width / 2 * clamped.zoom
    const top = viewport.height / 2 + clamped.offsetY - viewport.height / 2 * clamped.zoom
    const right = left + scene.width * clamped.zoom
    const bottom = top + scene.height * clamped.zoom

    assert.equal(clamped.zoom, 2)
    assert.ok(clamped.zoom >= 0.5 && clamped.zoom <= 3.3)
    assert.ok(left <= 2)
    assert.ok(top <= 2)
    assert.ok(right >= viewport.width - 2)
    assert.ok(bottom >= viewport.height - 2)
  })

  it('uses max zoom and centers each impossible-to-cover axis deterministically', () => {
    const clamped = clampTransform(
      { zoom: 0.5, offsetX: 999, offsetY: -999 },
      { width: 400, height: 300 },
      { width: 100, height: 100 },
      { minZoom: 0.5, maxZoom: 2 }
    )

    assert.deepEqual(clamped, { zoom: 2, offsetX: 300, offsetY: 200 })
  })

  it('centers only the impossible axis while clamping the coverable axis', () => {
    const viewport = { width: 400, height: 300 }
    const scene = { width: 100, height: 500 }
    const clamped = clampTransform(
      { zoom: 2, offsetX: -999, offsetY: 999 },
      viewport,
      scene,
      { minZoom: 0.5, maxZoom: 2 }
    )
    const left = viewport.width / 2 + clamped.offsetX - viewport.width / 2 * clamped.zoom
    const top = viewport.height / 2 + clamped.offsetY - viewport.height / 2 * clamped.zoom
    const bottom = top + scene.height * clamped.zoom

    assert.equal(left, 100)
    assert.ok(top <= 2)
    assert.ok(bottom >= viewport.height - 2)
  })

  it('handles zero dimensions deterministically', () => {
    assert.deepEqual(screenToWorld(
      { x: 10, y: 20 },
      { zoom: 0, offsetX: 5, offsetY: 5 },
      { width: 0, height: 0 }
    ), { x: 5, y: 15 })
  })
})
