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

const readObjectRect = objectNode => ({
  x: numberAttr(objectNode, 'x'),
  y: numberAttr(objectNode, 'y'),
  width: numberAttr(objectNode, 'width'),
  height: numberAttr(objectNode, 'height'),
  ellipse: Boolean(objectNode.querySelector('ellipse'))
})

const readObjectGroup = (doc, name) => {
  const group = [...doc.querySelectorAll('objectgroup')].find(item => textAttr(item, 'name') === name)
  if (!group) return []
  return [...group.children].filter(child => child.tagName === 'object')
}

const readObjectRectFromData = object => ({
  x: Number(object?.x) || 0,
  y: Number(object?.y) || 0,
  width: Number(object?.width) || 0,
  height: Number(object?.height) || 0,
  ellipse: Boolean(object?.ellipse)
})

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

  return objectBounds
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

  const hotspots = objectGroupFromData(map, 'hotspots').map((object) => {
    const rect = readObjectRectFromData(object)
    const properties = object.properties || {}
    return {
      id: object.name || '',
      panel: properties.panel || '',
      ...rectToPercent(rect, coordinateSpace),
      rect,
      properties
    }
  })

  const obstacles = objectGroupFromData(map, 'obstacles').map((object) => {
    const rect = readObjectRectFromData(object)
    return {
      id: object.name || '',
      ...rectToPercent(rect, coordinateSpace),
      rect
    }
  })

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

  const hotspots = readObjectGroup(doc, 'hotspots').map((objectNode) => {
    const rect = readObjectRect(objectNode)
    const properties = readProperties(objectNode)
    return {
      id: textAttr(objectNode, 'name'),
      panel: properties.panel || '',
      ...rectToPercent(rect, coordinateSpace),
      rect,
      properties
    }
  })

  const obstacles = readObjectGroup(doc, 'obstacles').map((objectNode) => {
    const rect = readObjectRect(objectNode)
    return {
      id: textAttr(objectNode, 'name'),
      ...rectToPercent(rect, coordinateSpace),
      rect
    }
  })

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
    spawns
  }
}
