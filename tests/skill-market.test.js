import { expect } from 'chai'
import { readFileSync } from 'fs'
import { ref } from 'vue'

import {
  codeUnitCompare,
  formatInstalledSkillFact,
  formatSilverMicro,
  normalizeApprovedPermissions,
  orderStatusLabel,
  readSkillApiPayload,
  SKILL_ORDER_STATUSES,
  formatSkillProductIdentity,
  useSkillMarket
} from '../src/composables/useSkillMarket.js'

const productCardSource = readFileSync(new URL('../src/components/economy/SkillProductCard.vue', import.meta.url), 'utf8')
const marketSource = readFileSync(new URL('../src/components/economy/SkillMarket.vue', import.meta.url), 'utf8')
const dialogSource = readFileSync(new URL('../src/components/economy/SkillPurchaseDialog.vue', import.meta.url), 'utf8')
const composableSource = readFileSync(new URL('../src/composables/useSkillMarket.js', import.meta.url), 'utf8')

const seededProducts = [
  ['repo-inspector', '0'],
  ['code-reviewer', '20000000'],
  ['repo-test', '30000000'],
  ['code-editor', '50000000'],
  ['web-builder', '60000000'],
  ['deploy-runner', '100000000']
].map(([skillKey, priceMicro]) => ({
  productId: `sp-${skillKey}`,
  productVersionId: `spv-${skillKey}-1`,
  skillKey,
  priceMicro,
  permissions: ['repo.write', 'repo.read'],
  canPurchase: skillKey !== 'deploy-runner' // authoritative server fixture, not browser role inference
}))

const success = data => ({ data: { code: 'E0', data } })

const createApi = () => {
  const calls = []
  const orderStatuses = ['INSTALLING', 'ACTIVE']
  const api = {
    get: async (url) => {
      calls.push({ method: 'GET', url })
      if (url === '/skill-products') return success({ items: seededProducts })
      if (url.includes('/skill-entitlements')) return success({ entitlements: [{ skillKey: 'repo-test', status: 'ACTIVE' }] })
      if (url.startsWith('/skill-products/')) return success(seededProducts.find(product => url.endsWith(product.productId)))
      if (url.startsWith('/skill-orders/')) return success({ orderId: 'so-1', targetAgentId: 'agent-lin', productVersionId: 'spv-repo-test-1', expectedAgentVersion: '7', status: orderStatuses.shift() || 'ACTIVE' })
      throw new Error(`Unexpected GET ${url}`)
    },
    post: async (url, payload, options) => {
      calls.push({ method: 'POST', url, payload, options })
      if (url === '/skill-orders/quotes') {
        return success({
          quoteId: 'sq-1',
          productVersionId: payload.productVersionId,
          targetAgentId: payload.targetAgentId,
          expectedAgentVersion: payload.expectedAgentVersion,
          expiresAt: String(Date.now() + 60000),
          priceMicro: '30000000'
        })
      }
      if (url === '/skill-orders') return success({ orderId: 'so-1', targetAgentId: payload.targetAgentId, productVersionId: payload.productVersionId, expectedAgentVersion: payload.expectedAgentVersion, status: 'FUNDS_HELD' })
      throw new Error(`Unexpected POST ${url}`)
    }
  }
  return { api, calls }
}

const preparePurchase = async (market, product = seededProducts[2]) => {
  market.selectProduct(product)
  market.setTargetAgent({ agentId: 'agent-lin', version: '7' })
  market.setApprovedPermissions(['repo.write', 'repo.read'])
  await market.requestQuote()
}

const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const memoryStorage = () => {
  const values = new Map()
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
    values
  }
}

