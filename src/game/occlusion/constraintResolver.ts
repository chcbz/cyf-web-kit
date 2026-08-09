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
// - Candidates: SpatialGrid per-agent query, never flat all-zones O(A×Z)

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
  compareStableId,
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

// ── Membership state (immutable, cross-frame persistent) ──

export type MembershipState = 'inside' | 'outside'

/**
 * Immutable membership state for cross-frame hysteresis persistence.
 * zoneStableId → Map<agentStableId, MembershipState>
 */
export interface ConstraintMembershipState {
  readonly entries: ReadonlyMap<string, ReadonlyMap<string, MembershipState>>
}

export function createEmptyMembershipState(): ConstraintMembershipState {
  return { entries: new Map() }
}

/**
 * Deep-clone a membership state so the caller cannot mutate the original.
 */
function cloneMembershipState(src: ConstraintMembershipState): {
  entries: Map<string, Map<string, MembershipState>>
} {
  const entries = new Map<string, Map<string, MembershipState>>()
  for (const [zoneId, agentMap] of src.entries) {
    entries.set(zoneId, new Map(agentMap))
  }
  return { entries }
}

/**
 * Build the immutable output from a mutable working copy.
 */
function freezeMembershipOutput(
  working: Map<string, Map<string, MembershipState>>,
): ConstraintMembershipState {
  const entries = new Map<string, ReadonlyMap<string, MembershipState>>()
  for (const [zoneId, agentMap] of working) {
    entries.set(zoneId, new Map(agentMap))
  }
  return { entries }
}

// ── Internal mutable zone membership (polygon + per-agent state) ──

interface ZoneMembershipCache {
  fixedPoly: FixedPolygon
  /** Mutable per-agent state — this is NOT exposed externally */
  state: Map<string, MembershipState>
}

// ── Candidate provider interface ──

/**
 * Provider of spatial candidates for zone membership checks.
 * Implemented by SpatialGrid or test doubles.
 */
export interface ConstraintCandidateProvider {
  /** Return stableIds of entries in nearby cells for a given position. */
  queryCandidates(position: Point, sceneId: string, floorId: string): Set<string>
}

// ── Resolution result ──

