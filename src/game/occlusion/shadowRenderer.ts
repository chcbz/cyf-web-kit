// ── E6 Shadow Renderer (V2-native diagnostics) ──
// Computes the active V2 constraint order, edges, and proposed depths from
// live runtime objects WITHOUT mutating render state, camera, hit-test,
// pointer, lighting, UI, or the committed V2 scene.
//
// Input: runtime object snapshots (V2 world handles/agents) + normalized IR
// Output: per-object diagnostics + structured shadow snapshot
//
// E6-review-fix invariants retained:
//   - P1: ?jytOcclusionDebug=1 alone enables shadow + overlay data
//   - P2: lazy init, no parse when both flags off
//   - P2: deep-immutable snapshot (diagnostic entries, edges, candidates,
//         errors, instrumentation all clone+freeze)
//   - P2: truncation report (originalCount, retainedCount, truncatedCount)
//   - P2: no console.warn from renderer (pure data, caller decides logging)
//
// E16A: the migration-only V1 adapter, collector, and AABB mask diff path
// are removed. Diagnostics are V2-native; no global V1 depth formula remains.

import {
  type CanonicalSceneIr,
  type OcclusionConstraintZone,
  isStructuredFatalRenderSchemaError,
} from './schema.js'
import {
  type WorldSortKey,
  computeWorldSortKey,
  worldSortKeyToString,
} from './worldOrder.js'
import {
  type ConstraintEdge,
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
  SpatialGrid,
  createConstraintCandidateProvider,
} from './spatialGrid.js'
import { parseCanonicalIrFromData, hasRenderSchemaV2 } from './canonicalIr.js'
import { validateAndCanonicalizePolygon } from './validation.js'

// ── Constants ──

const MAX_SNAPSHOT_OBJECTS = 500
const MAX_ERRORS = 50
const THROTTLE_MS = 200

// ── Runtime object snapshot ──

export interface RuntimeObjectSnapshot {
  objectId: string
  sourceId?: string
  /** Canonical V2 stableId when known (preferred over pseudo-id derivation). */
  stableId?: string
  runtimeDepth: number
  x: number
  y: number
  width?: number
  height?: number
  kind: 'agent' | 'prop' | 'fragment' | 'layer' | 'unknown'
  visible: boolean
}

// ── Shadow per-object diagnostic ──

export interface ShadowDiagnostic {
  objectId: string
  stableId: string
  sourceId: string
  runtimeDepth: number
  v2SortKey: string
  v2SortKeyDetail: WorldSortKey | null
  v2OrderIndex: number
  v2ProposedDepth: number
  constraintEdges: readonly ShadowEdgeInfo[]
  membershipCandidates: readonly string[]
  diffReason: string
  kind: string
}

export interface ShadowEdgeInfo {
  from: string
  to: string
  kind: 'behind' | 'front'
  zoneStableId: string
  priority: number
}

// ── Truncation report ──

export interface ShadowTruncationReport {
  originalCount: number
  retainedCount: number
  truncatedCount: number
}

// ── Shadow snapshot (deep immutable) ──

export interface ShadowSnapshot {
  readonly version: number
  readonly state: 'disabled' | 'not-ready' | 'ready' | 'error' | 'fatal'
  readonly stateReason: string
  readonly hasV2Schema: boolean
  /** Per-object diagnostics (deep-frozen, capped at MAX_SNAPSHOT_OBJECTS) */
  readonly diagnostics: readonly ShadowDiagnostic[]
  /** Truncation info for diagnostics */
  readonly diagnosticsTruncation: ShadowTruncationReport
  readonly edgeCount: number
  readonly zoneCount: number
  readonly fragmentCount: number
  readonly gridCellCount: number
  readonly gridEntryCount: number
  readonly sortDurationMs: number
  /** Deep-frozen instrumentation or null */
  readonly instrumentation: ShadowInstrumentation | null
  /** Deep-frozen errors (capped at MAX_ERRORS) */
  readonly errors: readonly ShadowErrorRecord[]
  /** Truncation info for errors */
  readonly errorsTruncation: ShadowTruncationReport
  readonly timestamp: number
}

