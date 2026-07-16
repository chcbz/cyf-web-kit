import { parseMovementTmx } from './map/tmxMovementParser.js'
import { validateMapRuntime } from './map/mapValidation.js'

const isStructuredFatalMapError = error => (
  error?.code && error?.severity === 'fatal' && error?.source === 'map'
)

const movementSchemaError = (error) => {
  if (isStructuredFatalMapError(error)) return error
  const result = new Error(error?.message || 'Juyiting movement schema is unavailable or malformed.')
  Object.assign(result, {
    code: 'MOVEMENT_SCHEMA_INVALID',
    severity: 'fatal',
    retryable: false,
    userMessage: '大厅地图数据无效，暂时无法进入。',
    technicalMessage: error?.technicalMessage || error?.message || String(error),
    source: 'map'
  })
  return result
}

const mapParseError = (error) => {
  if (isStructuredFatalMapError(error)) return error
  const result = new Error(error?.message || 'Juyiting map could not be parsed.')
  Object.assign(result, {
    code: 'MAP_PARSE_FAILED',
    severity: 'fatal',
    retryable: false,
    userMessage: '大厅地图无法读取，暂时无法进入。',
    technicalMessage: error?.technicalMessage || error?.message || String(error),
    source: 'map'
  })
  return result
}

const attachValidatedMovement = (source, visualMap) => {
  let movement
  try {
    movement = parseMovementTmx(source)
  } catch (error) {
    throw movementSchemaError(error)
  }

  const validation = validateMapRuntime(movement)
  if (!validation.valid) {
    const fatal = validation.errors.find(error => error.severity === 'fatal') || validation.errors[0]
    throw movementSchemaError(Object.assign(new Error(fatal?.technicalMessage || fatal?.userMessage), fatal))
  }
  return {
    ...visualMap,
    movement,
    movementReady: true,
    movementWarnings: validation.warnings.map(warning => ({ ...warning }))
  }
}

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

const tileResourceName = (tilesetName, tileId) => `${tilesetName}-tile-${tileId}`

const tileResourceNameForGid = (gid, tilesets = []) => {
  const numericGid = Number(gid) || 0
  if (!numericGid) return ''
  for (const tileset of tilesets) {
    const firstgid = Number(tileset.firstgid) || 1
    const tileId = numericGid - firstgid
    if (tileId >= 0 && tileset.tiles?.[tileId]?.resourceName) {
      return tileset.tiles[tileId].resourceName
    }
  }
  return ''
}

const isTileDataSequence = data => Array.isArray(data) || ArrayBuffer.isView(data)

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

// --- Map-level properties (Tiled custom properties on <map>) ---

const readMapProperties = (doc) => {
  const mapNode = doc.querySelector('map')
  if (!mapNode) return {}
  const propsNode = mapNode.querySelector('properties')
  if (!propsNode) return {}
  return readProperties(propsNode)
}