describe('skill market preview', () => {
  it('keeps the frozen six seeded prices as decimal micro-silver strings', () => {
    expect(seededProducts.map(product => [product.skillKey, product.priceMicro])).to.deep.equal([
      ['repo-inspector', '0'], ['code-reviewer', '20000000'], ['repo-test', '30000000'],
      ['code-editor', '50000000'], ['web-builder', '60000000'], ['deploy-runner', '100000000']
    ])
  })

  it('formats micro-silver with BigInt without Number precision loss', () => {
    expect(formatSilverMicro('100000000')).to.equal('100 SILVER')
    expect(formatSilverMicro('9007199254740993000001')).to.equal('9007199254740993.000001 SILVER')
    expect(formatSilverMicro('not-money')).to.equal('—')
  })

  it('uses byte-stable UTF-16 code-unit ordering instead of locale-dependent sorting', () => {
    expect(['ä', 'a', 'Z', 'a'].sort(codeUnitCompare)).to.deep.equal(['Z', 'a', 'a', 'ä'])
    expect(normalizeApprovedPermissions(['ä', ' a ', 'Z', 'a'])).to.deep.equal(['Z', 'a', 'ä'])
    expect(composableSource).not.to.include('localeCompare')
    expect(dialogSource).not.to.include('localeCompare')
  })

  it('sorts and deduplicates approved permissions before the order payload', async () => {
    const { api, calls } = createApi()
    const market = useSkillMarket({ actorScopeKey: 'actor-a', agentApi: api, enabled: ref(true), createIdempotencyKey: () => 'idem-1' })
    market.selectProduct(seededProducts[2])
    market.setTargetAgent({ agentId: 'agent-lin', version: '7' })
    market.setApprovedPermissions([' repo.read ', 'repo.write', 'repo.read', '', null])
    await market.requestQuote()
    await market.purchase()

    const purchase = calls.find(call => call.url === '/skill-orders')
    expect(purchase.payload).to.deep.equal({
      quoteId: 'sq-1', productVersionId: 'spv-repo-test-1', targetAgentId: 'agent-lin',
      expectedPriceMicro: '30000000', expectedAgentVersion: '7',
      approvedPermissions: ['repo.read', 'repo.write']
    })
  })

  it('replays the original quote/purchase body and key after ambiguous reload before a new quote', async () => {
    const storage = memoryStorage()
    const purchaseCalls = []
    let quoteCalls = 0
    let generated = 0
    const api = {
      get: async () => success({ entitlements: [] }),
      post: async (url, payload, options) => {
        if (url === '/skill-orders/quotes') {
          quoteCalls += 1
          return success({ quoteId: `sq-${quoteCalls}`, productVersionId: payload.productVersionId, targetAgentId: payload.targetAgentId, expectedAgentVersion: payload.expectedAgentVersion, expiresAt: String(Date.now() + 60000), priceMicro: '30000000' })
        }
        purchaseCalls.push({ payload, key: options.headers['Idempotency-Key'] })
        if (purchaseCalls.length === 1) throw new TypeError('network connection lost after send')
        return success({ orderId: 'so-stable', targetAgentId: payload.targetAgentId, productVersionId: payload.productVersionId, expectedAgentVersion: payload.expectedAgentVersion, status: 'FUNDS_HELD' })
      }
    }
    const options = { actorScopeKey: 'actor-a', agentApi: api, enabled: ref(true), purchaseIdempotencyStorage: storage, createIdempotencyKey: () => `generated-${++generated}` }
    const first = useSkillMarket(options)
    await preparePurchase(first)
    try { await first.purchase() } catch {}

    const remounted = useSkillMarket(options)
    remounted.selectProduct(seededProducts[2])
    remounted.setTargetAgent({ agentId: 'agent-lin', version: '7' })
    remounted.setApprovedPermissions(['repo.read', 'repo.write'])
    expect(remounted.canRequestQuote.value).to.equal(false)
    expect(await remounted.requestQuote()).to.equal(null)
    await remounted.purchase()

    expect(quoteCalls).to.equal(1)
    expect(purchaseCalls.map(call => call.key)).to.deep.equal(['generated-2', 'generated-2'])
    expect(purchaseCalls[1].payload).to.deep.equal(purchaseCalls[0].payload)
    expect(purchaseCalls[1].payload.quoteId).to.equal('sq-1')
    expect(JSON.parse([...storage.values.values()][0]).records).to.have.length(1)
  })

  it('keeps multiple unresolved intents isolated instead of overwriting a global slot', async () => {
    const storage = memoryStorage()
    const requests = []
    let generated = 0
    const api = {
      get: async () => success({ entitlements: [] }),
      post: async (url, payload, options) => {
        if (url === '/skill-orders/quotes') return success({ quoteId: `sq-${payload.targetAgentId}-${payload.productVersionId}`, productVersionId: payload.productVersionId, targetAgentId: payload.targetAgentId, expectedAgentVersion: payload.expectedAgentVersion, expiresAt: String(Date.now() + 60000), priceMicro: '30000000' })
        requests.push({ payload, key: options.headers['Idempotency-Key'] })
        throw new TypeError('ambiguous send')
      }
    }
    const market = useSkillMarket({ actorScopeKey: 'actor-a', agentApi: api, enabled: ref(true), purchaseIdempotencyStorage: storage, createIdempotencyKey: () => `key-${++generated}` })
    await preparePurchase(market, seededProducts[2])
    try { await market.purchase() } catch {}
    market.selectProduct(seededProducts[3])
    market.setTargetAgent({ agentId: 'agent-song', version: '9' })
    market.setApprovedPermissions(['repo.read'])
    await market.requestQuote()
    try { await market.purchase() } catch {}

    const journal = JSON.parse([...storage.values.values()][0])
    expect(journal.records).to.have.length(2)
    expect(journal.records.map(record => record.purchaseRequest.quoteId)).to.deep.equal(['sq-agent-lin-spv-repo-test-1', 'sq-agent-song-spv-code-editor-1'])
    expect(journal.records.map(record => record.orderIdempotencyKey)).to.deep.equal(['key-2', 'key-4'])
    expect(requests).to.have.length(2)
  })

  it('clears a journal entry only when the matching order reaches a terminal state', async () => {
    const storage = memoryStorage()
    const { api } = createApi()
    const market = useSkillMarket({ actorScopeKey: 'actor-a', agentApi: api, enabled: ref(true), purchaseIdempotencyStorage: storage, createIdempotencyKey: () => 'stable-key', wait: async () => {} })
    await preparePurchase(market)
    await market.purchase()
    expect(JSON.parse([...storage.values.values()][0]).records).to.have.length(1)
    await market.pollOrder({ maxAttempts: 2, intervalMs: 0 })
    expect(storage.values.size).to.equal(0)
  })

  it('fences late quote responses by generation, agent version, and permission fingerprint', async () => {
    const pending = deferred()
    const api = {
      post: async () => pending.promise,
      get: async () => success([])
    }
    const market = useSkillMarket({ actorScopeKey: 'actor-a', agentApi: api, enabled: ref(true), createIdempotencyKey: () => 'quote-key' })
    market.selectProduct(seededProducts[2])
    market.setTargetAgent({ agentId: 'agent-lin', version: '7' })
    market.setApprovedPermissions(['repo.read'])
    const request = market.requestQuote()

    market.setTargetAgent({ agentId: 'agent-lin', version: '8' })
    market.setApprovedPermissions(['repo.read', 'repo.write'])
    pending.resolve(success({ quoteId: 'late', productVersionId: 'spv-repo-test-1', targetAgentId: 'agent-lin', expectedAgentVersion: '7', expiresAt: String(Date.now() + 60000), priceMicro: '30000000' }))

    expect(await request).to.equal(null)
    expect(market.quote.value).to.equal(null)
    expect(market.canPurchase.value).to.equal(false)
  })


  it('fails closed for expired or mismatched quote echoes', async () => {
    const responses = [
      { quoteId: 'expired', productVersionId: 'spv-repo-test-1', targetAgentId: 'agent-lin', expectedAgentVersion: '7', expiresAt: '1000', priceMicro: '30000000' },
      { quoteId: 'wrong-target', productVersionId: 'spv-repo-test-1', targetAgentId: 'agent-song', expectedAgentVersion: '7', expiresAt: '2000', priceMicro: '30000000' }
    ]
    const api = { get: async () => success([]), post: async () => success(responses.shift()) }
    const market = useSkillMarket({ actorScopeKey: 'actor-a', agentApi: api, enabled: ref(true), now: () => 1000 })
    market.selectProduct(seededProducts[2])
    market.setTargetAgent({ agentId: 'agent-lin', version: '7' })
    market.setApprovedPermissions(['repo.read'])
    expect(await market.requestQuote()).to.equal(null)
    expect(market.quote.value).to.equal(null)
    expect(market.canPurchase.value).to.equal(false)
    expect(await market.requestQuote()).to.equal(null)
    expect(market.error.value).to.include('恢复操作')
  })

  it('fences stale order responses and preserves terminal order monotonicity', async () => {
    const first = deferred()
    const second = deferred()
    const responses = [first, second]
    const api = { get: async () => responses.shift().promise }
    const market = useSkillMarket({ actorScopeKey: 'actor-a', agentApi: api, enabled: ref(true) })
    market.setTargetAgent({ agentId: 'agent-lin', version: '7' })
    market.order.value = { orderId: 'so-1', targetAgentId: 'agent-lin', productVersionId: 'spv-repo-test-1', expectedAgentVersion: '7', status: 'FUNDS_HELD' }
    const stale = market.loadOrder()
    const latest = market.loadOrder()
    second.resolve(success({ orderId: 'so-1', targetAgentId: 'agent-lin', productVersionId: 'spv-repo-test-1', expectedAgentVersion: '7', status: 'INSTALLING' }))
    await latest
    first.resolve(success({ orderId: 'so-1', targetAgentId: 'agent-lin', productVersionId: 'spv-repo-test-1', expectedAgentVersion: '7', status: 'ACTIVE' }))
    expect(await stale).to.equal(null)
    expect(market.order.value.status).to.equal('INSTALLING')

    const terminalApi = { get: async () => success({ orderId: 'so-1', targetAgentId: 'agent-lin', productVersionId: 'spv-repo-test-1', expectedAgentVersion: '7', status: 'ACTIVE' }) }
    const terminalMarket = useSkillMarket({ actorScopeKey: 'actor-a', agentApi: terminalApi, enabled: ref(true) })
    terminalMarket.setTargetAgent({ agentId: 'agent-lin', version: '7' })
    terminalMarket.order.value = { orderId: 'so-1', targetAgentId: 'agent-lin', productVersionId: 'spv-repo-test-1', expectedAgentVersion: '7', status: 'INSTALLING' }
    await terminalMarket.loadOrder()
    terminalApi.get = async () => success({ orderId: 'so-1', targetAgentId: 'agent-lin', productVersionId: 'spv-repo-test-1', expectedAgentVersion: '7', status: 'INSTALLING' })
    expect(await terminalMarket.loadOrder()).to.equal(null)
    expect(terminalMarket.order.value.status).to.equal('ACTIVE')
  })

  it('fences delayed entitlement responses to the current target agent', async () => {
    const lin = deferred()
    const song = deferred()
    const api = { get: async url => url.includes('agent-lin') ? lin.promise : song.promise }
    const market = useSkillMarket({ actorScopeKey: 'actor-a', agentApi: api, enabled: ref(true) })
    market.setTargetAgent({ agentId: 'agent-lin', version: '7' })
    const stale = market.loadEntitlements()
    market.setTargetAgent({ agentId: 'agent-song', version: '8' })
    const latest = market.loadEntitlements()
    song.resolve(success({ entitlements: [{ skillKey: 'repo-test', skillVersion: '2.0.0', productVersionId: 'spv-song', status: 'ACTIVE' }] }))
    await latest
    lin.resolve(success({ entitlements: [{ skillKey: 'repo-test', skillVersion: '1.0.0', productVersionId: 'spv-lin', status: 'ACTIVE' }] }))
    expect(await stale).to.equal(null)
    expect(market.entitlements.value[0].productVersionId).to.equal('spv-song')
  })

  it('rejects order responses whose echoed target or version identity differs from the purchase', async () => {
    const storage = memoryStorage()
    const api = {
      get: async () => success([]),
      post: async (url, payload) => url === '/skill-orders/quotes'
        ? success({ quoteId: 'sq-1', productVersionId: payload.productVersionId, targetAgentId: payload.targetAgentId, expectedAgentVersion: payload.expectedAgentVersion, expiresAt: String(Date.now() + 60000), priceMicro: '30000000' })
        : success({ orderId: 'so-bad', targetAgentId: payload.targetAgentId, productVersionId: 'spv-other', expectedAgentVersion: payload.expectedAgentVersion, status: 'FUNDS_HELD' })
    }
    const market = useSkillMarket({ actorScopeKey: 'actor-a', agentApi: api, enabled: ref(true), purchaseIdempotencyStorage: storage, createIdempotencyKey: () => 'bad-response-key' })
    await preparePurchase(market)
    expect(await market.purchase()).to.equal(null)
    expect(market.order.value).to.equal(null)
    expect(JSON.parse([...storage.values.values()][0]).records).to.have.length(1)
  })

  it('rejects non-E0 JsonResult business responses instead of treating them as payloads', async () => {
    expect(() => readSkillApiPayload({ data: { code: 'SKILL_NOT_AVAILABLE', msg: '商品已下架', data: seededProducts } }))
      .to.throw('商品已下架')
    const api = { get: async () => ({ data: { code: 'NOT_FOUND_OR_FORBIDDEN', msg: '不可见' } }) }
    const market = useSkillMarket({ actorScopeKey: 'actor-a', agentApi: api, enabled: ref(true) })
    try {
      await market.loadProducts()
      throw new Error('expected business failure')
    } catch (error) {
      expect(error.code).to.equal('NOT_FOUND_OR_FORBIDDEN')
      expect(market.products.value).to.deep.equal([])
      expect(market.error.value).to.equal('不可见')
    }
  })

  it('polls order status within a bound and refreshes entitlements on ACTIVE', async () => {
    const { api, calls } = createApi()
    const market = useSkillMarket({ actorScopeKey: 'actor-a', agentApi: api, enabled: ref(true), createIdempotencyKey: () => 'poll-key', wait: async () => {} })
    await preparePurchase(market)
    await market.purchase()
    const terminal = await market.pollOrder({ maxAttempts: 6, intervalMs: 0 })

    expect(terminal.status).to.equal('ACTIVE')
    expect(market.orderPollAttempts.value).to.equal(2)
    expect(calls.filter(call => call.url === '/skill-orders/so-1')).to.have.length(2)
    expect(calls.filter(call => call.url === '/agent-lin/skill-entitlements')).to.have.length(1)
    expect(market.entitlements.value[0].skillKey).to.equal('repo-test')
  })

  it('manual order refresh handles REFUNDED as terminal and refreshes entitlements', async () => {
    const calls = []
    const api = {
      get: async (url) => {
        calls.push(url)
        if (url === '/skill-orders/so-refund') return success({ orderId: 'so-refund', targetAgentId: 'agent-lin', productVersionId: 'spv-repo-test-1', expectedAgentVersion: '7', status: 'REFUNDED' })
        if (url === '/agent-lin/skill-entitlements') return success({ entitlements: [] })
        throw new Error(`Unexpected GET ${url}`)
      }
    }
    const market = useSkillMarket({ actorScopeKey: 'actor-a', agentApi: api, enabled: ref(true) })
    market.setTargetAgent({ agentId: 'agent-lin', version: '7' })
    market.order.value = { orderId: 'so-refund', targetAgentId: 'agent-lin', productVersionId: 'spv-repo-test-1', expectedAgentVersion: '7', status: 'INSTALLING' }
    await market.loadOrder()
    expect(calls).to.deep.equal(['/skill-orders/so-refund', '/agent-lin/skill-entitlements'])
    expect(market.order.value.status).to.equal('REFUNDED')
    expect(marketSource).to.include('@click="refreshOrder"')
  })

  it('fails closed by default and uses only the authoritative server canPurchase result', async () => {
    const { api, calls } = createApi()
    const disabled = useSkillMarket({ actorScopeKey: 'actor-a', agentApi: api })
    disabled.selectProduct(seededProducts[2])
    disabled.setTargetAgent({ agentId: 'agent-a', version: '1' })
    expect(await disabled.requestQuote()).to.equal(null)
    expect(calls).to.deep.equal([])

    const market = useSkillMarket({ actorScopeKey: 'actor-a', agentApi: api, enabled: ref(true) })
    market.selectProduct(seededProducts[5])
    market.setTargetAgent({ agentId: 'agent-admin-looking', version: '1', roles: ['admin'] })
    expect(market.canRequestQuote.value).to.equal(false)
    expect(await market.requestQuote()).to.equal(null)
    expect(calls).to.deep.equal([])
    expect(productCardSource).to.include('product.canPurchase !== true')
    expect(productCardSource).not.to.match(/deploy-runner.*admin|admin.*deploy-runner/is)
  })

  it('keeps order lifecycle labels and exact installed runtime versions separate from entitlements', () => {
    expect(orderStatusLabel(SKILL_ORDER_STATUSES.FUNDS_HELD)).to.include('托管')
    expect(orderStatusLabel(SKILL_ORDER_STATUSES.INSTALLING)).to.include('安装')
    expect(orderStatusLabel(SKILL_ORDER_STATUSES.ACTIVE)).to.include('激活')
    expect(orderStatusLabel(SKILL_ORDER_STATUSES.REFUNDED)).to.include('退款')
    expect(formatInstalledSkillFact({ skillKey: 'repo-test', skillVersion: '2.1.0' })).to.equal('repo-test@2.1.0')
    expect(formatInstalledSkillFact({ skillKey: 'repo-test', version: '1.0.0' })).to.equal('repo-test@版本未报告')
    expect(formatSkillProductIdentity({ skillKey: 'repo-test', skillVersion: '2.1.0', productVersionId: 'spv-repo-test-2', version: '99' })).to.equal('repo-test@2.1.0/spv-repo-test-2')
    expect(marketSource).to.include('权益（服务端授权）')
    expect(marketSource).to.include('运行时已安装（独立运行时快照）')
    expect(marketSource).to.include('运行时能力（自由文本）')
    expect(dialogSource).to.include('切换目标 Agent 或批准权限会使报价失效')
  })
})

