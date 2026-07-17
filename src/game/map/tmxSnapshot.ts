import type {
  MapPoint, MapPolygon, MapRuntimeData, NavEdge, NavNode, Region, Slot,
} from './movementSchema.js'

export interface MapSnapshot {
  sceneId: string
  movementSchemaVersion: string
  navGraphVersion: string
  spriteManifestVersion: string
  width: number
  height: number
  counts: {
    regions: number
    nodes: number
    edges: number
    slots: number
    obstacles: number
  }
  regions: Region[]
  nodes: NavNode[]
  edges: NavEdge[]
  slots: Slot[]
  obstacles: MapPolygon[]
}

export function createMapSnapshot(runtime: MapRuntimeData): MapSnapshot {
  const regions = sortByStableId(runtime.regions.map(region => ({
    stableId: region.stableId,
    regionId: region.regionId,
    polygon: polygon(region.polygon),
    label: region.label,
    capacity: region.capacity,
    protected: region.protected,
    riskLevel: region.riskLevel,
  })))
  const nodes = sortByStableId(runtime.nodes.map(node => ({
    stableId: node.stableId,
    point: point(node.point),
    kind: node.kind,
    channelWidth: node.channelWidth,
  })))
  const edges = sortByStableId(runtime.edges.map(edge => ({
    stableId: edge.stableId,
    from: edge.from,
    to: edge.to,
    bidirectional: edge.bidirectional,
    costMultiplier: edge.costMultiplier,
    points: edge.points.map(point),
  })))
  const slots = sortByStableId(runtime.slots.map(slot => compact({
    stableId: slot.stableId,
    slotId: slot.slotId,
    regionId: slot.regionId,
    point: point(slot.point),
    personaCode: slot.personaCode,
    kind: slot.kind,
  })))
  const obstacles = runtime.obstacles.map(polygon).sort((left, right) => {
    return compareText(JSON.stringify(left.points), JSON.stringify(right.points))
  })

  return {
    sceneId: runtime.sceneId,
    movementSchemaVersion: runtime.movementSchemaVersion,
    navGraphVersion: runtime.navGraphVersion,
    spriteManifestVersion: runtime.spriteManifestVersion,
    width: runtime.width,
    height: runtime.height,
    counts: {
      regions: regions.length,
      nodes: nodes.length,
      edges: edges.length,
      slots: slots.length,
      obstacles: obstacles.length,
    },
    regions,
    nodes,
    edges,
    slots,
    obstacles,
  }
}

export function serializeMapSnapshot(snapshot: MapSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`
}

function sortByStableId<T extends { stableId: string }>(items: T[]): T[] {
  return items.sort((left, right) => compareText(left.stableId, right.stableId))
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function polygon(value: MapPolygon): MapPolygon {
  return { points: value.points.map(point) }
}

function point(value: MapPoint): MapPoint {
  return { x: roundCoordinate(value.x), y: roundCoordinate(value.y) }
}

function roundCoordinate(value: number): number {
  const rounded = Number(value.toFixed(3))
  return Object.is(rounded, -0) ? 0 : rounded
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}
