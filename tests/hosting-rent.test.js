import { expect } from 'chai'
import { ref } from 'vue'
import { readFileSync } from 'node:fs'
import { useHostingRent } from '../src/composables/juyiting/useHostingRent.js'
import { useHallData } from '../src/composables/juyiting/useHallData.js'
import { createApi } from '../src/composables/useHttp.js'
import { identityCleanupHandlerCount, stopIdentityBoundWork } from '../src/utils/identityLifecycle.js'
import { hostingPersona, hostingQuote, hostingReceipt, hostingLookup, activeHostingLookup,
  freeReprovisionReceipt, memoryHostingStorage } from './hosting-rent-fixtures.js'

const ok = data => ({ data: { code: 'E0', data } })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { resolve, promise } }
const rents = []
const harness = (overrides = {}) => {
  const requests = []
  const persona = hostingPersona()
  const storage = memoryHostingStorage()
  let key = 0
  const rent = useHostingRent({ enabled: true, storage, now: () => 2000,
    createKey: () => `00000000-0000-4000-8000-${String(++key).padStart(12, '0')}`,
    loadCapability: async () => ({ economyPreviewEnabled: true, principalScopeFingerprint: 'opaque-scope-a' }),
    economyApi: { get: async (url, params, options) => { requests.push({ url, params, options }); return ok({ currency: 'SILVER', availableMicro: '9999999999', heldMicro: '0' }) } },
    agentApi: {
      create: async (url, body, options) => { requests.push({ url, body, options }); return ok(url.endsWith('/quotes') ? hostingQuote() : hostingReceipt()) },
      get: async (url, params, options) => { requests.push({ url, params, options }); return ok(hostingLookup()) }
    }, ...overrides })
  rents.push(rent)
  return { rent, persona, requests, storage }
}
const posts = h => h.requests.filter(request => request.body)
const owned = () => hostingPersona({ bound: true, boundToMe: true, agentId: 'agt_server_proposal' })

