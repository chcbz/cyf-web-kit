// ── E5 Constraint Resolver ──
// Sparse mandatory-edge Kahn topological sort for world-band objects.
// Frozen contract per §5.4, §7.2–§7.4 of juyiting-occlusion-system-design.md.
//
// - Nodes: ALL active world-band SceneObjects (+ adapted fragments)
// - Edges: only from currently-effective OcclusionConstraintZones
// - behind: agent → targetFragment
// - front:  targetFragment → agent
// - Same-direction merges: priority desc, stableId ASCII asc
// - Opposite-direction same pair: immediate fatal
// - Kahn: zero-indegree priority queue uses base WorldSortKey
// - Output < input → cycle fatal (no stable fallback)
// - Membership: E4 signed distance + 3px hysteresis, per-agent-zone state

import {
  type OcclusionConstraintZone,
  type SceneObject,
  type Point,
  renderSchemaError,
  type RenderSchemaErrorCode,
} from './schema.js'
import {
  type WorldSortKey,
  compareWorldSortKeys,
  computeWorldSortKey,
} from './worldOrder.js'
import { compileFixedPolygon } from './validation.js'
import {
  computeHysteresis,
  type FixedPolygon,
} from './polygonGeometry.js'

// ── Constraint node ──

export interface ConstraintNode {
  stableId: string
  sceneId: string
  floorId: string
  nodeKind: 'agent' | 'fragment' | 'other'
  sortKey: WorldSortKey
  position?: Point
}

// ── Edge types ──

export type ConstraintEdgeKind = 'behind' | 'front'

export interface ConstraintEdge {
  from: string
  to: string
  kind: ConstraintEdgeKind
  zoneStableId: string
  priority: number
}

// ── Membership state ──

type MembershipState = 'inside' | 'outside'

interface ZoneMembership {
  fixedPoly: FixedPolygon
  state: Map<string, MembershipState>
}

// ── Resolution result ──

export interface ConstraintResolution {
  order: string[]
  edges: ConstraintEdge[]
  membershipSnapshots: Map<string, Map<string, MembershipState>>
}

// ── Instrumentation (mutable, externally readable) ──

export interface ConstraintInstrumentation {
  candidateCount: number
  membershipCheckCount: number
  edgeCount: number
  sortDurationMs: number
  fullMapScanDetected: boolean
  zoneCount: number
  agentCount: number
  cycleDetected: boolean
}

export function createConstraintInstrumentation(): ConstraintInstrumentation {
  return {
    candidateCount: 0,
    membershipCheckCount: 0,
    edgeCount: 0,
    sortDurationMs: 0,
    fullMapScanDetected: false,
    zoneCount: 0,
    agentCount: 0,
    cycleDetected: false,
  }
}

// ── Error helpers ──

function fatal(
  code: RenderSchemaErrorCode,
  sceneId: string,
  objectId: string,
  field: string,
  userMessage: string,
  technicalMessage: string,
): never {
  throw renderSchemaError(code, sceneId, objectId, field, userMessage, technicalMessage)
}

// ── ASCII byte comparison (no localeCompare) ──

function asciiCompare(a: string, b: string): number {
  const minLen = Math.min(a.length, b.length)
  for (let i = 0; i < minLen; i++) {
    const ca = a.charCodeAt(i)
    const cb = b.charCodeAt(i)
    if (ca !== cb) return ca - cb
  }
  return a.length - b.length
}

// ── Membership resolver ──

function resolveAllMemberships(
  agents: ConstraintNode[],
  zones: OcclusionConstraintZone[],
  zoneMemberships: Map<string, ZoneMembership>,
  sceneId: string,
): Map<string, Map<string, MembershipState>> {
  const result = new Map<string, Map<string, MembershipState>>()

  for (const zone of zones) {
    if (zone.sceneId !== sceneId) continue

    let zm = zoneMemberships.get(zone.stableId)
    if (!zm) {
      zm = {
        fixedPoly: compileFixedPolygon(zone.polygon, zone.sceneId, zone.stableId),
        state: new Map(),
      }
      zoneMemberships.set(zone.stableId, zm)
    }

    const zoneAgentStates = new Map<string, MembershipState>()
    result.set(zone.stableId, zoneAgentStates)

    for (const agent of agents) {
      if (agent.nodeKind !== 'agent') continue
      if (agent.sceneId !== sceneId) continue
      if (agent.floorId !== zone.floorId) continue
      if (!agent.position) continue

      const fx = Math.round(agent.position.x * 256)
      const fy = Math.round(agent.position.y * 256)
      const fxNorm = Object.is(fx, -0) ? 0 : fx
      const fyNorm = Object.is(fy, -0) ? 0 : fy

      const previous = zm.state.get(agent.stableId) ?? null
      const prevBool = previous === 'inside' ? true : previous === 'outside' ? false : null

      const hyst = computeHysteresis(zm.fixedPoly, fxNorm, fyNorm, prevBool)

      const newState: MembershipState = hyst.inside ? 'inside' : 'outside'
      zoneAgentStates.set(agent.stableId, newState)
      zm.state.set(agent.stableId, newState)
    }
  }

  return result
}

