import type {
  MapPoint, MapPolygon, MapRuntimeData, NavEdge, NavNode,
} from '../map/movementSchema.js'

export type NavigationGraph = Pick<MapRuntimeData, 'nodes' | 'edges' | 'obstacles'>

export type PathResult =
  | { status: 'found', points: MapPoint[], nodeIds: string[], cost: number }
  | { status: 'blocked', reason: 'no-nearest-node' | 'disconnected' | 'channel-too-narrow' }

export type PathFinder = {
  find(start: MapPoint, end: MapPoint, options: { colliderWidth: number }): PathResult
}

interface Traversal {
  edgeId: string
  from: string
  to: string
  cost: number
  points: MapPoint[]
}

interface SearchResult {
  nodeIds: string[]
  traversals: Traversal[]
  cost: number
  startPoint: MapPoint
}

interface Projection {
  node: NavNode
  distance: number
}

const EPSILON = 1e-9

export function createGraphPathfinder(graph: NavigationGraph): PathFinder {
  return {
    find: (start, end, options) => findGraphPath(graph, start, end, options),
  }
}

export function findGraphPath(
  graph: NavigationGraph,
  start: MapPoint,
  end: MapPoint,
  options: { colliderWidth: number },
): PathResult {
  requireInputs(start, end, options.colliderWidth)
  const restricted = solve(graph, start, end, options.colliderWidth, true)
  if (restricted) return foundResult(start, end, restricted)

  const unrestricted = solve(graph, start, end, options.colliderWidth, false)
  if (unrestricted) return { status: 'blocked', reason: 'channel-too-narrow' }

  if (projections(graph.nodes, start, graph.obstacles, options.colliderWidth, false).length === 0
    || projections(graph.nodes, end, graph.obstacles, options.colliderWidth, false).length === 0) {
    return { status: 'blocked', reason: 'no-nearest-node' }
  }
  return { status: 'blocked', reason: 'disconnected' }
}

function solve(
  graph: NavigationGraph,
  start: MapPoint,
  end: MapPoint,
  colliderWidth: number,
  enforceWidth: boolean,
): SearchResult | null {
  const nodes = graph.nodes.filter(node => validNode(node)
    && (!enforceWidth || node.channelWidth >= colliderWidth))
  const nodesById = new Map(nodes.map(node => [node.stableId, node]))
  const startProjections = projections(nodes, start, graph.obstacles, colliderWidth, enforceWidth)
  const endProjections = projections(nodes, end, graph.obstacles, colliderWidth, enforceWidth)
  if (startProjections.length === 0 || endProjections.length === 0) return null

  const adjacency = buildAdjacency(graph.edges, nodesById, graph.obstacles)
  const minimumMultiplier = minimumEdgeMultiplier(graph.edges)
  const traversableStarts = traversalProjections(startProjections, adjacency, nodes.length, 'start')
  const traversableEnds = traversalProjections(endProjections, adjacency, nodes.length, 'end')
  for (const pair of rankedProjectionPairs(traversableStarts, traversableEnds)) {
    const result = aStar(
      pair.start.node,
      pair.end.node,
      adjacency,
      nodesById,
      minimumMultiplier,
    )
    if (result) return result
  }
  return null
}

function traversalProjections(
  candidates: Projection[],
  adjacency: Map<string, Traversal[]>,
  nodeCount: number,
  endpoint: 'start' | 'end',
): Projection[] {
  if (nodeCount === 1) return candidates
  if (endpoint === 'start') {
    return candidates.filter(candidate => (adjacency.get(candidate.node.stableId)?.length ?? 0) > 0)
  }
  const incoming = new Set<string>()
  for (const traversals of adjacency.values()) {
    for (const traversal of traversals) incoming.add(traversal.to)
  }
  return candidates.filter(candidate => incoming.has(candidate.node.stableId))
}

function rankedProjectionPairs(
  starts: Projection[],
  ends: Projection[],
): Array<{ start: Projection, end: Projection }> {
  return starts.flatMap(start => ends.map(end => ({ start, end })))
    .sort((left, right) => compareNumber(
      left.start.distance + left.end.distance,
      right.start.distance + right.end.distance,
    )
      || compareNumber(left.start.distance, right.start.distance)
      || compareNumber(left.end.distance, right.end.distance)
      || left.start.node.stableId.localeCompare(right.start.node.stableId)
      || left.end.node.stableId.localeCompare(right.end.node.stableId))
}