describe('skill market recovery hardening', () => {
  const storageFailureCases = [
    ['denied reads', { getItem: () => { throw new Error('denied') }, setItem: () => {}, removeItem: () => {} }],
    ['quota writes', { getItem: () => null, setItem: () => { throw new Error('quota') }, removeItem: () => {} }],
    ['failed write readback', (() => { const values = new Map(); return { getItem: key => values.get(key) || null, setItem: () => {}, removeItem: () => {} } })()]
  ]

  for (const [name, storage] of storageFailureCases) {
    it(`fails closed before quote POST when recovery storage has ${name}`, async () => {
      const calls = []
      const market = useSkillMarket({ actorScopeKey: 'actor-a', enabled: ref(true), purchaseIdempotencyStorage: storage, agentApi: { get: async () => success([]), post: async (...args) => { calls.push(args); return success({}) } } })
      market.selectProduct(seededProducts[2])
      market.setTargetAgent({ agentId: 'agent-lin', version: '7' })
      market.setApprovedPermissions(['repo.read'])
      try { await market.requestQuote() } catch (error) { expect(error.code).to.equal('PURCHASE_RECOVERY_STORAGE_UNAVAILABLE') }
      expect(calls).to.have.length(0)
      expect(market.error.value).to.include('浏览器存储')
      expect(market.canRequestQuote.value).to.equal(false)
    })
  }

  it('fails closed before order POST if persisting the canonical order replay record fails', async () => {
    const values = new Map()
    let denyWrites = false
    const storage = {
      getItem: key => values.has(key) ? values.get(key) : null,
      setItem: (key, value) => { if (denyWrites) throw new Error('quota'); values.set(key, value) },
      removeItem: key => values.delete(key)
    }
    const calls = []
    const api = {
      get: async () => success([]),
      post: async (url, payload, options) => {
        calls.push({ url, payload, key: options.headers['Idempotency-Key'] })
        return success({ quoteId: 'sq-1', productVersionId: payload.productVersionId, targetAgentId: payload.targetAgentId, expectedAgentVersion: payload.expectedAgentVersion, expiresAt: String(Date.now() + 60000), priceMicro: '30000000' })
      }
    }
    const market = useSkillMarket({ actorScopeKey: 'actor-a', enabled: ref(true), purchaseIdempotencyStorage: storage, agentApi: api })
    market.selectProduct(seededProducts[2]); market.setTargetAgent({ agentId: 'agent-lin', version: '7' }); market.setApprovedPermissions(['repo.read'])
    await market.requestQuote()
    denyWrites = true
    try { await market.purchase() } catch (error) { expect(error.code).to.equal('PURCHASE_RECOVERY_STORAGE_UNAVAILABLE') }
    expect(calls.map(call => call.url)).to.deep.equal(['/skill-orders/quotes'])
    expect(market.error.value).to.include('浏览器存储')
  })

  it('requires an authenticated actor scope before purchasing', async () => {
    const calls = []
    const market = useSkillMarket({ enabled: ref(true), agentApi: { get: async () => success([]), post: async (...args) => { calls.push(args); return success({}) } } })
    market.selectProduct(seededProducts[2])
    market.setTargetAgent({ agentId: 'agent-lin', version: '7' })
    expect(await market.requestQuote()).to.equal(null)
    expect(calls).to.deep.equal([])
    expect(market.storageAvailable.value).to.equal(false)
    expect(market.actorScopeFingerprint.value).to.equal('')
  })

  it('partitions unresolved records by actor scope and never replays another actor record', async () => {
    const storage = memoryStorage()
    const calls = []
    const api = {
      get: async () => success([]),
      post: async (url, payload, options) => {
        calls.push({ url, payload, key: options.headers['Idempotency-Key'] })
        throw new TypeError('ambiguous')
      }
    }
    const first = useSkillMarket({ actorScopeKey: 'tenant-a:client-a:principal-a', enabled: ref(true), purchaseIdempotencyStorage: storage, agentApi: api, createIdempotencyKey: () => 'actor-a-quote' })
    first.selectProduct(seededProducts[2]); first.setTargetAgent({ agentId: 'agent-lin', version: '7' }); first.setApprovedPermissions(['repo.read'])
    try { await first.requestQuote() } catch {}
    const second = useSkillMarket({ actorScopeKey: 'tenant-b:client-b:principal-b', enabled: ref(true), purchaseIdempotencyStorage: storage, agentApi: { get: async () => success([]), post: async () => success({ quoteId: 'sq-b', productVersionId: 'spv-repo-test-1', targetAgentId: 'agent-lin', expectedAgentVersion: '7', expiresAt: String(Date.now() + 60000), priceMicro: '30000000' }) }, createIdempotencyKey: () => 'actor-b-quote' })
    second.selectProduct(seededProducts[2]); second.setTargetAgent({ agentId: 'agent-lin', version: '7' }); second.setApprovedPermissions(['repo.read'])
    expect(second.unresolvedOperations.value).to.deep.equal([])
    expect(await second.requestQuote()).to.have.property('quoteId', 'sq-b')
    expect(storage.values.size).to.equal(2)
  })

  it('restores an ambiguous quote exactly after reload without recreating hidden intent', async () => {
    const storage = memoryStorage()
    const calls = []
    const api = {
      get: async () => success([]),
      post: async (url, payload, options) => {
        calls.push({ url, payload, key: options.headers['Idempotency-Key'] })
        if (calls.length === 1) throw new TypeError('lost after send')
        return success({ quoteId: 'sq-restored', productVersionId: payload.productVersionId, targetAgentId: payload.targetAgentId, expectedAgentVersion: payload.expectedAgentVersion, expiresAt: String(Date.now() + 60000), priceMicro: '30000000' })
      }
    }
    const first = useSkillMarket({ actorScopeKey: 'actor-a', enabled: ref(true), purchaseIdempotencyStorage: storage, agentApi: api, createIdempotencyKey: () => 'quote-replay-key' })
    first.selectProduct(seededProducts[2]); first.setTargetAgent({ agentId: 'agent-lin', version: '7' }); first.setApprovedPermissions(['repo.write', 'repo.read'])
    try { await first.requestQuote() } catch {}
    const reloaded = useSkillMarket({ actorScopeKey: 'actor-a', enabled: ref(true), purchaseIdempotencyStorage: storage, agentApi: api, createIdempotencyKey: () => 'must-not-generate' })
    expect(reloaded.unresolvedOperations.value).to.have.length(1)
    expect(reloaded.selectedProduct.value).to.equal(null)
    const recovered = await reloaded.resumeOperation(reloaded.unresolvedOperations.value[0])
    expect(recovered.quoteId).to.equal('sq-restored')
    expect(reloaded.target.value).to.deep.include({ targetAgentId: 'agent-lin', expectedAgentVersion: '7' })
    expect(reloaded.approvedPermissions.value).to.deep.equal(['repo.read', 'repo.write'])
    expect(calls[1]).to.deep.equal(calls[0])
  })

  it('resumes an old unresolved operation with its persisted agent version after agent refresh', async () => {
    const storage = memoryStorage()
    const attempts = []
    const api = { get: async () => success([]), post: async (url, payload, options) => { attempts.push({ payload, key: options.headers['Idempotency-Key'] }); if (attempts.length === 1) throw new TypeError('ambiguous'); return success({ quoteId: 'sq-old', productVersionId: payload.productVersionId, targetAgentId: payload.targetAgentId, expectedAgentVersion: payload.expectedAgentVersion, expiresAt: String(Date.now() + 60000), priceMicro: '30000000' }) } }
    const first = useSkillMarket({ actorScopeKey: 'actor-a', enabled: ref(true), purchaseIdempotencyStorage: storage, agentApi: api, createIdempotencyKey: () => 'old-version-key' })
    first.selectProduct(seededProducts[2]); first.setTargetAgent({ agentId: 'agent-lin', version: '7' }); first.setApprovedPermissions(['repo.read'])
    try { await first.requestQuote() } catch {}
    const reloaded = useSkillMarket({ actorScopeKey: 'actor-a', enabled: ref(true), purchaseIdempotencyStorage: storage, agentApi: api })
    reloaded.setTargetAgent({ agentId: 'agent-lin', version: '8' })
    await reloaded.resumeOperation(reloaded.unresolvedOperations.value[0])
    expect(attempts[1]).to.deep.equal(attempts[0])
    expect(reloaded.target.value.expectedAgentVersion).to.equal('7')
  })

  it('rejects Java Long/CAS versions supplied as numbers in input and responses', async () => {
    const calls = []
    const input = useSkillMarket({ actorScopeKey: 'actor-a', enabled: ref(true), agentApi: { get: async () => success([]), post: async (...args) => { calls.push(args); return success({}) } } })
    input.selectProduct(seededProducts[2]); input.setTargetAgent({ agentId: 'agent-lin', version: 9007199254740993 })
    expect(input.target.value.expectedAgentVersion).to.equal('')
    expect(await input.requestQuote()).to.equal(null)
    expect(calls).to.deep.equal([])
    const response = useSkillMarket({ actorScopeKey: 'actor-b', enabled: ref(true), agentApi: { get: async () => success([]), post: async (url, payload) => success({ quoteId: 'sq-number', productVersionId: payload.productVersionId, targetAgentId: payload.targetAgentId, expectedAgentVersion: 7, expiresAt: String(Date.now() + 60000), priceMicro: '30000000' }) } })
    response.selectProduct(seededProducts[2]); response.setTargetAgent({ agentId: 'agent-lin', version: '7' })
    expect(await response.requestQuote()).to.equal(null)
    expect(response.quote.value).to.equal(null)
  })

  it('fences out-of-order product detail responses before state mutation', async () => {
    const first = deferred(); const second = deferred()
    const pending = [first, second]
    const market = useSkillMarket({ actorScopeKey: 'actor-a', enabled: ref(true), agentApi: { get: async () => pending.shift().promise } })
    const stale = market.loadProduct('sp-old')
    const latest = market.loadProduct('sp-new')
    second.resolve(success({ ...seededProducts[3], productId: 'sp-new' }))
    expect((await latest).productId).to.equal('sp-new')
    first.resolve(success({ ...seededProducts[2], productId: 'sp-old' }))
    expect(await stale).to.equal(null)
    expect(market.selectedProduct.value.productId).to.equal('sp-new')
  })

  it('keeps the recovery UI and explicit actor scope component contract', () => {
    expect(marketSource).to.include('actorScopeKey')
    expect(marketSource).to.include('发现未解决购买操作')
    expect(marketSource).to.include('恢复操作')
  })
})
