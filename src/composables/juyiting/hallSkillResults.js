import { typedId, typedLong, typedOutcomeProjection } from './hallTypedDeliberation.js'
import { outputCatalogItems } from './bountyOutputCatalog.js'
const fields = ['schemaVersion', 'conversationId', 'conversationGeneration', 'taskId', 'requestId', 'stepId', 'executionId', 'executionStateVersion', 'state', 'phase', 'resultSha256', 'data', 'outputs']
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
/** Exact persisted child/execution binding; no latest-output or full-history discovery. */
export const skillResultReferences = (outcomes, context) => {
  const results = []; const seen = new Set()
  if (!typedId(context?.conversationId) || !typedId(context?.taskId) || !typedLong(context?.conversationGeneration)) return results
  for (const raw of Array.isArray(outcomes) ? outcomes : []) {
    const { key: _key, purpose, ...wire } = raw || {}
    if (purpose !== undefined && purpose !== wire.route) continue
    const value = typedOutcomeProjection(wire, context)
    const progress = value?.actionProgress
    if (value?.schemaVersion !== 6 || ![4, 5].includes(value.outcome?.outcomeContractVersion) || value.state !== 'READY' || value.outcome?.kind !== 'ACTION_REQUEST' ||
      !typedId(progress?.executionId) || !typedId(progress.childRequestId) || progress.childRoute !== 'EXECUTE') continue
    if (seen.has(progress.executionId)) continue
    seen.add(progress.executionId)
    results.push(Object.freeze({ ...context, executionId: progress.executionId, requestId: progress.childRequestId,
      executionStateVersion: progress.executionStateVersion, resultSha256: progress.resultSha256, outcomeId: value.outcome.outcomeId, finalSha256: value.outcome.finalSha256,
      deliveryRelation: value.outcome.deliveryRelation ?? null, progressState: progress.state }))
  }
  return results
}
export const skillResultProjection = (value, expected) => {
  if (!expected || !value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length ||
    fields.some(key => !Object.hasOwn(value, key)) || value.schemaVersion !== 2 ||
    ['conversationId', 'conversationGeneration', 'taskId', 'requestId', 'executionId'].some(key => value[key] !== expected[key]) ||
    !typedLong(value.executionStateVersion, { allowZero: true }) || (expected.executionStateVersion != null && BigInt(value.executionStateVersion) < BigInt(expected.executionStateVersion)) || !typedId(value.stepId) || typeof value.state !== 'string' || !value.state ||
    !['READY', 'RESULT_READY', 'RUNNING', 'WAITING_PROVIDER', 'RESULT_UNKNOWN', 'ARCHIVING', 'COMPLETE', 'FAILED', 'CANCELLED'].includes(value.phase) ||
    (value.resultSha256 !== null && !digest(value.resultSha256)) ||
    (expected.resultSha256 != null && value.resultSha256 !== expected.resultSha256) || !Array.isArray(value.outputs)) return null
  if (value.phase !== 'COMPLETE' && (value.data !== null || value.outputs.length !== 0)) return null
  const outputs = outputCatalogItems(value.outputs, value.requestId, value.stepId)
  if (outputs.length !== value.outputs.length || (value.phase === 'COMPLETE' && !digest(value.resultSha256))) return null
  // Archive-in-progress is never a ready data/file delivery, even if the manifest exists.
  const complete = value.phase === 'COMPLETE' && value.state === 'RESULT_COMMITTED'
  if (value.phase === 'COMPLETE' && !complete) return null
  return Object.freeze({ ...value, complete, outputs: Object.freeze(complete ? outputs : []), data: complete ? value.data : null })
}
export const skillResultDataText = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2)
export const skillResultAdvances = (before, after) => {
  if (before == null) return true
  if (!after || ['conversationId', 'conversationGeneration', 'taskId', 'requestId', 'stepId', 'executionId'].some(key => before[key] !== after[key]) ||
    BigInt(after.executionStateVersion) < BigInt(before.executionStateVersion)) return false
  if (['COMPLETE', 'FAILED', 'CANCELLED'].includes(before.phase) && before.phase !== after.phase) return false
  if (before.resultSha256 !== null && before.resultSha256 !== after.resultSha256) return false
  return before.executionStateVersion !== after.executionStateVersion || fields.every(key => JSON.stringify(before[key]) === JSON.stringify(after[key]))
}
