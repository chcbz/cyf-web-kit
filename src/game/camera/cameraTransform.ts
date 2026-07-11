export type Point = { x: number; y: number }
export type Viewport = { width: number; height: number }
export type CameraTransform = { zoom: number; offsetX: number; offsetY: number }

export type CameraBounds = {
  minZoom: number
  maxZoom: number
  roundingTolerance?: number
}

const DEFAULT_ZOOM = 1
const DEFAULT_ROUNDING_TOLERANCE = 2
const ROUNDING_DIGITS = 3

const finiteOr = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback

const positiveOr = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? value : fallback

const dimension = (value: number): number =>
  Number.isFinite(value) && value > 0 ? value : 0

const round = (value: number): number =>
  Number(value.toFixed(ROUNDING_DIGITS))

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value))

export const clampZoom = (zoom: number, minZoom: number, maxZoom: number): number => {
  const first = positiveOr(minZoom, DEFAULT_ZOOM)
  const second = positiveOr(maxZoom, first)
  const minimum = Math.min(first, second)
  const maximum = Math.max(first, second)
  return round(clamp(finiteOr(zoom, minimum), minimum, maximum))
}

export const screenToWorld = (point: Point, transform: CameraTransform, viewport: Viewport): Point => {
  const width = dimension(viewport.width)
  const height = dimension(viewport.height)
  const zoom = positiveOr(transform.zoom, DEFAULT_ZOOM)
  const offsetX = finiteOr(transform.offsetX, 0)
  const offsetY = finiteOr(transform.offsetY, 0)

  return {
    x: round((finiteOr(point.x, 0) - width / 2 - offsetX) / zoom + width / 2),
    y: round((finiteOr(point.y, 0) - height / 2 - offsetY) / zoom + height / 2)
  }
}

export const transformForFocus = (
  world: Point,
  screen: Point,
  zoom: number,
  viewport: Viewport
): CameraTransform => {
  const width = dimension(viewport.width)
  const height = dimension(viewport.height)
  const safeZoom = positiveOr(zoom, DEFAULT_ZOOM)

  return {
    zoom: round(safeZoom),
    offsetX: round(finiteOr(screen.x, 0) - width / 2 - (finiteOr(world.x, 0) - width / 2) * safeZoom),
    offsetY: round(finiteOr(screen.y, 0) - height / 2 - (finiteOr(world.y, 0) - height / 2) * safeZoom)
  }
}

export const zoomAt = (
  transform: CameraTransform,
  screen: Point,
  zoom: number,
  viewport: Viewport,
  bounds: CameraBounds
): CameraTransform => transformForFocus(
  screenToWorld(screen, transform, viewport),
  screen,
  clampZoom(zoom, bounds.minZoom, bounds.maxZoom),
  viewport
)

export const preserveFocus = (
  transform: CameraTransform,
  oldViewport: Viewport,
  newViewport: Viewport
): CameraTransform => transformForFocus(
  screenToWorld(
    { x: dimension(oldViewport.width) / 2, y: dimension(oldViewport.height) / 2 },
    transform,
    oldViewport
  ),
  { x: dimension(newViewport.width) / 2, y: dimension(newViewport.height) / 2 },
  positiveOr(transform.zoom, DEFAULT_ZOOM),
  newViewport
)

const clampOffsetAxis = (
  offset: number,
  viewportSize: number,
  sceneSize: number,
  zoom: number,
  tolerance: number
): number => {
  if (viewportSize === 0 || sceneSize === 0) return 0

  const scaledSceneSize = sceneSize * zoom
  const scaleOriginShift = viewportSize / 2 * (1 - zoom)

  if (scaledSceneSize <= viewportSize - tolerance * 2) {
    return round((viewportSize - scaledSceneSize) / 2 - scaleOriginShift)
  }

  const minimum = viewportSize - tolerance - scaleOriginShift - scaledSceneSize
  const maximum = tolerance - scaleOriginShift
  return round(clamp(finiteOr(offset, 0), minimum, maximum))
}

export const clampTransform = (
  transform: CameraTransform,
  viewport: Viewport,
  scene: Viewport,
  bounds: CameraBounds
): CameraTransform => {
  const width = dimension(viewport.width)
  const height = dimension(viewport.height)
  const sceneWidth = dimension(scene.width)
  const sceneHeight = dimension(scene.height)
  const configuredMinimum = clampZoom(bounds.minZoom, bounds.minZoom, bounds.maxZoom)
  const configuredMaximum = clampZoom(bounds.maxZoom, bounds.minZoom, bounds.maxZoom)
  const coverZoom = sceneWidth > 0 && sceneHeight > 0
    ? Math.max(width / sceneWidth, height / sceneHeight)
    : configuredMinimum
  const effectiveMinimum = Math.min(configuredMaximum, Math.max(configuredMinimum, coverZoom))
  const zoom = clampZoom(transform.zoom, effectiveMinimum, configuredMaximum)
  const tolerance = clamp(
    finiteOr(bounds.roundingTolerance ?? DEFAULT_ROUNDING_TOLERANCE, DEFAULT_ROUNDING_TOLERANCE),
    0,
    DEFAULT_ROUNDING_TOLERANCE
  )

  return {
    zoom,
    offsetX: clampOffsetAxis(transform.offsetX, width, sceneWidth, zoom, tolerance),
    offsetY: clampOffsetAxis(transform.offsetY, height, sceneHeight, zoom, tolerance)
  }
}