describe('hosting rent frozen HTTP integration', () => {
  afterEach(() => { for (const rent of rents.splice(0)) rent.dispose() })

  it('uses only the server quote before explicit confirmation; 202 reservation is not ready', async () => {
    const h = harness()
    expect(await h.rent.open(h.persona)).to.equal(true)
    expect(await h.rent.previewInitial()).to.equal(true)
    expect(posts(h)).to.have.length(1)
    expect(posts(h)[0].body).to.deep.equal({ purpose: 'INITIAL' })
    expect(h.rent.state.value.quote).to.deep.equal(hostingQuote())
    expect(h.rent.canConfirm.value).to.equal(true)
    expect(await h.rent.confirmQuote()).to.equal(true)
    expect(posts(h)[1].body).to.deep.equal({ mode: 'server', hostingAction: 'INITIAL', agentId: 'agt_server_proposal', quoteId: 'hq-1',
      expectedPlanVersion: '7', expectedAmountMicro: '1234500000', expectedPeriodSeconds: '172800' })
    expect(h.rent.state.value.accepted.receipt.status).to.equal('FUNDS_RESERVED')
    expect(h.rent.state.value.lookup.admission).to.equal('PENDING')
    expect(h.rent.canInitial.value).to.equal(false)
    expect(h.rent.canRenew.value).to.equal(false)
    expect(await h.rent.confirmQuote()).to.equal(false)
    expect(posts(h)).to.have.length(2)
  })

  it('cancel sends no bind; expired quote never silently obtains replacement terms', async () => {
    let clock = 2000
    const h = harness({ now: () => clock })
    await h.rent.open(h.persona)
    await h.rent.previewInitial()
    h.rent.cancelQuote()
    expect(await h.rent.confirmQuote()).to.equal(false)
    expect(posts(h)).to.have.length(1)
    await h.rent.previewInitial()
    clock = 9999999999999
    expect(await h.rent.confirmQuote()).to.equal(false)
    expect(posts(h)).to.have.length(2)
    expect(h.rent.quoteExpired.value).to.equal(true)
  })

  it('suppresses duplicate inflight confirmation and keeps confirmed payment on readback failure', async () => {
    const waiting = deferred()
    let binds = 0
    const h = harness({ agentApi: {
      create: async url => { if (url.endsWith('/quotes')) return ok(hostingQuote()); binds += 1; return waiting.promise },
      get: async () => { throw new TypeError('readback lost') }
    } })
    await h.rent.open(h.persona)
    await h.rent.previewInitial()
    const pending = h.rent.confirmQuote()
    expect(await h.rent.confirmQuote()).to.equal(false)
    waiting.resolve(ok(hostingReceipt()))
    expect(await pending).to.equal(true)
    expect(h.rent.state.value.refreshPending).to.equal(true)
    expect(h.rent.state.value.accepted.receipt.status).to.equal('FUNDS_RESERVED')
    expect(h.rent.state.value.operation).to.equal(null)
    expect(h.rent.canInitial.value).to.equal(false)
    expect(await h.rent.refresh()).to.equal(false)
    expect(binds).to.equal(1)
  })

  for (const malformed of [
    { amountMicro: 1234500000 }, { planVersion: '07' }, { periodSeconds: '0' }, { expiresAt: '01' },
    { personaCode: 'other' }, { currency: 'CNY' }, { purpose: 'OTHER' }
  ]) {
    it(`rejects malformed server quote ${JSON.stringify(malformed)}`, async () => {
      const h = harness({ agentApi: { create: async () => ok(hostingQuote(malformed)) } })
      await h.rent.open(h.persona)
      expect(await h.rent.previewInitial()).to.equal(false)
      expect(h.rent.state.value.quote).to.equal(null)
      expect(h.rent.canConfirm.value).to.equal(false)
    })
  }

  it('requires canonical wallet amounts and never sends a claim with insufficient availability', async () => {
    const h = harness({ economyApi: { get: async () => ok({ currency: 'SILVER', availableMicro: '1', heldMicro: '0' }) } })
    await h.rent.open(h.persona)
    await h.rent.previewInitial()
    expect(await h.rent.confirmQuote()).to.equal(false)
    expect(posts(h)).to.have.length(1)
    const malformed = harness({ economyApi: { get: async () => ok({ currency: 'SILVER', availableMicro: 9007199254740993, heldMicro: '0' }) } })
    expect(await malformed.rent.open(malformed.persona)).to.equal(false)
    expect(malformed.rent.wallet.value).to.equal(null)
  })

  it('fences a changed explicit persona/binding before confirming', async () => {
    let current = hostingPersona()
    const h = harness({ resolvePersona: () => current })
    await h.rent.open(current)
    await h.rent.previewInitial()
    current = owned()
    expect(await h.rent.confirmQuote()).to.equal(false)
    expect(posts(h)).to.have.length(1)
  })

  it('does not infer an existing Agent from a hidden selection or role code', async () => {
    const h = harness()
    expect(await h.rent.open(hostingPersona({ bound: true, boundToMe: true }))).to.equal(false)
    expect(h.requests).to.have.length(0)
    const other = harness()
    expect(await other.rent.open(hostingPersona({ bound: true, boundToMe: false, agentId: 'someone-else' }))).to.equal(false)
    expect(other.requests).to.have.length(0)
  })

  it('requires server capability plus opaque scope, with no token/wallet fallback', async () => {
    for (const capability of [null, {}, { economyPreviewEnabled: false }, { economyPreviewEnabled: true }, []]) {
      const h = harness({ loadCapability: async () => capability })
      expect(await h.rent.open(h.persona)).to.equal(false)
      expect(h.requests).to.have.length(0)
    }
    const disabled = harness({ enabled: false })
    expect(await disabled.rent.open(disabled.persona)).to.equal(false)
    expect(disabled.requests).to.have.length(0)
  })

  it('uses POST/create renewal quote and canonical lease version, with a separate explicit paid confirmation', async () => {
    let lookup = activeHostingLookup({ lease: { version: '9007199254740993' } })
    const requests = []
    const h = harness({ agentApi: {
      get: async () => ok(lookup),
      create: async (url, body, options) => {
        requests.push({ url, body, key: options.headers['Idempotency-Key'] })
        if (url.endsWith('/renewal-quotes')) return ok(hostingQuote({ purpose: 'RENEWAL', leaseId: 'hl-1', expectedLeaseVersion: '9007199254740993' }))
        lookup = activeHostingLookup({ lease: { version: '9007199254740994', paidThrough: '345601000' }, intent: { intentId: 'hi-renew', version: '1' } })
        return ok(hostingReceipt({ status: 'ACTIVE', intentId: 'hi-renew', transactionId: 'tx-renew' }))
      }
    } })
    await h.rent.open(owned())
    expect(await h.rent.previewRenewal()).to.equal(true)
    expect(requests).to.have.length(1)
    expect(requests[0].url).to.equal('/hosting-leases/hl-1/renewal-quotes')
    expect(requests[0].body).to.deep.equal({ agentId: 'agt_server_proposal', expectedLeaseVersion: '9007199254740993' })
    expect(await h.rent.confirmQuote()).to.equal(true)
    expect(requests[1].url).to.equal('/hosting-leases/hl-1/renewals')
    expect(requests[1].body).to.deep.equal({ agentId: 'agt_server_proposal', quoteId: 'hq-1', expectedLeaseVersion: '9007199254740993',
      expectedPlanVersion: '7', expectedAmountMicro: '1234500000', expectedPeriodSeconds: '172800' })
    expect(h.rent.state.value.lookup.lease.version).to.equal('9007199254740994')
    expect(h.rent.state.value.lookup.lease.paidThrough).to.equal('345601000')
  })

  it('rejects a quote after lease version changes, and ignores later older snapshots', async () => {
    let lookup = activeHostingLookup()
    let mutations = 0
    const h = harness({ agentApi: {
      get: async () => ok(lookup),
      create: async () => { mutations += 1; return ok(hostingQuote({ purpose: 'RENEWAL', leaseId: 'hl-1', expectedLeaseVersion: '3' })) }
    } })
    await h.rent.open(owned())
    await h.rent.previewRenewal()
    lookup = activeHostingLookup({ lease: { version: '4' }, intent: { version: '4' } })
    await h.rent.refresh()
    expect(await h.rent.confirmQuote()).to.equal(false)
    expect(mutations).to.equal(1)
    lookup = activeHostingLookup()
    expect(await h.rent.refresh()).to.equal(false)
    expect(h.rent.state.value.lookup.lease.version).to.equal('4')
  })

  it('free reprovision uses only lease CAS, zero-charge immutable acceptance, without a quote or renewal', async () => {
    let lookup = activeHostingLookup()
    const requests = []
    const h = harness({ agentApi: {
      get: async () => ok(lookup),
      create: async (url, body) => {
        requests.push({ url, body })
        lookup = activeHostingLookup({ lease: { version: '4' }, reprovision: { requestId: 'hr-1', version: '1', status: 'ACCEPTED', requestedAt: '2000', serviceReadyAt: null } })
        return ok(freeReprovisionReceipt())
      }
    } })
    await h.rent.open(owned())
    expect(await h.rent.reprovision()).to.equal(true)
    expect(requests).to.deep.equal([{ url: '/personas/linchong/bind', body: { mode: 'server', hostingAction: 'REPROVISION',
      agentId: 'agt_server_proposal', leaseId: 'hl-1', expectedLeaseVersion: '3' } }])
    expect(h.rent.state.value.accepted.receipt.amountMicro).to.equal('0')
    expect(h.rent.state.value.lookup.lease.paidThrough).to.equal('172801000')
    expect(h.rent.canReprovision.value).to.equal(false)
    expect(await h.rent.reprovision()).to.equal(false)
    expect(requests).to.have.length(1)
  })

  it('expired leases offer manual renewal but never free reprovision; refunds remain canonical', async () => {
    let lookup = activeHostingLookup({ admission: 'RENEWAL_REQUIRED', lease: { paidThrough: '2000' } })
    const h = harness({ agentApi: { get: async () => ok(lookup) } })
    await h.rent.open(owned())
    expect(h.rent.canRenew.value).to.equal(true)
    expect(h.rent.canReprovision.value).to.equal(false)
    lookup = hostingLookup({ lease: { status: 'REFUNDED', version: '4' }, intent: { status: 'REFUNDED', version: '4', refundTransactionId: 'tx-refund' }, admission: 'INITIAL_REQUIRED' })
    // A different already-refunded binding is loaded fresh, never fabricated from an error.
    const refunded = harness({ agentApi: { get: async () => ok(lookup) } })
    await refunded.rent.open(owned())
    expect(refunded.rent.state.value.lookup.intent.refundTransactionId).to.equal('tx-refund')
    expect(refunded.rent.canInitial.value).to.equal(true)
    expect(refunded.rent.canReprovision.value).to.equal(false)
  })

  it('persists an unknown original request across disposal and exactly replays it after expiry', async () => {
    const storage = memoryHostingStorage()
    const sent = []
    let lost = true
    const api = {
      create: async (url, body, options) => {
        sent.push({ url, body, key: options.headers['Idempotency-Key'] })
        if (url.endsWith('/quotes')) return ok(hostingQuote())
        if (lost) { lost = false; throw new TypeError('response lost') }
        return ok(hostingReceipt())
      }, get: async () => ok(hostingLookup())
    }
    const first = harness({ storage, agentApi: api })
    await first.rent.open(first.persona)
    await first.rent.previewInitial()
    expect(await first.rent.confirmQuote()).to.equal(false)
    first.rent.dispose()
    const resumed = harness({ storage, agentApi: api, now: () => 9999999999999 })
    await resumed.rent.open(owned())
    expect(await resumed.rent.retryUnknown()).to.equal(true)
    expect(sent).to.have.length(3)
    expect(sent[2]).to.deep.equal(sent[1])
    expect(sent.filter(item => item.url.endsWith('/quotes'))).to.have.length(1)
  })

  it('recovers an unknown renewal after readback advanced beyond the saved quote version', async () => {
    const storage = memoryHostingStorage()
    let lookup = activeHostingLookup()
    let lost = true
    const sent = []
    const api = {
      get: async () => ok(lookup),
      create: async (url, body, options) => {
        sent.push({ url, body, key: options.headers['Idempotency-Key'] })
        if (url.endsWith('/renewal-quotes')) return ok(hostingQuote({ purpose: 'RENEWAL', leaseId: 'hl-1', expectedLeaseVersion: '3' }))
        if (lost) { lost = false; throw new TypeError('renewal response lost') }
        return ok(hostingReceipt({ status: 'ACTIVE', intentId: 'hi-renew', transactionId: 'tx-renew' }))
      }
    }
    const first = harness({ storage, agentApi: api })
    await first.rent.open(owned()); await first.rent.previewRenewal(); await first.rent.confirmQuote()
    lookup = activeHostingLookup({ lease: { version: '4', paidThrough: '345601000' }, intent: { intentId: 'hi-renew', version: '1' } })
    await first.rent.refresh()
    first.rent.dispose()
    const resumed = harness({ storage, agentApi: api })
    expect(await resumed.rent.open(owned())).to.equal(true)
    expect(await resumed.rent.retryUnknown()).to.equal(true)
    expect(sent).to.have.length(3)
    expect(sent[2]).to.deep.equal(sent[1])
    expect(resumed.rent.state.value.lookup.lease.version).to.equal('4')
  })

  it('does not replay another principal’s unknown payment', async () => {
    const storage = memoryHostingStorage()
    const first = harness({ storage, agentApi: { create: async url => {
      if (url.endsWith('/quotes')) return ok(hostingQuote())
      throw new TypeError('lost')
    } } })
    await first.rent.open(first.persona); await first.rent.previewInitial(); await first.rent.confirmQuote()
    first.rent.dispose()
    const next = harness({ storage, loadCapability: async () => ({ economyPreviewEnabled: true, principalScopeFingerprint: 'opaque-scope-b' }) })
    await next.rent.open(next.persona)
    expect(next.rent.state.value.operation).to.equal(null)
    expect(await next.rent.retryUnknown()).to.equal(false)
    expect(posts(next)).to.have.length(0)
  })

  it('aborts disposal/scope changes, fences delayed A replies from B, and unregisters cleanup', async () => {
    const baseline = identityCleanupHandlerCount()
    const waiting = deferred()
    let firstSignal
    const h = harness({ loadCapability: async ({ signal }) => { firstSignal = signal; return waiting.promise } })
    const pending = h.rent.open(h.persona)
    h.rent.dispose()
    expect(firstSignal.aborted).to.equal(true)
    waiting.resolve({ economyPreviewEnabled: true, principalScopeFingerprint: 'old' })
    expect(await pending).to.equal(false)
    expect(h.requests).to.have.length(0)
    expect(identityCleanupHandlerCount()).to.equal(baseline)
    const delayed = deferred()
    let first = true
    const switched = harness({ loadCapability: async () => {
      if (first) { first = false; return delayed.promise }
      return { economyPreviewEnabled: true, principalScopeFingerprint: 'new' }
    } })
    const old = switched.rent.open(switched.persona)
    await switched.rent.open(hostingPersona({ personaCode: 'wuyong' }))
    delayed.resolve({ economyPreviewEnabled: true, principalScopeFingerprint: 'old' })
    expect(await old).to.equal(false)
    expect(switched.rent.target.value.personaCode).to.equal('wuyong')
    stopIdentityBoundWork()
    expect(switched.rent.ready.value).to.equal(false)
    expect(switched.rent.state.value.accepted).to.equal(null)
  })

  for (const failure of [
    { status: 409, code: 'INSUFFICIENT_SILVER', unknown: false },
    { status: 503, code: 'HOSTING_RENT_NOT_READY', unknown: false },
    { status: 503, code: 'HOSTING_RENT_UNAVAILABLE', unknown: true }
  ]) {
    it(`uses real useHttp ${failure.status}/${failure.code}, never falling back to legacy free server bind`, async () => {
      const originalFetch = globalThis.fetch
      const requests = []
      globalThis.fetch = async (url, options) => {
        const body = options.body ? JSON.parse(options.body) : null
        requests.push({ url, method: options.method, body })
        const failed = url.endsWith('/bind')
        const data = url.endsWith('/wallet') ? { currency: 'SILVER', availableMicro: '9999999999', heldMicro: '0' } : hostingQuote()
        return new Response(JSON.stringify(failed ? { code: failure.code, msg: 'frozen rejection' } : { code: 'E0', data }),
          { status: failed ? failure.status : 200, headers: { 'Content-Type': 'application/json' } })
      }
      try {
        const authStore = { authorizationGeneration: 1, token: async () => 'test-only-token' }
        const agent = createApi('/agent')
        const economy = createApi('/economy')
        const h = harness({ agentApi: {
          create: (url, body, options) => agent.create(url, body, { ...options, authStore }),
          get: (url, params, options) => agent.get(url, params, { ...options, authStore })
        }, economyApi: { get: (url, params, options) => economy.get(url, params, { ...options, authStore }) } })
        await h.rent.open(h.persona); await h.rent.previewInitial()
        expect(await h.rent.confirmQuote()).to.equal(false)
        expect(Boolean(h.rent.state.value.operation)).to.equal(failure.unknown)
        expect(requests.map(item => item.method)).to.deep.equal(['GET', 'POST', 'POST'])
        expect(requests.filter(item => item.url.endsWith('/bind'))).to.have.length(1)
        expect(requests[2].body.hostingAction).to.equal('INITIAL')
      } finally { globalThis.fetch = originalFetch }
    })
  }

  it('honors actual useHttp HTTP202 acceptance followed by GET canonical lookup', async () => {
    const originalFetch = globalThis.fetch
    const requests = []
    globalThis.fetch = async (url, options) => {
      requests.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : null, key: options.headers['Idempotency-Key'] })
      const data = url.endsWith('/wallet') ? { currency: 'SILVER', availableMicro: '9999999999', heldMicro: '0' } :
        url.endsWith('/quotes') ? hostingQuote() : url.endsWith('/bind') ? hostingReceipt() : hostingLookup()
      return new Response(JSON.stringify({ code: 'E0', data }), { status: url.endsWith('/bind') ? 202 : 200, headers: { 'Content-Type': 'application/json' } })
    }
    try {
      const authStore = { authorizationGeneration: 1, token: async () => 'test-only-token' }
      const api = createApi('/agent')
      const walletApi = createApi('/economy')
      const h = harness({ agentApi: {
        create: (url, body, options) => api.create(url, body, { ...options, authStore }),
        get: (url, params, options) => api.get(url, params, { ...options, authStore })
      }, economyApi: { get: (url, params, options) => walletApi.get(url, params, { ...options, authStore }) } })
      await h.rent.open(h.persona); await h.rent.previewInitial()
      expect(await h.rent.confirmQuote()).to.equal(true)
      expect(requests.map(item => item.method)).to.deep.equal(['GET', 'POST', 'POST', 'GET', 'GET'])
      expect(requests[3].url).to.equal('/agent/agt_server_proposal/hosting-lease')
      expect(requests[1].key).to.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      expect(requests[2].key).not.to.equal(requests[1].key)
      expect(h.rent.state.value.accepted.receipt.status).to.equal('FUNDS_RESERVED')
      expect(h.rent.state.value.lookup.lease.status).to.equal('PROVISIONING')
    } finally { globalThis.fetch = originalFetch }
  })

  for (const mismatch of [{ agentId: 'other' }, { quoteId: 'other' }, { status: 'ACTIVE' }, { amountMicro: '1' }, { occurredAt: 1000 }]) {
    it(`does not accept mismatched immutable receipt ${JSON.stringify(mismatch)}`, async () => {
      let reads = 0
      const h = harness({ agentApi: {
        create: async url => ok(url.endsWith('/quotes') ? hostingQuote() : hostingReceipt(mismatch)),
        get: async () => { reads += 1; return ok(hostingLookup()) }
      } })
      await h.rent.open(h.persona); await h.rent.previewInitial()
      expect(await h.rent.confirmQuote()).to.equal(false)
      expect(h.rent.state.value.accepted).to.equal(null)
      expect(h.rent.state.value.operation.kind).to.equal('INITIAL')
      expect(reads).to.equal(0)
    })
  }

  it('fails closed before POST when persistent recovery or canonical UUID generation is unavailable', async () => {
    const h = harness({ storage: { getItem: () => null, setItem: () => { throw new Error('storage blocked') } } })
    await h.rent.open(h.persona)
    expect(await h.rent.previewInitial()).to.equal(false)
    expect(posts(h)).to.have.length(0)
    const invalid = harness({ createKey: () => 'not-a-canonical-uuid' })
    await invalid.rent.open(invalid.persona)
    expect(await invalid.rent.previewInitial()).to.equal(false)
    expect(posts(invalid)).to.have.length(0)
  })

  it('keeps local/default bind rent-free, and refuses legacy server bind before making a request', async () => {
    const requests = []
    const data = useHallData({ agentApi: {
      post: async (url, body, options) => { requests.push({ url, body }); options.onSuccess({ data: { mode: 'local', agentId: 'local-agent' } }) },
      get: async (_url, _params, options) => options.onSuccess?.({ data: [] }),
      search: async (_url, _params, options) => options.onSuccess?.({ data: [] })
    }, selectedAgent: ref(null), selectedTask: ref(null), log: { warn: () => {} }, normalizeStatus: value => value, taskAgentMatchScore: () => 0 })
    expect((await data.bindPersona(hostingPersona())).mode).to.equal('local')
    expect((await data.bindPersona(hostingPersona(), 'local')).mode).to.equal('local')
    let rejected = false
    try { await data.bindPersona(hostingPersona(), 'server') } catch { rejected = true }
    expect(rejected).to.equal(true)
    expect(requests.map(item => item.body)).to.deep.equal([{ mode: 'local' }, { mode: 'local' }])
  })

  it('keeps rent integration outside the accepted R4 funded-bounty action section', () => {
    const hall = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
    const panel = readFileSync(new URL('../src/components/juyiting/PersonaCatalogPanel.vue', import.meta.url), 'utf8')
    expect(hall).to.include('@hosting-changed="refreshHall({ silent: true })"')
    expect(panel).to.include('<HostingRentPanel')
    expect(panel).to.include("if (mode === 'server')")
  })
})
