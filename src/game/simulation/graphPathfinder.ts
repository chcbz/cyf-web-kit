import type {
  MapPoint, MapPolygon, MapRuntimeData, NavEdge, NavNode,
} from '../map/movementSchema.js'
import {
  hasRequiredPointClearance,
  hasRequiredPolylineClearance,
  requiredChannelWidth,
  requiredClearance,
} from './clearanceGeometry.js'

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
}

interface Projection {
  node: NavNode
  distance: number
}

interface Candidate {
  nodeIds: string[]
  points: MapPoint[]
  cost: number
  tieKey: string
  hardTurn: boolean
}

const EPSILON = 1e-9
const HARD_TURN_COSINE = Math.cos(120 * Math.PI / 180)

export function createGraphPathfinder(graph: NavigationGraph): PathFinder {
  return { find: (start, end, options) => findGraphPath(graph, start, end, options) }
}

export function findGraphPath(
  graph: NavigationGraph,
  start: MapPoint,
  end: MapPoint,
  options: { colliderWidth: number },
): PathResult {
  requireInputs(start, end, options.colliderWidth)
  const clearance = requiredClearance(options.colliderWidth)
  if (hasRequiredPolylineClearance([start, end], graph.obstacles, clearance)) {
    return { status: 'found', points: [copyPoint(start), copyPoint(end)], nodeIds: [], cost: distance(start, end) }
  }

  const channelWidth = requiredChannelWidth(options.colliderWidth)
  const restricted = solve(graph, start, end, channelWidth, clearance, true)
  if (restricted) return foundResult(restricted)

  const unrestricted = solve(graph, start, end, channelWidth, clearance, false)
  if (unrestricted) return { status: 'blocked', reason: 'channel-too-narrow' }

  if (projections(graph.nodes, start, graph.obstacles, channelWidth, clearance, false).length === 0
    || projections(graph.nodes, end, graph.obstacles, channelWidth, clearance, false).length === 0) {
    return { status: 'blocked', reason: 'no-nearest-node' }
  }
  return { status: 'blocked', reason: 'disconnected' }
}

function solve(
  graph: NavigationGraph,
  start: MapPoint,
  end: MapPoint,
  channelWidth: number,
  clearance: number,
  enforceClearance: boolean,
): Candidate | null {
  const nodes = graph.nodes.filter(node => validNode(node)
    && (!enforceClearance || node.channelWidth >= channelWidth)
    && (!enforceClearance || hasRequiredPointClearance(node.point, graph.obstacles, clearance)))
  const nodesById = new Map(nodes.map(node => [node.stableId, node]))
  const startProjections = projections(nodes, start, graph.obstacles, channelWidth, clearance, enforceClearance)
  const endProjections = projections(nodes, end, graph.obstacles, channelWidth, clearance, enforceClearance)
  if (startProjections.length === 0 || endProjections.length === 0) return null

  const adjacency = buildAdjacency(graph.edges, nodesById, graph.obstacles, clearance, enforceClearance)
  const minimumMultiplier = minimumEdgeMultiplier(graph.edges)
  const starts = traversalProjections(startProjections, adjacency, nodes.length, 'start')
  const ends = traversalProjections(endProjections, adjacency, nodes.length, 'end')
  const candidates: Candidate[] = []
  for (const startProjection of starts) {
    for (const endProjection of ends) {
      const result = aStar(startProjection.node, endProjection.node, adjacency, nodesById, minimumMultiplier)
      if (!result) continue
      const rawPoints = deduplicatePoints([
        start, startProjection.node.point,
        ...result.traversals.flatMap(traversal => traversal.points), endProjection.node.point, end,
      ])
      const points = stringPull(rawPoints, graph.obstacles, clearance, enforceClearance)
      candidates.push({
        nodeIds: result.nodeIds,
        points,
        cost: result.cost + startProjection.distance + endProjection.distance,
        tieKey: `${startProjection.node.stableId}\u0000${endProjection.node.stableId}\u0000${result.nodeIds.join('\u0000')}`,
        hardTurn: pathHasHardTurn(points),
      })
    }
  }
  return chooseCandidate(candidates)
}

function chooseCandidate(candidates: Candidate[]): Candidate | null {
  if (candidates.length === 0) return null
  const ordinary = candidates.filter(candidate => !candidate.hardTurn)
  return [...(ordinary.length > 0 ? ordinary : candidates)].sort(compareCandidate)[0] ?? null
}

function compareCandidate(left: Candidate, right: Candidate): number {
  return compareNumber(left.cost, right.cost) || left.tieKey.localeCompare(right.tieKey)
}

export function pathHasHardTurn(points: readonly MapPoint[]): boolean {
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    const next = points[index + 1]
    const incomingX = current.x - previous.x
    const incomingY = current.y - previous.y
    const outgoingX = next.x - current.x
    const outgoingY = next.y - current.y
    const incomingLength = Math.hypot(incomingX, incomingY)
    const outgoingLength = Math.hypot(outgoingX, outgoingY)
    if (incomingLength <= EPSILON || outgoingLength <= EPSILON) continue
    const cosine = (incomingX * outgoingX + incomingY * outgoingY)
      / (incomingLength * outgoingLength)
    if (cosine < HARD_TURN_COSINE - EPSILON) return true
  }
  return false
}

