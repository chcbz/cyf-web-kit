// ── E5 World Order ──
// Deterministic total order key for all SceneObjects.
// Frozen contract per §5.2 of juyiting-occlusion-system-design.md.
//
// Sort key (ascending):
//   renderBandOrder → floorOrder → elevation → fixedPointY → tieBias → stableId ASCII bytes
//
// chunkId does NOT participate. No localeCompare. Byte-deterministic.

import {
  type SceneObject,
  type RenderBand,
  RENDER_BAND_ORDER,
  STABLE_ID_PATTERN,
  TIE_BIAS_MIN,
  TIE_BIAS_MAX,
  renderSchemaError,
  type RenderSchemaErrorCode,
} from './schema.js'

// ── WorldSortKey type ──

export interface WorldSortKey {
  renderBandOrder: number
  floorOrder: number
  elevation: number
  fixedPointY: number
  tieBias: number
  stableId: string
}

// ── Key computation ──

/**
 * Compute the deterministic sort key for a single SceneObject.
 * Validates all fields and throws RenderSchemaError on any violation.
 */
export function computeWorldSortKey(
  obj: SceneObject,
  floorRegistry: Readonly<Record<string, number>>,
): WorldSortKey {
  // 1. Render band order
  const band: RenderBand = obj.renderBand
  const renderBandOrder = RENDER_BAND_ORDER[band]
  if (renderBandOrder === undefined) {
    throw renderSchemaError(
      'RENDER_BAND_INVALID' as RenderSchemaErrorCode,
      obj.sceneId,
      obj.stableId,
      'renderBand',
      `无效 renderBand: ${String(band)}`,
      `unknown renderBand: ${String(band)}`,
    )
  }

  // 2. Floor order (from registry; unknown floor is fatal)
  const floorOrder = floorRegistry[obj.floorId]
  if (floorOrder === undefined) {
    throw renderSchemaError(
      'FLOOR_ID_UNKNOWN' as RenderSchemaErrorCode,
      obj.sceneId,
      obj.stableId,
      'floorId',
      `未知 floorId: ${obj.floorId}`,
      `floorId "${obj.floorId}" not found in floor registry`,
    )
  }

  // 3. Elevation must be an integer
  if (!Number.isSafeInteger(obj.elevation)) {
    throw renderSchemaError(
      'ELEVATION_INVALID' as RenderSchemaErrorCode,
      obj.sceneId,
      obj.stableId,
      'elevation',
      `elevation 必须是安全整数: ${String(obj.elevation)}`,
      `elevation must be a safe integer, got ${typeof obj.elevation} ${String(obj.elevation)}`,
    )
  }

  // 4. Fixed-point Y = round(sortAnchor.y * 256)
  if (typeof obj.sortAnchor?.y !== 'number' || !Number.isFinite(obj.sortAnchor.y)) {
    throw renderSchemaError(
      'SORT_ANCHOR_INVALID' as RenderSchemaErrorCode,
      obj.sceneId,
      obj.stableId,
      'sortAnchor.y',
      `sortAnchor.y 必须为有限数字: ${String(obj.sortAnchor?.y)}`,
      `sortAnchor.y must be a finite number, got ${String(obj.sortAnchor?.y)}`,
    )
  }
  const fixedPointY = Math.round(obj.sortAnchor.y * 256)
  const fixedPointYNorm = Object.is(fixedPointY, -0) ? 0 : fixedPointY
  if (!Number.isSafeInteger(fixedPointYNorm)) {
    throw renderSchemaError(
      'SORT_ANCHOR_INVALID' as RenderSchemaErrorCode,
      obj.sceneId,
      obj.stableId,
      'sortAnchor.y',
      `fixedPointY 超出安全整数范围: ${String(fixedPointY)}`,
      `fixedPointY ${String(fixedPointY)} exceeds safe integer range`,
    )
  }

  // 5. Tie bias must be safe integer within [-32, 32]
  if (!Number.isSafeInteger(obj.tieBias) || obj.tieBias < TIE_BIAS_MIN || obj.tieBias > TIE_BIAS_MAX) {
    throw renderSchemaError(
      'TIE_BIAS_OUT_OF_RANGE' as RenderSchemaErrorCode,
      obj.sceneId,
      obj.stableId,
      'tieBias',
      `tieBias 必须在 [${TIE_BIAS_MIN}, ${TIE_BIAS_MAX}] 范围内: ${String(obj.tieBias)}`,
      `tieBias must be safe integer in [${TIE_BIAS_MIN}, ${TIE_BIAS_MAX}], got ${String(obj.tieBias)}`,
    )
  }

  // 6. StableId must match pattern (ASCII-only lowercase/numbers/dot/underscore/dash)
  if (typeof obj.stableId !== 'string' || !STABLE_ID_PATTERN.test(obj.stableId)) {
    throw renderSchemaError(
      'STABLE_ID_INVALID_PATTERN' as RenderSchemaErrorCode,
      obj.sceneId,
      obj.stableId,
      'stableId',
      `stableId 不符合模式: ${String(obj.stableId)}`,
      `stableId must match ${STABLE_ID_PATTERN.source}, got "${String(obj.stableId)}"`,
    )
  }
  // Ensure stableId is pure ASCII (no unicode in valid pattern, but double-check)
  for (let i = 0; i < obj.stableId.length; i++) {
    if (obj.stableId.charCodeAt(i) > 127) {
      throw renderSchemaError(
        'STABLE_ID_INVALID_PATTERN' as RenderSchemaErrorCode,
        obj.sceneId,
        obj.stableId,
        'stableId',
        `stableId 包含非 ASCII 字符`,
        `stableId contains non-ASCII character at position ${i}`,
      )
    }
  }

  return {
    renderBandOrder,
    floorOrder,
    elevation: obj.elevation,
    fixedPointY: fixedPointYNorm,
    tieBias: obj.tieBias,
    stableId: obj.stableId,
  }
}

