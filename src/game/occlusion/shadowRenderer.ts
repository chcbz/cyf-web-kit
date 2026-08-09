// ── E6 Shadow Renderer ──
// Computes v2 sort key, constraint edges, depth proposals for every
// active object WITHOUT changing v1 children/depth/camera/hit-test/
// pointer/lighting/UI or active state.
//
// Input: v1 object snapshots + normalized IR (if v2 schema present)
// Output: per-object diagnostics + structured shadow snapshot
//
// Frozen contract per §12.2 of juyiting-occlusion-system-design.md:
//   legacy TMX → v1 adapter → normalized IR → shadow renderer comparison
//   v2 only in shadow/test path until atomic switch (E7).
//
// If hall.tmx lacks v2 schema, returns disabled/not-ready status.

import {
  type CanonicalSceneIr,
  type OcclusionConstraintZone,
  type Point,
  type RenderSchemaError,
  type SceneObject,
  DEFAULT_FLOOR_REGISTRY,
  HYSTERESIS_PX,
  RENDER_BAND_ORDER,
  isStructuredFatalRenderSchemaError,
} from './schema.js'
import {
  type WorldSortKey,
  computeWorldSortKey,
  compareWorldSortKeys,
  worldSortKeyToString,
} from './worldOrder.js'
import {
  type ConstraintEdge,
  type ConstraintInstrumentation,
  type ConstraintMembershipState,
  type ConstraintNode,
  type ConstraintResolution,
  createConstraintInstrumentation,
  createEmptyMembershipState,
  fragmentToConstraintNode,
  resolveConstraintOrder,
  sceneObjectToConstraintNode,
} from './constraintResolver.js'
import {
  type SpatialGridCandidateProvider,
  type SpatialGridInstrumentation,
  SpatialGrid,
  createConstraintCandidateProvider,
  createSpatialGridInstrumentation,
} from './spatialGrid.js'
import { parseCanonicalIrFromData, hasRenderSchemaV2 } from './canonicalIr.js'
import { validateAndCanonicalizePolygon } from './validation.js'

// ── Constants ──

const MAX_SNAPSHOT_OBJECTS = 500
const MAX_SNAPSHOT_EDGES = 2000
const MAX_ERRORS = 50
const THROTTLE_MS = 200
const MAX_SNAPSHOT_DEPTH_BYTES = 128 * 1024 // 128 KiB cap

// ── V1 object snapshot ──

export interface V1ObjectSnapshot {
  /** MelonJS or logical object ID (may not match stableId) */
  objectId: string
  /** Source entity ID from API (for agents) */
  sourceId?: string
  /** Current v1 depth (float) */
  v1Depth: number
  /** World position x */
  x: number
  /** World position y (foot point) */
  y: number
  /** Width in world pixels */
  width?: number
  /** Height in world pixels */
  height?: number
  /** Object kind hint */
  kind: 'agent' | 'prop' | 'layer' | 'unknown'
  /** Whether this is a visible renderable */
  visible: boolean
  /** Whether behind-mask (v1) */
  behindMask?: boolean
}

// ── Shadow per-object diagnostic ──

export interface ShadowDiagnostic {
  /** stableId if matched/adapted, else v1 objectId */
  objectId: string
  /** stableId from v2 IR, empty if no match */
  stableId: string
  /** Source entity ID if available */
  sourceId: string
  /** V1 depth as computed by scene */
  v1Depth: number
  /** V2 sort key (serialized) */
  v2SortKey: string
  /** V2 sort key components */
  v2SortKeyDetail: WorldSortKey | null
  /** V2 proposed sort order index (0-based) */
  v2OrderIndex: number
  /** V2 proposed depth (based on sort order) */
  v2ProposedDepth: number
  /** Constraint edges involving this object */
  constraintEdges: ShadowEdgeInfo[]
  /** Membership candidates for agents */
  membershipCandidates: string[]
  /** Difference reason vs v1 sort */
  diffReason: string
  /** Object kind */
  kind: string
}

export interface ShadowEdgeInfo {
  from: string
  to: string
  kind: 'behind' | 'front'
  zoneStableId: string
  priority: number
}

// ── Shadow snapshot (immutable) ──

