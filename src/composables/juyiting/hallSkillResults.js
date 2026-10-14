import { typedId, typedLong, typedOutcomeProjection } from './hallTypedDeliberation.js'
import { outputCatalogItems } from './bountyOutputCatalog.js'
const fields = ['schemaVersion', 'conversationId', 'conversationGeneration', 'taskId', 'requestId', 'stepId', 'executionId', 'state', 'phase', 'resultDigest', 'data', 'outputs']
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
/** Exact persisted child/execution binding; no latest-output or full-history discovery. */
export const skillResultReferences = (outcomes, context) => {
  const results = []; const seen = new Set()
  if (!typedId(context?.conversationId) || !typedId(context?.taskId) || !typedLong(context?.conversationGeneration)) return results
  for (const raw of Array.isArray(outcomes) ? outcomes : []) {
    const { key, purpose, ...wire } = raw || {}
    if (purpose !== undefined && purpose !== wire.route) continue
    const value = typedOutcomeProjection(wire, context)
    const progress = value?.actionProgress
    if (value?.schemaVersion !== 4 || value.state !== 'READY' || value.outcome?.kind !== 'ACTION_REQUEST' ||
      !typedId(progress?.executionId) || !typedId(progress.childRequestId) || progress.childRoute !== 'EXECUTE') continue
    if (seen.has(progress.executionId)) continue
    seen.add(progress.executionId)
    results.push(Object.freeze({ ...context, executionId: progress.executionId, requestId: progress.childRequestId,
      resultDigest: progress.resultDigest, outcomeId: value.outcome.outcomeId, finalDigest: value.outcome.finalDigest,
      deliveryRelation: value.outcome.deliveryRelation ?? null, progressState: progress.state }))
  }
  return results
}
export const skillResultProjection = (value, expected) => {
  if (!expected || !value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length ||
    fields.some(key => !Object.hasOwn(value, key)) || value.schemaVersion !== 1 ||
    ['conversationId', 'conversationGeneration', 'taskId', 'requestId', 'executionId'].some(key => value[key] !== expected[key]) ||
    !typedId(value.stepId) || typeof value.state !== 'string' || !value.state ||
    !['QUEUED', 'VALIDATING', 'RUNNING', 'WAITING_PROVIDER', 'RESULT_UNKNOWN', 'ARCHIVING', 'COMPLETE', 'FAILED', 'CANCELLED'].includes(value.phase) ||
    (value.resultDigest !== null && !digest(value.resultDigest)) ||
    (expected.resultDigest != null && value.resultDigest !== expected.resultDigest) || !Array.isArray(value.outputs)) return null
  const outputs = outputCatalogItems(value.outputs, value.requestId, value.stepId)
  if (outputs.length !== value.outputs.length || (value.phase === 'COMPLETE' && !digest(value.resultDigest))) return null
  // Archive-in-progress is never a ready data/file delivery, even if the manifest exists.
  const complete = value.phase === 'COMPLETE' && value.state === 'RESULT_COMMITTED'
  if (value.phase === 'COMPLETE' && !complete) return null
  return Object.freeze({ ...value, complete, outputs: Object.freeze(complete ? outputs : []), data: complete ? value.data : null })
}
export const skillResultDataText = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2)
