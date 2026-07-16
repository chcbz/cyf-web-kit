import type { MapPoint, MapRuntimeData } from '../map/movementSchema.js'

export type AdaptedMovementCommand = {
  commandId: string
  agentId: string
  personaCode: string
  source: 'backend'
  type: 'MOVE_TO_REGION' | 'RETURN_HOME'
  targetRegionId: string
  priority: number
  stateVersion: number
  startedAt: string
  expectedArrivalAt?: string
  expiresAt?: string
}

export type BackendAgentSceneState = {
  agentId: string
  personaCode: string
  behavior: string
  targetRegionId: string
  stateVersion: number
  startedAt: string
  expectedArrivalAt?: string
  expiresAt?: string
  phase?: string
}

export type AdaptedBackendState = {
  command?: AdaptedMovementCommand
  blockedReason?: 'unknown-region' | 'no-path' | 'expired'
}

export type RecoveredMovementProgress = {
  progress: number
  point?: MapPoint
  distance: number
  totalLength: number
}

export function normalizedProgress(
  startedAt: string,
  expectedArrivalAt: string | undefined,
  nowMs: number,
): number {
  if (!expectedArrivalAt || !Number.isFinite(nowMs)) return 0
  const start = Date.parse(startedAt)
  const end = Date.parse(expectedArrivalAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0
  if (end === start) return nowMs <= start ? 0 : 1
  return clamp((nowMs - start) / (end - start), 0, 1)
}

export function recoverMovementProgress(
  state: Pick<BackendAgentSceneState, 'startedAt' | 'expectedArrivalAt'>,
  path: readonly MapPoint[],
  nowMs: number,
): RecoveredMovementProgress {
  const progress = normalizedProgress(state.startedAt, state.expectedArrivalAt, nowMs)
  const lengths = cumulativeLengths(path)
  const totalLength = lengths.at(-1) ?? 0
  const distance = totalLength * progress
  return {
    progress,
    point: pointAtDistance(path, lengths, distance),
    distance,
    totalLength,
  }
}

export function adaptBackendState(
  state: BackendAgentSceneState,
  map: MapRuntimeData,
  nowMs: number,
): AdaptedBackendState {
  const expired = isExpired(state.expiresAt, nowMs)
  const returnHome = expired || isBusinessComplete(state)
  const home = returnHome
    ? map.slots.find(slot => slot.kind === 'home' && slot.personaCode === state.personaCode)
    : undefined
  const targetRegionId = returnHome ? home?.regionId : state.targetRegionId
  if (!targetRegionId || !map.regions.some(region => region.regionId === targetRegionId)) {
    return { blockedReason: 'unknown-region' }
  }

  return {
    command: compact({
      commandId: `${state.agentId}:${state.stateVersion}:${returnHome ? 'home' : 'target'}`,
      agentId: state.agentId,
      personaCode: state.personaCode,
      source: 'backend' as const,
      type: returnHome ? 'RETURN_HOME' as const : 'MOVE_TO_REGION' as const,
      targetRegionId,
      priority: 10,
      stateVersion: state.stateVersion,
      startedAt: state.startedAt,
      expectedArrivalAt: state.expectedArrivalAt,
      expiresAt: state.expiresAt,
    }),
  }
}

function cumulativeLengths(path: readonly MapPoint[]): number[] {
  if (path.length === 0) return []
  const lengths = [0]
  for (let index = 1; index < path.length; index += 1) {
    lengths.push(lengths[index - 1] + distanceBetween(path[index - 1], path[index]))
  }
  return lengths
}

function pointAtDistance(
  path: readonly MapPoint[],
  cumulative: readonly number[],
  targetDistance: number,
): MapPoint | undefined {
  if (path.length === 0) return undefined
  if (path.length === 1 || targetDistance <= 0) return copyPoint(path[0])
  const totalLength = cumulative.at(-1) ?? 0
  if (totalLength <= 0 || targetDistance >= totalLength) return copyPoint(path.at(-1) as MapPoint)

  for (let index = 1; index < path.length; index += 1) {
    if (targetDistance > cumulative[index]) continue
    const segmentStart = cumulative[index - 1]
    const segmentLength = cumulative[index] - segmentStart
    if (segmentLength <= 0) continue
    const ratio = (targetDistance - segmentStart) / segmentLength
    return {
      x: path[index - 1].x + (path[index].x - path[index - 1].x) * ratio,
      y: path[index - 1].y + (path[index].y - path[index - 1].y) * ratio,
    }
  }
  return copyPoint(path.at(-1) as MapPoint)
}

function isExpired(expiresAt: string | undefined, nowMs: number): boolean {
  if (!expiresAt || !Number.isFinite(nowMs)) return false
  const expiry = Date.parse(expiresAt)
  return Number.isFinite(expiry) && expiry <= nowMs
}

function isBusinessComplete(state: BackendAgentSceneState): boolean {
  const behavior = state.behavior.trim().toLowerCase()
  const phase = state.phase?.trim().toLowerCase()
  return ['complete', 'completed', 'done', 'expired'].includes(behavior)
    || phase === 'completed'
    || phase === 'expired'
}

function distanceBetween(left: MapPoint, right: MapPoint): number {
  return Math.hypot(right.x - left.x, right.y - left.y)
}

function copyPoint(point: MapPoint): MapPoint {
  return { x: point.x, y: point.y }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T
}
