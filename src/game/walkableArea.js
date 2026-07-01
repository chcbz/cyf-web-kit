const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const normalisePoint = (point = {}) => ({
  x: clamp(Number(point.x) || 0, 0, 100),
  y: clamp(Number(point.y) || 0, 0, 100)
})

const regionPolygon = (region = {}) => {
  region = region || {}
  if (Array.isArray(region.walkable) && region.walkable.length >= 3) {
    return region.walkable.map(normalisePoint)
  }

  const bounds = region.bounds || { x1: 0, y1: 0, x2: 100, y2: 100 }
  return [
    { x: bounds.x1, y: bounds.y1 },
    { x: bounds.x2, y: bounds.y1 },
    { x: bounds.x2, y: bounds.y2 },
    { x: bounds.x1, y: bounds.y2 }
  ].map(normalisePoint)
}

export const isPointInPolygon = (point, polygon = []) => {
  const p = normalisePoint(point)
  let inside = false

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = normalisePoint(polygon[i])
    const b = normalisePoint(polygon[j])
    const cross = (p.y - a.y) * (b.x - a.x) - (p.x - a.x) * (b.y - a.y)
    const withinSegment = p.x >= Math.min(a.x, b.x) - 0.001 &&
      p.x <= Math.max(a.x, b.x) + 0.001 &&
      p.y >= Math.min(a.y, b.y) - 0.001 &&
      p.y <= Math.max(a.y, b.y) + 0.001
    if (Math.abs(cross) < 0.001 && withinSegment) return true
    const crosses = (a.y > p.y) !== (b.y > p.y)
    if (crosses) {
      const xAtY = ((b.x - a.x) * (p.y - a.y)) / ((b.y - a.y) || 1) + a.x
      if (p.x < xAtY) inside = !inside
    }
  }

  return inside
}

const closestPointOnSegment = (point, a, b) => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq <= 0) return { ...a }
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq, 0, 1)
  return {
    x: a.x + dx * t,
    y: a.y + dy * t
  }
}

export const clampPointToRegion = (point, region = {}) => {
  region = region || {}
  const p = normalisePoint(point)
  const polygon = regionPolygon(region)
  if (polygon.length < 3 || isPointInPolygon(p, polygon)) return p

  let closest = polygon[0]
  let closestDistance = Infinity
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    const candidate = closestPointOnSegment(p, a, b)
    const distance = Math.hypot(candidate.x - p.x, candidate.y - p.y)
    if (distance < closestDistance) {
      closest = candidate
      closestDistance = distance
    }
  }

  return {
    x: Number(closest.x.toFixed(3)),
    y: Number(closest.y.toFixed(3))
  }
}

export const clampPointToAnyRegion = (point, regions = []) => {
  const p = normalisePoint(point)
  const regionList = Array.isArray(regions) ? regions : Object.values(regions || {})
  if (!regionList.length) return p

  const containing = regionList.find(region => isPointInPolygon(p, regionPolygon(region)))
  if (containing) return p

  return regionList
    .map(region => clampPointToRegion(p, region))
    .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0]
}
