import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createPinia, setActivePinia } from 'pinia'

let Vue
let mount
let flushPromises
let marketModule
let pinia
let useApiStore
const wrappers = []
const domDescriptors = {}
const storageKey = 'cyf.skill-market.purchase-journal.v3.actor-a'
const locks = { request: async (_name, _options, callback) => callback({}) }

const compile = (file, id, imports) => {
  const filename = new URL(file, import.meta.url)
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename: filename.pathname })
  const code = compileScript(descriptor, { id, inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_m, names, path) => `const { ${names.split(',').map(x => x.trim().replace(/\s+as\s+/, ': ')).join(', ')} } = imports[${JSON.stringify(path)}]`)
    .replace(/^import\s+([^\s]+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_m, name, path) => `const ${name} = imports[${JSON.stringify(path)}]`)
    .replace('export default', 'return')
  return new Function('imports', code)(imports)
}

const response = (data, status = 200) => new Response(JSON.stringify({ code: 'E0', data }), {
  status,
  headers: { 'Content-Type': 'application/json' }
})

// Keep the actual capability utility in the Route chain while injecting its one
// aliased dependency for Node's SFC Function harness.
const loadEconomyPreviewCapability = async () => {
  const source = readFileSync(new URL('../src/utils/economyPreviewCapability.js', import.meta.url), 'utf8')
  const { economyApi } = await import('../src/composables/useHttp.js')
  const body = source
    .replace(/^import\s+\{\s*economyApi\s*\}\s+from\s+['"]@\/composables\/useHttp['"];?\s*$/gm, 'const economyApi = imports.economyApi')
    .replace(/^export\s+const\s+/gm, 'const ')
  return new Function('imports', `${body}\nreturn { readEconomyCapability, isEconomyPreviewCapability, isSkillMarketplaceCapability, loadEconomyPreviewCapability }`)({ economyApi })
}

const installDom = () => {
  for (const key of ['SVGElement', 'Element', 'Node', 'localStorage', 'location']) {
    domDescriptors[key] = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: globalThis.window?.[key] })
  }
  domDescriptors.locks = Object.getOwnPropertyDescriptor(globalThis.navigator, 'locks')
  Object.defineProperty(globalThis.navigator, 'locks', { configurable: true, value: locks })
}

const restoreDom = () => {
  for (const key of ['SVGElement', 'Element', 'Node', 'localStorage', 'location']) {
    const descriptor = domDescriptors[key]
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else delete globalThis[key]
  }
  if (domDescriptors.locks) Object.defineProperty(globalThis.navigator, 'locks', domDescriptors.locks)
  else delete globalThis.navigator.locks
}

const settle = async () => {
  await flushPromises()
  await Vue.nextTick()
  await flushPromises()
}

const waitForUi = async (wrapper, predicate) => {
  for (let turn = 0; turn < 100; turn++) {
    await settle()
    if (predicate()) return
    await new Promise(resolve => window.setTimeout(resolve, 5))
  }
  expect(predicate(), wrapper.html()).to.equal(true)
}

const trackedFetch = (handler) => {
  let pending = 0
  return {
    fetch: async (...args) => {
      pending += 1
      try { return await handler(...args) } finally { pending -= 1 }
    },
    pending: () => pending
  }
}

const settleOwnedTransport = async (transport) => {
  for (let turn = 0; turn < 100; turn++) {
    await settle()
    if (transport.pending() === 0) return true
    await new Promise(resolve => window.setTimeout(resolve, 5))
  }
  return transport.pending() === 0
}

const waitForRosterRefresh = async (wrapper, requests, transport, expectedCount) => {
  await waitForUi(wrapper, () => transport.pending() === 0 && requests.filter(request => request.path === '/agent/roster').length === expectedCount)
  expect(requests.filter(request => request.path === '/agent/roster')).to.have.length(expectedCount)
}

const unmountOwned = async (wrapper, transport) => {
  await settleOwnedTransport(transport)
  wrapper.unmount()
  const index = wrappers.indexOf(wrapper)
  if (index >= 0) wrappers.splice(index, 1)
  await settleOwnedTransport(transport)
}

