// ── E12 HallScene Assembly ──
// Maps CanonicalSceneIr → V2 staging scene with agents, props, and fragments
// in unified deterministic world order.
//
// Contract:
//  - agents + props + 32 fragments: unified world order (renderBand → floor → elevation → fixedY → tieBias → stableId)
//  - lighting / world-ui / screen-ui: independent bands, never in world sort
//  - Depths: contiguous safe integers, atomic commit via E7
//  - Pointer hit-test: follows final visual order (highest depth = top)
//  - Delayed sprite load: real persona resources only, no placeholders
//  - V1 preserved, V2 only via activation gate
//  - Navigation/hotspot/task/roster-map semantics unchanged

import {
  type CanonicalSceneIr,
  type OccluderFragment,
  type OcclusionConstraintZone,
  type SceneObject,
  type Point,
  type Rect,
  DEFAULT_FLOOR_REGISTRY,
  isStructuredFatalRenderSchemaError,
} from './schema.js'
import {
  computeWorldSortKey,
  compareWorldSortKeys,
  type WorldSortKey,
} from './worldOrder.js'
import {
  type ConstraintNode,
  type ConstraintMembershipState,
  type ConstraintCandidateProvider,
  type ConstraintResolution,
  createEmptyMembershipState,
  fragmentToConstraintNode,
  resolveConstraintOrder,
  sceneObjectToConstraintNode,
} from './constraintResolver.js'
import {
  type SpatialGrid,
  type SpatialGridCandidateProvider,
  SpatialGrid as SpatialGridClass,
  createConstraintCandidateProvider,
} from './spatialGrid.js'
import {
  type StagedScene,
  type SceneActivationNode,
  type ActivationStageContext,
  type SceneActivationHooks,
  createSceneActivationController,
  type SceneActivationController,
  type ActiveScene,
  type ActivationResult,
  type FrameProposal,
  type FrameCommitResult,
} from './sceneActivation.js'
import {
  parseCanonicalIrFromData,
  hasRenderSchemaV2,
} from './canonicalIr.js'
import { validateAndCanonicalizePolygon } from './validation.js'

// ── Constants ──

const SCENE_ID = 'juyiting-main'
const CHUNK_AGENTS = 'hall-agents'
const CHUNK_FRAGMENTS = 'occluder-fragments'
const CHUNK_PROPS = 'hall-props'
const FLOOR_ID = 'floor-1'

// These bands are NEVER included in world sorting
const NON_WORLD_BANDS: ReadonlySet<string> = new Set(['lighting', 'world-ui', 'screen-ui'])

// ── Types ──

export interface E12HallSceneAssemblyConfig {
  /** Map data from TMX (parsed by tiledMap.js) */
  mapData: Record<string, unknown>
  /** Agent data from /agent/map (or compatible) */
  agents: Array<{
    agentId: string
    personaCode?: string
    name?: string
    x: number
    y: number
    status?: string
    facing?: string
    bubble?: { text: string; ttlMs?: number }
    scale?: number
    walkableRegion?: unknown
  }>
  /** Persona sprite manifest for HallAgent creation */
  personaManifest?: Record<string, unknown>
  /** melonJS reference for entity creation */
  me?: unknown
  /** HallAgent class factory */
  hallAgentClass?: unknown
  /** Enable spatial grid production tracing */
  traceSpatialGrid?: boolean
}

export interface E12AssemblyResult {
  /** Canonical IR parsed from map data */
  canonicalIr: CanonicalSceneIr
  /** Spatial grid (production provider) */
  spatialGrid: SpatialGrid
  /** Trusted constraint candidate provider */
  candidateProvider: SpatialGridCandidateProvider
  /** All world-band SceneObjects (agents, props, objects) */
  sceneObjects: SceneObject[]
  /** All canonical fragments */
  fragments: OccluderFragment[]
  /** All constraint zones */
  zones: OcclusionConstraintZone[]
  /** Non-world objects (lighting, world-ui, screen-ui) */
  nonWorldObjects: SceneObject[]
  /** Assembly diagnostics */
  diagnostics: E12AssemblyDiagnostics
}

