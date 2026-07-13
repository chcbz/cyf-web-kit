import type {
  MapPoint, MapPolygon, MapRuntimeData, NavEdge, NavNode, Region, Slot,
} from './movementSchema.js'

type Properties = Record<string, unknown>

interface TmxObject {
  x?: unknown
  y?: unknown
  width?: unknown
  height?: unknown
  rotation?: unknown
  layerOffsetX?: unknown
  layerOffsetY?: unknown
  ellipse?: unknown
  polygon?: unknown
  polyline?: unknown
  properties?: unknown
}

interface TmxLayer {
  name?: string
  offsetx?: unknown
  offsety?: unknown
  objects?: TmxObject[]
  getObjects?: () => TmxObject[]
}

interface TmxMap {
  width?: unknown
  height?: unknown
  tilewidth?: unknown
  tileheight?: unknown
  tileWidth?: unknown
  tileHeight?: unknown
  properties?: unknown
  layers?: TmxLayer[]
  getLayers?: () => TmxLayer[]
}

const MOVEMENT_GROUPS = new Set([
  'nav_obstacles', 'regions', 'nav_nodes', 'nav_edges',
  'parking_slots', 'queue_slots', 'home_slots',
])

export function parseMovementTmx(input: string | TmxMap): MapRuntimeData {
  const map = typeof input === 'string' ? parseXml(input) : normalizeParsedMap(input)
  const properties = propertyRecord(map.properties)
  const tileWidth = requiredNumber(map.tilewidth ?? map.tileWidth, 'map.tilewidth')
  const tileHeight = requiredNumber(map.tileheight ?? map.tileHeight, 'map.tileheight')
  const result: MapRuntimeData = {
    sceneId: requiredString(properties.sceneId, 'sceneId'),
    movementSchemaVersion: requiredString(properties.movementSchemaVersion, 'movementSchemaVersion'),
    navGraphVersion: requiredString(properties.navGraphVersion, 'navGraphVersion'),
    spriteManifestVersion: requiredString(properties.spriteManifestVersion, 'spriteManifestVersion'),
    width: requiredNumber(map.width, 'map.width') * tileWidth,
    height: requiredNumber(map.height, 'map.height') * tileHeight,
    regions: [], nodes: [], edges: [], slots: [], obstacles: [],
  }

  for (const layer of map.layers ?? []) {
    const name = layer.name ?? ''
    if (!MOVEMENT_GROUPS.has(name)) continue
    const offsetX = optionalNumber(layer.offsetx, `${name}.offsetx`, 0)
    const offsetY = optionalNumber(layer.offsety, `${name}.offsety`, 0)
    const objects = (layer.objects ?? layer.getObjects?.() ?? []).map(object => ({ ...object, layerOffsetX: offsetX, layerOffsetY: offsetY }))
    if (name === 'nav_obstacles') result.obstacles.push(...objects.map((object, index) => objectPolygon(object, `${name}[${index}]`)))
    else if (name === 'regions') result.regions.push(...objects.map((object, index) => parseRegion(object, `${name}[${index}]`)))
    else if (name === 'nav_nodes') result.nodes.push(...objects.map((object, index) => parseNode(object, `${name}[${index}]`)))
    else if (name === 'nav_edges') result.edges.push(...objects.map((object, index) => parseEdge(object, `${name}[${index}]`)))
    else result.slots.push(...objects.map((object, index) => parseSlot(object, slotType(name), `${name}[${index}]`)))
  }
  return result
}

function parseRegion(object: TmxObject, context: string): Region {
  const properties = propertyRecord(object.properties)
  return {
    stableId: requiredString(properties.stableId, `${context}.stableId`),
    regionId: requiredString(properties.regionId, `${context}.regionId`),
    polygon: objectPolygon(object, context), label: requiredString(properties.label, `${context}.label`),
    capacity: requiredNumber(properties.capacity, `${context}.capacity`),
    protected: requiredBoolean(properties.protected, `${context}.protected`),
    riskLevel: requiredEnum(properties.riskLevel, ['low', 'medium', 'high'], `${context}.riskLevel`),
  }
}

