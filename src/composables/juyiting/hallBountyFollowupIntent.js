const PREFIX = 'cyf.juyiting.bounty-followup.v3'
const clone = value => JSON.parse(JSON.stringify(value))
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const HASH = /^[0-9a-f]{64}$/

export const followupId = value => typeof value === 'string' && ID.test(value)
// Provider binding/model/policy names reuse the controlled canonical descriptor grammar; task/request IDs stay strict.
export const followupDescriptor = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(value)
export const followupScope = value => typeof value === 'string' && value.length > 0 && value.length <= 2048 &&
  value.split('\u0000').every(part => part.length > 0 && part.length <= 1024)
export const followupLong = (value, zero = false) => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) &&
  BigInt(value) <= 9223372036854775807n && (zero || value !== '0')
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key))
const assetRef = value => exactKeys(value, ['assetId', 'revision']) && followupId(value.assetId) && followupLong(value.revision)
const continuation = value => value === null || (exactKeys(value, ['requestId', 'stepId']) && followupId(value.requestId) && followupId(value.stepId))
const inputRef = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (value.kind === 'CURRENT_CONVERSATION_ASSET') return exactKeys(value, ['kind', 'assetRef']) && assetRef(value.assetRef)
  return value.kind === 'TASK_LINKED_WORKSPACE_VERSION' && exactKeys(value, ['kind', 'fileId', 'version', 'purpose']) &&
    followupId(value.fileId) && followupLong(value.version) && value.purpose === 'REFERENCE'
}
const intent = value => exactKeys(value, ['schemaVersion', 'interactionKind', 'taskId', 'expectedConversationGeneration',
  'expectedTaskVersion', 'expectedAssignmentRevision', 'expectedGrantVersion', 'requirementRevision', 'targetAgentId',
  'content', 'actionProposal', 'inputRefs', 'replyTo', 'continuationOf']) && value.schemaVersion === 3 &&
  value.interactionKind === 'EXECUTE' && followupId(value.taskId) && followupLong(value.expectedConversationGeneration) &&
  followupLong(value.expectedTaskVersion, true) && followupLong(value.expectedAssignmentRevision, true) &&
  followupLong(value.expectedGrantVersion) && followupLong(value.requirementRevision) && followupId(value.targetAgentId) &&
  typeof value.content === 'string' && value.content.trim() === value.content && value.content.length > 0 && value.content.length <= 4000 &&
  exactKeys(value.actionProposal, ['kind']) && ['generate_image', 'edit_image'].includes(value.actionProposal.kind) &&
  Array.isArray(value.inputRefs) && value.inputRefs.length <= 16 && value.inputRefs.every(inputRef) && value.replyTo === null && continuation(value.continuationOf) &&
  (value.actionProposal.kind === 'generate_image'
    ? value.inputRefs.every(ref => ref.kind === 'TASK_LINKED_WORKSPACE_VERSION')
    : value.inputRefs.length === 1 && value.inputRefs[0].kind === 'CURRENT_CONVERSATION_ASSET' && value.continuationOf !== null)

export const buildFollowupIntent = ({ context, content, kind, inputRefs, continuationOf }) => {
  if (!context || context.schemaVersion !== 1 || !followupId(context.conversationId) || !followupId(context.taskId) ||
    !followupId(context.targetAgentId) || !followupLong(context.conversationGeneration) || !followupLong(context.taskVersion, true) ||
    !followupLong(context.assignmentRevision, true) || !followupLong(context.baselineGrantVersion) || !followupLong(context.requirementRevision)) return null
  const body = { schemaVersion: 3, interactionKind: 'EXECUTE', taskId: context.taskId,
    expectedConversationGeneration: context.conversationGeneration, expectedTaskVersion: context.taskVersion,
    expectedAssignmentRevision: context.assignmentRevision, expectedGrantVersion: context.baselineGrantVersion,
    requirementRevision: context.requirementRevision, targetAgentId: context.targetAgentId, content: String(content || '').trim(),
    actionProposal: { kind }, inputRefs: clone(inputRefs || []), replyTo: null, continuationOf: continuationOf == null ? null : clone(continuationOf) }
  return intent(body) ? Object.freeze(body) : null
}

