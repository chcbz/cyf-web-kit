import type { MapPoint, MapRuntimeData, Slot } from '../map/movementSchema.js'
import type { PersonaDirection, PersonaSpriteManifest } from '../sprites/personaSpriteManifest.js'
import { resolvePersonaDirectionFromDelta } from '../sprites/animationResolver.js'
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
  facing: PersonaDirection
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
  source: 'backend' | 'local' | 'user'
}

export type MovementEngine = {
  enqueue(command: MovementCommand): MovementCommandPushResult
  cancel(agentId: string, stateVersion?: number): boolean
  setLocalPatrols(patrols: readonly LocalPatrolAssignment[]): void
  update(deltaMs: number): void
  snapshots(): AgentSnapshot[]
  drainPhaseEvents(): SimulationPhaseEvent[]
  metrics(): Readonly<{ queuedCommandCount: number, replanningCount: number }>
}

export type LocalPatrolAssignment = {
  agentId: string
  personaCode: string
  routeId: string
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
  lastTravelVector?: MapPoint
}

const EPSILON = 1e-9
const DEFAULT_ARRIVAL_THRESHOLD = 8
const HARD_CROSS_COMMAND_TURN_DEGREES = 120
const CROSS_COMMAND_TURN_PENALTY_PER_DEGREE = 0.5

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
  const localPatrols = new Map<string, { personaCode: string, routeId: string, nextIndex: number, waitMs: number }>()
  const backendHeldAgents = new Set<string>()
  let replanningCount = 0
  const now = options.now ?? Date.now
  const arrivalThreshold = options.arrivalThreshold ?? DEFAULT_ARRIVAL_THRESHOLD
  requireArrivalThreshold(arrivalThreshold)

  return {
    enqueue(source) {
      const cancellationWatermark = source
        ? cancellationWatermarks.get(source.agentId)
        : undefined
      if (source?.source !== 'local' && cancellationWatermark !== undefined
        && source.stateVersion <= cancellationWatermark) {
        return { accepted: false, reason: 'stale-state-version' }
      }
      const existingAgent = agents.get(source?.agentId)
      if (source?.source === 'local' && backendHeldAgents.has(source.agentId)) {
        return { accepted: false, reason: 'lower-priority' }
      }
      if (source?.source === 'local' && existingAgent?.active?.command.source === 'backend') {
        return { accepted: false, reason: 'lower-priority' }
      }
      const replacedActive = existingAgent?.active?.command.commandId
      const result = queue.push(source)
      if (!result.accepted) return result
      const command = queue.shift()
      if (!command) throw new Error('Accepted movement command was not available for simulation')
      if (existingAgent?.active && replacedActive !== command.commandId) replanningCount += 1
      if (existingAgent?.active && replacedActive !== command.commandId
        && distanceToTarget(existingAgent) <= arrivalThreshold) {
        arrive(existingAgent, phaseEvents, now)
      }
      if (command.source === 'backend') backendHeldAgents.add(command.agentId)
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
        backendHeldAgents.delete(agentId)
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
      advanceLocalPatrols(deltaMs, localPatrols, backendHeldAgents, agents, map, manifest, pathfinder, slots, phaseEvents, now)
    },

    setLocalPatrols(assignments) {
      const availableRoutes = new Map((map.patrolRoutes ?? []).map(route => [route.routeId, route]))
      const next = new Map<string, { personaCode: string, routeId: string, nextIndex: number, waitMs: number }>()
      for (const assignment of assignments ?? []) {
        const route = availableRoutes.get(assignment?.routeId)
        if (!assignment?.agentId || !assignment?.personaCode || !route
          || route.personaCode !== assignment.personaCode) continue
        const current = localPatrols.get(assignment.agentId)
        next.set(assignment.agentId, {
          personaCode: assignment.personaCode,
          routeId: route.routeId,
          nextIndex: current?.routeId === route.routeId ? current.nextIndex : 0,
          waitMs: current?.routeId === route.routeId ? current.waitMs : 0,
        })
      }
      for (const agentId of localPatrols.keys()) {
        if (next.has(agentId) || backendHeldAgents.has(agentId)) continue
        const runtime = agents.get(agentId)
        if (runtime?.active?.command.source === 'backend') continue
        if (runtime) releaseReservation(runtime, slots)
        agents.delete(agentId)
        for (let index = phaseEvents.length - 1; index >= 0; index -= 1) {
          if (phaseEvents[index]?.agentId === agentId) phaseEvents.splice(index, 1)
        }
      }
      localPatrols.clear()
      next.forEach((value, agentId) => localPatrols.set(agentId, value))
    },

    snapshots() {
      return [...agents.values()]
        .map(agent => copySnapshot(agent.snapshot))
        .sort((left, right) => left.agentId.localeCompare(right.agentId))
    },

    drainPhaseEvents() {
      return phaseEvents.splice(0).map(copyPhaseEvent)
    },

    metrics() {
      return Object.freeze({ queuedCommandCount: queue.size, replanningCount })
    },
  }
}