function projections(
  nodes: NavNode[],
  point: MapPoint,
  obstacles: MapPolygon[],
  colliderWidth: number,
  enforceWidth: boolean,
): Projection[] {
  return nodes.filter(node => validNode(node)
      && (!enforceWidth || node.channelWidth >= colliderWidth)
      && visibleConnector(point, node.point, obstacles))
    .map(node => ({ node, distance: distance(point, node.point) }))
    .sort((left, right) => compareNumber(left.distance, right.distance)
      || left.node.stableId.localeCompare(right.node.stableId))
}

function buildAdjacency(
  edges: NavEdge[],
  nodesById: Map<string, NavNode>,
  obstacles: MapPolygon[],
): Map<string, Traversal[]> {
  const adjacency = new Map<string, Traversal[]>()
  for (const edge of edges) {
    const from = nodesById.get(edge.from)
    const to = nodesById.get(edge.to)
    if (!from || !to || !Number.isFinite(edge.costMultiplier) || edge.costMultiplier <= 0) continue
    const forwardPoints = deduplicatePoints([from.point, ...edge.points, to.point])
    const length = polylineLength(forwardPoints)
    if (!Number.isFinite(length) || polylineIntersectsObstacles(forwardPoints, obstacles)) continue
    addTraversal(adjacency, {
      edgeId: edge.stableId,
      from: edge.from,
      to: edge.to,
      cost: length * edge.costMultiplier,
      points: forwardPoints,
    })
    if (edge.bidirectional) {
      addTraversal(adjacency, {
        edgeId: edge.stableId,
        from: edge.to,
        to: edge.from,
        cost: length * edge.costMultiplier,
        points: [...forwardPoints].reverse(),
      })
    }
  }
  for (const traversals of adjacency.values()) {
    traversals.sort((left, right) => left.to.localeCompare(right.to)
      || left.edgeId.localeCompare(right.edgeId))
  }
  return adjacency
}

function addTraversal(adjacency: Map<string, Traversal[]>, traversal: Traversal): void {
  const outgoing = adjacency.get(traversal.from) ?? []
  outgoing.push(traversal)
  adjacency.set(traversal.from, outgoing)
}

function aStar(
  start: NavNode,
  end: NavNode,
  adjacency: Map<string, Traversal[]>,
  nodesById: Map<string, NavNode>,
  minimumMultiplier: number,
): SearchResult | null {
  if (start.stableId === end.stableId) {
    return { nodeIds: [start.stableId], traversals: [], cost: 0, startPoint: start.point }
  }
  const frontier = [{
    nodeId: start.stableId,
    cost: 0,
    estimate: heuristic(start, end, minimumMultiplier),
    nodeIds: [start.stableId],
    traversals: [] as Traversal[],
    tieKey: start.stableId,
  }]
  const best = new Map<string, { cost: number, tieKey: string }>([
    [start.stableId, { cost: 0, tieKey: start.stableId }],
  ])

  while (frontier.length > 0) {
    frontier.sort((left, right) => compareNumber(left.estimate, right.estimate)
      || compareNumber(left.cost, right.cost)
      || left.tieKey.localeCompare(right.tieKey))
    const current = frontier.shift()
    if (!current) break
    const known = best.get(current.nodeId)
    if (!known || current.cost > known.cost + EPSILON
      || (approximatelyEqual(current.cost, known.cost) && current.tieKey !== known.tieKey)) continue
    if (current.nodeId === end.stableId) {
      return {
        nodeIds: current.nodeIds,
        traversals: current.traversals,
        cost: current.cost,
        startPoint: start.point,
      }
    }
    for (const traversal of adjacency.get(current.nodeId) ?? []) {
      const nextNode = nodesById.get(traversal.to)
      if (!nextNode || current.nodeIds.includes(traversal.to)) continue
      const nextCost = current.cost + traversal.cost
      const tieKey = `${current.tieKey}\u0000${traversal.to}\u0000${traversal.edgeId}`
      const previous = best.get(traversal.to)
      if (previous && (nextCost > previous.cost + EPSILON
        || (approximatelyEqual(nextCost, previous.cost) && tieKey >= previous.tieKey))) continue
      best.set(traversal.to, { cost: nextCost, tieKey })
      frontier.push({
        nodeId: traversal.to,
        cost: nextCost,
        estimate: nextCost + heuristic(nextNode, end, minimumMultiplier),
        nodeIds: [...current.nodeIds, traversal.to],
        traversals: [...current.traversals, traversal],
        tieKey,
      })
    }
  }
  return null
}

