import { exactOutputId } from './bountyOutputCatalog.js'

const LONG_MAX = 9223372036854775807n
const long = (value, zero = false) => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) &&
  BigInt(value) <= LONG_MAX && (zero || value !== '0')
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const keys = (value, names) => object(value) && Object.keys(value).length === names.length && Object.keys(value).every(key => names.includes(key))
const clone = value => JSON.parse(JSON.stringify(value))
const immutableRequest = request => [request.requestId, request.conversationId, request.conversationGeneration, request.userMessageId].join('\u0000')
const STEP_KINDS = new Set(['CHAT', 'INSPECT', 'EXECUTE'])
const validStep = (step, scope) => {
  if (!keys(step, ['stepId', 'stepNumber', 'taskId', 'assignmentRevision', 'targetAgentId', 'kind', 'state', 'stateVersion', 'executionIntentId', 'executionId', 'executionState']) ||
      !exactOutputId(step.stepId) || !long(step.stepNumber) || step.taskId !== scope.taskId || !long(step.assignmentRevision, true) || !exactOutputId(step.targetAgentId) ||
      !STEP_KINDS.has(step.kind) || typeof step.state !== 'string' || !step.state || !long(step.stateVersion, true)) return false
  if (step.kind !== 'EXECUTE') return step.executionIntentId === null && step.executionId === null && step.executionState === null
  return exactOutputId(step.executionIntentId) && (step.executionId === null || exactOutputId(step.executionId)) &&
    typeof step.executionState === 'string' && Boolean(step.executionState)
}
const validTurn = (turn, request) => keys(turn, ['turnId', 'requestId', 'requestRevision', 'conversationId', 'conversationGeneration',
  'targetAgentId', 'contextSnapshotId', 'dispatchId', 'route', 'state', 'stateVersion', 'lastDeltaSeq', 'terminalReason', 'finalMessageId', 'createdAt', 'updatedAt']) &&
  exactOutputId(turn.turnId) && turn.requestId === request.requestId && turn.requestRevision === request.requestRevision &&
  turn.conversationId === request.conversationId && turn.conversationGeneration === request.conversationGeneration &&
  exactOutputId(turn.targetAgentId) && exactOutputId(turn.contextSnapshotId) && exactOutputId(turn.dispatchId) &&
  typeof turn.route === 'string' && Boolean(turn.route) && typeof turn.state === 'string' && Boolean(turn.state) &&
  long(turn.stateVersion, true) && long(turn.lastDeltaSeq, true) && (turn.terminalReason === null || typeof turn.terminalReason === 'string') &&
  (turn.finalMessageId === null || long(turn.finalMessageId)) && long(turn.createdAt) && long(turn.updatedAt)
export const catalogLong = long
export const catalogScope = value => keys(value, ['conversationId', 'conversationGeneration', 'taskId']) &&
  exactOutputId(value.conversationId) && long(value.conversationGeneration) && exactOutputId(value.taskId)
export const catalogRequest = (value, scope) => keys(value, ['requestId', 'requestRevision', 'conversationId', 'conversationGeneration', 'userMessageId', 'state', 'stateVersion', 'turns', 'steps']) &&
  exactOutputId(value.requestId) && long(value.requestRevision) && value.conversationId === scope.conversationId &&
  value.conversationGeneration === scope.conversationGeneration && long(value.userMessageId) && typeof value.state === 'string' && value.state &&
  long(value.stateVersion, true) && Array.isArray(value.turns) && value.turns.every(turn => validTurn(turn, value)) && Array.isArray(value.steps) &&
  value.steps.every(step => validStep(step, scope))
