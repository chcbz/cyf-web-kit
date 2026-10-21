const LONG_MAX = '9223372036854775807'
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
// eslint-disable-next-line no-control-regex
const isoControl = value => /[\u0000-\u001f\u007f-\u009f]/u.test(value)
// Line endings belong to natural-language content, never identifiers.
export const typedLong = (value, { allowZero = false } = {}) => {
  if (typeof value !== 'string' || !(allowZero ? /^(0|[1-9][0-9]*)$/ : /^[1-9][0-9]*$/).test(value)) return ''
  return value.length < LONG_MAX.length || (value.length === LONG_MAX.length && value <= LONG_MAX) ? value : ''
}
export const typedId = value => typeof value === 'string' && value && value === value.trim() && value.length <= 100 && !isoControl(value) ? value : ''
export const exactKeys = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === fields.length && fields.every(field => own(value, field))
const freeze = value => Object.freeze(JSON.parse(JSON.stringify(value)))
// v2 tagged union. File references retain exact version/lineage; data results bind their digest.
export const sourceSelector = value => {
  if (value?.kind === 'TASK_LINKED_WORKSPACE_VERSION' && exactKeys(value, ['kind', 'fileId', 'version', 'purpose']) &&
    typedId(value.fileId) && typedLong(value.version) && BigInt(value.version) <= 2147483647n &&
    ['INPUT', 'REFERENCE'].includes(value.purpose)) return freeze(value)
  if (value?.kind === 'CURRENT_CONVERSATION_ASSET' && exactKeys(value, ['kind', 'assetId', 'assetRevision']) &&
    typedId(value.assetId) && typedLong(value.assetRevision)) return freeze(value)
  if (value?.kind === 'EXECUTION_RESULT' && exactKeys(value, ['kind', 'executionId', 'resultSha256']) &&
    typedId(value.executionId) && /^[a-f0-9]{64}$/.test(value.resultSha256)) return freeze(value)
  return null
}
// Historical metadata/proposals are audit-only. Never accept this six-key shape for new discussion writes.
export const historicalSourceSelector = value => {
  const current = sourceSelector(value)
  if (current) return current
  if (!exactKeys(value, ['kind', 'fileId', 'version', 'purpose', 'assetId', 'assetRevision'])) return null
  const candidate = value.kind === 'TASK_LINKED_WORKSPACE_VERSION' && value.assetId === null && value.assetRevision === null
    ? { kind: value.kind, fileId: value.fileId, version: value.version, purpose: value.purpose }
    : value.kind === 'CURRENT_CONVERSATION_ASSET' && value.fileId === null && value.version === null && value.purpose === null
      ? { kind: value.kind, assetId: value.assetId, assetRevision: value.assetRevision } : null
  return candidate && sourceSelector(candidate) ? freeze(value) : null
}
export const discussionBody = ({ intent, taskId, assignmentRevision, content, parentOutcomeId = null,
  expectedParentStateVersion = null, pendingQuestionId = null, expectedPendingQuestionStateVersion = null, sourceSelectors = [], materialScope = 'TASK_DEFAULT' }) => {
  if (!['DISCUSSION', 'CLARIFICATION_REPLY'].includes(intent) || !typedId(taskId) || !typedLong(assignmentRevision, { allowZero: true }) ||
    typeof content !== 'string' || content.length > 200000 || !scalar(content) ||
    !['TASK_DEFAULT', 'EXPLICIT', 'NONE'].includes(materialScope) || !Array.isArray(sourceSelectors) || sourceSelectors.length > 32 ||
    (materialScope === 'NONE' && sourceSelectors.length)) return null
  const selectors = sourceSelectors.map(sourceSelector)
  if (selectors.some(value => !value) || new Set(selectors.map(value => JSON.stringify(value))).size !== selectors.length || (!content.trim() && !selectors.length)) return null
  const body = {
    schemaVersion: 3, materialScope, intent, taskId, expectedAssignmentRevision: assignmentRevision, content,
    parentOutcomeId, expectedParentStateVersion, pendingQuestionId, expectedPendingQuestionStateVersion,
    sourceSelectors: selectors
  }
  if (intent === 'DISCUSSION') {
    if (pendingQuestionId !== null || expectedPendingQuestionStateVersion !== null ||
      (parentOutcomeId !== null && (!typedId(parentOutcomeId) || !typedLong(expectedParentStateVersion, { allowZero: true }))) ||
      (parentOutcomeId === null && expectedParentStateVersion !== null)) return null
  } else if (!typedId(parentOutcomeId) || !typedLong(expectedParentStateVersion, { allowZero: true }) ||
    !typedId(pendingQuestionId) || !typedLong(expectedPendingQuestionStateVersion, { allowZero: true })) return null
  return freeze(body)
}
const acceptedFields = ['schemaVersion', 'intent', 'requestId', 'userMessageId', 'turnIds', 'state', 'stateVersion', 'eventCursor', 'statusUrl', 'typedOutcomeUrl', 'replay', 'pendingQuestionId']
export const discussionAccepted = (value, body, conversationId) => {
  if (!exactKeys(value, acceptedFields) || value.schemaVersion !== body?.schemaVersion || value.intent !== body?.intent || !typedId(value.requestId) ||
    !typedLong(value.userMessageId) || !Array.isArray(value.turnIds) || value.turnIds.length !== 1 || !value.turnIds.every(typedId) ||
    typeof value.state !== 'string' || !value.state || !typedLong(value.stateVersion, { allowZero: true }) || !typedLong(value.eventCursor, { allowZero: true }) ||
    value.statusUrl !== `/chat/requests/${value.requestId}` || value.typedOutcomeUrl !== `/chat/conversations/${conversationId}/requests/${value.requestId}/typed-outcome` ||
    typeof value.replay !== 'boolean') return null
  if (body.intent === 'CLARIFICATION_REPLY' ? value.pendingQuestionId !== body.pendingQuestionId : value.pendingQuestionId !== null) return null
  return freeze(value)
}
const scalar = value => {
  if (typeof value !== 'string') return false
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = value.charCodeAt(++i)
      if (!(low >= 0xdc00 && low <= 0xdfff)) return false
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false
  }
  return true
}
const prose = value => scalar(value) && Boolean(value.trim()) && value.length <= 200000
const actionId = value => scalar(value) && Boolean(value.trim()) && value.length <= 512 && !isoControl(value)
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const outcomeFields = ['outcomeContractVersion', 'outcomeId', 'taskId', 'assignmentRevision', 'assistantMessageId', 'finalSha256', 'kind', 'text', 'clarification', 'proposal', 'action', 'deliverable', 'messageSource', 'deliveryRelation', 'revision']
const clarificationFields = ['pendingQuestionId', 'state', 'stateVersion', 'question', 'requiredFacts', 'replyRequestId']
const proposalFields = ['proposalId', 'state', 'stateVersion', 'operation', 'instruction', 'sourceRefIds', 'sourceSelectors', 'parent']
const projectionFields = ['schemaVersion', 'route', 'conversationId', 'conversationGeneration', 'requestId', 'requestRevision', 'turnId', 'state', 'outcome', 'inspection', 'actionProgress', 'submissionProgress', 'reviewProgress']
const progressFields = ['actionRequestId', 'state', 'dispatchVersion', 'childRequestId', 'childRoute', 'childStateVersion', 'executionId', 'executionStateVersion', 'phase', 'resultSha256']
const phaseStates = { READY: 'RUNNING', RUNNING: 'RUNNING', RESULT_READY: 'RUNNING', WAITING_PROVIDER: 'WAITING_PROVIDER', RESULT_UNKNOWN: 'RESULT_UNKNOWN', ARCHIVING: 'ARCHIVING', COMPLETE: 'COMPLETED', FAILED: 'FAILED', CANCELLED: 'CANCELLED' }
const validOutcome = value => {
  if (!exactKeys(value, outcomeFields) || ![1, 2, 3, 4, 5].includes(value.outcomeContractVersion) || !typedId(value.outcomeId) || !typedId(value.taskId) ||
    !typedLong(value.assignmentRevision, { allowZero: true }) || !typedLong(value.assistantMessageId) || !digest(value.finalSha256) || !prose(value.text) ||
    (value.deliverable !== null && typeof value.deliverable !== 'boolean')) return false
  if (value.deliverable === true) {
    const m = value.messageSource
    if (value.kind !== 'ANSWER' || !exactKeys(m, ['turnId', 'messageId', 'snapshotId', 'finalSha256']) ||
      !typedId(m.turnId) || !typedId(m.snapshotId) || m.messageId !== value.assistantMessageId || m.finalSha256 !== value.finalSha256) return false
  } else if (value.messageSource !== null) return false
  const r = value.deliveryRelation
  if (r !== null) {
    if ((value.deliverable !== true && !['ACTION_REQUEST', 'SUBMISSION_REQUEST'].includes(value.kind)) || !exactKeys(r, ['mode', 'parentOutcomeId', 'parentFinalSha256', 'targetOutcomeId', 'targetFinalSha256']) ||
      !['APPEND', 'REPLACE', 'RESET', 'SUBMIT'].includes(r.mode) || !typedId(r.parentOutcomeId) || !digest(r.parentFinalSha256) || r.parentOutcomeId === value.outcomeId) return false
    if (r.targetOutcomeId === null ? r.targetFinalSha256 !== null :
      (r.mode !== 'REPLACE' || !typedId(r.targetOutcomeId) || !digest(r.targetFinalSha256) || r.targetOutcomeId === value.outcomeId)) return false
    if (value.kind === 'ACTION_REQUEST' && (!['APPEND', 'RESET'].includes(r.mode) || r.targetOutcomeId !== null)) return false
  }
  if (r?.mode === 'SUBMIT' && value.kind !== 'SUBMISSION_REQUEST') return false
  if (value.kind === 'SUBMISSION_REQUEST') return value.outcomeContractVersion === 5 && value.deliverable === false &&
    value.clarification === null && value.proposal === null && value.action === null && value.revision === null &&
    r?.mode === 'SUBMIT' && r.targetOutcomeId === null
  const revision = value.revision
  if (value.kind === 'REVISION_REQUEST') return value.outcomeContractVersion === 5 && value.deliverable === false &&
    value.deliveryRelation === null && value.clarification === null && value.proposal === null && value.action === null &&
    exactKeys(revision, ['instruction', 'targetArtifactIds']) && prose(revision.instruction) &&
    Array.isArray(revision.targetArtifactIds) && revision.targetArtifactIds.length > 0 && revision.targetArtifactIds.every(typedId) &&
    new Set(revision.targetArtifactIds).size === revision.targetArtifactIds.length
  if (revision !== null) return false
  if (value.outcomeContractVersion === 5 && typeof value.deliverable !== 'boolean') return false
  const c = value.clarification; const p = value.proposal; const a = value.action
  if (value.kind === 'ANSWER') return c === null && p === null && a === null
  if (value.kind === 'CLARIFY') return p === null && a === null && exactKeys(c, clarificationFields) && typedId(c.pendingQuestionId) && prose(c.question) &&
    Array.isArray(c.requiredFacts) && c.requiredFacts.length > 0 && new Set(c.requiredFacts).size === c.requiredFacts.length &&
    c.requiredFacts.every(value.outcomeContractVersion <= 2 ? item => ['SOURCE_SELECTION', 'REFERENCE_REQUIRED', 'REQUIREMENT_DETAILS', 'OPERATION_CHOICE'].includes(item) : prose) &&
    ((c.state === 'OPEN' && c.stateVersion === '0' && c.replyRequestId === null) || (c.state === 'ANSWERED' && c.stateVersion === '1' && typedId(c.replyRequestId)))
  if (value.kind === 'EXECUTION_PROPOSAL') return value.outcomeContractVersion <= 2 && c === null && a === null && exactKeys(p, proposalFields) &&
    typedId(p.proposalId) && p.state === 'PROPOSED' && p.stateVersion === '0' && prose(p.instruction) && Array.isArray(p.sourceRefIds) && p.sourceRefIds.every(typedId) &&
    new Set(p.sourceRefIds).size === p.sourceRefIds.length && Array.isArray(p.sourceSelectors) && p.sourceSelectors.length === p.sourceRefIds.length && p.sourceSelectors.every(historicalSourceSelector) &&
    ((p.operation === 'GENERATE_IMAGE' && p.parent === null) || (p.operation === 'EDIT_IMAGE' && p.sourceSelectors.length === 1 && p.sourceSelectors[0].kind === 'CURRENT_CONVERSATION_ASSET' &&
      exactKeys(p.parent, ['requestId', 'stepId']) && typedId(p.parent.requestId) && typedId(p.parent.stepId)))
  if (value.kind !== 'ACTION_REQUEST' || ![3, 4, 5].includes(value.outcomeContractVersion) || c !== null || p !== null ||
    !exactKeys(a, ['actionRequestId', 'actionId', 'instruction', 'sourceRefIds', 'parameters']) || !typedId(a.actionRequestId) || !actionId(a.actionId) || !prose(a.instruction) ||
    !Array.isArray(a.sourceRefIds) || a.sourceRefIds.length > 32 || !a.sourceRefIds.every(actionId) || new Set(a.sourceRefIds).size !== a.sourceRefIds.length) return false
  return value.outcomeContractVersion === 3 ? a.parameters === null : a.parameters !== null && typeof a.parameters === 'object' && !Array.isArray(a.parameters)
}
const validInspection = (value, state) => {
  if (!exactKeys(value, ['authorizationId', 'manifestSha256', 'sourceRefIds', 'inputSummary']) || !typedId(value.authorizationId) || !digest(value.manifestSha256) ||
    !Array.isArray(value.sourceRefIds) || !value.sourceRefIds.length || value.sourceRefIds.length > 32 || !value.sourceRefIds.every(actionId) || new Set(value.sourceRefIds).size !== value.sourceRefIds.length) return false
  if (state === 'PENDING') return value.inputSummary === null
  const summary = value.inputSummary
  return exactKeys(summary, ['inputSha256', 'sources']) && digest(summary.inputSha256) && Array.isArray(summary.sources) && summary.sources.length === value.sourceRefIds.length &&
    summary.sources.every((s, index) => exactKeys(s, ['sourceRefId', 'sha256', 'byteLength', 'carrier', 'contributionSha256']) && s.sourceRefId === value.sourceRefIds[index] &&
      digest(s.sha256) && typedLong(s.byteLength, { allowZero: true }) && ['DIRECT_TEXT', 'LOCAL_IMAGE', 'LOCAL_AUDIO', 'PARSED_TEXT'].includes(s.carrier) && digest(s.contributionSha256))
}
const validProgress = (p, outcome) => {
  if (outcome.kind !== 'ACTION_REQUEST') return p === null
  if (!exactKeys(p, progressFields) || p.actionRequestId !== outcome.action.actionRequestId || !typedLong(p.dispatchVersion, { allowZero: true })) return false
  if (p.childRequestId === null) return ['QUEUED', 'FAILED'].includes(p.state) && ['childRoute', 'childStateVersion', 'executionId', 'executionStateVersion', 'phase', 'resultSha256'].every(key => p[key] === null)
  if (!typedId(p.childRequestId) || !typedLong(p.childStateVersion, { allowZero: true })) return false
  if (outcome.outcomeContractVersion === 3) return ['INSPECT', 'EXECUTE'].includes(p.childRoute) && ['RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'].includes(p.state) &&
    ['executionId', 'executionStateVersion', 'phase', 'resultSha256'].every(key => p[key] === null)
  return p.childRoute === 'EXECUTE' && typedId(p.executionId) && typedLong(p.executionStateVersion, { allowZero: true }) && Object.hasOwn(phaseStates, p.phase) && phaseStates[p.phase] === p.state &&
    (p.resultSha256 === null || digest(p.resultSha256)) && (p.phase !== 'COMPLETE' || digest(p.resultSha256))
}
// Independent monotonic counters: a skill phase can advance without changing the child aggregate.
export const actionProgressAdvances = (before, after) => {
  if (before == null) return true
  if (!after || before.actionRequestId !== after.actionRequestId) return false
  for (const key of ['dispatchVersion', 'childStateVersion', 'executionStateVersion']) {
    if (before[key] !== null && (after[key] === null || BigInt(after[key]) < BigInt(before[key]))) return false
  }
  if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(before.state) && before.state !== after.state) return false
  if (before.childRequestId !== null && (before.childRequestId !== after.childRequestId || before.childRoute !== after.childRoute)) return false
  if (before.executionId !== null && before.executionId !== after.executionId) return false
  if (before.resultSha256 !== null && before.resultSha256 !== after.resultSha256) return false
  if (before.executionStateVersion !== null && before.executionStateVersion === after.executionStateVersion &&
    (before.phase !== after.phase || before.resultSha256 !== after.resultSha256)) return false
  if (['dispatchVersion', 'childStateVersion', 'executionStateVersion'].every(key => before[key] === after[key]) && progressFields.some(key => before[key] !== after[key])) return false
  return true
}
const submissionFields = ['eventId', 'operationId', 'state', 'dispatchVersion', 'operationStateVersion', 'deliveryId', 'errorCode', 'retryable']
const submissionErrors = ['DELIVERY_SOURCE_UNAVAILABLE', 'DELIVERY_REVIEW_REQUIRED', 'DELIVERY_TASK_CHANGED', 'DELIVERY_ASSIGNMENT_CHANGED', 'DELIVERY_CONVERSATION_CHANGED', 'DELIVERY_OPERATION_CONFLICT', 'DELIVERY_SUBMISSION_REJECTED']
const validSubmission = (p, outcome, route) => {
  if (p === null) return true
  if (route !== 'CHAT' || !((outcome?.kind === 'ANSWER' && outcome.deliverable === true) || (outcome?.kind === 'SUBMISSION_REQUEST' && outcome.deliverable === false)) || !exactKeys(p, submissionFields) ||
    typeof p.eventId !== 'string' || !/^delivery-submit-[a-f0-9]{48}$/.test(p.eventId) || !typedLong(p.dispatchVersion, { allowZero: true }) || typeof p.retryable !== 'boolean') return false
  if (p.operationId === null ? p.operationStateVersion !== null : !typedId(p.operationId) || !typedLong(p.operationStateVersion)) return false
  if (p.state === 'COMPLETED') return p.operationId !== null && typedId(p.deliveryId) && p.errorCode === null && p.retryable === false
  if (p.deliveryId !== null) return false
  if (p.state === 'FAILED') return submissionErrors.includes(p.errorCode) && p.retryable === false
  return p.state === 'PENDING' && p.errorCode === null && (!p.retryable || p.operationId !== null)
}
export const submissionProgressAdvances = (before, after) => {
  if (before == null) return true
  if (!after || before.eventId !== after.eventId || BigInt(after.dispatchVersion) < BigInt(before.dispatchVersion)) return false
  if (before.operationId !== null && (before.operationId !== after.operationId || after.operationStateVersion === null || BigInt(after.operationStateVersion) < BigInt(before.operationStateVersion))) return false
  if (before.deliveryId !== null && before.deliveryId !== after.deliveryId) return false
  if (['COMPLETED', 'FAILED'].includes(before.state) && (before.state !== after.state || before.errorCode !== after.errorCode || before.retryable !== after.retryable)) return false
  return before.dispatchVersion !== after.dispatchVersion || before.operationStateVersion !== after.operationStateVersion || submissionFields.every(key => before[key] === after[key])
}
const reviewFields = ['operationId', 'state', 'stateVersion', 'sourceRequestId', 'childRequestId', 'childState', 'childStateVersion']
const childStates = ['RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'PARTIAL', 'UNKNOWN', 'RECOVERY_REQUIRED', 'FINAL_PERSISTED', 'PUBLISHED', 'RESULT_COMMITTED', 'OUTPUT_COMMITTED']
const validReview = (p, value) => {
  if (value.outcome?.kind !== 'REVISION_REQUEST') return p === null
  if (value.route !== 'CHAT' || !exactKeys(p, reviewFields) || p.sourceRequestId !== value.requestId || !typedLong(p.stateVersion, { allowZero: true })) return false
  const noChild = p.childRequestId === null && p.childState === null && p.childStateVersion === null
  if (p.state === 'QUEUED') return p.operationId === null && p.stateVersion === '0' && noChild
  if (!typedId(p.operationId) || BigInt(p.stateVersion) < 2n) return false
  if (p.state === 'REJECTED') return noChild
  return p.state === 'COMMITTED' && typedId(p.childRequestId) && p.childRequestId !== value.requestId &&
    childStates.includes(p.childState) && typedLong(p.childStateVersion, { allowZero: true })
}
export const reviewProgressAdvances = (before, after) => {
  if (before == null) return true
  if (!after || before.sourceRequestId !== after.sourceRequestId || BigInt(after.stateVersion) < BigInt(before.stateVersion)) return false
  if (before.operationId !== null && before.operationId !== after.operationId) return false
  if (before.state !== 'QUEUED' && before.state !== after.state) return false
  if (before.childRequestId !== null && (before.childRequestId !== after.childRequestId || after.childStateVersion === null || BigInt(after.childStateVersion) < BigInt(before.childStateVersion))) return false
  if (before.childStateVersion !== null && before.childStateVersion === after.childStateVersion && before.childState !== after.childState) return false
  if (['COMPLETED', 'FAILED', 'CANCELLED', 'RESULT_COMMITTED', 'OUTPUT_COMMITTED'].includes(before.childState) && before.childState !== after.childState) return false
  return true
}
export const actionOutcomeProjection = (value, context = {}, route = 'CHAT') => {
  if (!exactKeys(value, projectionFields) || value.schemaVersion !== 6 || value.route !== route || !['CHAT', 'INSPECT'].includes(route) ||
    !typedId(value.conversationId) || !typedLong(value.conversationGeneration) || !typedId(value.requestId) || !typedLong(value.requestRevision) || !typedId(value.turnId) || !['PENDING', 'READY'].includes(value.state)) return null
  for (const key of ['conversationId', 'conversationGeneration', 'requestId', 'requestRevision', 'turnId']) if (context[key] && value[key] !== context[key]) return null
  if (value.inspection !== null ? !validInspection(value.inspection, value.state) : route === 'INSPECT') return null
  if (value.state === 'PENDING') return value.outcome === null && value.actionProgress === null && value.submissionProgress === null && value.reviewProgress === null ? freeze({ ...value, purpose: route }) : null
  if (!validOutcome(value.outcome) || (context.taskId && value.outcome.taskId !== context.taskId) ||
    (context.assignmentRevision && value.outcome.assignmentRevision !== context.assignmentRevision) ||
    ([4, 5].includes(value.outcome.outcomeContractVersion) && route !== 'CHAT') || (!validProgress(value.actionProgress, value.outcome) || !validSubmission(value.submissionProgress, value.outcome, route) || !validReview(value.reviewProgress, value))) return null
  if (value.outcome.deliverable === true && (route !== 'CHAT' || value.outcome.messageSource.turnId !== value.turnId)) return null
  return freeze({ ...value, purpose: route })
}
export const typedOutcomeProjection = (value, context = {}) => actionOutcomeProjection(value, context, 'CHAT')
export const inspectionOutcomeProjection = (value, context = {}) => actionOutcomeProjection(value, context, 'INSPECT')
export const outcomeCardKey = value => `${value.requestId}\u0000${value.turnId}\u0000${value.outcome?.outcomeId || ''}`

// Uses validated read projections only; no new timer or business write is introduced.
export const revisionProgressPending = value => {
  const projection = typedOutcomeProjection(value)
  const progress = projection?.reviewProgress
  return progress?.state === 'QUEUED' || (progress?.state === 'COMMITTED' &&
    !['COMPLETED', 'FAILED', 'CANCELLED', 'PARTIAL'].includes(progress.childState))
}
export const revisionProgressHint = progress => {
  if (progress?.state === 'QUEUED') return '正在核对本轮成果与修改要求，尚未开始修改。'
  if (progress?.state === 'REJECTED') return '本次修改未受理，请核对当前成果后在原议事继续说明。'
  if (progress?.state !== 'COMMITTED') return ''
  if (['FAILED', 'CANCELLED', 'PARTIAL'].includes(progress.childState)) return '本次修改未完成，上一版仍保留；可以在原议事继续说明。'
  if (progress.childState === 'COMPLETED') return '本轮回复已完成，请查看后续答复；成果提交与验收状态以当前成果为准。'
  return '已受理修改，正在原议事继续处理；上一版仍保留。'
}
