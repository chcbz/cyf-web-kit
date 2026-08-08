// ── E3 Runtime Agent Adapter ──
// Converts /agent/map runtime agent input into SceneObjects.
// Frozen contract per §6.2 of juyiting-occlusion-system-design.md.

import { type SceneObject, type Point, type RenderBand, type SortMode, renderSchemaError } from './schema.js'

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

// ── SHA-256 via Web Crypto (available in Node 18+ and browsers) ──

async function sha256Utf8(input: string): Promise<Uint8Array> {
  // Use TextEncoder for UTF-8 encoding (preserves all Unicode byte differences)
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return new Uint8Array(hashBuffer)
}

// ── Agent stableId derivation ──

async function deriveAgentStableId(sourceEntityId: string): Promise<string> {
  const hash = await sha256Utf8(sourceEntityId)
  const base32Hash = base32EncodeLower(hash)
  return `${AGENT_STABLE_ID_PREFIX}${base32Hash}${AGENT_STABLE_ID_SUFFIX}`
}

// ── Input types ──

export interface RuntimeAgentInput {
  /** API-provided agent ID. Must be a non-empty string. Preserved verbatim. */
  agentId: unknown
  /** World position. Defaults to (0, 0) if absent. Must be finite numbers. */
  x?: number
  y?: number
}

export interface RuntimeAgentUpdate {
  /** Must match a registered agent's sourceEntityId */
  agentId: unknown
  /** New world position. Must be finite numbers if provided. */
  x?: number
  y?: number
}