export interface ShadowSnapshot {
  /** Snapshot version counter (monotonic) */
  version: number
  /** State of v2 pipeline */
  state: 'disabled' | 'not-ready' | 'ready' | 'error' | 'fatal'
  /** Reason for disabled/not-ready state */
  stateReason: string
  /** Map data has v2 render schema */
  hasV2Schema: boolean
  /** Debug overlay active */
  debugOverlayActive: boolean
  /** Per-object diagnostics */
  diagnostics: readonly ShadowDiagnostic[]
  /** Constraint edges count */
  edgeCount: number
  /** Zone count from IR */
  zoneCount: number
  /** Fragment count from IR */
  fragmentCount: number
  /** Grid cell count */
  gridCellCount: number
  /** Grid entry count */
  gridEntryCount: number
  /** Aggregate sort duration ms */
  sortDurationMs: number
  /** Instrumentation from constraint resolver */
  instrumentation: ShadowInstrumentation | null
  /** Errors captured (max MAX_ERRORS) */
  errors: readonly ShadowErrorRecord[]
  /** Timestamp of snapshot */
  timestamp: number
}

export interface ShadowInstrumentation {
  agentCount: number
  zoneCount: number
  edgeCount: number
  sortDurationMs: number
  cycleDetected: boolean
  providerTrusted: boolean
  uniqueCandidateCount: number
  membershipCheckCount: number
  gridEntryCount: number
  gridCellCount: number
}

// ── Error record ──

export interface ShadowErrorRecord {
  code: string
  objectId: string
  field: string
  message: string
  timestamp: number
}

// ── Factory ──

export interface ShadowRendererOptions {
  /** Map data from TMX (melonJS pre-parsed) */
  mapData?: Record<string, unknown>
  /** Debug overlay activation flag */
  debugOverlayActive?: boolean
  /** Throttle ms (default 200) */
  throttleMs?: number
  /** Custom now provider */
  now?: () => number
}

export function createShadowRenderer(opts: ShadowRendererOptions = {}) {
  return new ShadowRenderer(opts)
}

// ── ShadowRenderer class ──

export class ShadowRenderer {
  private _mapData: Record<string, unknown> | undefined
  private _debugOverlayActive: boolean
  private _throttleMs: number
  private _now: () => number

  // Mutable state
  private _snapshotVersion = 0
  private _lastComputeTime = 0
  private _lastSnapshot: ShadowSnapshot | null = null
  private _canonicalIr: CanonicalSceneIr | null = null
  private _parseError: ShadowErrorRecord | null = null
  private _spatialGrid: SpatialGrid | null = null
  private _candidateProvider: SpatialGridCandidateProvider | null = null
  private _gridInstr: SpatialGridInstrumentation | null = null
  private _membershipState: ConstraintMembershipState = createEmptyMembershipState()
  private _errors: ShadowErrorRecord[] = []
  private _state: ShadowSnapshot['state'] = 'disabled'
  private _stateReason = 'shadow renderer not initialized'
  private _destroyed = false

  // Low-cost production counters (always active)
  private _computeCount = 0
  private _errorCount = 0
  private _lastErrorTimestamp = 0

  // Feature flag (default off)
  private _enabled = false

  constructor(opts: ShadowRendererOptions = {}) {
    this._mapData = opts.mapData
    this._debugOverlayActive = opts.debugOverlayActive ?? false
    this._throttleMs = opts.throttleMs ?? THROTTLE_MS
    this._now = opts.now ?? (() => Date.now())

    if (this._mapData) {
      this._tryInitialize()
    }
  }

  // ── Public API ──

  /** Enable the shadow renderer (feature flag). */
  enable(): void {
    if (this._destroyed) return
    this._enabled = true
    if (this._mapData) {
      // Always try re-initialization when enabling
      // _tryInitialize will reset state and re-parse if possible
      this._tryInitialize()
    }
  }

  /** Disable the shadow renderer. */
  disable(): void {
    this._enabled = false
  }

  /** Check if enabled. */
  get enabled(): boolean { return this._enabled }

  /** Set map data (re-initializes if enabled). */
  setMapData(mapData: Record<string, unknown>): void {
    if (this._destroyed) return
    this._mapData = mapData
    this._parseError = null
    this._canonicalIr = null
    this._spatialGrid = null
    this._candidateProvider = null
    this._gridInstr = null
    this._membershipState = createEmptyMembershipState()
    this._errors = []
    this._lastSnapshot = null
    this._state = 'disabled'
    this._stateReason = 'map data changed, re-initializing'

    if (this._enabled) {
      this._tryInitialize()
    }
  }

