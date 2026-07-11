import assert from 'node:assert/strict'

import {
  createCameraController,
  type CameraAdapter
} from '../../../src/game/camera/cameraController.js'
import { screenToWorld } from '../../../src/game/camera/cameraTransform.js'
import {
  MAIN_HALL_FOCUS,
  MAIN_HALL_PRESETS,
  VIEW_PRESETS,
  selectViewPreset
} from '../../../src/game/camera/viewPresets.js'

type FrameCallback = (now: number) => void

const createAdapter = (
  initialViewport = { width: 390, height: 720 },
  scene = { width: 1664, height: 1200 }
) => {
  let viewport = { ...initialViewport }
  let now = 1000
  let nextFrameId = 1
  const frames = new Map<number, FrameCallback>()
  const retainedFrames: FrameCallback[] = []
  const applied: Array<{ zoom: number; offsetX: number; offsetY: number }> = []
  const cancelled: number[] = []
  const adapter: CameraAdapter = {
    viewport: () => ({ ...viewport }),
    sceneSize: () => ({ ...scene }),
    apply: transform => applied.push({ ...transform }),
    requestFrame: callback => {
      const id = nextFrameId++
      frames.set(id, callback)
      retainedFrames.push(callback)
      return id
    },
    cancelFrame: id => {
      cancelled.push(id)
      frames.delete(id)
    },
    now: () => now
  }

  return {
    adapter,
    applied,
    cancelled,
    retainedFrames,
    setViewport: (next: { width: number; height: number }) => { viewport = { ...next } },
    advanceFrame: (elapsedMs: number) => {
      now = 1000 + elapsedMs
      const pending = [...frames.values()]
      frames.clear()
      for (const callback of pending) callback(now)
    },
    pendingFrames: () => frames.size
  }
}

