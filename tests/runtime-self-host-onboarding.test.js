import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import { mount } from '@vue/test-utils'
import * as Vue from 'vue'

const source = readFileSync(new URL('../src/components/juyiting/PersonaCatalogPanel.vue', import.meta.url), 'utf8')
const { descriptor, errors } = parse(source)
expect(errors).to.deep.equal([])
let script = compileScript(descriptor, { id: 'runtime-onboarding-test', inlineTemplate: true }).content
script = script
  .replace(/^import \{([^}]+)\} from ["']vue["'];?$/gm, (_, names) => `const { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
  .replace(/^import \{ agentApi \} from '\.\.\/\.\.\/composables\/useHttp\.js';?$/m, 'const { agentApi } = runtime')
  .replace(/^import HostingRentPanel from '\.\/HostingRentPanel\.vue';?$/m, "const HostingRentPanel = { template: '<div />' }")
  .replace('export default', 'return')
const makeComponent = agentApi => new Function('Vue', 'runtime', script)(Vue, { agentApi })
const setup = { runtimeProtocolVersion: 'v1', tenantId: 'tenant-real', clientId: 'client-real', canonicalAgentId: 'agent-real', manifestVersion: '1', installationCreatePath: '/agent/runtime/v1/installations', guideUrl: 'https://gitee.com/chcbz/isp-install/blob/develop/docs/cyf-agent-runtime-v1-self-host.md' }
const request = () => ({ installationId: 'rti_0123456789abcdef0123456789abcdef', canonicalAgentId: setup.canonicalAgentId, manifestVersion: '1', manifestSha256: 'a'.repeat(64), enrollmentSecretSha256: 'b'.repeat(64), enrollmentExpiresAt: 1791800000000 })
const handoff = (scope = {}, req = request()) => ({ scope: { tenantId: setup.tenantId, clientId: setup.clientId, canonicalAgentId: setup.canonicalAgentId, ...scope }, request: req })
const setupResult = { mode: 'local', runtimeSetup: setup, agentId: 'agent-real', profileId: 'profile-real', envExample: 'OPENCLAW_API_KEY=legacy-secret', profileExample: 'apiKey=legacy-secret' }
const props = { setupResult, identityScope: 'owner-a', identityEpoch: 1, runtimeRole: 'agent-real', portraitName: () => '', portraitStyle: () => ({}) }
const importFile = async (wrapper, text) => {
  const input = wrapper.get('input[type=\"file\"]').element
  Object.defineProperty(input, 'files', { configurable: true, value: [{ text: async () => text }] })
  input.dispatchEvent(new window.Event('change', { bubbles: true }))
  await tick()
}
const tick = async () => { await Vue.nextTick(); await Promise.resolve(); await Vue.nextTick() }

describe('runtime self-host onboarding panel', () => {
  it('replaces legacy local API-key instructions with the runtime scope and guide', () => {
    const wrapper = mount(makeComponent({ post: async () => {}, get: async () => {} }), { props, global: { stubs: { 'var-icon': true } } })
    try {
      expect(wrapper.text()).to.include('tenant-real').and.include('client-real').and.include('agent-real')
      expect(wrapper.get('.setup-note a').attributes('href')).to.equal(setup.guideUrl)
      expect(wrapper.text()).to.include('cyf_runtime_enrollment_prepare.mjs')
      expect(wrapper.text()).not.to.include('legacy-secret')
      expect(wrapper.text()).not.to.include('codex-ws-agent')
    } finally { wrapper.unmount() }
  })

  it('accepts only the exact scope/request contract and never echoes rejected content', async () => {
    const wrapper = mount(makeComponent({ post: async () => {}, get: async () => {} }), { props, global: { stubs: { 'var-icon': true } } })
    try {
      await importFile(wrapper, JSON.stringify(handoff({ tenantId: 'wrong-tenant' })))
      await tick()
      expect(wrapper.text()).to.include('无法导入')
      expect(wrapper.text()).not.to.include('wrong-tenant')
      await importFile(wrapper, JSON.stringify({ ...handoff(), subjectKey: 'secret-subject' }))
      await tick()
      expect(wrapper.text()).to.include('无法导入')
      expect(wrapper.text()).not.to.include('secret-subject')
      const withCredential = handoff(); withCredential.request.enrollmentSecret = 'plain-secret'
      await importFile(wrapper, JSON.stringify(withCredential))
      await tick()
      expect(wrapper.text()).to.include('无法导入')
      expect(wrapper.text()).not.to.include('plain-secret')
      const prefixed = handoff(); prefixed.request.manifestSha256 = `sha256:${'a'.repeat(64)}`
      await importFile(wrapper, JSON.stringify(prefixed))
      await tick()
      expect(wrapper.text()).to.include('无法导入')
    } finally { wrapper.unmount() }
  })

  it('posts only the six request fields after explicit click and manually gets that same installation', async () => {
    const calls = []
    const api = {
      post: async (...args) => { calls.push(['post', ...args]); return { data: { status: 'PENDING' } } },
      get: async (...args) => { calls.push(['get', ...args]); return { data: { status: 'ACTIVE' } } }
    }
    const wrapper = mount(makeComponent(api), { props, global: { stubs: { 'var-icon': true } } })
    try {
      expect(calls).to.have.length(0)
      await importFile(wrapper, JSON.stringify(handoff()))
      await tick()
      expect(calls).to.have.length(0)
      await wrapper.get('.runtime-actions button').trigger('click')
      await tick()
      expect(calls[0][0]).to.equal('post')
      expect(calls[0][1]).to.equal('/runtime/v1/installations')
      expect(calls[0][2]).to.deep.equal(request())
      expect(Object.keys(calls[0][2])).to.have.length(6)
      expect(wrapper.text()).to.include('PENDING').and.include('不代表在线')
      expect(wrapper.text()).not.to.match(/在线状态：ACTIVE/)
      expect(wrapper.findAll('.runtime-actions button')[0].attributes('disabled')).to.not.equal(undefined)
      await wrapper.get('.runtime-actions button:nth-child(2)').trigger('click')
      await tick()
      expect(calls[1][0]).to.equal('get')
      expect(calls[1][1]).to.equal(`/runtime/v1/installations/${request().installationId}`)
      expect(wrapper.text()).to.include('ACTIVE').and.include('不代表在线')
    } finally { wrapper.unmount() }
  })

  it('clears state and ignores stale replies when identity, role, or authorization generation changes and on unmount', async () => {
    let resolvePost
    const api = { post: () => new Promise(resolve => { resolvePost = resolve }), get: async () => ({ data: { status: 'ACTIVE' } }) }
    const wrapper = mount(makeComponent(api), { props, global: { stubs: { 'var-icon': true } } })
    await importFile(wrapper, JSON.stringify(handoff()))
    await tick()
    await wrapper.get('.runtime-actions button').trigger('click')
    await wrapper.setProps({ identityScope: 'owner-b' })
    resolvePost({ data: { status: 'ACTIVE' } })
    await tick()
    expect(wrapper.text()).not.to.include('ACTIVE')
    await importFile(wrapper, JSON.stringify(handoff()))
    await tick()
    expect(wrapper.get('.runtime-actions button').attributes('disabled')).to.equal(undefined)
    await wrapper.setProps({ runtimeRole: 'different-role' })
    expect(wrapper.get('.runtime-actions button').attributes('disabled')).to.not.equal(undefined)
    await importFile(wrapper, JSON.stringify(handoff()))
    await tick()
    await wrapper.setProps({ identityEpoch: 2 })
    expect(wrapper.get('.runtime-actions button').attributes('disabled')).to.not.equal(undefined)
    wrapper.unmount()
  })
})
