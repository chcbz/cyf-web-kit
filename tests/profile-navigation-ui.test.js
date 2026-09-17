import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { assessReadOnlyPreviewCapabilities } from '../src/utils/economyReadOnlyPreviewPolicy.js'
import * as profileNavigation from '../src/utils/profileNavigation.js'

const Vue = await import('vue')
const VueRouter = await import('vue-router')
const { mount, flushPromises } = await import('@vue/test-utils')
const { compileScript, parse } = await import('@vue/compiler-sfc')

global.history = global.window?.history
global.Element = global.window?.Element
global.SVGElement = global.window?.SVGElement
global.Node = global.window?.Node

const wrappers = []
const deferred = () => {
  let resolve
  let reject
  return { promise: new Promise((res, rej) => { resolve = res; reject = rej }), resolve, reject }
}
const capabilities = enabled => ({
  contractVersion: 'economy-readonly-v1', mode: 'READ_ONLY_PREVIEW', enabled, principalScopeFingerprint: 'scope-current',
  features: { wallet: false, ledger: false, catalog: false, installationStatus: false, hostingPlan: false, hostingLease: false },
  actions: { estimate: false, issue: false, purchase: false, settle: false, refund: false, install: false, hostingActivate: false, hostingRenew: false }
})

const compileComponent = (relativePath, id, imports, env = {}) => {
  const filename = new URL(relativePath, import.meta.url)
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename: filename.pathname })
  const compiled = compileScript(descriptor, { id, inlineTemplate: true }).content
  const executable = compiled
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_all, names, path) =>
      `const { ${names.split(',').map(name => name.trim().replace(/\s+as\s+/, ': ')).join(', ')} } = imports[${JSON.stringify(path)}]`)
    .replace(/^import\s+([^\s]+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_all, name, path) =>
      `const ${name} = imports[${JSON.stringify(path)}]`)
    .replaceAll('import.meta.env', '__env')
    .replace('export default', 'return')
  return new Function('imports', '__env', executable)(imports, env)
}

const routerAt = async path => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/profile', name: 'UserProfile', component: { template: '<div />' } },
      { path: '/economy-preview', name: 'EconomyReadOnlyPreview', component: { template: '<div />' } },
      { path: '/juyiting', name: 'JuyiHall', component: { template: '<div />' } }
    ]
  })
  await router.push(path)
  await router.isReady()
  return router
}

const profileComponent = ({ globalStore, apiStore, client }) => compileComponent('../src/components/UserProfile.vue', 'profile-navigation-mounted', {
  vue: Vue,
  'vue-router': VueRouter,
  '@/stores/global': { useGlobalStore: () => globalStore },
  '@/stores/api': { useApiStore: () => apiStore },
  '@/composables/useAccountSecuritySession': { useAccountSecuritySession: () => ({ busy: Vue.ref(false), error: Vue.ref(''), status: Vue.ref(''), signOutCurrentDevice: () => {}, signOutAllDevices: async () => true }) },
  '@/composables/useConfirmationDialog': { useConfirmationDialog: () => ({ cancelButton: Vue.ref(null), close: () => {}, confirming: Vue.ref(false), dialog: Vue.ref(null), onKeydown: () => {}, open: () => {} }) },
  '@/utils/silverAmount': { isEconomyPreviewBuildEnabled: () => false },
  '@/utils/economyPreviewCapability': { isEconomyPreviewCapability: () => false, loadEconomyPreviewCapability: async () => ({}) },
  '@/utils/economyReadOnlyPreviewPolicy': { assessReadOnlyPreviewCapabilities },
  '@/composables/economyReadOnlyPreviewApi': { economyReadOnlyPreviewClient: client },
  '@/utils/profileNavigation': profileNavigation
}, { VITE_ECONOMY_READONLY_PREVIEW_ENABLED: 'true', VITE_ECONOMY_PREVIEW_ENABLED: 'false' })

const previewComponent = state => compileComponent('../src/components/economy/EconomyReadOnlyPreview.vue', 'preview-navigation-mounted', {
  vue: Vue,
  '@/stores/global.js': { useGlobalStore: () => ({ setTitle: () => {}, setShowBack: () => {}, setShowMore: () => {} }) },
  '@/utils/silverAmount.js': { formatSilverMicro: value => `${value} SILVER` },
  '@/composables/useEconomyReadOnlyPreview.js': { useEconomyReadOnlyPreview: () => state }
})