const cleanupOwned = async (transport) => {
  await settleOwnedTransport(transport)
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  await settleOwnedTransport(transport)
}

const installToken = () => {
  window.localStorage.setItem('api_token', JSON.stringify({ data: 'test-token', expTime: Date.now() + 60_000 }))
}

const varlet = () => {
  const VarButton = Vue.defineComponent({
    inheritAttrs: false,
    setup (_props, { attrs, slots }) { return () => Vue.h('button', attrs, slots.default?.()) }
  })
  const VarDialog = Vue.defineComponent({
    props: { show: Boolean },
    emits: ['update:show'],
    setup (props, { slots }) { return () => props.show ? Vue.h('section', { class: 'var-dialog' }, slots.default?.()) : null }
  })
  return {
    components: {
      'var-button': VarButton,
      'var-dialog': VarDialog,
      'var-loading': Vue.defineComponent({ render: () => Vue.h('span') }),
      'var-empty': Vue.defineComponent({ render: () => Vue.h('span') })
    }
  }
}

const components = async (id) => {
  const Card = compile('../src/components/economy/SkillProductCard.vue', `${id}-card`, { vue: Vue, '@/composables/useSkillMarket.js': marketModule })
  const Dialog = compile('../src/components/economy/SkillPurchaseDialog.vue', `${id}-dialog`, { vue: Vue, '@/composables/useSkillMarket.js': marketModule })
  const Market = compile('../src/components/economy/SkillMarket.vue', `${id}-market`, {
    vue: Vue,
    './SkillProductCard.vue': Card,
    './SkillPurchaseDialog.vue': Dialog,
    '@/composables/useSkillMarket.js': marketModule
  })
  const roster = await import('../src/utils/skillMarketRoster.js')
  const amounts = await import('../src/utils/silverAmount.js')
  const capability = await loadEconomyPreviewCapability()
  return compile('../src/components/economy/SkillMarketRoute.vue', `${id}-route`, {
    vue: Vue,
    './SkillMarket.vue': Market,
    '@/utils/skillMarketRoster.js': roster,
    '@/utils/silverAmount': amounts,
    '@/utils/economyPreviewCapability': capability
  })
}

const mountRoute = async (id) => {
  const Route = await components(id)
  const wrapper = mount(Route, { attachTo: document.body, global: { ...varlet(), plugins: [pinia] } })
  wrappers.push(wrapper)
  // useHttp dynamically imports the auth store; two flushPromises turns are not
  // a readiness contract. Wait for the real capability/roster mount to finish.
  await waitForUi(wrapper, () => !wrapper.text().includes('正在核对服务端预览能力'))
  expect(wrapper.text()).not.to.include('正在核对服务端预览能力')
  expect(wrapper.find('[role="alert"]').exists(), wrapper.html()).to.equal(false)
  return wrapper
}

const productButton = (wrapper, skillKey) => {
  const card = wrapper.findAll('.skill-product-card').find(item => item.text().includes(skillKey))
  expect(card, `missing product ${skillKey}`).to.exist
  return card.find('button')
}

const dialogButton = (wrapper, text) => {
  const dialog = wrapper.find('.purchase-dialog')
  expect(dialog.exists(), 'purchase dialog is visible').to.equal(true)
  const button = dialog.findAll('button').find(item => item.text().includes(text))
  expect(button, `missing dialog action ${text}`).to.exist
  return button
}

const selectAgent = async (wrapper, agentId) => {
  expect(wrapper.find('select').exists(), wrapper.html()).to.equal(true)
  await wrapper.find('select').setValue(agentId)
  await waitForUi(wrapper, () => wrapper.find('.skill-product-card').exists())
}

const openProduct = async (wrapper, skillKey) => {
  await productButton(wrapper, skillKey).trigger('click')
  await waitForUi(wrapper, () => wrapper.find('.purchase-dialog').exists())
}

