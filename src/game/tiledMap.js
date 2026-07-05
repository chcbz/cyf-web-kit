const numberAttr = (node, name, fallback = 0) => {
  const value = Number(node?.getAttribute?.(name))
  return Number.isFinite(value) ? value : fallback
}

const textAttr = (node, name, fallback = '') => node?.getAttribute?.(name) || fallback

const absoluteJuyitingPath = (source = '') => {
  if (!source) return ''
  if (source.startsWith('/')) return source
  return `/juyiting/${source}`.replace(/\/+/g, '/')
}


const computePolygonBounds = (objectNode) => {
  const poly = objectNode.querySelector('polygon')
  if (!poly) return null
  const pointsStr = textAttr(poly, 'points')
  if (!pointsStr) return null
  const coords = pointsStr.split(/\s+/).filter(Boolean).map(p => {
    const [px, py] = p.split(',').map(Number)
    return { x: px, y: py }
  })
  if (!coords.length) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  coords.forEach(({ x, y }) => {
    if (x < minX) minX = x; if (y < minY) minY = y
    if (x > maxX) maxX = x; if (y > maxY) maxY = y
  })
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

const computePolygonBoundsFromData = (object) => {
  const poly = object?.polygon
  if (!poly || !Array.isArray(poly)) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  poly.forEach(({ x, y }) => {
    if (x < minX) minX = x; if (y < minY) minY = y
    if (x > maxX) maxX = x; if (y > maxY) maxY = y
  })
  if (!Number.isFinite(minX)) return null
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

const NAME_TO_PANEL_MAP = {
  'roster-book': 'catalog',
  'agent-roster': 'agents',
  'library-shelf': 'library',
  'bounty-board': 'tasks',
  'main-seat': 'chat'
}

const readProperties = (objectNode) => {
  const properties = {}
  objectNode.querySelectorAll('properties > property').forEach((property) => {
    properties[textAttr(property, 'name')] = textAttr(property, 'value')
  })
  return properties
}

const roundPercent = value => Math.round(value * 1000) / 1000

export const rectToPercent = (rect, space) => ({
  x: roundPercent(((rect.x + rect.width / 2) / space.width) * 100),
  y: roundPercent(((rect.y + rect.height / 2) / space.height) * 100),
  w: roundPercent((rect.width / space.width) * 100),
  h: roundPercent((rect.height / space.height) * 100)
})

const readObjectRect = objectNode => {
  let width = numberAttr(objectNode, 'width')
  let height = numberAttr(objectNode, 'height')
  if (!width && !height) {
    const polyBounds = computePolygonBounds(objectNode)
    if (polyBounds) {
      width = polyBounds.width
      height = polyBounds.height
    }
  }
  return {
    x: numberAttr(objectNode, 'x'),
    y: numberAttr(objectNode, 'y'),
    width,
    height,
    ellipse: Boolean(objectNode.querySelector('ellipse'))
  }
}

const readObjectGroup = (doc, name) => {
  const group = [...doc.querySelectorAll('objectgroup')].find(item => textAttr(item, 'name') === name)
  if (!group) return []
  return [...group.children].filter(child => child.tagName === 'object')
}

const readObjectRectFromData = object => {
  let width = Number(object?.width) || 0
  let height = Number(object?.height) || 0
  if (!width && !height) {
    const polyBounds = computePolygonBoundsFromData(object)
    if (polyBounds) {
      width = polyBounds.width
      height = polyBounds.height
    }
  }
  return {
    x: Number(object?.x) || 0,
    y: Number(object?.y) || 0,
    width,
    height,
    ellipse: Boolean(object?.ellipse)
  }
}

const coordinateSpaceFor = (doc, mapWidth, mapHeight) => {
  const imageSizes = [...doc.querySelectorAll('imagelayer image')]
    .map(image => ({
      width: numberAttr(image, 'width'),
      height: numberAttr(image, 'height')
    }))
    .filter(size => size.width && size.height)

  const objectBounds = [...doc.querySelectorAll('object')].reduce((bounds, objectNode) => {
    const rect = readObjectRect(objectNode)
    return {
      width: Math.max(bounds.width, rect.x + rect.width),
      height: Math.max(bounds.height, rect.y + rect.height)
    }
  }, { width: mapWidth, height: mapHeight })

  return imageSizes.reduce((space, size) => ({
    width: Math.max(space.width, size.width),
    height: Math.max(space.height, size.height)
  }), objectBounds)
}

const coordinateSpaceForData = (map, mapWidth, mapHeight) => {
    const imageSizes = (map.layers || [])
      .filter(layer => layer.type === 'imagelayer')
      .map(layer => {
        const w = Number(layer.width || layer.imagewidth || layer.imageWidth || 0)
        const h = Number(layer.height || layer.imageheight || layer.imageHeight || 0)
        if (!w && layer.image && typeof layer.image === 'object') {
          return { width: Number(layer.image.width) || 0, height: Number(layer.image.height) || 0 }
        }
        return { width: w, height: h }
      })
      .filter(size => size.width && size.height)

    console.log("[tiledMap] coordinateSpaceForData: imagelayer sizes =", JSON.stringify(imageSizes.map(function(s){return s.width+"x"+s.height})))

    const objectBounds = (map.layers || [])
      .filter(layer => layer.type === 'objectgroup')
      .flatMap(layer => layer.objects || [])
      .reduce((bounds, object) => {
        const rect = readObjectRectFromData(object)
        return {
          width: Math.max(bounds.width, rect.x + rect.width),
          height: Math.max(bounds.height, rect.y + rect.height)
        }
      }, { width: mapWidth, height: mapHeight })

    const result = imageSizes.reduce((space, size) => ({
      width: Math.max(space.width, size.width),
      height: Math.max(space.height, size.height)
    }), objectBounds)

    console.log("[tiledMap] coordinateSpaceForData: final =", result.width, "x", result.height, "(map tile size:", mapWidth, "x", mapHeight, ")")
    return result
  }
const objectGroupFromData = (map, name) => {
  const layer = (map.layers || []).find(item => item.name === name && item.type === 'objectgroup')
  return layer?.objects || []
}

const parseJuyiHallTmxData = (map) => {
  const width = Number(map.width || 0) * Number(map.tilewidth || 0)
  const height = Number(map.height || 0) * Number(map.tileheight || 0)
  const coordinateSpace = coordinateSpaceForData(map, width, height)

  const imageLayers = {}
  ;(map.layers || [])
    .filter(layer => layer.type === 'imagelayer')
    .forEach((layer) => {
      imageLayers[layer.name] = {
        id: layer.name,
        source: absoluteJuyitingPath(layer.image || layer.source || ''),
        width: Number(layer.width) || coordinateSpace.width,
        height: Number(layer.height) || coordinateSpace.height,
        offsetX: Number(layer.offsetx || layer.offsetX) || 0,
        offsetY: Number(layer.offsety || layer.offsetY) || 0
      }
    })

  const hotspotObjects = [
    ...objectGroupFromData(map, 'hotspots'),
    ...objectGroupFromData(map, 'object')
  ]
  const hotspots = hotspotObjects.map((object) => {
    const rect = readObjectRectFromData(object)
    const properties = object.properties || {}
    return {
      id: object.name || '',
      panel: NAME_TO_PANEL_MAP[object.name] || properties.panel || '',
      ...rectToPercent(rect, coordinateSpace),
      rect,
      properties
    }
  })

  const obstacleGroups = [
    ...objectGroupFromData(map, 'obstacles'),
    ...objectGroupFromData(map, 'collision')
  ]
  const obstacles = obstacleGroups.map((object) => {
    const rect = readObjectRectFromData(object)
    return {
      id: object.name || '',
      ...rectToPercent(rect, coordinateSpace),
      rect
    }
  })

  const maskObjectsData = objectGroupFromData(map, 'mask')
  const occluders = maskObjectsData.map((object) => {
    const poly = object?.polygon
    if (!poly || !Array.isArray(poly)) return null
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    poly.forEach(({ x, y }) => {
      if (x < minX) minX = x; if (y < minY) minY = y
      if (x > maxX) maxX = x; if (y > maxY) maxY = y
    })
    return {
      id: object.name || ('mask-' + (object.id || '')),
      x: (Number(object?.x) || 0) + minX,
      y: (Number(object?.y) || 0) + minY,
      width: maxX - minX,
      height: maxY - minY,
      points: poly,
      originX: Number(object?.x) || 0,
      originY: Number(object?.y) || 0
    }
  }).filter(Boolean)

  const spawns = Object.fromEntries(objectGroupFromData(map, 'spawns').map((object) => {
    const rawName = object.name || ''
    const name = rawName.replace(/^spawn_/, '')
    const rect = readObjectRectFromData(object)
    return [name, {
      id: name,
      rawName,
      x: roundPercent(((rect.x + rect.width / 2) / coordinateSpace.width) * 100),
      y: roundPercent(((rect.y + rect.height / 2) / coordinateSpace.height) * 100),
      rect
    }]
  }))

  return {
    width,
    height,
    coordinateWidth: coordinateSpace.width,
    coordinateHeight: coordinateSpace.height,
    imageLayers,
    hotspots,
    obstacles,
    occluders,
    spawns
  }
}

export const parseJuyiHallTmx = (xml) => {
  if (xml && typeof xml === 'object' && Array.isArray(xml.layers)) {
    return parseJuyiHallTmxData(xml)
  }

  if (!xml || typeof DOMParser === 'undefined') {
    throw new Error('TMX XML parser unavailable')
  }

  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const parserError = doc.querySelector('parsererror')
  if (parserError) throw new Error('Invalid TMX XML')

  const mapNode = doc.querySelector('map')
  if (!mapNode) throw new Error('TMX map node missing')

  const width = numberAttr(mapNode, 'width') * numberAttr(mapNode, 'tilewidth')
  const height = numberAttr(mapNode, 'height') * numberAttr(mapNode, 'tileheight')
  const coordinateSpace = coordinateSpaceFor(doc, width, height)

  const imageLayers = {}
  doc.querySelectorAll('imagelayer').forEach((layer) => {
    const image = layer.querySelector('image')
    const name = textAttr(layer, 'name')
    imageLayers[name] = {
      id: name,
      source: absoluteJuyitingPath(textAttr(image, 'source')),
      width: numberAttr(image, 'width', coordinateSpace.width),
      height: numberAttr(image, 'height', coordinateSpace.height),
      offsetX: numberAttr(layer, 'offsetx'),
      offsetY: numberAttr(layer, 'offsety')
    }
  })

  const hotspotObjects = [
    ...readObjectGroup(doc, 'hotspots'),
    ...readObjectGroup(doc, 'object')
  ]
  const hotspots = hotspotObjects.map((objectNode) => {
    const rect = readObjectRect(objectNode)
    const properties = readProperties(objectNode)
    return {
      id: textAttr(objectNode, 'name'),
      panel: NAME_TO_PANEL_MAP[textAttr(objectNode, 'name')] || properties.panel || '',
      ...rectToPercent(rect, coordinateSpace),
      rect,
      properties
    }
  })

  const obstacleGroups = [
    ...readObjectGroup(doc, 'obstacles'),
    ...readObjectGroup(doc, 'collision')
  ]
  const obstacles = obstacleGroups.map((objectNode) => {
    const rect = readObjectRect(objectNode)
    return {
      id: textAttr(objectNode, 'name'),
      ...rectToPercent(rect, coordinateSpace),
      rect
    }
  })

  const maskObjects = readObjectGroup(doc, 'mask')
  const occluders = maskObjects.map((objectNode) => {
    const poly = objectNode.querySelector('polygon')
    if (!poly) return null
    const pointsStr = textAttr(poly, 'points')
    if (!pointsStr) return null
    const coords = pointsStr.split(/\s+/).filter(Boolean).map(p => {
      const [px, py] = p.split(',').map(Number)
      return { x: px, y: py }
    })
    if (!coords.length) return null
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    coords.forEach(({ x, y }) => {
      if (x < minX) minX = x; if (y < minY) minY = y
      if (x > maxX) maxX = x; if (y > maxY) maxY = y
    })
    return {
      id: textAttr(objectNode, 'name') || ('mask-' + textAttr(objectNode, 'id')),
      x: numberAttr(objectNode, 'x') + minX,
      y: numberAttr(objectNode, 'y') + minY,
      width: maxX - minX,
      height: maxY - minY,
      points: coords,
      originX: numberAttr(objectNode, 'x'),
      originY: numberAttr(objectNode, 'y')
    }
  }).filter(Boolean)

  const spawns = Object.fromEntries(readObjectGroup(doc, 'spawns').map((objectNode) => {
    const rawName = textAttr(objectNode, 'name')
    const name = rawName.replace(/^spawn_/, '')
    const rect = readObjectRect(objectNode)
    return [name, {
      id: name,
      rawName,
      x: roundPercent(((rect.x + rect.width / 2) / coordinateSpace.width) * 100),
      y: roundPercent(((rect.y + rect.height / 2) / coordinateSpace.height) * 100),
      rect
    }]
  }))

  return {
    width,
    height,
    coordinateWidth: coordinateSpace.width,
    coordinateHeight: coordinateSpace.height,
    imageLayers,
    hotspots,
    obstacles,
    occluders,
    spawns
  }
}
