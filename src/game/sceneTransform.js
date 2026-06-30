export const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export const percentRectToViewport = (rect, viewport) => {
  const width = (rect.w / 100) * viewport.width
  const height = (rect.h / 100) * viewport.height
  const centerX = (rect.x / 100) * viewport.width
  const centerY = (rect.y / 100) * viewport.height
  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
    centerX,
    centerY
  }
}

export const scenePanBounds = ({ viewportWidth, viewportHeight, zoom }) => ({
  x: zoom > 1 ? viewportWidth : 0,
  y: zoom > 1 ? viewportHeight : 0
})

export const clampSceneTransform = (transform, bounds) => {
  const zoom = Number(clamp(transform.zoom, bounds.minZoom, bounds.maxZoom).toFixed(2))
  const pan = scenePanBounds({
    viewportWidth: bounds.viewportWidth,
    viewportHeight: bounds.viewportHeight,
    zoom
  })
  const requestedZoomWasClamped = transform.zoom !== zoom
  return {
    offsetX: requestedZoomWasClamped ? Math.sign(transform.offsetX || 0) * pan.x : clamp(transform.offsetX, -pan.x, pan.x),
    offsetY: requestedZoomWasClamped ? Math.sign(transform.offsetY || 0) * pan.y : clamp(transform.offsetY, -pan.y, pan.y),
    zoom
  }
}

export const screenToWorldPoint = ({
  x,
  y,
  viewportWidth,
  viewportHeight,
  offsetX,
  offsetY,
  zoom
}) => ({
  x: Number(((x - viewportWidth / 2 - offsetX) / zoom + viewportWidth / 2).toFixed(3)),
  y: Number(((y - viewportHeight / 2 - offsetY * 2) / zoom + viewportHeight / 2).toFixed(3))
})
