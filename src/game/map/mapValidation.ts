import type {
  MapPoint, MapPolygon, MapRuntimeData, NavEdge, NavNode, Region, Slot,
} from './movementSchema.js'

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

interface SlotProjection {
  nodeId: string
}

const SUPPORTED_MOVEMENT_SCHEMA = '1'
const SUPPORTED_SCENE = 'juyiting-main'
const MINIMUM_COLLIDER_CHANNEL_WIDTH = 36
// TMX polyline endpoints may differ from node centers by at most two world pixels.
const EDGE_ENDPOINT_TOLERANCE = 2
const GEOMETRY_EPSILON = 1e-9

export function validateMapRuntime(map: MapRuntimeData): MapValidationResult {
  const errors: SceneError[] = []

  validateMetadata(map, errors)
  validateIdentities(map, errors)

  const validObstacles = validateObstacles(map.obstacles, errors)
  const usableNodes = validateNodes(map.nodes, errors)
  const nodesById = new Map(map.nodes.map(node => [node.stableId, node]))
  const traversableEdges = validateEdges(map.edges, nodesById, usableNodes, validObstacles, errors)
  const adjacency = buildAdjacency(map.nodes, map.edges, traversableEdges)

  const songjiangHomes = map.slots.filter(slot => slot.kind === 'home' && slot.personaCode === 'songjiang')
  const homeProjection = validateSongjiangHome(
    songjiangHomes, map.regions, usableNodes, validObstacles, errors,
  )
  const reachableNodeIds = homeProjection ? visit(homeProjection.nodeId, adjacency) : new Set<string>()

  const regionProjections = new Map<Region, SlotProjection[]>()
  for (const region of map.regions) {
    regionProjections.set(region, map.slots.flatMap(slot => {
      const projection = projectUsableSlot(slot, region, usableNodes, validObstacles)
      return projection ? [projection] : []
    }))
  }

  validateDirectedReachability(
    map.regions, usableNodes, regionProjections, homeProjection, reachableNodeIds, errors,
  )
  validateRegionSlots(map.regions, regionProjections, reachableNodeIds, errors)

  errors.sort(compareErrors)
  return { valid: errors.length === 0, errors, warnings: [] }
}

function validateMetadata(map: MapRuntimeData, errors: SceneError[]): void {
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
}

function validateIdentities(map: MapRuntimeData, errors: SceneError[]): void {
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
}

function validateObstacles(obstacles: MapPolygon[], errors: SceneError[]): MapPolygon[] {
  return obstacles.filter((obstacle, index) => {
    let requirement: string | undefined
    if (obstacle.points.length < 3) requirement = 'at least three finite points'
    else if (obstacle.points.some(point => !finitePoint(point))) requirement = 'finite points'
    else if (Math.abs(polygonSignedArea(obstacle)) <= GEOMETRY_EPSILON) requirement = 'non-zero area'

    if (requirement) {
      errors.push(fatal(
        'OBSTACLE_GEOMETRY_INVALID',
        '地图障碍物几何无效。',
        `Obstacle ${index} must contain ${requirement}.`,
      ))
      return false
    }
    return true
  })
}

function validateNodes(nodes: NavNode[], errors: SceneError[]): Map<string, NavNode> {
  const usableNodes = new Map<string, NavNode>()
  for (const node of nodes) {
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
    } else if (finitePoint(node.point)) {
      usableNodes.set(node.stableId, node)
    }
  }
  return usableNodes
}

