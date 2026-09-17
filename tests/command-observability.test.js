import { expect } from 'chai'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope } from 'vue'
import {
  assessCommandObservabilityCapability,
  normalizeDlqPage,
  observationValue
} from '../src/utils/commandObservabilityPolicy.js'
import { useCommandObservability } from '../src/composables/useCommandObservability.js'

const deferred = () => { let resolve; let reject; return { promise: new Promise((res, rej) => { resolve = res; reject = rej }), resolve, reject } }
const capability = (available = true, reason = null) => ({ contractVersion: 'command-observability-v1', available, readOnly: true, reason })
const metrics = () => ({ deliveryByStatus: { SENT: 1 }, inboxByStatus: {}, inboxByResult: {}, outboxByStatus: {}, operationsByTypeAndOutcome: {}, ackLatencySeconds: 1, outboxBacklog: 2, outboxOldestAgeSeconds: 3, publishFailureTotal: 4, rabbitDlqCount: 5, waitingDueCount: 6, sentUnacknowledgedCount: 7, reconnectQueueDepth: 8, expiryProximityCount: 9, capturedAt: 1000 })
const page = (items, next, hasMore) => ({ items, nextAfterDeliveryId: next, hasMore })
const auditPage = (items, next, hasMore) => ({ items, nextAfterId: next, hasMore })
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

const board = ({ client, identity = () => 'user-a', auth = () => 1 }) => {
  setActivePinia(createPinia())
  const scope = effectScope()
  return { scope, value: scope.run(() => useCommandObservability({ client, getIdentity: identity, getAuthGeneration: auth })) }
}

describe('command observability read-only policy and lifecycle', () => {
  it('fails closed for malformed capabilities and accepts only the frozen available/deny/disabled forms', () => {
    expect(assessCommandObservabilityCapability(capability()).available).to.equal(true)
    expect(assessCommandObservabilityCapability(capability(false, 'FORBIDDEN'))).to.include({ available: false, reason: 'FORBIDDEN' })
    expect(assessCommandObservabilityCapability(capability(false, 'DISABLED'))).to.include({ available: false, reason: 'DISABLED' })
    expect(assessCommandObservabilityCapability({ ...capability(), unexpected: true }).reason).to.equal('MALFORMED')
    expect(assessCommandObservabilityCapability({ ...capability(), readOnly: false }).reason).to.equal('MALFORMED')
    expect(observationValue(9007199254740992)).to.equal('未知')
  })

  it('preserves string cursors, deduplicates pagination, and stops a non-advancing cursor', async () => {
    const reads = []
    const client = {
      capabilities: async () => capability(), metrics: async () => metrics(), audit: async () => auditPage([], null, false),
      dlq: ({ afterDeliveryId }) => { reads.push(afterDeliveryId); return afterDeliveryId === '0' ? Promise.resolve(page([{ deliveryId: '0009' }], 'cursor-1', true)) : Promise.resolve(page([{ deliveryId: '0009' }, { deliveryId: '0010' }], 'cursor-2', false)) }
    }
    const fixture = board({ client })
    try {
      await fixture.value.refresh(); await fixture.value.loadDlq()
      expect(reads).to.deep.equal(['0', 'cursor-1'])
      expect(fixture.value.dlq.value.items.map(row => row.deliveryId)).to.deep.equal(['0009', '0010'])
      expect(() => normalizeDlqPage(page([], '0', true), '0')).to.throw
    } finally { fixture.scope.stop() }
  })

  it('rejects late work after identity changes and clears all sensitive data on revoked auth', async () => {
    const slowMetrics = deferred(); let metricRead = 0; let identity = 'user-a'
    const client = {
      capabilities: async () => capability(),
      metrics: () => ++metricRead === 1 ? slowMetrics.promise : Promise.reject(Object.assign(new Error('forbidden'), { status: 403 })),
      dlq: async () => page([{ deliveryId: 'old-delivery' }], null, false), audit: async () => auditPage([{ id: 'old-audit' }], null, false)
    }
    const fixture = board({ client, identity: () => identity })
    try {
      const first = fixture.value.refresh(); await flush()
      identity = 'user-b'; fixture.value.resetForIdentity()
      slowMetrics.resolve(metrics()); await first; await flush()
      expect(fixture.value.metrics.value.data).to.equal(null)
      expect(fixture.value.dlq.value.items).to.deep.equal([])
      await fixture.value.refresh(); await flush()
      expect(fixture.value.capabilityState.value).to.equal('unavailable')
      expect(fixture.value.audit.value.items).to.deep.equal([])
    } finally { fixture.scope.stop() }
  })

  it('cancels route-owned pending GETs on dispose and ignores their late responses', async () => {
    const pending = deferred(); let signal
    const client = {
      capabilities: async () => capability(),
      metrics: ({ signal: requestSignal }) => { signal = requestSignal; return pending.promise },
      dlq: async () => page([], null, false), audit: async () => auditPage([], null, false)
    }
    const fixture = board({ client })
    try {
      const refresh = fixture.value.refresh(); await flush()
      expect(signal.aborted).to.equal(false)
      fixture.value.dispose()
      expect(signal.aborted).to.equal(true)
      pending.resolve(metrics()); await refresh; await flush()
      expect(fixture.value.metrics.value.data).to.equal(null)
    } finally { fixture.scope.stop() }
  })

  it('keeps stale local data on a retryable block failure without treating it as zero', async () => {
    let fail = false
    const client = { capabilities: async () => capability(), metrics: async () => { if (fail) throw new TypeError('network'); return metrics() }, dlq: async () => page([], null, false), audit: async () => auditPage([], null, false) }
    const fixture = board({ client })
    try {
      await fixture.value.refresh(); fail = true; await fixture.value.loadMetrics()
      expect(fixture.value.metrics.value.status).to.equal('stale')
      expect(fixture.value.metrics.value.data.outboxBacklog).to.equal(2)
      expect(fixture.value.metrics.value.error).to.include('暂时无法读取')
    } finally { fixture.scope.stop() }
  })
})

describe('command observability pagination interaction', () => {
  it('does not start a duplicate next-page request while one page is pending and rejects numeric IDs', async () => {
    const pending = deferred(); let reads = 0
    const client = {
      capabilities: async () => capability(), metrics: async () => metrics(), audit: async () => auditPage([], null, false),
      dlq: () => { reads++; return pending.promise }
    }
    const fixture = board({ client })
    try {
      const refresh = fixture.value.refresh(); await flush()
      await fixture.value.loadDlq()
      expect(reads).to.equal(1)
      pending.resolve(page([{ deliveryId: 9 }], null, false))
      await refresh; await flush()
      expect(fixture.value.dlq.value.status).to.equal('error')
      expect(fixture.value.dlq.value.items).to.deep.equal([])
    } finally { fixture.scope.stop() }
  })
})
