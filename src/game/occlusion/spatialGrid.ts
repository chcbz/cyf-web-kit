// ── E5 Spatial Grid ──
// Uniform grid for candidate discovery of OcclusionConstraintZones.
// Frozen contract per §5.4 of juyiting-occlusion-system-design.md.
//
// - Each zone/fragment/prop/hotspot registers in covering cells
// - Each authoritative object registered at most once
// - Agent queries current cell + necessary adjacent cells
// - AABB covers cell boundaries precisely
// - Handles negative coordinates, floor/scene/chunk
// - remove/update leaves no stale entries
// - Batch ops atomic
// - Never agents × all zones full scan

import {
  type Point,
  type Rect,
  renderSchemaError,
  type RenderSchemaErrorCode,
} from './schema.js'

// ── Legal cell sizes ──

export const LEGAL_CELL_SIZES = [128, 256] as const
export type CellSize = (typeof LEGAL_CELL_SIZES)[number]

export const DEFAULT_CELL_SIZE: CellSize = 256

function isLegalCellSize(n: number): n is CellSize {
  return n === 128 || n === 256
}

// ── Cell key ──

/**
 * Cell key encoding: sceneId|floorId|cellX|cellY
 */
export interface CellKey {
  sceneId: string
  floorId: string
  cellX: number
  cellY: number
}

function cellKeyToString(key: CellKey): string {
  return `${key.sceneId}|${key.floorId}|${key.cellX}|${key.cellY}`
}

// ── Grid entry ──

export interface GridEntry {
  /** Authoritative stableId of the registered object */
  stableId: string
  /** Type discriminator */
  entryKind: 'zone' | 'fragment' | 'prop' | 'hotspot' | 'agent'
  /** AABB in world coordinates for this entry (used for precise candidate filtering) */
  bounds: Rect
}

// ── Provenance brand for SpatialGrid-backed candidate providers ──

/**
 * Symbol stamped on every SpatialGrid-backed ConstraintCandidateProvider.
 * The constraint resolver checks this brand and rejects unbranded providers
 * in production (test doubles use explicit opt-out).
 */
export const SPATIAL_GRID_PROVIDER_BRAND = Symbol('spatial-grid-provider')

// ── Spatial grid ──


/** Runtime-immutable ReadonlySet view for cached candidate neighborhoods. */
class ImmutableSetView<T> implements ReadonlySet<T> {
  readonly #source: Set<T>

  constructor(source: Set<T>) {
    this.#source = source
    Object.freeze(this)
  }