function validateEdges(
  edges: NavEdge[],
  nodesById: Map<string, NavNode>,
  usableNodes: Map<string, NavNode>,
  obstacles: MapPolygon[],
  errors: SceneError[],
): Set<string> {
  const traversableEdges = new Set<string>()
  for (const edge of edges) {
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

    const geometryProblem = from && to ? edgeGeometryProblem(edge, from, to) : undefined
    if (geometryProblem) {
      errors.push(fatal('EDGE_GEOMETRY_INVALID', '地图路径几何无效。', geometryProblem))
    }
    const obstacleIndex = !geometryProblem ? intersectingObstacle(edge.points, obstacles) : -1
    if (obstacleIndex >= 0) {
      errors.push(fatal(
        'EDGE_INTERSECTS_OBSTACLE',
        '地图路径穿过了障碍物。',
        `Edge ${edge.stableId} intersects obstacle ${obstacleIndex}.`,
      ))
    }

    if (
      from && to && edge.costMultiplier > 0 && !geometryProblem && obstacleIndex < 0
      && usableNodes.has(from.stableId) && usableNodes.has(to.stableId)
    ) traversableEdges.add(edge.stableId)
  }
  return traversableEdges
}

function edgeGeometryProblem(edge: NavEdge, from: NavNode, to: NavNode): string | undefined {
  if (edge.points.length === 0) return `Edge ${edge.stableId} has no runtime geometry points.`
  if (edge.points.some(point => !finitePoint(point))) {
    return `Edge ${edge.stableId} runtime geometry contains non-finite points.`
  }
  const firstDistance = pointDistance(edge.points[0], from.point)
  const lastDistance = pointDistance(edge.points[edge.points.length - 1], to.point)
  if (firstDistance > EDGE_ENDPOINT_TOLERANCE || lastDistance > EDGE_ENDPOINT_TOLERANCE) {
    return `Edge ${edge.stableId} runtime endpoints must be within ${EDGE_ENDPOINT_TOLERANCE} world pixels of from ${from.stableId} and to ${to.stableId}; distances were ${formatDistance(firstDistance)} and ${formatDistance(lastDistance)}.`
  }
  return undefined
}

function validateSongjiangHome(
  homes: Slot[],
  regions: Region[],
  usableNodes: Map<string, NavNode>,
  obstacles: MapPolygon[],
  errors: SceneError[],
): SlotProjection | undefined {
  if (homes.length !== 1) {
    errors.push(fatal(
      'SONGJIANG_HOME_INVALID',
      '宋江必须配置唯一且可用的归位站位。',
      `Expected exactly one Songjiang home slot, found ${homes.length}.`,
    ))
    return undefined
  }

  const home = homes[0]
  const region = [...regions]
    .filter(candidate => candidate.regionId === home.regionId)
    .sort((left, right) => compareText(left.stableId, right.stableId))[0]
  let problem: string | undefined
  if (!region) problem = `Songjiang home ${home.stableId} references missing region ${home.regionId}.`
  else if (!finitePoint(home.point)) problem = `Songjiang home ${home.stableId} has a non-finite point.`
  else if (!pointInPolygon(home.point, region.polygon)) {
    problem = `Songjiang home ${home.stableId} is outside region ${region.regionId}.`
  } else {
    const obstacleIndex = obstacles.findIndex(obstacle => pointInPolygon(home.point, obstacle))
    if (obstacleIndex >= 0) problem = `Songjiang home ${home.stableId} is inside or on obstacle ${obstacleIndex}.`
  }

  const projection = !problem && region
    ? projectUsableSlot(home, region, usableNodes, obstacles)
    : undefined
  if (!problem && !projection) {
    problem = `Songjiang home ${home.stableId} cannot connect to a usable navigation node.`
  }
  if (problem) {
    errors.push(fatal('SONGJIANG_HOME_INVALID', '宋江必须配置唯一且可用的归位站位。', problem))
    return undefined
  }
  return projection
}

