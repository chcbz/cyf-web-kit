import { bountyBootstrapReference } from './hallBountyBootstrap.js'
import { providerConsentExtension } from './hallPointAndStartProviderConsent.js'

const PREFIX = 'cyf.juyiting.point-and-start.v1'
const clone = value => JSON.parse(JSON.stringify(value))
const operations = new Set(['GENERATE_IMAGE', 'EDIT_IMAGE', 'INSPECT_INPUTS', 'GENERATE_AUDIO', 'EDIT_AUDIO'])
export const exactPointAndStartId = (value, max = 100) => typeof value === 'string' && value.length > 0 &&
  [...value].length <= max && value.trim() === value && [...value].every(c => {
  const p = c.codePointAt(0)
  return p >= 0x20 && p !== 0x7f && !(p >= 0x80 && p <= 0x9f) && !(p >= 0xd800 && p <= 0xdfff)
})
// Principal namespaces use the real Hall tenant/client/owner NUL separators;
// they are encoded storage keys, not task/Agent IDs or backend authorization.
export const exactPointAndStartScope = value => typeof value === 'string' && value.length > 0 &&
  value.split('\u0000').every(part => exactPointAndStartId(part, 1024))
export const pointAndStartLong = (value, zero = false) => typeof value === 'string' &&
  /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= 9223372036854775807n && (zero || value !== '0')
const safeNumber = (value, zero = false) => pointAndStartLong(value, zero) &&
  BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null
const receiptLong = (value, zero = false) => Number.isSafeInteger(value) && value >= 0
  ? (pointAndStartLong(String(value), zero) ? String(value) : null)
  : (pointAndStartLong(value, zero) ? value : null)
const sortedOperations = list => Array.isArray(list) && list.length > 0 &&
  list.every(item => operations.has(item)) && new Set(list).size === list.length ? [...list].sort() : null
const inputs = list => {
  if (!Array.isArray(list) || list.length > 32) return null
  const result = []
  const seen = new Set()
  for (const item of list) {
    if (!exactPointAndStartId(item?.fileId) || !Number.isSafeInteger(item.version) || item.version < 1 ||
      item.version > 2147483647 || !['INPUT', 'REFERENCE'].includes(item.purpose)) return null
    const key = JSON.stringify([item.fileId, item.version, item.purpose])
    if (seen.has(key)) return null
    seen.add(key)
    result.push({ fileId: item.fileId, version: item.version, purpose: item.purpose })
  }
  return result.sort((a, b) => a.fileId < b.fileId ? -1 : a.fileId > b.fileId ? 1 :
    a.version - b.version || a.purpose.localeCompare(b.purpose))
}
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
export const pointAndStartBody = ({ agentId, taskVersion, requirementRevision, requestedOperations,
  initialOperation, inputRefs = [] }) => {
  const ops = sortedOperations(requestedOperations)
  const refs = inputs(inputRefs)
  const version = safeNumber(taskVersion, true)
  const revision = safeNumber(requirementRevision)
  if (!exactPointAndStartId(agentId) || version === null || revision === null || !ops || !refs ||
    !ops.includes(initialOperation)) return null
  return { agentId, workflowVersion: 2, businessAction: 'assign_and_start', expectedTaskVersion: version,
    requirementRevision: revision, requestedOperations: ops, initialOperation, inputRefs: refs }
}
const canonicalBody = body => pointAndStartBody({ ...body,
  taskVersion: receiptLong(body?.expectedTaskVersion, true), requirementRevision: receiptLong(body?.requirementRevision) })
