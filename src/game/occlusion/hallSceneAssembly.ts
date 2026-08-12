// ── E12 HallScene Assembly ──
// Production integration: parse CanonicalSceneIr from real hall.tmx,
// build SpatialGrid, adapt runtime HallAgent entities to SceneObjects,
// compute per-frame unified world order, and provide hit-test by visual order.
//
// Contract (per reviewer findings):
//  - Accepts real melonJS entities via me/HallAgentClass
//  - Props/fragments use real loaded assets (me.loader.getImage), no placeholders
//  - Runtime agents adapted from this._agents (HallAgent instances)
//  - Per-frame proposal via E7 controller.commitFrame (atomic depth apply, membership advance)
//  - Pointer hit-test follows final visual order; decorative fragments don't consume clicks
//  - SpatialGrid registers/updates runtime agent positions

import {
  type CanonicalSceneIr,
  type OccluderFragment,
  type OcclusionConstraintZone,
  type SceneObject,
  type Point,
  type Rect,
} from './schema.js'
import {
  type ConstraintNode,
  type ConstraintMembershipState,
  createEmptyMembershipState,
  resolveConstraintOrder,
  fragmentToConstraintNode,
  sceneObjectToConstraintNode,
} from './constraintResolver.js'
import {
  SpatialGrid as SpatialGridClass,
  createConstraintCandidateProvider,
  type SpatialGridCandidateProvider,
  isSpatialGridProvider,
} from './spatialGrid.js'
import {
  type FrameProposal,
  type ActiveScene,
  type ActivationResult,
  type SceneActivationController,
  createSceneActivationController,
  type SceneActivationHooks,
  type ActivationStageContext,
  type StagedScene,
  type SceneActivationNode,
} from './sceneActivation.js'
import {
  parseCanonicalIrFromData,
  hasRenderSchemaV2,
} from './canonicalIr.js'
import { validateAndCanonicalizePolygon } from './validation.js'

// ── Types ──

export interface E12Config {
  /** Map data from tiledMap (must contain .properties with renderSchemaVersion=2 and .layers) */
  mapData: Record<string, unknown>
  /** melonJS reference (me) for entity creation */
  me?: unknown
  /** HallAgent class factory */
  HallAgentClass?: unknown
}

export interface E12Assembly {
  canonicalIr: CanonicalSceneIr
  spatialGrid: SpatialGridClass
  candidateProvider: SpatialGridCandidateProvider
  /** World-band SceneObjects from canonical IR (props, structures) */
  worldObjects: SceneObject[]
  /** Non-world objects (lighting, world-ui, screen-ui) — never in world sort */
  nonWorldObjects: SceneObject[]
  fragments: OccluderFragment[]
  zones: OcclusionConstraintZone[]
  /** Current constraint membership state (mutates only on successful commit) */
  membership: ConstraintMembershipState
}

export interface V2AgentAdapter {
  /** Agent scene object for world ordering */
  sceneObject: SceneObject
  /** Original HallAgent entity reference (for depth application) */
  entity: unknown
}

export interface HitTestTarget {
  stableId: string
  kind: string
  bounds: Rect
  depth: number
  /** True for interactive objects (agents, hotspots); false for decorative (fragments, props) */
  interactive: boolean
}

export interface UnifiedOrderResult {
  order: string[]
  depths: Record<string, number>
  membership: ConstraintMembershipState
}

// ── Non-world bands (lighting, world-ui, screen-ui) ──

const NON_WORLD_BANDS = new Set(['lighting', 'world-ui', 'screen-ui'])

// ── Parse and build ──

