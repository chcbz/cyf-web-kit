import { expect } from 'chai'
import { after, afterEach, before, describe, it } from 'mocha'
import { compileScript, parse } from '@vue/compiler-sfc'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import * as VueRuntime from 'vue'
import { createApi } from '../src/composables/useHttp.js'
import { createArchiveMaintenanceGateway } from '../src/composables/juyiting/useArchiveMaintenance.js'
import { useHallChatContext } from '../src/composables/juyiting/useHallChatContext.js'
import { registerIdentityCleanup, stopIdentityBoundWork } from '../src/utils/identityLifecycle.js'

let mount
const Vue = VueRuntime
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const admin = data => json({ status: 200, code: 'OK', msg: 'ok', data })
const deferred = () => { let resolve; let reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }
const flushPromises = async () => { for (let i = 0; i < 8; i += 1) { await Promise.resolve(); await Vue.nextTick(); await new Promise(resolve => setTimeout(resolve, 0)) } }
const waitFor = async (predicate, message = 'timed out') => { for (let i = 0; i < 40; i += 1) { await flushPromises(); if (predicate()) return } throw new Error(message) }
const button = (wrapper, text) => wrapper.findAll('button').find(item => item.text().includes(text))
const authStore = Object.freeze({ authorizationGeneration: 0, token: async () => 'fixture-token', cleanToken: () => {} })
const archive = await import('../src/composables/juyiting/useArchiveMaintenance.js')

