import type { MapPoint, MapRuntimeData, Slot } from '../map/movementSchema.js'
import type { PersonaSpriteManifest } from '../sprites/personaSpriteManifest.js'
import { recoverMovementProgress } from './backendSceneStateAdapter.js'
import { createGraphPathfinder, type PathFinder } from './graphPathfinder.js'
import {
  createMovementCommandQueue,
  type MovementCommand,
  type MovementCommandPushResult,
} from './movementCommandQueue.js'
import { createSlotAllocator, type SlotAllocator } from './slotAllocator.js'

export type AgentSnapshot = {
  agentId: string
  personaCode: string
  x: number
  y: number
  facing: 'left' | 'right'
  animation: 'idle' | 'walk'
  behavior: string
  phase: 'idle' | 'moving' | 'arrived' | 'blocked'
  regionId: string
  targetRegionId?: string
  stateVersion: number
}

export type SimulationPhaseEvent = {
  reportId: string
  agentId: string
  stateVersion: number
  phase: 'arrived' | 'blocked'
  regionId: string
  occurredAt: string
}

export type MovementEngine = {
  enqueue(command: MovementCommand): MovementCommandPushResult
  cancel(agentId: string, stateVersion?: number): boolean
  update(deltaMs: number): void
  snapshots(): AgentSnapshot[]
  drainPhaseEvents(): SimulationPhaseEvent[]
}

export type MovementEngineOptions = {
  now?: () => number
  arrivalThreshold?: number
}

interface ActiveMovement {
  command: MovementCommand
  path: MapPoint[]
  segmentIndex: number
  speed: number
  targetSlot: Slot
}

interface AgentRuntime {
  snapshot: AgentSnapshot
  active?: ActiveMovement
  reservedSlotId?: string
}

const EPSILON = 1e-9
const DEFAULT_ARRIVAL_THRESHOLD = 8

export function createMovementEngine(
  map: MapRuntimeData,
  manifest: PersonaSpriteManifest,
  options: MovementEngineOptions = {},
): MovementEngine {
  const queue = createMovementCommandQueue()
  const pathfinder = createGraphPathfinder(map)
  const slots = createSlotAllocator(map)
  const agents = new Map<string, AgentRuntime>()
  const phaseEvents: SimulationPhaseEvent[] = []
  const cancellationWatermarks = new Map<string, number>()
  const now = options.now ?? Date.now
  const arrivalThreshold = options.arrivalThreshold ?? DEFAULT_ARRIVAL_THRESHOLD
  requireArrivalThreshold(arrivalThreshold)

  return {
    enqueue(source) {
      const cancellationWatermark = source
        ? cancellationWatermarks.get(source.agentId)
        : undefined
      if (source && cancellationWatermark !== undefined
        && source.stateVersion <= cancellationWatermark) {
        return { accepted: false, reason: 'stale-state-version' }
      }
      const existingAgent = agents.get(source?.agentId)
      const replacedActive = existingAgent?.active?.command.commandId
      const result = queue.push(source)
      if (!result.accepted) return result
      const command = queue.shift()
      if (!command) throw new Error('Accepted movement command was not available for simulation')
      if (existingAgent?.active && replacedActive !== command.commandId
        && distanceToTarget(existingAgent) <= arrivalThreshold) {
        arrive(existingAgent, phaseEvents, now)
      }
      activate(command, map, manifest, pathfinder, slots, agents, phaseEvents, now)
      return replacedActive && replacedActive !== command.commandId
        ? { accepted: true, replacedCommandId: replacedActive }
        : result
    },

    cancel(agentId, stateVersion) {
      if (typeof agentId !== 'string' || agentId.trim().length === 0) return false
      if (stateVersion !== undefined
        && (!Number.isSafeInteger(stateVersion) || stateVersion < 0)) {
        throw new TypeError('Movement cancellation state version must be a nonnegative safe integer')
      }
      queue.clearPending(agentId)
      const agent = agents.get(agentId)
      if (!agent) return false
      releaseReservation(agent, slots)
      agent.active = undefined
      agent.snapshot.animation = 'idle'
      agent.snapshot.phase = 'idle'
      agent.snapshot.behavior = 'idle'
      if (stateVersion !== undefined) {
        agent.snapshot.stateVersion = Math.max(agent.snapshot.stateVersion, stateVersion)
        cancellationWatermarks.set(agentId, Math.max(
          cancellationWatermarks.get(agentId) ?? 0,
          stateVersion,
        ))
      }
      delete agent.snapshot.targetRegionId
      for (let index = phaseEvents.length - 1; index >= 0; index -= 1) {
        const event = phaseEvents[index]
        if (event?.agentId === agentId
          && (stateVersion === undefined || event.stateVersion <= stateVersion)) {
          phaseEvents.splice(index, 1)
        }
      }
      return true
    },

    update(deltaMs) {
      requireDelta(deltaMs)
      for (const agent of agents.values()) {
        if (agent.active) advance(agent, deltaMs, phaseEvents, now)
      }
    },

    snapshots() {
      return [...agents.values()]
        .map(agent => copySnapshot(agent.snapshot))
        .sort((left, right) => left.agentId.localeCompare(right.agentId))
    },

    drainPhaseEvents() {
      return phaseEvents.splice(0).map(copyPhaseEvent)
    },
  }
}

