import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'

let Vue
let mount
let flushPromises
const wrappers = []

const loadComponent = (relativePath, id, imports) => {
  const filename = new URL(relativePath, import.meta.url)
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename: filename.pathname })
  const compiled = compileScript(descriptor, { id, inlineTemplate: true }).content
  const source = compiled
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_all, names, path) =>
      `const { ${names.split(',').map(name => name.trim().replace(/\s+as\s+/, ': ')).join(', ')} } = imports[${JSON.stringify(path)}]`)
    .replace(/^import\s+([^\s]+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_all, name, path) =>
      `const ${name} = imports[${JSON.stringify(path)}]`)
    .replace('export default', 'return')
  return new Function('imports', source)(imports)
}

const marketState = () => {
  const { ref } = Vue
  const calls = []
  return {
    calls,
    state: {
      products: ref([{ productId: 'p-1', productVersionId: 'pv-1', skillKey: 'first', canPurchase: true }]),
      selectedProduct: ref(null), targetAgent: ref(null), approvedPermissions: ref([]), quote: ref(null), order: ref(null), entitlements: ref([]),
      loading: ref(false), quoteLoading: ref(false), purchaseLoading: ref(false), orderLoading: ref(false), orderPolling: ref(false), orderPollAttempts: ref(0),
      error: ref(''), previewEnabled: ref(true), actorScopeFingerprint: ref('scope-a'), storageAvailable: ref(true), operationLockAvailable: ref(true),
      unresolvedOperations: ref([{ phase: 'QUOTE', intentFingerprint: 'quote-a', productVersionId: 'pv-1', targetAgentId: 'agent-a', expectedAgentVersion: '7' }]),
      canRequestQuote: ref(true), canPurchase: ref(false),
      loadProducts: async () => calls.push('loadProducts'), loadProduct: async () => null,
      selectProduct: product => { calls.push('selectProduct');; }, setTargetAgent: agent => calls.push(`target:${agent?.agentId || ''}`),
      setApprovedPermissions: () => {}, requestQuote: async () => {}, purchase: async () => null, pollOrder: async () => null, loadOrder: async () => null,
      resumeOperation: async () => ({ quoteId: 'sq-a' }), abandonQuote: () => { calls.push('abandonQuote'); return true }, dispose: () => {}
    }
  }
}

describe('skill market mounted lifecycle regressions', () => {
  before(async () => {
    global.SVGElement = global.window?.SVGElement
    global.Element = global.window?.Element
    global.Node = global.window?.Node
    Vue = await import('vue')
    ;({ mount, flushPromises } = await import('@vue/test-utils'))
  })
  afterEach(() => { for (const wrapper of wrappers.splice(0)) wrapper.unmount() })

  it('mounts the actual market with nested composable refs unwrapped and resumes/cancels a quote dialog', async () => {
    const controlled = marketState()
    const Card = { props: ['product'], template: '<button class="product" @click="$emit(\'select\', product)">product</button>' }
    const Dialog = { props: ['show'], emits: ['update:show'], template: '<section v-if="show" class="dialog"><button @click="$emit(\'update:show\', false)">close</button></section>' }
    const Market = loadComponent('../src/components/economy/SkillMarket.vue', 'skill-market-lifecycle', {
      vue: Vue,
      './SkillProductCard.vue': Card,
      './SkillPurchaseDialog.vue': Dialog,
      '@/composables/useSkillMarket.js': {
        useSkillMarket: () => controlled.state,
        formatEntitlementSkillFact: () => '', formatInstalledSkillFact: () => '', orderStatusLabel: () => ''
      }
    })
    const wrapper = mount(Market, { props: { previewEnabled: true, actorScopeKey: 'scope-a', targetAgent: { agentId: 'agent-a', version: '7' } }, global: { stubs: { 'var-button': { template: '<button><slot /></button>' }, 'var-loading': true, 'var-empty': true } } })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.find('.product').exists()).to.equal(true)
    expect(wrapper.findComponent({ name: 'var-loading' }).exists()).to.equal(false)
    await wrapper.find('.recovery-item button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.dialog').exists()).to.equal(true)
    await wrapper.find('.dialog button').trigger('click')
    expect(controlled.calls).to.include('abandonQuote')
  })

  it('mounts the actual route and refreshes the same target from server roster version after two sequential product purchases', async () => {
    const versions = ['7', '8', '9']
    let reads = 0
    const Market = { props: ['targetAgent'], emits: ['refresh-roster'], template: '<section><span class="version">{{ targetAgent.version }}</span><button class="first-product" @click="$emit(\'refresh-roster\')">first-product</button><button class="second-product" @click="$emit(\'refresh-roster\')">second-product</button></section>' }
    const Route = loadComponent('../src/components/economy/SkillMarketRoute.vue', 'skill-market-route-lifecycle', {
      vue: Vue,
      './SkillMarket.vue': Market,
      '@/utils/skillMarketRoster.js': { loadSkillMarketRoster: async () => ({ data: { code: 'E0', data: { items: [{ agentId: 'agent-a', name: 'A', version: versions[Math.min(reads++, versions.length - 1)], boundToMe: true, canOperate: true }] } } }) },
      '@/utils/silverAmount': { isCanonicalDecimalString: value => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) },
      '@/utils/economyPreviewCapability': { isSkillMarketplaceCapability: capability => capability?.skillMarketplaceEnabled === true, loadEconomyPreviewCapability: async () => ({ skillMarketplaceEnabled: true, principalScopeFingerprint: 'scope-a' }) }
    })
    const wrapper = mount(Route, { global: { stubs: { SkillMarket: Market } } })
    wrappers.push(wrapper)
    await flushPromises()
    await wrapper.find('select').setValue('agent-a')
    expect(wrapper.find('.version').text()).to.equal('7')
    await wrapper.find('.first-product').trigger('click')
    await flushPromises()
    expect(wrapper.find('.version').text()).to.equal('8')
    await wrapper.find('.second-product').trigger('click')
    await flushPromises()
    expect(wrapper.find('.version').text()).to.equal('9')
  })
})