// ── Edge generation ──

function generateEdges(
  nodes: ConstraintNode[],
  zones: OcclusionConstraintZone[],
  membershipSnapshots: Map<string, Map<string, MembershipState>>,
  sceneId: string,
): ConstraintEdge[] {
  // Build node lookup
  const nodeMap = new Map<string, ConstraintNode>()
  for (const n of nodes) {
    if (nodeMap.has(n.stableId)) {
      fatal(
        'CONSTRAINT_DUPLICATE_NODE' as RenderSchemaErrorCode,
        sceneId,
        n.stableId,
        'stableId',
        `重复 stableId: ${n.stableId}`,
        `duplicate stableId in constraint node set: ${n.stableId}`,
      )
    }
    nodeMap.set(n.stableId, n)
  }

  // Collect raw edges
  const rawEdges: Array<{
    from: string; to: string; kind: ConstraintEdgeKind;
    zoneStableId: string; priority: number;
  }> = []

  for (const zone of zones) {
    if (zone.sceneId !== sceneId) continue

    const agentStates = membershipSnapshots.get(zone.stableId)
    if (!agentStates) continue

    const targetNode = nodeMap.get(zone.targetFragmentId)
    if (!targetNode) {
      fatal(
        'ZONE_TARGET_NOT_FOUND' as RenderSchemaErrorCode,
        sceneId,
        zone.stableId,
        'targetFragmentId',
        `zone 目标 fragment 未找到: ${zone.targetFragmentId}`,
        `zone target fragment not found: ${zone.targetFragmentId}`,
      )
    }

    // Cross-scope validation
    if (targetNode.sceneId !== zone.sceneId) {
      fatal(
        'ZONE_TARGET_CROSS_SCENE' as RenderSchemaErrorCode,
        sceneId,
        zone.stableId,
        'targetFragmentId',
        `zone 目标跨 scene: zone=${zone.sceneId}, target=${targetNode.sceneId}`,
        `cross-scene zone target: ${zone.sceneId} vs ${targetNode.sceneId}`,
      )
    }
    if (targetNode.floorId !== zone.floorId) {
      fatal(
        'ZONE_TARGET_CROSS_FLOOR' as RenderSchemaErrorCode,
        sceneId,
        zone.stableId,
        'targetFragmentId',
        `zone 目标跨 floor: zone=${zone.floorId}, target=${targetNode.floorId}`,
        `cross-floor zone target: ${zone.floorId} vs ${targetNode.floorId}`,
      )
    }

    for (const [agentId, state] of agentStates) {
      if (state !== 'inside') continue

      const agentNode = nodeMap.get(agentId)
      if (!agentNode) continue
      if (agentNode.sceneId !== zone.sceneId) {
        fatal(
          'CONSTRAINT_CROSS_SCOPE' as RenderSchemaErrorCode,
          sceneId,
          zone.stableId,
          'sceneId',
          `agent 跨 scene: agent=${agentNode.sceneId}, zone=${zone.sceneId}`,
          `cross-scope agent in zone: agent scene=${agentNode.sceneId}, zone scene=${zone.sceneId}`,
        )
      }
      if (agentNode.floorId !== zone.floorId) {
        fatal(
          'CONSTRAINT_CROSS_SCOPE' as RenderSchemaErrorCode,
          sceneId,
          zone.stableId,
          'floorId',
          `agent 跨 floor: agent=${agentNode.floorId}, zone=${zone.floorId}`,
          `cross-floor agent in zone: agent floor=${agentNode.floorId}, zone floor=${zone.floorId}`,
        )
      }

      // Self-edge check
      if (agentId === zone.targetFragmentId) {
        fatal(
          'CONSTRAINT_SELF_EDGE' as RenderSchemaErrorCode,
          sceneId,
          zone.stableId,
          'targetFragmentId',
          `zone 目标不能是 agent 自身: ${agentId}`,
          `self-edge: agent ${agentId} is zone target`,
        )
      }

      if (zone.relation === 'behind') {
        rawEdges.push({
          from: agentId,
          to: zone.targetFragmentId,
          kind: 'behind',
          zoneStableId: zone.stableId,
          priority: zone.priority,
        })
      } else {
        rawEdges.push({
          from: zone.targetFragmentId,
          to: agentId,
          kind: 'front',
          zoneStableId: zone.stableId,
          priority: zone.priority,
        })
      }
    }
  }

  // Merge duplicates: group by (from, to)
  const edgeGroups = new Map<string, typeof rawEdges>()
  for (const e of rawEdges) {
    const key = `${e.from}→${e.to}`
    let group = edgeGroups.get(key)
    if (!group) {
      group = []
      edgeGroups.set(key, group)
    }
    group.push(e)
  }

  // Resolve each group
  const mergedEdges: ConstraintEdge[] = []

  for (const [key, group] of edgeGroups) {
    group.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority // desc
      return asciiCompare(a.zoneStableId, b.zoneStableId) // asc
    })

    mergedEdges.push({
      from: group[0].from,
      to: group[0].to,
      kind: group[0].kind,
      zoneStableId: group[0].zoneStableId,
      priority: group[0].priority,
    })

    // Check for reverse edge
    const reverseKey = `${group[0].to}→${group[0].from}`
    if (edgeGroups.has(reverseKey)) {
      fatal(
        'CONSTRAINT_CONFLICT' as RenderSchemaErrorCode,
        sceneId,
        group[0].zoneStableId,
        'relation',
        `同一对象对同时存在 behind 和 front 约束: ${group[0].from} ↔ ${group[0].to}`,
        `conflicting behind+front on same pair: ${group[0].from} ↔ ${group[0].to}`,
      )
    }
  }

  return mergedEdges
}

