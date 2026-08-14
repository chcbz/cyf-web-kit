// ── E3 Runtime Agent Adapter ──
// Converts /agent/map runtime agent input into SceneObjects.
// Frozen contract per §6.2 of juyiting-occlusion-system-design.md.

import { type SceneObject, type Point, type RenderBand, type SortMode, renderSchemaError } from './schema.js'
import { SOURCE_ENTITY_ID_MAX_LENGTH, isValidSourceEntityId } from './sourceIdentity.js'

// ── Constants ──

const AGENT_STABLE_ID_PREFIX = 'jyt.agent.' as const
const AGENT_STABLE_ID_SUFFIX = '.v1' as const
const AGENT_KIND: SceneObject['kind'] = 'agent' as const
const AGENT_RENDER_BAND: RenderBand = 'world' as const
const AGENT_SORT_MODE: SortMode = 'y' as const
const DEFAULT_FLOOR_ID = 'floor-1' as const
const DEFAULT_ELEVATION = 0 as const
const DEFAULT_TIE_BIAS = 0 as const
const DEFAULT_SCENE_ID = 'juyiting-main' as const

// ── Base32 (RFC 4648, lowercase) encoding ──

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'

function base32EncodeLower(bytes: Uint8Array): string {
  let result = ''
  let buffer = 0
  let bits = 0

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      result += BASE32_ALPHABET[(buffer >>> bits) & 0x1f]
    }
  }

  // Flush remaining bits
  if (bits > 0) {
    result += BASE32_ALPHABET[(buffer << (5 - bits)) & 0x1f]
  }

  return result
}

// ── Unpaired surrogate detection ──
// TextEncoder replaces unpaired surrogates with U+FFFD, which would cause
// different JS strings to produce identical SHA-256 hashes.

function isWellFormedUtf16(input: string): boolean {
  // Detect unpaired surrogates: high surrogates (0xD800-0xDBFF) must be
  // followed by low surrogates (0xDC00-0xDFFF); lone low surrogates illegal.
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate - must be followed by low surrogate
      if (i + 1 >= input.length) return false
      const next = input.charCodeAt(i + 1)
      if (next < 0xdc00 || next > 0xdfff) return false
      i++ // skip the low surrogate
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      // Lone low surrogate
      return false
    }
  }
  return true
}

// ── SHA-256 via Web Crypto ──