export interface ConstraintResolution {
  order: string[]
  edges: ConstraintEdge[]
  /** New membership state to persist for next frame. */
  nextMembership: ConstraintMembershipState
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

// ── Membership resolver (grid-driven, per-agent candidates) ──

/**
 * Resolve memberships using the SpatialGrid candidate provider.
 *
 * For each agent:
 *   1. Query candidateProvider for nearby zones in the same scene/floor
 *   2. Cross-reference with zoneRegistry to get actual zone objects
 *   3. Check signed-distance hysteresis only for those candidate zones
 *
 * This is O(A × C) where C = candidate zones per agent (typically ≤ 9 cells),
 * NOT O(A × Z) where Z = all zones.
 *
 * Uses previous membership state for hysteresis, writes to mutable working copy.
 */
function resolveMembershipsWithGrid(
  agents: ConstraintNode[],
  candidateProvider: ConstraintCandidateProvider,
  zoneRegistry: ReadonlyMap<string, OcclusionConstraintZone>,
  previousState: ReadonlyMap<string, ReadonlyMap<string, MembershipState>>,
  zoneCache: Map<string, ZoneMembershipCache>,
  sceneId: string,
  fullScanThreshold: number,
  instr: ConstraintInstrumentation | undefined,
): { snapshots: Map<string, Map<string, MembershipState>>; workingState: Map<string, Map<string, MembershipState>> } {
  const snapshots = new Map<string, Map<string, MembershipState>>()
  const workingState = new Map<string, Map<string, MembershipState>>()

  let totalMembershipChecks = 0
  const totalZones = zoneRegistry.size

  // Full-scan threshold: if totalZones > 5 and any agent gets all zones as candidates,
  // it indicates the grid is bypassed → hard fatal
  const effectiveThreshold = fullScanThreshold

  for (const agent of agents) {
    if (agent.nodeKind !== 'agent') continue
    if (agent.sceneId !== sceneId) continue
    if (!agent.position) continue

    // 1. Query spatial grid for candidate zone IDs
    const candidateIds = candidateProvider.queryCandidates(
      agent.position, agent.sceneId, agent.floorId,
    )

    // Count actual zone membership checks (only zones in both candidate set and registry)
    let zoneChecksForAgent = 0
    const zoneCandidatesInRegistry = new Set<string>()
    for (const cid of candidateIds) {
      if (zoneRegistry.has(cid)) {
        zoneCandidatesInRegistry.add(cid)
      }
    }

    // 2. Full-scan detection
    if (totalZones > effectiveThreshold && zoneCandidatesInRegistry.size === totalZones) {
      if (instr) instr.fullMapScanDetected = true
      fatal(
        'SPATIAL_GRID_FULL_SCAN_DETECTED' as RenderSchemaErrorCode,
        sceneId,
        agent.stableId,
        'candidateProvider',
        `空间网格全图扫描异常：agent ${agent.stableId} 候选区数量(${zoneCandidatesInRegistry.size})等于全部zone数(${totalZones})`,
        `full map scan detected: agent ${agent.stableId} has ${zoneCandidatesInRegistry.size} candidates == ${totalZones} total zones`,
      )
    }

    // 3. Convert agent position to fixed-point
    const fx = Math.round(agent.position.x * 256)
    const fy = Math.round(agent.position.y * 256)
    const fxNorm = Object.is(fx, -0) ? 0 : fx
    const fyNorm = Object.is(fy, -0) ? 0 : fy

    // 4. For each candidate zone in the registry, check membership
    for (const zoneId of zoneCandidatesInRegistry) {
      const zone = zoneRegistry.get(zoneId)!
      if (zone.sceneId !== sceneId) continue
      if (zone.floorId !== agent.floorId) continue

      zoneChecksForAgent++

      // Ensure zone cache entry
      let zc = zoneCache.get(zoneId)
      if (!zc) {
        zc = {
          fixedPoly: compileFixedPolygon(zone.polygon, zone.sceneId, zone.stableId),
          state: new Map(),
        }
        // Seed from previous membership state
        const prevAgentMap = previousState.get(zoneId)
        if (prevAgentMap) {
          for (const [aid, prev] of prevAgentMap) {
            zc.state.set(aid, prev)
          }
        }
        zoneCache.set(zoneId, zc)
      }

      // Hysteresis check
      const previous = zc.state.get(agent.stableId) ?? null
      const prevBool = previous === 'inside' ? true : previous === 'outside' ? false : null

      const hyst = computeHysteresis(zc.fixedPoly, fxNorm, fyNorm, prevBool)
      const newState: MembershipState = hyst.inside ? 'inside' : 'outside'

      // Record in snapshot
      let zoneSnap = snapshots.get(zoneId)
      if (!zoneSnap) {
        zoneSnap = new Map()
        snapshots.set(zoneId, zoneSnap)
      }
      zoneSnap.set(agent.stableId, newState)

      // Update working state for persistence
      let ws = workingState.get(zoneId)
      if (!ws) {
        ws = new Map()
        workingState.set(zoneId, ws)
      }
      ws.set(agent.stableId, newState)

      // Also update zone cache for future agents in same batch
      zc.state.set(agent.stableId, newState)
    }

    totalMembershipChecks += zoneChecksForAgent
  }

  if (instr) {
    instr.membershipCheckCount = totalMembershipChecks
    instr.candidateCount = agents.filter(a => a.nodeKind === 'agent').length
  }

  return { snapshots, workingState }
}

// ── Edge generation (with zone registry) ──

function generateEdgesWithRegistry(
  nodes: ConstraintNode[],
  zoneRegistry: ReadonlyMap<string, OcclusionConstraintZone>,
  membershipSnapshots: Map<string, Map<string, MembershipState>>,
  sceneId: string,
): ConstraintEdge[] {
  const nodeMap = new Map<string, ConstraintNode>()
  for (const n of nodes) {
    if (nodeMap.has(n.stableId)) {
      fatal('CONSTRAINT_DUPLICATE_NODE' as RenderSchemaErrorCode, sceneId, n.stableId,
        'stableId', `重复 stableId: ${n.stableId}`, `duplicate stableId: ${n.stableId}`)
    }
    nodeMap.set(n.stableId, n)
  }

  // Validate fragment nodes are world-band
  for (const n of nodes) {
    if (n.nodeKind === 'fragment' && n.sortKey.renderBandOrder !== 100) {
      fatal('FRAGMENT_RENDER_BAND_INVALID' as RenderSchemaErrorCode, sceneId, n.stableId,
        'renderBand', `fragment 必须为 world band: ${n.stableId}`,
        `fragment ${n.stableId} renderBandOrder=${n.sortKey.renderBandOrder}, must be world (100)`)
    }
  }

  const rawEdges: Array<{
    from: string; to: string; kind: ConstraintEdgeKind;
    zoneStableId: string; priority: number;
  }> = []

  for (const [zoneId, agentStates] of membershipSnapshots) {
    const zone = zoneRegistry.get(zoneId)
    if (!zone) continue
    if (zone.sceneId !== sceneId) continue

    const targetNode = nodeMap.get(zone.targetFragmentId)
    if (!targetNode) {
      fatal('ZONE_TARGET_NOT_FOUND' as RenderSchemaErrorCode, sceneId, zone.stableId,
        'targetFragmentId', `zone 目标 fragment 未找到: ${zone.targetFragmentId}`,
        `zone target fragment not found: ${zone.targetFragmentId}`)
    }

    // Validate target fragment is world-band
    if (targetNode.nodeKind !== 'fragment') {
      fatal('ZONE_TARGET_NOT_FOUND' as RenderSchemaErrorCode, sceneId, zone.stableId,
        'targetFragmentId', `zone 目标必须是 fragment: ${zone.targetFragmentId}`,
        `zone target ${zone.targetFragmentId} is not a fragment node`)
    }
    if (targetNode.sortKey.renderBandOrder !== 100) {
      fatal('FRAGMENT_RENDER_BAND_INVALID' as RenderSchemaErrorCode, sceneId, zone.stableId,
        'targetFragmentId', `zone 目标 fragment 必须是 world band: ${zone.targetFragmentId}`,
        `target fragment ${zone.targetFragmentId} renderBandOrder=${targetNode.sortKey.renderBandOrder}, must be world (100)`)
    }

    // Cross-scope validation
    if (targetNode.sceneId !== zone.sceneId) {
      fatal('ZONE_TARGET_CROSS_SCENE' as RenderSchemaErrorCode, sceneId, zone.stableId,
        'targetFragmentId', `zone 目标跨 scene: ${zone.sceneId} vs ${targetNode.sceneId}`,
        `cross-scene zone target: ${zone.sceneId} vs ${targetNode.sceneId}`)
    }
    if (targetNode.floorId !== zone.floorId) {
      fatal('ZONE_TARGET_CROSS_FLOOR' as RenderSchemaErrorCode, sceneId, zone.stableId,
        'targetFragmentId', `zone 目标跨 floor: ${zone.floorId} vs ${targetNode.floorId}`,
        `cross-floor zone target: ${zone.floorId} vs ${targetNode.floorId}`)
    }

    for (const [agentId, state] of agentStates) {
      if (state !== 'inside') continue

      const agentNode = nodeMap.get(agentId)
      if (!agentNode) continue
      if (agentNode.sceneId !== zone.sceneId) {
        fatal('CONSTRAINT_CROSS_SCOPE' as RenderSchemaErrorCode, sceneId, zone.stableId,
          'sceneId', `agent 跨 scene: ${agentNode.sceneId} vs ${zone.sceneId}`,
          `cross-scope agent: ${agentNode.sceneId} vs ${zone.sceneId}`)
      }
      if (agentNode.floorId !== zone.floorId) {
        fatal('CONSTRAINT_CROSS_SCOPE' as RenderSchemaErrorCode, sceneId, zone.stableId,
          'floorId', `agent 跨 floor: ${agentNode.floorId} vs ${zone.floorId}`,
          `cross-floor agent: ${agentNode.floorId} vs ${zone.floorId}`)
      }
      if (agentId === zone.targetFragmentId) {
        fatal('CONSTRAINT_SELF_EDGE' as RenderSchemaErrorCode, sceneId, zone.stableId,
          'targetFragmentId', `zone 目标不能是 agent 自身: ${agentId}`,
          `self-edge: agent ${agentId} is zone target`)
      }

      if (zone.relation === 'behind') {
        rawEdges.push({ from: agentId, to: zone.targetFragmentId, kind: 'behind',
          zoneStableId: zone.stableId, priority: zone.priority })
      } else {
        rawEdges.push({ from: zone.targetFragmentId, to: agentId, kind: 'front',
          zoneStableId: zone.stableId, priority: zone.priority })
      }
    }
  }

  // Merge duplicates: group by (from, to)
  const edgeGroups = new Map<string, typeof rawEdges>()
  for (const e of rawEdges) {
    const key = `${e.from}→${e.to}`
    let group = edgeGroups.get(key)
    if (!group) { group = []; edgeGroups.set(key, group) }
    group.push(e)
  }

  const mergedEdges: ConstraintEdge[] = []
  for (const [key, group] of edgeGroups) {
    group.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority
      return compareStableId(a.zoneStableId, b.zoneStableId)
    })

