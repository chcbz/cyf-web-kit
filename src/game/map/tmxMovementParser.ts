import type {
  MapPoint, MapPolygon, MapRuntimeData, NavEdge, NavNode, Region, Slot, SlotType,
} from './movementSchema.js'

type Properties = Record<string, unknown>

interface TmxObject {
  x?: number
  y?: number
  width?: number
  height?: number
  ellipse?: boolean
  polygon?: unknown
  polyline?: unknown
  properties?: unknown
}

interface TmxLayer {
  name?: string
  objects?: TmxObject[]
  getObjects?: () => TmxObject[]
}

interface TmxMap {
  width?: number
  height?: number
  tilewidth?: number
  tileheight?: number
  tileWidth?: number
  tileHeight?: number
  properties?: unknown
  layers?: TmxLayer[]
  getLayers?: () => TmxLayer[]
}

const MOVEMENT_GROUPS = new Set([
  'nav_area', 'nav_obstacles', 'regions', 'nav_nodes', 'nav_edges',
  'parking_slots', 'queue_slots', 'home_slots',
])

export function parseMovementTmx(input: string | TmxMap): MapRuntimeData {
  const map = typeof input === 'string' ? parseXml(input) : normalizeParsedMap(input)
  const properties = propertyRecord(map.properties)
  const tileWidth = number(map.tilewidth ?? map.tileWidth, 0)
  const tileHeight = number(map.tileheight ?? map.tileHeight, 0)
  const result: MapRuntimeData = {
    sceneId: optionalString(properties.sceneId),
    movementSchemaVersion: optionalString(properties.movementSchemaVersion),
    navGraphVersion: optionalString(properties.navGraphVersion),
    spriteManifestVersion: optionalString(properties.spriteManifestVersion),
    width: number(map.width, 0) * tileWidth,
    height: number(map.height, 0) * tileHeight,
    navArea: [], navObstacles: [], regions: [], navNodes: [], navEdges: [], slots: [],
  }

  for (const layer of map.layers ?? []) {
    const name = layer.name ?? ''
    if (!MOVEMENT_GROUPS.has(name)) continue
    const objects = layer.objects ?? layer.getObjects?.() ?? []
    if (name === 'nav_area') result.navArea.push(...objects.map(objectPolygon))
    else if (name === 'nav_obstacles') result.navObstacles.push(...objects.map(objectPolygon))
    else if (name === 'regions') result.regions.push(...objects.map(parseRegion))
    else if (name === 'nav_nodes') result.navNodes.push(...objects.map(parseNode))
    else if (name === 'nav_edges') result.navEdges.push(...objects.map(parseEdge))
    else result.slots.push(...objects.map(object => parseSlot(object, slotType(name))))
  }
  return result
}

function parseRegion(object: TmxObject): Region {
  const properties = propertyRecord(object.properties)
  return compact({
    stableId: string(properties.stableId), regionId: string(properties.regionId),
    polygon: objectPolygon(object), label: optionalString(properties.label),
    capacity: optionalNumber(properties.capacity), protected: optionalBoolean(properties.protected),
    riskLevel: optionalString(properties.riskLevel),
  })
}

function parseNode(object: TmxObject): NavNode {
  const properties = propertyRecord(object.properties)
  return compact({
    stableId: string(properties.stableId), point: objectCenter(object),
    kind: (optionalString(properties.kind) ?? 'normal') as NavNode['kind'],
    channelWidth: optionalNumber(properties.channelWidth),
  })
}

function parseEdge(object: TmxObject): NavEdge {
  const properties = propertyRecord(object.properties)
  return {
    stableId: string(properties.stableId), from: string(properties.from), to: string(properties.to),
    bidirectional: optionalBoolean(properties.bidirectional) ?? false,
    costMultiplier: optionalNumber(properties.costMultiplier) ?? 1,
    points: worldPoints(object, object.polyline),
  }
}

function parseSlot(object: TmxObject, type: SlotType): Slot {
  const properties = propertyRecord(object.properties)
  return compact({
    stableId: string(properties.stableId), slotType: type, regionId: string(properties.regionId),
    point: objectCenter(object), priority: optionalNumber(properties.priority),
    capacity: optionalNumber(properties.capacity), facing: optionalString(properties.facing),
    radiusX: optionalNumber(properties.radiusX), radiusY: optionalNumber(properties.radiusY),
    personaCode: optionalString(properties.personaCode),
  })
}