  /** Set debug overlay active flag. */
  setDebugOverlayActive(active: boolean): void {
    this._debugOverlayActive = active
  }

  /** Get debug overlay state. */
  get debugOverlayActive(): boolean { return this._debugOverlayActive }

  /** Get canonical IR (null if not parsed or not v2). */
  get canonicalIr(): CanonicalSceneIr | null { return this._canonicalIr }

  /** Get spatial grid (null if not built). */
  get spatialGrid(): SpatialGrid | null { return this._spatialGrid }

  /** Get candidate provider (null if not built). */
  get candidateProvider(): SpatialGridCandidateProvider | null { return this._candidateProvider }

  /** Get membership state (deep-frozen). */
  get membershipState(): ConstraintMembershipState { return this._membershipState }

  /** Low-cost production counters. */
  get productionCounters(): { computeCount: number; errorCount: number; lastErrorTimestamp: number } {
    return {
      computeCount: this._computeCount,
      errorCount: this._errorCount,
      lastErrorTimestamp: this._lastErrorTimestamp,
    }
  }

  /** Get current state. */
  get state(): ShadowSnapshot['state'] { return this._state }

  /** Get state reason. */
  get stateReason(): string { return this._stateReason }

  /**
   * Compute shadow snapshot from v1 object snapshots.
   * Throttled: returns last snapshot if within throttle window.
   * V1 scene continues to operate independently.
   */
  computeSnapshot(v1Objects: readonly V1ObjectSnapshot[]): ShadowSnapshot {
    if (this._destroyed) {
      return this._buildSnapshot('disabled', 'shadow renderer destroyed', [], [], null)
    }

    // Feature flag check: disabled means no shadow computing at all
    if (!this._enabled) {
      return this._buildSnapshot('disabled', 'shadow renderer not enabled', [], [], null)
    }

    // Throttle check: return last snapshot if within window
    const now = this._now()
    if (now - this._lastComputeTime < this._throttleMs && this._snapshotVersion > 0 && this._lastSnapshot) {
      return this._lastSnapshot
    }

    this._computeCount++

    // Capture errors from this frame
    const frameErrors: ShadowErrorRecord[] = []

    try {
      // If not ready, return status snapshot
      if (this._state !== 'ready') {
        return this._buildSnapshot(
          this._state,
          this._stateReason,
          [],
          [...this._errors],
          null,
        )
      }

      // Adapt v1 objects to constraint nodes
      const { nodes, diagnostics, adaptErrors } = this._adaptV1Objects(v1Objects)
      frameErrors.push(...adaptErrors)
      this._recordErrors(frameErrors)

      if (nodes.length === 0) {
        return this._buildSnapshot(
          'ready',
          'no v1 objects to adapt',
          diagnostics,
          [...this._errors],
          null,
        )
      }

      // Run constraint resolver
      const ir = this._canonicalIr!
      const zoneRegistry = new Map<string, OcclusionConstraintZone>()
      for (const z of ir.zones) {
        zoneRegistry.set(z.stableId, z)
      }

      const instr = createConstraintInstrumentation()
      let resolution: ConstraintResolution | null = null
      let resolveError: ShadowErrorRecord | null = null

      try {
        resolution = resolveConstraintOrder(
          nodes,
          this._candidateProvider!,
          zoneRegistry,
          ir.floorRegistry,
          ir.sceneId,
          {
            instrumentation: instr,
            previousMembership: this._membershipState,
          },
        )
        // Update membership state on success
        this._membershipState = resolution.nextMembership
      } catch (err) {
        const record = this._errorFromException(err, '(resolver)')
        frameErrors.push(record)
        this._recordErrors(frameErrors)

        // Preserve v1: shadow fatal must not pollute active scene
        // Membership state NOT updated on error
        const errorSnap = this._buildSnapshot(
          'error',
          `constraint resolution failed: ${record.message}`,
          diagnostics,
          [...this._errors],
          null,
        )
        this._lastSnapshot = errorSnap
        return errorSnap
      }

      // Build diagnostic data including order information
      const orderMap = new Map<string, number>()
      resolution.order.forEach((id, idx) => { orderMap.set(id, idx) })

      const totalObjects = resolution.order.length
      for (const d of diagnostics) {
        const idx = orderMap.get(d.stableId)
        if (idx !== undefined) {
          d.v2OrderIndex = idx
          // Simple depth proposal: linear mapping [0, total-1] → [1, total]
          d.v2ProposedDepth = totalObjects > 1 ? 1 + (idx / (totalObjects - 1)) * (totalObjects - 1) : 1
        }
        d.constraintEdges = resolution.edges
          .filter(e => e.from === d.stableId || e.to === d.stableId)
          .map(e => ({
            from: e.from,
            to: e.to,
            kind: e.kind,
            zoneStableId: e.zoneStableId,
            priority: e.priority,
          }))
      }

      // Populate diff reasons
      for (const d of diagnostics) {
        d.diffReason = this._computeDiffReason(d, resolution.order)
      }

      // Grid instrumentation
      if (this._gridInstr) {
        this._gridInstr.scanCount = (this._gridInstr.scanCount ?? 0) + 1
      }

      this._lastComputeTime = now
      this._snapshotVersion++
      const result = this._buildSnapshot(
        'ready',
        '',
        diagnostics,
        [...this._errors],
        {
          agentCount: instr.agentCount,
          zoneCount: instr.zoneCount,
          edgeCount: instr.edgeCount,
          sortDurationMs: instr.sortDurationMs,
          cycleDetected: instr.cycleDetected,
          providerTrusted: instr.providerTrusted,
          uniqueCandidateCount: instr.uniqueCandidateCount,
          membershipCheckCount: instr.membershipCheckCount,
          gridEntryCount: this._spatialGrid?.getEntryCount() ?? 0,
          gridCellCount: this._spatialGrid?.getCellCount() ?? 0,
        },
        resolution.edges.length,
      )
      this._lastSnapshot = result
      return result
    } catch (err) {
      const record = this._errorFromException(err, '(computeSnapshot)')
      frameErrors.push(record)
      this._recordErrors(frameErrors)

      const errSnap = this._buildSnapshot(
        'error',
        `unexpected error: ${record.message}`,
        [],
        [...this._errors],
        null,
      )
      this._lastSnapshot = errSnap
      return errSnap
    }
  }

