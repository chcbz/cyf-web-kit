/**
 * E1 baseline: minimal, deterministic TMX structural parser.
 *
 * This module intentionally does NOT import production game sources. It parses
 * hall.tmx with `saxes` into a flat, machine-readable structure so the
 * occlusion baseline scripts (inventory, hashes, layer previews, asset report)
 * stay stable against unrelated runtime refactors.
 *
 * Output shape (all world coordinates in TMX pixels):
 * {
 *   map: { width, height, tileWidth, tileHeight, sceneId, ... },
 *   tilesets: [{ firstGid, name, image, width, height, tileCount, tiles: [...] }],
 *   layers: [{ id, name, kind: 'tile' | 'imagelayer', source?, width?, height?, opacity? }],
 *   groups: { [name]: [object] }
 * }
 */

import { createHash } from 'node:crypto'
import { SaxesParser } from 'saxes'

const OBJECT_GROUPS = [
  'collision',
  'mask',
  'hotspots',
  'nav_area',
  'nav_obstacles',
  'regions',
  'nav_nodes',
  'nav_edges',
  'parking_slots',
  'queue_slots',
  'home_slots',
  'patrol_routes',
  'debug_labels',
]

export function parseTmxStructure(tmx) {
  const root = parseXml(tmx)
  if (root.name !== 'map') throw new Error(`Expected TMX root <map>, got <${root.name}>`)

  const map = {
    version: attr(root, 'version'),
    orientation: attr(root, 'orientation'),
    width: number(root.attributes.width),
    height: number(root.attributes.height),
    tileWidth: number(root.attributes.tilewidth),
    tileHeight: number(root.attributes.tileheight),
    nextObjectId: number(root.attributes.nextobjectid),
    properties: propertyMap(root),
  }

  const tilesets = []
  const layers = []
  const groups = Object.fromEntries(OBJECT_GROUPS.map(name => [name, []]))

  for (const child of root.children) {
    if (child.name === 'tileset') {
      tilesets.push(parseTileset(child))
    } else if (child.name === 'layer') {
      layers.push({
        id: number(child.attributes.id),
        name: attr(child, 'name'),
        kind: 'tile',
        width: number(child.attributes.width),
        height: number(child.attributes.height),
      })
    } else if (child.name === 'imagelayer') {
      const image = child.children.find(node => node.name === 'image')
      layers.push({
        id: number(child.attributes.id),
        name: attr(child, 'name'),
        kind: 'imagelayer',
        opacity: optionalNumber(child.attributes.opacity, 1),
        tintcolor: attr(child, 'tintcolor') || undefined,
        source: image ? attr(image, 'source') : undefined,
        width: image ? optionalNumber(image.attributes.width, 0) : 0,
        height: image ? optionalNumber(image.attributes.height, 0) : 0,
      })
    } else if (child.name === 'objectgroup') {
      const groupName = attr(child, 'name')
      if (!(groupName in groups)) continue
      for (const object of child.children) {
        if (object.name !== 'object') continue
        groups[groupName].push(parseObject(object, groupName))
      }
    }
  }

  return { map, tilesets, layers, groups }
}

export function resolveWorldPolygon(object) {
  if (!object.polygon || object.polygon.length < 3) return null
  return object.polygon.map(([px, py]) => ({
    x: roundCoordinate(object.x + px),
    y: roundCoordinate(object.y + py),
  }))
}

export function polygonAabb(points) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    if (point.x < minX) minX = point.x
    if (point.y < minY) minY = point.y
    if (point.x > maxX) maxX = point.x
    if (point.y > maxY) maxY = point.y
  }
  return {
    minX: roundCoordinate(minX),
    minY: roundCoordinate(minY),
    maxX: roundCoordinate(maxX),
    maxY: roundCoordinate(maxY),
    width: roundCoordinate(maxX - minX),
    height: roundCoordinate(maxY - minY),
  }
}

export function polygonCentroid(points) {
  if (points.length === 0) return { x: 0, y: 0 }
  let x = 0
  let y = 0
  for (const point of points) {
    x += point.x
    y += point.y
  }
  return { x: roundCoordinate(x / points.length), y: roundCoordinate(y / points.length) }
}