function activate(
  command: MovementCommand,
  map: MapRuntimeData,
  manifest: PersonaSpriteManifest,
  pathfinder: PathFinder,
  slots: SlotAllocator,
  agents: Map<string, AgentRuntime>,
  phaseEvents: SimulationPhaseEvent[],
  now: () => number,
): void {
  const definition = manifest.personas[command.personaCode]
  const home = slots.homeFor(command.personaCode)
  let agent = agents.get(command.agentId)
  if (!agent && definition && home) {
    agent = {
      snapshot: {
        agentId: command.agentId,
        personaCode: command.personaCode,
        x: home.point.x,
        y: home.point.y,
        facing: 'right',
        animation: 'idle',
        behavior: behaviorFor(command),
        phase: 'idle',
        regionId: home.regionId,
        stateVersion: command.stateVersion,
      },
    }
    agents.set(command.agentId, agent)
  }

  if (!agent) {
    emitPhase(phaseEvents, command, 'blocked', command.targetRegionId, now)
    return
  }
  if (!definition || !home || agent.snapshot.personaCode !== command.personaCode) {
    agent.active = undefined
    releaseReservation(agent, slots)
    block(agent, command, phaseEvents, now)
    return
  }

  agent.active = undefined
  agent.snapshot.animation = 'idle'
  agent.snapshot.behavior = behaviorFor(command)
  agent.snapshot.stateVersion = command.stateVersion
  agent.snapshot.targetRegionId = command.targetRegionId

  if (!map.regions.some(region => region.regionId === command.targetRegionId)) {
    releaseReservation(agent, slots)
    block(agent, command, phaseEvents, now)
    return
  }

  const targetSlot = slots.reserve(command.targetRegionId, command)
  if (!targetSlot) {
    releaseReservation(agent, slots)
    block(agent, command, phaseEvents, now)
    return
  }
  agent.reservedSlotId = targetSlot.slotId

  const path = pathfinder.find(
    { x: agent.snapshot.x, y: agent.snapshot.y },
    targetSlot.point,
    { colliderWidth: definition.collider.width },
  )
  if (path.status !== 'found') {
    releaseReservation(agent, slots)
    block(agent, command, phaseEvents, now)
    return
  }

  let points = path.points.map(copyPoint)
  if (command.source === 'backend') {
    const recovery = recoverMovementProgress(command, points, now())
    if (recovery.point) points = remainingPath(points, recovery.point, recovery.distance)
  }
  const startPoint = points[0]
  if (startPoint) {
    agent.snapshot.x = startPoint.x
    agent.snapshot.y = startPoint.y
  }
  agent.snapshot.phase = 'moving'
  agent.snapshot.animation = 'walk'
  agent.snapshot.facing = initialFacing(points, agent.snapshot.facing)
  agent.active = {
    command: { ...command },
    path: points,
    segmentIndex: 1,
    speed: definition.baseSpeed,
    targetSlot,
  }
  if (points.length < 2 || pathLength(points) <= EPSILON) arrive(agent, phaseEvents, now)
}

function advance(
  agent: AgentRuntime,
  deltaMs: number,
  phaseEvents: SimulationPhaseEvent[],
  now: () => number,
): void {
  const active = agent.active
  if (!active || deltaMs === 0) return
  let remaining = active.speed * deltaMs / 1_000

  while (remaining > EPSILON && active.segmentIndex < active.path.length) {
    const target = active.path[active.segmentIndex]
    const dx = target.x - agent.snapshot.x
    const dy = target.y - agent.snapshot.y
    const segmentDistance = Math.hypot(dx, dy)
    if (segmentDistance <= EPSILON) {
      active.segmentIndex += 1
      continue
    }
    if (Math.abs(dx) > EPSILON) agent.snapshot.facing = dx > 0 ? 'right' : 'left'
    if (remaining >= segmentDistance - EPSILON) {
      agent.snapshot.x = target.x
      agent.snapshot.y = target.y
      active.segmentIndex += 1
      remaining -= segmentDistance
    } else {
      const ratio = remaining / segmentDistance
      agent.snapshot.x += dx * ratio
      agent.snapshot.y += dy * ratio
      remaining = 0
    }
  }

  if (active.segmentIndex >= active.path.length) arrive(agent, phaseEvents, now)
}