function foundResult(start: MapPoint, end: MapPoint, search: SearchResult): PathResult {
  const graphPoints = search.traversals.flatMap(traversal => traversal.points)
  return {
    status: 'found',
    points: deduplicatePoints([start, search.startPoint, ...graphPoints, end]),
    nodeIds: [...search.nodeIds],
    cost: search.cost,
  }
}

function minimumEdgeMultiplier(edges: NavEdge[]): number {
  const values = edges.map(edge => edge.costMultiplier)
    .filter(value => Number.isFinite(value) && value > 0)
  return values.length > 0 ? Math.min(...values) : 0
}

function heuristic(from: NavNode, to: NavNode, minimumMultiplier: number): number {
  return distance(from.point, to.point) * minimumMultiplier
}

function visibleConnector(from: MapPoint, to: MapPoint, obstacles: MapPolygon[]): boolean {
  return !polylineIntersectsObstacles([from, to], obstacles)
}

function polylineIntersectsObstacles(points: MapPoint[], obstacles: MapPolygon[]): boolean {
  return obstacles.some(obstacle => polylineIntersectsPolygon(points, obstacle))
}

function polylineIntersectsPolygon(path: MapPoint[], polygon: MapPolygon): boolean {
  if (polygon.points.length < 3) return false
  if (path.some(point => pointInPolygon(point, polygon))) return true
  for (let pathIndex = 0; pathIndex < path.length - 1; pathIndex += 1) {
    for (let polygonIndex = 0; polygonIndex < polygon.points.length; polygonIndex += 1) {
      const next = (polygonIndex + 1) % polygon.points.length
      if (segmentsIntersect(
        path[pathIndex], path[pathIndex + 1], polygon.points[polygonIndex], polygon.points[next],
      )) return true
    }
  }
  return false
}

function pointInPolygon(point: MapPoint, polygon: MapPolygon): boolean {
  let inside = false
  for (let index = 0, previous = polygon.points.length - 1;
    index < polygon.points.length; previous = index, index += 1) {
    const current = polygon.points[index]
    const before = polygon.points[previous]
    if (pointOnSegment(point, before, current)) return true
    if ((current.y > point.y) !== (before.y > point.y)
      && point.x < ((before.x - current.x) * (point.y - current.y))
        / (before.y - current.y) + current.x) inside = !inside
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

function polylineLength(points: MapPoint[]): number {
  let length = 0
  for (let index = 1; index < points.length; index += 1) {
    length += distance(points[index - 1], points[index])
  }
  return length
}

function deduplicatePoints(points: MapPoint[]): MapPoint[] {
  const result: MapPoint[] = []
  for (const point of points) {
    const previous = result.at(-1)
    if (!previous || !samePoint(previous, point)) result.push({ x: point.x, y: point.y })
  }
  return result
}

function validNode(node: NavNode): boolean {
  return node.stableId.length > 0 && Number.isFinite(node.point.x) && Number.isFinite(node.point.y)
    && Number.isFinite(node.channelWidth) && node.channelWidth > 0
}

function requireInputs(start: MapPoint, end: MapPoint, colliderWidth: number): void {
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite)) {
    throw new TypeError('Path endpoints must contain finite world-pixel coordinates')
  }
  if (!Number.isFinite(colliderWidth) || colliderWidth <= 0) {
    throw new TypeError('colliderWidth must be positive and finite')
  }
}

function distance(left: MapPoint, right: MapPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y)
}

function samePoint(left: MapPoint, right: MapPoint): boolean {
  return approximatelyEqual(left.x, right.x) && approximatelyEqual(left.y, right.y)
}

function compareNumber(left: number, right: number): number {
  return approximatelyEqual(left, right) ? 0 : left - right
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= EPSILON
}

function approximatelyZero(value: number): boolean {
  return Math.abs(value) <= EPSILON
}