  /** Force a full recompute on next call. */
  invalidate(): void {
    this._lastComputeTime = 0
    this._lastSnapshot = null
  }

  /** Dispose the shadow renderer. */
  dispose(): void {
    this._destroyed = true
    this._mapData = undefined
    this._canonicalIr = null
    this._spatialGrid = null
    this._candidateProvider = null
    this._gridInstr = null
    this._membershipState = createEmptyMembershipState()
    this._errors = []
    this._lastSnapshot = null
    this._state = 'disabled'
    this._stateReason = 'shadow renderer disposed'
    this._enabled = false
  }

  // ── Private ──

  private _tryInitialize(): void {
    // Reset state before attempting initialization
    this._parseError = null
    this._errors = []
    this._lastSnapshot = null

    if (!this._mapData) {
      this._state = 'disabled'
      this._stateReason = 'no map data'
      return
    }

    try {
      // Check v2 schema
      if (!hasRenderSchemaV2(this._mapData)) {
        this._state = 'not-ready'
        this._stateReason = 'hall.tmx has no v2 render schema; shadow comparison disabled'
        return
      }

      // Parse canonical IR
      this._canonicalIr = parseCanonicalIrFromData(this._mapData)

      if (!this._canonicalIr.fragments.length && !this._canonicalIr.zones.length && !this._canonicalIr.objects.length) {
        this._state = 'not-ready'
        this._stateReason = 'v2 IR parsed but contains no objects, fragments, or zones'
        return
      }

      // Validate and canonicalize zone polygons
      for (const zone of this._canonicalIr.zones) {
        validateAndCanonicalizePolygon(
          zone.polygon,
          zone.stableId,
          this._canonicalIr.sceneId,
        )
      }

      // Build spatial grid
      this._spatialGrid = new SpatialGrid()
      this._gridInstr = createSpatialGridInstrumentation()

      // Register zones in grid
      for (const zone of this._canonicalIr.zones) {
        this._spatialGrid.register(
          {
            stableId: zone.stableId,
            entryKind: 'zone',
            bounds: zone.bounds,
          },
          this._canonicalIr.sceneId,
          zone.floorId,
        )
      }

      // Register fragments in grid
      for (const frag of this._canonicalIr.fragments) {
        this._spatialGrid.register(
          {
            stableId: frag.stableId,
            entryKind: 'fragment',
            bounds: frag.destinationRect,
          },
          this._canonicalIr.sceneId,
          frag.floorId,
        )
      }

      // Register objects in grid
      for (const obj of this._canonicalIr.objects) {
        const objBounds = obj.geometry?.footprint && obj.geometry.footprint.length > 0
          ? (() => {
              const xs = obj.geometry.footprint.map((p: { x: number }) => p.x)
              const ys = obj.geometry.footprint.map((p: { y: number }) => p.y)
              return {
                x: Math.min(...xs),
                y: Math.min(...ys),
                width: Math.max(...xs) - Math.min(...xs),
                height: Math.max(...ys) - Math.min(...ys),
              }
            })()
          : obj.render?.type === 'asset'
            ? obj.render.destinationRect
            : { x: obj.sortAnchor.x - 8, y: obj.sortAnchor.y - 8, width: 16, height: 16 }
        this._spatialGrid.register(
          {
            stableId: obj.stableId,
            entryKind: obj.kind === 'agent' ? 'agent' : obj.kind === 'prop' ? 'prop' : 'hotspot',
            bounds: objBounds,
          },
          this._canonicalIr.sceneId,
          obj.floorId,
        )
      }

      this._candidateProvider = createConstraintCandidateProvider(this._spatialGrid)
      this._parseError = null
      this._state = 'ready'
      this._stateReason = ''
    } catch (err) {
      const record = this._errorFromException(err, '(init)')
      this._parseError = record
      this._errors.push(record)
      this._errorCount++

      if (isStructuredFatalRenderSchemaError(err)) {
        this._state = 'fatal'
        this._stateReason = `v2 schema fatal: ${err.errorCode} - ${err.userMessage}`
      } else {
        this._state = 'error'
        this._stateReason = `initialization error: ${record.message}`
      }

      // Recoverable: next valid mapData setMapData call will retry
    }
  }

