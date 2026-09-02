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
      if (url.startsWith('/skill-orders/')) return success({ orderId: 'so-1', targetAgentId: 'agent-lin', status: orderStatuses.shift() || 'ACTIVE' })
      throw new Error(`Unexpected GET ${url}`)
    },
    post: async (url, payload, options) => {
      calls.push({ method: 'POST', url, payload, options })
      if (url === '/skill-orders/quotes') {
        return success({
          quoteId: 'sq-1',
          productVersionId: payload.productVersionId,
          targetAgentId: payload.targetAgentId,
          priceMicro: '30000000'
        })
      }
      if (url === '/skill-orders') return success({ orderId: 'so-1', targetAgentId: payload.targetAgentId, status: 'FUNDS_HELD' })
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
    const market = useSkillMarket({ agentApi: api, enabled: ref(true), createIdempotencyKey: () => 'idem-1' })
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

  it('persists one purchase idempotency key across an ambiguous failure and retry', async () => {
    const storage = memoryStorage()
    const purchaseKeys = []
    let purchaseAttempts = 0
    let generated = 0
    const api = {
      get: async () => success({ entitlements: [] }),
      post: async (url, payload, options) => {
        if (url === '/skill-orders/quotes') return success({ quoteId: 'sq-stable', productVersionId: payload.productVersionId, targetAgentId: payload.targetAgentId, priceMicro: '30000000' })
        purchaseKeys.push(options.headers['Idempotency-Key'])
        purchaseAttempts += 1
        if (purchaseAttempts === 1) throw new TypeError('network connection lost after send')
        return success({ orderId: 'so-stable', targetAgentId: payload.targetAgentId, status: 'FUNDS_HELD' })
      }
    }
    const options = {
      agentApi: api,
      enabled: ref(true),
      purchaseIdempotencyStorage: storage,
      createIdempotencyKey: () => `generated-${++generated}`
    }
    const first = useSkillMarket(options)
    await preparePurchase(first)
    try { await first.purchase() } catch {}
    expect(storage.values.size).to.equal(1)

    const remounted = useSkillMarket(options)
    await preparePurchase(remounted)
    await remounted.purchase()

    expect(purchaseKeys).to.deep.equal(['generated-2', 'generated-2'])
    expect(storage.values.size).to.equal(0)
  })

  it('fences late quote responses by generation, agent version, and permission fingerprint', async () => {
    const pending = deferred()
    const api = {
      post: async () => pending.promise,
      get: async () => success([])
    }
    const market = useSkillMarket({ agentApi: api, enabled: ref(true), createIdempotencyKey: () => 'quote-key' })
    market.selectProduct(seededProducts[2])
    market.setTargetAgent({ agentId: 'agent-lin', version: '7' })
    market.setApprovedPermissions(['repo.read'])
    const request = market.requestQuote()

    market.setTargetAgent({ agentId: 'agent-lin', version: '8' })
    market.setApprovedPermissions(['repo.read', 'repo.write'])
    pending.resolve(success({ quoteId: 'late', productVersionId: 'spv-repo-test-1', targetAgentId: 'agent-lin', priceMicro: '30000000' }))

    expect(await request).to.equal(null)
    expect(market.quote.value).to.equal(null)
    expect(market.canPurchase.value).to.equal(false)
  })

  it('rejects non-E0 JsonResult business responses instead of treating them as payloads', async () => {
    expect(() => readSkillApiPayload({ data: { code: 'SKILL_NOT_AVAILABLE', msg: '商品已下架', data: seededProducts } }))
      .to.throw('商品已下架')
    const api = { get: async () => ({ data: { code: 'NOT_FOUND_OR_FORBIDDEN', msg: '不可见' } }) }
    const market = useSkillMarket({ agentApi: api, enabled: ref(true) })
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
    const market = useSkillMarket({ agentApi: api, enabled: ref(true), createIdempotencyKey: () => 'poll-key', wait: async () => {} })
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
        if (url === '/skill-orders/so-refund') return success({ orderId: 'so-refund', targetAgentId: 'agent-lin', status: 'REFUNDED' })
        if (url === '/agent-lin/skill-entitlements') return success({ entitlements: [] })
        throw new Error(`Unexpected GET ${url}`)
      }
    }
    const market = useSkillMarket({ agentApi: api, enabled: ref(true) })
    market.order.value = { orderId: 'so-refund', targetAgentId: 'agent-lin', status: 'INSTALLING' }
    await market.loadOrder()
    expect(calls).to.deep.equal(['/skill-orders/so-refund', '/agent-lin/skill-entitlements'])
    expect(market.order.value.status).to.equal('REFUNDED')
    expect(marketSource).to.include('@click="refreshOrder"')
  })

  it('fails closed by default and uses only the authoritative server canPurchase result', async () => {
    const { api, calls } = createApi()
    const disabled = useSkillMarket({ agentApi: api })
    disabled.selectProduct(seededProducts[2])
    disabled.setTargetAgent({ agentId: 'agent-a', version: '1' })
    expect(await disabled.requestQuote()).to.equal(null)
    expect(calls).to.deep.equal([])

    const market = useSkillMarket({ agentApi: api, enabled: ref(true) })
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
    expect(formatInstalledSkillFact({ skillKey: 'repo-test', version: '1.0.0' })).to.equal('repo-test@1.0.0')
    expect(marketSource).to.include('权益（服务端授权）')
    expect(marketSource).to.include('运行时已安装（独立运行时快照）')
    expect(marketSource).to.include('运行时能力（自由文本）')
    expect(dialogSource).to.include('切换目标 Agent 或批准权限会使报价失效')
  })
})