function arrive(
  agent: AgentRuntime,
  phaseEvents: SimulationPhaseEvent[],
  now: () => number,
): void {
  const active = agent.active
  if (!active) return
  agent.snapshot.x = active.targetSlot.point.x
  agent.snapshot.y = active.targetSlot.point.y
  agent.snapshot.animation = 'idle'
  agent.snapshot.phase = 'arrived'
  agent.snapshot.regionId = active.targetSlot.regionId
  delete agent.snapshot.targetRegionId
  agent.active = undefined
  emitPhase(phaseEvents, active.command, 'arrived', active.targetSlot.regionId, now)
}

function block(
  agent: AgentRuntime,
  command: MovementCommand,
  phaseEvents: SimulationPhaseEvent[],
  now: () => number,
): void {
  agent.active = undefined
  agent.snapshot.animation = 'idle'
  agent.snapshot.phase = 'blocked'
  agent.snapshot.behavior = behaviorFor(command)
  agent.snapshot.stateVersion = command.stateVersion
  agent.snapshot.targetRegionId = command.targetRegionId
  emitPhase(phaseEvents, command, 'blocked', command.targetRegionId, now)
}

function releaseReservation(agent: AgentRuntime, slots: SlotAllocator): void {
  if (!agent.reservedSlotId) return
  slots.release(agent.reservedSlotId, agent.snapshot.agentId)
  delete agent.reservedSlotId
}

function emitPhase(
  events: SimulationPhaseEvent[],
  command: MovementCommand,
  phase: 'arrived' | 'blocked',
  regionId: string,
  now: () => number,
): void {
  events.push({
    reportId: `${command.commandId}:${phase}`,
    agentId: command.agentId,
    stateVersion: command.stateVersion,
    phase,
    regionId,
    occurredAt: new Date(now()).toISOString(),
  })
}

function behaviorFor(command: MovementCommand): string {
  return command.type === 'RETURN_HOME' ? 'returning_home' : 'moving_to_region'
}

function initialFacing(points: readonly MapPoint[], fallback: 'left' | 'right'): 'left' | 'right' {
  for (let index = 1; index < points.length; index += 1) {
    const dx = points[index].x - points[index - 1].x
    if (Math.abs(dx) > EPSILON) return dx > 0 ? 'right' : 'left'
  }
  return fallback
}

function pathLength(points: readonly MapPoint[]): number {
  let total = 0
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y)
  }
  return total
}

function remainingPath(
  path: readonly MapPoint[],
  recoveredPoint: MapPoint,
  recoveredDistance: number,
): MapPoint[] {
  const remaining = [copyPoint(recoveredPoint)]
  let traversed = 0
  let nextIndex = path.length
  for (let index = 1; index < path.length; index += 1) {
    const segmentLength = Math.hypot(
      path[index].x - path[index - 1].x,
      path[index].y - path[index - 1].y,
    )
    const segmentEnd = traversed + segmentLength
    if (recoveredDistance < segmentEnd - EPSILON) {
      nextIndex = index
      break
    }
    traversed = segmentEnd
  }
  for (let index = nextIndex; index < path.length; index += 1) {
    const point = path[index]
    const previous = remaining.at(-1)
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > EPSILON) {
      remaining.push(copyPoint(point))
    }
  }
  return remaining
}

function distanceToTarget(agent: AgentRuntime): number {
  const target = agent.active?.targetSlot.point
  if (!target) return Number.POSITIVE_INFINITY
  return Math.hypot(target.x - agent.snapshot.x, target.y - agent.snapshot.y)
}

function requireDelta(deltaMs: number): void {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) {
    throw new TypeError('Movement engine delta time must be finite and nonnegative')
  }
}

function requireArrivalThreshold(threshold: number): void {
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new TypeError('Movement engine arrival threshold must be finite and nonnegative')
  }
}

function copySnapshot(snapshot: AgentSnapshot): AgentSnapshot {
  return { ...snapshot }
}

function copyPhaseEvent(event: SimulationPhaseEvent): SimulationPhaseEvent {
  return { ...event }
}

function copyPoint(point: MapPoint): MapPoint {
  return { x: point.x, y: point.y }
}