    mergedEdges.push({
      from: group[0].from, to: group[0].to, kind: group[0].kind,
      zoneStableId: group[0].zoneStableId, priority: group[0].priority,
    })

    const reverseKey = `${group[0].to}→${group[0].from}`
    if (edgeGroups.has(reverseKey)) {
      fatal('CONSTRAINT_CONFLICT' as RenderSchemaErrorCode, sceneId, group[0].zoneStableId,
        'relation', `同一对象对同时存在 behind 和 front: ${group[0].from} ↔ ${group[0].to}`,
        `conflicting behind+front: ${group[0].from} ↔ ${group[0].to}`)
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
      fatal('OBJECT_REFERENCE_INVALID' as RenderSchemaErrorCode, sceneId, edge.from,
        'from', `edge 源节点不存在: ${edge.from}`, `edge source not in nodes: ${edge.from}`)
    }
    if (!adj.has(edge.to)) {
      fatal('OBJECT_REFERENCE_INVALID' as RenderSchemaErrorCode, sceneId, edge.to,
        'to', `edge 目标节点不存在: ${edge.to}`, `edge target not in nodes: ${edge.to}`)
    }
    if (edge.from === edge.to) {
      fatal('CONSTRAINT_SELF_EDGE' as RenderSchemaErrorCode, sceneId, edge.from,
        'edge', `不允许自环边: ${edge.from}`, `self-edge: ${edge.from}`)
    }
    adj.get(edge.from)!.push(edge.to)
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1)
  }

  const keyMap = new Map<string, WorldSortKey>()
  for (const n of nodes) keyMap.set(n.stableId, n.sortKey)

  function pqCompare(a: string, b: string): number {
    return compareWorldSortKeys(keyMap.get(a)!, keyMap.get(b)!)
  }

  const zeroQueue: string[] = []
  for (const [id, deg] of indegree) {
    if (deg === 0) zeroQueue.push(id)
  }
  zeroQueue.sort(pqCompare)

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
    fatal('CONSTRAINT_CYCLE_DETECTED' as RenderSchemaErrorCode, sceneId, '(constraint-graph)',
      'constraint-graph', `约束图存在环: 已排序 ${result.length}/${nodes.length}`,
      `constraint graph cycle: sorted ${result.length}/${nodes.length}`)
  }

  return result
}

