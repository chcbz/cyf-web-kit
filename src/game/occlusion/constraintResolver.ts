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
// - Candidates: trusted SpatialGrid per-agent query; unbranded providers rejected

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
import {
  SPATIAL_GRID_PROVIDER_BRAND,
  type SpatialGridCandidateProvider,
  isSpatialGridProvider,
} from './spatialGrid.js'

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

// ── Membership state (deep-frozen, cross-frame persistent) ──

export type MembershipState = 'inside' | 'outside'

/**
 * Truly immutable membership state for cross-frame hysteresis persistence.
 * Deep-frozen plain objects: Record<zoneStableId, Record<agentStableId, MembershipState>>
 * No Map — cannot be mutated via .set/.delete/.clear.
 */
export type ConstraintMembershipState = Readonly<Record<string, Readonly<Record<string, MembershipState>>>>

type MembershipByAgent = ReadonlyMap<string, ReadonlyMap<string, MembershipState>>

// Cross-frame membership snapshots are immutable objects. Keep their sparse
// agent-oriented view in a WeakMap so the next frame can preserve hysteresis
// without rebuilding the inverse index or scanning agents × all zones.
const MEMBERSHIP_BY_AGENT_CACHE = new WeakMap<ConstraintMembershipState, MembershipByAgent>()

export function createEmptyMembershipState(): ConstraintMembershipState {
  const empty = Object.freeze({})
  MEMBERSHIP_BY_AGENT_CACHE.set(empty, new Map())
  return empty
}

function membershipByAgent(state: ConstraintMembershipState): MembershipByAgent {
  const cached = MEMBERSHIP_BY_AGENT_CACHE.get(state)
  if (cached) return cached

  // Compatibility path for externally constructed frozen test/restore state.
  const inverted = new Map<string, Map<string, MembershipState>>()
  for (const zoneId of Object.keys(state)) {
    for (const [agentId, membership] of Object.entries(state[zoneId])) {
      let agentStates = inverted.get(agentId)
      if (!agentStates) {
        agentStates = new Map()
        inverted.set(agentId, agentStates)
      }
      agentStates.set(zoneId, membership)
    }
  }
  MEMBERSHIP_BY_AGENT_CACHE.set(state, inverted)
  return inverted
}

function freezeMembershipOutput(
  working: Map<string, Map<string, MembershipState>>,
): ConstraintMembershipState {
  const out: Record<string, Record<string, MembershipState>> = {}
  const inverted = new Map<string, Map<string, MembershipState>>()
  for (const [zoneId, agentMap] of working) {
    const inner: Record<string, MembershipState> = {}
    for (const [agentId, membership] of agentMap) {
      inner[agentId] = membership
      let agentStates = inverted.get(agentId)
      if (!agentStates) {
        agentStates = new Map()
        inverted.set(agentId, agentStates)
      }
      agentStates.set(zoneId, membership)
    }
    out[zoneId] = Object.freeze(inner)
  }
  const frozen = Object.freeze(out)
  MEMBERSHIP_BY_AGENT_CACHE.set(frozen, inverted)
  return frozen
}

// ── Internal mutable zone membership (polygon + per-agent state) ──

interface ZoneMembershipCache {
  fixedPoly: FixedPolygon
}

// Canonical zone objects are scene-static. Cache their validated fixed-point
// representation across frames so exact polygon checks do not recompile the
// same geometry on every resolver call.
const COMPILED_ZONE_POLYGONS = new WeakMap<OcclusionConstraintZone, FixedPolygon>()

function compiledZonePolygon(zone: OcclusionConstraintZone): FixedPolygon {
  const cached = COMPILED_ZONE_POLYGONS.get(zone)
  if (cached) return cached
  const compiled = compileFixedPolygon(zone.polygon, zone.sceneId, zone.stableId)
  COMPILED_ZONE_POLYGONS.set(zone, compiled)
  return compiled
}

// ── Candidate provider interface ──

