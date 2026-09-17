import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { effectScope } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useEconomyReadOnlyPreview } from '../src/composables/useEconomyReadOnlyPreview.js'

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const success = data => ({ data: { code: 'E0', data } })

describe('economy readonly preview UI boundary', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('uses its own flag, authenticated route, profile entry, and no legacy transaction endpoints', () => {
    const router = source('../src/router/index.js')
    const profile = source('../src/components/UserProfile.vue')
    const page = source('../src/components/economy/EconomyReadOnlyPreview.vue')
    const adapter = source('../src/composables/economyReadOnlyPreviewApi.js')
    expect(router).to.include("path: '/economy-preview'")
    expect(router).to.include('VITE_ECONOMY_READONLY_PREVIEW_ENABLED')
    expect(profile).to.include('to="/economy-preview"')
    expect(page).to.include('本次操作不扣款、不下单、不安装、不启用托管')
    expect(adapter).to.include("createApi('/economy/preview')")
    for (const legacy of ['/quotes', '/purchase', '/bind', '/renew', '/reprovision', 'purchase-journal']) {
      expect(adapter).not.to.include(legacy)
      expect(page).not.to.include(legacy)
    }
  })

  it('compiles the page and renders all five readonly areas with real DOM states', () => {
    const page = source('../src/components/economy/EconomyReadOnlyPreview.vue')
    const { descriptor } = parse(page, { filename: 'EconomyReadOnlyPreview.vue' })
    expect(() => compileScript(descriptor, { id: 'economy-readonly-preview' })).not.to.throw()
    for (const label of ['钱包', '悬赏预算试算', '技能目录', 'Agent 权益与安装证据', '托管说明与租约']) expect(page).to.include(label)
    for (const state of ["status === 'loading'", "status === 'empty'", "status === 'error'", "status === 'unavailable'"]) expect(page).to.include(state)
  })

  it('uses POST roster and drops a stale Agent response instead of assigning it to the new Agent', async () => {
    let resolveSkills
    const client = {
      capabilities: async () => ({ contractVersion: 'economy-readonly-v1', mode: 'READ_ONLY_PREVIEW', enabled: true, principalScopeFingerprint: 'scope-a', features: { wallet: false, ledger: false, catalog: false, installationStatus: true, hostingPlan: false, hostingLease: false }, actions: { estimate: false, issue: false, purchase: false, settle: false, refund: false, install: false, hostingActivate: false, hostingRenew: false } }),
      roster: async () => success({ items: [{ agentId: 'agent-a', boundToMe: true, canOperate: true }, { agentId: 'agent-b', boundToMe: true, canOperate: true }] }),
      agentSkills: () => new Promise(resolve => { resolveSkills = resolve }),
      wallet: async () => null, ledger: async () => null, catalog: async () => null, product: async () => null, hostingPlan: async () => null, hostingLease: async () => null, estimate: async () => null
    }
    const scope = effectScope()
    const preview = scope.run(() => useEconomyReadOnlyPreview({ client, getAuthGeneration: () => 3 }))
    try {
      await preview.refresh()
      expect(preview.agents.value.map(agent => agent.agentId)).to.deep.equal(['agent-a', 'agent-b'])
      preview.selectedAgentId.value = 'agent-a'
      await Promise.resolve()
      preview.selectedAgentId.value = 'agent-b'
      resolveSkills({ agentId: 'agent-a', entitlements: [{ skillKey: 'wrong' }], installationEvidence: [] })
      await Promise.resolve(); await Promise.resolve()
      expect(preview.agentSkills.value.data?.agentId).not.to.equal('agent-a')
    } finally { scope.stop() }
  })
})