// ── Main resolver ──

export interface ConstraintResolverOptions {
  now?: () => number
  instrumentation?: ConstraintInstrumentation
  /** Previous membership state for cross-frame hysteresis persistence. */
  previousMembership?: ConstraintMembershipState
  /** Min zone count before full-map-scan detection activates. Default 5. */
  fullScanThreshold?: number
}

/**
 * Resolve constraint-based ordering for all world-band nodes.
 *
 * @param nodes            All active world-band constraint nodes
 * @param candidateProvider SpatialGrid (or test double) for per-agent zone discovery
 * @param zoneRegistry     Authoritative zone registry (stableId → zone)
 * @param floorRegistry    Floor ID → order mapping
 * @param sceneId          Current scene ID
 * @param opts             Optional instrumentation and previous state
 */
export function resolveConstraintOrder(
  nodes: ConstraintNode[],
  candidateProvider: ConstraintCandidateProvider,
  zoneRegistry: ReadonlyMap<string, OcclusionConstraintZone>,
  floorRegistry: Readonly<Record<string, number>>,
  sceneId: string,
  opts?: ConstraintResolverOptions,
): ConstraintResolution {
  const now = opts?.now ?? (() => performance.now())
  const instr = opts?.instrumentation
  const startTime = now()

  // 1. Validate no duplicate nodes
  const seen = new Set<string>()
  for (const n of nodes) {
    if (seen.has(n.stableId)) {
      fatal('CONSTRAINT_DUPLICATE_NODE' as RenderSchemaErrorCode, sceneId, n.stableId,
        'stableId', `重复 stableId: ${n.stableId}`, `duplicate stableId in nodes: ${n.stableId}`)
    }
    seen.add(n.stableId)
  }

  // 2. Validate fragment nodes are world-band (first defense)
  for (const n of nodes) {
    if (n.nodeKind === 'fragment' && n.sortKey.renderBandOrder !== 100) {
      fatal('FRAGMENT_RENDER_BAND_INVALID' as RenderSchemaErrorCode, sceneId, n.stableId,
        'renderBand', `fragment 必须为 world band: ${n.stableId}`,
        `fragment ${n.stableId} renderBandOrder=${n.sortKey.renderBandOrder}, must be world (100)`)
    }
  }

  const agentCount = nodes.filter(n => n.nodeKind === 'agent').length
  const agents = nodes.filter(n => n.nodeKind === 'agent')

  // 3. Clone previous membership state (will NOT be mutated on failure)
  const previousCloned = opts?.previousMembership
    ? cloneMembershipState(opts.previousMembership)
    : { entries: new Map<string, Map<string, MembershipState>>() }

  // 4. Resolve memberships using spatial grid (NOT flat all-zones)
  const zoneCache = new Map<string, ZoneMembershipCache>()
  const { snapshots, workingState } = resolveMembershipsWithGrid(
    agents, candidateProvider, zoneRegistry,
    previousCloned.entries, zoneCache, sceneId,
    opts?.fullScanThreshold ?? 5, instr,
  )

  // 5. Generate edges
  const edges = generateEdgesWithRegistry(nodes, zoneRegistry, snapshots, sceneId)

  // 6. Kahn sort
  const order = kahnSort(nodes, edges, sceneId)

  const endTime = now()

  // 7. Populate instrumentation
  if (instr) {
    instr.edgeCount = edges.length
    instr.sortDurationMs = endTime - startTime
    instr.zoneCount = zoneRegistry.size
    instr.agentCount = agentCount
    instr.cycleDetected = false
  }

  // 8. Build immutable output membership state
  const nextMembership = freezeMembershipOutput(workingState)

  return { order, edges, nextMembership }
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

/**
 * Convert a canonical OccluderFragment to a ConstraintNode.
 * Strictly validates: must be world-band, must have valid chunkId.
 */
export interface FragmentNodeInput {
  stableId: string
  sceneId: string
  chunkId: string
  floorId: string
  elevation: number
  sortAnchor: Point
  tieBias: number
  renderBand: 'world' | 'overhead'
}

export function fragmentToConstraintNode(
  fragment: FragmentNodeInput,
  floorRegistry: Readonly<Record<string, number>>,
): ConstraintNode {
  // P0-3: Only world-band fragments can become constraint nodes
  if (fragment.renderBand !== 'world') {
    throw renderSchemaError(
      'FRAGMENT_RENDER_BAND_INVALID' as RenderSchemaErrorCode,
      fragment.sceneId,
      fragment.stableId,
      'renderBand',
      `fragment 必须为 world band 才能参与约束排序: ${fragment.stableId} (当前: ${fragment.renderBand})`,
      `fragment ${fragment.stableId} has renderBand=${fragment.renderBand}, only 'world' allowed for constraint nodes`,
    )
  }

  // P1-5: chunkId must be non-empty
  if (!fragment.chunkId || typeof fragment.chunkId !== 'string' || fragment.chunkId.trim() === '') {
    throw renderSchemaError(
      'CHUNK_ID_INVALID' as RenderSchemaErrorCode,
      fragment.sceneId,
      fragment.stableId,
      'chunkId',
      `fragment chunkId 缺失或为空: ${fragment.stableId}`,
      `fragment ${fragment.stableId} has invalid chunkId: "${String(fragment.chunkId)}"`,
    )
  }

  const pseudoObj: SceneObject = {
    stableId: fragment.stableId,
    sceneId: fragment.sceneId,
    chunkId: fragment.chunkId,
    kind: 'occluder-fragment',
    renderBand: fragment.renderBand,
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