// Bounded SFC loader: source component and production dependencies are mounted unchanged.
const loadArchiveSfc = relativePath => {
  const filename = new URL(relativePath, import.meta.url).pathname
  const { descriptor } = parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'), { filename })
  const source = compileScript(descriptor, { id: `archive-mounted-${relativePath}`, inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_line, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
    .replace(/^import\s+\{\s*registerIdentityCleanup\s*\}\s+from\s+['"]@\/utils\/identityLifecycle\.js['"];?\s*$/gm, 'var registerIdentityCleanup = arguments[1]')
    .replace(/^import\s+\{\s*ARCHIVE_COLLECTION_ID,\s*ARCHIVE_SKILL,\s*createArchiveMaintenanceGateway,\s*createIdentityFence\s*\}\s+from\s+['"]@\/composables\/juyiting\/useArchiveMaintenance\.js['"];?\s*$/gm, 'var { ARCHIVE_COLLECTION_ID, ARCHIVE_SKILL, createArchiveMaintenanceGateway, createIdentityFence } = arguments[2]')
    .replace(/^import\s+\{\s*createIdentityFence,\s*unwrapAdminResult\s*\}\s+from\s+['"]@\/composables\/juyiting\/useArchiveMaintenance\.js['"];?\s*$/gm, 'var { createIdentityFence, unwrapAdminResult } = arguments[2]')
    .replace(/^import\s+\{\s*createApi\s*\}\s+from\s+['"]@\/composables\/useHttp\.js['"];?\s*$/gm, 'var createApi = arguments[3]')
    .replace('export default', 'return')
  return new Function('Vue', 'registerIdentityCleanup', 'archive', 'createApi', source)(Vue, registerIdentityCleanup, archive, createApi)
}
const authenticatedApi = basePath => {
  const actual = createApi(basePath); const options = value => ({ ...value, authStore, needAuth: true, rum: false })
  return { ...actual, get: (path, params, value = {}) => actual.get(path, params, options(value)), post: (path, body, value = {}) => actual.post(path, body, options(value)), put: (path, body, value = {}) => actual.put(path, body, options(value)) }
}
const mountedGateway = () => createArchiveMaintenanceGateway({ adminApi: authenticatedApi('/archive/admin/v1'), platformApi: authenticatedApi('/agent/platform-skills') })

const panelFixture = ({ catalogStatus = 200, capabilitiesStatus = 200, deferredRequest, deferredInstall, capabilities, appointments } = {}) => {
  const calls = []; let capabilityReads = 0
  const oldSkill = { key: 'archive-maintainer', version: 'old-9', packageSha256: 'o'.repeat(64) }
  const newSkill = { key: 'archive-maintainer', version: 'new-10', packageSha256: 'n'.repeat(64) }
  const job = { jobId: 'job-1', title: '水浒', state: 'DRAFTING', revision: '7', appointmentId: 'appt-old', operation: 'ADD_WORK', publicationMode: 'MANUAL', waitReason: 'WAITING_SOURCE' }
  const active = appointments ?? [{ appointmentId: 'appt-old', revision: '2', agentId: 'old-agent', status: 'ACTIVE', permissionProfile: 'PUBLISH_VALIDATED', readiness: 'READY', requiredSkill: oldSkill }]
  const fetch = async (url, options = {}) => {
    const path = String(url).split('?')[0]; const method = options.method || 'GET'; const body = options.body ? JSON.parse(options.body) : null
    calls.push({ path, method, body, headers: options.headers })
    if (options.headers?.Authorization !== 'Bearer fixture-token') return json({ msg: 'missing auth' }, 401)
    if (path.endsWith('/capabilities')) { capabilityReads += 1; return capabilitiesStatus === 200 ? admin(capabilities ? capabilities(capabilityReads) : { allowedActions: ['appoint', 'source.prepare', 'job.create', 'job.read', 'job.manage', 'draft.write', 'validate', 'publish'] }) : json({ msg: 'authentication expired' }, capabilitiesStatus) }
    if (path === '/agent/platform-skills/catalog') return catalogStatus === 200 ? json([{ ...newSkill, protocol: 'zip-v1' }]) : json({ msg: 'catalog unavailable' }, catalogStatus)
    if (path.endsWith('/slot')) return admin({ revision: '3' })
    if (path.endsWith('/appointments')) return method === 'POST' ? admin({ appointmentId: 'appt-created' }) : admin(active)
    if (path.endsWith('/recovery-context')) return admin({ jobId: 'job-1', jobRevision: '7', previousAppointment: { appointmentId: 'appt-old', revision: '1', requiredSkill: oldSkill, status: 'REVOKED' }, candidates: [{ appointmentId: 'appt-new', revision: '5', requiredSkill: newSkill, status: 'ACTIVE', agentId: 'new-agent' }] })
    if (path.endsWith('/jobs/job-1')) return admin(job)
    if (path.endsWith('/jobs')) return admin([job])
    if (path.endsWith('/events')) return admin([])
    if (path.endsWith('/draft')) return method === 'PUT' ? admin({ revision: '5' }) : admin({ revision: '4', state: 'EDITING', content: { blocks: [], excludedSourceRanges: [] } })
    if (path.endsWith('/validate')) return admin({ outcome: 'PASSED', validationId: 'validation-1', draftRevision: '4', findings: [] })
    if (path.endsWith('/publish') || path.endsWith('/cancel') || path.endsWith('/execute') || path.endsWith('/resume') || path.endsWith('/reassign')) return admin(job)
    if (path.endsWith('/revoke')) return admin({ appointmentId: 'appt-old', status: 'REVOKED' })
    if (path.endsWith('/source-snapshots')) return admin({ sourceId: 'source-1', rawByteLength: 6, rawSha256: 'b'.repeat(64) })
    if (path.endsWith('/requests')) return deferredRequest ? deferredRequest.promise : admin({ job, confirmationRef: 'opaque-ref', readiness: 'READY' })
    if (path === '/agent/platform-skills/installations') return deferredInstall ? deferredInstall.promise : json({ installationId: 'install-1', state: 'PENDING' })
    if (path.endsWith('/operations/by-key')) return json({ msg: 'not known' }, 404)
    return admin({})
  }
  return { calls, fetch, job }
}

let originalFetch; let originalElement; let originalNode; let originalSvg
before(async () => { originalFetch = globalThis.fetch; originalElement = globalThis.Element; originalNode = globalThis.Node; originalSvg = globalThis.SVGElement; globalThis.Element = window.Element; globalThis.Node = window.Node; globalThis.SVGElement = window.SVGElement; ({ mount } = await import('@vue/test-utils')) })
after(() => { globalThis.fetch = originalFetch; globalThis.Element = originalElement; globalThis.Node = originalNode; globalThis.SVGElement = originalSvg })
afterEach(() => { stopIdentityBoundWork(); document.body.innerHTML = '' })

describe('archive maintenance mounted Vue wiring', function () { this.timeout(10000)
  it('mounts the real gateway/createApi/useHttp/fetch with auth, catalog and appointment', async () => {
    const Panel = loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenancePanel.vue'); const fixture = panelFixture({ appointments: [] }); globalThis.fetch = fixture.fetch
    const wrapper = mount(Panel, { attachTo: document.body, props: { gateway: mountedGateway() } }); await waitFor(() => fixture.calls.some(call => call.path.endsWith('/slot')))
    expect(fixture.calls.some(call => call.path === '/agent/platform-skills/catalog')).to.equal(true); expect(fixture.calls.every(call => call.headers.Authorization === 'Bearer fixture-token')).to.equal(true)
    const inputs = wrapper.findAll('input').slice(0, 2); await inputs[0].setValue('agent-1'); await inputs[1].setValue('9'); await button(wrapper, '明确任职').trigger('click'); await waitFor(() => fixture.calls.some(call => call.path.endsWith('/appointments') && call.method === 'POST'))
    const call = fixture.calls.find(item => item.path.endsWith('/appointments') && item.method === 'POST'); expect(call.body.requiredSkill.version).to.equal('new-10'); expect(call.headers['If-Match']).to.equal('"v3"'); expect(button(wrapper, '明确任职').attributes('disabled')).to.equal(undefined); wrapper.unmount()
  })

  it('isolates catalog 404 while existing revoke and cancel still work', async () => {
    const Panel = loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenancePanel.vue'); const fixture = panelFixture({ catalogStatus: 404 }); globalThis.fetch = fixture.fetch
    const wrapper = mount(Panel, { attachTo: document.body, props: { gateway: mountedGateway() } }); await waitFor(() => wrapper.text().includes('当前技能目录不可用'))
    expect(button(wrapper, '申请安装').attributes('disabled')).to.equal(''); await button(wrapper, '撤任当前 Agent').trigger('click'); await waitFor(() => fixture.calls.some(call => call.path.endsWith('/revoke')))
    const select = wrapper.findAll('label').find(label => label.text().includes('选择维护单')).find('select'); await select.setValue('job-1'); await select.trigger('change'); await waitFor(() => wrapper.text().includes('作业 job-1'))
    const prompt = globalThis.prompt; globalThis.prompt = () => 'manager-cancel'; await button(wrapper, '明确取消维护单').trigger('click'); globalThis.prompt = prompt; await waitFor(() => fixture.calls.some(call => call.path.endsWith('/cancel'))); wrapper.unmount()
  })

  it('uses fixed source/draft/MANUAL publish and recovery context for resume/reassign over reactive wire DTOs', async () => {
    const Panel = loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenancePanel.vue'); const fixture = panelFixture(); globalThis.fetch = fixture.fetch
    const wrapper = mount(Panel, { attachTo: document.body, props: { gateway: mountedGateway() } }); await waitFor(() => wrapper.find('input[type="file"]').exists())
    const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto'); Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto })
    try { const bytes = new TextEncoder().encode('典籍'); const file = { name: 'source.txt', size: bytes.byteLength, arrayBuffer: async () => bytes.buffer }; const input = wrapper.find('input[type="file"]'); Object.defineProperty(input.element, 'files', { configurable: true, value: [file] }); await input.trigger('change'); for (const [label, value] of [['底本名称', 'source.txt'], ['固定版本说明', 'v1'], ['公开用途权利依据', 'authorized']]) await wrapper.findAll('label').find(item => item.text().includes(label)).find('input').setValue(value); await wrapper.findAll('form').find(form => form.find('input[type="file"]').exists()).trigger('submit'); await waitFor(() => fixture.calls.some(call => call.path.endsWith('/source-snapshots')), wrapper.text()) } finally { if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto); else delete globalThis.crypto }
    const select = wrapper.findAll('label').find(item => item.text().includes('选择维护单')).find('select'); await select.setValue('job-1'); await select.trigger('change'); await waitFor(() => wrapper.find('textarea').exists())
    await wrapper.get('textarea').setValue(JSON.stringify({ blocks: [], excludedSourceRanges: [] })); await button(wrapper, '按版本保存草稿').trigger('click'); await waitFor(() => fixture.calls.some(call => call.path.endsWith('/draft') && call.method === 'PUT')); await button(wrapper, '校验当前草稿').trigger('click'); await waitFor(() => fixture.calls.some(call => call.path.endsWith('/validate'))); await button(wrapper, '由管理者明确发布').trigger('click'); await waitFor(() => fixture.calls.some(call => call.path.endsWith('/publish')))
    await wrapper.findAll('label').find(item => item.text().includes('恢复原因')).find('input').setValue('retry safely'); await button(wrapper, '按原任职恢复').trigger('click'); await waitFor(() => fixture.calls.some(call => call.path.endsWith('/resume')))
    const reassignment = wrapper.findAll('form').find(form => form.text().includes('新任职')).find('select'); await reassignment.setValue('appt-new'); await button(wrapper, '显式改派').trigger('click'); await waitFor(() => fixture.calls.some(call => call.path.endsWith('/reassign')))
    const resume = fixture.calls.find(call => call.path.endsWith('/resume')); const reassign = fixture.calls.find(call => call.path.endsWith('/reassign')); expect(resume.body.expectedAppointmentRevision).to.equal('1'); expect(resume.body.expectedSkill.version).to.equal('old-9'); expect(reassign.body.newAppointmentRevision).to.equal('5'); expect(reassign.body.newSkill.version).to.equal('new-10'); expect(resume.headers['If-Match']).to.equal('"v7"'); wrapper.unmount()
  })

  it('keeps mounted PENDING unknown intent/key/body until authoritative COMMITTED reconciliation', async () => {
    const Panel = loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenancePanel.vue'); const fixture = panelFixture(); const normalFetch = fixture.fetch; let operation = { key: 'operation-key', state: 'PENDING', targetType: 'job', targetId: 'job-pending' }
    globalThis.fetch = async (url, options) => { const path = String(url).split('?')[0]; if (path.endsWith('/requests')) return json({ msg: 'gateway uncertain' }, 503); if (path.endsWith('/operations/by-key')) return admin(operation); return normalFetch(url, options) }
    const gateway = mountedGateway(); const wrapper = mount(Panel, { attachTo: document.body, props: { gateway } }); await waitFor(() => wrapper.text().includes('固定来源 ID'))
    await wrapper.findAll('label').find(item => item.text().includes('固定来源 ID')).find('input').setValue('source-1')
    await wrapper.findAll('form').find(form => form.text().includes('确认维护请求')).trigger('submit')
    await waitFor(() => wrapper.text().includes('待核对的未知请求')); const retained = gateway.retainedIntent('maintenance-request'); const exactBody = retained.body
    await button(wrapper, '按原键核对').trigger('click'); await waitFor(() => wrapper.text().includes('尚未确认')); expect(gateway.retainedIntent('maintenance-request').body).to.deep.equal(exactBody)
    await gateway.confirm(exactBody).catch(() => {}); expect(gateway.retainedIntent('maintenance-request').key).to.equal(retained.key)
    operation = { key: 'operation-key', state: 'COMMITTED', targetType: 'job', targetId: 'job-committed' }; await button(wrapper, '按原键核对').trigger('click'); await waitFor(() => wrapper.text().includes('job-committed')); expect(wrapper.text()).not.to.include('待核对的未知请求'); wrapper.unmount()
  })

  it('blocks changed unknown body and protects B retained key/body from late A after clear', async () => {
    const first = deferred(); const second = deferred(); const calls = []; let count = 0
    const api = { post: async (path, body, options) => { calls.push({ path, body, options }); return (++count === 1 ? first : second).promise }, get: async () => ({ data: { data: null } }) }
    const gateway = createArchiveMaintenanceGateway({ adminApi: api, platformApi: api, operationKey: () => `key-${count + 1}` }); const body = { collectionId: 'platform-classics', operation: 'ADD_WORK', newWork: { canonicalKey: 'a', title: 'A', language: 'zh' }, workId: null, sourceId: 'source-1', requestedPublicationMode: 'MANUAL' }
    const A = gateway.confirm(body).catch(error => error); await waitFor(() => calls.length === 1); gateway.clear(); const B = gateway.confirm(body).catch(error => error); await waitFor(() => calls.length === 2); first.resolve({ data: { data: { jobId: 'old' } } }); await A; expect(gateway.retainedIntent('maintenance-request').key).to.equal('key-2'); second.reject(Object.assign(new Error('lost'), { status: 503 })); await B
    let changed; try { await gateway.confirm({ ...body, sourceId: 'changed' }) } catch (error) { changed = error }; expect(changed.code).to.equal('ARCHIVE_UNKNOWN_OPERATION')
    api.get = async () => ({ data: { data: { key: 'operation-key', state: 'PENDING', targetType: 'job', targetId: 'job-pending' } } }); expect((await gateway.operationByKey('maintenance-request')).state).to.equal('UNKNOWN'); expect(gateway.retainedIntent('maintenance-request').key).to.equal('key-2')
    api.get = async () => ({ data: { data: { key: 'operation-key', state: 'COMMITTED', targetType: 'job', targetId: 'job-committed' } } }); const committed = await gateway.operationByKey('maintenance-request'); expect(committed.state).to.equal('COMMITTED'); expect(committed.operation.targetId).to.equal('job-committed'); expect(gateway.retainedIntent('maintenance-request').body).to.deep.equal(body)
    const replay = deferred(); api.post = async (path, requestBody, options) => { calls.push({ path, body: requestBody, options }); return replay.promise }; const exact = gateway.confirm(body); await waitFor(() => calls.length === 3); expect(calls[2].options.headers['Idempotency-Key']).to.equal('key-2'); replay.resolve({ data: { data: { jobId: 'replayed' } } }); await exact
  })

  it('keeps busy releasable when an appoint refresh rebases authority', async () => {
    const Panel = loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenancePanel.vue'); const fixture = panelFixture({ appointments: [], capabilities: read => read === 1 ? { allowedActions: ['appoint', 'job.create', 'job.read', 'job.manage'] } : { allowedActions: ['job.manage'] } }); globalThis.fetch = fixture.fetch
    const wrapper = mount(Panel, { attachTo: document.body, props: { gateway: mountedGateway() } }); await waitFor(() => button(wrapper, '明确任职'))
    const inputs = wrapper.findAll('input').slice(0, 2); await inputs[0].setValue('agent-1'); await inputs[1].setValue('9'); await button(wrapper, '明确任职').trigger('click')
    await waitFor(() => fixture.calls.filter(call => call.path.endsWith('/capabilities')).length >= 2)
    await waitFor(() => button(wrapper, '刷新状态').attributes('disabled') === undefined)
    expect(button(wrapper, '明确任职')).to.equal(undefined); expect(wrapper.text()).not.to.include('Agent ID'); wrapper.unmount()
  })

  it('fails closed and clears mounted authority on catalog or capability authentication failure', async () => {
    const Panel = loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenancePanel.vue')
    const catalog = panelFixture({ catalogStatus: 401 }); globalThis.fetch = catalog.fetch; const catalogWrapper = mount(Panel, { attachTo: document.body, props: { gateway: mountedGateway() } }); await waitFor(() => catalogWrapper.text().includes('身份认证已失效')); expect(catalogWrapper.find('input[type="file"]').exists()).to.equal(false); catalogWrapper.unmount()
    const caps = panelFixture({ capabilitiesStatus: 401 }); globalThis.fetch = caps.fetch; const capsWrapper = mount(Panel, { attachTo: document.body, props: { gateway: mountedGateway() } }); await waitFor(() => capsWrapper.text().includes('身份认证已失效')); expect(capsWrapper.find('input[type="file"]').exists()).to.equal(false); capsWrapper.unmount()
  })

  it('fences identity/deferred work and clears sensitive forms after authority rebase', async () => {
    const Panel = loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenancePanel.vue'); const pending = deferred(); const fixture = panelFixture({ deferredRequest: pending }); globalThis.fetch = fixture.fetch
    const wrapper = mount(Panel, { attachTo: document.body, props: { gateway: mountedGateway() } }); await waitFor(() => wrapper.find('input[type="file"]').exists()); await wrapper.findAll('label').find(item => item.text().includes('固定来源 ID')).find('input').setValue('source-1'); await button(wrapper, '确认维护请求').trigger('click'); stopIdentityBoundWork(); pending.resolve(admin({ job: fixture.job, confirmationRef: 'late' })); await flushPromises(); expect(wrapper.text()).not.to.include('late'); wrapper.unmount()
    const downgrade = panelFixture({ capabilities: read => read === 1 ? { allowedActions: ['appoint', 'source.prepare', 'job.create', 'job.read', 'job.manage', 'draft.write', 'validate', 'publish'] } : { allowedActions: [] } }); globalThis.fetch = downgrade.fetch; const authority = mount(Panel, { attachTo: document.body, props: { gateway: mountedGateway() } }); await waitFor(() => authority.find('input[type="file"]').exists()); const sourceName = authority.findAll('label').find(item => item.text().includes('底本名称')).find('input'); await sourceName.setValue('sensitive'); await button(authority, '刷新状态').trigger('click'); await waitFor(() => authority.text().includes('当前身份没有典籍维护权限')); expect(authority.findAll('input').some(input => input.element.value === 'sensitive')).to.equal(false); authority.unmount()
  })

  it('renders UNCONFIRMED safely and fences receipt changes/unmount/denied GET', async () => {
    const Receipt = loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenanceReceiptCard.vue'); const api = authenticatedApi('/archive/admin/v1'); const calls = []; globalThis.fetch = async (url, options) => { calls.push({ path: String(url), headers: options.headers }); return admin({ state: 'PUBLISHED', publicationId: 'pub-secret' }) }
    const empty = mount(Receipt, { attachTo: document.body, props: { api, content: JSON.stringify({ type: 'archive_maintenance_receipt', archiveMaintenance: { state: 'UNCONFIRMED' } }) } }); expect(empty.text()).to.include('UNCONFIRMED'); expect(empty.find('button').exists()).to.equal(false); expect(calls).to.have.length(0); empty.unmount()
    const late = deferred(); globalThis.fetch = () => late.promise; const receipt = mount(Receipt, { attachTo: document.body, props: { api, content: JSON.stringify({ type: 'archive_maintenance_receipt', archiveMaintenance: { jobId: 'old' } }) } }); await receipt.get('button').trigger('click'); await receipt.setProps({ content: JSON.stringify({ type: 'archive_maintenance_receipt', archiveMaintenance: { jobId: 'new' } }) }); late.resolve(admin({ state: 'PUBLISHED', publicationId: 'pub-secret' })); await flushPromises(); expect(receipt.text()).not.to.include('pub-secret'); receipt.unmount()
    globalThis.fetch = async () => json({ msg: 'forbidden' }, 403); const denied = mount(Receipt, { attachTo: document.body, props: { api, content: JSON.stringify({ type: 'archive_maintenance_receipt', archiveMaintenance: { jobId: 'denied' } }) } }); await denied.get('button').trigger('click'); await waitFor(() => denied.text().includes('不授予访问权限')); denied.unmount()
  })

  it('keeps MANUAL/AUTO explicit and uses canonical Songjiang without private fallback', () => {
    const selectedAgent = Vue.ref(null); const context = useHallChatContext({ agents: Vue.ref([{ agentId: 'agent-appointed', boundToMe: true, canOperate: true }]), portraitShortName: () => '受任好汉', selectedAgent, selectedTask: Vue.ref(null) }); expect(context.enterPrivateConversation({ agentId: 'agent-appointed', boundToMe: true, canOperate: true })).to.equal(true); expect(context.chatContext.value.targetAgentIds).to.deep.equal(['agent-appointed']); context.enterArchiveSongjiangConversation(); expect(context.chatContext.value.targetAgentIds).to.deep.equal(['builtin-songjiang'])
  })
})