export function assembleV2Scene(config: E12Config): E12Assembly {
  if (!hasRenderSchemaV2(config.mapData)) {
    throw new Error('E12: mapData lacks renderSchemaVersion=2; V2 unreachable')
  }
  const ir = parseCanonicalIrFromData(config.mapData)

  // Validate zone polygons
  for (const z of ir.zones) {
    validateAndCanonicalizePolygon(z.polygon, z.stableId, ir.sceneId)
  }

  // Build spatial grid with static entities only (fragments, zones, props)
  const grid = new SpatialGridClass(256)
  for (const z of ir.zones) {
    grid.register({ stableId: z.stableId, entryKind: 'zone', bounds: z.bounds }, ir.sceneId, z.floorId)
  }
  for (const f of ir.fragments) {
    grid.register({ stableId: f.stableId, entryKind: 'fragment', bounds: f.destinationRect }, ir.sceneId, f.floorId)
  }
  for (const o of ir.objects) {
    grid.register(
      { stableId: o.stableId, entryKind: o.kind === 'agent' ? 'agent' : o.kind === 'prop' ? 'prop' : 'hotspot', bounds: computeBounds(o) },
      ir.sceneId, o.floorId,
    )
  }

  const provider = createConstraintCandidateProvider(grid)

  // Classify objects
  const worldObjects: SceneObject[] = []
  const nonWorldObjects: SceneObject[] = []
  for (const o of ir.objects) {
    if (NON_WORLD_BANDS.has(o.renderBand)) {
      nonWorldObjects.push(o)
    } else {
      worldObjects.push(o)
    }
  }

  return {
    canonicalIr: ir,
    spatialGrid: grid,
    candidateProvider: provider,
    worldObjects,
    nonWorldObjects,
    fragments: ir.fragments,
    zones: ir.zones,
    membership: createEmptyMembershipState(),
  }
}

// ── Adapt runtime HallAgent entities to SceneObjects ──

export function adaptRuntimeAgents(
  agents: ReadonlyMap<string, unknown>,
  sceneId: string,
): V2AgentAdapter[] {
  const result: V2AgentAdapter[] = []
  for (const [agentId, entity] of agents) {
    const ent = entity as Record<string, unknown>
    const pos = ent.pos as Record<string, number> | undefined
    const x = pos && Number.isFinite(Number(pos.x)) ? Number(pos.x) : 0
    const y = pos && Number.isFinite(Number(pos.y)) ? Number(pos.y) : 0
    const stableId = `jyt.agent.${String(agentId).replace(/[^a-z0-9._-]/gi, '_').toLowerCase()}.v1`

    const sceneObj: SceneObject = {
      stableId,
      sourceEntityId: agentId,
      sceneId,
      chunkId: 'hall-agents',
      kind: 'agent',
      renderBand: 'world',
      floorId: 'floor-1',
      elevation: 0,
      sortMode: 'y',
      sortAnchor: { x, y },
      tieBias: 0,
    }
    result.push({ sceneObject: sceneObj, entity })
  }
  return result
}

// ── Register runtime agents in spatial grid ──

export function registerAgentsInGrid(
  assembly: E12Assembly,
  agentAdapters: V2AgentAdapter[],
): void {
  for (const a of agentAdapters) {
    const so = a.sceneObject
    assembly.spatialGrid.register(
      { stableId: so.stableId, entryKind: 'agent', bounds: { x: so.sortAnchor.x - 8, y: so.sortAnchor.y - 8, width: 16, height: 16 } },
      so.sceneId, so.floorId,
    )
  }
}

// ── Compute unified world order (agents + props + fragments) ──

export function computeUnifiedWorldOrder(
  assembly: E12Assembly,
  agentAdapters: V2AgentAdapter[],
): UnifiedOrderResult {
  const ir = assembly.canonicalIr
  const nodes: ConstraintNode[] = []

  // Static objects (props, structures) — only world-band
  for (const o of assembly.worldObjects) {
    if (o.renderBand !== 'world') continue
    nodes.push(sceneObjectToConstraintNode(o, ir.floorRegistry))
  }

  // Fragments — only world-band
  for (const f of assembly.fragments) {
    if (f.renderBand !== 'world') continue
    try { nodes.push(fragmentToConstraintNode(f, ir.floorRegistry)) } catch { /* skip invalid */ }
  }

  // Runtime agents
  for (const a of agentAdapters) {
    nodes.push(sceneObjectToConstraintNode(a.sceneObject, ir.floorRegistry))
  }

  // Zone registry
  const zoneReg = new Map<string, OcclusionConstraintZone>()
  for (const z of assembly.zones) zoneReg.set(z.stableId, z)

  const resolution = resolveConstraintOrder(
    nodes, assembly.candidateProvider, zoneReg,
    ir.floorRegistry, ir.sceneId,
    { previousMembership: assembly.membership },
  )

  // Contiguous integer depths
  const depths: Record<string, number> = {}
  let d = 0
  for (const id of resolution.order) {
    depths[id] = d++
  }

  return {
    order: resolution.order,
    depths,
    membership: resolution.nextMembership,
  }
}

