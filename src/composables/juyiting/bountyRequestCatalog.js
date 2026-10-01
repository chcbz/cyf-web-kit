import { exactOutputId } from './bountyOutputCatalog.js'

const LONG_MAX = 9223372036854775807n
const long = (value, zero = false) => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) &&
  BigInt(value) <= LONG_MAX && (zero || value !== '0')
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const keys = (value, names) => object(value) && Object.keys(value).length === names.length && Object.keys(value).every(key => names.includes(key))
const clone = value => JSON.parse(JSON.stringify(value))
const immutableRequest = request => [request.requestId, request.conversationId, request.conversationGeneration, request.userMessageId].join('\u0000')
const validStep = (step, scope) => keys(step, ['stepId', 'stepNumber', 'taskId', 'assignmentRevision', 'targetAgentId', 'kind', 'state', 'stateVersion', 'executionIntentId', 'executionId', 'executionState']) &&
  exactOutputId(step.stepId) && long(step.stepNumber) && step.taskId === scope.taskId && long(step.assignmentRevision, true) && exactOutputId(step.targetAgentId) &&
  typeof step.kind === 'string' && step.kind && typeof step.state === 'string' && step.state && long(step.stateVersion, true) &&
  exactOutputId(step.executionIntentId) && exactOutputId(step.executionId) && typeof step.executionState === 'string' && step.executionState
const validTurn = turn => object(turn) && typeof turn.turnId === 'string' && exactOutputId(turn.turnId) &&
  (turn.stateVersion === undefined || long(turn.stateVersion, true)) && (turn.requestRevision === undefined || long(turn.requestRevision))
export const catalogLong = long
export const catalogScope = value => keys(value, ['conversationId', 'conversationGeneration', 'taskId']) &&
  exactOutputId(value.conversationId) && long(value.conversationGeneration) && exactOutputId(value.taskId)
export const catalogRequest = (value, scope) => keys(value, ['requestId', 'requestRevision', 'conversationId', 'conversationGeneration', 'userMessageId', 'state', 'stateVersion', 'turns', 'steps']) &&
  exactOutputId(value.requestId) && long(value.requestRevision) && value.conversationId === scope.conversationId &&
  value.conversationGeneration === scope.conversationGeneration && long(value.userMessageId) && typeof value.state === 'string' && value.state &&
  long(value.stateVersion, true) && Array.isArray(value.turns) && value.turns.every(validTurn) && Array.isArray(value.steps) &&
  value.steps.every(step => validStep(step, scope))
export const catalogPage = (value, expected = {}) => {
  if (!keys(value, ['schemaVersion', 'scope', 'after', 'through', 'nextAfter', 'hasMore', 'entries']) || value.schemaVersion !== 1 || !catalogScope(value.scope) ||
      !long(value.after, true) || !long(value.through, true) || BigInt(value.after) > BigInt(value.through) || typeof value.hasMore !== 'boolean' || !Array.isArray(value.entries)) return null
  if (expected.conversationId && value.scope.conversationId !== expected.conversationId) return null
  if (expected.taskId && value.scope.taskId !== expected.taskId) return null
  if (expected.generation && value.scope.conversationGeneration !== expected.generation) return null
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
const mergeSteps = (oldSteps, newSteps) => {
  const old = new Map(oldSteps.map(step => [step.stepId, step])); const result = []
  for (const step of newSteps) {
    const prior = old.get(step.stepId)
    if (prior && (!versionAtLeast(step.stateVersion, prior.stateVersion) || (step.stateVersion === prior.stateVersion && JSON.stringify(step) !== JSON.stringify(prior)))) return null
    result.push(clone(step)); old.delete(step.stepId)
  }
  return [...old.values().map(clone), ...result]
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
    if (!steps) return null
    merged.set(next.request.requestId, { ordinal: next.ordinal, request: { ...clone(prior.request), ...clone(next.request), steps } })
  }
  return [...merged.values()].sort((a, b) => BigInt(a.ordinal) < BigInt(b.ordinal) ? -1 : 1)
}
export const catalogExecutionSteps = (entries, current = {}) => entries.flatMap(entry => entry.request.steps
  .filter(step => step.kind === 'EXECUTE')
  .map(step => Object.freeze({ ...clone(step), requestId: entry.request.requestId, requestRevision: entry.request.requestRevision,
    conversationId: entry.request.conversationId, conversationGeneration: entry.request.conversationGeneration,
    historical: step.targetAgentId !== current.targetAgentId || step.assignmentRevision !== current.assignmentRevision })))
