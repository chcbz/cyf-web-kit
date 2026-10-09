const ACKNOWLEDGEMENT = 'UNPRICED_EXTERNAL_ACCOUNT_ONE_IMAGE_REQUEST_ATTEMPT'
const ASSIGNMENT_FIELDS = ['agentId', 'workflowVersion', 'businessAction', 'expectedTaskVersion', 'requirementRevision', 'requestedOperations', 'initialOperation', 'inputRefs']
const BINDING_FIELDS = ['bindingId', 'bindingEpoch']
const RECEIPT_FIELDS = ['schemaVersion', 'consentId', 'taskId', 'targetAgentId', 'state', 'version', 'assignmentIdempotencyKey', 'assignmentBaseHash', 'inputSnapshotDigest', 'providerBinding', 'modelId', 'custody', 'operatorPolicyRevision', 'pricingMode', 'maxOutboundRequestAttempts', 'expiresAt']
const RECEIPT_BINDING_FIELDS = ['bindingId', 'bindingEpoch']
const REVOKE_FIELDS = ['key', 'expectedVersion']
const STATES = new Set(['ISSUED', 'BOUND', 'RESERVED', 'CONSUMED', 'REVOKED', 'EXPIRED'])
const clone = value => JSON.parse(JSON.stringify(value))
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const fields = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key))
const exactId = (value, max = 100) => typeof value === 'string' && value.length > 0 && [...value].length <= max &&
  value.trim() === value && [...value].every(char => {
  const point = char.codePointAt(0)
  return point >= 0x20 && point !== 0x7f && !(point >= 0x80 && point <= 0x9f) && !(point >= 0xd800 && point <= 0xdfff)
})
const positiveLong = value => typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && BigInt(value) <= 9223372036854775807n
const safeInteger = (value, minimum) => Number.isSafeInteger(value) && value >= minimum && value <= 9007199254740991
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const canonicalRefs = value => {
  if (!Array.isArray(value) || value.length > 16) return null
  const seen = new Set()
  const refs = []
  for (const item of value) {
    if (!fields(item, ['fileId', 'version', 'purpose']) || !exactId(item.fileId) || !safeInteger(item.version, 1) ||
      !['INPUT', 'REFERENCE'].includes(item.purpose)) return null
    const identity = JSON.stringify([item.fileId, item.version, item.purpose])
    if (seen.has(identity)) return null
    seen.add(identity)
    refs.push({ fileId: item.fileId, version: item.version, purpose: item.purpose })
  }
  return refs.sort((a, b) => a.fileId < b.fileId ? -1 : a.fileId > b.fileId ? 1 : a.version - b.version || a.purpose.localeCompare(b.purpose))
}

/** Builds only the frozen issuer body; it never represents paid/new-start authority. */
export const providerConsentIssueBody = ({ assignmentIdempotencyKey, assignment, providerBinding, acknowledgement } = {}) => {
  if (!exactId(assignmentIdempotencyKey) || !fields(assignment, ASSIGNMENT_FIELDS) ||
    assignment.workflowVersion !== 2 || assignment.businessAction !== 'assign_and_start' ||
    !safeInteger(assignment.expectedTaskVersion, 0) || !safeInteger(assignment.requirementRevision, 1) ||
    !exactId(assignment.agentId) || !Array.isArray(assignment.requestedOperations) ||
    assignment.requestedOperations.length !== 1 || assignment.requestedOperations[0] !== 'GENERATE_IMAGE' ||
    assignment.initialOperation !== 'GENERATE_IMAGE' || !equal(canonicalRefs(assignment.inputRefs), assignment.inputRefs) ||
    !fields(providerBinding, BINDING_FIELDS) || !exactId(providerBinding.bindingId) || !positiveLong(providerBinding.bindingEpoch) ||
    acknowledgement !== ACKNOWLEDGEMENT) return null
  return { schemaVersion: 1, assignmentIdempotencyKey, assignment: clone(assignment),
    providerBinding: { bindingId: providerBinding.bindingId, bindingEpoch: providerBinding.bindingEpoch }, acknowledgement }
}