export interface RuntimeAgentSnapshot {
  /** Must match a registered agent's sourceEntityId */
  agentId: unknown
  /** World position. Must be finite numbers if provided. */
  x?: number
  y?: number
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

// ── Adapter state ──

export interface RuntimeAgentAdapter {
  /** Create agents from a batch of inputs. Validates all, then applies atomically. */
  create(agents: RuntimeAgentInput[]): Promise<SceneObject[]>
  /** Update agent positions (sortAnchor, chunkId only). Validates all, then applies atomically. */
  update(updates: RuntimeAgentUpdate[]): Promise<SceneObject[]>
  /** Remove agents by sourceEntityId. Validates all, then applies atomically. */
  remove(agentIds: string[]): Promise<string[]>
  /** Look up a SceneObject by sourceEntityId. Returns undefined if not found. */
  lookup(sourceEntityId: string): SceneObject | undefined
  /** Look up sourceEntityId by stableId. Returns undefined if not found. */
  reverseLookup(stableId: string): string | undefined
  /** Current count of registered agents. */
  get agentCount(): number
  /** All registered sourceEntityIds (iteration order is insertion order). */
  get sourceEntityIds(): string[]
  /** All registered SceneObjects. */
  get sceneObjects(): SceneObject[]
  /** Destroy the adapter and clear all state. */
  destroy(): void
}

// ── Implementation ──

interface AgentEntry {
  sceneObject: SceneObject
  sourceEntityId: string
}

export function createRuntimeAgentAdapter(
  trustedSpawn: TrustedSpawnResolver,
  trustedChunk: TrustedChunkResolver,
  sceneId: string = DEFAULT_SCENE_ID,
): RuntimeAgentAdapter {
  // registered agents: sourceEntityId → SceneObject
  const bySource = new Map<string, SceneObject>()
  // reverse: stableId → sourceEntityId
  const byStable = new Map<string, string>()

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
    if (raw.trim().length === 0) {
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

  function validatePosition(xRaw: unknown, yRaw: unknown): Point {
    const x = Number(xRaw ?? 0)
    const y = Number(yRaw ?? 0)
    if (!Number.isFinite(x)) {
      throw renderSchemaError(
        'AGENT_POSITION_INVALID',
        sceneId,
        '(position)',
        'x',
        'agent 坐标 x 必须为有限数值。',
        `agent x must be finite, got ${JSON.stringify(xRaw)}`,
      )
    }
    if (!Number.isFinite(y)) {
      throw renderSchemaError(
        'AGENT_POSITION_INVALID',
        sceneId,
        '(position)',
        'y',
        'agent 坐标 y 必须为有限数值。',
        `agent y must be finite, got ${JSON.stringify(yRaw)}`,
      )
    }
    return { x, y }
  }

  function validateUpdatePosition(
    xRaw: unknown,
    yRaw: unknown,
    sourceId: string,
  ): Point | undefined {
    // If both are explicitly undefined, no position update
    if (xRaw === undefined && yRaw === undefined) return undefined
    const x = Number(xRaw ?? 0)
    const y = Number(yRaw ?? 0)
    if (!Number.isFinite(x)) {
      throw renderSchemaError(
        'AGENT_POSITION_INVALID',
        sceneId,
        sourceId,
        'x',
        'agent 坐标 x 必须为有限数值。',
        `agent x must be finite, got ${JSON.stringify(xRaw)}`,
      )
    }
    if (!Number.isFinite(y)) {
      throw renderSchemaError(
        'AGENT_POSITION_INVALID',
        sceneId,
        sourceId,
        'y',
        'agent 坐标 y 必须为有限数值。',
        `agent y must be finite, got ${JSON.stringify(yRaw)}`,
      )
    }
    return { x, y }
  }

  function buildSceneObject(
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
    async create(agents: RuntimeAgentInput[]): Promise<SceneObject[]> {
      const results: SceneObject[] = []
      const stagingStableIds = new Set<string>()

      // Phase 1: Validate all inputs and derive stableIds
      for (const agent of agents) {
        const sourceId = validateAgentId(agent.agentId)

        // Check for duplicate in batch
        if (results.some(r => r.sourceEntityId === sourceId)) {
          throw renderSchemaError(
            'AGENT_ID_DUPLICATE',
            sceneId,
            sourceId,
            'agentId',
            '同批次中存在重复 agentId。',
            `duplicate agentId in batch: ${JSON.stringify(sourceId)}`,
          )
        }

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

        const position = validatePosition(agent.x, agent.y)
        const stableId = await deriveAgentStableId(sourceId)

        // Check for stableId collision within batch
        if (stagingStableIds.has(stableId)) {
          throw renderSchemaError(
            'AGENT_STABLE_ID_COLLISION',
            sceneId,
            sourceId,
            'stableId',
            'stableId 冲突，不同 agentId 产生相同 stableId。',
            `stableId collision: ${stableId} from ${JSON.stringify(sourceId)}`,
          )
        }

        // Check for stableId collision with existing registry
        if (byStable.has(stableId)) {
          const existingSourceId = byStable.get(stableId)!
          // Only fatal if it's a different sourceEntityId
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

        const spawn = trustedSpawn(sourceId)
        if (!spawn || typeof spawn !== 'object') {
          throw renderSchemaError(
            'AGENT_SPAWN_INVALID',
            sceneId,
            sourceId,
            'spawn',
            'trusted spawn resolver 返回无效值。',
            `trusted spawn resolver returned non-object for ${JSON.stringify(sourceId)}`,
          )
        }
        if (typeof spawn.floorId !== 'string' || !spawn.floorId.trim()) {
          throw renderSchemaError(
            'AGENT_SPAWN_INVALID',
            sceneId,
            sourceId,
            'floorId',
            'trusted spawn resolver 返回无效 floorId。',
            `trusted spawn resolver returned invalid floorId for ${JSON.stringify(sourceId)}`,
          )
        }
        if (!Number.isSafeInteger(spawn.elevation)) {
          throw renderSchemaError(
            'AGENT_SPAWN_INVALID',
            sceneId,
            sourceId,
            'elevation',
            'trusted spawn resolver 返回无效 elevation。',
            `trusted spawn resolver returned invalid elevation for ${JSON.stringify(sourceId)}`,
          )
        }

        const chunkId = trustedChunk(position.x, position.y)
        if (!chunkId || typeof chunkId !== 'string' || !chunkId.trim()) {
          throw renderSchemaError(
            'AGENT_CHUNK_INVALID',
            sceneId,
            sourceId,
            'chunkId',
            'trusted chunk resolver 返回无效 chunkId。',
            `trusted chunk resolver returned invalid chunkId for ${JSON.stringify(sourceId)} at (${position.x}, ${position.y})`,
          )
        }

        const sceneObject = buildSceneObject(
          stableId,
          sourceId,
          chunkId,
          spawn.floorId,
          spawn.elevation,
          position,
        )

        stagingStableIds.add(stableId)
        results.push(sceneObject)
      }

      // Phase 2: Atomic commit
      for (const sceneObject of results) {
        bySource.set(sceneObject.sourceEntityId!, sceneObject)
        byStable.set(sceneObject.stableId, sceneObject.sourceEntityId!)
      }

      return results
    },

    async update(updates: RuntimeAgentUpdate[]): Promise<SceneObject[]> {
      const results: SceneObject[] = []

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

        // Duplicate update in same batch
        if (results.some(r => r.sourceEntityId === sourceId)) {
          throw renderSchemaError(
            'AGENT_ID_DUPLICATE',
            sceneId,
            sourceId,
            'agentId',
            '同批次中存在重复 agentId。',
            `duplicate agentId in update batch: ${JSON.stringify(sourceId)}`,
          )
        }

        const newPos = validateUpdatePosition(update.x, update.y, sourceId)

        if (newPos) {
          const chunkId = trustedChunk(newPos.x, newPos.y)
          if (!chunkId || typeof chunkId !== 'string' || !chunkId.trim()) {
            throw renderSchemaError(
              'AGENT_CHUNK_INVALID',
              sceneId,
              sourceId,
              'chunkId',
              'trusted chunk resolver 返回无效 chunkId。',
              `trusted chunk resolver returned invalid chunkId for ${JSON.stringify(sourceId)} at (${newPos.x}, ${newPos.y})`,
            )
          }

          // Build updated SceneObject - only sortAnchor and chunkId can change
          // All identity fields preserved from existing
          const updated: SceneObject = {
            ...existing,
            chunkId,
            sortAnchor: { x: newPos.x, y: newPos.y },
          }
          results.push(updated)
        } else {
          // No position change, return existing
          results.push({ ...existing })
        }
      }

      // Phase 2: Atomic commit
      for (const sceneObject of results) {
        bySource.set(sceneObject.sourceEntityId!, sceneObject)
        byStable.set(sceneObject.stableId, sceneObject.sourceEntityId!)
      }

      return results
    },

    async remove(agentIds: string[]): Promise<string[]> {
      // Phase 1: Validate all exist
      const toRemove: string[] = []
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
        if (toRemove.includes(sourceId)) {
          throw renderSchemaError(
            'AGENT_ID_DUPLICATE',
            sceneId,
            sourceId,
            'agentId',
            '同批次中存在重复 agentId。',
            `duplicate agentId in remove batch: ${JSON.stringify(sourceId)}`,
          )
        }
        toRemove.push(sourceId)
      }

      // Phase 2: Atomic commit
      for (const sourceId of toRemove) {
        const entry = bySource.get(sourceId)!
        bySource.delete(sourceId)
        byStable.delete(entry.stableId)
      }

      return toRemove
    },

    lookup(sourceEntityId: string): SceneObject | undefined {
      return bySource.get(sourceEntityId)
    },

    reverseLookup(stableId: string): string | undefined {
      return byStable.get(stableId)
    },

    get agentCount(): number {
      return bySource.size
    },

    get sourceEntityIds(): string[] {
      return [...bySource.keys()]
    },

    get sceneObjects(): SceneObject[] {
      return [...bySource.values()]
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