  get size(): number { return this.#source.size }
  has(value: T): boolean { return this.#source.has(value) }
  entries(): SetIterator<[T, T]> { return this.#source.entries() }
  keys(): SetIterator<T> { return this.#source.keys() }
  values(): SetIterator<T> { return this.#source.values() }
  [Symbol.iterator](): SetIterator<T> { return this.#source[Symbol.iterator]() }
  forEach(callbackfn: (value: T, value2: T, set: ReadonlySet<T>) => void, thisArg?: unknown): void {
    for (const value of this.#source) callbackfn.call(thisArg, value, value, this)
  }
}

export class SpatialGrid {
  private cellSize: CellSize
  /** Map from cell key string → Set of stableIds */
  private cells: Map<string, Set<string>>
  /** Map from stableId → GridEntry (authoritative registry) */
  private entries: Map<string, GridEntry>
  /** Per-kind cell indexes keep constraint-zone discovery independent of nearby agents/assets. */
  private cellsByKind: Map<GridEntry['entryKind'], Map<string, Set<string>>>
  /** Reverse index: stableId → exact occupied cell keys (prevents full-grid unregister scans). */
  private entryCellKeys: Map<string, Set<string>>
  /** Stable coverage signature enables allocation-free same-cell moving updates. */
  private entryCellSignatures: Map<string, string>
  /** Optional cumulative instrumentation used by the fixed E14 benchmark. */
  private instrumentation?: SpatialGridInstrumentation
  /** Scene-static zone candidates cached by query cell for the constraint provider. */
  private constraintZoneNeighborhoodCache: Map<string, ReadonlySet<string>>

  constructor(
    cellSize: number = DEFAULT_CELL_SIZE,
    instrumentation?: SpatialGridInstrumentation,
  ) {
    if (!isLegalCellSize(cellSize)) {
      throw renderSchemaError(
        'RENDER_SCHEMA_VERSION_UNSUPPORTED' as RenderSchemaErrorCode,
        '(spatial-grid)',
        '(grid)',
        'cellSize',
        `cellSize 必须为 128 或 256: ${cellSize}`,
        `invalid cellSize ${cellSize}, must be 128 or 256`,
      )
    }
    this.cellSize = cellSize
    this.cells = new Map()
    this.entries = new Map()
    this.cellsByKind = new Map()
    this.entryCellKeys = new Map()
    this.entryCellSignatures = new Map()
    this.instrumentation = instrumentation
    this.constraintZoneNeighborhoodCache = new Map()
  }

  /** Get current cell size */
  getCellSize(): CellSize { return this.cellSize }

  /** Number of registered entries */
  getEntryCount(): number { return this.entries.size }

  /** Number of occupied cells */
  getCellCount(): number { return this.cells.size }

  /**
   * Compute cell coordinates for a world point.
   * Uses floor division (correct for negative coordinates).
   */
  private worldToCell(x: number, y: number): { cellX: number; cellY: number } {
    const cellX = Math.floor(x / this.cellSize)
    const cellY = Math.floor(y / this.cellSize)
    return { cellX: Object.is(cellX, -0) ? 0 : cellX, cellY: Object.is(cellY, -0) ? 0 : cellY }
  }

  private aabbCellRange(bounds: Rect): { minCx: number; minCy: number; maxCx: number; maxCy: number } {
    const { cellX: minCx, cellY: minCy } = this.worldToCell(bounds.x, bounds.y)
    const { cellX: maxCx, cellY: maxCy } = this.worldToCell(
      bounds.x + bounds.width,
      bounds.y + bounds.height,
    )
    return { minCx, minCy, maxCx, maxCy }
  }

  /**
   * Compute all cell keys covered by an AABB.
   * Covers cells that overlap the AABB (inclusive on both ends).
   */
  private aabbToCellKeys(
    bounds: Rect,
    sceneId: string,
    floorId: string,
  ): CellKey[] {
    const { minCx, minCy, maxCx, maxCy } = this.aabbCellRange(bounds)

    const keys: CellKey[] = []
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        keys.push({ sceneId, floorId, cellX: cx, cellY: cy })
      }
    }
    return keys
  }

  /**
   * Register an entry in its covering cells.
   * If stableId already exists, removes stale cells first (update semantics).
   */
  register(
    entry: GridEntry,
    sceneId: string,
    floorId: string,
  ): void {
    // Moving agents commonly retain the same cell coverage for many frames.
    // Compare a compact range signature before allocating cell keys or Sets.
    const range = this.aabbCellRange(entry.bounds)
    const coverageSignature = `${sceneId}|${floorId}|${range.minCx}|${range.minCy}|${range.maxCx}|${range.maxCy}`
    const previousEntry = this.entries.get(entry.stableId)
    if (
      previousEntry?.entryKind === entry.entryKind &&
      this.entryCellSignatures.get(entry.stableId) === coverageSignature
    ) {
      // Zone geometry/bounds may change without crossing a cell boundary.
      // Invalidate even though the indexed stableId neighborhood is unchanged,
      // so the cache contract remains correct for every zone update.
      if (entry.entryKind === 'zone') this.constraintZoneNeighborhoodCache.clear()
      this.entries.set(entry.stableId, { ...entry })
      return
    }

    const occupiedKeys = new Set<string>()
    for (let cx = range.minCx; cx <= range.maxCx; cx++) {
      for (let cy = range.minCy; cy <= range.maxCy; cy++) {
        occupiedKeys.add(cellKeyToString({ sceneId, floorId, cellX: cx, cellY: cy }))
      }
    }

    // Cell coverage or kind changed: remove the old indexed membership first.
    if (previousEntry) this.unregister(entry.stableId)

    // Zone neighborhood results are scene-static between zone topology
    // changes. Agent/fragment/prop updates do not invalidate this cache.
    if (entry.entryKind === 'zone') this.constraintZoneNeighborhoodCache.clear()

    // Store entry
    this.entries.set(entry.stableId, { ...entry })

    for (const keyStr of occupiedKeys) {
      if (this.instrumentation) this.instrumentation.updateCellVisitCount++
      let cell = this.cells.get(keyStr)
      if (!cell) {
        cell = new Set()
        this.cells.set(keyStr, cell)
      }
      cell.add(entry.stableId)

      let kindCells = this.cellsByKind.get(entry.entryKind)
      if (!kindCells) {
        kindCells = new Map()
        this.cellsByKind.set(entry.entryKind, kindCells)
      }
      let kindCell = kindCells.get(keyStr)
      if (!kindCell) {
        kindCell = new Set()
        kindCells.set(keyStr, kindCell)
      }
      kindCell.add(entry.stableId)
    }
    this.entryCellKeys.set(entry.stableId, occupiedKeys)
    this.entryCellSignatures.set(entry.stableId, coverageSignature)
  }

  /**
   * Remove an entry completely from the grid.
   * Leaves no stale entries in any cell.
   */
  unregister(stableId: string): void {
    const occupiedKeys = this.entryCellKeys.get(stableId)
    const entry = this.entries.get(stableId)
    const kindCells = entry ? this.cellsByKind.get(entry.entryKind) : undefined
    if (entry?.entryKind === 'zone') this.constraintZoneNeighborhoodCache.clear()

    if (occupiedKeys) {
      // O(cells occupied by this entry), never O(all occupied map cells).
      for (const keyStr of occupiedKeys) {
        if (this.instrumentation) this.instrumentation.updateCellVisitCount++
        const cell = this.cells.get(keyStr)
        if (!cell) continue
        cell.delete(stableId)
        if (cell.size === 0) this.cells.delete(keyStr)

        const kindCell = kindCells?.get(keyStr)
        if (kindCell) {
          kindCell.delete(stableId)
          if (kindCell.size === 0) kindCells!.delete(keyStr)
        }
      }
      if (entry && kindCells?.size === 0) this.cellsByKind.delete(entry.entryKind)
    } else if (this.entries.has(stableId)) {
      // Defensive recovery for an impossible inconsistent index. This path is
      // explicitly observable so production benchmarks cannot hide a full scan.
      if (this.instrumentation) this.instrumentation.scanCount++
      for (const [keyStr, cell] of this.cells) {
        cell.delete(stableId)
        if (cell.size === 0) this.cells.delete(keyStr)
      }
      for (const [kind, indexedCells] of this.cellsByKind) {
        for (const [keyStr, cell] of indexedCells) {
          cell.delete(stableId)
          if (cell.size === 0) indexedCells.delete(keyStr)
        }
        if (indexedCells.size === 0) this.cellsByKind.delete(kind)
      }
    }

    this.entryCellKeys.delete(stableId)
    this.entryCellSignatures.delete(stableId)
    this.entries.delete(stableId)
  }

  /**
   * Batch-register multiple entries atomically.
   * All-or-nothing: validates all first, then applies.
   */
  batchRegister(
    entries: Array<{ entry: GridEntry; sceneId: string; floorId: string }>,
  ): void {
    // Validate all first
    for (const { entry } of entries) {
      if (!entry.stableId || !entry.bounds) {
        throw renderSchemaError(
          'OBJECT_REFERENCE_INVALID' as RenderSchemaErrorCode,
          '(spatial-grid)',
          entry.stableId ?? '(unknown)',
          'entry',
          `batch register 条目无效: ${JSON.stringify(entry)}`,
          `invalid batch register entry: missing stableId or bounds`,
        )
      }
    }

    // Apply all
    for (const { entry, sceneId, floorId } of entries) {
      this.register(entry, sceneId, floorId)
    }
  }

  /**
   * Query entries that overlap with a point's cell + adjacent cells.
   *
   * Returns stableIds of entries in:
   * - The cell containing the point
   * - The 8 adjacent cells (Moore neighborhood)
   *
   * Caller MUST do precise AABB/bounds filtering after candidate discovery.
   * This method is O(1) in the number of total entries.
   */
  queryCandidates(
    position: Point,
    sceneId: string,
    floorId: string,
  ): Set<string> {
    const { cellX, cellY } = this.worldToCell(position.x, position.y)
    const result = new Set<string>()

    // Current cell + 8 neighbors
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key: CellKey = {
          sceneId,
          floorId,
          cellX: cellX + dx,
          cellY: cellY + dy,
        }
        const keyStr = cellKeyToString(key)
        if (this.instrumentation) this.instrumentation.cellQueryCount++
        const cell = this.cells.get(keyStr)
        if (cell) {
          for (const id of cell) {
            result.add(id)
          }
        }
      }
    }

    if (this.instrumentation) this.instrumentation.candidateCount += result.size
    return result
  }

  /**
   * Query nearby stableIds from a single entry-kind index.
   * Constraint resolution uses this for zones so nearby moving agents and
   * render fragments are never materialized as throwaway candidates.
   */
  queryCandidateIdsByKind(
    position: Point,
    sceneId: string,
    floorId: string,
    kind: GridEntry['entryKind'],
  ): Set<string> {
    const { cellX, cellY } = this.worldToCell(position.x, position.y)
    const result = new Set<string>()
    const indexedCells = this.cellsByKind.get(kind)
    if (!indexedCells) return result

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const keyStr = cellKeyToString({
          sceneId, floorId, cellX: cellX + dx, cellY: cellY + dy,
        })
        if (this.instrumentation) this.instrumentation.cellQueryCount++
        const cell = indexedCells.get(keyStr)
        if (cell) for (const id of cell) result.add(id)
      }
    }

    if (this.instrumentation) this.instrumentation.candidateCount += result.size
    return result
  }

  /**
   * Read-only zone candidates for production constraint resolution.
   * Zones are scene-static, so all agents in the same cell can share one
   * neighborhood result until zone topology changes.
   */
  queryConstraintZoneCandidateIds(
    position: Point,
    sceneId: string,
    floorId: string,
  ): ReadonlySet<string> {
    const { cellX, cellY } = this.worldToCell(position.x, position.y)
    const cacheKey = cellKeyToString({ sceneId, floorId, cellX, cellY })
    const cached = this.constraintZoneNeighborhoodCache.get(cacheKey)
    if (cached) {
      // candidateCount is a logical resolver metric; cellQueryCount records
      // physical index reads, so cache hits intentionally add zero cell reads.
      if (this.instrumentation) this.instrumentation.candidateCount += cached.size
      return cached
    }

    const result = new Set<string>()
    const indexedCells = this.cellsByKind.get('zone')
    if (indexedCells) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const keyStr = cellKeyToString({
            sceneId, floorId, cellX: cellX + dx, cellY: cellY + dy,
          })
          const cell = indexedCells.get(keyStr)
          if (cell) for (const id of cell) result.add(id)
        }
      }
    }
    const immutableResult = new ImmutableSetView(result)
    this.constraintZoneNeighborhoodCache.set(cacheKey, immutableResult)
    if (this.instrumentation) {
      this.instrumentation.cellQueryCount += 9
      this.instrumentation.candidateCount += immutableResult.size
    }
    return immutableResult
  }

  /**
   * Query entries whose AABB overlaps with a query AABB.
   * Uses cell-based candidate discovery + precise AABB filter.
   */
  queryAabb(
    bounds: Rect,
    sceneId: string,
    floorId: string,
  ): GridEntry[] {
    const keys = this.aabbToCellKeys(bounds, sceneId, floorId)
    const candidateIds = new Set<string>()

    for (const key of keys) {
      const keyStr = cellKeyToString(key)
      if (this.instrumentation) this.instrumentation.cellQueryCount++
      const cell = this.cells.get(keyStr)
      if (cell) {
        for (const id of cell) {
          candidateIds.add(id)
        }
      }
    }

    if (this.instrumentation) this.instrumentation.candidateCount += candidateIds.size

    // Precise AABB filter
    const result: GridEntry[] = []
    for (const id of candidateIds) {
      const entry = this.entries.get(id)
      if (entry && aabbOverlap(entry.bounds, bounds)) {
        result.push(entry)
      }
    }

    return result
  }

  /**
   * Get all entries of a specific kind in the cells overlapping a point.
   */
  queryByKind(
    position: Point,
    sceneId: string,
    floorId: string,
    kind: GridEntry['entryKind'],
  ): GridEntry[] {
    const candidates = this.queryCandidates(position, sceneId, floorId)
    const result: GridEntry[] = []
    for (const id of candidates) {
      const entry = this.entries.get(id)
      if (entry && entry.entryKind === kind) {
        result.push(entry)
      }
    }
    return result
  }

  /**
   * Clear all entries (for testing/reset).
   */
  clear(): void {
    this.cells.clear()
    this.entries.clear()
    this.cellsByKind.clear()
    this.entryCellKeys.clear()
    this.entryCellSignatures.clear()
    this.constraintZoneNeighborhoodCache.clear()
  }

  /**
   * Snapshot of all entries (for instrumentation/debugging).
   * Returns a frozen copy that cannot be externally mutated.
   */
  snapshot(): ReadonlyMap<string, Readonly<GridEntry>> {
    const snap = new Map<string, Readonly<GridEntry>>()
    for (const [id, entry] of this.entries) {
      snap.set(id, Object.freeze({ ...entry }))
    }
    return snap
  }
}