export interface ShadowInstrumentation {
  readonly agentCount: number
  readonly zoneCount: number
  readonly edgeCount: number
  readonly sortDurationMs: number
  readonly cycleDetected: boolean
  readonly providerTrusted: boolean
  readonly uniqueCandidateCount: number
  readonly membershipCheckCount: number
  readonly gridEntryCount: number
  readonly gridCellCount: number
}

// ── Error record ──

export interface ShadowErrorRecord {
  readonly code: string
  readonly objectId: string
  readonly field: string
  readonly message: string
  readonly timestamp: number
}

// ── Factory ──

export interface ShadowRendererOptions {
  mapData?: Record<string, unknown>
  throttleMs?: number
  now?: () => number
}

export function createShadowRenderer(opts: ShadowRendererOptions = {}) {
  return new ShadowRenderer(opts)
}

// ── Deep-freeze helper ──

function deepFreeze<T>(value: T): T {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) {
    if (Object.isFrozen(value)) return value
    for (const item of value) deepFreeze(item)
    return Object.freeze(value)
  }
  if (Object.isFrozen(value)) return value
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

function freezeDiagnostic(d: ShadowDiagnostic): ShadowDiagnostic {
  return deepFreeze({
    objectId: d.objectId,
    stableId: d.stableId,
    sourceId: d.sourceId,
    runtimeDepth: d.runtimeDepth,
    v2SortKey: d.v2SortKey,
    v2SortKeyDetail: d.v2SortKeyDetail ? deepFreeze({ ...d.v2SortKeyDetail }) : null,
    v2OrderIndex: d.v2OrderIndex,
    v2ProposedDepth: d.v2ProposedDepth,
    constraintEdges: deepFreeze(d.constraintEdges.map(e => deepFreeze({ ...e }))),
    membershipCandidates: deepFreeze([...d.membershipCandidates]),
    diffReason: d.diffReason,
    kind: d.kind,
  })
}

function freezeErrorRecord(e: ShadowErrorRecord): ShadowErrorRecord {
  return deepFreeze({ ...e })
}

function freezeInstrumentation(i: ShadowInstrumentation | null): ShadowInstrumentation | null {
  if (!i) return null
  return deepFreeze({
    agentCount: i.agentCount,
    zoneCount: i.zoneCount,
    edgeCount: i.edgeCount,
    sortDurationMs: i.sortDurationMs,
    cycleDetected: i.cycleDetected,
    providerTrusted: i.providerTrusted,
    uniqueCandidateCount: i.uniqueCandidateCount,
    membershipCheckCount: i.membershipCheckCount,
    gridEntryCount: i.gridEntryCount,
    gridCellCount: i.gridCellCount,
  })
}

function freezeProductionCounters(c: { computeCount: number; errorCount: number; lastErrorTimestamp: number }) {
  return Object.freeze({ computeCount: c.computeCount, errorCount: c.errorCount, lastErrorTimestamp: c.lastErrorTimestamp })
}

// ── ShadowRenderer class ──

export class ShadowRenderer {
  private _mapData: Record<string, unknown> | undefined
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
  private _membershipState: ConstraintMembershipState = createEmptyMembershipState()
  private _errors: ShadowErrorRecord[] = []
  private _state: ShadowSnapshot['state'] = 'disabled'
  private _stateReason = 'not initialized'
  private _destroyed = false

  // Low-cost production counters (always active)
  private _computeCount = 0
  private _errorCount = 0
  private _lastErrorTimestamp = 0

  // Feature flag (default off) — set by HallScene only
  private _enabled = false

  // Lazy init: don't parse v2 until enabled or debug mode
  private _initialized = false

  constructor(opts: ShadowRendererOptions = {}) {
    this._mapData = opts.mapData
    this._throttleMs = opts.throttleMs ?? THROTTLE_MS
    this._now = opts.now ?? (() => Date.now())
    // Lazy: do NOT parse here. Wait for enable().
  }

  // ── Public API ──

  /** Enable the shadow renderer. Triggers lazy init (parse v2, build grid). */
  enable(): void {
    if (this._destroyed) return
    this._enabled = true
    this._ensureInit()
  }

  /** Disable the shadow renderer. @deprecated prefer dispose+recreate for lifecycle. */
  disable(): void {
    this._enabled = false
  }

  get enabled(): boolean { return this._enabled }