const inputFacts = (list, legacy = false) => {
  const refs = inputs(list)
  if (!refs) return null
  const facts = list.map(item => ({ fileId: item.fileId, version: item.version, purpose: item.purpose,
    contentMimeType: item.contentMimeType, byteLength: legacy ? receiptLong(item.byteLength, true) : item.byteLength,
    contentHash: item.contentHash }))
  if (facts.some(item => typeof item.contentMimeType !== 'string' || !item.contentMimeType ||
    !pointAndStartLong(item.byteLength, true) || typeof item.contentHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(item.contentHash))) return null
  return refs.map(ref => facts.find(item => equal(ref, { fileId: item.fileId, version: item.version, purpose: item.purpose })))
}
export const pointAndStartGrant = (value, intent) => {
  const ops = sortedOperations(value?.permittedOperations)
  const facts = inputFacts(value?.inputs, true)
  if (!value || value.taskId !== intent.taskId || value.targetAgentId !== intent.body.agentId ||
    !exactPointAndStartId(value.grantId) || value.state !== 'ACTIVE' || !ops || !facts ||
    receiptLong(value.requirementRevision) !== String(intent.body.requirementRevision) ||
    !receiptLong(value.assignmentRevision, true) || !receiptLong(value.grantVersion) ||
    !equal(ops, intent.body.requestedOperations) || !equal(inputs(facts), intent.body.inputRefs) ||
    BigInt(receiptLong(value.assignmentRevision, true)) < BigInt(intent.body.expectedTaskVersion)) return null
  return { grantId: value.grantId, assignmentRevision: receiptLong(value.assignmentRevision, true),
    grantVersion: receiptLong(value.grantVersion), inputs: facts }
}
export const pointAndStartProjection = (value, intent, previous = null) => {
  const ops = sortedOperations(value?.permittedOperations)
  const facts = inputFacts(value?.inputs)
  const states = ['PENDING', 'CLAIMED', 'RETRY', 'ADMITTED', 'DEAD']
  if (!value || value.schemaVersion !== 1 || value.taskId !== intent.taskId ||
    value.targetAgentId !== intent.body.agentId || value.requirementRevision !== String(intent.body.requirementRevision) ||
    !pointAndStartLong(value.assignmentRevision, true) || !pointAndStartLong(value.taskVersion, true) ||
    !pointAndStartLong(value.grantVersion) || !pointAndStartLong(value.stateVersion, true) ||
    !exactPointAndStartId(value.grantId) || !exactPointAndStartId(value.bootstrapId) ||
    !['ACTIVE', 'REVOKED', 'SUPERSEDED'].includes(value.grantState) || !states.includes(value.bootstrapState) ||
    typeof value.currentAssignment !== 'boolean' || !ops || !facts ||
    !equal(ops, intent.body.requestedOperations) || !equal(inputs(facts), intent.body.inputRefs) ||
    value.initialOperation !== intent.body.initialOperation ||
    BigInt(value.taskVersion) < BigInt(value.assignmentRevision) ||
    BigInt(value.assignmentRevision) < BigInt(intent.body.expectedTaskVersion) ||
    (value.currentAssignment && value.grantState !== 'ACTIVE')) return null
  if (value.bootstrapState === 'ADMITTED') {
    if (!bountyBootstrapReference(value)) return null
  } else if (value.conversationId !== null || value.initialRequestId !== null) return null
  const result = { schemaVersion: 1, taskId: value.taskId, targetAgentId: value.targetAgentId,
    requirementRevision: value.requirementRevision, assignmentRevision: value.assignmentRevision,
    taskVersion: value.taskVersion, grantId: value.grantId, grantVersion: value.grantVersion,
    grantState: value.grantState, permittedOperations: ops, inputs: facts, bootstrapId: value.bootstrapId,
    bootstrapState: value.bootstrapState, stateVersion: value.stateVersion, initialOperation: value.initialOperation,
    conversationId: value.conversationId, initialRequestId: value.initialRequestId, currentAssignment: value.currentAssignment }
  const grant = intent.grant
  if (grant && (grant.grantId !== result.grantId || grant.assignmentRevision !== result.assignmentRevision ||
    BigInt(result.grantVersion) < BigInt(grant.grantVersion) || !equal(grant.inputs, result.inputs))) return null
  if (previous) {
    if (['taskId', 'targetAgentId', 'requirementRevision', 'assignmentRevision', 'grantId', 'bootstrapId',
      'initialOperation'].some(key => previous[key] !== result[key]) || !equal(previous.inputs, result.inputs) ||
      !equal(previous.permittedOperations, result.permittedOperations) ||
      ['taskVersion', 'grantVersion', 'stateVersion'].some(key => BigInt(result[key]) < BigInt(previous[key])) ||
      (previous.stateVersion === result.stateVersion && ['bootstrapState', 'conversationId', 'initialRequestId'].some(key => previous[key] !== result[key])) ||
      (previous.grantVersion === result.grantVersion && previous.grantState !== result.grantState) ||
      (previous.taskVersion === result.taskVersion && previous.currentAssignment !== result.currentAssignment) ||
      (previous.bootstrapState === 'ADMITTED' && (result.bootstrapState !== 'ADMITTED' ||
        previous.conversationId !== result.conversationId || previous.initialRequestId !== result.initialRequestId)) ||
      (previous.grantState !== 'ACTIVE' && result.grantState === 'ACTIVE')) return null
  }
  return result
}
const validIntent = record => {
  if (!record || record.schemaVersion !== 1 || !exactPointAndStartId(record.taskId) ||
    !exactPointAndStartId(record.key) || typeof record.postAcknowledged !== 'boolean' ||
    !record.body || !equal(record.body, canonicalBody(record.body))) return false
  if (record.grant && (!exactPointAndStartId(record.grant.grantId) ||
    !pointAndStartLong(record.grant.assignmentRevision, true) || !pointAndStartLong(record.grant.grantVersion) ||
    !inputFacts(record.grant.inputs))) return false
  if (record.providerConsent !== undefined && !providerConsentExtension(record.providerConsent, record)) return false
  return !record.projection || Boolean(pointAndStartProjection(record.projection, record))
}
/** One original intent per owner/task; corrupt/unavailable storage is never writable. */
export const createPointAndStartIntentStore = ({ storage, scope, taskId }) => {
  const name = exactPointAndStartScope(scope) && exactPointAndStartId(taskId)
    ? `${PREFIX}.${encodeURIComponent(scope)}.${encodeURIComponent(taskId)}` : ''
  const read = () => {
    if (!name || !storage) return { state: 'UNAVAILABLE' }
    try {
      const raw = storage.getItem(name)
      if (raw === null) return { state: 'ABSENT' }
      const record = JSON.parse(raw)
      return validIntent(record) && record.taskId === taskId ? { state: 'PRESENT', record: clone(record) } : { state: 'CORRUPT' }
    } catch { return { state: 'UNAVAILABLE' } }
  }
  return { read, write: record => {
    const old = read()
    if (!validIntent(record) || record.taskId !== taskId || !['ABSENT', 'PRESENT'].includes(old.state)) return { state: 'UNAVAILABLE' }
    if (old.state === 'PRESENT' && (old.record.key !== record.key || !equal(old.record.body, record.body) ||
      (old.record.postAcknowledged && !record.postAcknowledged) ||
      (old.record.grant && !equal(old.record.grant, record.grant)) ||
      (old.record.providerConsent && !providerConsentExtension(record.providerConsent, record, old.record.providerConsent)) ||
      (!old.record.providerConsent && record.providerConsent !== undefined) ||
      (old.record.projection && !pointAndStartProjection(record.projection, record, old.record.projection)))) return { state: 'CORRUPT' }
    try {
      const encoded = JSON.stringify(record)
      storage.setItem(name, encoded)
      return storage.getItem(name) === encoded ? read() : { state: 'UNAVAILABLE' }
    } catch { return { state: 'UNAVAILABLE' } }
  } }
}
