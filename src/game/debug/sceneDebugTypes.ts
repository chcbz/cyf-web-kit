export type SceneDebugFatalError = Readonly<{
  code: string
  source: string
  retryable: boolean
}>

export type SceneDebugWarning = Readonly<{
  code: string
  severity: 'fatal' | 'degraded' | 'warning' | 'info'
  source: string
  retryable: boolean
}>

export type SceneDebugAgent = Readonly<{
  agentId: string
  personaCode: string
  behavior: string
  phase: string
  regionId: string
  targetRegionId: string
  spriteLoaded: boolean
  placeholder: boolean
}>

export type SceneDebugSnapshot = Readonly<{
  ready: boolean
  degraded: boolean
  fatalError: SceneDebugFatalError | null
  camera: Readonly<{
    zoom: number
    offsetX: number
    offsetY: number
    viewport: Readonly<{ width: number, height: number }>
    preset: string
  }>
  input: Readonly<{
    interactionLocked: boolean
    activeGesture: string | null
  }>
  map: Readonly<{
    tmxLoaded: boolean
    movementReady: boolean
    sceneId: string
    movementSchemaVersion: string
    navGraphVersion: string
    hotspotCount: number
  }>
  sprites: Readonly<{
    manifestReady: boolean
    manifestVersion: string
    requiredMissingCount: number
    optionalMissingCount: number
    placeholderCount: number
  }>
  backend: Readonly<{
    snapshotReady: boolean
    sceneVersion: number | string
    sseConnected: boolean
    lastEventAt: number | string
    resyncCount: number
  }>
  simulation: Readonly<{
    ready: boolean
    visibleCount: number
    movingCount: number
    blockedCount: number
    queuedCommandCount: number
    replanningCount: number
  }>
  agents: readonly SceneDebugAgent[]
  warnings: readonly SceneDebugWarning[]
}>

export type SceneDebugInputs = Readonly<{
  ready?: unknown
  degraded?: unknown
  fatalError?: unknown
  camera?: unknown
  input?: unknown
  map?: unknown
  sprites?: unknown
  backend?: unknown
  simulation?: unknown
  agents?: unknown
  warnings?: unknown
}>