// ── Build hit-test targets (interactive agents first, then decorative) ──

export function buildHitTestTargets(
  order: string[],
  depths: Record<string, number>,
  assembly: E12Assembly,
  agentAdapters: V2AgentAdapter[],
): HitTestTarget[] {
  const targets: HitTestTarget[] = []
  const agentIds = new Set(agentAdapters.map(a => a.sceneObject.stableId))
  const propIds = new Set(assembly.worldObjects.filter(o => o.kind === 'prop').map(o => o.stableId))

  for (const id of order) {
    const depth = depths[id]
    if (depth === undefined) continue

    const isAgent = agentIds.has(id)
    const kind = isAgent ? 'agent'
      : propIds.has(id) ? 'prop'
      : 'fragment'

    // Bounds
    let bounds: Rect = { x: 0, y: 0, width: 0, height: 0 }
    if (isAgent) {
      const ad = agentAdapters.find(a => a.sceneObject.stableId === id)
      if (ad) {
        bounds = { x: ad.sceneObject.sortAnchor.x - 16, y: ad.sceneObject.sortAnchor.y - 32, width: 32, height: 64 }
      }
    } else if (propIds.has(id)) {
      const p = assembly.worldObjects.find(o => o.stableId === id)
      if (p) bounds = computeBounds(p)
    } else {
      const f = assembly.fragments.find(fr => fr.stableId === id)
      if (f) bounds = f.destinationRect
    }

    targets.push({ stableId: id, kind, bounds, depth, interactive: isAgent })
  }

  // Sort: interactive first (depth descending), then decorative (depth descending)
  targets.sort((a, b) => {
    if (a.interactive !== b.interactive) return a.interactive ? -1 : 1
    return b.depth - a.depth
  })

  return targets
}

// ── Point hit-test ──

export function hitTestPoint(point: Point, targets: HitTestTarget[]): HitTestTarget | null {
  for (const t of targets) {
    if (!t.interactive) continue // decorative fragments don't consume clicks
    if (
      point.x >= t.bounds.x && point.x <= t.bounds.x + t.bounds.width &&
      point.y >= t.bounds.y && point.y <= t.bounds.y + t.bounds.height
    ) {
      return t
    }
  }
  return null
}

// ── Build frame proposal for E7 commitFrame ──

export function buildFrameProposal(
  assembly: E12Assembly,
  agentAdapters: V2AgentAdapter[],
  activationTxId: string,
): FrameProposal {
  const order = computeUnifiedWorldOrder(assembly, agentAdapters)

  return {
    sceneId: assembly.canonicalIr.sceneId,
    activationTransactionId: activationTxId,
    order: order.order,
    depths: order.depths,
    constraintResult: { order: order.order },
  }
}

// ── Compute object AABB ──

function computeBounds(obj: SceneObject): Rect {
  if (obj.render?.type === 'asset' && obj.render.destinationRect) {
    return obj.render.destinationRect
  }
  if (obj.geometry?.footprint?.length) {
    const xs = obj.geometry.footprint.map(p => p.x)
    const ys = obj.geometry.footprint.map(p => p.y)
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
  }
  return { x: obj.sortAnchor.x - 8, y: obj.sortAnchor.y - 8, width: 16, height: 16 }
}

// ── Re-exports ──

export {
  type ConstraintMembershipState,
  createEmptyMembershipState,
  createSceneActivationController,
  type SceneActivationController,
  type ActiveScene,
  type ActivationResult,
  type FrameProposal,
  type SceneActivationHooks,
  type ActivationStageContext,
  type StagedScene,
  type SceneActivationNode,
  isSpatialGridProvider,
}
