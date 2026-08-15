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

export interface ViewportQuad {
  p1?: ViewportPoint
  p2?: ViewportPoint
  p4?: ViewportPoint
}

export function quadToViewport(
  clientX: number,
  clientY: number,
  quad?: ViewportQuad,
  viewport?: ViewportSize,
): ViewportPoint | null
export function localToViewport(
  localX: number,
  localY: number,
  displaySize?: ViewportSize,
  viewport?: ViewportSize,
): ViewportPoint | null
export function clockwiseRectToViewport(
  clientX: number,
  clientY: number,
  displayRect?: DisplayRect,
  viewport?: ViewportSize,
): ViewportPoint | null

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