  /** Set map data. If enabled, re-parses immediately. If not, stores for later. */
  setMapData(mapData: Record<string, unknown>): void {
    if (this._destroyed) return
    this._mapData = mapData
    this._resetInternalState()
    if (this._enabled) {
      this._ensureInit()
    }
  }

  get canonicalIr(): CanonicalSceneIr | null { return this._canonicalIr }
  get spatialGrid(): SpatialGrid | null { return this._spatialGrid }
  get candidateProvider(): SpatialGridCandidateProvider | null { return this._candidateProvider }
  get membershipState(): ConstraintMembershipState { return this._membershipState }

  /** Deep-frozen copy of production counters — external callers cannot mutate internals. */
  get productionCounters(): Readonly<{ computeCount: number; errorCount: number; lastErrorTimestamp: number }> {
    return freezeProductionCounters({
      computeCount: this._computeCount,
      errorCount: this._errorCount,
      lastErrorTimestamp: this._lastErrorTimestamp,
    })
  }

  get state(): ShadowSnapshot['state'] { return this._state }
  get stateReason(): string { return this._stateReason }

  /** Force a full recompute on next call. */
  invalidate(): void {
    this._lastComputeTime = 0
    this._lastSnapshot = null
  }

  /** Dispose the shadow renderer completely. */
  dispose(): void {
    this._destroyed = true
    this._mapData = undefined
    this._canonicalIr = null
    this._spatialGrid = null
    this._candidateProvider = null
    this._membershipState = createEmptyMembershipState()
    this._errors = []
    this._lastSnapshot = null
    this._state = 'disabled'
    this._stateReason = 'disposed'
    this._enabled = false
    this._initialized = false
  }

  /**
   * Compute shadow snapshot from live V2 runtime object snapshots.
   * Throttled: returns last snapshot if within throttle window.
   * The committed V2 scene continues to operate independently.
   */
  computeSnapshot(runtimeObjects: readonly RuntimeObjectSnapshot[]): ShadowSnapshot {
    if (this._destroyed) {
      return this._buildEmpty('disabled', 'disposed')
    }

    if (!this._enabled) {
      return this._buildEmpty('disabled', 'not enabled')
    }

    // Throttle
    const now = this._now()
    if (now - this._lastComputeTime < this._throttleMs && this._snapshotVersion > 0 && this._lastSnapshot) {
      return this._lastSnapshot
    }

    this._computeCount++

    try {
      if (this._state !== 'ready') {
        return this._buildFromState()
      }

      // Adapt live runtime objects
      const { nodes, diagnostics, adaptErrors } = this._adaptRuntimeObjects(runtimeObjects)
      for (const ae of adaptErrors) this._recordError(ae)

      if (nodes.length === 0) {
        return this._buildReady(diagnostics, [], [], null)
      }

      // Run constraint resolver
      const ir = this._canonicalIr!
      const zoneRegistry = new Map<string, OcclusionConstraintZone>()
      for (const z of ir.zones) zoneRegistry.set(z.stableId, z)

      const instr = createConstraintInstrumentation()
      let resolution: ConstraintResolution

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
        this._membershipState = resolution.nextMembership
      } catch (err) {
        this._recordError(this._errorFromException(err, '(resolver)'))
        const savedState = this._state
        const savedReason = this._stateReason
        this._state = 'error'
        this._stateReason = `constraint resolution failed: ${this._errorFromException(err, '(resolver)').message}`
        const snap = this._buildReady(diagnostics, [], [], null)
        this._state = savedState
        this._stateReason = savedReason
        this._lastSnapshot = snap
        this._lastComputeTime = now
        return snap
      }

      // Populate order/depth/edges
      const orderMap = new Map<string, number>()
      resolution.order.forEach((id, idx) => { orderMap.set(id, idx) })

      const totalObjects = resolution.order.length
      for (const d of diagnostics) {
        const idx = orderMap.get(d.stableId)
        if (idx !== undefined) {
          d.v2OrderIndex = idx
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
        d.diffReason = this._computeDiffReason(d)
      }

      this._lastComputeTime = now
      this._snapshotVersion++
      this._lastSnapshot = this._buildReady(
        diagnostics,
        this._errors,
        resolution.edges,
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
      )
      return this._lastSnapshot
    } catch (err) {
      this._recordError(this._errorFromException(err, '(computeSnapshot)'))
      const savedState = this._state
      const savedReason = this._stateReason
      this._state = 'error'
      this._stateReason = `unexpected error: ${this._errorFromException(err, '(computeSnapshot)').message}`
      const snap = this._buildReady([], [], [], null)
      this._state = savedState
      this._stateReason = savedReason
      this._lastSnapshot = snap
      this._lastComputeTime = now
      return snap
    }
  }

