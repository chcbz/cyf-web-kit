// Frozen review wire: never derive a batch from the newest displayed message.
export const reviewId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value)
export const reviewVersion = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key))
const oneOf = (value, values) => values.includes(value)
const fail = () => { throw new Error('成果数据未通过核对，请重新读取；未提交验收。') }
export const freezeReviewValue = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeReviewValue); Object.freeze(value) }
  return value
}
const clone = value => JSON.parse(JSON.stringify(value))
const validSource = source => {
  if (!source || typeof source !== 'object') return false
  if (source.kind === 'COMPLETED_MESSAGE') {
    const m = source.messageSource
    return exact(source, ['kind', 'requestId', 'messageSource']) && reviewId(source.requestId) &&
      exact(m, ['turnId', 'messageId', 'snapshotId', 'finalSha256']) && reviewId(m.turnId) && reviewId(m.snapshotId) &&
      reviewVersion(m.messageId) && m.messageId !== '0' && hash(m.finalSha256)
  }
  if (source.kind === 'CONVERSATION_OUTPUT') return exact(source, ['kind', 'requestId', 'stepId', 'outputId']) && [source.requestId, source.stepId, source.outputId].every(reviewId)
  if (source.kind === 'WORKSPACE_FILE') return exact(source, ['kind', 'fileId', 'version']) && reviewId(source.fileId) && reviewVersion(source.version) && source.version !== '0'
  return source.kind === 'FORMAL_ARTIFACT' && exact(source, ['kind', 'sourceDeliveryId', 'sourceArtifactId', 'sourceArtifactVersion']) &&
    reviewId(source.sourceDeliveryId) && reviewId(source.sourceArtifactId) && reviewVersion(source.sourceArtifactVersion) && source.sourceArtifactVersion !== '0'
}
const taskStates = ['OPEN', 'PLANNING', 'ASSIGNED', 'RUNNING', 'BLOCKED', 'REVIEWING', 'COMPLETED', 'FAILED', 'CANCELLED', 'ARCHIVED']
const validBatch = batch => exact(batch, ['deliveryId', 'deliveryVersion', 'state', 'batchSha256', 'summary', 'submittedAt', 'items', 'allowedActions']) &&
  reviewId(batch.deliveryId) && reviewVersion(batch.deliveryVersion) && oneOf(batch.state, ['SUBMITTED', 'ACCEPTED', 'CHANGES_REQUESTED']) && hash(batch.batchSha256) &&
  typeof batch.summary === 'string' && Number.isSafeInteger(batch.submittedAt) && batch.submittedAt >= 0 && Array.isArray(batch.items) && batch.items.length > 0 && batch.items.length <= 100 &&
  batch.items.every(item => exact(item, ['artifactId', 'artifactVersion', 'contentHash', 'purpose', 'displayRole', 'source', 'unavailableReason']) &&
    reviewId(item.artifactId) && reviewVersion(item.artifactVersion) && item.artifactVersion !== '0' && BigInt(item.artifactVersion) <= 2147483647n && hash(item.contentHash) &&
    typeof item.purpose === 'string' && item.purpose.length > 0 && oneOf(item.displayRole, ['RESULT', 'MANIFEST']) &&
    (item.source === null || validSource(item.source)) &&
    (item.displayRole === 'RESULT' && item.source === null ? item.unavailableReason === 'SOURCE_UNAVAILABLE' : item.unavailableReason === null)) &&
  new Set(batch.items.map(i => JSON.stringify([i.artifactId, i.artifactVersion]))).size === batch.items.length &&
  Array.isArray(batch.allowedActions) && new Set(batch.allowedActions).size === batch.allowedActions.length &&
  batch.allowedActions.every(a => oneOf(a, ['VIEW', 'ACCEPT', 'REQUEST_CHANGES', 'CHECK_OPERATION']))
