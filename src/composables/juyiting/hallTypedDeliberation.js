const LONG_MAX = '9223372036854775807'
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
// eslint-disable-next-line no-control-regex
const isoControl = value => /[\u0000-\u001f\u007f-\u009f]/u.test(value)
// Line endings belong to natural-language content, never identifiers.
// eslint-disable-next-line no-control-regex
const forbiddenContentControl = value => /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value)
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
  if (value?.kind === 'EXECUTION_RESULT' && exactKeys(value, ['kind', 'executionId', 'resultDigest']) &&
    typedId(value.executionId) && /^[a-f0-9]{64}$/.test(value.resultDigest)) return freeze(value)
  return null
}
export const discussionBody = ({ intent, taskId, assignmentRevision, content, parentOutcomeId = null,
  expectedParentStateVersion = null, pendingQuestionId = null, expectedPendingQuestionStateVersion = null, sourceSelectors = [], materialScope = 'TASK_DEFAULT' }) => {
  if (!['DISCUSSION', 'CLARIFICATION_REPLY'].includes(intent) || !typedId(taskId) || !typedLong(assignmentRevision, { allowZero: true }) ||
    typeof content !== 'string' || Array.from(content).length > 4000 || (forbiddenContentControl(content) && Boolean(content.trim())) ||
    !['TASK_DEFAULT', 'EXPLICIT', 'NONE'].includes(materialScope) || !Array.isArray(sourceSelectors) || sourceSelectors.length > 32 ||
    (materialScope === 'NONE' && sourceSelectors.length)) return null
  const selectors = sourceSelectors.map(sourceSelector)
  if (selectors.some(value => !value) || new Set(selectors.map(value => JSON.stringify(value))).size !== selectors.length || (!content.trim() && !selectors.length)) return null
  const body = {
    schemaVersion: 2, materialScope, intent, taskId, expectedAssignmentRevision: assignmentRevision, content,
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
const outcomeFields = ['outcomeId', 'taskId', 'assignmentRevision', 'assistantMessageId', 'finalDigest', 'kind', 'text', 'clarification', 'proposal']
const clarificationFields = ['pendingQuestionId', 'state', 'stateVersion', 'question', 'requiredFacts', 'replyRequestId']
const proposalFields = ['proposalId', 'state', 'stateVersion', 'operation', 'instruction', 'sourceRefIds', 'sourceSelectors', 'parent']
const parentFields = ['requestId', 'stepId']
const validText = value => typeof value === 'string' && value.trim() && Array.from(value).length <= 4000 && !isoControl(value)
const outcome = value => {
  if (!exactKeys(value, outcomeFields) || !typedId(value.outcomeId) || !typedId(value.taskId) || !typedLong(value.assignmentRevision, { allowZero: true }) ||
    !typedLong(value.assistantMessageId) || typeof value.finalDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value.finalDigest) || !validText(value.text)) return null
  if (value.kind === 'ANSWER' && value.clarification === null && value.proposal === null) return freeze(value)
  if (value.kind === 'CLARIFY' && value.proposal === null && exactKeys(value.clarification, clarificationFields) && typedId(value.clarification.pendingQuestionId) &&
    ['OPEN', 'ANSWERED'].includes(value.clarification.state) && typedLong(value.clarification.stateVersion, { allowZero: true }) && validText(value.clarification.question) &&
    Array.isArray(value.clarification.requiredFacts) && value.clarification.requiredFacts.length && value.clarification.requiredFacts.every(item => ['SOURCE_SELECTION', 'REFERENCE_REQUIRED', 'REQUIREMENT_DETAILS', 'OPERATION_CHOICE'].includes(item)) &&
    new Set(value.clarification.requiredFacts).size === value.clarification.requiredFacts.length &&
    (value.clarification.replyRequestId === null || typedId(value.clarification.replyRequestId))) return freeze(value)
  if (value.kind === 'EXECUTION_PROPOSAL' && value.clarification === null && exactKeys(value.proposal, proposalFields) && typedId(value.proposal.proposalId) &&
    value.proposal.state === 'PROPOSED' && value.proposal.stateVersion === '0' && ['GENERATE_IMAGE', 'EDIT_IMAGE'].includes(value.proposal.operation) &&
    validText(value.proposal.instruction) && Array.isArray(value.proposal.sourceRefIds) && value.proposal.sourceRefIds.every(typedId) &&
    new Set(value.proposal.sourceRefIds).size === value.proposal.sourceRefIds.length && Array.isArray(value.proposal.sourceSelectors) &&
    value.proposal.sourceSelectors.length === value.proposal.sourceRefIds.length && value.proposal.sourceSelectors.map(sourceSelector).every(Boolean) &&
    (value.proposal.parent === null || (exactKeys(value.proposal.parent, parentFields) && typedId(value.proposal.parent.requestId) && typedId(value.proposal.parent.stepId)))) {
    if ((value.proposal.operation === 'GENERATE_IMAGE' && value.proposal.parent === null) ||
      (value.proposal.operation === 'EDIT_IMAGE' && value.proposal.sourceSelectors.length === 1 && value.proposal.sourceSelectors[0].kind === 'CURRENT_CONVERSATION_ASSET' && value.proposal.parent)) return freeze(value)
  }
  return null
}
const projectionFields = ['schemaVersion', 'conversationId', 'conversationGeneration', 'requestId', 'requestRevision', 'turnId', 'state', 'outcome']
export const typedOutcomeProjection = (value, context = {}) => {
  if ([3, 4].includes(value?.schemaVersion)) return actionOutcomeProjection(value, context, 'CHAT')
  if (!exactKeys(value, projectionFields) || value.schemaVersion !== 1 || !typedId(value.conversationId) || !typedLong(value.conversationGeneration) ||
    !typedId(value.requestId) || !typedLong(value.requestRevision) || !typedId(value.turnId) || !['PENDING', 'READY'].includes(value.state)) return null
  if ((context.conversationId && value.conversationId !== context.conversationId) ||
    (context.conversationGeneration && value.conversationGeneration !== context.conversationGeneration) ||
    (context.requestId && value.requestId !== context.requestId)) return null
  if (context.taskId && value.state === 'READY' && value.outcome?.taskId !== context.taskId) return null
  if (value.state === 'PENDING' && value.outcome === null) return freeze(value)
  const normalized = outcome(value.outcome)
  if (value.state === 'READY' && normalized) return freeze({ ...value, outcome: normalized })
  return null
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
const inspectionFields = ['authorizationId', 'manifestDigest', 'sourceRefIds', 'inputSummary']
const inspectionSummaryFields = ['inputDigest', 'sources']
const inspectionReceiptSourceFields = ['sourceRefId', 'sha256', 'byteLength', 'carrier', 'contributionDigest']
const digest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value)
export const inspectionOutcomeProjection = (value, context = {}) => {
  if ([3, 4].includes(value?.schemaVersion)) return actionOutcomeProjection(value, context, 'INSPECT')
  const fields = ['schemaVersion', 'contract', 'conversationId', 'conversationGeneration', 'requestId', 'requestRevision', 'turnId', 'state', 'outcome', 'inspection']
  if (!exactKeys(value, fields) || value.schemaVersion !== 2 || value.contract !== 'juyiting-typed-inspection-v1' || !typedId(value.conversationId) || !typedLong(value.conversationGeneration) || !typedId(value.requestId) || !typedLong(value.requestRevision) || !typedId(value.turnId) || !['PENDING', 'READY'].includes(value.state) || !exactKeys(value.inspection, inspectionFields) || !typedId(value.inspection.authorizationId) || !digest(value.inspection.manifestDigest) || !Array.isArray(value.inspection.sourceRefIds) || !value.inspection.sourceRefIds.length || value.inspection.sourceRefIds.some(item => !typedId(item)) || new Set(value.inspection.sourceRefIds).size !== value.inspection.sourceRefIds.length) return null
  if ((context.conversationId && value.conversationId !== context.conversationId) || (context.conversationGeneration && value.conversationGeneration !== context.conversationGeneration) || (context.requestId && value.requestId !== context.requestId)) return null
  if (value.state === 'PENDING') return value.outcome === null && value.inspection.inputSummary === null ? freeze({ ...value, purpose: 'INSPECT' }) : null
  if (context.taskId && value.outcome?.taskId !== context.taskId) return null
  if (!exactKeys(value.inspection.inputSummary, inspectionSummaryFields) || !digest(value.inspection.inputSummary.inputDigest) || !Array.isArray(value.inspection.inputSummary.sources) || value.inspection.inputSummary.sources.length !== value.inspection.sourceRefIds.length || value.inspection.inputSummary.sources.some((source, index) => !exactKeys(source, inspectionReceiptSourceFields) || source.sourceRefId !== value.inspection.sourceRefIds[index] || !/^[a-f0-9]{64}$/.test(source.sha256) || !typedLong(source.byteLength, { allowZero: true }) || !['DIRECT_TEXT', 'LOCAL_IMAGE', 'LOCAL_AUDIO', 'PARSED_TEXT'].includes(source.carrier) || !digest(source.contributionDigest))) return null
  const normalized = outcome(value.outcome)
  return normalized ? freeze({ ...value, outcome: normalized, purpose: 'INSPECT' }) : null
}
export const inspectionAccepted = (value, body, conversationId) => {
  const accepted = discussionAccepted({ ...value, typedOutcomeUrl: `/chat/conversations/${conversationId}/requests/${value?.requestId || ''}/typed-outcome` }, body, conversationId)
  if (!accepted || value.typedOutcomeUrl !== `/chat/conversations/${conversationId}/requests/${value.requestId}/inspection-outcome`) return null
  return freeze(value)
}
export const outcomeCardKey = value => `${value.requestId}\u0000${value.turnId}\u0000${value.outcome?.outcomeId || ''}`

// Ordinary action-v4 outcomes are display data. Hydration must never trigger a tool or a payment request.
const actionProjectionFields = [...projectionFields, 'route', 'inspection', 'actionProgress']
const actionOutcomeFields = ['outcomeContractVersion', 'outcomeId', 'taskId', 'assignmentRevision', 'assistantMessageId', 'finalDigest', 'kind', 'text', 'clarification', 'action']
const actionFields = ['actionRequestId', 'actionId', 'instruction', 'sourceRefIds']
const prose = value => {
  if (typeof value !== 'string' || !value.trim()) return false
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = value.charCodeAt(++i)
      if (!(low >= 0xdc00 && low <= 0xdfff)) return false
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false
  }
  return true
}
const actionId = value => prose(value) && value.length <= 512 && !isoControl(value)
const actionOutcome = (value, version) => {
  const marked = own(value || {}, 'deliverable')
  const relation = own(value || {}, 'deliveryRelation')
  const fields = marked ? [...actionOutcomeFields, 'deliverable', ...(value.deliverable === true ? ['messageSource'] : [])] : actionOutcomeFields
  if (!exactKeys(value, [...fields, ...(relation ? ['deliveryRelation'] : [])]) || (marked && typeof value.deliverable !== 'boolean') || value.outcomeContractVersion !== version || !typedId(value.outcomeId) ||
    !typedId(value.taskId) || !typedLong(value.assignmentRevision, { allowZero: true }) || !typedLong(value.assistantMessageId) ||
    !digest(value.finalDigest) || !prose(value.text) || value.text.length > 200000) return null
  if (value.deliverable === true) {
    const source = value.messageSource
    if (value.kind !== 'ANSWER' || !exactKeys(source, ['turnId', 'messageId', 'snapshotId', 'finalDigest']) ||
      !typedId(source.turnId) || !typedId(source.snapshotId) || source.messageId !== value.assistantMessageId || source.finalDigest !== value.finalDigest) return null
  }
  const targeted = relation && (own(value.deliveryRelation || {}, 'targetOutcomeId') || own(value.deliveryRelation || {}, 'targetFinalDigest'))
  if (relation && ((value.deliverable !== true && value.kind !== 'ACTION_REQUEST') || !exactKeys(value.deliveryRelation, ['mode', 'parentOutcomeId', 'parentFinalDigest', ...(targeted ? ['targetOutcomeId', 'targetFinalDigest'] : [])]) ||
    !['APPEND', 'REPLACE', 'RESET'].includes(value.deliveryRelation.mode) || !typedId(value.deliveryRelation.parentOutcomeId) ||
    !digest(value.deliveryRelation.parentFinalDigest) || value.deliveryRelation.parentOutcomeId === value.outcomeId)) return null
  if (targeted && (value.deliveryRelation.mode !== 'REPLACE' || !typedId(value.deliveryRelation.targetOutcomeId) ||
    !digest(value.deliveryRelation.targetFinalDigest) || value.deliveryRelation.targetOutcomeId === value.outcomeId)) return null
  if (relation && value.kind === 'ACTION_REQUEST' && (targeted || !['APPEND', 'RESET'].includes(value.deliveryRelation.mode))) return null
  if (value.kind === 'ANSWER' && value.clarification === null && value.action === null) return freeze(value)
  const c = value.clarification
  if (value.kind === 'CLARIFY' && value.action === null && exactKeys(c, clarificationFields) && typedId(c.pendingQuestionId) &&
    prose(c.question) && Array.isArray(c.requiredFacts) && c.requiredFacts.length && c.requiredFacts.every(prose) &&
    new Set(c.requiredFacts).size === c.requiredFacts.length &&
    ((c.state === 'OPEN' && c.stateVersion === '0' && c.replyRequestId === null) ||
      (c.state === 'ANSWERED' && c.stateVersion === '1' && typedId(c.replyRequestId)))) return freeze(value)
  const a = value.action
  if (value.kind === 'ACTION_REQUEST' && c === null && exactKeys(a, [...actionFields, ...(version === 4 ? ['parameters'] : [])]) && typedId(a.actionRequestId) &&
    actionId(a.actionId) && prose(a.instruction) && Array.isArray(a.sourceRefIds) && a.sourceRefIds.length <= 32 &&
    a.sourceRefIds.every(actionId) && new Set(a.sourceRefIds).size === a.sourceRefIds.length &&
    (version !== 4 || (a.parameters && typeof a.parameters === 'object' && !Array.isArray(a.parameters)))) return freeze(value)
  return null
}
const actionInspection = (value, state) => {
  if (!exactKeys(value, inspectionFields) || !typedId(value.authorizationId) || !digest(value.manifestDigest) ||
    !Array.isArray(value.sourceRefIds) || !value.sourceRefIds.length || value.sourceRefIds.length > 32 ||
    !value.sourceRefIds.every(actionId) || new Set(value.sourceRefIds).size !== value.sourceRefIds.length) return false
  if (state === 'PENDING') return value.inputSummary === null
  const summary = value.inputSummary
  return exactKeys(summary, inspectionSummaryFields) && digest(summary.inputDigest) && Array.isArray(summary.sources) &&
    summary.sources.length === value.sourceRefIds.length && summary.sources.every((source, index) =>
    exactKeys(source, inspectionReceiptSourceFields) && source.sourceRefId === value.sourceRefIds[index] &&
      typeof source.sha256 === 'string' && /^[a-f0-9]{64}$/.test(source.sha256) && typedLong(source.byteLength, { allowZero: true }) &&
      ['DIRECT_TEXT', 'LOCAL_IMAGE', 'LOCAL_AUDIO', 'PARSED_TEXT'].includes(source.carrier) && digest(source.contributionDigest))
}
const progressFields = ['actionRequestId', 'state', 'dispatchVersion', 'childRequestId', 'childRoute', 'childStateVersion']
const actionProgressValid = (progress, outcome, version) => {
  const fields = version === 4 ? [...progressFields, 'executionId', 'phase', 'resultDigest'] : progressFields
  if (outcome?.kind !== 'ACTION_REQUEST') return progress === null
  if (!exactKeys(progress, fields) || progress.actionRequestId !== outcome.action.actionRequestId ||
    !typedLong(progress.dispatchVersion, { allowZero: true })) return false
  if (progress.childRequestId === null) return progress.childRoute === null && progress.childStateVersion === null &&
    ['QUEUED', 'FAILED'].includes(progress.state) &&
    (version !== 4 || (progress.executionId === null && progress.phase === null && progress.resultDigest === null))
  if (version === 4 && (!typedId(progress.executionId) || !['READY', 'RUNNING', 'WAITING_PROVIDER', 'RESULT_UNKNOWN', 'RESULT_READY', 'ARCHIVING', 'COMPLETE', 'FAILED', 'CANCELLED'].includes(progress.phase) ||
    (progress.resultDigest !== null && !/^[a-f0-9]{64}$/.test(progress.resultDigest)) ||
    (progress.state === 'COMPLETED' && (progress.phase !== 'COMPLETE' || progress.resultDigest === null)) ||
    (progress.phase === 'ARCHIVING' && progress.state === 'COMPLETED'))) return false
  return Boolean(typedId(progress.childRequestId) && (version === 4 ? progress.childRoute === 'EXECUTE' : ['INSPECT', 'EXECUTE'].includes(progress.childRoute)) &&
    typedLong(progress.childStateVersion, { allowZero: true }) && ['RUNNING', 'WAITING_PROVIDER', 'RESULT_UNKNOWN', 'ARCHIVING', 'COMPLETED', 'FAILED', 'CANCELLED'].includes(progress.state))
}
// Both values have already passed the strict read-wire parser. No status can authorize execution.
export const actionProgressAdvances = (before, after) => {
  if (before === null || before === undefined) return true
  if (!after || before.actionRequestId !== after.actionRequestId || BigInt(after.dispatchVersion) < BigInt(before.dispatchVersion)) return false
  if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(before.state) && before.state !== after.state) return false
  if (before.childRequestId !== null) {
    if (before.childRequestId !== after.childRequestId || before.childRoute !== after.childRoute ||
      BigInt(after.childStateVersion) < BigInt(before.childStateVersion)) return false
    if (after.childStateVersion === before.childStateVersion && before.state !== after.state) return false
  } else if (before.state === 'FAILED' && after.childRequestId !== null) return false
  if (before.dispatchVersion === after.dispatchVersion && before.childStateVersion === after.childStateVersion &&
    progressFields.some(key => before[key] !== after[key])) return false
  return true
}
export const actionOutcomeProjection = (value, context = {}, route = 'CHAT') => {
  if (!exactKeys(value, actionProjectionFields) || ![3, 4].includes(value.schemaVersion) || value.route !== route || !['CHAT', 'INSPECT'].includes(route) ||
    (value.schemaVersion === 4 && route !== 'CHAT') ||
    !typedId(value.conversationId) || !typedLong(value.conversationGeneration) || !typedId(value.requestId) || !typedLong(value.requestRevision) ||
    !typedId(value.turnId) || !['PENDING', 'READY'].includes(value.state)) return null
  for (const key of ['conversationId', 'conversationGeneration', 'requestId', 'requestRevision', 'turnId']) {
    if (context[key] && value[key] !== context[key]) return null
  }
  if (value.inspection !== null ? !actionInspection(value.inspection, value.state) : route === 'INSPECT') return null
  if (value.schemaVersion === 3 && route === 'CHAT' && value.inspection !== null) return null
  if (value.state === 'PENDING') return value.outcome === null && value.actionProgress === null ? freeze({ ...value, purpose: route }) : null
  if ((context.taskId && value.outcome?.taskId !== context.taskId) ||
    (context.assignmentRevision && value.outcome?.assignmentRevision !== context.assignmentRevision)) return null
  const normalized = actionOutcome(value.outcome, value.schemaVersion)
  if (normalized?.deliverable === true && (route !== 'CHAT' || normalized.messageSource.turnId !== value.turnId)) return null
  return normalized && actionProgressValid(value.actionProgress, normalized, value.schemaVersion) ? freeze({ ...value, outcome: normalized, purpose: route }) : null
}
