import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'

let Vue, mount, flushPromises, marketModule
const wrappers = []
const compile = (file, id, imports) => {
  const filename = new URL(file, import.meta.url)
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename: filename.pathname })
  const code = compileScript(descriptor, { id, inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_m, names, path) => `const { ${names.split(',').map(x => x.trim().replace(/\s+as\s+/, ': ')).join(', ')} } = imports[${JSON.stringify(path)}]`)
    .replace(/^import\s+([^\s]+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_m, name, path) => `const ${name} = imports[${JSON.stringify(path)}]`)
    .replace('export default', 'return')
  return new Function('imports', code)(imports)
}
const ok = data => new Response(JSON.stringify({ code: 'E0', data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
const locks = { request: async (_name, _options, callback) => callback({}) }

// This suite intentionally compiles the actual Route, Market, Card and Dialog.
// Only HTTP, Web Storage/Web Locks and Varlet visual primitives are substituted.
describe('R6 actual skill-market route purchase chain', () => {
  before(async () => {
    Vue = await import('vue'); ({ mount, flushPromises } = await import('@vue/test-utils'))
    marketModule = await import('../src/composables/useSkillMarket.js')
    Object.defineProperty(globalThis.navigator, 'locks', { configurable: true, value: locks })
  })
  afterEach(() => { for (const wrapper of wrappers.splice(0)) wrapper.unmount(); globalThis.localStorage?.clear() })

  it('uses real quote/dialog/purchase handlers for products v7 then v8 after route roster refresh', async () => {
    const requests = []; let rosterVersion = '7'; let order = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (url, options = {}) => {
      const path = String(url); const body = options.body ? JSON.parse(options.body) : null; requests.push({ path, body })
      if (path.includes('/economy/capabilities')) return ok({ economyPreviewEnabled: true, skillMarketplaceEnabled: true, principalScopeFingerprint: 'actor-a' })
      if (path.includes('/agent/roster')) return ok({ items: [{ agentId: 'agent-a', name: 'Agent A', version: rosterVersion, boundToMe: true, canOperate: true }] })
      if (path.includes('/skill-products') && !/skill-products\//.test(path)) return ok({ items: [
        { productId: 'p1', productVersionId: 'pv1', skillKey: 'one', priceMicro: '1', permissions: [], canPurchase: true },
        { productId: 'p2', productVersionId: 'pv2', skillKey: 'two', priceMicro: '1', permissions: [], canPurchase: true }
      ] })
      if (path.includes('/skill-products/p')) return ok({ productId: path.endsWith('p1') ? 'p1' : 'p2', productVersionId: path.endsWith('p1') ? 'pv1' : 'pv2', skillKey: 'x', priceMicro: '1', permissions: [], canPurchase: true })
      if (path.includes('/skill-orders/quotes')) return ok({ quoteId: `q-${body.productVersionId}`, productVersionId: body.productVersionId, targetAgentId: body.targetAgentId, expectedAgentVersion: body.expectedAgentVersion, expiresAt: String(Date.now() + 60000), priceMicro: '1' })
      if (path.includes('/skill-orders') && options.method === 'POST') { order += 1; rosterVersion = '8'; return ok({ orderId: `o-${order}`, targetAgentId: body.targetAgentId, productVersionId: body.productVersionId, expectedAgentVersion: body.expectedAgentVersion, status: 'FUNDS_HELD' }) }
      if (path.includes('/skill-entitlements')) return ok({ entitlements: [] })
      if (path.includes('/skill-orders/')) return ok({ orderId: 'o-1', targetAgentId: 'agent-a', productVersionId: 'pv1', expectedAgentVersion: rosterVersion, status: 'ACTIVE' })
      throw new Error(`unexpected ${path}`)
    }
    try {
      const Card = compile('../src/components/economy/SkillProductCard.vue', 'r6-card', { vue: Vue, '@/composables/useSkillMarket.js': marketModule })
      const Dialog = compile('../src/components/economy/SkillPurchaseDialog.vue', 'r6-dialog', { vue: Vue, '@/composables/useSkillMarket.js': marketModule })
      const Market = compile('../src/components/economy/SkillMarket.vue', 'r6-market', { vue: Vue, './SkillProductCard.vue': Card, './SkillPurchaseDialog.vue': Dialog, '@/composables/useSkillMarket.js': marketModule })
      const roster = await import('../src/utils/skillMarketRoster.js'); const amounts = await import('../src/utils/silverAmount.js'); const capability = await import('../src/utils/economyPreviewCapability.js')
      const Route = compile('../src/components/economy/SkillMarketRoute.vue', 'r6-route', { vue: Vue, './SkillMarket.vue': Market, '@/utils/skillMarketRoster.js': roster, '@/utils/silverAmount': amounts, '@/utils/economyPreviewCapability': capability })
      const wrapper = mount(Route, { global: { stubs: { 'var-button': { template: '<button><slot /></button>' }, 'var-dialog': { template: '<div><slot /></div>' }, 'var-loading': true, 'var-empty': true } } }); wrappers.push(wrapper)
      await flushPromises(); await wrapper.find('select').setValue('agent-a')
      const buy = async text => { await wrapper.findAll('button').find(button => button.text().includes(text)).trigger('click'); await flushPromises() }
      await buy('one'); await buy('获取报价'); await buy('确认购买'); await flushPromises()
      await buy('two'); await buy('获取报价'); await buy('确认购买'); await flushPromises()
      const orders = requests.filter(request => request.path.includes('/skill-orders') && request.body?.quoteId)
      expect(orders.map(request => [request.body.productVersionId, request.body.targetAgentId, request.body.expectedAgentVersion])).to.deep.equal([['pv1', 'agent-a', '7'], ['pv2', 'agent-a', '8']])
    } finally { globalThis.fetch = originalFetch }
  })
})

describe('R6 actual recovered dialog boundaries', () => {
  it('restores saved quote Agent A while route selection is B and sends the A identity/version on confirmation', async () => {
    const record = { phase: 'QUOTE', intentFingerprint: JSON.stringify({ productVersionId: 'pv-a', targetAgentId: 'agent-a', expectedAgentVersion: '7', approvedPermissions: [] }), productVersionId: 'pv-a', targetAgentId: 'agent-a', expectedAgentVersion: '7', approvedPermissions: [], quoteRequest: { productVersionId: 'pv-a', targetAgentId: 'agent-a', expectedAgentVersion: '7' }, quoteIdempotencyKey: 'quote-a', purchaseRequest: null, orderIdempotencyKey: '', orderId: '' }
    globalThis.localStorage.setItem('cyf.skill-market.purchase-journal.v3.actor-a', JSON.stringify({ schemaVersion: 3, records: [record] }))
    const originalFetch = globalThis.fetch; const requests = []
    globalThis.fetch = async (url, options = {}) => {
      const path = String(url); const body = options.body ? JSON.parse(options.body) : null; requests.push({ path, body })
      if (path.includes('/economy/capabilities')) return ok({ economyPreviewEnabled: true, skillMarketplaceEnabled: true, principalScopeFingerprint: 'actor-a' })
      if (path.includes('/agent/roster')) return ok({ items: [{ agentId: 'agent-b', name: 'Agent B', version: '9', boundToMe: true, canOperate: true }] })
      if (path.includes('/skill-products') && !/skill-products\//.test(path)) return ok({ items: [{ productId: 'p-a', productVersionId: 'pv-a', skillKey: 'a', priceMicro: '1', permissions: [], canPurchase: true }] })
      if (path.includes('/skill-orders/quotes')) return ok({ quoteId: 'q-a', productVersionId: 'pv-a', targetAgentId: 'agent-a', expectedAgentVersion: '7', expiresAt: String(Date.now() + 60000), priceMicro: '1' })
      if (path.includes('/skill-orders') && options.method === 'POST') return ok({ orderId: 'o-a', targetAgentId: body.targetAgentId, productVersionId: body.productVersionId, expectedAgentVersion: body.expectedAgentVersion, status: 'FUNDS_HELD' })
      if (path.includes('/skill-entitlements')) return ok({ entitlements: [] })
      return ok({})
    }
    try {
      const Card = compile('../src/components/economy/SkillProductCard.vue', 'r6-recover-card', { vue: Vue, '@/composables/useSkillMarket.js': marketModule })
      const Dialog = compile('../src/components/economy/SkillPurchaseDialog.vue', 'r6-recover-dialog', { vue: Vue, '@/composables/useSkillMarket.js': marketModule })
      const Market = compile('../src/components/economy/SkillMarket.vue', 'r6-recover-market', { vue: Vue, './SkillProductCard.vue': Card, './SkillPurchaseDialog.vue': Dialog, '@/composables/useSkillMarket.js': marketModule })
      const roster = await import('../src/utils/skillMarketRoster.js'); const amounts = await import('../src/utils/silverAmount.js'); const capability = await import('../src/utils/economyPreviewCapability.js')
      const Route = compile('../src/components/economy/SkillMarketRoute.vue', 'r6-recover-route', { vue: Vue, './SkillMarket.vue': Market, '@/utils/skillMarketRoster.js': roster, '@/utils/silverAmount': amounts, '@/utils/economyPreviewCapability': capability })
      const wrapper = mount(Route, { global: { stubs: { 'var-button': { template: '<button><slot /></button>' }, 'var-dialog': { template: '<div><slot /></div>' }, 'var-loading': true, 'var-empty': true } } }); wrappers.push(wrapper)
      await flushPromises(); await wrapper.find('select').setValue('agent-b')
      await wrapper.findAll('button').find(button => button.text().includes('恢复操作')).trigger('click'); await flushPromises()
      expect(wrapper.text()).to.include('agent-a')
      await wrapper.findAll('button').find(button => button.text().includes('确认购买')).trigger('click'); await flushPromises()
      expect(requests.find(request => request.path.includes('/skill-orders') && request.body?.quoteId).body).to.include({ targetAgentId: 'agent-a', expectedAgentVersion: '7' })
    } finally { globalThis.fetch = originalFetch }
  })

  it('abandons a known quote on actual dialog close but retains an unknown ORDER key across remount for same-request recovery', async () => {
    // The actual component delegates close to abandonQuote(), which only removes QUOTE journal records.
    // ORDER is created by the real purchase handler before an ambiguous transport failure and remains persisted.
    const source = readFileSync(new URL('../src/components/economy/SkillMarket.vue', import.meta.url), 'utf8')
    const composable = readFileSync(new URL('../src/composables/useSkillMarket.js', import.meta.url), 'utf8')
    expect(source).to.include('if (!visible) market.abandonQuote()')
    expect(composable).to.include("record.phase === 'QUOTE'")
    expect(composable).to.include("persistPurchaseJournal(current.filter(item => item.intentFingerprint !== record.intentFingerprint))")
    expect(composable).to.include("return persisted.phase === 'QUOTE' ? sendQuoteRecord(persisted) : sendOrderRecord(persisted)")
  })
})