function advanceLocalPatrols(
  deltaMs: number,
  patrols: Map<string, { personaCode: string, routeId: string, nextIndex: number, waitMs: number }>,
  backendHeldAgents: Set<string>,
  agents: Map<string, AgentRuntime>,
  map: MapRuntimeData,
  manifest: PersonaSpriteManifest,
  pathfinder: PathFinder,
  slots: SlotAllocator,
  phaseEvents: SimulationPhaseEvent[],
  now: () => number,
): void {
  const routes = new Map((map.patrolRoutes ?? []).map(route => [route.routeId, route]))
  for (const [agentId, patrol] of patrols) {
    if (backendHeldAgents.has(agentId)) continue
    const route = routes.get(patrol.routeId)
    if (!route || !route.regionIds.length) continue
    const agent = agents.get(agentId)
    if (agent?.active) continue
    if (agent?.snapshot.phase === 'arrived' && patrol.waitMs === 0) patrol.waitMs = route.dwellMs
    if (patrol.waitMs > 0) {
      patrol.waitMs = Math.max(0, patrol.waitMs - deltaMs)
      if (patrol.waitMs > 0) continue
    }
    const targetRegionId = route.regionIds[patrol.nextIndex]
    patrol.nextIndex = route.loop
      ? (patrol.nextIndex + 1) % route.regionIds.length
      : Math.min(patrol.nextIndex + 1, route.regionIds.length - 1)
    const command: MovementCommand = {
      commandId: `local:${agentId}:${route.routeId}:${patrol.nextIndex}:${now()}`,
      agentId,
      personaCode: patrol.personaCode,
      source: 'local',
      type: 'MOVE_TO_REGION',
      targetRegionId,
      priority: route.priority,
      stateVersion: 0,
      startedAt: new Date(now()).toISOString(),
    }
    const runtime = agents.get(agentId)
    if (runtime?.active?.command.source === 'backend') continue
    activate(command, map, manifest, pathfinder, slots, agents, phaseEvents, now)
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
        facing: 'down',
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

  const origin = { x: agent.snapshot.x, y: agent.snapshot.y }
  const scoredSlots = slots.available(command.targetRegionId, command).flatMap(slot => {
    const path = pathfinder.find(origin, slot.point, { colliderWidth: definition.collider.width })
    if (path.status !== 'found') return []
    const turnDegrees = command.source === 'local'
      ? directionChangeDegrees(agent.lastTravelVector, firstTravelVector(path.points))
      : 0
    return [{
      slot,
      path,
      turnDegrees,
      hardCrossCommandTurn: turnDegrees > HARD_CROSS_COMMAND_TURN_DEGREES + EPSILON,
      continuityCost: path.cost + turnDegrees * CROSS_COMMAND_TURN_PENALTY_PER_DEGREE,
    }]
  }).sort((left, right) => (
    Number(left.hardCrossCommandTurn) - Number(right.hardCrossCommandTurn)
    || left.continuityCost - right.continuityCost
    || left.path.cost - right.path.cost
    || compareSlotChoice(left.slot, right.slot)
  ))
  const selected = scoredSlots[0]
  if (!selected) {
    releaseReservation(agent, slots)
    block(agent, command, phaseEvents, now)
    return
  }
  // Scoring never owns a slot. Claim only the final choice, atomically, so a
  // failed/less-optimal candidate cannot transiently displace another agent.
  const targetSlot = slots.reserveSlot(selected.slot.slotId, command)
  if (!targetSlot) {
    releaseReservation(agent, slots)
    block(agent, command, phaseEvents, now)
    return
  }
  agent.reservedSlotId = targetSlot.slotId
  const path = selected.path

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

function compareSlotChoice(left: Slot, right: Slot): number {
  return left.stableId < right.stableId ? -1 : left.stableId > right.stableId ? 1
    : left.slotId < right.slotId ? -1 : left.slotId > right.slotId ? 1 : 0
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
    agent.snapshot.facing = resolvePersonaDirectionFromDelta(dx, dy, agent.snapshot.facing)
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
  agent.lastTravelVector = finalTravelVector(active.path) ?? agent.lastTravelVector
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
    source: command.source,
  })
}

function behaviorFor(command: MovementCommand): string {
  return command.type === 'RETURN_HOME' ? 'returning_home' : 'moving_to_region'
}

function initialFacing(points: readonly MapPoint[], fallback: PersonaDirection): PersonaDirection {
  for (let index = 1; index < points.length; index += 1) {
    const dx = points[index].x - points[index - 1].x
    const dy = points[index].y - points[index - 1].y
    if (Math.hypot(dx, dy) > EPSILON) return resolvePersonaDirectionFromDelta(dx, dy, fallback)
  }
  return fallback
}


function firstTravelVector(points: readonly MapPoint[]): MapPoint | undefined {
  for (let index = 1; index < points.length; index += 1) {
    const vector = {
      x: points[index].x - points[index - 1].x,
      y: points[index].y - points[index - 1].y,
    }
    if (Math.hypot(vector.x, vector.y) > EPSILON) return vector
  }
  return undefined
}

function finalTravelVector(points: readonly MapPoint[]): MapPoint | undefined {
  for (let index = points.length - 1; index > 0; index -= 1) {
    const vector = {
      x: points[index].x - points[index - 1].x,
      y: points[index].y - points[index - 1].y,
    }
    if (Math.hypot(vector.x, vector.y) > EPSILON) return vector
  }
  return undefined
}

function directionChangeDegrees(
  incoming: MapPoint | undefined,
  outgoing: MapPoint | undefined,
): number {
  if (!incoming || !outgoing) return 0
  const denominator = Math.hypot(incoming.x, incoming.y) * Math.hypot(outgoing.x, outgoing.y)
  if (denominator <= EPSILON) return 0
  const cosine = Math.max(-1, Math.min(1,
    (incoming.x * outgoing.x + incoming.y * outgoing.y) / denominator,
  ))
  return Math.acos(cosine) * 180 / Math.PI
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
