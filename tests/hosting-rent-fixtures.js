export const hostingPersona = (overrides = {}) => ({ personaCode: 'linchong', name: '林冲', canBind: true, bound: false, boundToMe: false, ...overrides })
export const hostingQuote = (overrides = {}) => ({ quoteId: 'hq-1', purpose: 'INITIAL', personaCode: 'linchong', agentId: 'agt_server_proposal',
  leaseId: null, expectedLeaseVersion: null, planId: 'configured-plan', planVersion: '7', currency: 'SILVER',
  amountMicro: '1234500000', periodSeconds: '172800', expiresAt: '9999999999999', ...overrides })
export const hostingReceipt = (overrides = {}) => ({ agentId: 'agt_server_proposal', intentId: 'hi-1', leaseId: 'hl-1', quoteId: 'hq-1',
  transactionId: 'tx-reserve', status: 'FUNDS_RESERVED', currency: 'SILVER', amountMicro: '1234500000', periodSeconds: '172800', occurredAt: '1000', ...overrides })
export const hostingLookup = ({ lease = {}, intent = {}, ...overrides } = {}) => ({ managed: true,
  lease: { leaseId: 'hl-1', agentId: 'agt_server_proposal', personaCode: 'linchong', bindingId: 'binding-1', version: '1', status: 'PROVISIONING',
    planVersion: '7', amountMicro: '1234500000', periodSeconds: '172800', paidFrom: null, paidThrough: null, ...lease },
  intent: { intentId: 'hi-1', version: '1', status: 'FUNDS_RESERVED', serviceReadyAt: null, reserveTransactionId: 'tx-reserve',
    captureTransactionId: null, refundTransactionId: null, ...intent }, admission: 'PENDING', reprovision: null, ...overrides })
export const activeHostingLookup = ({ lease = {}, intent = {}, ...overrides } = {}) => hostingLookup({
  lease: { version: '3', status: 'ACTIVE', paidFrom: '1000', paidThrough: '172801000', ...lease },
  intent: { version: '3', status: 'ACTIVE', serviceReadyAt: '1000', captureTransactionId: 'tx-capture', ...intent }, admission: 'ALLOWED', ...overrides })
export const freeReprovisionReceipt = (overrides = {}) => ({ requestId: 'hr-1', agentId: 'agt_server_proposal', leaseId: 'hl-1',
  operation: 'REPROVISION', status: 'ACCEPTED', currency: 'SILVER', amountMicro: '0', leaseVersion: '4', paidThrough: '172801000', occurredAt: '2000', ...overrides })
export const memoryHostingStorage = () => {
  const entries = new Map()
  return { entries, getItem: key => entries.get(key) || null, setItem: (key, value) => entries.set(key, value) }
}
