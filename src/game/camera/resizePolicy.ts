import type { Viewport } from './cameraTransform.js'

export type ViewportResizeKind = 'keyboard' | 'orientation' | 'layout'

export type ViewportResize = {
  previous: Viewport
  next: Viewport
  previousVisualHeight: number
  nextVisualHeight: number
  editableFocused: boolean
}

const finiteDimension = (value: number): number | null =>
  Number.isFinite(value) && value > 0 ? value : null

const orientation = (viewport: Viewport): 'portrait' | 'landscape' | null => {
  const width = finiteDimension(viewport.width)
  const height = finiteDimension(viewport.height)
  if (width === null || height === null || width === height) return null
  return width > height ? 'landscape' : 'portrait'
}

export const classifyViewportResize = (resize: ViewportResize): ViewportResizeKind => {
  const oldWidth = finiteDimension(resize.previous.width)
  const newWidth = finiteDimension(resize.next.width)
  const oldVisualHeight = finiteDimension(resize.previousVisualHeight)
  const newVisualHeight = finiteDimension(resize.nextVisualHeight)

  const isKeyboard = resize.editableFocused &&
    oldWidth !== null &&
    newWidth !== null &&
    oldVisualHeight !== null &&
    newVisualHeight !== null &&
    Math.abs(newWidth - oldWidth) <= 2 &&
    Math.abs(newVisualHeight - oldVisualHeight) >= 120

  if (isKeyboard) return 'keyboard'

  const previousOrientation = orientation(resize.previous)
  const nextOrientation = orientation(resize.next)
  if (previousOrientation !== null && nextOrientation !== null && previousOrientation !== nextOrientation) {
    return 'orientation'
  }

  return 'layout'
}