// ── Kahn topological sort ──

function kahnSort(
  nodes: ConstraintNode[],
  edges: ConstraintEdge[],
  sceneId: string,
): string[] {
  const adj = new Map<string, string[]>()
  const indegree = new Map<string, number>()

  for (const node of nodes) {
    adj.set(node.stableId, [])
    indegree.set(node.stableId, 0)
  }

  for (const edge of edges) {
    if (!adj.has(edge.from)) {
      fatal(
        'OBJECT_REFERENCE_INVALID' as RenderSchemaErrorCode,
        sceneId,
        edge.from,
        'from',
        `edge 源节点不存在: ${edge.from}`,
        `edge source not in node set: ${edge.from}`,
      )
    }
    if (!adj.has(edge.to)) {
      fatal(
        'OBJECT_REFERENCE_INVALID' as RenderSchemaErrorCode,
        sceneId,
        edge.to,
        'to',
        `edge 目标节点不存在: ${edge.to}`,
        `edge target not in node set: ${edge.to}`,
      )
    }
    // Self-edge check
    if (edge.from === edge.to) {
      fatal(
        'CONSTRAINT_SELF_EDGE' as RenderSchemaErrorCode,
        sceneId,
        edge.from,
        'edge',
        `不允许自环边: ${edge.from}`,
        `self-edge not allowed: ${edge.from}`,
      )
    }
    adj.get(edge.from)!.push(edge.to)
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1)
  }

  // Build sort key lookup
  const keyMap = new Map<string, WorldSortKey>()
  for (const n of nodes) keyMap.set(n.stableId, n.sortKey)

  // Priority queue comparator
  function pqCompare(a: string, b: string): number {
    return compareWorldSortKeys(keyMap.get(a)!, keyMap.get(b)!)
  }

  // Collect zero-indegree
  const zeroQueue: string[] = []
  for (const [id, deg] of indegree) {
    if (deg === 0) zeroQueue.push(id)
  }
  zeroQueue.sort(pqCompare)

  // Binary insert helper
  function pushQueue(id: string) {
    let lo = 0, hi = zeroQueue.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (pqCompare(id, zeroQueue[mid]) < 0) hi = mid
      else lo = mid + 1
    }
    zeroQueue.splice(lo, 0, id)
  }

  const result: string[] = []

  while (zeroQueue.length > 0) {
    const current = zeroQueue.shift()!
    result.push(current)

    for (const neighbor of adj.get(current) ?? []) {
      const newDeg = (indegree.get(neighbor) ?? 1) - 1
      indegree.set(neighbor, newDeg)
      if (newDeg === 0) pushQueue(neighbor)
    }
  }

  if (result.length < nodes.length) {
    fatal(
      'CONSTRAINT_CYCLE_DETECTED' as RenderSchemaErrorCode,
      sceneId,
      '(constraint-graph)',
      'constraint-graph',
      `约束图存在环: 已排序 ${result.length}/${nodes.length}`,
      `constraint graph cycle: sorted ${result.length}/${nodes.length}`,
    )
  }

  return result
}

