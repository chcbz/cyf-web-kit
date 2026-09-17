import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { effectScope, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useApiStore } from '../src/stores/api.js'
import { useEconomyReadOnlyPreview } from '../src/composables/useEconomyReadOnlyPreview.js'

const Vue = await import('vue')
const { mount, flushPromises } = await import('@vue/test-utils')
global.SVGElement = global.window?.SVGElement
global.Element = global.window?.Element
global.Node = global.window?.Node
const wrappers = []
const source = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const success = data => ({ data: { code: 'E0', data } })
const deferred = () => { let resolve; let reject; return { promise: new Promise((res, rej) => { resolve = res; reject = rej }), resolve, reject } }
const tick = async () => { await Promise.resolve(); await Promise.resolve() }
const capabilities = (features = {}) => ({
  contractVersion: 'economy-readonly-v1', mode: 'READ_ONLY_PREVIEW', enabled: true, principalScopeFingerprint: 'scope-a',
  features: { wallet: false, ledger: false, catalog: false, installationStatus: false, hostingPlan: false, hostingLease: false, ...features },
  actions: { estimate: false, issue: false, purchase: false, settle: false, refund: false, install: false, hostingActivate: false, hostingRenew: false }
})
const baseClient = overrides => ({
  capabilities: async () => capabilities(), roster: async () => success({ items: [] }), wallet: async () => null, ledger: async () => ({ items: [] }), catalog: async () => ({ items: [] }), product: async () => null,
  agentSkills: async () => ({ entitlements: [], installationEvidence: [] }), hostingPlan: async () => null, hostingLease: async () => null, estimate: async () => null, ...overrides
})
const scopedPreview = client => {
  const scope = effectScope()
  return { scope, preview: scope.run(() => useEconomyReadOnlyPreview({ client })) }
}
const loadComponent = (relativePath, id, imports) => {
  const filename = new URL(relativePath, import.meta.url)
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename: filename.pathname })
  const compiled = compileScript(descriptor, { id, inlineTemplate: true }).content
  const executable = compiled
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_all, names, path) =>
      `const { ${names.split(',').map(name => name.trim().replace(/\s+as\s+/, ': ')).join(', ')} } = imports[${JSON.stringify(path)}]`)
    .replace(/^import\s+([^\s]+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_all, name, path) =>
      `const ${name} = imports[${JSON.stringify(path)}]`)
    .replace('export default', 'return')
  return new Function('imports', executable)(imports)
}

