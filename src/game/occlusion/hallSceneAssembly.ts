// ── E12 HallScene Assembly ──
// Production integration: runtime V2 activation envelope, CanonicalSceneIr
// parse, SpatialGrid build, unified world order, hit-test, frame proposal.
//
// Activation envelope (fail-closed, no TMX mutation on disk):
//   - sceneId === 'juyiting-main'
//   - v2-fragments-occluders objectgroup with exactly 32 occluder-fragment objects
//   - Accepted TMX SHA-256 provenance: must match ACCEPTED_TMX_SHA256
//   - On match: project renderSchemaVersion=2 into a deep-cloned mapData copy
//     (discardable; original untouched) for canonical IR consumption.
//
// Contract:
//  - SpatialGrid: statics (fragments, props, zones) registered once.
//    Agents re-registered per-frame (register auto-unregisters first).
//  - computeUnifiedWorldOrder: agents+props+fragments → constraint resolver →
//    deterministic order + contiguous safe integer depths.
//    Returns nextMembership; caller only advances on successful E7 commit.
//  - hitTestPoint: interactive-only (agents), depth-descending.
//    Decorative fragments/props never consume pointer.
//  - buildFrameProposal: produces E7 FrameProposal; membership returned
//    separately so caller controls advancement.

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
  type ConstraintInstrumentation,
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
} from './canonicalIr.js'
import { validateAndCanonicalizePolygon } from './validation.js'

// ── Accepted TMX provenance ──
// E16B accepted hall.tmx SHA-256: 7b304c11...

export const ACCEPTED_TMX_SHA256 = '7b304c11fd4a121d92f5fb1430f8073d4d590b3d42eb9b9a18e0e0c9bd22ff53'

// ── Types ──

export interface E12Assembly {
  canonicalIr: CanonicalSceneIr
  spatialGrid: SpatialGridClass
  candidateProvider: SpatialGridCandidateProvider
  worldObjects: SceneObject[]
  nonWorldObjects: SceneObject[]
  fragments: OccluderFragment[]
  zones: OcclusionConstraintZone[]
}

export interface V2AgentAdapter {
  sceneObject: SceneObject
  entity: unknown
}

export interface HitTestTarget {
  stableId: string
  kind: string
  bounds: Rect
  depth: number
  interactive: boolean
}

export interface UnifiedOrderResult {
  order: string[]
  depths: Record<string, number>
  nextMembership: ConstraintMembershipState
}

// ── Non-world bands ──

const NON_WORLD_BANDS = new Set(['lighting', 'world-ui', 'screen-ui'])

interface StaticOrderCache {
  nodes: readonly ConstraintNode[]
  zoneRegistry: ReadonlyMap<string, OcclusionConstraintZone>
}

const STATIC_ORDER_CACHE = new WeakMap<E12Assembly, StaticOrderCache>()

function getStaticOrderCache(assembly: E12Assembly): StaticOrderCache {
  const cached = STATIC_ORDER_CACHE.get(assembly)
  if (cached) return cached

  const ir = assembly.canonicalIr
  const nodes: ConstraintNode[] = []
  for (const object of assembly.worldObjects) {
    if (object.renderBand === 'world') nodes.push(sceneObjectToConstraintNode(object, ir.floorRegistry))
  }
  for (const fragment of assembly.fragments) {
    if (fragment.renderBand !== 'world') continue
    try {
      nodes.push(fragmentToConstraintNode(fragment, ir.floorRegistry))
    } catch (err) {
      throw new Error(`E12: fragmentToConstraintNode failed for ${fragment.stableId}: ${(err as Error)?.message || err}`)
    }
  }
  const zoneRegistry = new Map<string, OcclusionConstraintZone>()
  for (const zone of assembly.zones) zoneRegistry.set(zone.stableId, zone)
  const created = { nodes: Object.freeze(nodes), zoneRegistry }
  STATIC_ORDER_CACHE.set(assembly, created)
  return created
}

// ── Activation envelope ──

/**
 * Verify TMX SHA-256 matches accepted provenance.
 * Caller must provide the raw XML string (for hash) or pre-computed hash.
 */
export function verifyTmxProvenance(tmxSha256: string): boolean {
  return tmxSha256 === ACCEPTED_TMX_SHA256
}

/**
 * Runtime V2 activation envelope (fail-closed).
 * Checks:
 *   1. sceneId === 'juyiting-main'
 *   2. v2-fragments-occluders objectgroup with EXACTLY 32 occluder-fragment objects
 *   3. TMX SHA-256 provenance accepted (if provided)
 * Any missing condition → false.
 */
export function hasV2ActivationEnvelope(
  mapData: Record<string, unknown>,
  tmxSha256: string,
): boolean {
  if (!mapData || typeof mapData !== 'object' || Array.isArray(mapData)) return false
  const props = mapData.properties as Record<string, unknown> | undefined
  if (!props || props.sceneId !== 'juyiting-main') return false
  const layers = (mapData as Record<string, unknown>).layers as Array<Record<string, unknown>> | undefined
  if (!Array.isArray(layers)) return false
  const fragLayer = layers.find(l =>
    l.type === 'objectgroup' &&
    (l.name === 'v2-fragments-occluders' || l.name === 'v2-fragments')
  )
  if (!fragLayer) return false
  const objs = fragLayer.objects as Array<Record<string, unknown>> | undefined
  if (!Array.isArray(objs)) return false
  const fragCount = objs.filter(o => o.type === 'occluder-fragment').length
  if (fragCount !== 32) return false
  // Provenance gate (mandatory)
  if (!verifyTmxProvenance(tmxSha256)) return false
  return true
}

