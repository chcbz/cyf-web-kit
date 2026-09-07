import { isCanonicalDecimalString as decimal } from '../../utils/silverAmount.js'

export const text = value => typeof value === 'string' && Boolean(value.trim())
export const positive = value => decimal(value) && BigInt(value) > 0n
export const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
const optional = (value, validate) => value == null || validate(value)
const oneOf = (value, values) => values.includes(value)

export const hostingPayload = result => {
  const body = result && Object.hasOwn(result, 'code') ? result : result?.data ?? result
  if (body && Object.hasOwn(body, 'code')) {
    if (!['E0', '0', 0, '200', 200].includes(body.code)) {
      const error = new Error(body.msg || body.message || '租金请求未被接受')
      error.code = body.code
      throw error
    }
    return body.data
  }
  return body
}

export const validQuote = (quote, purpose, personaCode, agentId, lease) =>
  ['INITIAL', 'RENEWAL'].includes(purpose) && text(quote?.quoteId) && quote.purpose === purpose && quote.personaCode === personaCode && text(quote.agentId) &&
  (!agentId || quote.agentId === agentId) && text(quote.planId) && positive(quote.planVersion) &&
  quote.currency === 'SILVER' && positive(quote.amountMicro) && positive(quote.periodSeconds) && positive(quote.expiresAt) &&
  (purpose === 'INITIAL' ? quote.leaseId == null && quote.expectedLeaseVersion == null :
    quote.leaseId === lease?.leaseId && positive(quote.expectedLeaseVersion) && quote.expectedLeaseVersion === lease?.version)

export const validLease = (lease, agentId, personaCode) => text(lease?.leaseId) && lease.agentId === agentId &&
  lease.personaCode === personaCode && text(lease.bindingId) && positive(lease.version) &&
  oneOf(lease.status, ['PROVISIONING', 'ACTIVE', 'REFUNDED']) && positive(lease.planVersion) &&
  positive(lease.amountMicro) && positive(lease.periodSeconds) && optional(lease.paidFrom, decimal) && optional(lease.paidThrough, decimal) &&
  (lease.status !== 'ACTIVE' || (decimal(lease.paidFrom) && positive(lease.paidThrough) && BigInt(lease.paidThrough) >= BigInt(lease.paidFrom)))

export const validLookup = (value, agentId, personaCode) => {
  if (typeof value?.managed !== 'boolean') return false
  if (!value.managed) return value.admission === 'NOT_MANAGED' && value.lease == null && value.intent == null && value.reprovision == null
  if (!validLease(value.lease, agentId, personaCode) || !oneOf(value.admission, ['PENDING', 'ALLOWED', 'RENEWAL_REQUIRED', 'INITIAL_REQUIRED'])) return false
  const intent = value.intent
  if (intent != null && !(text(intent.intentId) && positive(intent.version) &&
    oneOf(intent.status, ['FUNDS_RESERVED', 'PROVISIONING_UNKNOWN', 'SERVICE_READY', 'FAILED_NO_EFFECT', 'ACTIVE', 'REFUNDED']) &&
    text(intent.reserveTransactionId) && optional(intent.serviceReadyAt, decimal) &&
    optional(intent.captureTransactionId, text) && optional(intent.refundTransactionId, text))) return false
  const reprovision = value.reprovision
  return reprovision == null || (text(reprovision.requestId) && positive(reprovision.version) &&
    oneOf(reprovision.status, ['ACCEPTED', 'PROVISIONING_UNKNOWN', 'SERVICE_READY', 'FAILED_NO_EFFECT']) &&
    decimal(reprovision.requestedAt) && optional(reprovision.serviceReadyAt, decimal))
}

export const validOperation = (op, personaCode) => {
  if (!uuid(op?.key)) return false
  if (op.kind === 'INITIAL_QUOTE') return op.agentId == null || text(op.agentId)
  if (op.kind === 'INITIAL') return validQuote(op.quote, 'INITIAL', personaCode, op.agentId)
  if (!text(op.agentId) || !validLease(op.lease, op.agentId, personaCode) || op.lease.status !== 'ACTIVE') return false
  if (op.kind === 'REPROVISION' || op.kind === 'RENEWAL_QUOTE') return true
  return op.kind === 'RENEWAL' && validQuote(op.quote, 'RENEWAL', personaCode, op.agentId, op.lease)
}

// Construct only frozen DTO fields. Never send persisted paths or caller identity.
export const hostingRequest = (op, personaCode) => {
  const persona = encodeURIComponent(personaCode)
  const leaseId = encodeURIComponent(op.lease?.leaseId || '')
  if (op.kind === 'INITIAL_QUOTE') return [`/personas/${persona}/hosting-rent/quotes`, { purpose: 'INITIAL', ...(op.agentId ? { agentId: op.agentId } : {}) }]
  if (op.kind === 'RENEWAL_QUOTE') return [`/hosting-leases/${leaseId}/renewal-quotes`, { agentId: op.agentId, expectedLeaseVersion: op.lease.version }]
  if (op.kind === 'REPROVISION') return [`/personas/${persona}/bind`, { mode: 'server', hostingAction: 'REPROVISION', agentId: op.agentId, leaseId: op.lease.leaseId, expectedLeaseVersion: op.lease.version }]
  const quote = op.quote
  const terms = { agentId: quote.agentId, quoteId: quote.quoteId, expectedPlanVersion: quote.planVersion,
    expectedAmountMicro: quote.amountMicro, expectedPeriodSeconds: quote.periodSeconds }
  return op.kind === 'INITIAL' ? [`/personas/${persona}/bind`, { mode: 'server', hostingAction: 'INITIAL', ...terms }] :
    [`/hosting-leases/${leaseId}/renewals`, { ...terms, expectedLeaseVersion: op.lease.version }]
}