/**
 * Provider of spatial candidates for zone membership checks.
 * The resolver only accepts providers stamped with SPATIAL_GRID_PROVIDER_BRAND
 * (created via SpatialGrid.createConstraintCandidateProvider()).
 *
 * Test doubles use `createTestCandidateProvider()` with explicit opt-out.
 */
export interface ConstraintCandidateProvider {
  /** Unforgeable provenance brand, checked by resolver */
  readonly _brand?: typeof SPATIAL_GRID_PROVIDER_BRAND
  /** Return stableIds of entries in nearby cells for a given position. */
  queryCandidates(position: Point, sceneId: string, floorId: string): Set<string>
}

// ── Test candidate provider factory ──

/**
 * Create a test candidate provider that is EXPLICITLY marked as non-grid.
 * The resolver accepts this only when `trustTestProvider = true`.
 */
export const TEST_PROVIDER_BRAND = Symbol('test-candidate-provider')

export function createTestCandidateProvider(
  queryFn: (position: Point, sceneId: string, floorId: string) => Set<string>,
): ConstraintCandidateProvider & { _testBrand: typeof TEST_PROVIDER_BRAND } {
  return {
    _brand: undefined,
    _testBrand: TEST_PROVIDER_BRAND,
    queryCandidates: queryFn,
  }
}

// ── Resolution result ──

export interface ConstraintResolution {
  order: string[]
  edges: ConstraintEdge[]
  /** New membership state to persist for next frame (deep-frozen). */
  nextMembership: ConstraintMembershipState
}

// ── Instrumentation (mutable, externally readable) ──

export interface ConstraintInstrumentation {
  /** Per-agent membership-check counts (index aligned with agents in node order) */
  perAgentCheckCounts: number[]
  /** Cumulative number of unique candidate zone IDs across all agents */
  uniqueCandidateCount: number
  membershipCheckCount: number
  edgeCount: number
  sortDurationMs: number
  zoneCount: number
  agentCount: number
  cycleDetected: boolean
  /** Whether the candidate provider is a trusted SpatialGrid provider */
  providerTrusted: boolean
}