const quote = async wrapper => {
  await dialogButton(wrapper, '获取报价').trigger('click')
  await waitForUi(wrapper, () => wrapper.find('.quote-note').exists())
}

const purchase = async wrapper => {
  await dialogButton(wrapper, '确认购买').trigger('click')
  await waitForUi(wrapper, () => !wrapper.find('.purchase-dialog').exists() || wrapper.find('.skill-market .error').exists())
}

const closeDialog = async wrapper => {
  await dialogButton(wrapper, '取消').trigger('click')
  await settle()
  expect(wrapper.find('.purchase-dialog').exists()).to.equal(false)
}

const product = (id, skillKey) => ({
  productId: id,
  productVersionId: `pv-${id}`,
  skillKey,
  skillVersion: '1',
  priceMicro: '1',
  permissions: [],
  canPurchase: true
})

// This suite compiles and mounts the actual Route -> Market -> Card -> Dialog path.
// It substitutes only browser plumbing, HTTP transport, and Varlet's visual shell.
describe('R6 actual skill-market route purchase chain', () => {
  before(async () => {
    installDom()
    Vue = await import('vue')
    ;({ mount, flushPromises } = await import('@vue/test-utils'))
    marketModule = await import('../src/composables/useSkillMarket.js')
    ;({ useApiStore } = await import('../src/stores/api.js'))
  })

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)
    window.localStorage.clear()
    installToken()
    expect(await useApiStore(pinia).token()).to.equal('test-token')
  })

  afterEach(async () => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount()
    await Promise.resolve()
    window.localStorage.clear()
  })

  after(() => restoreDom())

  it('uses actual quote/dialog/purchase handlers for v7, refreshes roster, then uses v8 for a distinct product', async () => {
    const requests = []
    const products = [product('one', 'one'), product('two', 'two')]
    let rosterVersion = '7'
    let createdOrders = 0
    const originalFetch = globalThis.fetch
    const transport = trackedFetch(async (url, options = {}) => {
      const path = new URL(String(url), 'http://localhost').pathname
      const body = options.body ? JSON.parse(options.body) : null
      requests.push({ path, method: options.method, body, key: options.headers?.['Idempotency-Key'] })
      if (path === '/economy/capabilities') return response({ economyPreviewEnabled: true, skillMarketplaceEnabled: true, principalScopeFingerprint: 'actor-a' })
      if (path === '/agent/roster') return response({ items: [{ agentId: 'agent-a', name: 'Agent A', version: rosterVersion, boundToMe: true, canOperate: true }] })
      if (path === '/agent/skill-products') return response({ items: products })
      if (path.startsWith('/agent/skill-products/')) return response(products.find(item => path.endsWith(item.productId)))
      if (path === '/agent/skill-orders/quotes') return response({ quoteId: `quote-${body.productVersionId}`, productVersionId: body.productVersionId, targetAgentId: body.targetAgentId, expectedAgentVersion: body.expectedAgentVersion, priceMicro: '1', expiresAt: String(Date.now() + 60_000) })
      if (path === '/agent/skill-orders' && options.method === 'POST') {
        createdOrders += 1
        rosterVersion = '8'
        return response({ orderId: `order-${createdOrders}`, productVersionId: body.productVersionId, targetAgentId: body.targetAgentId, expectedAgentVersion: body.expectedAgentVersion, status: 'ACTIVE' })
      }
      if (path.endsWith('/skill-entitlements')) return response({ entitlements: [] })
      throw new Error(`unexpected HTTP ${options.method} ${path}`)
    })
    globalThis.fetch = transport.fetch
    try {
      const wrapper = await mountRoute('r6-sequential')
      await selectAgent(wrapper, 'agent-a')
      await openProduct(wrapper, 'one')
      await quote(wrapper)
      await purchase(wrapper)
      await waitForUi(wrapper, () => wrapper.find('option[value="agent-a"]').text().includes('v8'))
      await waitForRosterRefresh(wrapper, requests, transport, 2)
      await openProduct(wrapper, 'two')
      await quote(wrapper)
      await purchase(wrapper)
      await waitForRosterRefresh(wrapper, requests, transport, 3)

      const orderRequests = requests.filter(item => item.path === '/agent/skill-orders' && item.body?.quoteId)
      expect(orderRequests.map(item => [item.body.productVersionId, item.body.targetAgentId, item.body.expectedAgentVersion]))
        .to.deep.equal([['pv-one', 'agent-a', '7'], ['pv-two', 'agent-a', '8']])
      expect(createdOrders).to.equal(2)
    } finally {
      await cleanupOwned(transport)
      globalThis.fetch = originalFetch
    }
  })

  it('generates a QUOTE through UI for A, remounts route on B, and recovers/dialog-submits frozen A identity and version', async () => {
    const requests = []
    const savedProduct = product('a', 'alpha')
    let roster = [{ agentId: 'agent-a', name: 'Agent A', version: '7', boundToMe: true, canOperate: true }]
    const originalFetch = globalThis.fetch
    const transport = trackedFetch(async (url, options = {}) => {
      const path = new URL(String(url), 'http://localhost').pathname
      const body = options.body ? JSON.parse(options.body) : null
      requests.push({ path, method: options.method, body, key: options.headers?.['Idempotency-Key'] })
      if (path === '/economy/capabilities') return response({ economyPreviewEnabled: true, skillMarketplaceEnabled: true, principalScopeFingerprint: 'actor-a' })
      if (path === '/agent/roster') return response({ items: roster })
      if (path === '/agent/skill-products') return response({ items: [savedProduct] })
      if (path === '/agent/skill-products/a') return response(savedProduct)
      if (path === '/agent/skill-orders/quotes') return response({ quoteId: 'quote-a', productVersionId: body.productVersionId, targetAgentId: body.targetAgentId, expectedAgentVersion: body.expectedAgentVersion, priceMicro: '1', expiresAt: String(Date.now() + 60_000) })
      if (path === '/agent/skill-orders' && options.method === 'POST') return response({ orderId: 'order-a', productVersionId: body.productVersionId, targetAgentId: body.targetAgentId, expectedAgentVersion: body.expectedAgentVersion, status: 'FUNDS_HELD' })
      if (path.endsWith('/skill-entitlements')) return response({ entitlements: [] })
      throw new Error(`unexpected HTTP ${options.method} ${path}`)
    })
    globalThis.fetch = transport.fetch
    try {
      const first = await mountRoute('r6-recovery-a')
      await selectAgent(first, 'agent-a')
      await openProduct(first, 'alpha')
      await quote(first)
      const generatedJournal = JSON.parse(window.localStorage.getItem(storageKey))
      expect(generatedJournal.records).to.have.length(1)
      expect(generatedJournal.records[0]).to.include({ phase: 'QUOTE', targetAgentId: 'agent-a', expectedAgentVersion: '7' })
      await unmountOwned(first, transport)

      roster = [{ agentId: 'agent-b', name: 'Agent B', version: '9', boundToMe: true, canOperate: true }]
      const second = await mountRoute('r6-recovery-b')
      await selectAgent(second, 'agent-b')
      const recovery = second.findAll('.recovery-item button').find(item => item.text().includes('恢复操作'))
      expect(recovery).to.exist
      await recovery.trigger('click')
      await waitForUi(second, () => second.find('.purchase-dialog').exists())
      expect(second.find('.purchase-dialog').text()).to.include('目标 Agent：agent-a')
      await purchase(second)
      await waitForRosterRefresh(second, requests, transport, 3)

      const orderRequest = requests.find(item => item.path === '/agent/skill-orders' && item.body?.quoteId)
      expect(orderRequest.body).to.include({ targetAgentId: 'agent-a', expectedAgentVersion: '7', productVersionId: 'pv-a' })
    } finally {
      await cleanupOwned(transport)
      globalThis.fetch = originalFetch
    }
  })

  it('closes a known QUOTE by UI but retains an ambiguous ORDER exact key/body through close, remount, and same-request recovery', async () => {
    const requests = []
    const item = product('one', 'one')
    const orderReceiptsByKey = new Map()
    let firstOrderResponseIsLost = true
    let chargeCount = 0
    const originalFetch = globalThis.fetch
    const transport = trackedFetch(async (url, options = {}) => {
      const path = new URL(String(url), 'http://localhost').pathname
      const body = options.body ? JSON.parse(options.body) : null
      const key = options.headers?.['Idempotency-Key']
      requests.push({ path, method: options.method, body, key })
      if (path === '/economy/capabilities') return response({ economyPreviewEnabled: true, skillMarketplaceEnabled: true, principalScopeFingerprint: 'actor-a' })
      if (path === '/agent/roster') return response({ items: [{ agentId: 'agent-a', name: 'Agent A', version: '7', boundToMe: true, canOperate: true }] })
      if (path === '/agent/skill-products') return response({ items: [item] })
      if (path === '/agent/skill-products/one') return response(item)
      if (path === '/agent/skill-orders/quotes') return response({ quoteId: `quote-${requests.filter(request => request.path === path).length}`, productVersionId: body.productVersionId, targetAgentId: body.targetAgentId, expectedAgentVersion: body.expectedAgentVersion, priceMicro: '1', expiresAt: String(Date.now() + 60_000) })
      if (path === '/agent/skill-orders' && options.method === 'POST') {
        if (!orderReceiptsByKey.has(key)) {
          chargeCount += 1
          orderReceiptsByKey.set(key, { orderId: 'order-one', productVersionId: body.productVersionId, targetAgentId: body.targetAgentId, expectedAgentVersion: body.expectedAgentVersion, status: 'FUNDS_HELD' })
        }
        if (firstOrderResponseIsLost) {
          firstOrderResponseIsLost = false
          throw new TypeError('connection lost after server accepted the order')
        }
        return response(orderReceiptsByKey.get(key))
      }
      if (path.endsWith('/skill-entitlements')) return response({ entitlements: [] })
      throw new Error(`unexpected HTTP ${options.method} ${path}`)
    })
    globalThis.fetch = transport.fetch
    try {
      const first = await mountRoute('r6-order-unknown-first')
      await selectAgent(first, 'agent-a')
      await openProduct(first, 'one')
      await quote(first)
      expect(window.localStorage.getItem(storageKey)).to.not.equal(null)
      await closeDialog(first)
      expect(window.localStorage.getItem(storageKey)).to.equal(null)

      await openProduct(first, 'one')
      await quote(first)
      await purchase(first)
      await closeDialog(first)
      const retainedRaw = window.localStorage.getItem(storageKey)
      const retained = JSON.parse(retainedRaw)
      expect(retained.records).to.have.length(1)
      expect(retained.records[0].phase).to.equal('ORDER')
      const retainedKey = retained.records[0].orderIdempotencyKey
      const retainedBody = retained.records[0].purchaseRequest
      await unmountOwned(first, transport)

      const second = await mountRoute('r6-order-unknown-second')
      await selectAgent(second, 'agent-a')
      expect(window.localStorage.getItem(storageKey)).to.equal(retainedRaw)
      const recovery = second.findAll('.recovery-item button').find(button => button.text().includes('恢复操作'))
      expect(recovery).to.exist
      await recovery.trigger('click')
      await waitForUi(second, () => second.find('.order-status').exists())
      // Recovery emits an async roster refresh after exposing the order. Keep
      // the transport installed until that real request has also completed.
      await waitForRosterRefresh(second, requests, transport, 3)

      const orderRequests = requests.filter(request => request.path === '/agent/skill-orders' && request.body?.quoteId)
      expect(orderRequests).to.have.length(2)
      expect(orderRequests.map(request => request.key)).to.deep.equal([retainedKey, retainedKey])
      expect(orderRequests.map(request => request.body)).to.deep.equal([retainedBody, retainedBody])
      expect(chargeCount).to.equal(1)
    } finally {
      await cleanupOwned(transport)
      globalThis.fetch = originalFetch
    }
  })
})