  // ── Private init ──

  private _ensureInit(): void {
    if (this._initialized) return
    if (!this._mapData) return
    this._initialized = true
    this._tryInitialize()
  }

  private _resetInternalState(): void {
    this._canonicalIr = null
    this._parseError = null
    this._spatialGrid = null
    this._candidateProvider = null
    this._membershipState = createEmptyMembershipState()
    this._errors = []
    this._lastSnapshot = null
    this._state = 'disabled'
    this._stateReason = 'map data changed'
    this._initialized = false
  }

  private _tryInitialize(): void {
    if (!this._mapData) {
      this._state = 'disabled'
      this._stateReason = 'no map data'
      return
    }

    try {
      if (!hasRenderSchemaV2(this._mapData)) {
        this._state = 'not-ready'
        this._stateReason = 'hall.tmx has no v2 render schema; shadow comparison disabled'
        return
      }

      this._canonicalIr = parseCanonicalIrFromData(this._mapData)

      if (!this._canonicalIr.fragments.length && !this._canonicalIr.zones.length && !this._canonicalIr.objects.length) {
        this._state = 'not-ready'
        this._stateReason = 'v2 IR parsed but contains no objects, fragments, or zones'
        return
      }

      for (const zone of this._canonicalIr.zones) {
        validateAndCanonicalizePolygon(zone.polygon, zone.stableId, this._canonicalIr.sceneId)
      }

      this._spatialGrid = new SpatialGrid()
      for (const zone of this._canonicalIr.zones) {
        this._spatialGrid.register(
          { stableId: zone.stableId, entryKind: 'zone', bounds: zone.bounds },
          this._canonicalIr.sceneId, zone.floorId,
        )
      }
      for (const frag of this._canonicalIr.fragments) {
        this._spatialGrid.register(
          { stableId: frag.stableId, entryKind: 'fragment', bounds: frag.destinationRect },
          this._canonicalIr.sceneId, frag.floorId,
        )
      }
      for (const obj of this._canonicalIr.objects) {
        const objBounds = obj.geometry?.footprint?.length
          ? (() => {
              const xs = obj.geometry!.footprint!.map((p: { x: number }) => p.x)
              const ys = obj.geometry!.footprint!.map((p: { y: number }) => p.y)
              return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
            })()
          : obj.render?.type === 'asset'
            ? obj.render.destinationRect
            : { x: obj.sortAnchor.x - 8, y: obj.sortAnchor.y - 8, width: 16, height: 16 }
        this._spatialGrid.register(
          { stableId: obj.stableId, entryKind: obj.kind === 'agent' ? 'agent' : obj.kind === 'prop' ? 'prop' : 'hotspot', bounds: objBounds },
          this._canonicalIr.sceneId, obj.floorId,
        )
      }

      this._candidateProvider = createConstraintCandidateProvider(this._spatialGrid)
      this._state = 'ready'
      this._stateReason = ''
    } catch (err) {
      const record = this._errorFromException(err, '(init)')
      this._errors.push(record)
      this._errorCount++
      this._lastErrorTimestamp = record.timestamp
      if (isStructuredFatalRenderSchemaError(err)) {
        this._state = 'fatal'
        this._stateReason = `v2 schema fatal: ${err.errorCode} - ${err.userMessage}`
      } else {
        this._state = 'error'
        this._stateReason = `initialization error: ${record.message}`
      }
    }
  }

  // ── Adapt runtime objects ──

