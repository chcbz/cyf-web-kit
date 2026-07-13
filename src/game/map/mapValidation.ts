import type { MapRuntimeData } from './movementSchema.js'
import type { MapPoint, MapPolygon, NavEdge, NavNode, Region } from './movementSchema.js'

export interface SceneError {
  code: string
  severity: 'fatal' | 'degraded' | 'warning'
  retryable: boolean
  userMessage: string
  technicalMessage?: string
  source: 'map' | 'camera' | 'input' | 'sprites' | 'simulation' | 'backend'
}

export interface MapValidationResult {
  valid: boolean
  errors: SceneError[]
  warnings: SceneError[]
}

const SUPPORTED_MOVEMENT_SCHEMA = '1'
const SUPPORTED_SCENE = 'juyiting-main'
const MINIMUM_COLLIDER_CHANNEL_WIDTH = 36

export function validateMapRuntime(map: MapRuntimeData): MapValidationResult {
  const errors: SceneError[] = []

  if (map.movementSchemaVersion !== SUPPORTED_MOVEMENT_SCHEMA) {
    errors.push(fatal(
      'MOVEMENT_SCHEMA_INVALID',
      '地图移动数据版本不受支持。',
      `Expected movement schema ${SUPPORTED_MOVEMENT_SCHEMA}, received ${map.movementSchemaVersion}.`,
    ))
  }
  if (map.sceneId !== SUPPORTED_SCENE) {
    errors.push(fatal(
      'SCENE_ID_INVALID',
      '地图场景不受支持。',
      `Expected scene ${SUPPORTED_SCENE}, received ${map.sceneId}.`,
    ))
  }

  addDuplicateErrors(
    errors,
    'STABLE_ID_DUPLICATE',
    [
      ...map.regions.map(item => item.stableId),
      ...map.nodes.map(item => item.stableId),
      ...map.edges.map(item => item.stableId),
      ...map.slots.map(item => item.stableId),
    ],
    'stable ID',
  )
  addDuplicateErrors(errors, 'REGION_ID_DUPLICATE', map.regions.map(region => region.regionId), 'region ID')
  addDuplicateErrors(errors, 'SLOT_ID_DUPLICATE', map.slots.map(slot => slot.slotId), 'slot ID')

  const nodesById = new Map(map.nodes.map(node => [node.stableId, node]))
  const usableNodeIds = new Set<string>()
  for (const node of map.nodes) {
    if (!(node.channelWidth > 0)) {
      errors.push(fatal(
        'NODE_CHANNEL_WIDTH_INVALID',
        '地图通道宽度无效。',
        `Node ${node.stableId} has non-positive channelWidth ${node.channelWidth}.`,
      ))
    } else if (node.channelWidth < MINIMUM_COLLIDER_CHANNEL_WIDTH) {
      errors.push(fatal(
        'CHANNEL_WIDTH_INCOMPATIBLE',
        '地图通道无法容纳人物碰撞体。',
        `Node ${node.stableId} channelWidth ${node.channelWidth} is below collider diameter ${MINIMUM_COLLIDER_CHANNEL_WIDTH}.`,
      ))
    } else {
      usableNodeIds.add(node.stableId)
    }
  }

  const traversableEdges = new Set<string>()
  for (const edge of map.edges) {
    const from = nodesById.get(edge.from)
    const to = nodesById.get(edge.to)
    if (!from || !to) {
      const missing = [!from ? edge.from : '', !to ? edge.to : ''].filter(Boolean).join(', ')
      errors.push(fatal(
        'EDGE_ENDPOINT_MISSING',
        '地图路径引用了不存在的节点。',
        `Edge ${edge.stableId} references missing endpoint(s): ${missing}.`,
      ))
    }
    if (!(edge.costMultiplier > 0)) {
      errors.push(fatal(
        'EDGE_COST_INVALID',
        '地图路径代价无效。',
        `Edge ${edge.stableId} has non-positive costMultiplier ${edge.costMultiplier}.`,
      ))
    }
    const obstacleIndex = from && to ? intersectingObstacle(edgePath(edge, from, to), map.obstacles) : -1
    if (obstacleIndex >= 0) {
      errors.push(fatal(
        'EDGE_INTERSECTS_OBSTACLE',
        '地图路径穿过了障碍物。',
        `Edge ${edge.stableId} intersects obstacle ${obstacleIndex}.`,
      ))
    }
    if (
      from && to && edge.costMultiplier > 0 && obstacleIndex < 0
      && usableNodeIds.has(from.stableId) && usableNodeIds.has(to.stableId)
    ) {
      traversableEdges.add(edge.stableId)
    }
  }

  const adjacency = buildAdjacency(map.nodes, map.edges, traversableEdges)
  const connectedNodeIds = connectedFromRoot(
    map.nodes.filter(node => usableNodeIds.has(node.stableId)),
    adjacency,
  )
  const disconnectedNodeIds = map.nodes
    .map(node => node.stableId)
    .filter(nodeId => !connectedNodeIds.has(nodeId))
    .sort(compareText)
  if (map.nodes.length === 0 || disconnectedNodeIds.length > 0) {
    errors.push(fatal(
      'NAV_GRAPH_DISCONNECTED',
      '地图导航网络不连通。',
      map.nodes.length === 0
        ? 'Navigation graph has no nodes.'
        : `Navigation graph cannot reach node(s): ${disconnectedNodeIds.join(', ')}.`,
    ))
  }

  const unreachableRegions = map.regions
    .filter(region => !hasReachableSlot(region, map, connectedNodeIds))
    .map(region => region.regionId)
    .sort(compareText)
  if (unreachableRegions.length > 0) {
    errors.push(fatal(
      'CORE_REGION_UNREACHABLE',
      '地图核心区域没有可达站位。',
      `Region(s) without a reachable slot: ${unreachableRegions.join(', ')}.`,
    ))
  }

  const songjiangHomes = map.slots.filter(slot => slot.kind === 'home' && slot.personaCode === 'songjiang')
  if (songjiangHomes.length !== 1) {
    errors.push(fatal(
      'SONGJIANG_HOME_INVALID',
      '宋江必须配置唯一的归位站位。',
      `Expected exactly one Songjiang home slot, found ${songjiangHomes.length}.`,
    ))
  }

  errors.sort(compareErrors)
  return { valid: errors.length === 0, errors, warnings: [] }
}

