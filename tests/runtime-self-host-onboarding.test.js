import { expect } from 'chai'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
const request = (overrides = {}) => ({ installationId: 'rti_0123456789abcdef0123456789abcdef', canonicalAgentId: setup.canonicalAgentId, manifestVersion: '1', manifestSha256: 'a'.repeat(64), enrollmentSecretSha256: 'b'.repeat(64), enrollmentExpiresAt: Date.now() + 60_000, ...overrides })
const handoff = (scope = {}, req = request()) => ({ scope: { tenantId: setup.tenantId, clientId: setup.clientId, canonicalAgentId: setup.canonicalAgentId, ...scope }, request: req })
const setupResult = { mode: 'local', runtimeSetup: setup, agentId: 'agent-real', profileId: 'profile-real', envExample: 'OPENCLAW_API_KEY=legacy-secret', profileExample: 'apiKey=legacy-secret' }
const props = { setupResult, identityScope: 'owner-a', identityEpoch: 1, runtimeRole: 'agent-real', portraitName: () => '', portraitStyle: () => ({}) }
const viewFor = (req, status = 'PENDING', overrides = {}) => ({ installationId: req.installationId, tenantId: setup.tenantId, clientId: setup.clientId, canonicalAgentId: req.canonicalAgentId, manifestVersion: req.manifestVersion, manifestSha256: req.manifestSha256, enrollmentExpiresAt: req.enrollmentExpiresAt, status, lastHeartbeatAt: null, ...overrides })
const envelope = (data, code = 'E0', extra = {}) => ({ data: { code, data, ...extra }, status: 200, statusText: 'OK' })
const setFile = (wrapper, file) => {
  const input = wrapper.get('input[type="file"]').element
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  input.dispatchEvent(new window.Event('change', { bubbles: true }))
}
const importText = async (wrapper, text) => { setFile(wrapper, { text: async () => text }); await tick() }
const tick = async () => { await Vue.nextTick(); await Promise.resolve(); await Vue.nextTick() }
const mountPanel = agentApi => mount(makeComponent(agentApi), { props: { ...props }, global: { stubs: { 'var-icon': true } } })