export interface E12AssemblyDiagnostics {
  agentCount: number
  propCount: number
  fragmentCount: number
  zoneCount: number
  worldObjectCount: number
  nonWorldCount: number
  gridEntryCount: number
  gridCellCount: number
  parseDurationMs: number
  errors: string[]
}

// ── Assembly function ──

export function assembleV2Scene(config: E12HallSceneAssemblyConfig): E12AssemblyResult {
  const startTime = performance.now()
  const errors: string[] = []
  const diagnostics: E12AssemblyDiagnostics = {
    agentCount: 0,
    propCount: 0,
    fragmentCount: 0,
    zoneCount: 0,
    worldObjectCount: 0,
    nonWorldCount: 0,
    gridEntryCount: 0,
    gridCellCount: 0,
    parseDurationMs: 0,
    errors,
  }

  // 1. Parse canonical IR from map data
  if (!hasRenderSchemaV2(config.mapData)) {
    throw new Error('E12: map data lacks v2 render schema; cannot assemble V2 scene')
  }
  const canonicalIr = parseCanonicalIrFromData(config.mapData)

  diagnostics.fragmentCount = canonicalIr.fragments.length
  diagnostics.zoneCount = canonicalIr.zones.length

  // 2. Validate all zone polygons
  for (const zone of canonicalIr.zones) {
    try {
      validateAndCanonicalizePolygon(zone.polygon, zone.stableId, canonicalIr.sceneId)
    } catch (err) {
      errors.push(`zone ${zone.stableId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // 3. Build spatial grid
  const spatialGrid = new SpatialGridClass(256)
  for (const zone of canonicalIr.zones) {
    spatialGrid.register(
      { stableId: zone.stableId, entryKind: 'zone', bounds: zone.bounds },
      canonicalIr.sceneId,
      zone.floorId,
    )
  }
  for (const frag of canonicalIr.fragments) {
    spatialGrid.register(
      { stableId: frag.stableId, entryKind: 'fragment', bounds: frag.destinationRect },
      canonicalIr.sceneId,
      frag.floorId,
    )
  }
  for (const obj of canonicalIr.objects) {
    const objBounds = computeObjectBounds(obj)
    spatialGrid.register(
      { stableId: obj.stableId, entryKind: obj.kind === 'agent' ? 'agent' : obj.kind === 'prop' ? 'prop' : 'hotspot', bounds: objBounds },
      canonicalIr.sceneId,
      obj.floorId,
    )
  }

  diagnostics.gridEntryCount = spatialGrid.getEntryCount()
  diagnostics.gridCellCount = spatialGrid.getCellCount()

  const candidateProvider = createConstraintCandidateProvider(spatialGrid)

  // 4. Classify objects
  const worldObjects: SceneObject[] = []
  const nonWorldObjects: SceneObject[] = []

  let agentCount = 0
  let propCount = 0

  for (const obj of canonicalIr.objects) {
    if (NON_WORLD_BANDS.has(obj.renderBand)) {
      nonWorldObjects.push(obj)
      continue
    }
    worldObjects.push(obj)
    if (obj.kind === 'agent') agentCount++
    if (obj.kind === 'prop') propCount++
  }

  diagnostics.agentCount = agentCount
  diagnostics.propCount = propCount
  diagnostics.worldObjectCount = worldObjects.length
  diagnostics.nonWorldCount = nonWorldObjects.length
  diagnostics.parseDurationMs = performance.now() - startTime

  return {
    canonicalIr,
    spatialGrid,
    candidateProvider,
    sceneObjects: worldObjects,
    fragments: canonicalIr.fragments,
    zones: canonicalIr.zones,
    nonWorldObjects,
    diagnostics,
  }
}

// ── Compute object AABB bounds ──

function computeObjectBounds(obj: SceneObject): Rect {
  if (obj.render?.type === 'asset' && obj.render.destinationRect) {
    return obj.render.destinationRect
  }
  if (obj.geometry?.footprint?.length) {
    const xs = obj.geometry.footprint.map(p => p.x)
    const ys = obj.geometry.footprint.map(p => p.y)
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    }
  }
  return {
    x: obj.sortAnchor.x - 8,
    y: obj.sortAnchor.y - 8,
    width: 16,
    height: 16,
  }
}

// ── Compute unified world order ──

export interface UnifiedWorldOrderResult {
  /** Ordered stableIds (agents, props, fragments) */
  order: string[]
  /** Map of stableId → contiguous integer depth */
  depths: Record<string, number>
  /** Sort keys for all objects */
  keys: Map<string, WorldSortKey>
}

export function computeUnifiedWorldOrder(
  sceneObjects: SceneObject[],
  fragments: OccluderFragment[],
  zones: OcclusionConstraintZone[],
  floorRegistry: Record<string, number>,
  sceneId: string,
  candidateProvider: SpatialGridCandidateProvider,
  previousMembership?: ConstraintMembershipState,
  instrumentation?: unknown,
): UnifiedWorldOrderResult {
  // 1. Build constraint nodes
  const nodes: ConstraintNode[] = []

  // Scene objects (agents, props)
  for (const obj of sceneObjects) {
    if (obj.renderBand !== 'world') continue
    nodes.push(sceneObjectToConstraintNode(obj, floorRegistry))
  }

  // Fragments
  for (const frag of fragments) {
    if (frag.renderBand !== 'world') continue
    try {
      nodes.push(fragmentToConstraintNode(frag, floorRegistry))
    } catch (err) {
      // Skip invalid fragments — they can't participate
    }
  }

  // 2. Build zone registry
  const zoneRegistry = new Map<string, OcclusionConstraintZone>()
  for (const z of zones) {
    zoneRegistry.set(z.stableId, z)
  }

  // 3. Resolve constraint order
  const resolution: ConstraintResolution = resolveConstraintOrder(
    nodes,
    candidateProvider,
    zoneRegistry,
    floorRegistry,
    sceneId,
    {
      previousMembership: previousMembership ?? createEmptyMembershipState(),
    },
  )

  // 4. Assign contiguous integer depths
  const depths: Record<string, number> = {}
  let depth = 0
  for (const stableId of resolution.order) {
    depths[stableId] = depth++
  }

  // 5. Compute sort keys
  const keys = new Map<string, WorldSortKey>()
  for (const node of nodes) {
    keys.set(node.stableId, node.sortKey)
  }

  return {
    order: resolution.order,
    depths,
    keys,
  }
}

// ── Pointer hit-test by visual order ──

export interface HitTestTarget {
  stableId: string
  kind: string
  bounds: Rect
  depth: number
}

export function buildHitTestOrder(
  order: string[],
  depths: Record<string, number>,
  sceneObjects: SceneObject[],
  fragments: OccluderFragment[],
): HitTestTarget[] {
  const targets: HitTestTarget[] = []

  // Build lookup
  const objMap = new Map<string, SceneObject>()
  for (const obj of sceneObjects) {
    objMap.set(obj.stableId, obj)
  }
  const fragMap = new Map<string, OccluderFragment>()
  for (const frag of fragments) {
    fragMap.set(frag.stableId, frag)
  }

  // Build hit-test targets in visual order (highest depth = top = hit first)
  for (const stableId of order) {
    const depth = depths[stableId] ?? -1
    if (depth < 0) continue

    const obj = objMap.get(stableId)
    if (obj) {
      targets.push({
        stableId,
        kind: obj.kind,
        bounds: computeObjectBounds(obj),
        depth,
      })
      continue
    }

    const frag = fragMap.get(stableId)
    if (frag) {
      targets.push({
        stableId,
        kind: 'fragment',
        bounds: frag.destinationRect,
        depth,
      })
    }
  }

  // Sort by depth descending (highest = top visually, hit first)
  targets.sort((a, b) => b.depth - a.depth)

  return targets
}

// ── Point hit-test ──

export function hitTest(
  point: Point,
  targets: HitTestTarget[],
): HitTestTarget | null {
  // targets are already sorted by depth descending
  for (const target of targets) {
    if (
      point.x >= target.bounds.x &&
      point.x <= target.bounds.x + target.bounds.width &&
      point.y >= target.bounds.y &&
      point.y <= target.bounds.y + target.bounds.height
    ) {
      return target
    }
  }
  return null
}

// ── Activation hooks factory ──

export interface HallSceneActivationHooksConfig {
  mapData: Record<string, unknown>
  me?: unknown
  hallAgentClass?: unknown
  personaManifest?: Record<string, unknown>
}

export function createHallSceneActivationHooks(
  config: HallSceneActivationHooksConfig,
): SceneActivationHooks<
  HallSceneActivationHooksConfig,
  CanonicalSceneIr,
  CanonicalSceneIr,
  CanonicalSceneIr,
  E12AssemblyResult,
  unknown
> {
  // Use explicit intermediate variable with typed object to guide TS inference
  type Hooks = SceneActivationHooks<
    HallSceneActivationHooksConfig,
    CanonicalSceneIr,
    CanonicalSceneIr,
    CanonicalSceneIr,
    E12AssemblyResult,
    unknown
  >

  const hooks: Hooks = {
    parse: (source: HallSceneActivationHooksConfig, _context: ActivationStageContext): CanonicalSceneIr => {
      if (!hasRenderSchemaV2(source.mapData)) {
        throw new Error('E12: map data lacks v2 render schema')
      }
      return parseCanonicalIrFromData(source.mapData)
    },

    canonicalize: (parsed: CanonicalSceneIr, _context: ActivationStageContext): CanonicalSceneIr => {
      for (const zone of parsed.zones) {
        validateAndCanonicalizePolygon(zone.polygon, zone.stableId, parsed.sceneId)
      }
      return parsed
    },

    validate: (canonical: CanonicalSceneIr, _context: ActivationStageContext): CanonicalSceneIr => {
      return canonical
    },

    loadAssets: async (_validated: CanonicalSceneIr, context: ActivationStageContext): Promise<E12AssemblyResult> => {
      const assembly = assembleV2Scene({
        mapData: config.mapData,
        agents: [],
        me: config.me,
        hallAgentClass: config.hallAgentClass,
        personaManifest: config.personaManifest,
      })
      context.track('assembly-dispose', () => {
        assembly.spatialGrid.clear()
      })
      return assembly
    },

    instantiate: (
      _input: Readonly<{ validated: CanonicalSceneIr; assets: E12AssemblyResult }>,
      context: ActivationStageContext,
    ): StagedScene<unknown> => {
      const ir = _input.validated
      const assembly = _input.assets

      const nodes: SceneActivationNode<unknown>[] = []

      for (const obj of assembly.sceneObjects) {
        if (obj.renderBand !== 'world') continue
        nodes.push({
          stableId: obj.stableId,
          sceneId: ir.sceneId,
          mode: 'v2',
          ownerTransactionId: context.transactionId,
          value: obj,
        })
      }

      for (const frag of assembly.fragments) {
        if (frag.renderBand !== 'world') continue
        nodes.push({
          stableId: frag.stableId,
          sceneId: ir.sceneId,
          mode: 'v2',
          ownerTransactionId: context.transactionId,
          value: frag,
        })
      }

      const worldOrder = computeUnifiedWorldOrder(
        assembly.sceneObjects,
        assembly.fragments,
        assembly.zones,
        ir.floorRegistry,
        ir.sceneId,
        assembly.candidateProvider,
      )

      return {
        sceneId: ir.sceneId,
        mode: 'v2',
        ownerTransactionId: context.transactionId,
        children: nodes,
        order: worldOrder.order,
        depths: worldOrder.depths,
        dispose: () => {
          assembly.spatialGrid.clear()
        },
      }
    },

    validateConstraints: (
      scene: StagedScene<unknown>,
      _context: ActivationStageContext,
    ) => {
      return { order: scene.order }
    },
  }
  return hooks
}

export function createHallSceneActivationController(
  config: HallSceneActivationHooksConfig,
): SceneActivationController<
  HallSceneActivationHooksConfig,
  CanonicalSceneIr,
  CanonicalSceneIr,
  CanonicalSceneIr,
  E12AssemblyResult,
  unknown
> {
  const hooks = createHallSceneActivationHooks(config)
  return createSceneActivationController(hooks)
}

// ── Re-export for convenience ──

export {
  type SceneActivationController,
  type ActiveScene,
  type ActivationResult,
  type FrameProposal,
  type FrameCommitResult,
  type StagedScene,
  type SceneActivationNode,
  type ConstraintMembershipState,
  createEmptyMembershipState,
}