export const catalogPage = (value, expected = {}) => {
  if (!keys(value, ['schemaVersion', 'scope', 'after', 'through', 'nextAfter', 'hasMore', 'entries']) || value.schemaVersion !== 1 || !catalogScope(value.scope) ||
      !long(value.after, true) || !long(value.through, true) || BigInt(value.after) > BigInt(value.through) || typeof value.hasMore !== 'boolean' || !Array.isArray(value.entries)) return null
  if (expected.conversationId && value.scope.conversationId !== expected.conversationId) return null
  if (expected.taskId && value.scope.taskId !== expected.taskId) return null
  if (expected.generation && value.scope.conversationGeneration !== expected.generation) return null
  if (expected.after != null && value.after !== expected.after) return null
  if (expected.through != null && value.through !== expected.through) return null
  const seen = new Set(); let previous = BigInt(value.after)
  for (const entry of value.entries) {
    if (!keys(entry, ['ordinal', 'request']) || !long(entry.ordinal) || BigInt(entry.ordinal) <= previous || BigInt(entry.ordinal) > BigInt(value.through) ||
      seen.has(entry.request?.requestId) || !catalogRequest(entry.request, value.scope)) return null
    previous = BigInt(entry.ordinal); seen.add(entry.request.requestId)
  }
  if (value.hasMore !== (value.nextAfter !== null)) return null
  if (value.hasMore && (!long(value.nextAfter) || value.nextAfter !== value.entries.at(-1)?.ordinal)) return null
  if (!value.hasMore && value.nextAfter !== null) return null
  if (value.through === '0' && (value.entries.length || value.hasMore || value.nextAfter !== null)) return null
  return Object.freeze(clone(value))
}
const versionAtLeast = (next, previous) => BigInt(next) >= BigInt(previous)
const mergeVersioned = (oldItems, newItems, id, version) => {
  const old = new Map(oldItems.map(item => [item[id], item])); const result = []
  for (const item of newItems) {
    const prior = old.get(item[id])
    if (prior && (!versionAtLeast(item[version], prior[version]) || (item[version] === prior[version] && JSON.stringify(item) !== JSON.stringify(prior)))) return null
    result.push(clone(item)); old.delete(item[id])
  }
  return [...old.values()].map(clone).concat(result)
}
const mergeSteps = (oldSteps, newSteps) => mergeVersioned(oldSteps, newSteps, 'stepId', 'stateVersion')
const mergeTurns = (oldTurns, newTurns) => {
  // Existing TurnView revisions are authoritative when present. Older wire shapes
  // without one remain immutable across a catalog scan rather than being invented.
  const version = turn => turn.stateVersion ?? turn.requestRevision ?? '0'
  const old = new Map(oldTurns.map(turn => [turn.turnId, turn])); const result = []
  for (const turn of newTurns) {
    const prior = old.get(turn.turnId)
    if (prior && (!versionAtLeast(version(turn), version(prior)) || (version(turn) === version(prior) && JSON.stringify(turn) !== JSON.stringify(prior)))) return null
    result.push(clone(turn)); old.delete(turn.turnId)
  }
  return [...old.values()].map(clone).concat(result)
}
export const mergeCatalogEntries = (previous = [], page) => {
  const old = new Map(previous.map(entry => [entry.request.requestId, entry])); const merged = new Map(old)
  for (const next of page.entries) {
    const prior = old.get(next.request.requestId)
    if (!prior) { merged.set(next.request.requestId, clone(next)); continue }
    if (immutableRequest(prior.request) !== immutableRequest(next.request) || !versionAtLeast(next.request.requestRevision, prior.request.requestRevision) ||
        !versionAtLeast(next.request.stateVersion, prior.request.stateVersion)) return null
    if (next.request.requestRevision === prior.request.requestRevision && next.request.stateVersion === prior.request.stateVersion &&
        Object.keys(next.request).filter(key => !['steps', 'turns'].includes(key)).some(key => JSON.stringify(next.request[key]) !== JSON.stringify(prior.request[key]))) return null
    const steps = mergeSteps(prior.request.steps, next.request.steps)
    const turns = mergeTurns(prior.request.turns, next.request.turns)
    if (!steps || !turns) return null
    merged.set(next.request.requestId, { ordinal: next.ordinal, request: { ...clone(prior.request), ...clone(next.request), turns, steps } })
  }
  return [...merged.values()].sort((a, b) => BigInt(a.ordinal) < BigInt(b.ordinal) ? -1 : 1)
}
export const catalogExecutionSteps = (entries, current = {}) => entries.flatMap(entry => entry.request.steps
  .filter(step => step.kind === 'EXECUTE')
  .map(step => Object.freeze({ ...clone(step), requestId: entry.request.requestId, requestRevision: entry.request.requestRevision,
    conversationId: entry.request.conversationId, conversationGeneration: entry.request.conversationGeneration,
    historical: step.targetAgentId !== current.targetAgentId || step.assignmentRevision !== current.assignmentRevision })))
