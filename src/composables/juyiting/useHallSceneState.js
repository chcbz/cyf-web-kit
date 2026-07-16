import { ref } from 'vue'

import { adaptBackendState } from '../../game/simulation/backendSceneStateAdapter.js'

const SCENE_ID = 'juyiting-main'

export const useHallSceneState = ({
  commandQueue,
  reportPhase = async () => null,
  now = Date.now
}) => {
  if (!commandQueue?.enqueue) throw new TypeError('commandQueue.enqueue is required')

  const sceneVersion = ref(0)
  const blockedStates = ref([])
  let mapRuntime = null
  const bufferedStates = new Map()
  const latestStateVersions = new Map()

  const cancelPendingMovement = (agentId) => {
    bufferedStates.delete(agentId)
    commandQueue.clearPending?.(agentId)
  }

  const recordBlockedState = (agentId, stateVersion, reason) => {
    blockedStates.value = [...blockedStates.value, { agentId, stateVersion, reason }]
  }

  const adaptAndEnqueue = (source) => {
    const identity = stateIdentity(source)
    if (!identity) return { accepted: false, reason: 'invalid-state' }
    const latestStateVersion = latestStateVersions.get(identity.agentId)
    if (latestStateVersion !== undefined && identity.stateVersion < latestStateVersion) {
      return { accepted: false, reason: 'stale-agent-state' }
    }
    latestStateVersions.set(identity.agentId, identity.stateVersion)

    const state = semanticState(source)
    if (!state) {
      cancelPendingMovement(identity.agentId)
      recordBlockedState(identity.agentId, identity.stateVersion, 'invalid-state')
      return { accepted: false, reason: 'invalid-state' }
    }
    if (!mapRuntime) {
      const previous = bufferedStates.get(state.agentId)
      if (!previous || state.stateVersion > previous.stateVersion) {
        bufferedStates.set(state.agentId, state)
      }
      return { accepted: true, buffered: true }
    }
    const adapted = adaptBackendState(state, mapRuntime, now())
    if (!adapted.command) {
      cancelPendingMovement(state.agentId)
      recordBlockedState(state.agentId, state.stateVersion, adapted.blockedReason || 'no-command')
      return { accepted: false, reason: adapted.blockedReason || 'no-command' }
    }
    return commandQueue.enqueue(adapted.command)
  }

  const setMapRuntime = (map) => {
    mapRuntime = map || null
    commandQueue.setMapRuntime?.(mapRuntime)
    if (!mapRuntime) return []
    const pending = [...bufferedStates.values()]
      .sort((left, right) => left.stateVersion - right.stateVersion
        || compareCodeUnits(left.agentId, right.agentId))
    bufferedStates.clear()
    return pending.map(adaptAndEnqueue)
  }

  const applySnapshot = (snapshot) => {
    if (!snapshot || snapshot.sceneId !== SCENE_ID || !validVersion(snapshot.sceneVersion)) {
      return { accepted: false, reason: 'invalid-snapshot' }
    }
    if (snapshot.sceneVersion < sceneVersion.value) {
      return { accepted: false, reason: 'stale-scene-version' }
    }
    sceneVersion.value = snapshot.sceneVersion
    const states = Array.isArray(snapshot.states) ? snapshot.states : []
    const presentAgentIds = new Set(states.map(stateIdentity).filter(Boolean).map(state => state.agentId))
    latestStateVersions.forEach((_version, agentId) => {
      if (!presentAgentIds.has(agentId)) cancelPendingMovement(agentId)
    })
    const results = states.map(adaptAndEnqueue)
    return { accepted: true, results }
  }

  const applyEvent = (event) => {
    if (!event || !validVersion(event.sceneVersion) || !event.state) {
      return { accepted: false, reason: 'invalid-event' }
    }
    if (event.sceneVersion <= sceneVersion.value) {
      return { accepted: false, reason: 'stale-scene-version' }
    }
    sceneVersion.value = event.sceneVersion
    return adaptAndEnqueue(event.state)
  }

  const forwardPhaseEvents = async (events) => {
    const reports = (Array.isArray(events) ? events : [])
      .map(phaseReport)
      .filter(Boolean)
    return Promise.all(reports.map(reportPhase))
  }

  return {
    applyEvent,
    applySnapshot,
    blockedStates,
    forwardPhaseEvents,
    sceneVersion,
    setMapRuntime
  }
}

function semanticState (source) {
  if (!source || !text(source.agentId) || !text(source.personaCode)
    || !text(source.behavior) || !validVersion(source.stateVersion)
    || !timestamp(source.startedAt)) return null
  return {
    agentId: source.agentId,
    personaCode: source.personaCode,
    behavior: source.behavior,
    targetRegionId: text(source.targetRegionId) ? source.targetRegionId : '',
    stateVersion: source.stateVersion,
    startedAt: source.startedAt,
    ...(source.expectedArrivalAt === undefined
      ? {} : { expectedArrivalAt: source.expectedArrivalAt }),
    ...(source.expiresAt === undefined ? {} : { expiresAt: source.expiresAt }),
    ...(text(source.phase) ? { phase: source.phase } : {})
  }
}

function stateIdentity (source) {
  if (!text(source?.agentId) || !validVersion(source?.stateVersion)) return null
  return { agentId: source.agentId, stateVersion: source.stateVersion }
}

function phaseReport (source) {
  const occurredAt = typeof source?.occurredAt === 'number'
    ? source.occurredAt
    : Date.parse(source?.occurredAt)
  if (!source || !text(source.reportId) || !text(source.agentId)
    || !validVersion(source.stateVersion) || source.stateVersion === 0
    || !['arrived', 'blocked'].includes(source.phase) || !text(source.regionId)
    || !Number.isSafeInteger(occurredAt) || occurredAt < 0) return null
  return {
    reportId: source.reportId,
    agentId: source.agentId,
    stateVersion: source.stateVersion,
    phase: source.phase,
    regionId: source.regionId,
    occurredAt
  }
}

function validVersion (value) {
  return Number.isSafeInteger(value) && value >= 0
}

function timestamp (value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0
  return text(value) && Number.isFinite(Date.parse(value))
}

function text (value) {
  return typeof value === 'string' && value.trim().length > 0
}

function compareCodeUnits (left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}
