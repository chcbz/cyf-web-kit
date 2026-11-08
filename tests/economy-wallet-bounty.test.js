import { currentHttpResponse } from './fixtures/current-http-response.js'
import { expect } from 'chai'
import { readFileSync } from 'fs'
import { ref } from 'vue'
import { fundedQuote, fundedReceipt } from './funded-bounty-fixtures.js'
import { useHallTaskActions } from '../src/composables/juyiting/useHallTaskActions.js'
import { createApi } from '../src/composables/useHttp.js'
import { loadSkillMarketRoster } from '../src/utils/skillMarketRoster.js'

const walletSource = readFileSync(new URL('../src/components/Wallet.vue', import.meta.url), 'utf8')
const bountySource = readFileSync(new URL('../src/components/juyiting/BountyPanel.vue', import.meta.url), 'utf8')
const hallSource = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
const httpSource = readFileSync(new URL('../src/composables/useHttp.js', import.meta.url), 'utf8')
const skillMarketRouteSource = readFileSync(new URL('../src/components/economy/SkillMarketRoute.vue', import.meta.url), 'utf8')

describe('economy preview wallet and funded bounty integration', () => {
  it('keeps wallet in the regular personal center and formats canonical amounts without number money conversion', () => {
    expect(walletSource).not.to.include("VITE_ECONOMY_PREVIEW_ENABLED")
    expect(walletSource).to.include("economyApi.get('/wallet'")
    expect(walletSource).to.include("economyApi.get('/ledger', { pageSize: 50 }")
    expect(walletSource).to.include('formatWen')
    expect(walletSource).not.to.match(/parseFloat\(|Number\(wallet\.(availableWen|heldWen)/)
    expect(httpSource).to.include("export const economyApi = createApi('/economy')")
  })






})

describe('funded bounty remediation', () => {
  const fundedTask = (id = 'funded-remediation') => ({
    id,
    title: 'Funded',
    status: 'open',
    version: '8',
    funding: { mode: 'FUNDED_SINGLE_AGENT', remainingWen: '100' }
  })
  const actionOptions = (agentApi, overrides = {}) => {
    const values = new Map()
    return ({
    agentApi,
    fundedActorScopeKey: () => 'funded-test-scope',
    fundedIntentStorage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    canAssign: () => true,
    confirmFundedQuote: async () => true,
    createIdempotencyKey: (() => { let sequence = 0; return () => `idem-${++sequence}` })(),
    log: { warn: () => {} },
    playError: () => {},
    playSuccess: () => {},
    selectedAgent: ref(null),
    selectedTask: ref(null),
    showToast: () => {},
    tasks: ref([]),
    ...overrides
    })
  }





  it('keeps original funded recovery and gates skill market discovery and direct routing by the server capability', () => {
    const profileSource = readFileSync(new URL('../src/components/UserProfile.vue', import.meta.url), 'utf8')
    const routerSource = readFileSync(new URL('../src/router/index.js', import.meta.url), 'utf8')
    expect(bountySource).not.to.include('submitCreateTask')
    expect(bountySource).not.to.include("$emit('resume-funded-create')")
    expect(bountySource).to.include('旧资金榜已停止操作；原结果仍待核对，不会重发、转换或删除此记录。')
    expect(walletSource).to.include('Number.isSafeInteger(value)')
    expect(walletSource).to.include('Number.isSafeInteger(value)')
    expect(profileSource).to.include('id="wallet-entry-title"')
    expect(profileSource).to.include('fetchEconomyPreviewCapability')
    expect(profileSource).not.to.include("economyApi.get('/wallet'")
    expect(routerSource).to.include("path: '/skill-market'")
    expect(routerSource).to.include("import('@/components/economy/SkillMarketRoute.vue')")
    expect(skillMarketRouteSource).to.include('await loadSkillMarketRoster({ signal: controller.signal })')
    expect(skillMarketRouteSource).to.include('principalScopeSha256')
    expect(skillMarketRouteSource).to.include('agent?.boundToMe === true && agent?.canOperate === true')
    expect(skillMarketRouteSource).to.include('isCanonicalDecimalString(agent?.version)')
    expect(routerSource).to.include('beforeEnter: () => capabilityRouteGuard(isSkillMarketplaceCapability)')
    expect(routerSource).to.include("return { name: 'UserProfile' }")
  })

  it('loads the skill route roster through actual createApi/useHttp POST with explicit pagination', async () => {
    const originalFetch = globalThis.fetch
    const requests = []
    const roster = [{ agentId: 'owned-agent', boundToMe: true, canOperate: true, version: '17' }]
    const controller = new AbortController()
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options })
      return currentHttpResponse(options, { code: 'E0', data: roster }, {
        status: 200, headers: { 'Content-Type': 'application/json' }
      })
    }
    try {
      const result = await loadSkillMarketRoster({
        signal: controller.signal,
        authStore: { authorizationGeneration: 1, token: async () => 'test-only-token' }
      })
      expect(requests).to.have.length(1)
      const { url, options } = requests[0]
      const requestUrl = new URL(url, 'http://localhost')
      expect(requestUrl.pathname).to.match(/\/agent\/roster$/)
      expect(requestUrl.search).to.equal('')
      expect(options.method).to.equal('POST')
      expect(JSON.parse(options.body).data).to.deep.equal({ pageNum: 1, pageSize: 50 })
      expect(options.headers.Authorization).to.equal('Bearer test-only-token')
      expect(options.signal.aborted).to.equal(false)
      expect(result).to.deep.equal(roster)
    } finally {
      globalThis.fetch = originalFetch
    }
  })





})
