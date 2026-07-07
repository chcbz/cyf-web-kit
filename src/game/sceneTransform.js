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

export const scenePanBounds = ({
  viewportWidth,
  viewportHeight,
  containerWidth,
  containerHeight,
  zoom
}) => {
  const zoomX = Math.max(0, (viewportWidth * (zoom - 1)) / 2)
  const zoomY = Math.max(0, (viewportHeight * (zoom - 1)) / 2)
  let coverX = 0
  let coverY = 0

  if (
    Number.isFinite(containerWidth) &&
    Number.isFinite(containerHeight) &&
    containerWidth > 0 &&
    containerHeight > 0 &&
    viewportWidth > 0 &&
    viewportHeight > 0
  ) {
    const coverScale = Math.max(containerWidth / viewportWidth, containerHeight / viewportHeight)
    const visibleWidth = containerWidth / coverScale
    const visibleHeight = containerHeight / coverScale
    coverX = Math.max(0, (viewportWidth - visibleWidth) / 2)
    coverY = Math.max(0, (viewportHeight - visibleHeight) / 2)
  }

  return {
    x: Number((zoomX + coverX).toFixed(3)),
    y: Number((zoomY + coverY).toFixed(3))
  }
}

export const clampSceneTransform = (transform, bounds) => {
  const zoom = Number(clamp(transform.zoom, bounds.minZoom, bounds.maxZoom).toFixed(2))
  const pan = scenePanBounds({
    viewportWidth: bounds.viewportWidth,
    viewportHeight: bounds.viewportHeight,
    containerWidth: bounds.containerWidth,
    containerHeight: bounds.containerHeight,
    zoom
  })
  return {
    offsetX: clamp(transform.offsetX, -pan.x, pan.x),
    offsetY: clamp(transform.offsetY, -pan.y, pan.y),
    zoom
  }
}

export const fitSceneTransform = ({
  viewportWidth,
  viewportHeight,
  sceneWidth,
  sceneHeight,
  minZoom,
  maxZoom
}) => {
  if (!viewportWidth || !viewportHeight || !sceneWidth || !sceneHeight) {
    return { offsetX: 0, offsetY: 0, zoom: 1 }
  }
  const rawZoom = Math.min(viewportWidth / sceneWidth, viewportHeight / sceneHeight)
  return {
    offsetX: 0,
    offsetY: 0,
    zoom: Number(clamp(rawZoom, Math.min(minZoom, rawZoom), maxZoom).toFixed(2))
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
  y: Number(((y - viewportHeight / 2 - offsetY) / zoom + viewportHeight / 2).toFixed(3))
})
