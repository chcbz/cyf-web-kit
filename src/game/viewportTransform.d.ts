export interface DisplayRect {
  left?: number
  top?: number
  width?: number
  height?: number
}

export interface ViewportSize {
  width?: number
  height?: number
}

export interface ViewportTransform {
  scale: number
  offsetX: number
  offsetY: number
}

export interface ViewportPoint {
  x: number
  y: number
}

export function createViewportTransform(displayRect?: DisplayRect, viewport?: ViewportSize): ViewportTransform
export function clientToViewport(
  clientX: number,
  clientY: number,
  displayRect?: DisplayRect,
  viewport?: ViewportSize,
): ViewportPoint
export function viewportToClient(
  viewportX: number,
  viewportY: number,
  displayRect?: DisplayRect,
  viewport?: ViewportSize,
): ViewportPoint