  private _adaptV1Objects(v1Objects: readonly V1ObjectSnapshot[]): {
    nodes: ConstraintNode[]
    diagnostics: ShadowDiagnostic[]
    adaptErrors: ShadowErrorRecord[]
  } {
    const ir = this._canonicalIr!
    const nodes: ConstraintNode[] = []
    const diagnostics: ShadowDiagnostic[] = []
    const errors: ShadowErrorRecord[] = []

    // Build fragment nodes from IR
    const fragmentNodes: ConstraintNode[] = []
    for (const frag of ir.fragments) {
      if (frag.renderBand === 'world') {
        try {
          fragmentNodes.push(fragmentToConstraintNode(frag, ir.floorRegistry))
        } catch (err) {
          errors.push(this._errorFromException(err, frag.stableId))
        }
      }
    }

    // Build static object nodes from IR
    const staticNodes: ConstraintNode[] = []
    for (const obj of ir.objects) {
      if (obj.renderBand === 'world') {
        try {
          staticNodes.push(sceneObjectToConstraintNode(obj, ir.floorRegistry))
        } catch (err) {
          errors.push(this._errorFromException(err, obj.stableId))
        }
      }
    }

    // Adapt v1 objects to agent constraint nodes
    // We use a simple adapter: each v1 object gets a stableId
    // derived from its objectId. This is NOT the same as the full
    // runtime agent adapter (E3) — it's a shadow-path approximation.
    const sceneHeight = ir.coordinateHeight || 928

    for (const v1 of v1Objects.slice(0, MAX_SNAPSHOT_OBJECTS)) {
      const diag: ShadowDiagnostic = {
        objectId: v1.objectId,
        stableId: '',
        sourceId: v1.sourceId || '',
        v1Depth: v1.v1Depth,
        v2SortKey: '',
        v2SortKeyDetail: null,
        v2OrderIndex: -1,
        v2ProposedDepth: -1,
        constraintEdges: [],
        membershipCandidates: [],
        diffReason: '',
        kind: v1.kind,
      }

      // For agents: try to create a pseudo-agent node
      if (v1.kind === 'agent' && v1.visible) {
        // Use a deterministic pseudo-stableId based on objectId
        const pseudoStableId = `jyt.agent.shadow.${v1.objectId.replace(/[^a-z0-9._-]/gi, '_').toLowerCase()}.v0`
        diag.stableId = pseudoStableId

        try {
          // Create a pseudo-SceneObject for the sort key
          const pseudoObj: SceneObject = {
            stableId: pseudoStableId,
            sceneId: ir.sceneId,
            chunkId: 'shadow', // unknown chunk
            kind: 'agent',
            renderBand: 'world',
            floorId: 'floor-1',
            elevation: 0,
            sortMode: 'y',
            sortAnchor: { x: v1.x, y: v1.y },
            tieBias: 0,
          }

          const sortKey = computeWorldSortKey(pseudoObj, ir.floorRegistry)
          diag.v2SortKey = worldSortKeyToString(sortKey)
          diag.v2SortKeyDetail = sortKey

          // Build constraint node
          const node: ConstraintNode = {
            stableId: pseudoStableId,
            sceneId: ir.sceneId,
            floorId: 'floor-1',
            nodeKind: 'agent',
            sortKey,
            position: { x: v1.x, y: v1.y },
          }
          nodes.push(node)

          // Query grid for membership candidates
          if (this._candidateProvider) {
            try {
              const candidates = this._candidateProvider.queryCandidates(
                { x: v1.x, y: v1.y },
                ir.sceneId,
                'floor-1',
              )
              diag.membershipCandidates = [...candidates].slice(0, 50)
            } catch {
              // Grid query error non-fatal for diagnostics
            }
          }

          // Compute v1 vs v2 diff reason
          const v1DepthNorm = v1.v1Depth / sceneHeight
          const v2DepthNorm = sortKey.fixedPointY / (256 * sceneHeight)
          if (v1.behindMask) {
            diag.diffReason = 'v1: behindMask formula (depth ~1.5-2.5)'
          } else if (Math.abs(v1DepthNorm - v2DepthNorm) > 0.01) {
            diag.diffReason = `v1 depth ${v1.v1Depth.toFixed(2)} vs v2 fixedY ${sortKey.fixedPointY}`
          }
        } catch (err) {
          errors.push(this._errorFromException(err, v1.objectId))
          // Don't add node on error, preserve v1
        }
      } else if (v1.kind === 'prop') {
        diag.stableId = `jyt.prop.shadow.${v1.objectId.replace(/[^a-z0-9._-]/gi, '_').toLowerCase()}.v0`
        diag.diffReason = 'v1: prop declaration-order depth'
      } else if (v1.kind === 'layer') {
        diag.stableId = `jyt.layer.shadow.${v1.objectId.replace(/[^a-z0-9._-]/gi, '_').toLowerCase()}.v0`
        diag.diffReason = 'v1: fixed layer depth'
      } else {
        diag.diffReason = 'v1: unknown object kind'
      }

      diagnostics.push(diag)
    }

    // Add fragment and static nodes after agents
    nodes.push(...staticNodes)
    nodes.push(...fragmentNodes)

    return { nodes, diagnostics, adaptErrors: errors }
  }