function fatal(code: string, userMessage: string, technicalMessage: string): SceneError {
  return { code, severity: 'fatal', retryable: false, userMessage, technicalMessage, source: 'map' }
}

function addDuplicateErrors(
  errors: SceneError[], code: string, values: string[], identityName: string,
): void {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  for (const [value, count] of counts) {
    if (count > 1) {
      errors.push(fatal(
        code,
        '地图标识必须唯一。',
        `Duplicate ${identityName} ${value} appears ${count} times.`,
      ))
    }
  }
}

function buildAdjacency(
  nodes: NavNode[], edges: NavEdge[], traversableEdges: Set<string>,
): Map<string, Set<string>> {
  const adjacency = new Map(nodes.map(node => [node.stableId, new Set<string>()]))
  for (const edge of edges) {
    if (!traversableEdges.has(edge.stableId)) continue
    adjacency.get(edge.from)?.add(edge.to)
    if (edge.bidirectional) adjacency.get(edge.to)?.add(edge.from)
  }
  return adjacency
}

function connectedFromRoot(nodes: NavNode[], adjacency: Map<string, Set<string>>): Set<string> {
  if (nodes.length === 0) return new Set()
  const root = [...nodes].sort((left, right) => compareText(left.stableId, right.stableId))[0].stableId
  const forward = visit(root, adjacency)
  const reverse = new Map([...adjacency.keys()].map(nodeId => [nodeId, new Set<string>()]))
  for (const [from, targets] of adjacency) {
    for (const to of targets) reverse.get(to)?.add(from)
  }
  const backward = visit(root, reverse)
  return new Set([...forward].filter(nodeId => backward.has(nodeId)))
}