const validPreview = value => value && typeof value === 'object' && !Array.isArray(value) &&
  ['ownerPayloadSha256', 'instructionSha256', 'sourceSnapshotSha256', 'modelId', 'custody', 'operatorPolicyRevision'].every(key =>
    (key.endsWith('Sha256') ? typeof value[key] === 'string' && HASH.test(value[key]) : followupDescriptor(value[key])))
const validBinding = value => exactKeys(value, ['bindingId', 'bindingEpoch']) && followupDescriptor(value.bindingId) && followupLong(value.bindingEpoch)
const validAuthority = value => exactKeys(value, ['consentId', 'expectedConsentVersion', 'operationGrantId', 'expectedOperationGrantVersion']) &&
  followupId(value.consentId) && followupLong(value.expectedConsentVersion) && followupId(value.operationGrantId) && followupLong(value.expectedOperationGrantVersion)
const validReceipt = value => value == null || (value && typeof value === 'object' && !Array.isArray(value))

export const validFollowupRecord = value => value && typeof value === 'object' && !Array.isArray(value) && value.schemaVersion === 1 &&
  followupId(value.finalKey) && followupId(value.issueKey) && followupId(value.conversationId) && followupId(value.taskId) &&
  followupId(value.targetAgentId) && intent(value.intent) && value.intent.taskId === value.taskId &&
  value.intent.targetAgentId === value.targetAgentId && ['PREVIEWING', 'PREVIEWED', 'ISSUING', 'ISSUED', 'ADMITTING', 'ADMITTED', 'UNKNOWN', 'REJECTED'].includes(value.status) &&
  validPreview(value.expectedPreview) && validBinding(value.providerBinding) && validReceipt(value.issueReceipt) && validReceipt(value.finalReceipt) &&
  (value.authority == null || validAuthority(value.authority))

const storageKey = ({ scope, conversationId, taskId, targetAgentId }) => followupScope(scope) &&
  [conversationId, taskId, targetAgentId].every(followupId)
  ? `${PREFIX}:${encodeURIComponent(scope)}:${conversationId}:${taskId}:${targetAgentId}` : ''

/** Session-only browser cache of exact original request bodies. It never authorizes or replays a request. */
export const createHallBountyFollowupIntentStore = ({ storage = null, scope, conversationId, taskId, targetAgentId }) => {
  const name = storageKey({ scope, conversationId, taskId, targetAgentId })
  const read = () => {
    if (!name || !storage) return { state: 'UNAVAILABLE', records: {} }
    try {
      const raw = storage.getItem(name)
      if (raw == null) return { state: 'ABSENT', records: {} }
      const parsed = JSON.parse(raw)
      if (!parsed || parsed.schemaVersion !== 1 || !parsed.records || typeof parsed.records !== 'object' || Array.isArray(parsed.records)) return { state: 'CORRUPT', records: {} }
      const entries = Object.entries(parsed.records)
      if (entries.length > 64 || entries.some(([key, record]) => key !== record?.finalKey || !validFollowupRecord(record))) return { state: 'CORRUPT', records: {} }
      return { state: 'PRESENT', records: Object.fromEntries(entries.map(([key, record]) => [key, clone(record)])) }
    } catch { return { state: 'CORRUPT', records: {} } }
  }
  const write = record => {
    if (!validFollowupRecord(record) || !name || !storage) return { state: 'UNAVAILABLE', record: null }
    const current = read()
    if (!['ABSENT', 'PRESENT'].includes(current.state)) return { state: current.state, record: null }
    const old = current.records[record.finalKey]
    if (old && JSON.stringify(old.intent) !== JSON.stringify(record.intent)) return { state: 'CORRUPT', record: null }
    const records = { ...current.records, [record.finalKey]: clone(record) }
    try {
      const encoded = JSON.stringify({ schemaVersion: 1, records })
      storage.setItem(name, encoded)
      const verified = read()
      return verified.state === 'PRESENT' && verified.records[record.finalKey] &&
        JSON.stringify(verified.records[record.finalKey]) === JSON.stringify(record)
        ? { state: 'PRESENT', record: verified.records[record.finalKey] } : { state: 'UNAVAILABLE', record: null }
    } catch { return { state: 'UNAVAILABLE', record: null } }
  }
  return Object.freeze({ read, write })
}