function validateDirectedReachability(
  regions: Region[],
  usableNodes: Map<string, NavNode>,
  regionProjections: Map<Region, SlotProjection[]>,
  homeProjection: SlotProjection | undefined,
  reachableNodeIds: Set<string>,
  errors: SceneError[],
): void {
  if (!homeProjection) {
    errors.push(fatal(
      'NAV_GRAPH_DISCONNECTED',
      '地图导航网络缺少可用的宋江起点。',
      'Navigation graph has no usable Songjiang home anchor.',
    ))
    return
  }

  const requiredNodeRegions = new Map<string, Set<string>>()
  for (const region of regions) {
    for (const node of usableNodes.values()) {
      if (pointInPolygon(node.point, region.polygon)) addRequiredNode(requiredNodeRegions, node.stableId, region.regionId)
    }
    for (const projection of regionProjections.get(region) ?? []) {
      addRequiredNode(requiredNodeRegions, projection.nodeId, region.regionId)
    }
  }
  const unreachableNodeIds = [...requiredNodeRegions.keys()]
    .filter(nodeId => !reachableNodeIds.has(nodeId))
    .sort(compareText)
  if (unreachableNodeIds.length === 0) return

  const affectedRegions = [...new Set(unreachableNodeIds.flatMap(nodeId => (
    [...(requiredNodeRegions.get(nodeId) ?? [])]
  )))].sort(compareText)
  errors.push(fatal(
    'NAV_GRAPH_DISCONNECTED',
    '地图导航网络无法到达全部核心区域。',
    `Songjiang anchor ${homeProjection.nodeId} cannot reach core node(s): ${unreachableNodeIds.join(', ')}; affected region(s): ${affectedRegions.join(', ')}.`,
  ))
}

function validateRegionSlots(
  regions: Region[],
  regionProjections: Map<Region, SlotProjection[]>,
  reachableNodeIds: Set<string>,
  errors: SceneError[],
): void {
  const unreachableRegions = regions
    .filter(region => !(regionProjections.get(region) ?? []).some(projection => reachableNodeIds.has(projection.nodeId)))
    .map(region => region.regionId)
    .sort(compareText)
  if (unreachableRegions.length > 0) {
    errors.push(fatal(
      'CORE_REGION_UNREACHABLE',
      '地图核心区域没有可达站位。',
      `Region(s) without a reachable slot from Songjiang home: ${unreachableRegions.join(', ')}.`,
    ))
  }
}

function projectUsableSlot(
  slot: Slot,
  region: Region,
  usableNodes: Map<string, NavNode>,
  obstacles: MapPolygon[],
): SlotProjection | undefined {
  if (
    slot.regionId !== region.regionId
    || !finitePoint(slot.point)
    || !pointInPolygon(slot.point, region.polygon)
    || obstacles.some(obstacle => pointInPolygon(slot.point, obstacle))
  ) return undefined

  const node = [...usableNodes.values()]
    .filter(candidate => intersectingObstacle([slot.point, candidate.point], obstacles) < 0)
    .sort((left, right) => (
      pointDistance(slot.point, left.point) - pointDistance(slot.point, right.point)
      || compareText(left.stableId, right.stableId)
    ))[0]
  return node ? { nodeId: node.stableId } : undefined
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

function addRequiredNode(required: Map<string, Set<string>>, nodeId: string, regionId: string): void {
  const regions = required.get(nodeId) ?? new Set<string>()
  regions.add(regionId)
  required.set(nodeId, regions)
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
  if (points.length < 3 || !finitePoint(point)) return false
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

function polygonSignedArea(polygon: MapPolygon): number {
  return polygon.points.reduce((area, point, index) => {
    const next = polygon.points[(index + 1) % polygon.points.length]
    return area + point.x * next.y - next.x * point.y
  }, 0) / 2
}

function finitePoint(point: MapPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
}

function pointDistance(left: MapPoint, right: MapPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y)
}

function formatDistance(distance: number): string {
  return Number.isFinite(distance) ? distance.toFixed(3) : String(distance)
}

function cross(a: MapPoint, b: MapPoint, c: MapPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function approximatelyZero(value: number): boolean {
  return Math.abs(value) < GEOMETRY_EPSILON
}

function compareErrors(left: SceneError, right: SceneError): number {
  return compareText(left.code, right.code)
    || compareText(left.technicalMessage ?? '', right.technicalMessage ?? '')
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