export function validateContext (raw, taskId) {
  if (!exact(raw, ['schemaVersion', 'taskId', 'taskVersion', 'taskState', 'assignmentRevision', 'currentDelivery', 'history', 'pendingOperation']) ||
    raw.schemaVersion !== 1 || !reviewId(taskId) || raw.taskId !== taskId || !reviewVersion(raw.taskVersion) || !reviewVersion(raw.assignmentRevision) ||
    !taskStates.includes(raw.taskState) || (raw.currentDelivery !== null && !validBatch(raw.currentDelivery)) || !Array.isArray(raw.history) ||
    raw.history.length > 100 || !raw.history.every(validBatch)) fail()
  const batches = [...raw.history, ...(raw.currentDelivery ? [raw.currentDelivery] : [])]
  if (new Set(batches.map(b => b.deliveryId)).size !== batches.length) fail()
  const pending = raw.pendingOperation
  if (pending !== null && (!exact(pending, ['operationId', 'kind', 'state', 'stateVersion', 'errorCode', 'retryable']) || !reviewId(pending.operationId) ||
    !reviewVersion(pending.stateVersion) || pending.stateVersion === '0' || typeof pending.retryable !== 'boolean' ||
    !(pending.kind === 'REVIEW' ? oneOf(pending.state, ['PROCESSING', 'COMMITTED', 'REJECTED']) : pending.kind === 'SUBMISSION' && oneOf(pending.state, ['PENDING', 'COMPLETED', 'FAILED'])) ||
    !(pending.errorCode === null || typeof pending.errorCode === 'string'))) fail()
  for (const batch of batches) {
    if ((batch !== raw.currentDelivery || raw.taskState !== 'REVIEWING' || batch.state !== 'SUBMITTED' || pending !== null ||
      batch.items.some(item => item.unavailableReason) || !batch.items.some(item => item.displayRole === 'RESULT')) &&
      batch.allowedActions.some(a => ['ACCEPT', 'REQUEST_CHANGES'].includes(a))) fail()
  }
  if (raw.taskState === 'REVIEWING' && raw.currentDelivery?.state !== 'SUBMITTED') fail()
  return freezeReviewValue(clone(raw))
}
const bytesCompare = (a, b) => {
  const x = new TextEncoder().encode(a); const y = new TextEncoder().encode(b)
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i]
  return x.length - y.length
}
export async function batchDigest (taskId, batch) {
  if (!reviewId(taskId) || !validBatch(batch)) fail()
  const sorted = [...batch.items].sort((a, b) => bytesCompare(a.artifactId, b.artifactId) || (BigInt(a.artifactVersion) < BigInt(b.artifactVersion) ? -1 : BigInt(a.artifactVersion) > BigInt(b.artifactVersion) ? 1 : 0))
  const bytes = new TextEncoder().encode(JSON.stringify(['hall-delivery-batch-v1', taskId, batch.deliveryId, batch.deliveryVersion,
    sorted.map(item => [item.artifactId, item.artifactVersion, item.contentHash, item.purpose])]))
  return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')
}
export function reviewBody (context) {
  const c = validateContext(context, context.taskId); const b = c.currentDelivery
  if (!b?.allowedActions.includes('ACCEPT')) fail()
  return freezeReviewValue({ schemaVersion: 1, deliveryId: b.deliveryId, expectedTaskVersion: c.taskVersion,
    expectedDeliveryVersion: b.deliveryVersion, expectedAssignmentRevision: c.assignmentRevision, batchSha256: b.batchSha256,
    decision: 'ACCEPT', conversationId: null, conversationGeneration: null, instruction: null, sourceSelectors: [] })
}
const bodyFields = ['schemaVersion', 'deliveryId', 'expectedTaskVersion', 'expectedDeliveryVersion', 'expectedAssignmentRevision', 'batchSha256', 'decision', 'conversationId', 'conversationGeneration', 'instruction', 'sourceSelectors']
export function validReviewBody (body) {
  return exact(body, bodyFields) && body.schemaVersion === 1 && reviewId(body.deliveryId) &&
    [body.expectedTaskVersion, body.expectedDeliveryVersion, body.expectedAssignmentRevision].every(reviewVersion) && hash(body.batchSha256) && body.decision === 'ACCEPT' &&
    body.conversationId === null && body.conversationGeneration === null && body.instruction === null && Array.isArray(body.sourceSelectors) && body.sourceSelectors.length === 0
}
const intentFields = ['scopeFingerprint', 'taskId', 'key', 'body', 'operationId', 'receiptVersion']
export function validReviewIntent (intent, scope, task) {
  return exact(intent, intentFields) && intent.scopeFingerprint === scope && intent.taskId === task && reviewId(task) &&
    typeof intent.key === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(intent.key) && validReviewBody(intent.body) &&
    (intent.operationId === null || reviewId(intent.operationId)) && reviewVersion(intent.receiptVersion)
}
export function freezeReviewIntent (context, scope, key) {
  const intent = { scopeFingerprint: scope, taskId: context.taskId, key, body: reviewBody(context), operationId: null, receiptVersion: '0' }
  if (!validReviewIntent(intent, scope, context.taskId)) fail()
  return freezeReviewValue(intent)
}
const receiptFields = ['schemaVersion', 'operationId', 'taskId', 'deliveryId', 'decision', 'state', 'stateVersion', 'taskState', 'taskVersion', 'deliveryState', 'deliveryVersion', 'requestId', 'sourceRequestId', 'conversationId', 'errorCode', 'retryable']
export function validateReceipt (raw, intent, previous = null) {
  if (!exact(raw, receiptFields) || raw.schemaVersion !== 1 || !reviewId(raw.operationId) || raw.taskId !== intent.taskId || raw.deliveryId !== intent.body.deliveryId ||
    raw.decision !== 'ACCEPT' || !oneOf(raw.state, ['PROCESSING', 'COMMITTED', 'REJECTED']) || !reviewVersion(raw.stateVersion) || raw.stateVersion === '0' ||
    BigInt(raw.stateVersion) < BigInt(intent.receiptVersion) || (intent.operationId !== null && raw.operationId !== intent.operationId) ||
    !taskStates.includes(raw.taskState) || !reviewVersion(raw.taskVersion) || !reviewVersion(raw.deliveryVersion) ||
    !oneOf(raw.deliveryState, ['SUBMITTED', 'ACCEPTED', 'CHANGES_REQUESTED']) || raw.requestId !== null || raw.sourceRequestId !== null || raw.conversationId !== null ||
    typeof raw.retryable !== 'boolean' || (raw.state === 'REJECTED' ? typeof raw.errorCode !== 'string' || !raw.errorCode : raw.errorCode !== null) ||
    (raw.state === 'COMMITTED' && (raw.taskState !== 'COMPLETED' || raw.deliveryState !== 'ACCEPTED' || raw.retryable ||
      BigInt(raw.taskVersion) <= BigInt(intent.body.expectedTaskVersion) || BigInt(raw.deliveryVersion) <= BigInt(intent.body.expectedDeliveryVersion)))) fail()
  if (previous && (previous.operationId !== raw.operationId || BigInt(raw.stateVersion) < BigInt(previous.stateVersion) ||
    (previous.state !== 'PROCESSING' && receiptFields.some(field => previous[field] !== raw[field])) ||
    (previous.stateVersion === raw.stateVersion && receiptFields.some(field => previous[field] !== raw[field])))) fail()
  return freezeReviewValue(clone(raw))
}
