import { ref } from 'vue'

import { adaptBackendState } from '../../game/simulation/backendSceneStateAdapter.js'
import {
  canonicalSceneVersion,
  compareSceneVersions,
  publishSceneVersion
} from './sceneVersion.js'

const SCENE_ID = 'juyiting-main'

export const useHallSceneState = ({
  commandQueue,
  reportPhase = async () => null,
  now = Date.now
}) => {
  if (!commandQueue?.enqueue) throw new TypeError('commandQueue.enqueue is required')

  const sceneVersion = ref(0)
  const blockedStates = ref([])
  let sceneCursor = '0'
  let mapRuntime = null
  const bufferedStates = new Map()
  const latestStateVersions = new Map()

  const cancelMovement = (agentId, stateVersion) => {
    bufferedStates.delete(agentId)
    commandQueue.clearPending?.(agentId)
    commandQueue.cancelActive?.(agentId, stateVersion)
  }

  const recordBlockedState = (agentId, stateVersion, reason) => {
    blockedStates.value = [...blockedStates.value, { agentId, stateVersion, reason }]
  }

  const adaptAndEnqueue = (source, alreadyObserved = false) => {
    const identity = stateIdentity(source)
    if (!identity) return { accepted: false, reason: 'invalid-state' }
    const latestStateVersion = latestStateVersions.get(identity.agentId)
    if (!alreadyObserved && latestStateVersion !== undefined
      && identity.stateVersion <= latestStateVersion) {
      return { accepted: false, reason: 'stale-agent-state' }
    }
    if (!alreadyObserved) latestStateVersions.set(identity.agentId, identity.stateVersion)

    const state = semanticState(source)
    if (!state) {
      cancelMovement(identity.agentId, identity.stateVersion)
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
      cancelMovement(state.agentId, state.stateVersion)
      recordBlockedState(state.agentId, state.stateVersion, adapted.blockedReason || 'no-command')
      return { accepted: false, reason: adapted.blockedReason || 'no-command' }
    }
    const result = commandQueue.enqueue(adapted.command)
    if (!result.accepted) commandQueue.clearPending?.(state.agentId)
    return result
  }

  const applyStates = states => commandQueue.batch
    ? commandQueue.batch(() => states.map(state => adaptAndEnqueue(state)))
    : states.map(state => adaptAndEnqueue(state))

  const setMapRuntime = (map) => {
    mapRuntime = map || null
    commandQueue.setMapRuntime?.(mapRuntime)
    if (!mapRuntime) return []
    const pending = [...bufferedStates.values()]
      .sort((left, right) => left.stateVersion - right.stateVersion
        || compareCodeUnits(left.agentId, right.agentId))
    bufferedStates.clear()
    return commandQueue.batch
      ? commandQueue.batch(() => pending.map(state => adaptAndEnqueue(state, true)))
      : pending.map(state => adaptAndEnqueue(state, true))
  }

  const applySnapshot = (snapshot) => {
    const cursor = canonicalSceneVersion(snapshot?.sceneVersion)
    if (!snapshot || snapshot.sceneId !== SCENE_ID || cursor == null) {
      return { accepted: false, reason: 'invalid-snapshot' }
    }
    if (compareSceneVersions(cursor, sceneCursor) < 0) {
      return { accepted: false, reason: 'stale-scene-version' }
    }
    sceneCursor = cursor
    sceneVersion.value = publishSceneVersion(cursor)
    const states = Array.isArray(snapshot.states) ? snapshot.states : []
    const presentAgentIds = new Set(states.map(stateIdentity).filter(Boolean).map(state => state.agentId))
    latestStateVersions.forEach((_version, agentId) => {
      if (!presentAgentIds.has(agentId)) {
        cancelMovement(agentId, latestStateVersions.get(agentId))
      }
    })
    const results = applyStates(states)
    return { accepted: true, results }
  }

  const applyEvent = (event) => {
    const cursor = canonicalSceneVersion(event?.sceneVersion)
    if (!event || cursor == null || !event.state) {
      return { accepted: false, reason: 'invalid-event' }
    }
    if (compareSceneVersions(cursor, sceneCursor) <= 0) {
      return { accepted: false, reason: 'stale-scene-version' }
    }
    sceneCursor = cursor
    sceneVersion.value = publishSceneVersion(cursor)
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
  const startedAt = timestampValue(source?.startedAt)
  const expectedArrivalAt = optionalTimestampValue(source?.expectedArrivalAt)
  const expiresAt = optionalTimestampValue(source?.expiresAt)
  if (!source || !text(source.agentId) || !text(source.personaCode)
    || !text(source.behavior) || !validVersion(source.stateVersion)
    || startedAt == null || expectedArrivalAt === null || expiresAt === null
    || (expectedArrivalAt !== undefined && expectedArrivalAt < startedAt)
    || (expiresAt !== undefined && expiresAt < startedAt)
    || (expectedArrivalAt !== undefined && expiresAt !== undefined
      && expiresAt < expectedArrivalAt)) return null
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

function timestampValue (value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null
  }
  if (!text(value)) return null
  const timestamp = /^\d+$/.test(value) ? Number(value) : Date.parse(value)
  return Number.isSafeInteger(timestamp) && timestamp >= 0 ? timestamp : null
}

function optionalTimestampValue (value) {
  return value === undefined ? undefined : timestampValue(value)
}

function text (value) {
  return typeof value === 'string' && value.trim().length > 0
}

function compareCodeUnits (left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}