/**
 * Project activation envelope: deep-clone mapData and inject
 * renderSchemaVersion=2 into properties. Original is untouched.
 * Only call after hasV2ActivationEnvelope passes.
 */
export function projectActivationEnvelope(mapData: Record<string, unknown>): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(mapData)) as Record<string, unknown>
  const cprops = cloned.properties as Record<string, unknown> || {}
  cprops.renderSchemaVersion = '2'
  cloned.properties = cprops
  return cloned
}

// ── Parse and build ──

/** Assemble V2 scene. tmxSha256 is mandatory for production; pass the accepted SHA. */
export function assembleV2Scene(mapData: Record<string, unknown>, tmxSha256: string): E12Assembly {
  if (!hasV2ActivationEnvelope(mapData, tmxSha256)) {
    throw new Error('E12: mapData does not satisfy V2 activation envelope; V2 unreachable')
  }
  const projected = projectActivationEnvelope(mapData)
  const ir = parseCanonicalIrFromData(projected)

  // Validate zone polygons
  for (const z of ir.zones) {
    validateAndCanonicalizePolygon(z.polygon, z.stableId, ir.sceneId)
  }

  // Build spatial grid with static entities only
  const grid = new SpatialGridClass(256)
  for (const z of ir.zones) {
    grid.register(
      { stableId: z.stableId, entryKind: 'zone', bounds: z.bounds },
      ir.sceneId, z.floorId,
    )
  }
  for (const f of ir.fragments) {
    grid.register(
      { stableId: f.stableId, entryKind: 'fragment', bounds: f.destinationRect },
      ir.sceneId, f.floorId,
    )
  }
  for (const o of ir.objects) {
    const kind = o.kind === 'agent' ? 'agent' : o.kind === 'prop' ? 'prop' : 'hotspot'
    grid.register(
      { stableId: o.stableId, entryKind: kind, bounds: computeBounds(o) },
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
  }
}

// ── SpatialGrid agent management ──

export function registerAgentsInGrid(
  grid: SpatialGridClass,
  agentAdapters: V2AgentAdapter[],
  sceneId: string,
  floorId: string,
): void {
  for (const a of agentAdapters) {
    const so = a.sceneObject
    grid.register(
      {
        stableId: so.stableId,
        entryKind: 'agent',
        bounds: { x: so.sortAnchor.x - 8, y: so.sortAnchor.y - 8, width: 16, height: 16 },
      },
      sceneId, floorId,
    )
  }
}

export function unregisterAgentFromGrid(
  grid: SpatialGridClass,
  stableId: string,
): void {
  grid.unregister(stableId)
}

// ── Compute unified world order ──

export function computeUnifiedWorldOrder(
  assembly: E12Assembly,
  agentAdapters: V2AgentAdapter[],
  currentMembership: ConstraintMembershipState,
  options?: { instrumentation?: ConstraintInstrumentation },
): UnifiedOrderResult {
  const ir = assembly.canonicalIr
  const staticCache = getStaticOrderCache(assembly)
  const nodes: ConstraintNode[] = [...staticCache.nodes]

  // Agents
  for (const a of agentAdapters) {
    nodes.push(sceneObjectToConstraintNode(a.sceneObject, ir.floorRegistry))
  }

  const resolution = resolveConstraintOrder(
    nodes, assembly.candidateProvider, staticCache.zoneRegistry,
    ir.floorRegistry, ir.sceneId,
    { previousMembership: currentMembership, instrumentation: options?.instrumentation },
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
    nextMembership: resolution.nextMembership,
  }
}

// ── Hit-test targets ──

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

  targets.sort((a, b) => {
    if (a.interactive !== b.interactive) return a.interactive ? -1 : 1
    return b.depth - a.depth
  })

  return targets
}

// ── Point hit-test ──

export function hitTestPoint(point: Point, targets: HitTestTarget[]): HitTestTarget | null {
  for (const t of targets) {
    if (!t.interactive) continue
    if (
      point.x >= t.bounds.x && point.x <= t.bounds.x + t.bounds.width &&
      point.y >= t.bounds.y && point.y <= t.bounds.y + t.bounds.height
    ) {
      return t
    }
  }
  return null
}

// ── Frame proposal for E7 ──

export function buildFrameProposal(
  assembly: E12Assembly,
  agentAdapters: V2AgentAdapter[],
  activationTxId: string,
  currentMembership: ConstraintMembershipState,
): { proposal: FrameProposal; nextMembership: ConstraintMembershipState } {
  const order = computeUnifiedWorldOrder(assembly, agentAdapters, currentMembership)
  return {
    proposal: {
      sceneId: assembly.canonicalIr.sceneId,
      activationTransactionId: activationTxId,
      order: order.order,
      depths: order.depths,
      constraintResult: { order: order.order },
    },
    nextMembership: order.nextMembership,
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
