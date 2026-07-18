const finitePositive = value => (Number.isFinite(value) && value > 0 ? value : 0)

const normalizeDisplayRect = (rect = {}) => ({
  left: Number.isFinite(rect.left) ? rect.left : 0,
  top: Number.isFinite(rect.top) ? rect.top : 0,
  width: finitePositive(rect.width),
  height: finitePositive(rect.height)
})

const normalizeViewport = (viewport = {}) => ({
  width: finitePositive(viewport.width),
  height: finitePositive(viewport.height)
})

export const createViewportTransform = (displayRect, viewport) => {
  const display = normalizeDisplayRect(displayRect)
  const targetViewport = normalizeViewport(viewport)
  if (!display.width || !display.height || !targetViewport.width || !targetViewport.height) {
    return { scale: 1, offsetX: 0, offsetY: 0 }
  }

  const scale = Math.max(display.width / targetViewport.width, display.height / targetViewport.height)
  return {
    scale,
    offsetX: (display.width - targetViewport.width * scale) / 2,
    offsetY: (display.height - targetViewport.height * scale) / 2
  }
}

export const clientToViewport = (clientX, clientY, displayRect, viewport) => {
  const display = normalizeDisplayRect(displayRect)
  const transform = createViewportTransform(display, viewport)
  return {
    x: (clientX - display.left - transform.offsetX) / transform.scale,
    y: (clientY - display.top - transform.offsetY) / transform.scale
  }
}

export const viewportToClient = (viewportX, viewportY, displayRect, viewport) => {
  const display = normalizeDisplayRect(displayRect)
  const transform = createViewportTransform(display, viewport)
  return {
    x: display.left + transform.offsetX + viewportX * transform.scale,
    y: display.top + transform.offsetY + viewportY * transform.scale
  }
}