function traversalProjections(
  candidates: Projection[],
  adjacency: Map<string, Traversal[]>,
  nodeCount: number,
  endpoint: 'start' | 'end',
): Projection[] {
  if (nodeCount === 1) return candidates
  if (endpoint === 'start') {
    return candidates.filter(candidate => (
      adjacency.get(candidate.node.stableId)?.length ?? 0
    ) > 0)
  }
  const incoming = new Set<string>()
  for (const traversals of adjacency.values()) {
    for (const traversal of traversals) incoming.add(traversal.to)
  }
  return candidates.filter(candidate => incoming.has(candidate.node.stableId))
}

function projections(
  nodes: NavNode[], point: MapPoint, obstacles: MapPolygon[], channelWidth: number,
  clearance: number, enforceClearance: boolean,
): Projection[] {
  return nodes.filter(node => validNode(node)
      && (!enforceClearance || node.channelWidth >= channelWidth)
      && visibleConnector(point, node.point, obstacles, clearance, enforceClearance))
    .map(node => ({ node, distance: distance(point, node.point) }))
    .sort((left, right) => compareNumber(left.distance, right.distance)
      || left.node.stableId.localeCompare(right.node.stableId))
}

function buildAdjacency(
  edges: NavEdge[], nodesById: Map<string, NavNode>, obstacles: MapPolygon[],
  clearance: number, enforceClearance: boolean,
): Map<string, Traversal[]> {
  const adjacency = new Map<string, Traversal[]>()
  for (const edge of edges) {
    const from = nodesById.get(edge.from)
    const to = nodesById.get(edge.to)
    if (!from || !to || !Number.isFinite(edge.costMultiplier) || edge.costMultiplier <= 0) continue
    const points = deduplicatePoints([from.point, ...edge.points, to.point])
    const length = polylineLength(points)
    if (!Number.isFinite(length) || !visibleConnectorPolyline(points, obstacles, clearance, enforceClearance)) continue
    addTraversal(adjacency, {
      edgeId: edge.stableId,
      from: edge.from,
      to: edge.to,
      cost: length * edge.costMultiplier,
      points,
    })
    if (edge.bidirectional) {
      addTraversal(adjacency, {
        edgeId: edge.stableId,
        from: edge.to,
        to: edge.from,
        cost: length * edge.costMultiplier,
        points: [...points].reverse(),
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
    return { nodeIds: [start.stableId], traversals: [], cost: 0 }
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

function foundResult(candidate: Candidate): PathResult {
  return { status: 'found', points: candidate.points.map(copyPoint), nodeIds: [...candidate.nodeIds], cost: candidate.cost }
}

function stringPull(
  points: MapPoint[],
  obstacles: MapPolygon[],
  clearance: number,
  enforceClearance: boolean,
): MapPoint[] {
  if (!enforceClearance || points.length < 3) return points
  const pulled = [points[0]]
  let anchor = 0
  while (anchor < points.length - 1) {
    let next = points.length - 1
    while (next > anchor + 1
      && !hasRequiredPolylineClearance([points[anchor], points[next]], obstacles, clearance)) {
      next -= 1
    }
    pulled.push(points[next])
    anchor = next
  }
  return deduplicatePoints(pulled)
}

function visibleConnector(
  from: MapPoint,
  to: MapPoint,
  obstacles: MapPolygon[],
  clearance: number,
  enforceClearance: boolean,
): boolean {
  return visibleConnectorPolyline([from, to], obstacles, clearance, enforceClearance)
}

function visibleConnectorPolyline(
  points: MapPoint[],
  obstacles: MapPolygon[],
  clearance: number,
  enforceClearance: boolean,
): boolean {
  return enforceClearance
    ? hasRequiredPolylineClearance(points, obstacles, clearance)
    : hasRequiredPolylineClearance(points, obstacles, 0)
}

function minimumEdgeMultiplier(edges: NavEdge[]): number {
  const values = edges.map(edge => edge.costMultiplier)
    .filter(value => Number.isFinite(value) && value > 0)
  return values.length > 0 ? Math.min(...values) : 0
}

function heuristic(from: NavNode, to: NavNode, minimumMultiplier: number): number {
  return distance(from.point, to.point) * minimumMultiplier
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
    if (!samePoint(result.at(-1), point)) result.push(copyPoint(point))
  }
  return result
}

function validNode(node: NavNode): boolean {
  return node.stableId.length > 0
    && Number.isFinite(node.point.x)
    && Number.isFinite(node.point.y)
    && Number.isFinite(node.channelWidth)
    && node.channelWidth > 0
}

function requireInputs(start: MapPoint, end: MapPoint, colliderWidth: number): void {
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite)) {
    throw new TypeError('Path endpoints must contain finite world-pixel coordinates')
  }
  requiredClearance(colliderWidth)
}

function distance(left: MapPoint, right: MapPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y)
}

function copyPoint(point: MapPoint): MapPoint {
  return { x: point.x, y: point.y }
}

function samePoint(left: MapPoint | undefined, right: MapPoint): boolean {
  if (!left) return false
  return approximatelyEqual(left.x, right.x) && approximatelyEqual(left.y, right.y)
}

function compareNumber(left: number, right: number): number {
  return approximatelyEqual(left, right) ? 0 : left - right
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= EPSILON
}
