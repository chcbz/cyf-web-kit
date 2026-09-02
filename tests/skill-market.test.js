import { expect } from 'chai'
import { readFileSync } from 'fs'
import { ref } from 'vue'

import {
  formatSilverMicro,
  normalizeApprovedPermissions,
  orderStatusLabel,
  SKILL_ORDER_STATUSES,
  useSkillMarket
} from '../src/composables/useSkillMarket.js'

const productCardSource = readFileSync(new URL('../src/components/economy/SkillProductCard.vue', import.meta.url), 'utf8')
const marketSource = readFileSync(new URL('../src/components/economy/SkillMarket.vue', import.meta.url), 'utf8')
const dialogSource = readFileSync(new URL('../src/components/economy/SkillPurchaseDialog.vue', import.meta.url), 'utf8')

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
  canPurchase: skillKey !== 'deploy-runner' // server fixture: no browser-side admin inference
}))

const createApi = () => {
  const calls = []
  const api = {
    get: async (url) => {
      calls.push({ method: 'GET', url })
      if (url === '/skill-products') return { data: { data: { items: seededProducts } } }
      if (url.includes('/skill-entitlements')) return { data: { data: { entitlements: [{ skillKey: 'repo-test', status: 'ACTIVE' }] } } }
      if (url.startsWith('/skill-products/')) return { data: { data: seededProducts.find(product => url.endsWith(product.productId)) } }
      if (url.startsWith('/skill-orders/')) return { data: { data: { orderId: 'so-1', status: 'INSTALLING' } } }
      throw new Error(`Unexpected GET ${url}`)
    },
    post: async (url, payload, options) => {
      calls.push({ method: 'POST', url, payload, options })
      if (url === '/skill-orders/quotes') {
        return { data: { data: { quoteId: 'sq-1', productVersionId: payload.productVersionId, targetAgentId: payload.targetAgentId, priceMicro: '30000000' } } }
      }
      if (url === '/skill-orders') return { data: { data: { orderId: 'so-1', status: 'FUNDS_HELD' } } }
      throw new Error(`Unexpected POST ${url}`)
    }
  }
  return { api, calls }
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

  it('sorts and deduplicates approved permissions before the order payload', async () => {
    const { api, calls } = createApi()
    const market = useSkillMarket({ agentApi: api, enabled: ref(true), createIdempotencyKey: () => 'idem-1' })
    await market.loadProducts()
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
    expect(purchase.options.headers).to.deep.equal({ 'Idempotency-Key': 'idem-1' })
    expect(normalizeApprovedPermissions(['b', 'a', 'b'])).to.deep.equal(['a', 'b'])
  })

  it('fails closed by default and clears a stale quote when target or permissions change', async () => {
    const { api, calls } = createApi()
    const disabled = useSkillMarket({ agentApi: api })
    disabled.selectProduct(seededProducts[2])
    disabled.setTargetAgent({ agentId: 'agent-a', version: '1' })
    expect(await disabled.requestQuote()).to.equal(null)
    expect(calls).to.deep.equal([])

    const market = useSkillMarket({ agentApi: api, enabled: ref(true), createIdempotencyKey: () => 'idem-2' })
    market.selectProduct(seededProducts[2])
    market.setTargetAgent({ agentId: 'agent-a', version: '1' })
    await market.requestQuote()
    expect(market.quote.value.quoteId).to.equal('sq-1')
    market.setTargetAgent({ agentId: 'agent-b', version: '2' })
    expect(market.quote.value).to.equal(null)
    await market.requestQuote()
    market.setApprovedPermissions(['repo.read'])
    expect(market.quote.value).to.equal(null)
  })

  it('uses only an explicit target agent and the authoritative server canPurchase result', async () => {
    const { api, calls } = createApi()
    const market = useSkillMarket({ agentApi: api, enabled: ref(true) })
    market.selectProduct(seededProducts[5])
    market.setTargetAgent({ agentId: 'agent-admin-looking', version: '1', roles: ['admin'] })
    expect(market.canRequestQuote.value).to.equal(false)
    expect(await market.requestQuote()).to.equal(null)
    expect(calls).to.deep.equal([])
    expect(productCardSource).to.include('product.canPurchase !== true')
    expect(productCardSource).not.to.match(/deploy-runner.*admin|admin.*deploy-runner/is)
  })

  it('keeps order lifecycle labels and entitlement/runtime facts separate in the UI', () => {
    expect(orderStatusLabel(SKILL_ORDER_STATUSES.FUNDS_HELD)).to.include('托管')
    expect(orderStatusLabel(SKILL_ORDER_STATUSES.INSTALLING)).to.include('安装')
    expect(orderStatusLabel(SKILL_ORDER_STATUSES.ACTIVE)).to.include('激活')
    expect(orderStatusLabel(SKILL_ORDER_STATUSES.REFUNDED)).to.include('退款')
    expect(marketSource).to.include('权益（服务端授权）')
    expect(marketSource).to.include('运行时已安装（独立运行时快照）')
    expect(marketSource).to.include('运行时能力（自由文本）')
    expect(dialogSource).to.include('切换目标 Agent 或批准权限会使报价失效')
  })
})