describe('runtime self-host onboarding panel', () => {
  it('renders real scope, guide, safe prepare command and legacy-free copy action', async () => {
    const wrapper = mountPanel({ post: async () => {}, get: async () => {} })
    const copied = []
    const originalClipboard = navigator.clipboard
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => copied.push(text) } })
    try {
      expect(wrapper.text()).to.include('tenant-real').and.include('client-real').and.include('agent-real')
      expect(wrapper.get('.setup-note a').attributes('href')).to.equal(setup.guideUrl)
      expect(wrapper.text()).to.include('cyf_runtime_enrollment_prepare.mjs')
      expect(wrapper.text()).not.to.include('legacy-secret')
      expect(wrapper.text()).not.to.include('codex-ws-agent')
      expect(wrapper.get('.runtime-actions .catalog-action.primary').exists()).to.equal(true)
      await wrapper.get('.setup-copy').trigger('click')
      expect(copied[0]).to.include('tenant-real').and.include('cyf_runtime_enrollment_prepare.mjs')
      expect(copied[0]).not.to.include('legacy-secret')
      await wrapper.setProps({ setupResult: { ...setupResult, runtimeSetup: { ...setup, tenantId: "tenant'bad" } } })
      expect(wrapper.get('.runtime-command').text()).to.include("--tenant-id 'tenant'\\''bad'")
    } finally {
      wrapper.unmount()
      if (originalClipboard === undefined) delete navigator.clipboard
      else Object.defineProperty(navigator, 'clipboard', { configurable: true, value: originalClipboard })
    }
  })

  it('strictly rejects wrong scope, extra/secret fields, prefixed digest, and malformed installation IDs without echo', async () => {
    const wrapper = mountPanel({ post: async () => {}, get: async () => {} })
    try {
      const bad = [
        handoff({ tenantId: 'wrong-tenant' }),
        { ...handoff(), subjectKey: 'secret-subject' },
        handoff({}, { ...request(), enrollmentSecret: 'plain-secret' }),
        handoff({}, request({ manifestSha256: `sha256:${'a'.repeat(64)}` })),
        handoff({}, request({ installationId: 'rti_bad-id' }))
      ]
      for (const value of bad) {
        await importText(wrapper, JSON.stringify(value))
        expect(wrapper.text()).to.include('无法导入')
        expect(wrapper.text()).not.to.include('wrong-tenant').and.not.to.include('secret-subject').and.not.to.include('plain-secret')
      }
    } finally { wrapper.unmount() }
  })

  it('imports the actual offline helper handoff and sends only six fields after explicit click', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cyf-runtime-web-'))
    const output = join(root, 'prepared')
    const helper = '/home/isp/wsps/chcbz/isp-install/shell/cyf_runtime_enrollment_prepare.mjs'
    try {
      execFileSync(process.execPath, [helper, '--tenant-id', setup.tenantId, '--client-id', setup.clientId, '--agent-id', setup.canonicalAgentId, '--output', output, '--expires-at', String(Date.now() + 120_000)], { stdio: ['ignore', 'ignore', 'pipe'] })
      const text = readFileSync(join(output, 'handoff.json'), 'utf8')
      const secretMaterial = ['enrollment-secret', 'subject-key.txt'].map(name => readFileSync(join(output, name), 'utf8').trim())
      const calls = []
      const api = { post: async (...args) => { calls.push(['post', ...args]); return envelope(viewFor(args[1])) }, get: async (...args) => { calls.push(['get', ...args]); return envelope(viewFor(JSON.parse(text).request, 'ACTIVE')) } }
      const wrapper = mountPanel(api)
      try {
        await importText(wrapper, text)
        expect(calls).to.have.length(0)
        expect(wrapper.get('.runtime-actions .catalog-action.primary').attributes('disabled')).to.equal(undefined)
        await wrapper.get('.runtime-actions .catalog-action.primary').trigger('click')
        expect(calls).to.have.length(1)
        expect(calls[0][1]).to.equal('/runtime/v1/installations')
        expect(Object.keys(calls[0][2]).sort()).to.deep.equal(['canonicalAgentId', 'enrollmentExpiresAt', 'enrollmentSecretSha256', 'installationId', 'manifestSha256', 'manifestVersion'].sort())
        expect(calls[0][2]).to.deep.equal(JSON.parse(text).request)
        expect(wrapper.text()).to.include('PENDING').and.include('不代表在线')
        for (const secret of secretMaterial) expect(wrapper.text()).not.to.include(secret)
        await wrapper.get('.runtime-actions .catalog-action.subtle').trigger('click')
        expect(calls[1][0]).to.equal('get')
        expect(calls[1][1]).to.equal(`/runtime/v1/installations/${JSON.parse(text).request.installationId}`)
        expect(wrapper.text()).to.include('ACTIVE').and.include('不代表在线')
      } finally { wrapper.unmount() }
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('rejects HTTP-200 JsonResult business errors and mismatched installation views', async () => {
    const req = request()
    for (const api of [
      { post: async () => envelope(viewFor(req, 'ACTIVE'), 'E9', { msg: 'response-secret' }), get: async () => {} },
      { post: async () => envelope(viewFor(req, 'ACTIVE', { tenantId: 'other-tenant' })), get: async () => {} }
    ]) {
      const wrapper = mountPanel(api)
      try {
        await importText(wrapper, JSON.stringify(handoff({}, req)))
        await wrapper.get('.runtime-actions .catalog-action.primary').trigger('click')
        expect(wrapper.text()).to.include('登记结果未确认')
        expect(wrapper.text()).not.to.include('安装授权状态：ACTIVE').and.not.to.include('response-secret').and.not.to.include('other-tenant')
      } finally { wrapper.unmount() }
    }
  })

  it('does not create expired handoffs but still allows explicit same-ID lookup', async () => {
    const req = request({ enrollmentExpiresAt: Date.now() - 10 })
    const calls = []
    const api = { post: async (...args) => { calls.push(['post', ...args]); return envelope(viewFor(req)) }, get: async (...args) => { calls.push(['get', ...args]); return envelope(viewFor(req, 'ACTIVE')) } }
    const wrapper = mountPanel(api)
    try {
      await importText(wrapper, JSON.stringify(handoff({}, req)))
      expect(wrapper.get('.runtime-actions .catalog-action.primary').attributes('disabled')).not.to.equal(undefined)
      await wrapper.get('.runtime-actions .catalog-action.subtle').trigger('click')
      expect(calls.map(call => call[0])).to.deep.equal(['get'])
      expect(wrapper.text()).to.include('ACTIVE')
    } finally { wrapper.unmount() }
  })

  it('fences pending imports and API replies across import/session changes and prevents duplicate create', async () => {
    const req = request()
    let resolveFile
    let resolvePost
    const calls = []
    const wrapper = mountPanel({ post: (...args) => { calls.push(args); return new Promise(resolve => { resolvePost = resolve }) }, get: async () => envelope(viewFor(req)) })
    try {
      setFile(wrapper, { text: () => new Promise(resolve => { resolveFile = resolve }) })
      await tick()
      await importText(wrapper, JSON.stringify(handoff({}, req)))
      resolveFile(JSON.stringify(handoff({ tenantId: 'stale-tenant' }, req)))
      await tick()
      expect(wrapper.text()).to.include('交接材料已验证').and.not.to.include('stale-tenant')
      await wrapper.get('.runtime-actions .catalog-action.primary').trigger('click')
      wrapper.get('.runtime-actions .catalog-action.primary').element.click()
      expect(calls).to.have.length(1)
      await wrapper.setProps({ identityScope: 'owner-switched' })
      resolvePost(envelope(viewFor(req, 'ACTIVE')))
      await tick()
      expect(wrapper.text()).not.to.include('ACTIVE')
      expect(wrapper.get('.runtime-actions .catalog-action.primary').attributes('disabled')).not.to.equal(undefined)
      await importText(wrapper, JSON.stringify(handoff({}, req)))
      expect(wrapper.get('.runtime-actions .catalog-action.primary').attributes('disabled')).to.equal(undefined)
      await wrapper.setProps({ runtimeRole: 'role-switched' })
      expect(wrapper.get('.runtime-actions .catalog-action.primary').attributes('disabled')).not.to.equal(undefined)
      await importText(wrapper, JSON.stringify(handoff({}, req)))
      await wrapper.setProps({ identityEpoch: 2 })
      expect(wrapper.get('.runtime-actions .catalog-action.primary').attributes('disabled')).not.to.equal(undefined)
    } finally { wrapper.unmount() }
  })
})