  private _buildSnapshot(
    state: ShadowSnapshot['state'],
    stateReason: string,
    diagnostics: ShadowDiagnostic[],
    errors: readonly ShadowErrorRecord[],
    instrumentation: ShadowInstrumentation | null,
    edgeCount?: number,
  ): ShadowSnapshot {
    return Object.freeze({
      version: this._snapshotVersion,
      state,
      stateReason,
      hasV2Schema: this._canonicalIr !== null,
      debugOverlayActive: this._debugOverlayActive,
      diagnostics: Object.freeze(diagnostics.slice(0, MAX_SNAPSHOT_OBJECTS)),
      edgeCount: edgeCount ?? 0,
      zoneCount: this._canonicalIr?.zones.length ?? 0,
      fragmentCount: this._canonicalIr?.fragments.length ?? 0,
      gridCellCount: this._spatialGrid?.getCellCount() ?? 0,
      gridEntryCount: this._spatialGrid?.getEntryCount() ?? 0,
      sortDurationMs: instrumentation?.sortDurationMs ?? 0,
      instrumentation,
      errors: Object.freeze(errors.slice(0, MAX_ERRORS)),
      timestamp: this._now(),
    }) as ShadowSnapshot
  }

  private _computeDiffReason(diag: ShadowDiagnostic, order: string[]): string {
    if (diag.diffReason) return diag.diffReason
    if (diag.v2OrderIndex < 0) return 'not in v2 sort order'
    return `v2 order #${diag.v2OrderIndex}, v1 depth ${diag.v1Depth.toFixed(2)}`
  }