function objectPolygon(object: TmxObject): MapPolygon {
  if (object.polygon) return { points: worldPoints(object, object.polygon) }
  const x = number(object.x, 0), y = number(object.y, 0)
  const width = number(object.width, 0), height = number(object.height, 0)
  if (object.ellipse) {
    const center = objectCenter(object)
    return { points: Array.from({ length: 16 }, (_, index) => {
      const angle = index * Math.PI / 8
      return { x: center.x + width / 2 * Math.cos(angle), y: center.y + height / 2 * Math.sin(angle) }
    }) }
  }
  return { points: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }] }
}

function objectCenter(object: TmxObject): MapPoint {
  return { x: number(object.x, 0) + number(object.width, 0) / 2, y: number(object.y, 0) + number(object.height, 0) / 2 }
}

function worldPoints(object: TmxObject, value: unknown): MapPoint[] {
  const points = Array.isArray(value) ? value : (value as { points?: unknown })?.points
  if (!Array.isArray(points)) return []
  const baseX = number(object.x, 0), baseY = number(object.y, 0)
  return points.map(point => ({ x: baseX + number((point as MapPoint).x, 0), y: baseY + number((point as MapPoint).y, 0) }))
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
  const mapTag = xml.match(/<map\b([^>]*)>/i)?.[1] ?? ''
  const mapProperties = xml.match(/<map\b[^>]*>[\s\S]*?<properties>([\s\S]*?)<\/properties>/i)?.[1] ?? ''
  const layers: TmxLayer[] = []
  for (const match of xml.matchAll(/<objectgroup\b([^>]*?)(?<!\/)>([\s\S]*?)<\/objectgroup>/gi)) {
    layers.push({ name: attribute(match[1], 'name'), objects: parseXmlObjects(match[2]) })
  }
  return {
    width: number(attribute(mapTag, 'width'), 0), height: number(attribute(mapTag, 'height'), 0),
    tilewidth: number(attribute(mapTag, 'tilewidth'), 0), tileheight: number(attribute(mapTag, 'tileheight'), 0),
    properties: parseXmlProperties(mapProperties), layers,
  }
}

function parseXmlObjects(body: string): TmxObject[] {
  const objects: TmxObject[] = []
  const pattern = /<object\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/object>)/gi
  for (const match of body.matchAll(pattern)) {
    const attrs = match[1], inner = match[2] ?? ''
    const polygon = inner.match(/<polygon\b[^>]*points="([^"]*)"/i)?.[1]
    const polyline = inner.match(/<polyline\b[^>]*points="([^"]*)"/i)?.[1]
    objects.push({
      x: number(attribute(attrs, 'x'), 0), y: number(attribute(attrs, 'y'), 0),
      width: number(attribute(attrs, 'width'), 0), height: number(attribute(attrs, 'height'), 0),
      ellipse: /<ellipse\b/i.test(inner), polygon: polygon ? parsePointList(polygon) : undefined,
      polyline: polyline ? parsePointList(polyline) : undefined,
      properties: parseXmlProperties(inner),
    })
  }
  return objects
}

function parseXmlProperties(body: string): Properties {
  const result: Properties = {}
  for (const match of body.matchAll(/<property\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/property>)/gi)) {
    const name = attribute(match[1], 'name')
    if (!name) continue
    const raw = attribute(match[1], 'value') ?? match[2] ?? ''
    const type = attribute(match[1], 'type')
    result[name] = type === 'bool' ? raw === 'true' || raw === '1' : type === 'int' || type === 'float' ? Number(raw) : decodeXml(raw)
  }
  return result
}

function parsePointList(value: string): MapPoint[] {
  return value.trim().split(/\s+/).filter(Boolean).map(pair => {
    const [x, y] = pair.split(',').map(Number)
    return { x, y }
  })
}

function attribute(source: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return source.match(new RegExp(`(?:^|\\s)${escaped}="([^"]*)"`, 'i'))?.[1]
}

function decodeXml(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

function slotType(group: string): SlotType {
  return group === 'parking_slots' ? 'parking' : group === 'queue_slots' ? 'queue' : 'home'
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}

function number(value: unknown, fallback: number): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback }
function string(value: unknown): string { return value == null ? '' : String(value) }
function optionalString(value: unknown): string | undefined { return value == null ? undefined : String(value) }
function optionalNumber(value: unknown): number | undefined { return value == null || value === '' ? undefined : number(value, 0) }
function optionalBoolean(value: unknown): boolean | undefined {
  if (value == null || value === '') return undefined
  return typeof value === 'boolean' ? value : value === 'true' || value === '1' || value === 1
}