function visit(root: string, adjacency: Map<string, Set<string>>): Set<string> {
  const visited = new Set<string>()
  const pending = [root]
  while (pending.length > 0) {
    const nodeId = pending.pop() as string
    if (visited.has(nodeId)) continue
    visited.add(nodeId)
    pending.push(...(adjacency.get(nodeId) ?? []))
  }
  return visited
}

function hasReachableSlot(region: Region, map: MapRuntimeData, connectedNodeIds: Set<string>): boolean {
  const reachableNodes = map.nodes.filter(node => connectedNodeIds.has(node.stableId))
  return map.slots.some(slot => (
    slot.regionId === region.regionId
    && pointInPolygon(slot.point, region.polygon)
    && !map.obstacles.some(obstacle => pointInPolygon(slot.point, obstacle))
    && reachableNodes.some(node => intersectingObstacle([slot.point, node.point], map.obstacles) < 0)
  ))
}

function edgePath(edge: NavEdge, from: NavNode, to: NavNode): MapPoint[] {
  const path = [from.point, ...edge.points, to.point]
  return path.filter((point, index) => index === 0 || !samePoint(point, path[index - 1]))
}

function intersectingObstacle(path: MapPoint[], obstacles: MapPolygon[]): number {
  return obstacles.findIndex(obstacle => polylineIntersectsPolygon(path, obstacle))
}

function polylineIntersectsPolygon(path: MapPoint[], polygon: MapPolygon): boolean {
  if (path.some(point => pointInPolygon(point, polygon))) return true
  for (let pathIndex = 0; pathIndex < path.length - 1; pathIndex += 1) {
    for (let polygonIndex = 0; polygonIndex < polygon.points.length; polygonIndex += 1) {
      const polygonNext = (polygonIndex + 1) % polygon.points.length
      if (segmentsIntersect(
        path[pathIndex], path[pathIndex + 1], polygon.points[polygonIndex], polygon.points[polygonNext],
      )) return true
    }
  }
  return false
}

function pointInPolygon(point: MapPoint, polygon: MapPolygon): boolean {
  const points = polygon.points
  if (points.length < 3) return false
  let inside = false
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    if (pointOnSegment(point, points[previous], points[index])) return true
    const current = points[index]
    const before = points[previous]
    if (
      (current.y > point.y) !== (before.y > point.y)
      && point.x < ((before.x - current.x) * (point.y - current.y)) / (before.y - current.y) + current.x
    ) inside = !inside
  }
  return inside
}

function segmentsIntersect(a: MapPoint, b: MapPoint, c: MapPoint, d: MapPoint): boolean {
  const abC = cross(a, b, c)
  const abD = cross(a, b, d)
  const cdA = cross(c, d, a)
  const cdB = cross(c, d, b)
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0))
    && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true
  return (approximatelyZero(abC) && pointOnSegment(c, a, b))
    || (approximatelyZero(abD) && pointOnSegment(d, a, b))
    || (approximatelyZero(cdA) && pointOnSegment(a, c, d))
    || (approximatelyZero(cdB) && pointOnSegment(b, c, d))
}

function pointOnSegment(point: MapPoint, start: MapPoint, end: MapPoint): boolean {
  return approximatelyZero(cross(start, end, point))
    && point.x >= Math.min(start.x, end.x) && point.x <= Math.max(start.x, end.x)
    && point.y >= Math.min(start.y, end.y) && point.y <= Math.max(start.y, end.y)
}

function cross(a: MapPoint, b: MapPoint, c: MapPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function samePoint(left: MapPoint, right: MapPoint): boolean {
  return left.x === right.x && left.y === right.y
}

function approximatelyZero(value: number): boolean {
  return Math.abs(value) < 1e-9
}

function compareErrors(left: SceneError, right: SceneError): number {
  return compareText(left.code, right.code)
    || compareText(left.technicalMessage ?? '', right.technicalMessage ?? '')
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
