import type {
  SceneDebugAgent,
  SceneDebugFatalError,
  SceneDebugInputs,
  SceneDebugSnapshot,
  SceneDebugWarning,
} from './sceneDebugTypes.js'

type UnknownRecord = Record<string, unknown>

const FORBIDDEN_TEXT = /token|api.?key|credential|password|secret|chat|raw|stack|model.?response/i
const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const JAVA_LONG_MAX = 9_223_372_036_854_775_807n
const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER)

export function aggregateSceneDebug(inputs: SceneDebugInputs = {}): SceneDebugSnapshot {
  const camera = record(inputs.camera)
  const transform = record(camera.transform)
  const viewport = record(camera.viewport)
  const input = record(inputs.input)
  const map = record(inputs.map)
  const sprites = record(inputs.sprites)
  const backend = record(inputs.backend)
  const simulation = record(inputs.simulation)
  const agents = agentList(inputs.agents)
  const movingCount = agents.filter(agent => agent.phase === 'moving').length
  const blockedCount = agents.filter(agent => agent.phase === 'blocked').length

  return deepFreeze({
    ready: boolean(inputs.ready),
    degraded: boolean(inputs.degraded),
    fatalError: fatalError(inputs.fatalError),
    camera: {
      zoom: finite(transform.zoom ?? camera.zoom, 1),
      offsetX: finite(transform.offsetX ?? camera.offsetX, 0),
      offsetY: finite(transform.offsetY ?? camera.offsetY, 0),
      viewport: {
        width: nonnegative(viewport.width, 0),
        height: nonnegative(viewport.height, 0),
      },
      preset: safeCode(camera.preset ?? camera.presetId ?? camera.presetKey),
    },
    input: {
      interactionLocked: boolean(input.interactionLocked),
      activeGesture: nullableCode(input.activeGesture),
    },
    map: {
      tmxLoaded: boolean(map.tmxLoaded),
      movementReady: boolean(map.movementReady),
      sceneId: safeCode(map.sceneId),
      movementSchemaVersion: safeCode(map.movementSchemaVersion),
      navGraphVersion: safeCode(map.navGraphVersion),
      hotspotCount: count(map.hotspotCount, array(map.hotspots).length),
    },
    sprites: {
      manifestReady: boolean(sprites.manifestReady),
      manifestVersion: safeCode(sprites.manifestVersion),
      requiredMissingCount: count(sprites.requiredMissingCount),
      optionalMissingCount: count(sprites.optionalMissingCount),
      placeholderCount: count(sprites.placeholderCount),
    },
    backend: {
      snapshotReady: boolean(backend.snapshotReady),
      sceneVersion: version(backend.sceneVersion),
      sseConnected: boolean(backend.sseConnected),
      lastEventAt: safeTimestamp(backend.lastEventAt),
      resyncCount: count(backend.resyncCount),
    },
    simulation: {
      ready: boolean(simulation.ready),
      visibleCount: count(simulation.visibleCount, agents.length),
      movingCount: count(simulation.movingCount, movingCount),
      blockedCount: count(simulation.blockedCount, blockedCount),
      queuedCommandCount: count(simulation.queuedCommandCount),
      replanningCount: count(simulation.replanningCount),
    },
    agents,
    warnings: warningList(inputs.warnings),
  })
}

function fatalError(value: unknown): SceneDebugFatalError | null {
  if (value === null || value === undefined) return null
  const source = record(value)
  return {
    code: safeCode(source.code, 'SCENE_ERROR'),
    source: safeCode(source.source, 'scene'),
    retryable: boolean(source.retryable),
  }
}

function warningList(value: unknown): SceneDebugWarning[] {
  return array(value).flatMap(item => {
    const source = record(item)
    const code = safeCode(source.code)
    if (!code) return []
    const rawSeverity = safeCode(source.severity).toLowerCase()
    const severity = isSeverity(rawSeverity) ? rawSeverity : 'warning'
    return [{
      code,
      severity,
      source: safeCode(source.source, 'scene'),
      retryable: boolean(source.retryable),
    }]
  })
}

function agentList(value: unknown): SceneDebugAgent[] {
  return array(value).flatMap(item => {
    const source = record(item)
    const agentId = safeCode(source.agentId)
    const personaCode = safeCode(source.personaCode)
    if (!agentId || !personaCode) return []
    return [{
      agentId,
      personaCode,
      behavior: safeCode(source.behavior),
      phase: safeCode(source.phase),
      regionId: safeCode(source.regionId),
      targetRegionId: safeCode(source.targetRegionId),
      spriteLoaded: boolean(source.spriteLoaded),
      placeholder: boolean(source.placeholder),
    }]
  }).sort((left, right) => compareCodeUnits(left.agentId, right.agentId))
}

function safeCode(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim()
  if (!CODE_PATTERN.test(normalized) || FORBIDDEN_TEXT.test(normalized)) return fallback
  return normalized
}

function nullableCode(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  return safeCode(value) || null
}

function safeTimestamp(value: unknown): number | string {
  if (Number.isSafeInteger(value) && Number(value) >= 0) return Number(value)
  if (typeof value !== 'string' || FORBIDDEN_TEXT.test(value)) return ''
  const normalized = value.trim()
  return normalized && Number.isFinite(Date.parse(normalized)) ? normalized : ''
}

function version(value: unknown): number | string {
  if (Number.isSafeInteger(value) && Number(value) >= 0) return Number(value)
  if (typeof value === 'bigint' && value >= 0n && value <= JAVA_LONG_MAX) {
    return value <= MAX_SAFE_INTEGER ? Number(value) : value.toString()
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    try {
      const parsed = BigInt(value)
      if (parsed <= JAVA_LONG_MAX) {
        return parsed <= MAX_SAFE_INTEGER ? Number(parsed) : parsed.toString()
      }
    } catch { /* invalid versions fail closed */ }
  }
  return 0
}

function count(value: unknown, fallback = 0): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fallback
}

function nonnegative(value: unknown, fallback: number): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback
}

function finite(value: unknown, fallback: number): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function boolean(value: unknown): boolean {
  return value === true
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : {}
}

function isSeverity(value: string): value is SceneDebugWarning['severity'] {
  return ['fatal', 'degraded', 'warning', 'info'].includes(value)
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const nested of Object.values(value as UnknownRecord)) deepFreeze(nested)
  }
  return value
}
