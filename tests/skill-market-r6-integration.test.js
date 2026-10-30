import { expect } from 'chai'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { createApi } from '../src/composables/useHttp.js'
import { stopIdentityBoundWork } from '../src/utils/identityLifecycle.js'
import { effectScope, ref } from 'vue'
import { useSkillMarket } from '../src/composables/useSkillMarket.js'
import { skillComponents, button, until, settle } from './helpers/skill-management-components.js'
import { apiFixture, fixture, locks, requestData, wireResponse } from './fixtures/skill-management/helpers.js'

// These are production Web consumers over a synthetic HTTP transport, not Java/DB/Runtime acceptance.
describe('SM-C1 mounted consumers through actual useHttp + public envelope', () => {
  let originalFetch; let oldLocks; let wrappers; let scopes; let requests; let mock; let useApiStore; let pinia
  before(async () => { ({ useApiStore } = await import('../src/stores/api.js')) })
  beforeEach(() => {
    pinia = createPinia(); setActivePinia(pinia); useApiStore(pinia).token = async () => 'isolated-test-token'
    wrappers = []; scopes = []; requests = []; mock = apiFixture()
    window.localStorage.clear()
    oldLocks = Object.getOwnPropertyDescriptor(navigator, 'locks'); Object.defineProperty(navigator, 'locks', { configurable: true, value: locks })
    originalFetch = globalThis.fetch
    globalThis.fetch = async (url, options) => {
      const path = new URL(url, 'http://localhost').pathname; const data = requestData(options)
      requests.push({ path, data, method: options.method, options })
      if (options.method === 'GET') {
        if (path === '/economy/capabilities') return wireResponse(options, { economyPreviewEnabled: true, skillMarketplaceEnabled: true, principalScopeSha256: 'a'.repeat(64) })
        if (path.endsWith('/skills')) return wireResponse(options, mock.list)
        if (path.endsWith('/skill-changes')) return wireResponse(options, { agentId: 'agt_demo', items: [] })
        return wireResponse(options, mock.accepted)
      }
      if (path === '/agent/roster') return wireResponse(options, { items: [{ agentId: 'agt_demo', name: '自己的好汉', version: mock.list.agentVersion, boundToMe: true, canOperate: true }] })
      if (path.endsWith('/quotes')) return wireResponse(options, { ...fixture('quote-install-response').data, expiresAt: Date.now() + 60000 })
      if (path === '/agent/agt_demo/skill-changes') {
        mock.list.items[0].latestChange = mock.accepted; mock.list.items[0].skillRevision = '1'; mock.list.items[0].allowedActions = ['VIEW', 'RECONCILE']
        return wireResponse(options, mock.accepted, 202)
      }
      throw new Error('unexpected route ' + path)
    }
  })
  afterEach(async () => {
    for (const wrapper of wrappers) wrapper.unmount()
    for (const scope of scopes) scope.stop()
    await settle(); globalThis.fetch = originalFetch
    if (oldLocks) Object.defineProperty(navigator, 'locks', oldLocks); else delete navigator.locks
    window.localStorage.clear()
  })
  const mountManagement = (component, props = {}) => {
    const wrapper = mount(component, { attachTo: document.body, props: { targetAgent: { agentId: 'agt_demo', name: '测试好汉' }, actorScopeKey: 'actor-test', ...props }, global: { plugins: [pinia], stubs: { teleport: true } } })
    wrappers.push(wrapper); return wrapper
  }
  it('existing market consumer renders the single list and sends exact SM-C1 INSTALL, never legacy POST', async () => {
    const wrapper = mountManagement(skillComponents().Market, { previewEnabled: true })
    await until(() => wrapper.find('[data-skill-row="image-edit"]').exists())
    await button(wrapper, '安装').trigger('click')
    for (const box of wrapper.findAll('input')) await box.setValue(true)
    await button(wrapper, '获取报价').trigger('click')
    await until(() => button(wrapper, '确认安装'))
    await button(wrapper, '确认安装').trigger('click')
    await until(() => wrapper.text().includes('原操作已接纳'))
    const write = requests.find(r => r.path === '/agent/agt_demo/skill-changes' && r.method === 'POST')
    expect(write.data).to.deep.equal(fixture('create-install').data)
    const envelope = JSON.parse(write.options.body)
    expect(envelope.protocolVersion).to.equal(1); expect(envelope.requestId).to.equal(write.options.headers['X-Request-Id'])
    expect(write.options.headers['Idempotency-Key']).to.be.a('string')
    expect(wrapper.text()).to.include('等待连接')
    expect(requests.some(r => r.path === '/agent/skill-orders')).to.equal(false)
    expect(wrapper.findAll('.skill-unified-list')).to.have.length(1)
  })
  it('existing route → roster selection → actual management → public write → roster refresh remains wired', async () => {
    const wrapper = mount(skillComponents({ useApiStore }).Route, { attachTo: document.body, global: { plugins: [pinia], stubs: { teleport: false } } }); wrappers.push(wrapper)
    await until(() => wrapper.find('select option[value="agt_demo"]').exists())
    await wrapper.get('select').setValue('agt_demo'); await until(() => button(wrapper, '安装'))
    await button(wrapper, '安装').trigger('click'); for (const box of wrapper.findAll('input')) await box.setValue(true)
    await button(wrapper, '获取报价').trigger('click'); await until(() => button(wrapper, '确认安装'))
    await button(wrapper, '确认安装').trigger('click')
    await until(() => requests.filter(r => r.path === '/agent/roster').length === 2)
    expect(wrapper.get('select').element.value).to.equal('agt_demo')
    expect(requests.filter(r => r.path === '/agent/agt_demo/skill-changes' && r.method === 'POST')).to.have.length(1)
    expect(wrapper.findAll('.skill-unified-list')).to.have.length(1)
  })
  it('actual route drops capability/selection on identity removal and does not restart the old actor observer', async () => {
    const wrapper = mount(skillComponents({ useApiStore }).Route, { attachTo: document.body, global: { plugins: [pinia] } }); wrappers.push(wrapper)
    await until(() => wrapper.find('select option[value="agt_demo"]').exists())
    await wrapper.get('select').setValue('agt_demo'); await until(() => button(wrapper, '安装'))
    useApiStore(pinia).authorizationGeneration++; stopIdentityBoundWork(); await settle()
    const before = requests.length
    expect(wrapper.find('select').exists()).to.equal(false); expect(wrapper.find('.skill-unified-list').exists()).to.equal(false)
    await settle(); expect(requests.length).to.equal(before)
  })
  it('actual AgentPanel owner entry mounts real management; another owner has no entry', async () => {
    const { AgentPanel } = skillComponents()
    const wrapper = mount(AgentPanel, { attachTo: document.body, props: { selectedAgent: { agentId: 'agt_demo', name: '自己的好汉', boundToMe: true, canOperate: true }, identityKey: 'actor-test:0', actorScopeKey: 'actor-test', abilityText: () => '', portraitName: () => '', portraitStyle: () => ({}), statusClass: () => '', statusText: () => '' }, global: { plugins: [pinia], stubs: { teleport: false } } })
    wrappers.push(wrapper)
    await wrapper.find('[aria-label="管理技能"]').trigger('click')
    await until(() => document.querySelector('dialog[open] [data-skill-row]'))
    expect(document.querySelector('dialog').textContent).to.include('自己的好汉')
    await wrapper.setProps({ selectedAgent: { agentId: 'other', boundToMe: false, canOperate: false } })
    expect(wrapper.find('[aria-label="管理技能"]').exists()).to.equal(false)
    expect(document.querySelector('dialog')).to.equal(null)
  })
  it('strict raw numeric and response-status errors reach real useHttp consumers, not a permissive adapter', async () => {
    const scope = effectScope(); scopes.push(scope)
    const market = scope.run(() => useSkillMarket({ agentApi: createApi('/agent'), targetAgent: ref({ agentId: 'agt_demo' }), actorScopeKey: 'test', operationLocks: locks }))
    globalThis.fetch = async (_url, options) => {
      const response = wireResponse(options, mock.list)
      const raw = (await response.text()).replace('"protocolVersion":1', '"protocolVersion":1.0')
      return new Response(raw, { status: 200, headers: response.headers })
    }
    await market.refresh()
    expect(market.catalog.value).to.equal(null); expect(market.error.value).to.include('PROTOCOL_INVALID_RESPONSE')
    globalThis.fetch = async (_url, options) => wireResponse(options, mock.list, 202)
    await market.refresh(); expect(market.error.value).to.include('PROTOCOL_SKILL_HTTP_STATUS')
  })
  it('has no legacy purchase call in production code and uses the same management consumer', () => {
    const source = readFileSync(new URL('../src/composables/useSkillMarket.js', import.meta.url), 'utf8')
    expect(source).not.to.match(/\.post\(['"]\/skill-orders['"]/)
    const consumer = readFileSync(new URL('../src/components/economy/SkillMarket.vue', import.meta.url), 'utf8')
    expect(consumer).to.include('<SkillManagement')
    expect(consumer).not.to.include('SkillPurchaseDialog')
  })
})
