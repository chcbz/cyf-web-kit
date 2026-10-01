const LONG_MAX = '9223372036854775807'
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
// eslint-disable-next-line no-control-regex
const isoControl = value => /[\u0000-\u001f\u007f-\u009f]/u.test(value)
export const typedLong = (value, { allowZero = false } = {}) => {
  if (typeof value !== 'string' || !(allowZero ? /^(0|[1-9][0-9]*)$/ : /^[1-9][0-9]*$/).test(value)) return ''
  return value.length < LONG_MAX.length || (value.length === LONG_MAX.length && value <= LONG_MAX) ? value : ''
}
export const typedId = value => typeof value === 'string' && value && value === value.trim() && value.length <= 100 && !isoControl(value) ? value : ''
export const exactKeys = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === fields.length && fields.every(field => own(value, field))
const freeze = value => Object.freeze(JSON.parse(JSON.stringify(value)))
const selectorFields = ['kind', 'fileId', 'version', 'purpose', 'assetId', 'assetRevision']
export const sourceSelector = value => {
  if (!exactKeys(value, selectorFields)) return null
  if (value.kind === 'TASK_LINKED_WORKSPACE_VERSION' && typedId(value.fileId) && typedLong(value.version) &&
    value.purpose === 'REFERENCE' && value.assetId === null && value.assetRevision === null) return freeze(value)
  if (value.kind === 'CURRENT_CONVERSATION_ASSET' && value.fileId === null && value.version === null && value.purpose === null &&
    typedId(value.assetId) && typedLong(value.assetRevision)) return freeze(value)
  return null
}
export const discussionBody = ({ intent, taskId, assignmentRevision, content, parentOutcomeId = null,
  expectedParentStateVersion = null, pendingQuestionId = null, expectedPendingQuestionStateVersion = null, sourceSelectors = [] }) => {
  if (!['DISCUSSION', 'CLARIFICATION_REPLY'].includes(intent) || !typedId(taskId) || !typedLong(assignmentRevision, { allowZero: true }) ||
    typeof content !== 'string' || !content.trim() || Array.from(content).length > 4000 || isoControl(content) ||
    !Array.isArray(sourceSelectors) || sourceSelectors.length > 16) return null
  const selectors = sourceSelectors.map(sourceSelector)
  if (selectors.some(value => !value)) return null
  const body = {
    schemaVersion: 1, intent, taskId, expectedAssignmentRevision: assignmentRevision, content,
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
    if ((value.proposal.operation === 'GENERATE_IMAGE' && value.proposal.sourceSelectors.length === 0 && value.proposal.parent === null) ||
      (value.proposal.operation === 'EDIT_IMAGE' && value.proposal.sourceSelectors.length === 1 && value.proposal.sourceSelectors[0].kind === 'CURRENT_CONVERSATION_ASSET' && value.proposal.parent)) return freeze(value)
  }
  return null
}
const projectionFields = ['schemaVersion', 'conversationId', 'conversationGeneration', 'requestId', 'requestRevision', 'turnId', 'state', 'outcome']
export const typedOutcomeProjection = (value, context = {}) => {
  if (!exactKeys(value, projectionFields) || value.schemaVersion !== 1 || !typedId(value.conversationId) || !typedLong(value.conversationGeneration) ||
    !typedId(value.requestId) || !typedLong(value.requestRevision) || !typedId(value.turnId) || !['PENDING', 'READY'].includes(value.state)) return null
  if ((context.conversationId && value.conversationId !== context.conversationId) ||
    (context.conversationGeneration && value.conversationGeneration !== context.conversationGeneration) ||
    (context.requestId && value.requestId !== context.requestId)) return null
  if (value.state === 'PENDING' && value.outcome === null) return freeze(value)
  const normalized = outcome(value.outcome)
  if (value.state === 'READY' && normalized) return freeze({ ...value, outcome: normalized })
  return null
}
const acceptedFields = ['schemaVersion', 'intent', 'requestId', 'userMessageId', 'turnIds', 'state', 'stateVersion', 'eventCursor', 'statusUrl', 'typedOutcomeUrl', 'replay', 'pendingQuestionId']
export const discussionAccepted = (value, body, conversationId) => {
  if (!exactKeys(value, acceptedFields) || value.schemaVersion !== 1 || value.intent !== body?.intent || !typedId(value.requestId) ||
    !typedLong(value.userMessageId) || !Array.isArray(value.turnIds) || value.turnIds.length !== 1 || !value.turnIds.every(typedId) ||
    typeof value.state !== 'string' || !value.state || !typedLong(value.stateVersion, { allowZero: true }) || !typedLong(value.eventCursor, { allowZero: true }) ||
    value.statusUrl !== `/chat/requests/${value.requestId}` || value.typedOutcomeUrl !== `/chat/conversations/${conversationId}/requests/${value.requestId}/typed-outcome` ||
    typeof value.replay !== 'boolean') return null
  if (body.intent === 'CLARIFICATION_REPLY' ? value.pendingQuestionId !== body.pendingQuestionId : value.pendingQuestionId !== null) return null
  return freeze(value)
}
export const outcomeCardKey = value => `${value.requestId}\u0000${value.turnId}\u0000${value.outcome?.outcomeId || ''}`