// ── Main resolver ──

export interface ConstraintResolverOptions {
  now?: () => number
  instrumentation?: ConstraintInstrumentation
}

/**
 * Resolve constraint-based ordering for all world-band nodes.
 */
export function resolveConstraintOrder(
  nodes: ConstraintNode[],
  zones: OcclusionConstraintZone[],
  _floorRegistry: Readonly<Record<string, number>>,
  sceneId: string,
  opts?: ConstraintResolverOptions,
): ConstraintResolution {
  const now = opts?.now ?? (() => performance.now())
  const instr = opts?.instrumentation
  const startTime = now()

  // Validate no duplicate nodes
  const seen = new Set<string>()
  for (const n of nodes) {
    if (seen.has(n.stableId)) {
      fatal(
        'CONSTRAINT_DUPLICATE_NODE' as RenderSchemaErrorCode,
        sceneId,
        n.stableId,
        'stableId',
        `重复 stableId: ${n.stableId}`,
        `duplicate stableId in nodes: ${n.stableId}`,
      )
    }
    seen.add(n.stableId)
  }

  // Count agents and zones
  const agentCount = nodes.filter(n => n.nodeKind === 'agent').length

  // Resolve memberships (frozen position snapshot)
  const agents = nodes.filter(n => n.nodeKind === 'agent')
  const zoneMemberships = new Map<string, ZoneMembership>()
  const membershipSnapshots = resolveAllMemberships(agents, zones, zoneMemberships, sceneId)

  // Count membership checks
  let membershipCheckCount = 0
  for (const snap of membershipSnapshots.values()) {
    membershipCheckCount += snap.size
  }

  // Generate edges
  const edges = generateEdges(nodes, zones, membershipSnapshots, sceneId)

  // Kahn sort
  const order = kahnSort(nodes, edges, sceneId)

  const endTime = now()

  // Populate instrumentation
  if (instr) {
    instr.candidateCount = nodes.length
    instr.membershipCheckCount = membershipCheckCount
    instr.edgeCount = edges.length
    instr.sortDurationMs = endTime - startTime
    instr.zoneCount = zones.length
    instr.agentCount = agentCount
    instr.cycleDetected = false
  }

  return { order, edges, membershipSnapshots }
}

// ── Node factories ──

export function sceneObjectToConstraintNode(
  obj: SceneObject,
  floorRegistry: Readonly<Record<string, number>>,
): ConstraintNode {
  return {
    stableId: obj.stableId,
    sceneId: obj.sceneId,
    floorId: obj.floorId,
    nodeKind: obj.kind === 'agent' ? 'agent' : 'other',
    sortKey: computeWorldSortKey(obj, floorRegistry),
    position: (obj.kind === 'agent' && obj.sortAnchor) ? { ...obj.sortAnchor } : undefined,
  }
}

export function fragmentToConstraintNode(
  fragment: {
    stableId: string; sceneId: string; floorId: string;
    elevation: number; sortAnchor: Point; tieBias: number;
    renderBand: string;
  },
  floorRegistry: Readonly<Record<string, number>>,
): ConstraintNode {
  const pseudoObj: SceneObject = {
    stableId: fragment.stableId,
    sceneId: fragment.sceneId,
    chunkId: '',
    kind: 'occluder-fragment',
    renderBand: fragment.renderBand as SceneObject['renderBand'],
    floorId: fragment.floorId,
    elevation: fragment.elevation,
    sortMode: 'fixed',
    sortAnchor: fragment.sortAnchor,
    tieBias: fragment.tieBias,
  }
  return {
    stableId: fragment.stableId,
    sceneId: fragment.sceneId,
    floorId: fragment.floorId,
    nodeKind: 'fragment',
    sortKey: computeWorldSortKey(pseudoObj, floorRegistry),
    position: undefined,
  }
}
