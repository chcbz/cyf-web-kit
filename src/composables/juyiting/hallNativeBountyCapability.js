const LANE = 'ORDINARY_SINGLE_AGENT_ASSIGN_AND_START'
const TRANSPORT = 'PERSONAL_WORKSPACE_CONVERSATION_HTTP_V1'
const OPERATION = 'GENERATE_IMAGE'
const RECOVERY = Object.freeze({
  legacyFallbackAllowed: false,
  unknownOrNotFoundMeans: 'RECOVERY_REQUIRED',
  replayPolicy: 'EXPLICIT_USER_EXACT_ORIGINAL_KEY_AND_BODY_ONLY'
})
const nativeStates = new Set(['READY', 'OFFLINE', 'UNDECLARED', 'DISABLED', 'UNSUPPORTED', 'AMBIGUOUS'])
const serverStates = new Set(['READY', 'DISABLED', 'NOT_RUNNING'])
const authorizationStates = new Set(['UNAVAILABLE', 'READY'])
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const record = value => value && typeof value === 'object' && !Array.isArray(value)
const exactKeys = (value, keys) => record(value) && Object.keys(value).length === keys.length &&
  keys.every(key => own(value, key))
const exactId = value => typeof value === 'string' && value.length > 0 && value.trim() === value &&
  [...value].every(char => {
    const point = char.codePointAt(0)
    return point >= 0x20 && point !== 0x7f && !(point >= 0x80 && point <= 0x9f) && !(point >= 0xd800 && point <= 0xdfff)
  })
const reasons = value => Array.isArray(value) && value.every(exactId) ? [...value] : null
const operations = value => Array.isArray(value) && value.length <= 1 && value.every(item => item === OPERATION) &&
  new Set(value).size === value.length ? [...value] : null
const unwrap = result => {
  const envelope = result && own(result, 'code') ? result : result?.data ?? result
  if (envelope && own(envelope, 'code')) {
    if (![undefined, null, 'E0', '0', 0, '200', 200].includes(envelope.code)) {
      const error = new Error(envelope.msg || envelope.message || '原生办理能力读取被拒绝')
      error.code = envelope.code
      error.status = envelope.status
      throw error
    }
    return envelope.data?.data ?? envelope.data
  }
  return envelope?.data ?? envelope
}

/** Strictly accepts only the frozen native bounty capability response shape. */
export const parseNativeBountyCapability = value => {
  const rootKeys = ['schemaVersion', 'taskId', 'targetAgentId', 'lane', 'serverLane', 'nativeExecution',
    'authorization', 'newStart', 'requestedOperations', 'initialOperation', 'inputRefsPolicy', 'originalIntentRecovery']
  if (!exactKeys(value, rootKeys) || value.schemaVersion !== 1 || !exactId(value.taskId) || !exactId(value.targetAgentId) ||
    value.lane !== LANE || !exactKeys(value.serverLane, ['state', 'blockingReasons']) ||
    !serverStates.has(value.serverLane.state) || !reasons(value.serverLane.blockingReasons) ||
    !exactKeys(value.nativeExecution, ['state', 'transport', 'schemaVersion', 'supportedOperations']) ||
    !nativeStates.has(value.nativeExecution.state) || value.nativeExecution.transport !== TRANSPORT ||
    value.nativeExecution.schemaVersion !== 1 || !operations(value.nativeExecution.supportedOperations) ||
    !exactKeys(value.authorization, ['state', 'paidExecutionAuthorized']) || !authorizationStates.has(value.authorization.state) ||
    typeof value.authorization.paidExecutionAuthorized !== 'boolean' ||
    !exactKeys(value.newStart, ['eligible', 'blockingReasons']) || typeof value.newStart.eligible !== 'boolean' ||
    !reasons(value.newStart.blockingReasons) || !operations(value.requestedOperations) ||
    !['GENERATE_IMAGE', null].includes(value.initialOperation) || value.inputRefsPolicy !== 'EMPTY_ONLY' ||
    !exactKeys(value.originalIntentRecovery, Object.keys(RECOVERY)) ||
    Object.keys(RECOVERY).some(key => value.originalIntentRecovery[key] !== RECOVERY[key])) return null
  const requestedOperations = operations(value.requestedOperations)
  const supportedOperations = operations(value.nativeExecution.supportedOperations)
  const selectable = requestedOperations.length === 1 && requestedOperations[0] === OPERATION && value.initialOperation === OPERATION
  const coherentNewStart = value.newStart.eligible === true && value.serverLane.state === 'READY' &&
    value.nativeExecution.state === 'READY' && value.authorization.state === 'READY' &&
    value.authorization.paidExecutionAuthorized === true && selectable
  // Never turn a partial/contradictory response into start authority. A future
  // legitimate cost bridge may make this branch true without a UI flag change.
  if ((value.newStart.eligible && !coherentNewStart) || (!selectable && value.initialOperation !== null) ||
    (selectable && value.nativeExecution.state !== 'READY' && value.newStart.eligible)) return null
  return Object.freeze({
    schemaVersion: 1,
    taskId: value.taskId,
    targetAgentId: value.targetAgentId,
    lane: LANE,
    serverLane: Object.freeze({ state: value.serverLane.state, blockingReasons: Object.freeze(reasons(value.serverLane.blockingReasons)) }),
    nativeExecution: Object.freeze({ state: value.nativeExecution.state, transport: TRANSPORT, schemaVersion: 1,
      supportedOperations: Object.freeze(supportedOperations) }),
    authorization: Object.freeze({ state: value.authorization.state, paidExecutionAuthorized: value.authorization.paidExecutionAuthorized }),
    newStart: Object.freeze({ eligible: value.newStart.eligible, blockingReasons: Object.freeze(reasons(value.newStart.blockingReasons)) }),
    requestedOperations: Object.freeze(requestedOperations),
    initialOperation: value.initialOperation,
    inputRefsPolicy: 'EMPTY_ONLY',
    originalIntentRecovery: Object.freeze({ ...RECOVERY })
  })
}

export const capabilityAllowsNewStart = (capability, task, agent) => Boolean(capability &&
  capability.taskId === task?.id && capability.targetAgentId === agent?.agentId && capability.lane === LANE &&
  capability.newStart.eligible === true)

// Recovery has its own gate: it never derives a new-start permission from the
// native declaration or a UI flag, but requires a live server lane before a
// user explicitly asks to replay an exact original request.
export const capabilityAllowsOriginalReplay = (capability, taskId, agentId) => Boolean(capability &&
  capability.taskId === taskId && capability.targetAgentId === agentId && capability.lane === LANE &&
  capability.serverLane.state === 'READY' && capability.originalIntentRecovery.replayPolicy === RECOVERY.replayPolicy)

export const loadNativeBountyCapability = async ({ agentApi, taskId, targetAgentId, signal }) => {
  if (!exactId(taskId) || !exactId(targetAgentId)) return null
  const value = unwrap(await agentApi.get(`/tasks/${encodeURIComponent(taskId)}/point-and-start-capability`, { targetAgentId }, {
    autoLoading: false, signal
  }))
  const capability = parseNativeBountyCapability(value)
  return capability?.taskId === taskId && capability.targetAgentId === targetAgentId ? capability : null
}