describe('profile navigation mounted behavior', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => { for (const wrapper of wrappers.splice(0)) wrapper.unmount() })

  it('fences stale capability data, reloads after identity changes, clears a guard query, and recovers on retry', async () => {
    const first = deferred(); const second = deferred(); const third = deferred()
    const responses = [first.promise, second.promise, third.promise]
    const client = { capabilities: () => responses.shift() }
    const globalStore = Vue.reactive({ user: Vue.reactive({ id: 'user-a', username: 'alice', openid: 'a' }), setTitle: () => {}, setShowBack: () => {}, setShowMore: () => {} })
    const apiStore = Vue.reactive({ authorizationGeneration: 0 })
    const router = await routerAt('/profile?preview=unavailable')
    const wrapper = mount(profileComponent({ globalStore, apiStore, client }), { global: { plugins: [router], stubs: { 'var-icon': true } } })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.text()).to.include('正在确认经济预览是否可用')

    apiStore.authorizationGeneration += 1
    await flushPromises()
    expect(router.currentRoute.value.query).not.to.have.property('preview')

    first.resolve(capabilities(true))
    await flushPromises()
    expect(wrapper.find('a[href="/economy-preview"]').exists()).to.equal(false)

    second.reject(new Error('network'))
    await flushPromises()
    expect(wrapper.text()).to.include('经济只读预览暂时不可用')
    expect(wrapper.text()).to.not.include('未读取或修改任何经济数据')

    await wrapper.get('.discovery-links button').trigger('click')
    third.resolve(capabilities(true))
    await flushPromises()
    expect(wrapper.find('a[href="/economy-preview"]').exists()).to.equal(true)

    await wrapper.get('a[href="/economy-preview"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).to.equal('EconomyReadOnlyPreview')
  })

  it('reloads capabilities after a same-mounted user identity switch', async () => {
    const first = deferred(); const second = deferred()
    const responses = [first.promise, second.promise]
    const globalStore = Vue.reactive({ user: Vue.reactive({ id: 'user-a', username: 'alice', openid: 'a' }), setTitle: () => {}, setShowBack: () => {}, setShowMore: () => {} })
    const apiStore = Vue.reactive({ authorizationGeneration: 0 })
    const router = await routerAt('/profile')
    const wrapper = mount(profileComponent({ globalStore, apiStore, client: { capabilities: () => responses.shift() } }), { global: { plugins: [router], stubs: { 'var-icon': true } } })
    wrappers.push(wrapper)
    globalStore.user = Vue.reactive({ id: 'user-b', username: 'bob', openid: 'b' })
    first.resolve(capabilities(true))
    await flushPromises()
    expect(wrapper.find('a[href="/economy-preview"]').exists()).to.equal(false)
    second.resolve(capabilities(true))
    await flushPromises()
    expect(wrapper.find('a[href="/economy-preview"]').exists()).to.equal(true)
  })

  it('uses replace for both mounted explicit return buttons', async () => {
    const router = await routerAt('/profile')
    const profile = mount(profileComponent({
      globalStore: Vue.reactive({ user: Vue.reactive({ id: 'user-a', username: 'alice', openid: 'a' }), setTitle: () => {}, setShowBack: () => {}, setShowMore: () => {} }),
      apiStore: Vue.reactive({ authorizationGeneration: 0 }),
      client: { capabilities: async () => capabilities(true) }
    }), { global: { plugins: [router], stubs: { 'var-icon': true } } })
    wrappers.push(profile)
    await flushPromises()
    await profile.get('.profile-page-header button').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).to.equal('JuyiHall')

    const previewState = {
      capabilityError: Vue.ref(''), enabled: Vue.ref(false), refresh: async () => {}, canonical: () => true, selectedAgentId: Vue.ref(''), selectedAgent: Vue.ref(null), agents: Vue.ref([]),
      wallet: Vue.ref({}), ledger: Vue.ref({}), catalog: Vue.ref({}), detail: Vue.ref({}), roster: Vue.ref({}), estimate: Vue.ref({}), agentSkills: Vue.ref({}), hostingPlan: Vue.ref({}), hostingLease: Vue.ref({}),
      loadLedger: async () => {}, loadCatalog: async () => {}, loadDetail: async () => {}, loadAgentFacts: async () => {}, submitEstimate: async () => {}
    }
    await router.push('/economy-preview')
    const preview = mount(previewComponent(previewState), { global: { plugins: [router] } })
    wrappers.push(preview)
    await preview.get('.header-actions button').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).to.equal('UserProfile')
  })
})