const immutableReceiptKeys = ['consentId', 'taskId', 'targetAgentId', 'assignmentIdempotencyKey', 'assignmentBaseHash',
  'inputSnapshotDigest', 'providerBinding', 'modelId', 'custody', 'operatorPolicyRevision', 'pricingMode',
  'maxOutboundRequestAttempts', 'expiresAt']

/** Returns a strict, monotonic, owner-safe receipt or null. */
export const providerConsentReceipt = (value, intent, previous = null) => {
  const extension = intent?.providerConsent
  if (!fields(value, RECEIPT_FIELDS) || value.schemaVersion !== 1 || !extension ||
    !exactId(value.consentId) || value.taskId !== intent.taskId || value.targetAgentId !== intent.body.agentId ||
    !STATES.has(value.state) || !positiveLong(value.version) || value.assignmentIdempotencyKey !== intent.key ||
    !hash(value.assignmentBaseHash) || !hash(value.inputSnapshotDigest) ||
    !fields(value.providerBinding, RECEIPT_BINDING_FIELDS) ||
    value.providerBinding.bindingId !== extension.issueBody.providerBinding.bindingId ||
    value.providerBinding.bindingEpoch !== extension.issueBody.providerBinding.bindingEpoch ||
    !exactId(value.modelId) || !exactId(value.custody, 50) || !exactId(value.operatorPolicyRevision) ||
    value.pricingMode !== 'UNPRICED_EXTERNAL_ACCOUNT' || value.maxOutboundRequestAttempts !== 1 || !positiveLong(value.expiresAt)) return null
  if (previous) {
    if (!providerConsentReceipt(previous, intent) || BigInt(value.version) < BigInt(previous.version) ||
      immutableReceiptKeys.some(key => !equal(value[key], previous[key]))) return null
    const sameVersion = value.version === previous.version
    const active = new Set(['ISSUED', 'BOUND', 'RESERVED'])
    if (sameVersion) {
      // API read projection only: an unchanged active DB row may be shown as EXPIRED.
      if (!equal(value, previous) && !(value.state === 'EXPIRED' && active.has(previous.state))) return null
    } else if (['CONSUMED', 'REVOKED'].includes(previous.state) ||
      previous.state === 'EXPIRED' && !['EXPIRED', 'CONSUMED', 'REVOKED'].includes(value.state) ||
      value.state === 'EXPIRED' && previous.state !== 'EXPIRED') return null
    else {
      const rank = { ISSUED: 1, BOUND: 2, RESERVED: 3, CONSUMED: 4, REVOKED: 4 }
      if (rank[value.state] < rank[previous.state]) return null
    }
  }
  return clone(value)
}

export const providerConsentExtension = (value, intent, previous = null) => {
  if (!fields(value, ['schemaVersion', 'issueKey', 'issueBody', 'receipt', 'revoke']) || value.schemaVersion !== 1 ||
    !exactId(value.issueKey) || !intent || value.issueBody?.assignmentIdempotencyKey !== intent.key ||
    !equal(value.issueBody?.assignment, intent.body) || !equal(value.issueBody, providerConsentIssueBody(value.issueBody))) return null
  const receipt = value.receipt === null ? null : providerConsentReceipt(value.receipt, intent, previous?.receipt || null)
  if (value.receipt !== null && !receipt) return null
  if (value.revoke !== null && (!fields(value.revoke, REVOKE_FIELDS) || !exactId(value.revoke.key) || !positiveLong(value.revoke.expectedVersion) ||
    !receipt || BigInt(value.revoke.expectedVersion) > BigInt(receipt.version))) return null
  if (previous && (previous.issueKey !== value.issueKey || !equal(previous.issueBody, value.issueBody) ||
    (previous.revoke && !equal(previous.revoke, value.revoke)))) return null
  return { schemaVersion: 1, issueKey: value.issueKey, issueBody: clone(value.issueBody), receipt,
    revoke: value.revoke ? clone(value.revoke) : null }
}

export const providerConsentAcknowledgement = ACKNOWLEDGEMENT