const closeTo = (actual: number, expected: number, tolerance = 0.001): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} was not within ${tolerance} of ${expected}`)
}

describe('camera controller', () => {
  it('selects viewport presets from orientation, size and coarse-pointer input', () => {
    assert.equal(MAIN_HALL_PRESETS.mobilePortrait.focus, MAIN_HALL_FOCUS)
    assert.equal(MAIN_HALL_PRESETS.desktop.focus, MAIN_HALL_FOCUS)
    assert.equal(selectViewPreset({ width: 390, height: 720 }, true), 'mobilePortrait')
    assert.equal(selectViewPreset({ width: 720, height: 390 }, true), 'mobileLandscape')
    assert.equal(selectViewPreset({ width: 1180, height: 820 }, true), 'tabletLandscape')
    assert.equal(selectViewPreset({ width: 899, height: 500 }, true), 'mobileLandscape')
    assert.equal(selectViewPreset({ width: 900, height: 500 }, true), 'tabletLandscape')
    assert.equal(selectViewPreset({ width: 500, height: 500 }, true), 'mobilePortrait')
    assert.equal(selectViewPreset({ width: Number.NaN, height: -1 }, true), 'mobilePortrait')
    assert.equal(selectViewPreset({ width: 390, height: 720 }, false), 'desktop')
    assert.equal(selectViewPreset({ width: 1440, height: 900 }, false), 'desktop')
  })

  it('freezes exported focus and preset configuration at runtime', () => {
    assert.equal(Object.isFrozen(MAIN_HALL_FOCUS), true)
    assert.equal(Object.isFrozen(VIEW_PRESETS), true)
    assert.equal(Object.isFrozen(VIEW_PRESETS.mobilePortrait), true)
    assert.equal(Object.isFrozen(MAIN_HALL_PRESETS), true)
    assert.equal(Object.isFrozen(MAIN_HALL_PRESETS.desktop), true)
    try {
      (VIEW_PRESETS.mobilePortrait as { zoom: number }).zoom = 9
    } catch (error) {
      assert.ok(error instanceof TypeError)
    }
    assert.equal(VIEW_PRESETS.mobilePortrait.zoom, 1.25)
  })

  it('applies the selected initial preset focus and zoom through clamping', () => {
    const fake = createAdapter()
    const controller = createCameraController(fake.adapter, { minZoom: 0.5, maxZoom: 3.3 }, true)
    const snapshot = controller.snapshot()

    assert.equal(snapshot.presetKey, 'mobilePortrait')
    assert.equal(snapshot.presetId, VIEW_PRESETS.mobilePortrait.id)
    assert.equal(snapshot.transform.zoom, VIEW_PRESETS.mobilePortrait.zoom)
    assert.deepEqual(
      screenToWorld({ x: 195, y: 360 }, snapshot.transform, { width: 390, height: 720 }),
      MAIN_HALL_FOCUS
    )
    assert.deepEqual(fake.applied, [snapshot.transform])
  })

  it('clamps pan and factor-based zoom while preserving the zoom focal point', () => {
    const fake = createAdapter({ width: 400, height: 300 }, { width: 1000, height: 800 })
    const controller = createCameraController(fake.adapter, { minZoom: 0.5, maxZoom: 2 }, false)
    const point = { x: 120, y: 90 }
    const beforeWorld = screenToWorld(point, controller.snapshot().transform, fake.adapter.viewport())

    const zoomed = controller.zoomAt(point, 2)
    const afterWorld = screenToWorld(point, zoomed, fake.adapter.viewport())
    closeTo(zoomed.zoom, VIEW_PRESETS.desktop.zoom * 2)
    closeTo(afterWorld.x, beforeWorld.x, 2)
    closeTo(afterWorld.y, beforeWorld.y, 2)

    const panned = controller.panBy(99999, -99999)
    assert.ok(panned.offsetX < 99999)
    assert.ok(panned.offsetY > -99999)
    assert.deepEqual(fake.applied.at(-1), panned)
  })

  it('uses the active preset zoom as the minimum without reversing bounds above 3.3', () => {
    const desktop = createAdapter({ width: 100, height: 100 }, { width: 5000, height: 5000 })
    const desktopController = createCameraController(desktop.adapter, { minZoom: 0.2, maxZoom: 9 }, false)
    assert.equal(desktopController.zoomAt({ x: 50, y: 50 }, 0.01).zoom, VIEW_PRESETS.desktop.zoom)

    desktopController.resetTo('mobilePortrait', 150)
    desktop.advanceFrame(150)
    assert.equal(desktopController.zoomAt({ x: 50, y: 50 }, 0.01).zoom, VIEW_PRESETS.mobilePortrait.zoom)

    const capped = createAdapter({ width: 100, height: 100 }, { width: 5000, height: 5000 })
    const cappedController = createCameraController(capped.adapter, { minZoom: 9, maxZoom: 9 }, false)
    assert.equal(cappedController.snapshot().transform.zoom, 3.3)
    assert.equal(cappedController.zoomAt({ x: 50, y: 50 }, 0.01).zoom, 3.3)
  })

  it('ignores zero, negative and non-finite zoom factors without applying', () => {
    const fake = createAdapter()
    const controller = createCameraController(fake.adapter, { minZoom: 0.5, maxZoom: 3.3 }, true)

    for (const factor of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const before = controller.snapshot().transform
      const applyCount = fake.applied.length
      assert.deepEqual(controller.zoomAt({ x: 100, y: 100 }, factor), before)
      assert.deepEqual(controller.snapshot().transform, before)
      assert.equal(fake.applied.length, applyCount)
    }
  })

  it('leaves the transform and active reset untouched for keyboard resize', () => {
    const fake = createAdapter()
    const controller = createCameraController(fake.adapter, { minZoom: 0.5, maxZoom: 3.3 }, true)
    controller.resetTo('desktop')
    const before = controller.snapshot()
    const applyCount = fake.applied.length

    const result = controller.resize({ width: 390, height: 430 }, 'keyboard')

    assert.deepEqual(result, before.transform)
    assert.deepEqual(controller.snapshot(), before)
    assert.equal(fake.applied.length, applyCount)
  })

  it('preserves center world focus and zoom while selecting the new resize preset', () => {
    for (const { kind, viewport, expectedPreset } of [
      { kind: 'orientation', viewport: { width: 720, height: 390 }, expectedPreset: 'mobileLandscape' },
      { kind: 'layout', viewport: { width: 1180, height: 820 }, expectedPreset: 'tabletLandscape' }
    ] as const) {
      const fake = createAdapter()
      const controller = createCameraController(fake.adapter, { minZoom: 0.5, maxZoom: 3.3 }, true)
      controller.panBy(-80, 20)
      const before = controller.snapshot().transform
      const oldCenter = screenToWorld({ x: 195, y: 360 }, before, { width: 390, height: 720 })
      fake.setViewport(viewport)

      const after = controller.resize(viewport, kind)

      assert.equal(after.zoom, before.zoom)
      assert.deepEqual(
        screenToWorld({ x: viewport.width / 2, y: viewport.height / 2 }, after, viewport),
        oldCenter
      )
      assert.equal(controller.snapshot().presetKey, expectedPreset)
      assert.notEqual(after.zoom, VIEW_PRESETS[expectedPreset].zoom)
      assert.equal(
        controller.zoomAt({ x: viewport.width / 2, y: viewport.height / 2 }, 0.01).zoom,
        VIEW_PRESETS[expectedPreset].zoom
      )
    }
  })

  it('animates reset with ease-out progress and completes at the requested duration', () => {
    const viewport = { width: 390, height: 300 }
    const fake = createAdapter(viewport, { width: 5000, height: 5000 })
    const controller = createCameraController(fake.adapter, { minZoom: 0.5, maxZoom: 3.3 }, true)
    controller.panBy(-100, 0)
    const start = controller.snapshot().transform

    controller.resetTo('desktop', 200)
    assert.deepEqual(controller.snapshot().animation, { startedAt: 1000, durationMs: 200 })
    fake.advanceFrame(100)
    const halfway = controller.snapshot().transform
    const target = controller.snapshot().presetKey === 'desktop' ? VIEW_PRESETS.desktop.zoom : -1
    assert.equal(controller.snapshot().presetKey, 'desktop')
    closeTo(halfway.zoom, start.zoom + (target - start.zoom) * 0.75)
    fake.advanceFrame(200)
    assert.equal(controller.snapshot().animation, null)
    assert.equal(controller.snapshot().transform.zoom, VIEW_PRESETS.desktop.zoom)
    assert.deepEqual(controller.snapshot().transform, {
      zoom: VIEW_PRESETS.desktop.zoom,
      offsetX: -535.08,
      offsetY: -201.6
    })
    assert.deepEqual(
      screenToWorld({ x: 195, y: 150 }, controller.snapshot().transform, viewport),
      MAIN_HALL_FOCUS
    )
    assert.equal(fake.pendingFrames(), 0)
  })

  it('ignores a retained cancelled reset callback after a newer reset starts', () => {
    const fake = createAdapter()
    const controller = createCameraController(fake.adapter, { minZoom: 0.5, maxZoom: 3.3 }, true)
    controller.panBy(-100, 0)
    controller.resetTo('desktop', 200)
    const staleCallback = fake.retainedFrames.at(-1)!

    controller.resetTo('mobileLandscape', 200)
    const beforeStale = controller.snapshot()
    const applyCount = fake.applied.length
    const pendingCount = fake.pendingFrames()
    staleCallback(1100)

    assert.deepEqual(controller.snapshot(), beforeStale)
    assert.equal(fake.applied.length, applyCount)
    assert.equal(fake.pendingFrames(), pendingCount)
    fake.advanceFrame(200)
    assert.equal(controller.snapshot().presetKey, 'mobileLandscape')
    assert.equal(controller.snapshot().animation, null)
  })

  it('smoothly resets from desktop zoom to the higher mobile portrait minimum', () => {
    const viewport = { width: 390, height: 720 }
    const fake = createAdapter(viewport, { width: 5000, height: 5000 })
    const controller = createCameraController(fake.adapter, { minZoom: 0.5, maxZoom: 3.3 }, true)
    controller.resetTo('desktop', 150)
    fake.advanceFrame(150)
    const startZoom = controller.snapshot().transform.zoom
    assert.equal(startZoom, VIEW_PRESETS.desktop.zoom)

    controller.resetTo('mobilePortrait', 200)
    fake.advanceFrame(250)
    const midpointZoom = controller.snapshot().transform.zoom

    assert.ok(midpointZoom > startZoom)
    assert.ok(midpointZoom < VIEW_PRESETS.mobilePortrait.zoom)
    fake.advanceFrame(350)
    assert.equal(controller.snapshot().transform.zoom, VIEW_PRESETS.mobilePortrait.zoom)
  })

  it('preserves desktop zoom and center focus when resizing to mobile portrait', () => {
    const landscape = { width: 720, height: 390 }
    const portrait = { width: 390, height: 720 }
    const fake = createAdapter(landscape, { width: 5000, height: 5000 })
    const controller = createCameraController(fake.adapter, { minZoom: 0.5, maxZoom: 3.3 }, true)
    controller.resetTo('desktop', 150)
    fake.advanceFrame(150)
    controller.panBy(-40, -120)
    const before = controller.snapshot().transform
    const oldCenter = screenToWorld({ x: 360, y: 195 }, before, landscape)
    fake.setViewport(portrait)

    const after = controller.resize(portrait, 'orientation')

    assert.equal(controller.snapshot().presetKey, 'mobilePortrait')
    assert.equal(after.zoom, before.zoom)
    assert.deepEqual(screenToWorld({ x: 195, y: 360 }, after, portrait), oldCenter)
    assert.equal(controller.panBy(1, 0).zoom, before.zoom)
  })

  it('preserves zoom through reverse resize and restores the active minimum after reset', () => {
    const landscape = { width: 720, height: 390 }
    const portrait = { width: 390, height: 720 }
    const fake = createAdapter(landscape, { width: 5000, height: 5000 })
    const controller = createCameraController(fake.adapter, { minZoom: 0.5, maxZoom: 3.3 }, true)
    controller.resetTo('desktop', 150)
    fake.advanceFrame(150)
    fake.setViewport(portrait)
    controller.resize(portrait, 'orientation')
    fake.setViewport(landscape)

    const reversed = controller.resize(landscape, 'orientation')

    assert.equal(controller.snapshot().presetKey, 'mobileLandscape')
    assert.equal(reversed.zoom, VIEW_PRESETS.desktop.zoom)
    controller.resetTo('mobileLandscape', 150)
    fake.advanceFrame(300)
    assert.equal(controller.snapshot().transform.zoom, VIEW_PRESETS.mobileLandscape.zoom)
    assert.equal(controller.zoomAt({ x: 360, y: 195 }, 0.01).zoom, VIEW_PRESETS.mobileLandscape.zoom)
  })

  it('normalizes reset durations outside 150-250ms to 200ms', () => {
    for (const duration of [149, 251, Number.NaN]) {
      const fake = createAdapter()
      const controller = createCameraController(fake.adapter, { minZoom: 0.5, maxZoom: 3.3 }, true)
      controller.resetTo('desktop', duration)
      assert.equal(controller.snapshot().animation?.durationMs, 200)
    }
  })

  it('cancels reset immediately on user gesture and retains the last applied transform', () => {
    const fake = createAdapter()
    const controller = createCameraController(fake.adapter, { minZoom: 0.5, maxZoom: 3.3 }, true)
    controller.panBy(-100, 0)
    controller.resetTo('desktop', 200)
    fake.advanceFrame(80)
    const lastApplied = { ...fake.applied.at(-1)! }

    controller.beginUserGesture()

    assert.equal(controller.snapshot().animation, null)
    assert.deepEqual(controller.snapshot().transform, lastApplied)
    assert.equal(fake.cancelled.length, 1)
    assert.equal(fake.pendingFrames(), 0)
  })

  it('uses strict away-from-preset thresholds at 48 world pixels and 0.08 zoom', () => {
    const fake = createAdapter({ width: 390, height: 720 }, { width: 5000, height: 5000 })
    const controller = createCameraController(fake.adapter, { minZoom: 0.5, maxZoom: 3.3 }, true)

    controller.panBy(-48 * VIEW_PRESETS.mobilePortrait.zoom, 0)
    assert.equal(controller.isAwayFromPreset(), false)
    controller.panBy(-0.01, 0)
    assert.equal(controller.isAwayFromPreset(), true)

    controller.resetTo('mobilePortrait', 150)
    fake.advanceFrame(150)
    controller.zoomAt({ x: 195, y: 360 }, (VIEW_PRESETS.mobilePortrait.zoom + 0.08) / VIEW_PRESETS.mobilePortrait.zoom)
    assert.equal(controller.isAwayFromPreset(), false)
    controller.zoomAt({ x: 195, y: 360 }, (VIEW_PRESETS.mobilePortrait.zoom + 0.081) / (VIEW_PRESETS.mobilePortrait.zoom + 0.08))
    assert.equal(controller.isAwayFromPreset(), true)
  })

  it('compares away state with the actual clamped preset transform on a constrained scene', () => {
    const viewport = { width: 400, height: 300 }
    const fake = createAdapter(viewport, { width: 100, height: 100 })
    const controller = createCameraController(fake.adapter, { minZoom: 0.5, maxZoom: 2 }, false)
    controller.panBy(20, -20)

    controller.resetTo('desktop', 150)
    fake.advanceFrame(150)

    const transform = controller.snapshot().transform
    assert.deepEqual(transform, { zoom: 2, offsetX: 300, offsetY: 200 })
    assert.deepEqual(screenToWorld({ x: 200, y: 150 }, transform, viewport), { x: 50, y: 50 })
    assert.equal(controller.isAwayFromPreset(), false)
  })

  it('returns immutable snapshot copies and cleans up pending animation frames', () => {
    const fake = createAdapter()
    const controller = createCameraController(fake.adapter, { minZoom: 0.5, maxZoom: 3.3 }, true)
    controller.resetTo('desktop')
    const snapshot = controller.snapshot()
    snapshot.transform.offsetX = 999
    if (snapshot.animation) snapshot.animation.durationMs = 999

    assert.notEqual(controller.snapshot().transform.offsetX, 999)
    assert.equal(controller.snapshot().animation?.durationMs, 200)
    const applyCount = fake.applied.length
    controller.cleanup()
    assert.equal(controller.snapshot().animation, null)
    assert.equal(fake.pendingFrames(), 0)
    fake.advanceFrame(200)
    assert.equal(fake.applied.length, applyCount)
  })

  it('makes cleanup terminal for every later controller mutation', () => {
    const fake = createAdapter()
    const controller = createCameraController(fake.adapter, { minZoom: 0.5, maxZoom: 3.3 }, true)
    const before = controller.snapshot()
    controller.cleanup()
    const applyCount = fake.applied.length
    const frameCount = fake.retainedFrames.length

    assert.deepEqual(controller.panBy(10, 10), before.transform)
    assert.deepEqual(controller.zoomAt({ x: 10, y: 10 }, 2), before.transform)
    assert.deepEqual(controller.resize({ width: 720, height: 390 }, 'orientation'), before.transform)
    controller.resetTo('desktop')
    controller.beginUserGesture()

    assert.deepEqual(controller.snapshot(), { ...before, animation: null })
    assert.equal(fake.applied.length, applyCount)
    assert.equal(fake.retainedFrames.length, frameCount)
  })

  it('normalizes non-positive viewport dimensions to zero on initialization and resize', () => {
    const fake = createAdapter({ width: -390, height: Number.POSITIVE_INFINITY })
    const controller = createCameraController(fake.adapter, { minZoom: 0.5, maxZoom: 3.3 }, true)
    assert.deepEqual(controller.snapshot().transform, { zoom: 1.25, offsetX: 0, offsetY: 0 })

    const resized = controller.resize({ width: Number.NaN, height: -20 }, 'layout')
    assert.deepEqual(resized, { zoom: 1.25, offsetX: 0, offsetY: 0 })
    assert.equal(controller.snapshot().presetKey, 'mobilePortrait')
  })

  it('normalizes invalid adapter dimensions, time and frame identifiers deterministically', () => {
    const applied: Array<{ zoom: number; offsetX: number; offsetY: number }> = []
    const adapter: CameraAdapter = {
      viewport: () => ({ width: Number.NaN, height: -1 }),
      sceneSize: () => ({ width: Number.POSITIVE_INFINITY, height: 0 }),
      apply: transform => applied.push({ ...transform }),
      requestFrame: () => Number.NaN,
      cancelFrame: () => undefined,
      now: () => Number.NaN
    }
    const controller = createCameraController(adapter, { minZoom: Number.NaN, maxZoom: -2 }, true)

    assert.deepEqual(controller.snapshot().transform, { zoom: 1.25, offsetX: 0, offsetY: 0 })
    assert.doesNotThrow(() => controller.resetTo('desktop'))
    assert.deepEqual(applied.at(-1), { zoom: 1.25, offsetX: 0, offsetY: 0 })
    assert.doesNotThrow(() => controller.beginUserGesture())
  })
})