function parseNode(object: TmxObject, context: string): NavNode {
  const properties = propertyRecord(object.properties)
  return {
    stableId: requiredString(properties.stableId, `${context}.stableId`), point: objectCenter(object, context),
    kind: properties.kind == null ? 'normal' : requiredEnum(properties.kind, ['normal', 'junction', 'doorway', 'narrow'], `${context}.kind`),
    channelWidth: requiredNumber(properties.channelWidth, `${context}.channelWidth`),
  }
}

function parseEdge(object: TmxObject, context: string): NavEdge {
  const properties = propertyRecord(object.properties)
  return {
    stableId: requiredString(properties.stableId, `${context}.stableId`),
    from: requiredString(properties.from, `${context}.from`), to: requiredString(properties.to, `${context}.to`),
    bidirectional: properties.bidirectional == null ? false : requiredBoolean(properties.bidirectional, `${context}.bidirectional`),
    costMultiplier: optionalNumber(properties.costMultiplier, `${context}.costMultiplier`, 1),
    points: worldPoints(object, object.polyline, context),
  }
}

function parseSlot(object: TmxObject, kind: Slot['kind'], context: string): Slot {
  const properties = propertyRecord(object.properties)
  return compact({
    stableId: requiredString(properties.stableId, `${context}.stableId`),
    slotId: requiredString(properties.slotId, `${context}.slotId`),
    regionId: requiredString(properties.regionId, `${context}.regionId`), point: objectCenter(object, context), kind,
    personaCode: optionalString(properties.personaCode),
  })
}

function objectPolygon(object: TmxObject, context: string): MapPolygon {
  if (object.polygon) return { points: worldPoints(object, object.polygon, context) }
  const width = optionalNumber(object.width, `${context}.width`, 0)
  const height = optionalNumber(object.height, `${context}.height`, 0)
  if (object.ellipse) {
    return { points: Array.from({ length: 16 }, (_, index) => {
      const angle = index * Math.PI / 8
      return transformPoint(object, { x: width / 2 + width / 2 * Math.cos(angle), y: height / 2 + height / 2 * Math.sin(angle) }, context)
    }) }
  }
  return { points: [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }]
    .map(point => transformPoint(object, point, context)) }
}

function objectCenter(object: TmxObject, context: string): MapPoint {
  return transformPoint(object, {
    x: optionalNumber(object.width, `${context}.width`, 0) / 2,
    y: optionalNumber(object.height, `${context}.height`, 0) / 2,
  }, context)
}

function worldPoints(object: TmxObject, value: unknown, context: string): MapPoint[] {
  const points = Array.isArray(value) ? value : (value as { points?: unknown })?.points
  if (!Array.isArray(points)) return []
  return points.map((point, index) => transformPoint(object, {
    x: requiredNumber((point as MapPoint).x, `${context}.points[${index}].x`),
    y: requiredNumber((point as MapPoint).y, `${context}.points[${index}].y`),
  }, context))
}

function transformPoint(object: TmxObject, point: MapPoint, context: string): MapPoint {
  const x = optionalNumber(object.x, `${context}.x`, 0) + optionalNumber(object.layerOffsetX, `${context}.layerOffsetX`, 0)
  const y = optionalNumber(object.y, `${context}.y`, 0) + optionalNumber(object.layerOffsetY, `${context}.layerOffsetY`, 0)
  const radians = optionalNumber(object.rotation, `${context}.rotation`, 0) * Math.PI / 180
  const cos = Math.cos(radians), sin = Math.sin(radians)
  return normalizePoint({ x: x + point.x * cos - point.y * sin, y: y + point.x * sin + point.y * cos })
}

function propertyRecord(value: unknown): Properties {
  if (!value) return {}
  if (!Array.isArray(value)) return value as Properties
  return Object.fromEntries(value.map(item => {
    const property = item as { name: string, value?: unknown }
    return [property.name, property.value]
  }))
}

function normalizeParsedMap(map: TmxMap): TmxMap {
  return { ...map, layers: map.layers ?? map.getLayers?.() ?? [] }
}

