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

const quadPoint = (point = {}) => ({
  x: Number.isFinite(point.x) ? point.x : Number.isFinite(point.left) ? point.left : 0,
  y: Number.isFinite(point.y) ? point.y : Number.isFinite(point.top) ? point.top : 0
})

export const quadToViewport = (clientX, clientY, quad = {}, viewport = {}) => {
  const targetViewport = normalizeViewport(viewport)
  const origin = quadPoint(quad.p1)
  const xCorner = quadPoint(quad.p2)
  const yCorner = quadPoint(quad.p4)
  const axisX = { x: xCorner.x - origin.x, y: xCorner.y - origin.y }
  const axisY = { x: yCorner.x - origin.x, y: yCorner.y - origin.y }
  const determinant = axisX.x * axisY.y - axisX.y * axisY.x
  if (!targetViewport.width || !targetViewport.height || !Number.isFinite(determinant) || Math.abs(determinant) < 1e-8) {
    return null
  }
  const relative = { x: clientX - origin.x, y: clientY - origin.y }
  const localX = (relative.x * axisY.y - relative.y * axisY.x) / determinant
  const localY = (axisX.x * relative.y - axisX.y * relative.x) / determinant
  return {
    x: localX * targetViewport.width,
    y: localY * targetViewport.height
  }
}

export const localToViewport = (localX, localY, displaySize = {}, viewport = {}) => {
  const display = normalizeViewport(displaySize)
  const targetViewport = normalizeViewport(viewport)
  if (!display.width || !display.height || !targetViewport.width || !targetViewport.height) return null
  return {
    x: localX * targetViewport.width / display.width,
    y: localY * targetViewport.height / display.height
  }
}


export const clockwiseRectToViewport = (clientX, clientY, displayRect = {}, viewport = {}) => {
  const display = normalizeDisplayRect(displayRect)
  const targetViewport = normalizeViewport(viewport)
  if (!display.width || !display.height || !targetViewport.width || !targetViewport.height) return null
  return {
    x: (clientY - display.top) * targetViewport.width / display.height,
    y: (display.left + display.width - clientX) * targetViewport.height / display.width
  }
}

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