export function createConstraintInstrumentation(): ConstraintInstrumentation {
  return {
    perAgentCheckCounts: [],
    uniqueCandidateCount: 0,
    membershipCheckCount: 0,
    edgeCount: 0,
    sortDurationMs: 0,
    zoneCount: 0,
    agentCount: 0,
    cycleDetected: false,
    providerTrusted: false,
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

// ── Zone registry pre-validation (P2 fix) ──

/**
 * Validate every zone in the registry BEFORE any membership checks.
 * Checks: target fragment exists in nodes, is world-band, same scene/floor.
 * Fatal even with zero agents inside. Runs once per resolve call.
 */
function preValidateZoneRegistry(
  zoneRegistry: ReadonlyMap<string, OcclusionConstraintZone>,
  nodeMap: ReadonlyMap<string, ConstraintNode>,
  sceneId: string,
): void {
  for (const [zoneId, zone] of zoneRegistry) {
    if (zone.sceneId !== sceneId) continue

    // target fragment must exist in nodes
    const target = nodeMap.get(zone.targetFragmentId)
    if (!target) {
      fatal('ZONE_TARGET_NOT_FOUND' as RenderSchemaErrorCode, sceneId, zone.stableId,
        'targetFragmentId', `zone 目标 fragment 未找到: ${zone.targetFragmentId}`,
        `zone target fragment not found: ${zone.targetFragmentId}`)
    }

    // target must be a fragment node
    if (target.nodeKind !== 'fragment') {
      fatal('ZONE_TARGET_NOT_FOUND' as RenderSchemaErrorCode, sceneId, zone.stableId,
        'targetFragmentId', `zone 目标必须是 fragment: ${zone.targetFragmentId} (当前: ${target.nodeKind})`,
        `zone target ${zone.targetFragmentId} is not a fragment node (got ${target.nodeKind})`)
    }

    // target must be world-band
    if (target.sortKey.renderBandOrder !== 100) {
      fatal('FRAGMENT_RENDER_BAND_INVALID' as RenderSchemaErrorCode, sceneId, zone.stableId,
        'targetFragmentId', `zone 目标 fragment 必须是 world band: ${zone.targetFragmentId}`,
        `target ${zone.targetFragmentId} renderBandOrder=${target.sortKey.renderBandOrder}, must be world (100)`)
    }

    // same scene
    if (target.sceneId !== zone.sceneId) {
      fatal('ZONE_TARGET_CROSS_SCENE' as RenderSchemaErrorCode, sceneId, zone.stableId,
        'targetFragmentId', `zone 目标跨 scene: ${zone.sceneId} vs ${target.sceneId}`,
        `cross-scene target: ${zone.sceneId} vs ${target.sceneId}`)
    }

    // same floor
    if (target.floorId !== zone.floorId) {
      fatal('ZONE_TARGET_CROSS_FLOOR' as RenderSchemaErrorCode, sceneId, zone.stableId,
        'targetFragmentId', `zone 目标跨 floor: ${zone.floorId} vs ${target.floorId}`,
        `cross-floor target: ${zone.floorId} vs ${target.floorId}`)
    }
  }
}

// ── Membership resolver (grid-driven, per-agent candidates) ──

function resolveMembershipsWithGrid(
  agents: ConstraintNode[],
  candidateProvider: ConstraintCandidateProvider,
  zoneRegistry: ReadonlyMap<string, OcclusionConstraintZone>,
  previousState: ConstraintMembershipState,
  zoneCache: Map<string, ZoneMembershipCache>,
  sceneId: string,
  instr: ConstraintInstrumentation | undefined,
): { snapshots: Map<string, Map<string, MembershipState>>; workingState: Map<string, Map<string, MembershipState>> } {
  const snapshots = new Map<string, Map<string, MembershipState>>()
  const workingState = new Map<string, Map<string, MembershipState>>()
  const uniqueCandidates = new Set<string>()

  const perAgentCounts: number[] = []
  let totalChecks = 0

  const previousByAgent = membershipByAgent(previousState)

  for (const agent of agents) {
    if (agent.nodeKind !== 'agent') continue
    if (agent.sceneId !== sceneId) continue
    if (!agent.position) continue

    // Query spatial grid for candidate zone IDs
    const candidateIds = candidateProvider.queryCandidates(
      agent.position, agent.sceneId, agent.floorId,
    )

    // Production providers already return only zone IDs. Keep the
    // registry check for explicit test providers without allocating another Set.
    for (const cid of candidateIds) {
      if (zoneRegistry.has(cid)) uniqueCandidates.add(cid)
    }

    // A zone that was tracked last frame but is no longer returned by the
    // spatial query is necessarily outside the local neighborhood. Persist an
    // explicit outside state so a later boundary re-entry still requires the
    // frozen +3px transition instead of being treated as a first sample.
    const priorAgentStates = previousByAgent.get(agent.stableId)
    if (priorAgentStates) {
      for (const zoneId of priorAgentStates.keys()) {
        if (candidateIds.has(zoneId)) continue
        const zone = zoneRegistry.get(zoneId)
        if (!zone || zone.sceneId !== sceneId || zone.floorId !== agent.floorId) continue
        let ws = workingState.get(zoneId)
        if (!ws) {
          ws = new Map()
          workingState.set(zoneId, ws)
        }
        ws.set(agent.stableId, 'outside')
      }
    }

    // Convert agent position to fixed-point
    const fx = Math.round(agent.position.x * 256)
    const fy = Math.round(agent.position.y * 256)
    const fxNorm = Object.is(fx, -0) ? 0 : fx
    const fyNorm = Object.is(fy, -0) ? 0 : fy

    let checksForAgent = 0

    for (const zoneId of candidateIds) {
      const zone = zoneRegistry.get(zoneId)
      if (!zone) continue
      if (zone.sceneId !== sceneId) continue
      if (zone.floorId !== agent.floorId) continue

      // SpatialGrid cells are deliberately coarse. Before the expensive exact
      // fixed-point polygon distance, reject points outside the zone AABB plus
      // the frozen 3px hysteresis margin. This is semantically equivalent:
      // outside that expanded AABB the signed distance cannot cross either
      // membership threshold, so no edge can be active.
      const margin = zone.hysteresisPx
      if (
        agent.position.x < zone.bounds.x - margin ||
        agent.position.x > zone.bounds.x + zone.bounds.width + margin ||
        agent.position.y < zone.bounds.y - margin ||
        agent.position.y > zone.bounds.y + zone.bounds.height + margin
      ) {
        // Preserve an existing outside state so returning through the 3px
        // boundary still observes hysteresis. An existing inside state is now
        // provably outside and is demoted without exact polygon work.
        if (previousState[zoneId]?.[agent.stableId]) {
          let ws = workingState.get(zoneId)
          if (!ws) {
            ws = new Map()
            workingState.set(zoneId, ws)
          }
          ws.set(agent.stableId, 'outside')
        }
        continue
      }

      checksForAgent++

      // Ensure zone cache entry
      let zc = zoneCache.get(zoneId)
      if (!zc) {
        zc = { fixedPoly: compiledZonePolygon(zone) }
        zoneCache.set(zoneId, zc)
      }

      // Hysteresis check reads the immutable prior frame directly. Each
      // agent-zone pair is evaluated once, so a duplicate mutable state Map is
      // unnecessary.
      const previous = previousState[zoneId]?.[agent.stableId] ?? null
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
    }

    perAgentCounts.push(checksForAgent)
    totalChecks += checksForAgent
  }

  if (instr) {
    instr.perAgentCheckCounts = perAgentCounts
    instr.uniqueCandidateCount = uniqueCandidates.size
    instr.membershipCheckCount = totalChecks
  }

  return { snapshots, workingState }
}

// ── Edge generation (with zone registry) ──

function generateEdgesWithRegistry(
  nodeMap: ReadonlyMap<string, ConstraintNode>,
  zoneRegistry: ReadonlyMap<string, OcclusionConstraintZone>,
  membershipSnapshots: Map<string, Map<string, MembershipState>>,
  sceneId: string,
): ConstraintEdge[] {
  const rawEdges: Array<{
    from: string; to: string; kind: ConstraintEdgeKind;
    zoneStableId: string; priority: number;
  }> = []

  for (const [zoneId, agentStates] of membershipSnapshots) {
    const zone = zoneRegistry.get(zoneId)
    if (!zone) continue
    if (zone.sceneId !== sceneId) continue

    // Pre-validation already verified target exists and is valid
    const targetNode = nodeMap.get(zone.targetFragmentId)
    if (!targetNode) continue // unreachable after preValidateZoneRegistry

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

  // Binary min-heap preserves the exact WorldSortKey ordering while
  // avoiding Array.shift/splice element moves on every Kahn step.
  const zeroHeap: string[] = []

  function heapPush(id: string): void {
    let index = zeroHeap.length
    zeroHeap.push(id)
    while (index > 0) {
      const parent = (index - 1) >>> 1
      if (pqCompare(zeroHeap[parent], id) <= 0) break
      zeroHeap[index] = zeroHeap[parent]
      index = parent
    }
    zeroHeap[index] = id
  }

  function heapPop(): string | undefined {
    if (zeroHeap.length === 0) return undefined
    const first = zeroHeap[0]
    const last = zeroHeap.pop()!
    if (zeroHeap.length === 0) return first
    let index = 0
    while (true) {
      const left = index * 2 + 1
      if (left >= zeroHeap.length) break
      const right = left + 1
      let child = left
      if (right < zeroHeap.length && pqCompare(zeroHeap[right], zeroHeap[left]) < 0) child = right
      if (pqCompare(last, zeroHeap[child]) <= 0) break
      zeroHeap[index] = zeroHeap[child]
      index = child
    }
    zeroHeap[index] = last
    return first
  }

  for (const [id, deg] of indegree) if (deg === 0) heapPush(id)

  const result: string[] = []
  while (zeroHeap.length > 0) {
    const current = heapPop()!
    result.push(current)
    for (const neighbor of adj.get(current) ?? []) {
      const newDeg = (indegree.get(neighbor) ?? 1) - 1
      indegree.set(neighbor, newDeg)
      if (newDeg === 0) heapPush(neighbor)
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
  /**
   * If true, accept non-grid (test) providers without error.
   * ONLY for test use. Production must use SpatialGrid-backed providers.
   */
  _trustTestProvider?: boolean
}

/**
 * Resolve constraint-based ordering for all world-band nodes.
 *
 * @param nodes            All active world-band constraint nodes
 * @param candidateProvider SpatialGrid-backed provider (or test double with opt-out)
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

  // 0. Verify provider provenance (P2 fix: hard gate)
  const trusted = isSpatialGridProvider(candidateProvider)
  if (instr) instr.providerTrusted = trusted
  if (!trusted && !opts?._trustTestProvider) {
    fatal('SPATIAL_GRID_CELL_SIZE_INVALID' as RenderSchemaErrorCode, sceneId, '(provider)',
      'candidateProvider',
      `约束排序必须使用 SpatialGrid 候选提供者，不允许未经认证的 provider`,
      `constraint resolver requires a SpatialGrid-backed candidate provider (SPATIAL_GRID_PROVIDER_BRAND missing)`)
  }

  // 1–3. Build the authoritative node registry once while validating
  // duplicate IDs and fragment bands, and collect agents in the same pass.
  const nodeMap = new Map<string, ConstraintNode>()
  const agents: ConstraintNode[] = []
  for (const node of nodes) {
    if (nodeMap.has(node.stableId)) {
      fatal('CONSTRAINT_DUPLICATE_NODE' as RenderSchemaErrorCode, sceneId, node.stableId,
        'stableId', `重复 stableId: ${node.stableId}`, `duplicate stableId in nodes: ${node.stableId}`)
    }
    if (node.nodeKind === 'fragment' && node.sortKey.renderBandOrder !== 100) {
      fatal('FRAGMENT_RENDER_BAND_INVALID' as RenderSchemaErrorCode, sceneId, node.stableId,
        'renderBand', `fragment 必须为 world band: ${node.stableId}`,
        `fragment ${node.stableId} renderBandOrder=${node.sortKey.renderBandOrder}, must be world (100)`)
    }
    nodeMap.set(node.stableId, node)
    if (node.nodeKind === 'agent') agents.push(node)
  }
  preValidateZoneRegistry(zoneRegistry, nodeMap, sceneId)

  const agentCount = agents.length

  // 4. Prior membership is deeply immutable by contract; the resolver only
  // reads it, so cloning every zone/agent state each frame is redundant.
  const previousMembership = opts?.previousMembership ?? createEmptyMembershipState()

  // 5. Resolve memberships using spatial grid (NOT flat all-zones)
  const zoneCache = new Map<string, ZoneMembershipCache>()
  const { snapshots, workingState } = resolveMembershipsWithGrid(
    agents, candidateProvider, zoneRegistry,
    previousMembership, zoneCache, sceneId, instr,
  )

  // 6. Generate edges
  const edges = generateEdgesWithRegistry(nodeMap, zoneRegistry, snapshots, sceneId)

  // 7. Kahn sort
  const order = kahnSort(nodes, edges, sceneId)

  const endTime = now()

  // 8. Populate instrumentation
  if (instr) {
    instr.edgeCount = edges.length
    instr.sortDurationMs = endTime - startTime
    instr.zoneCount = zoneRegistry.size
    instr.agentCount = agentCount
    instr.cycleDetected = false
  }

  // 9. Build immutable output membership state (deep-frozen)
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
  // Only world-band fragments can become constraint nodes
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

  // chunkId must be non-empty
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