function parseXml(xml: string): TmxMap {
  if (typeof DOMParser === 'undefined') throw new Error('DOMParser is required to parse raw TMX XML')
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  if (document.querySelector('parsererror')) throw new Error('Invalid TMX XML')
  const map = document.documentElement
  if (map.localName !== 'map') throw new Error('TMX map root missing')
  return {
    width: map.getAttribute('width'), height: map.getAttribute('height'),
    tilewidth: map.getAttribute('tilewidth'), tileheight: map.getAttribute('tileheight'),
    properties: propertiesFromElement(map),
    layers: directChildren(map, 'objectgroup').map(layer => ({
      name: layer.getAttribute('name') ?? undefined,
      offsetx: layer.hasAttribute('offsetx') ? layer.getAttribute('offsetx') : undefined,
      offsety: layer.hasAttribute('offsety') ? layer.getAttribute('offsety') : undefined,
      objects: directChildren(layer, 'object').map(objectFromElement),
    })),
  }
}

function objectFromElement(object: Element): TmxObject {
  const polygon = directChildren(object, 'polygon')[0]
  const polyline = directChildren(object, 'polyline')[0]
  return {
    x: xmlAttribute(object, 'x'), y: xmlAttribute(object, 'y'),
    width: xmlAttribute(object, 'width'), height: xmlAttribute(object, 'height'),
    rotation: xmlAttribute(object, 'rotation'), ellipse: directChildren(object, 'ellipse').length > 0,
    polygon: polygon ? parsePointList(polygon.getAttribute('points') ?? '', 'polygon.points') : undefined,
    polyline: polyline ? parsePointList(polyline.getAttribute('points') ?? '', 'polyline.points') : undefined,
    properties: propertiesFromElement(object),
  }
}

function propertiesFromElement(parent: Element): Properties {
  const result: Properties = {}
  const container = directChildren(parent, 'properties')[0]
  if (!container) return result
  for (const property of directChildren(container, 'property')) {
    const name = property.getAttribute('name')
    if (!name) continue
    result[name] = property.hasAttribute('value') ? property.getAttribute('value') : property.textContent ?? ''
  }
  return result
}

function parsePointList(value: string, context: string): MapPoint[] {
  return value.trim().split(/\s+/).filter(Boolean).map((pair, index) => {
    const values = pair.split(',')
    if (values.length !== 2) throw new Error(`Invalid ${context}[${index}]`)
    return { x: requiredNumber(values[0], `${context}[${index}].x`), y: requiredNumber(values[1], `${context}[${index}].y`) }
  })
}

function directChildren(parent: Element, name: string): Element[] {
  return Array.from(parent.children).filter(child => child.localName === name)
}

function xmlAttribute(element: Element, name: string): string | undefined {
  return element.hasAttribute(name) ? element.getAttribute(name) ?? undefined : undefined
}

function slotType(group: string): Slot['kind'] {
  return group === 'parking_slots' ? 'parking' : group === 'queue_slots' ? 'queue' : 'home'
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}

function optionalString(value: unknown): string | undefined { return value == null ? undefined : String(value) }
function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`Invalid ${field}: expected string`)
  const result = String(value)
  if (!result) throw new Error(`Invalid ${field}: expected non-empty string`)
  return result
}
function requiredNumber(value: unknown, field: string): number {
  if (typeof value === 'string' && !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) {
    throw new Error(`Invalid ${field}: expected finite number`)
  }
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error(`Invalid ${field}: expected finite number`)
  const result = Number(value)
  if (!Number.isFinite(result)) throw new Error(`Invalid ${field}: expected finite number`)
  return result
}
function optionalNumber(value: unknown, field: string, fallback: number): number {
  return value == null || value === '' ? fallback : requiredNumber(value, field)
}
function requiredBoolean(value: unknown, field: string): boolean {
  if (value === true || value === 'true' || value === 1 || value === '1') return true
  if (value === false || value === 'false' || value === 0 || value === '0') return false
  throw new Error(`Invalid ${field}: expected boolean`)
}
function requiredEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value === 'string' && allowed.includes(value as T)) return value as T
  throw new Error(`Invalid ${field}: expected one of ${allowed.join(', ')}`)
}
function normalizePoint(point: MapPoint): MapPoint {
  const clean = (value: number): number => Math.abs(value) < 1e-10 ? 0 : Number(value.toFixed(12))
  return { x: clean(point.x), y: clean(point.y) }
}