const readMapPropertiesFromData = (map) => {
  const props = map.properties || map.mapProperties || {}
  if (Array.isArray(props)) {
    const result = {}
    props.forEach(p => { result[p.name] = p.value })
    return result
  }
  return props
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
  let x = numberAttr(objectNode, 'x')
  let y = numberAttr(objectNode, 'y')
  if (!width && !height) {
    const polyBounds = computePolygonBounds(objectNode)
    if (polyBounds) {
      x += polyBounds.x
      y += polyBounds.y
      width = polyBounds.width
      height = polyBounds.height
    }
  }
  return {
    x,
    y,
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

const readObjectRectFromData = (object, tilesets) => {
  let width = Number(object?.width) || 0
  let height = Number(object?.height) || 0
  let x = Number(object?.x) || 0
  let y = Number(object?.y) || 0
  // gid-based tile objects: resolve size from tileset
  if ((!width || !height) && object?.gid && tilesets?.length) {
    const gid = Number(object.gid)
    for (const ts of tilesets) {
      if (gid >= ts.firstgid && ts.tiles) {
        const tileIdx = gid - ts.firstgid
        const tile = ts.tiles[tileIdx]
        if (tile) {
          width = width || Number(tile.width || ts.tilewidth || 0)
          height = height || Number(tile.height || ts.tileheight || 0)
          break
        }
      }
    }
  }
  if (!width && !height) {
    const polyBounds = computePolygonBoundsFromData(object)
    if (polyBounds) {
      x += polyBounds.x
      y += polyBounds.y
      width = polyBounds.width
      height = polyBounds.height
    }
  }
  return {
    x,
    y,
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

  const artBounds = imageSizes.reduce((space, size) => ({
    width: Math.max(space.width, size.width),
    height: Math.max(space.height, size.height)
  }), { width: mapWidth, height: mapHeight })

  return artBounds.width && artBounds.height ? artBounds : objectBounds
}

const coordinateSpaceForData = (map, mapWidth, mapHeight, tilesets) => {
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

  const objectBounds = (map.layers || [])
    .filter(layer => layer.type === 'objectgroup')
    .flatMap(layer => layer.objects || [])
    .reduce((bounds, object) => {
      const rect = readObjectRectFromData(object, tilesets)
      return {
        width: Math.max(bounds.width, rect.x + rect.width),
        height: Math.max(bounds.height, rect.y + rect.height)
      }
    }, { width: mapWidth, height: mapHeight })

  const artBounds = imageSizes.reduce((space, size) => ({
    width: Math.max(space.width, size.width),
    height: Math.max(space.height, size.height)
  }), { width: mapWidth, height: mapHeight })

  const result = artBounds.width && artBounds.height ? artBounds : objectBounds

  return result
}
const objectGroupFromData = (map, name) => {
  const layer = (map.layers || []).find(item => item.name === name && item.type === 'objectgroup')
  return layer?.objects || []
}

const parseJuyiHallTmxData = (map) => {
  const width = Number(map.width || 0) * Number(map.tilewidth || 0)
  const height = Number(map.height || 0) * Number(map.tileheight || 0)

  // --- tileset metadata (needed early for gid->size resolution) ---
  const tilesets = (map.tilesets || []).map(ts => {
    const imageSource = typeof ts.image === 'string'
      ? absoluteJuyitingPath(ts.image)
      : absoluteJuyitingPath(ts.image?.source || ts.image?.src || ts.source || '')
    const tsData = {
      firstgid: ts.firstgid || 1,
      name: ts.name || '',
      tilewidth: ts.tilewidth || 16,
      tileheight: ts.tileheight || 16,
      columns: ts.columns || Math.floor((ts.imagewidth || ts.image?.width || 0) / (ts.tilewidth || 16)),
      imagewidth: ts.imagewidth || ts.image?.width || 0,
      imageheight: ts.imageheight || ts.image?.height || 0,
      imageSource,
      tilesetResourceName: ts.name || '',
      tiles: []
    }
    // collection-of-images tileset: extract per-tile images
    if (ts.tiles) {
      Object.values(ts.tiles).forEach(tile => {
        const img = tile?.image
        const source = typeof img === 'string' ? absoluteJuyitingPath(img) : absoluteJuyitingPath(img?.source || img?.src || '')
        tsData.tiles[tile.id] = {
          id: Number(tile.id),
          width: img?.width || tile?.width || tsData.tilewidth,
          height: img?.height || tile?.height || tsData.tileheight,
          source,
          resourceName: source ? tileResourceName(tsData.name, tile.id) : ''
        }
      })
    }
    return tsData
  })

  const coordinateSpace = coordinateSpaceForData(map, width, height, tilesets)

  // --- tile layer data (melonJS pre-parsed) ---
  const tileLayers = []

  ;(map.layers || []).filter(l => l.type === 'tilelayer').forEach(layer => {
    const data = isTileDataSequence(layer.data) ? layer.data : []
    if (data.length) {
      tileLayers.push({
        name: layer.name,
        width: layer.width,
        height: layer.height,
        data
      })
    }
  })

  const imageLayers = {}
  ;(map.layers || [])
    .filter(layer => layer.type === 'imagelayer')
    .forEach((layer) => {
      imageLayers[layer.name] = {
        id: layer.name,
        resourceName: layer.name,
        source: absoluteJuyitingPath(layer.image || layer.source || ''),
        width: Number(layer.width) || coordinateSpace.width,
        height: Number(layer.height) || coordinateSpace.height,
        offsetX: Number(layer.offsetx || layer.offsetX) || 0,
        offsetY: Number(layer.offsety || layer.offsetY) || 0,
        opacity: Number(layer.opacity) || 1,
        tintcolor: layer.tintcolor || null
      }
    })

  const hotspotObjects = [
    ...objectGroupFromData(map, 'hotspots')
  ]
  const hotspots = hotspotObjects.map((object) => {
    const rect = readObjectRectFromData(object, tilesets)
    const properties = object.properties || {}
    if (Array.isArray(object.properties)) {
      Object.assign(properties, Object.fromEntries(object.properties.map(p => [p.name, p.value])))
    }
    const polyData = object?.polygon
    const shape = polyData && Array.isArray(polyData) && polyData.length >= 3 ? 'polygon' : 'rect'
    const objX = Number(object?.x) || 0
    const objY = Number(object?.y) || 0
    const polygon = shape === 'polygon'
      ? polyData.map(({ x, y }) => ({ x: objX + x, y: objY + y }))
      : null
    const rawName = object.name || ''
    const cleanName = rawName.replace(/-rect$/, '')
    return {
      id: rawName,
      type: object.type || rawName || '',
      panel: NAME_TO_PANEL_MAP[cleanName] || NAME_TO_PANEL_MAP[rawName] || properties.panel || '',
      shape,
      polygon,
      ...rectToPercent(rect, coordinateSpace),
      rect,
      properties,
      gid: Number(object?.gid) || 0,
      tileResourceName: tileResourceNameForGid(object?.gid, tilesets)
    }
  })

  const obstacleGroups = [
    ...objectGroupFromData(map, 'obstacles'),
    ...objectGroupFromData(map, 'collision')
  ]
  const obstacles = obstacleGroups.map((object) => {
    const rect = readObjectRectFromData(object, tilesets)
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
    const rect = readObjectRectFromData(object, tilesets)
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
    spawns,
    mapProperties: readMapPropertiesFromData(map),
    tileLayers,
    tilesets
  }
}

const parseJuyiHallTmxUnchecked = (xml, movementEnabled = true) => {
  if (xml && typeof xml === 'object' && Array.isArray(xml.layers)) {
    const visualMap = parseJuyiHallTmxData(xml)
    return movementEnabled ? attachValidatedMovement(xml, visualMap) : legacyVisualMap(visualMap)
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

  // --- tileset metadata ---
  const tilesets = [...doc.querySelectorAll('tileset')].map(ts => {
    const name = textAttr(ts, 'name')
    const image = ts.querySelector(':scope > image') || ts.querySelector('image')
    const tsData = {
      firstgid: numberAttr(ts, 'firstgid', 1),
      name,
      tilewidth: numberAttr(ts, 'tilewidth', 16),
      tileheight: numberAttr(ts, 'tileheight', 16),
      columns: numberAttr(ts, 'columns', Math.floor(numberAttr(image, 'width', 0) / numberAttr(ts, 'tilewidth', 16))),
      imagewidth: numberAttr(image, 'width', 0),
      imageheight: numberAttr(image, 'height', 0),
      imageSource: absoluteJuyitingPath(textAttr(image, 'source')),
      tilesetResourceName: name,
      tiles: []
    }

    ts.querySelectorAll(':scope > tile').forEach(tile => {
      const tileId = numberAttr(tile, 'id')
      const tileImage = tile.querySelector('image')
      const source = absoluteJuyitingPath(textAttr(tileImage, 'source'))
      tsData.tiles[tileId] = {
        id: tileId,
        width: numberAttr(tileImage, 'width', tsData.tilewidth),
        height: numberAttr(tileImage, 'height', tsData.tileheight),
        source,
        resourceName: source ? tileResourceName(name, tileId) : ''
      }
    })

    return tsData
  })

  // --- tile layer data (XML <layer>) ---
  const tileLayers = []
  const b64Decoder = typeof atob === 'function' ? atob : (str => globalThis.Buffer.from(str, 'base64').toString('binary'))

  doc.querySelectorAll('map > layer').forEach(layerEl => {
    const dataEl = layerEl.querySelector('data')
    if (!dataEl) return
    const encoding = textAttr(dataEl, 'encoding')
    const layerW = numberAttr(layerEl, 'width')
    const layerH = numberAttr(layerEl, 'height')
    const expectedLen = layerW * layerH

    let data = []
    if (encoding === 'base64') {
      const raw = dataEl.textContent.replace(/\s/g, '')
      const decoded = b64Decoder(raw)
      for (let i = 0; i < expectedLen && i * 4 + 3 < decoded.length; i++) {
        const gid = (decoded.charCodeAt(i * 4) & 0xff)
          | ((decoded.charCodeAt(i * 4 + 1) & 0xff) << 8)
          | ((decoded.charCodeAt(i * 4 + 2) & 0xff) << 16)
          | ((decoded.charCodeAt(i * 4 + 3) & 0xff) << 24)
        data.push(gid)
      }
    } else {
      // csv
      data = (dataEl.textContent || '').split(',').map(v => Number(v)).filter(v => Number.isFinite(v))
    }

    if (data.length) {
      tileLayers.push({ name: textAttr(layerEl, 'name'), width: layerW, height: layerH, data })
    }
  })

  const imageLayers = {}
  doc.querySelectorAll('imagelayer').forEach((layer) => {
    const image = layer.querySelector('image')
    const name = textAttr(layer, 'name')
    imageLayers[name] = {
      id: name,
      resourceName: name,
      source: absoluteJuyitingPath(textAttr(image, 'source')),
      width: numberAttr(image, 'width', coordinateSpace.width),
      height: numberAttr(image, 'height', coordinateSpace.height),
      offsetX: numberAttr(layer, 'offsetx'),
      offsetY: numberAttr(layer, 'offsety'),
      opacity: numberAttr(layer, 'opacity', 1),
      tintcolor: textAttr(layer, 'tintcolor') || null
    }
  })

  const hotspotObjects = [
    ...readObjectGroup(doc, 'hotspots')
  ]
  const hotspots = hotspotObjects.map((objectNode) => {
    const rect = readObjectRect(objectNode)
    const properties = readProperties(objectNode)
    const polyEl = objectNode.querySelector('polygon')
    const pointsStr = polyEl ? textAttr(polyEl, 'points') : ''
    const polyPoints = pointsStr
      ? pointsStr.split(/\s+/).filter(Boolean).map(p => {
        const [px, py] = p.split(',').map(Number)
        return { x: px, y: py }
      })
      : []
    const shape = polyPoints.length >= 3 ? 'polygon' : 'rect'
    const objX = numberAttr(objectNode, 'x')
    const objY = numberAttr(objectNode, 'y')
    const polygon = shape === 'polygon'
      ? polyPoints.map(({ x, y }) => ({ x: objX + x, y: objY + y }))
      : null
    const rawName = textAttr(objectNode, 'name')
    const cleanName = rawName.replace(/-rect$/, '')
    return {
      id: rawName,
      type: textAttr(objectNode, 'type') || rawName,
      panel: NAME_TO_PANEL_MAP[cleanName] || NAME_TO_PANEL_MAP[rawName] || properties.panel || '',
      shape,
      polygon,
      ...rectToPercent(rect, coordinateSpace),
      rect,
      properties,
      gid: numberAttr(objectNode, 'gid'),
      tileResourceName: tileResourceNameForGid(numberAttr(objectNode, 'gid'), tilesets)
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

  const visualMap = {
    width,
    height,
    coordinateWidth: coordinateSpace.width,
    coordinateHeight: coordinateSpace.height,
    imageLayers,
    hotspots,
    obstacles,
    occluders,
    spawns,
    mapProperties: readMapProperties(doc),
    tileLayers,
    tilesets
  }
  return movementEnabled ? attachValidatedMovement(xml, visualMap) : legacyVisualMap(visualMap)
}

export const parseJuyiHallTmx = (input, { movementEnabled = true } = {}) => {
  try {
    return parseJuyiHallTmxUnchecked(input, movementEnabled)
  } catch (error) {
    throw mapParseError(error)
  }
}

const legacyVisualMap = visualMap => ({
  ...visualMap,
  movement: null,
  movementReady: false,
  movementWarnings: []
})