  private _errorFromException(err: unknown, objectId: string): ShadowErrorRecord {
    if (isStructuredFatalRenderSchemaError(err)) {
      return {
        code: err.errorCode,
        objectId: err.objectId || objectId,
        field: err.field,
        message: err.userMessage,
        timestamp: this._now(),
      }
    }
    if (err instanceof Error) {
      return {
        code: 'SHADOW_INTERNAL_ERROR',
        objectId,
        field: '(unknown)',
        message: err.message.slice(0, 200),
        timestamp: this._now(),
      }
    }
    return {
      code: 'SHADOW_UNKNOWN_ERROR',
      objectId,
      field: '(unknown)',
      message: String(err).slice(0, 200),
      timestamp: this._now(),
    }
  }

  private _recordErrors(frameErrors: ShadowErrorRecord[]): void {
    for (const e of frameErrors) {
      if (this._errors.length < MAX_ERRORS) {
        this._errors.push(e)
      }
      this._errorCount++
      this._lastErrorTimestamp = e.timestamp
    }
  }
}

// ── URL param helper ──

/**
 * Parse ?jytOcclusionDebug=1 from query string.
 * Fail-safe: returns false for any malformed input.
 */
export function parseOcclusionDebugFlag(search: string): boolean {
  if (!search || typeof search !== 'string') return false
  try {
    const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`)
    const val = params.get('jytOcclusionDebug')
    return val === '1' || val === 'true'
  } catch {
    return false
  }
}

// ── V1 object snapshot collector ──

/**
 * Collect v1 object snapshots from melonJS scene world.
 * Reads current depth, position, visibility but does NOT modify anything.
 */
export function collectV1Snapshots(
  world: unknown,
  mapData: unknown,
): V1ObjectSnapshot[] {
  const snapshots: V1ObjectSnapshot[] = []
  const mapDataRecord = mapData as Record<string, unknown> | null | undefined
  const occluders: Array<{ x: number; y: number; width: number; height: number }> =
    Array.isArray(mapDataRecord?.occluders) ? mapDataRecord!.occluders as Array<{ x: number; y: number; width: number; height: number }> : []

  try {
    const w = world as Record<string, unknown>
    const children = Array.isArray(w.children) ? w.children : []

    for (const child of children) {
      const c = child as Record<string, unknown>
      if (!c) continue

      const objectId = String(c.name || c.id || `child-${snapshots.length}`)
      const pos = c.pos as { x?: number; y?: number } | undefined
      const x = Number.isFinite(Number(pos?.x)) ? Number(pos!.x) : 0
      const y = Number.isFinite(Number(pos?.y)) ? Number(pos!.y) : 0
      const depth = Number.isFinite(Number(c.depth)) ? Number(c.depth) : 0
      const visible = c.visible !== false && c.isRenderable !== false && c.alpha !== 0

      // Determine kind
      let kind: V1ObjectSnapshot['kind'] = 'unknown'
      if (c.agentId || c.personaCode || c._isAgent) {
        kind = 'agent'
      } else if (c._isProp || c._isHotspot || (c.type && String(c.type) === 'prop')) {
        kind = 'prop'
      } else if (c.image || c._isImageLayer || c._isTileLayer) {
        kind = 'layer'
      }

      // Check behind-mask
      let behindMask = false
      if (kind === 'agent' && occluders.length) {
        behindMask = occluders.some(occ => {
          const inX = x >= (occ.x || 0) && x <= (occ.x || 0) + (occ.width || 0)
          const inY = y >= (occ.y || 0) && y <= (occ.y || 0) + (occ.height || 0)
          return inX && inY
        })
      }

      snapshots.push({
        objectId,
        sourceId: String(c.agentId || ''),
        v1Depth: depth,
        x,
        y,
        width: Number.isFinite(Number(c.width)) ? Number(c.width) : undefined,
        height: Number.isFinite(Number(c.height)) ? Number(c.height) : undefined,
        kind,
        visible,
        behindMask,
      })
    }
  } catch {
    // Return whatever we collected
  }

  return snapshots
}