// ── Stable ASCII byte comparison for stableId ──

/**
 * Compare two stableId strings byte-by-byte (ASCII, no localeCompare).
 * Returns -1, 0, or 1.
 */
function compareStableId(a: string, b: string): -1 | 0 | 1 {
  const minLen = a.length < b.length ? a.length : b.length
  for (let i = 0; i < minLen; i++) {
    const ca = a.charCodeAt(i)
    const cb = b.charCodeAt(i)
    if (ca < cb) return -1
    if (ca > cb) return 1
  }
  if (a.length < b.length) return -1
  if (a.length > b.length) return 1
  return 0
}

// ── Full key comparison ──

/**
 * Compare two WorldSortKeys deterministically.
 * Order:
 *   1. renderBandOrder (asc)
 *   2. floorOrder (asc)
 *   3. elevation (asc)
 *   4. fixedPointY (asc)
 *   5. tieBias (asc) — only matters when first 4 match
 *   6. stableId ASCII byte order (asc)
 *
 * Returns -1 (a before b), 0 (equal), or 1 (a after b).
 */
export function compareWorldSortKeys(a: WorldSortKey, b: WorldSortKey): -1 | 0 | 1 {
  if (a.renderBandOrder !== b.renderBandOrder) {
    return a.renderBandOrder < b.renderBandOrder ? -1 : 1
  }
  if (a.floorOrder !== b.floorOrder) {
    return a.floorOrder < b.floorOrder ? -1 : 1
  }
  if (a.elevation !== b.elevation) {
    return a.elevation < b.elevation ? -1 : 1
  }
  if (a.fixedPointY !== b.fixedPointY) {
    return a.fixedPointY < b.fixedPointY ? -1 : 1
  }
  if (a.tieBias !== b.tieBias) {
    return a.tieBias < b.tieBias ? -1 : 1
  }
  return compareStableId(a.stableId, b.stableId)
}

// ── Base order sort (no constraints) ──

/**
 * Sort objects by their base WorldSortKey only (no constraint edges).
 * This is the "no constraint" baseline: result must be byte-identical
 * to what Kahn produces when edge set is empty.
 */
export function baseOrderSort(
  objects: readonly SceneObject[],
  floorRegistry: Readonly<Record<string, number>>,
): SceneObject[] {
  const withKeys = objects.map(obj => ({
    obj,
    key: computeWorldSortKey(obj, floorRegistry),
  }))
  withKeys.sort((a, b) => compareWorldSortKeys(a.key, b.key))
  return withKeys.map(item => item.obj)
}

// ── Batch key computation ──

/**
 * Compute sort keys for all objects. Returns map from stableId to key.
 */
export function computeAllWorldSortKeys(
  objects: readonly SceneObject[],
  floorRegistry: Readonly<Record<string, number>>,
): Map<string, WorldSortKey> {
  const map = new Map<string, WorldSortKey>()
  for (const obj of objects) {
    map.set(obj.stableId, computeWorldSortKey(obj, floorRegistry))
  }
  return map
}

// ── String serialization (for debugging/instrumentation) ──

/**
 * Deterministic string representation of a WorldSortKey.
 * Format: "band|floor|elev|fixedY|tieBias|stableId"
 */
export function worldSortKeyToString(key: WorldSortKey): string {
  return `${key.renderBandOrder}|${key.floorOrder}|${key.elevation}|${key.fixedPointY}|${key.tieBias}|${key.stableId}`
}

/**
 * Parse a sort key string back to WorldSortKey.
 */
export function parseWorldSortKeyString(str: string): WorldSortKey {
  const parts = str.split('|')
  if (parts.length !== 6) {
    throw new Error(`invalid sort key string: ${str}`)
  }
  return {
    renderBandOrder: Number(parts[0]),
    floorOrder: Number(parts[1]),
    elevation: Number(parts[2]),
    fixedPointY: Number(parts[3]),
    tieBias: Number(parts[4]),
    stableId: parts[5],
  }
}