  private _adaptRuntimeObjects(runtimeObjects: readonly RuntimeObjectSnapshot[]): {
    nodes: ConstraintNode[]
    diagnostics: ShadowDiagnostic[]
    adaptErrors: ShadowErrorRecord[]
  } {
    const ir = this._canonicalIr!
    const nodes: ConstraintNode[] = []
    const diagnostics: ShadowDiagnostic[] = []
    const errors: ShadowErrorRecord[] = []

    // Fragment nodes
    for (const frag of ir.fragments) {
      if (frag.renderBand === 'world') {
        try { nodes.push(fragmentToConstraintNode(frag, ir.floorRegistry)) }
        catch (err) { errors.push(this._errorFromException(err, frag.stableId)) }
      }
    }
    // Static objects
    for (const obj of ir.objects) {
      if (obj.renderBand === 'world') {
        try { nodes.push(sceneObjectToConstraintNode(obj, ir.floorRegistry)) }
        catch (err) { errors.push(this._errorFromException(err, obj.stableId)) }
      }
    }

    for (const runtime of runtimeObjects) {
      const diag: ShadowDiagnostic = {
        objectId: runtime.objectId,
        stableId: runtime.stableId || '',
        sourceId: runtime.sourceId || '',
        runtimeDepth: runtime.runtimeDepth,
        v2SortKey: '', v2SortKeyDetail: null,
        v2OrderIndex: -1, v2ProposedDepth: -1,
        constraintEdges: [], membershipCandidates: [],
        diffReason: '', kind: runtime.kind,
      }

      if (runtime.kind === 'agent' && runtime.visible) {
        const stableId = runtime.stableId || `jyt.agent.shadow.${runtime.objectId.replace(/[^a-z0-9._-]/gi, '_').toLowerCase()}.v0`
        diag.stableId = stableId
        try {
          const pseudoObj = {
            stableId, sceneId: ir.sceneId, chunkId: 'runtime',
            kind: 'agent' as const, renderBand: 'world' as const, floorId: 'floor-1',
            elevation: 0, sortMode: 'y' as const,
            sortAnchor: { x: runtime.x, y: runtime.y }, tieBias: 0,
          }
          const sortKey = computeWorldSortKey(pseudoObj, ir.floorRegistry)
          diag.v2SortKey = worldSortKeyToString(sortKey)
          diag.v2SortKeyDetail = sortKey
          nodes.push({ stableId, sceneId: ir.sceneId, floorId: 'floor-1', nodeKind: 'agent', sortKey, position: { x: runtime.x, y: runtime.y } })
          if (this._candidateProvider) {
            try {
              const candidates = this._candidateProvider.queryCandidates({ x: runtime.x, y: runtime.y }, ir.sceneId, 'floor-1')
              diag.membershipCandidates = [...candidates].slice(0, 50)
            } catch { /* non-fatal */ }
          }
        } catch (err) {
          errors.push(this._errorFromException(err, runtime.objectId))
        }
      } else if (runtime.kind === 'prop') {
        diag.stableId = runtime.stableId || `jyt.prop.shadow.${runtime.objectId.replace(/[^a-z0-9._-]/gi, '_').toLowerCase()}.v0`
        diag.diffReason = 'runtime prop'
      } else if (runtime.kind === 'fragment') {
        diag.stableId = runtime.stableId || `jyt.fragment.shadow.${runtime.objectId.replace(/[^a-z0-9._-]/gi, '_').toLowerCase()}.v0`
        diag.diffReason = 'runtime fragment'
      } else if (runtime.kind === 'layer') {
        diag.stableId = runtime.stableId || `jyt.layer.shadow.${runtime.objectId.replace(/[^a-z0-9._-]/gi, '_').toLowerCase()}.v0`
        diag.diffReason = 'runtime layer'
      } else {
        diag.diffReason = 'runtime unknown object kind'
      }
      diagnostics.push(diag)
    }
    return { nodes, diagnostics, adaptErrors: errors }
  }

  // ── Snapshot builders ──

  private _buildEmpty(state: ShadowSnapshot['state'], reason: string): ShadowSnapshot {
    return deepFreeze({
      version: this._snapshotVersion, state, stateReason: reason,
      hasV2Schema: false,
      diagnostics: deepFreeze([]),
      diagnosticsTruncation: deepFreeze({ originalCount: 0, retainedCount: 0, truncatedCount: 0 }),
      edgeCount: 0, zoneCount: 0, fragmentCount: 0,
      gridCellCount: 0, gridEntryCount: 0, sortDurationMs: 0,
      instrumentation: null,
      errors: deepFreeze([]),
      errorsTruncation: deepFreeze({ originalCount: 0, retainedCount: 0, truncatedCount: 0 }),
      timestamp: this._now(),
    }) as unknown as ShadowSnapshot
  }