export function rectAabb(object) {
  return {
    minX: roundCoordinate(object.x),
    minY: roundCoordinate(object.y),
    maxX: roundCoordinate(object.x + object.width),
    maxY: roundCoordinate(object.y + object.height),
    width: roundCoordinate(object.width),
    height: roundCoordinate(object.height),
  }
}

export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function parseTileset(node) {
  const image = node.children.find(child => child.name === 'image')
  const tiles = node.children.filter(child => child.name === 'tile')
  return {
    firstGid: number(node.attributes.firstgid),
    name: attr(node, 'name'),
    tileWidth: number(node.attributes.tilewidth),
    tileHeight: number(node.attributes.tileheight),
    tileCount: number(node.attributes.tilecount),
    columns: optionalNumber(node.attributes.columns, 0),
    objectAlignment: attr(node, 'objectalignment') || undefined,
    image: image ? attr(image, 'source') : undefined,
    imageWidth: image ? optionalNumber(image.attributes.width, 0) : 0,
    imageHeight: image ? optionalNumber(image.attributes.height, 0) : 0,
    tiles: tiles.map(tile => {
      const tileImage = tile.children.find(child => child.name === 'image')
      return {
        id: number(tile.attributes.id),
        image: tileImage ? attr(tileImage, 'source') : undefined,
        width: tileImage ? optionalNumber(tileImage.attributes.width, 0) : 0,
        height: tileImage ? optionalNumber(tileImage.attributes.height, 0) : 0,
      }
    }),
  }
}

function parseObject(node, groupName) {
  const polygonNode = node.children.find(child => child.name === 'polygon')
  const polylineNode = node.children.find(child => child.name === 'polyline')
  const ellipseNode = node.children.find(child => child.name === 'ellipse')
  const gid = optionalNumber(node.attributes.gid, undefined)
  const shape = gid !== undefined ? 'tile'
    : polygonNode ? 'polygon'
      : polylineNode ? 'polyline'
        : ellipseNode ? 'ellipse'
          : 'rectangle'
  return {
    id: number(node.attributes.id),
    name: attr(node, 'name') || undefined,
    type: attr(node, 'type') || undefined,
    gid,
    x: number(node.attributes.x),
    y: number(node.attributes.y),
    width: optionalNumber(node.attributes.width, 0),
    height: optionalNumber(node.attributes.height, 0),
    rotation: optionalNumber(node.attributes.rotation, 0),
    polygon: polygonNode ? parsePoints(polygonNode.attributes.points) : undefined,
    polyline: polylineNode ? parsePoints(polylineNode.attributes.points) : undefined,
    ellipse: Boolean(ellipseNode),
    shape,
    properties: propertyMap(node),
  }
}

function parsePoints(value) {
  if (typeof value !== 'string' || value.trim() === '') return []
  return value.split(/\s+/).filter(Boolean).map(pair => {
    const [x, y] = pair.split(',').map(Number)
    return [x, y]
  })
}

function parseXml(xml) {
  const parser = new SaxesParser()
  let root = { name: null, attributes: {}, children: [] }
  const stack = []
  let current = null
  parser.on('opentag', tag => {
    const node = {
      name: tag.name,
      attributes: Object.fromEntries(Object.entries(tag.attributes).map(([name, value]) => [name, String(value)])),
      children: [],
    }
    if (!current) root = node
    else current.children.push(node)
    stack.push(current)
    current = node
  })
  parser.on('closetag', () => {
    current = stack.pop() ?? null
  })
  parser.write(xml).close()
  if (!root.name) throw new Error('TMX parse produced no root element')
  return root
}

function propertyMap(node) {
  const properties = {}
  const propertiesNode = node.children.find(child => child.name === 'properties')
  if (!propertiesNode) return properties
  for (const property of propertiesNode.children) {
    if (property.name !== 'property') continue
    const key = attr(property, 'name')
    const value = attr(property, 'value')
    const type = attr(property, 'type') || 'string'
    properties[key] = typedValue(value, type)
  }
  return properties
}

function typedValue(value, type) {
  if (type === 'int' || type === 'float') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : value
  }
  if (type === 'bool') return value === 'true'
  return value
}

function attr(node, name) {
  return node.attributes[name] ?? ''
}

function number(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`Expected finite number, got ${JSON.stringify(value)}`)
  return parsed
}

function optionalNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function roundCoordinate(value) {
  const rounded = Number(value.toFixed(3))
  return Object.is(rounded, -0) ? 0 : rounded
}