export const matchingHostingReceipt = (receipt, op) => {
  if (receipt?.agentId !== op.agentId || receipt.currency !== 'SILVER' || !decimal(receipt.occurredAt)) return false
  if (op.kind === 'REPROVISION') return text(receipt.requestId) && receipt.operation === 'REPROVISION' && receipt.status === 'ACCEPTED' &&
    receipt.leaseId === op.lease.leaseId && receipt.amountMicro === '0' && decimal(receipt.leaseVersion) &&
    BigInt(receipt.leaseVersion) === BigInt(op.lease.version) + 1n && receipt.paidThrough === op.lease.paidThrough
  return text(receipt.intentId) && text(receipt.leaseId) && text(receipt.transactionId) && receipt.quoteId === op.quote.quoteId &&
    receipt.status === (op.kind === 'INITIAL' ? 'FUNDS_RESERVED' : 'ACTIVE') &&
    receipt.amountMicro === op.quote.amountMicro && receipt.periodSeconds === op.quote.periodSeconds &&
    (op.kind === 'INITIAL' || receipt.leaseId === op.lease.leaseId)
}

// Versions are comparable only within the same lease/intent/request identity.
export const lookupNotOlder = (next, previous) => {
  if (!previous?.managed) return true
  if (!next.managed || next.lease.leaseId !== previous.lease.leaseId || BigInt(next.lease.version) < BigInt(previous.lease.version)) return false
  if (previous.lease.status !== 'PROVISIONING' && next.lease.status !== previous.lease.status) return false
  if (next.lease.version === previous.lease.version && ['status', 'bindingId', 'planVersion', 'amountMicro', 'periodSeconds', 'paidFrom', 'paidThrough']
    .some(key => (next.lease[key] ?? null) !== (previous.lease[key] ?? null))) return false
  for (const [key, id] of [['intent', 'intentId'], ['reprovision', 'requestId']]) {
    const old = previous[key]
    const value = next[key]
    if (!old) continue
    if (!value) return false
    if (value[id] === old[id]) {
      if (BigInt(value.version) < BigInt(old.version)) return false
      if (value.version === old.version && value.status !== old.status) return false
      const ranks = key === 'intent' ? { FUNDS_RESERVED: 0, PROVISIONING_UNKNOWN: 1, SERVICE_READY: 2, FAILED_NO_EFFECT: 2, ACTIVE: 3, REFUNDED: 3 } :
        { ACCEPTED: 0, PROVISIONING_UNKNOWN: 1, SERVICE_READY: 2, FAILED_NO_EFFECT: 2 }
      if (ranks[value.status] < ranks[old.status]) return false
      if ((key === 'intent' ? ['ACTIVE', 'REFUNDED'] : ['SERVICE_READY', 'FAILED_NO_EFFECT']).includes(old.status) && value.status !== old.status) return false
    } else if (next.lease.version === previous.lease.version) return false
  }
  return true
}

// Only documented command rejections are known no-effect. A generic 503,
// interrupted adapter, malformed receipt or network failure retains the key.
export const definitiveHostingFailure = error => new Set([
  'BAD_REQUEST', 'HOSTING_RENT_INVALID_COMMAND', 'HOSTING_RENT_UNAUTHENTICATED', 'HOSTING_RENT_FORBIDDEN',
  'HOSTING_RENT_OWNER_UNPROVEN', 'ECONOMY_PREVIEW_DISABLED', 'HOSTING_RENT_NOT_FOUND_OR_FORBIDDEN',
  'INSUFFICIENT_SILVER', 'IDEMPOTENCY_CONFLICT', 'HOSTING_RENT_QUOTE_EXPIRED', 'HOSTING_RENT_QUOTE_ALREADY_CONSUMED',
  'HOSTING_RENT_LEASE_CONFLICT', 'HOSTING_RENT_INTENT_CONFLICT', 'HOSTING_RENT_CONCURRENCY_CONFLICT',
  'HOSTING_RENT_PLAN_VERSION_CONFLICT', 'HOSTING_RENT_AGENT_CONFIRMATION_REQUIRED', 'HOSTING_RENT_CONFLICT',
  'HOSTING_RENT_NOT_CONFIGURED', 'HOSTING_RENT_NOT_READY', 'HOSTING_RENT_REPROVISION_NOT_READY',
  'HOSTING_RENT_NOT_ACTIVE', 'HOSTING_RENT_RENEWAL_REQUIRED'
]).has(error?.code)