  private _buildFromState(): ShadowSnapshot {
    const allErrors = [...this._errors]
    const errOrig = allErrors.length
    const retainedErrors = allErrors.slice(0, MAX_ERRORS)
    return deepFreeze({
      version: this._snapshotVersion, state: this._state, stateReason: this._stateReason,
      hasV2Schema: this._canonicalIr !== null,
      diagnostics: deepFreeze([]),
      diagnosticsTruncation: deepFreeze({ originalCount: 0, retainedCount: 0, truncatedCount: 0 }),
      edgeCount: 0,
      zoneCount: this._canonicalIr?.zones.length ?? 0,
      fragmentCount: this._canonicalIr?.fragments.length ?? 0,
      gridCellCount: this._spatialGrid?.getCellCount() ?? 0,
      gridEntryCount: this._spatialGrid?.getEntryCount() ?? 0,
      sortDurationMs: 0, instrumentation: null,
      errors: deepFreeze(retainedErrors.map(freezeErrorRecord)),
      errorsTruncation: deepFreeze({ originalCount: errOrig, retainedCount: retainedErrors.length, truncatedCount: Math.max(0, errOrig - MAX_ERRORS) }),
      timestamp: this._now(),
    }) as unknown as ShadowSnapshot
  }

  private _buildReady(
    diagnostics: ShadowDiagnostic[],
    allErrors: ShadowErrorRecord[],
    edges: ConstraintEdge[],
    instrumentation: ShadowInstrumentation | null,
  ): ShadowSnapshot {
    const diagOrig = diagnostics.length
    const diagRetained = diagnostics.slice(0, MAX_SNAPSHOT_OBJECTS)
    const errOrig = allErrors.length
    const errRetained = allErrors.slice(0, MAX_ERRORS)

    return deepFreeze({
      version: this._snapshotVersion,
      state: this._state,
      stateReason: this._stateReason,
      hasV2Schema: true,
      diagnostics: deepFreeze(diagRetained.map(freezeDiagnostic)),
      diagnosticsTruncation: deepFreeze({ originalCount: diagOrig, retainedCount: diagRetained.length, truncatedCount: Math.max(0, diagOrig - MAX_SNAPSHOT_OBJECTS) }),
      edgeCount: edges.length,
      zoneCount: this._canonicalIr?.zones.length ?? 0,
      fragmentCount: this._canonicalIr?.fragments.length ?? 0,
      gridCellCount: this._spatialGrid?.getCellCount() ?? 0,
      gridEntryCount: this._spatialGrid?.getEntryCount() ?? 0,
      sortDurationMs: instrumentation?.sortDurationMs ?? 0,
      instrumentation: freezeInstrumentation(instrumentation),
      errors: deepFreeze(errRetained.map(freezeErrorRecord)),
      errorsTruncation: deepFreeze({ originalCount: errOrig, retainedCount: errRetained.length, truncatedCount: Math.max(0, errOrig - MAX_ERRORS) }),
      timestamp: this._now(),
    }) as unknown as ShadowSnapshot
  }

  private _computeDiffReason(diag: ShadowDiagnostic): string {
    if (diag.diffReason) return diag.diffReason
    if (diag.v2OrderIndex < 0) return 'not in v2 sort order'
    return `v2 order #${diag.v2OrderIndex}, runtime depth ${diag.runtimeDepth.toFixed(2)}`
  }

  private _errorFromException(err: unknown, objectId: string): ShadowErrorRecord {
    if (isStructuredFatalRenderSchemaError(err)) {
      return { code: err.errorCode, objectId: err.objectId || objectId, field: err.field, message: err.userMessage, timestamp: this._now() }
    }
    if (err instanceof Error) {
      return { code: 'SHADOW_INTERNAL_ERROR', objectId, field: '(unknown)', message: err.message.slice(0, 200), timestamp: this._now() }
    }
    return { code: 'SHADOW_UNKNOWN_ERROR', objectId, field: '(unknown)', message: String(err).slice(0, 200), timestamp: this._now() }
  }

  private _recordError(e: ShadowErrorRecord): void {
    if (this._errors.length < MAX_ERRORS * 2) { // keep a bit extra for count tracking
      this._errors.push(e)
    }
    this._errorCount++
    this._lastErrorTimestamp = e.timestamp
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
