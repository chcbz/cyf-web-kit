const isPositiveFinite = value => Number.isFinite(value) && value > 0

const unavailableContainTransform = () => Object.freeze({
  offsetX: null,
  offsetY: null,
  ready: false,
  scale: null
})

/**
 * Calculates the camera transform for a complete, uncropped world preview.
 * `offsetX` and `offsetY` are for `screen = world * scale + offset`, so a
 * world whose origin is not (0, 0) remains centered rather than being clipped.
 */
export const calculateContainTransform = (worldBounds, viewport) => {
  const worldX = worldBounds?.x
  const worldY = worldBounds?.y
  const worldWidth = worldBounds?.width
  const worldHeight = worldBounds?.height
  const viewportWidth = viewport?.width
  const viewportHeight = viewport?.height

  if (
    !Number.isFinite(worldX) ||
    !Number.isFinite(worldY) ||
    !isPositiveFinite(worldWidth) ||
    !isPositiveFinite(worldHeight) ||
    !isPositiveFinite(viewportWidth) ||
    !isPositiveFinite(viewportHeight)
  ) return unavailableContainTransform()

  const scale = Math.min(viewportWidth / worldWidth, viewportHeight / worldHeight)
  const worldCenterX = worldX + worldWidth / 2
  const worldCenterY = worldY + worldHeight / 2
  const offsetX = viewportWidth / 2 - worldCenterX * scale
  const offsetY = viewportHeight / 2 - worldCenterY * scale

  if (!isPositiveFinite(scale) || ![offsetX, offsetY].every(Number.isFinite)) return unavailableContainTransform()

  return Object.freeze({ offsetX, offsetY, ready: true, scale })
}

/**
 * Produces rendering intent only. The page-level single-scene host owns the
 * actual run loop, input locks, and lifecycle effects.
 */
export const resolveLiveMapPreviewActivation = ({
  documentHidden = false,
  landscapeActive = false,
  overlayCovered = false,
  portraitOffscreen = false,
  ready = false
} = {}) => {
  if (!ready) return Object.freeze({ reason: 'not-ready', shouldRender: false, state: 'loading', targetFps: 0 })
  if (documentHidden) return Object.freeze({ reason: 'document-hidden', shouldRender: false, state: 'paused', targetFps: 0 })
  if (overlayCovered) return Object.freeze({ reason: 'overlay-covered', shouldRender: false, state: 'paused', targetFps: 0 })

  // Portrait visibility is not relevant after the same scene has moved to the
  // landscape host; it must not accidentally pause that visible host.
  if (landscapeActive) return Object.freeze({ reason: 'landscape-active', shouldRender: true, state: 'ready', targetFps: null })
  if (portraitOffscreen) return Object.freeze({ reason: 'portrait-offscreen', shouldRender: false, state: 'paused', targetFps: 0 })

  return Object.freeze({ reason: 'portrait-visible', shouldRender: true, state: 'ready', targetFps: 20 })
}