// ── AABB overlap test ──

function aabbOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}

// ── Instrumentation ──

export interface SpatialGridInstrumentation {
  /** Candidate IDs observed by local cell queries (cumulative). */
  candidateCount: number
  /** Cell lookups performed by query operations (cumulative). */
  cellQueryCount: number
  /** Full-map cell scans. Must remain zero in production/E14. */
  scanCount: number
  /** Cell visits used to register/update/unregister entries (cumulative). */
  updateCellVisitCount: number
}

export function createSpatialGridInstrumentation(): SpatialGridInstrumentation {
  return {
    candidateCount: 0,
    cellQueryCount: 0,
    scanCount: 0,
    updateCellVisitCount: 0,
  }
}

// ── Branded provider (P2 fix) ──

/**
 * ConstraintCandidateProvider backed by a SpatialGrid.
 * Carries an unforgeable brand symbol so the resolver can verify
 * the provider is truly grid-backed and not a flat bypass.
 *
 * Test doubles must use `createTestCandidateProvider()` which explicitly
 * opts out of the brand check.
 */
export interface SpatialGridCandidateProvider {
  /** Unforgeable provenance brand — must be SPATIAL_GRID_PROVIDER_BRAND */
  readonly _brand: typeof SPATIAL_GRID_PROVIDER_BRAND
  /** Source grid (for diagnostic access) */
  readonly _grid: SpatialGrid
  queryCandidates(position: Point, sceneId: string, floorId: string): ReadonlySet<string>
}

/**
 * Create a branded constraint candidate provider from a SpatialGrid.
 * This is the ONLY way to get a trusted provider for production use.
 */
export function createConstraintCandidateProvider(grid: SpatialGrid): SpatialGridCandidateProvider {
  return {
    _brand: SPATIAL_GRID_PROVIDER_BRAND,
    _grid: grid,
    queryCandidates: (position, sceneId, floorId) =>
      grid.queryConstraintZoneCandidateIds(position, sceneId, floorId),
  }
}

/**
 * Type guard: is this provider backed by a SpatialGrid?
 */
export function isSpatialGridProvider(
  provider: unknown,
): provider is SpatialGridCandidateProvider {
  return (
    typeof provider === 'object' &&
    provider !== null &&
    (provider as SpatialGridCandidateProvider)._brand === SPATIAL_GRID_PROVIDER_BRAND
  )
}