describe('economy readonly preview UI behavior', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => { for (const wrapper of wrappers.splice(0)) wrapper.unmount() })

  it('uses its own authenticated route and dedicated read namespace without legacy mutations', () => {
    const router = source('../src/router/index.js'); const profile = source('../src/components/UserProfile.vue'); const adapter = source('../src/composables/economyReadOnlyPreviewApi.js')
    expect(router).to.include("path: '/economy-preview'"); expect(router).to.include('VITE_ECONOMY_READONLY_PREVIEW_ENABLED'); expect(profile).to.include('to="/economy-preview"'); expect(adapter).to.include("createApi('/economy/preview')")
    for (const legacy of ['/quotes', '/purchase', '/bind', '/renew', '/reprovision', 'purchase-journal']) expect(adapter).not.to.include(legacy)
  })

  it('fails closed on an unknown capability protocol before rendering read cards', async () => {
    const { scope, preview } = scopedPreview(baseClient({ capabilities: async () => ({ ...capabilities({ wallet: true }), contractVersion: 'economy-readonly-v999' }) }))
    try {
      await preview.refresh()
      expect(preview.enabled.value).to.equal(false)
      expect(preview.protocolError.value).to.equal('CAPABILITIES_UNSUPPORTED_CONTRACT')
      expect(preview.wallet.value.data).to.equal(null)
    } finally { scope.stop() }
  })

  it('accepts actual roster Page.list and only retains own operable Agents', async () => {
    const { scope, preview } = scopedPreview(baseClient({
      capabilities: async () => capabilities({ installationStatus: true }),
      roster: async () => success({ list: [{ agentId: 'mine', boundToMe: true, canOperate: true }, { agentId: 'other', boundToMe: false, canOperate: true }] })
    }))
    try { await preview.refresh(); expect(preview.agents.value.map(agent => agent.agentId)).to.deep.equal(['mine']) } finally { scope.stop() }
  })

  it('fences same-card late responses, 503/404, and never converts a failed wallet into zero', async () => {
    const first = deferred(); const second = deferred(); let walletReads = 0
    const { scope, preview } = scopedPreview(baseClient({ capabilities: async () => capabilities({ wallet: true }), wallet: () => (++walletReads === 1 ? first.promise : second.promise) }))
    try {
      const firstRefresh = preview.refresh(); await tick(); expect(preview.wallet.value.status).to.equal('loading')
      const later = preview.refresh(); await tick()
      second.resolve({ currency: 'SILVER', availableMicro: '9', heldMicro: '0', version: '2' }); await later
      first.resolve({ currency: 'SILVER', availableMicro: '1', heldMicro: '0', version: '1' }); await firstRefresh
      expect(preview.wallet.value.data.availableMicro).to.equal('9')
      const unavailable = scopedPreview(baseClient({ capabilities: async () => capabilities({ wallet: true }), wallet: async () => { const error = new Error('database unavailable'); error.status = 503; throw error } }))
      await unavailable.preview.refresh(); expect(unavailable.preview.wallet.value.status).to.equal('unavailable'); expect(unavailable.preview.wallet.value.data).to.equal(null); unavailable.scope.stop()
      const missing = scopedPreview(baseClient({ capabilities: async () => capabilities({ wallet: true }), wallet: async () => { const error = new Error('not found'); error.status = 404; throw error } }))
      await missing.preview.refresh(); expect(missing.preview.wallet.value.status).to.equal('error'); expect(missing.preview.wallet.value.data).to.equal(null); missing.scope.stop()
    } finally { scope.stop() }
  })

  it('keeps unbound wallet work alive across Agent change and fences Agent/identity ABA late data', async () => {
    const wallet = deferred(); const skillA = deferred(); const skillB = deferred()
    const { scope, preview } = scopedPreview(baseClient({
      capabilities: async () => capabilities({ wallet: true, installationStatus: true }), wallet: () => wallet.promise,
      roster: async () => success({ items: [{ agentId: 'a', boundToMe: true, canOperate: true }, { agentId: 'b', boundToMe: true, canOperate: true }] }),
      agentSkills: agentId => agentId === 'a' ? skillA.promise : skillB.promise
    }))
    try {
      const initial = preview.refresh(); await tick(); preview.selectedAgentId.value = 'a'; await tick(); preview.selectedAgentId.value = 'b'; await tick()
      expect(wallet.promise).to.exist
      skillA.resolve({ agentId: 'a', entitlements: [{ skillKey: 'wrong' }], installationEvidence: [] }); await tick(); expect(preview.agentSkills.value.data?.agentId).not.to.equal('a')
      wallet.resolve({ currency: 'SILVER', availableMicro: '3', heldMicro: '0', version: '1' }); skillB.resolve({ agentId: 'b', entitlements: [], installationEvidence: [] }); await initial; expect(preview.wallet.value.data.availableMicro).to.equal('3')
      const staleWallet = deferred(); const api = useApiStore(); const aba = scopedPreview(baseClient({ capabilities: async () => capabilities({ wallet: true }), wallet: () => staleWallet.promise }))
      const read = aba.preview.refresh(); await tick(); api.authorizationGeneration += 1; api.authorizationGeneration += 1; staleWallet.resolve({ currency: 'SILVER', availableMicro: '777', heldMicro: '0', version: '1' }); await read; await tick()
      expect(aba.preview.wallet.value.data).to.equal(null); aba.scope.stop()
    } finally { scope.stop() }
  })

  it('does not append cancelled/stale pagination and preserves only the newest page', async () => {
    const pageTwo = deferred(); const pageThree = deferred(); let calls = 0
    const { scope, preview } = scopedPreview(baseClient({
      capabilities: async () => capabilities({ ledger: true }),
      ledger: ({ cursor }) => !cursor ? Promise.resolve({ items: [{ transactionId: 't1', entryId: 'e1' }], nextCursor: 'c1' }) : (++calls === 1 ? pageTwo.promise : pageThree.promise)
    }))
    try {
      await preview.refresh()
      const old = preview.loadLedger('c1'); await tick(); const newest = preview.loadLedger('c1'); await tick()
      pageTwo.resolve({ items: [{ transactionId: 'old', entryId: 'old' }], nextCursor: 'c2' }); await old
      pageThree.resolve({ items: [{ transactionId: 't2', entryId: 'e2' }], nextCursor: null }); await newest
      expect(preview.ledger.value.data.items.map(item => item.transactionId)).to.deep.equal(['t1', 't2'])
    } finally { scope.stop() }
  })

  it('does not commit a resolved roster or page after an auth microtask runs before its business continuation', async () => {
    const roster = deferred(); const nextPage = deferred()
    const { scope, preview } = scopedPreview(baseClient({
      capabilities: async () => capabilities({ ledger: true }), roster: () => roster.promise,
      ledger: ({ cursor }) => !cursor ? Promise.resolve({ items: [{ transactionId: 't1', entryId: 'e1' }], nextCursor: 'c1' }) : nextPage.promise
    }))
    try {
      const initial = preview.refresh(); await tick()
      roster.resolve(success({ items: [{ agentId: 'old', boundToMe: true, canOperate: true }] }))
      queueMicrotask(() => { useApiStore().authorizationGeneration += 1 })
      await initial; await tick()
      expect(preview.agents.value).to.deep.equal([])
      expect(preview.ledger.value.data).to.equal(null)

      const fresh = scopedPreview(baseClient({
        capabilities: async () => capabilities({ ledger: true }),
        ledger: ({ cursor }) => !cursor ? Promise.resolve({ items: [{ transactionId: 't1', entryId: 'e1' }], nextCursor: 'c1' }) : nextPage.promise
      }))
      try {
        await fresh.preview.refresh()
        const page = fresh.preview.loadLedger('c1'); await tick()
        nextPage.resolve({ items: [{ transactionId: 'old-page', entryId: 'e2' }], nextCursor: null })
        queueMicrotask(() => { useApiStore().authorizationGeneration += 1 })
        await page; await tick()
        expect(fresh.preview.ledger.value.data).to.equal(null)
      } finally { fresh.scope.stop() }
    } finally { scope.stop() }
  })

  it('does not let a stale refresh borrow a newer refresh capability result', async () => {
    const firstCapability = deferred(); const secondCapability = deferred(); let capabilityCalls = 0; let walletCalls = 0
    const { scope, preview } = scopedPreview(baseClient({
      capabilities: () => (++capabilityCalls === 1 ? firstCapability.promise : secondCapability.promise),
      wallet: async () => { walletCalls += 1; return { currency: 'SILVER', availableMicro: '1', heldMicro: '0', version: '1' } }
    }))
    try {
      const first = preview.refresh(); await tick()
      const second = preview.refresh(); await tick()
      secondCapability.resolve(capabilities({ wallet: true })); await second
      firstCapability.resolve(capabilities({ wallet: true })); await first
      expect(walletCalls).to.equal(1)
    } finally { scope.stop() }
  })

  it('mounts the actual component and shows installation evidence even with observedAt', async () => {
    const page = source('../src/components/economy/EconomyReadOnlyPreview.vue')
    const { descriptor } = parse(page, { filename: 'EconomyReadOnlyPreview.vue' })
    expect(() => compileScript(descriptor, { id: 'economy-readonly-preview' })).not.to.throw()
    const state = {
      capabilityError: ref(''), enabled: ref(true), refresh: async () => {}, canonical: value => /^\d+$/.test(value), selectedAgentId: ref('agent-a'), selectedAgent: ref({ agentId: 'agent-a' }), agents: ref([{ agentId: 'agent-a', name: 'A' }]),
      wallet: ref({ status: 'ready', data: { currency: 'SILVER', availableMicro: '0', heldMicro: '0', version: '1' }, error: '' }), ledger: ref({ status: 'empty', data: { items: [] }, error: '' }), catalog: ref({ status: 'empty', data: { items: [] }, error: '' }), detail: ref({ status: 'idle', data: null, error: '' }), roster: ref({ status: 'ready', data: [], error: '' }),
      estimate: ref({ status: 'idle', data: null, error: '' }), agentSkills: ref({ status: 'ready', data: { observedAt: '1000', entitlements: [{ skillKey: 'read', skillVersion: '1', status: 'ACTIVE' }], installationEvidence: [{ installationId: 'i-1', skillKey: 'read', skillVersion: '1', status: 'VERIFIED_INSTALLED', evidenceKind: 'ACK', verifiedAt: '1000' }] }, error: '' }),
      hostingPlan: ref({ status: 'unavailable', data: null, error: '未配置参考方案' }), hostingLease: ref({ status: 'idle', data: null, error: '' }), loadLedger: async () => {}, loadCatalog: async () => {}, loadDetail: async () => {}, loadAgentFacts: async () => {}, submitEstimate: async () => {}
    }
    const Component = loadComponent('../src/components/economy/EconomyReadOnlyPreview.vue', 'readonly-preview-mounted', {
      vue: Vue, '@/stores/global.js': { useGlobalStore: () => ({ setTitle: () => {}, setShowBack: () => {}, setShowMore: () => {} }) }, '@/utils/silverAmount.js': { formatSilverMicro: value => `${value} SILVER` }, '@/composables/useEconomyReadOnlyPreview.js': { useEconomyReadOnlyPreview: () => state }
    })
    const wrapper = mount(Component); wrappers.push(wrapper); await flushPromises()
    expect(wrapper.text()).to.include('i-1 · read@1 · 已验证安装（ACK）')
    expect(wrapper.text()).to.include('未配置参考方案')
    expect(wrapper.text()).to.include('0 SILVER')
  })
})