async function sha256Utf8(input: string, sceneId: string, sourceId: string): Promise<Uint8Array> {
  // Check for unpaired surrogates before hashing
  if (!isWellFormedUtf16(input)) {
    throw renderSchemaError(
      'AGENT_UNPAIRED_SURROGATE',
      sceneId,
      sourceId,
      'agentId',
      'agentId 包含不成对的代理对字符，不允许。',
      `agentId contains unpaired surrogate code units: ${JSON.stringify(input.slice(0, 40))}`,
    )
  }

  try {
    if (typeof crypto === 'undefined' || !crypto.subtle || typeof crypto.subtle.digest !== 'function') {
      throw renderSchemaError(
        'AGENT_HASH_FAILED',
        sceneId,
        sourceId,
        'stableId',
        'SHA-256 哈希不可用。',
        'crypto.subtle is not available in this environment',
      )
    }

    const encoder = new TextEncoder()
    const data = encoder.encode(input)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    return new Uint8Array(hashBuffer)
  } catch (error) {
    if (error instanceof Error && (error as { severity?: string }).severity === 'fatal') {
      throw error
    }
    throw renderSchemaError(
      'AGENT_HASH_FAILED',
      sceneId,
      sourceId,
      'stableId',
      'SHA-256 哈希计算失败。',
      `SHA-256 digest failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

// ── Agent stableId derivation ──

async function deriveAgentStableId(
  sourceEntityId: string,
  sceneId: string,
): Promise<string> {
  const hash = await sha256Utf8(sourceEntityId, sceneId, sourceEntityId)
  const base32Hash = base32EncodeLower(hash)
  return `${AGENT_STABLE_ID_PREFIX}${base32Hash}${AGENT_STABLE_ID_SUFFIX}`
}

// ── Clone / freeze ──

function clonePoint(p: Point): Point {
  return { x: p.x, y: p.y }
}

function cloneSceneObject(o: SceneObject): SceneObject {
  const clone: SceneObject = {
    stableId: o.stableId,
    sourceEntityId: o.sourceEntityId,
    sceneId: o.sceneId,
    chunkId: o.chunkId,
    kind: o.kind,
    renderBand: o.renderBand,
    floorId: o.floorId,
    elevation: o.elevation,
    sortMode: o.sortMode,
    sortAnchor: clonePoint(o.sortAnchor),
    tieBias: o.tieBias,
  }

  // Deep-freeze the clone so callers cannot mutate internal state.
  // We freeze deeply enough to cover sortAnchor sub-object.
  return deepFreeze(clone)
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
  }
  return value
}

// ── Input types ──

export interface RuntimeAgentInput {
  /** API-provided agent ID. Must be a non-empty string. Preserved verbatim. */
  agentId: unknown
  /** World position. Defaults to (0, 0) if absent. Must be finite numbers or absent. */
  x?: unknown
  y?: unknown
}

export interface RuntimeAgentUpdate {
  /** Must match a registered agent's sourceEntityId */
  agentId: unknown
  /** New world position. undefined = preserve existing. Must be finite number if provided. */
  x?: unknown
  y?: unknown
}

export interface RuntimeAgentSnapshot {
  /** Must match a registered agent's sourceEntityId */
  agentId: unknown
  /** World position. Must be finite numbers if provided. */
  x?: unknown
  y?: unknown
}

export interface TrustedSpawnResolver {
  (sourceEntityId: string): { floorId: string; elevation: number }
}

export interface TrustedChunkResolver {
  (worldX: number, worldY: number): string
}

export interface AgentSceneObjectEntry {
  sceneObject: SceneObject
  sourceEntityId: string
}

export interface RuntimeAgentAdapterOptions {
  /**
   * Inject a custom hash/derive function for collision testing.
   * Production must NOT set this; defaults to SHA-256 + base32.
   * The function receives (sourceEntityId, sceneId) and returns a stableId.
   * If provided, it replaces the normal crypto.subtle pipeline entirely.
   */
  hashFn?: (sourceEntityId: string, sceneId: string) => Promise<string>
}

// ── Adapter interface ──

export interface RuntimeAgentAdapter {
  /** Create agents from a batch of inputs. Validates all, then applies atomically. */
  create(agents: RuntimeAgentInput[]): Promise<SceneObject[]>
  /** Update agent positions (sortAnchor, chunkId only). Validates all, then applies atomically. */
  update(updates: RuntimeAgentUpdate[]): Promise<SceneObject[]>
  /** Remove agents by sourceEntityId. Validates all, then applies atomically. */
  remove(agentIds: string[]): Promise<string[]>
  /** Look up a frozen SceneObject by sourceEntityId. Returns undefined if not found. */
  lookup(sourceEntityId: string): SceneObject | undefined
  /** Look up sourceEntityId by stableId. Returns undefined if not found. */
  reverseLookup(stableId: string): string | undefined
  /** Current count of registered agents. */
  get agentCount(): number
  /** All registered sourceEntityIds (frozen array). */
  get sourceEntityIds(): string[]
  /** All registered SceneObjects (frozen clones). */
  get sceneObjects(): SceneObject[]
  /** Destroy the adapter and clear all state. */
  destroy(): void
}

// ── Implementation ──

// --- Resolver safety wrappers ---

function safeSpawn(
  resolver: TrustedSpawnResolver,
  sourceId: string,
  sceneId: string,
): { floorId: string; elevation: number } {
  let spawn: unknown
  try {
    spawn = resolver(sourceId)
  } catch (error) {
    throw renderSchemaError(
      'AGENT_RESOLVER_THREW',
      sceneId,
      sourceId,
      'spawn',
      'trusted spawn resolver 抛出异常。',
      `trusted spawn resolver threw: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  // Reject thenable/promise (then getter may throw)
  let spawnIsThenable = false
  try {
    spawnIsThenable = spawn !== null && typeof spawn === 'object'
      && typeof (spawn as { then?: unknown }).then === 'function'
  } catch (error) {
    // then getter threw
    throw renderSchemaError(
      'AGENT_RESOLVER_THREW',
      sceneId,
      sourceId,
      'spawn',
      'trusted spawn resolver 的 then 属性访问抛出异常。',
      `trusted spawn resolver then getter threw: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (spawnIsThenable) {
    throw renderSchemaError(
      'AGENT_RESOLVER_TYPE_INVALID',
      sceneId,
      sourceId,
      'spawn',
      'trusted spawn resolver 不得返回 Promise/thenable。',
      `trusted spawn resolver returned a thenable for ${JSON.stringify(sourceId)}`,
    )
  }

  if (!spawn || typeof spawn !== 'object') {
    throw renderSchemaError(
      'AGENT_SPAWN_INVALID',
      sceneId,
      sourceId,
      'spawn',
      'trusted spawn resolver 返回无效值。',
      `trusted spawn resolver returned non-object: ${typeof spawn} for ${JSON.stringify(sourceId)}`,
    )
  }

  const obj = spawn as Record<string, unknown>

  // floorId getter may throw
  let rawFloorId: unknown
  try {
    rawFloorId = obj.floorId
  } catch (error) {
    throw renderSchemaError(
      'AGENT_RESOLVER_THREW',
      sceneId,
      sourceId,
      'floorId',
      'trusted spawn resolver 的 floorId 属性访问抛出异常。',
      `trusted spawn resolver floorId getter threw: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  if (typeof rawFloorId !== 'string' || !(rawFloorId as string).trim()) {
    throw renderSchemaError(
      'AGENT_SPAWN_INVALID',
      sceneId,
      sourceId,
      'floorId',
      'trusted spawn resolver 返回无效 floorId。',
      `trusted spawn resolver returned invalid floorId: ${JSON.stringify(rawFloorId)} for ${JSON.stringify(sourceId)}`,
    )
  }

  // elevation getter may throw
  let rawElevation: unknown
  try {
    rawElevation = obj.elevation
  } catch (error) {
    throw renderSchemaError(
      'AGENT_RESOLVER_THREW',
      sceneId,
      sourceId,
      'elevation',
      'trusted spawn resolver 的 elevation 属性访问抛出异常。',
      `trusted spawn resolver elevation getter threw: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  if (!Number.isSafeInteger(rawElevation)) {
    throw renderSchemaError(
      'AGENT_SPAWN_INVALID',
      sceneId,
      sourceId,
      'elevation',
      'trusted spawn resolver 返回无效 elevation。',
      `trusted spawn resolver returned invalid elevation: ${JSON.stringify(rawElevation)} for ${JSON.stringify(sourceId)}`,
    )
  }

  return { floorId: rawFloorId as string, elevation: rawElevation as number }
}

function safeChunk(
  resolver: TrustedChunkResolver,
  x: number,
  y: number,
  sourceId: string,
  sceneId: string,
): string {
  let chunkId: unknown
  try {
    chunkId = resolver(x, y)
  } catch (error) {
    throw renderSchemaError(
      'AGENT_RESOLVER_THREW',
      sceneId,
      sourceId,
      'chunkId',
      'trusted chunk resolver 抛出异常。',
      `trusted chunk resolver threw: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  // Reject thenable/promise (then getter may throw)
  let chunkIsThenable = false
  try {
    chunkIsThenable = chunkId !== null && typeof chunkId === 'object'
      && typeof (chunkId as { then?: unknown }).then === 'function'
  } catch (error) {
    // then getter threw
    throw renderSchemaError(
      'AGENT_RESOLVER_THREW',
      sceneId,
      sourceId,
      'chunkId',
      'trusted chunk resolver 的 then 属性访问抛出异常。',
      `trusted chunk resolver then getter threw: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (chunkIsThenable) {
    throw renderSchemaError(
      'AGENT_RESOLVER_TYPE_INVALID',
      sceneId,
      sourceId,
      'chunkId',
      'trusted chunk resolver 不得返回 Promise/thenable。',
      `trusted chunk resolver returned a thenable for ${JSON.stringify(sourceId)}`,
    )
  }

  if (typeof chunkId !== 'string' || !(chunkId as string).trim()) {
    throw renderSchemaError(
      'AGENT_CHUNK_INVALID',
      sceneId,
      sourceId,
      'chunkId',
      'trusted chunk resolver 返回无效 chunkId。',
      `trusted chunk resolver returned invalid chunkId: ${JSON.stringify(chunkId)} for ${JSON.stringify(sourceId)}`,
    )
  }

  return chunkId as string
}

export function createRuntimeAgentAdapter(
  trustedSpawn: TrustedSpawnResolver,
  trustedChunk: TrustedChunkResolver,
  sceneId: string = DEFAULT_SCENE_ID,
  options: RuntimeAgentAdapterOptions = {},
): RuntimeAgentAdapter {
  // registered agents: sourceEntityId → SceneObject (internal mutable, never exposed)
  const bySource = new Map<string, SceneObject>()
  // reverse: stableId → sourceEntityId
  const byStable = new Map<string, string>()

  const resolveStableId = options.hashFn ?? ((sourceId: string, _sceneId: string) => deriveAgentStableId(sourceId, sceneId))

  async function safeDeriveStableId(sourceId: string): Promise<string> {
    try {
      return await resolveStableId(sourceId, sceneId)
    } catch (error) {
      if (error instanceof Error && (error as { severity?: string }).severity === 'fatal') {
        throw error
      }
      throw renderSchemaError(
        'AGENT_HASH_FAILED',
        sceneId,
        sourceId,
        'stableId',
        'SHA-256 哈希计算失败。',
        `stableId derivation failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  // ── Concurrency serialization ──
  // All mutating operations are serialized through a promise chain.
  // Non-mutating operations (lookup, count, etc.) are not serialized.
  let queue: Promise<void> = Promise.resolve()

  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const prev = queue
    let resolveOuter: (value: T) => void
    let rejectOuter: (reason: unknown) => void
    const next = new Promise<T>((res, rej) => { resolveOuter = res; rejectOuter = rej })

    queue = (async () => {
      try {
        // Wait for previous operation to complete (including rejections)
        await prev
      } catch {
        // Previous operation rejected - we still proceed.
        // This prevents deadlocks from rejected operations.
      }
      try {
        const result = await fn()
        resolveOuter!(result)
      } catch (error) {
        rejectOuter!(error)
      }
    })().then(() => undefined, () => undefined)  // Never let queue promise reject

    return next
  }

  // ── Validation helpers ──

  function validateAgentId(raw: unknown): string {
    if (typeof raw !== 'string') {
      throw renderSchemaError(
        'AGENT_ID_INVALID',
        sceneId,
        String(raw ?? '(missing)'),
        'agentId',
        'agentId 必须是字符串。',
        `agentId must be a non-empty string, got ${typeof raw}: ${JSON.stringify(raw)}`,
      )
    }
    if (raw.length === 0) {
      throw renderSchemaError(
        'AGENT_ID_EMPTY',
        sceneId,
        '(empty)',
        'agentId',
        'agentId 不能为空字符串。',
        'agentId must be a non-empty string',
      )
    }
    if (raw.length > SOURCE_ENTITY_ID_MAX_LENGTH) {
      throw renderSchemaError(
        'AGENT_ID_INVALID',
        sceneId,
        '(too-long)',
        'agentId',
        `agentId 长度不得超过 ${SOURCE_ENTITY_ID_MAX_LENGTH} 个 UTF-16 code unit。`,
        `agentId exceeds ${SOURCE_ENTITY_ID_MAX_LENGTH} UTF-16 code units (received ${raw.length})`,
      )
    }
    if (!isValidSourceEntityId(raw)) {
      throw renderSchemaError(
        'AGENT_ID_WHITESPACE_ONLY',
        sceneId,
        '(whitespace)',
        'agentId',
        'agentId 不能只包含空白字符。',
        `agentId must not be whitespace-only, got: ${JSON.stringify(raw)}`,
      )
    }
    return raw
  }

  /**
   * Strict coordinate validation.
   * - undefined/absent → default 0 (create only)
   * - null, string, boolean, object, Symbol, NaN, ±Infinity → fatal
   * - finite number → OK
   */
  function validateCoordinateCreate(raw: unknown, axis: string): number {
    if (raw === undefined) return 0
    if (raw === null) {
      throw renderSchemaError(
        'AGENT_POSITION_INVALID',
        sceneId,
        '(create)',
        axis,
        `agent ${axis} 不能为 null。`,
        `agent ${axis} must be a finite number, got null`,
      )
    }
    if (typeof raw === 'boolean') {
      throw renderSchemaError(
        'AGENT_POSITION_INVALID',
        sceneId,
        '(create)',
        axis,
        `agent ${axis} 不能为 boolean。`,
        `agent ${axis} must be a finite number, got boolean ${raw}`,
      )
    }
    if (typeof raw === 'string') {
      throw renderSchemaError(
        'AGENT_POSITION_INVALID',
        sceneId,
        '(create)',
        axis,
        `agent ${axis} 不能为字符串。`,
        `agent ${axis} must be a finite number, got string ${JSON.stringify(raw)}`,
      )
    }
    if (typeof raw === 'object' || typeof raw === 'symbol' || typeof raw === 'function') {
      throw renderSchemaError(
        'AGENT_POSITION_INVALID',
        sceneId,
        '(create)',
        axis,
        `agent ${axis} 必须为数值。`,
        `agent ${axis} must be a finite number, got ${typeof raw}`,
      )
    }
    const n = Number(raw)
    if (!Number.isFinite(n)) {
      throw renderSchemaError(
        'AGENT_POSITION_INVALID',
        sceneId,
        '(create)',
        axis,
        `agent ${axis} 必须为有限数值。`,
        `agent ${axis} must be finite, got ${JSON.stringify(raw)}`,
      )
    }
    return n
  }

  /**
   * Update coordinate validation:
   * - undefined → preserve existing (returns undefined)
   * - null, string, boolean, object, Symbol, NaN, ±Infinity → fatal
   * - finite number → OK
   */
  function validateCoordinateUpdate(raw: unknown, axis: string, sourceId: string): number | undefined {
    if (raw === undefined) return undefined
    if (raw === null) {
      throw renderSchemaError(
        'AGENT_POSITION_INVALID',
        sceneId,
        sourceId,
        axis,
        `agent ${axis} 不能为 null。`,
        `agent ${axis} must be a finite number, got null`,
      )
    }
    if (typeof raw === 'boolean') {
      throw renderSchemaError(
        'AGENT_POSITION_INVALID',
        sceneId,
        sourceId,
        axis,
        `agent ${axis} 不能为 boolean。`,
        `agent ${axis} must be a finite number, got boolean ${raw}`,
      )
    }
    if (typeof raw === 'string') {
      throw renderSchemaError(
        'AGENT_POSITION_INVALID',
        sceneId,
        sourceId,
        axis,
        `agent ${axis} 不能为字符串。`,
        `agent ${axis} must be a finite number, got string ${JSON.stringify(raw)}`,
      )
    }
    if (typeof raw === 'object' || typeof raw === 'symbol' || typeof raw === 'function') {
      throw renderSchemaError(
        'AGENT_POSITION_INVALID',
        sceneId,
        sourceId,
        axis,
        `agent ${axis} 必须为数值。`,
        `agent ${axis} must be a finite number, got ${typeof raw}`,
      )
    }
    const n = Number(raw)
    if (!Number.isFinite(n)) {
      throw renderSchemaError(
        'AGENT_POSITION_INVALID',
        sceneId,
        sourceId,
        axis,
        `agent ${axis} 必须为有限数值。`,
        `agent ${axis} must be finite, got ${JSON.stringify(raw)}`,
      )
    }
    return n
  }

  function validateCreatePosition(
    xRaw: unknown,
    yRaw: unknown,
  ): Point {
    return {
      x: validateCoordinateCreate(xRaw, 'x'),
      y: validateCoordinateCreate(yRaw, 'y'),
    }
  }

  function validateUpdatePosition(
    xRaw: unknown,
    yRaw: unknown,
    sourceId: string,
    existing: SceneObject,
  ): Point | undefined {
    const x = validateCoordinateUpdate(xRaw, 'x', sourceId)
    const y = validateCoordinateUpdate(yRaw, 'y', sourceId)

    // If neither provided, no position change
    if (x === undefined && y === undefined) return undefined

    // Preserve existing coordinate for unprovided axis
    return {
      x: x !== undefined ? x : existing.sortAnchor.x,
      y: y !== undefined ? y : existing.sortAnchor.y,
    }
  }

  function buildSceneObjectInternal(
    stableId: string,
    sourceEntityId: string,
    chunkId: string,
    floorId: string,
    elevation: number,
    sortAnchor: Point,
  ): SceneObject {
    return {
      stableId,
      sourceEntityId,
      sceneId,
      chunkId,
      kind: AGENT_KIND,
      renderBand: AGENT_RENDER_BAND,
      floorId,
      elevation,
      sortMode: AGENT_SORT_MODE,
      sortAnchor: { x: sortAnchor.x, y: sortAnchor.y },
      tieBias: DEFAULT_TIE_BIAS,
    }
  }

  // ── Public API ──

  const adapter: RuntimeAgentAdapter = {
    create(agents: RuntimeAgentInput[]): Promise<SceneObject[]> {
      return enqueue(async () => {
        const results: SceneObject[] = []
        const stagingSourceIds = new Set<string>()
        const stagingStableIds = new Set<string>()

        // Phase 1: Validate all inputs and derive stableIds
        for (const agent of agents) {
          const sourceId = validateAgentId(agent.agentId)

          // Check for duplicate in batch
          if (stagingSourceIds.has(sourceId)) {
            throw renderSchemaError(
              'AGENT_ID_DUPLICATE',
              sceneId,
              sourceId,
              'agentId',
              '同批次中存在重复 agentId。',
              `duplicate agentId in batch: ${JSON.stringify(sourceId)}`,
            )
          }
          stagingSourceIds.add(sourceId)

          // Check for duplicate in existing registry
          if (bySource.has(sourceId)) {
            throw renderSchemaError(
              'AGENT_ID_DUPLICATE',
              sceneId,
              sourceId,
              'agentId',
              'agentId 已注册。',
              `agentId already registered: ${JSON.stringify(sourceId)}`,
            )
          }

          const position = validateCreatePosition(agent.x, agent.y)
          const stableId = await safeDeriveStableId(sourceId)

          // Check for stableId collision within batch
          if (stagingStableIds.has(stableId)) {
            throw renderSchemaError(
              'AGENT_STABLE_ID_COLLISION',
              sceneId,
              sourceId,
              'stableId',
              'stableId 冲突，不同 agentId 产生相同 stableId。',
              `stableId collision within batch: ${stableId} from ${JSON.stringify(sourceId)}`,
            )
          }
          stagingStableIds.add(stableId)

          // Check for stableId collision with existing registry
          if (byStable.has(stableId)) {
            const existingSourceId = byStable.get(stableId)!
            if (existingSourceId !== sourceId) {
              throw renderSchemaError(
                'AGENT_STABLE_ID_COLLISION',
                sceneId,
                sourceId,
                'stableId',
                'stableId 冲突，与已注册 agent 的 stableId 冲突。',
                `stableId collision: ${stableId} from ${JSON.stringify(sourceId)} collides with existing ${JSON.stringify(existingSourceId)}`,
              )
            }
          }

          const spawn = safeSpawn(trustedSpawn, sourceId, sceneId)
          const chunkId = safeChunk(trustedChunk, position.x, position.y, sourceId, sceneId)

          const sceneObject = buildSceneObjectInternal(
            stableId, sourceId, chunkId, spawn.floorId, spawn.elevation, position,
          )

          results.push(sceneObject)
        }

        // Phase 2: Atomic commit (internal mutable objects, not frozen)
        for (const sceneObject of results) {
          bySource.set(sceneObject.sourceEntityId!, sceneObject)
          byStable.set(sceneObject.stableId, sceneObject.sourceEntityId!)
        }

        // Return frozen clones
        return results.map(cloneSceneObject)
      })
    },

    update(updates: RuntimeAgentUpdate[]): Promise<SceneObject[]> {
      return enqueue(async () => {
        const results: SceneObject[] = []
        const stagingSourceIds = new Set<string>()

        // Phase 1: Validate all
        for (const update of updates) {
          const sourceId = validateAgentId(update.agentId)
          const existing = bySource.get(sourceId)
          if (!existing) {
            throw renderSchemaError(
              'AGENT_NOT_FOUND',
              sceneId,
              sourceId,
              'agentId',
              'agent 未找到。',
              `agent not found for update: ${JSON.stringify(sourceId)}`,
            )
          }

          if (stagingSourceIds.has(sourceId)) {
            throw renderSchemaError(
              'AGENT_ID_DUPLICATE',
              sceneId,
              sourceId,
              'agentId',
              '同批次中存在重复 agentId。',
              `duplicate agentId in update batch: ${JSON.stringify(sourceId)}`,
            )
          }
          stagingSourceIds.add(sourceId)

          const newPos = validateUpdatePosition(update.x, update.y, sourceId, existing)

          if (newPos) {
            const chunkId = safeChunk(trustedChunk, newPos.x, newPos.y, sourceId, sceneId)

            // Build updated SceneObject - only sortAnchor and chunkId can change
            const updated: SceneObject = {
              ...existing,
              chunkId,
              sortAnchor: { x: newPos.x, y: newPos.y },
            }
            results.push(updated)
          } else {
            // No position change - clone existing (new sortAnchor sub-object)
            results.push({ ...existing, sortAnchor: { x: existing.sortAnchor.x, y: existing.sortAnchor.y } })
          }
        }

        // Phase 2: Atomic commit
        for (const sceneObject of results) {
          bySource.set(sceneObject.sourceEntityId!, sceneObject)
          byStable.set(sceneObject.stableId, sceneObject.sourceEntityId!)
        }

        return results.map(cloneSceneObject)
      })
    },

    remove(agentIds: string[]): Promise<string[]> {
      return enqueue(async () => {
        // Phase 1: Validate all exist
        const toRemove: string[] = []
        const stagingSourceIds = new Set<string>()
        for (const raw of agentIds) {
          const sourceId = validateAgentId(raw)
          if (!bySource.has(sourceId)) {
            throw renderSchemaError(
              'AGENT_NOT_FOUND',
              sceneId,
              sourceId,
              'agentId',
              'agent 未找到。',
              `agent not found for remove: ${JSON.stringify(sourceId)}`,
            )
          }
          if (stagingSourceIds.has(sourceId)) {
            throw renderSchemaError(
              'AGENT_ID_DUPLICATE',
              sceneId,
              sourceId,
              'agentId',
              '同批次中存在重复 agentId。',
              `duplicate agentId in remove batch: ${JSON.stringify(sourceId)}`,
            )
          }
          stagingSourceIds.add(sourceId)
          toRemove.push(sourceId)
        }

        // Phase 2: Atomic commit
        for (const sourceId of toRemove) {
          const entry = bySource.get(sourceId)!
          bySource.delete(sourceId)
          byStable.delete(entry.stableId)
        }

        // Return frozen copy
        return Object.freeze([...toRemove]) as unknown as string[]
      })
    },

    lookup(sourceEntityId: string): SceneObject | undefined {
      const entry = bySource.get(sourceEntityId)
      return entry ? cloneSceneObject(entry) : undefined
    },

    reverseLookup(stableId: string): string | undefined {
      return byStable.get(stableId)
    },

    get agentCount(): number {
      return bySource.size
    },

    get sourceEntityIds(): string[] {
      return Object.freeze([...bySource.keys()]) as unknown as string[]
    },

    get sceneObjects(): SceneObject[] {
      return Object.freeze([...bySource.values()].map(cloneSceneObject)) as unknown as SceneObject[]
    },

    destroy(): void {
      bySource.clear()
      byStable.clear()
    },
  }

  return adapter
}

// ── Default trusted resolvers ──

export function defaultSpawnResolver(
  floorId: string = DEFAULT_FLOOR_ID,
  elevation: number = DEFAULT_ELEVATION,
): TrustedSpawnResolver {
  return (_sourceEntityId: string) => ({ floorId, elevation })
}

export function defaultChunkResolver(): TrustedChunkResolver {
  return (_x: number, _y: number) => 'default'
}
