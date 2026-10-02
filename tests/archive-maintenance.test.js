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
const publicationResult = ({ jobId='job-1', workId='work-1', editionId='e1', draftRevision='4', readbackState='PENDING' } = {}) => ({ publicationId:`pub-${jobId}`,jobId,workId,editionId,draftRevision,manifestSha256:'a'.repeat(64),sourceSha256:'b'.repeat(64),state:'PUBLISHED',readbackState,verification:{state:'PENDING',revision:'1',verificationDigest:null,findings:[],checkedAt:null} })
const publicationAdminOperation = ({ operationId='op-publish', key, jobId='job-1', draftId='draft-1', draftRevision='4', state='COMMITTED', verificationState='PENDING', result=publicationResult({jobId,draftRevision,readbackState:'PENDING'}) } = {}) => ({ operationId,key,state,method:'POST',path:`/archive/admin/v1/drafts/${draftId}/publish`,collectionId:'platform-classics',jobId,draftId,action:'DRAFT_PUBLISH',authorizationRevision:'3',result,verification:result?{state:verificationState,revision:verificationState==='PENDING'?'1':'2',verificationDigest:verificationState==='PENDING'?null:'c'.repeat(64),findings:verificationState==='FAILED'?['readback']:[],checkedAt:verificationState==='PENDING'?null:'2026-10-01T00:00:01Z'}:null })
const handlingFacts = ({ jobId = 'job-1', assignmentStatus = 'ACTIVE', assignedAgentId = 'agent-current', permissionProfile = 'PUBLISH_VALIDATED', completedChapters = '0', totalKnown = true, totalChapters = '12', publicationState = 'PUBLISHED', verificationState = 'PASSED', readerTarget = { workId: 'work-1', editionId: 'edition-1' } } = {}) => ({
  title: '水浒传校勘', collectionId: 'platform-classics', source: { sourceId: 'source-1', sourceName: '水浒传底本', sourceVersion: 'v1' },
  assignedAgentId: assignmentStatus === 'ACTIVE' ? assignedAgentId : null, permissionProfile: assignmentStatus === 'ACTIVE' ? permissionProfile : null,
  publicationMode: 'MANUAL', stage: 'VALIDATING', blocker: ['REVOKED', 'BINDING_CHANGED'].includes(assignmentStatus) ? 'REASSIGNMENT_REQUIRED' : null,
  progress: { completedChapters, totalKnown, totalChapters: totalKnown ? totalChapters : null },
  currentPublication: { state: publicationState, receipt: { publicationId: 'pub-1', jobId, workId: 'work-1', editionId: 'edition-1', draftRevision: '4', manifestSha256: 'a'.repeat(64), sourceSha256: 'b'.repeat(64) }, verification: { state: verificationState, revision: '2', verificationDigest: verificationState === 'PASSED' ? 'c'.repeat(64) : null, findings: [], checkedAt: verificationState === 'PASSED' ? '2026-10-02T00:00:01Z' : null }, readerTarget: publicationState === 'PUBLISHED' && verificationState === 'PASSED' ? readerTarget : null },
  assignmentStatus, assignmentSnapshot: { appointmentId: 'appt-history', appointmentRevision: '1', assignedAgentId: 'agent-history', permissionProfile: 'DRAFT_ONLY' }
})
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
const loadChatPanelSfc = ArchiveMaintenanceReceiptCard => {
  const relativePath = '../src/components/juyiting/ChatPanel.vue'
  const filename = new URL(relativePath, import.meta.url).pathname
  const { descriptor } = parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'), { filename })
  const source = compileScript(descriptor, { id: 'archive-chat-facts-chat', inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_line, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
    .replace(/^import\s+\{\s*marked\s*\}\s+from\s+['"]marked['"];?\s*$/gm, 'var marked = arguments[1]')
    .replace(/^import\s+DOMPurify\s+from\s+['"]dompurify['"];?\s*$/gm, 'var DOMPurify = arguments[2]')
    .replace(/^import\s+HallChatComposer\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var HallChatComposer = arguments[3]')
    .replace(/^import\s+HallConversationHistory\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var HallConversationHistory = arguments[3]')
    .replace(/^import\s+ArchiveMaintenanceReceiptCard\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var ArchiveMaintenanceReceiptCard = arguments[4]')
    .replace(/^import\s+\{\s*usePersonalWorkspace\s*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var usePersonalWorkspace = arguments[5].usePersonalWorkspace')
    .replace(/^import\s+\{\s*usePersonalWorkspaceConversationLinks\s*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var usePersonalWorkspaceConversationLinks = arguments[5].usePersonalWorkspaceConversationLinks')
    .replace(/^import\s+\{\s*usePersonalWorkspaceTaskLinks\s*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var usePersonalWorkspaceTaskLinks = arguments[5].usePersonalWorkspaceTaskLinks')
    .replace('export default', 'return')
  const noop = () => {}; const list = Vue.ref([]); const text = Vue.ref('')
  const empty = Vue.defineComponent({ setup: () => () => Vue.h('div') })
  const directory = () => ({ links: list, loading: Vue.ref(false), error: text, load: async () => false, attach: async () => {}, detach: async () => {}, dispose: noop })
  const workspace = () => ({ loading: Vue.ref(false), error: text, items: list, refresh: async () => {}, select: async () => null, dispose: noop })
  const marked = Object.assign(value => value, { setOptions: noop })
  return new Function('Vue', 'marked', 'DOMPurify', 'Empty', 'ArchiveMaintenanceReceiptCard', 'workspace', source)(Vue, marked, { sanitize: value => value }, empty, ArchiveMaintenanceReceiptCard, { usePersonalWorkspace: workspace, usePersonalWorkspaceConversationLinks: directory, usePersonalWorkspaceTaskLinks: directory })
}
const loadLibrarySfc = (ArchiveReader, ArchiveMaintenancePanel) => {
  const relativePath = '../src/components/juyiting/LibraryPanel.vue'
  const filename = new URL(relativePath, import.meta.url).pathname
  const { descriptor } = parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'), { filename })
  const source = compileScript(descriptor, { id: 'archive-chat-facts-library', inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_line, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
    .replace(/^import\s+ArchiveReader\s+from\s+['"].\/archive\/ArchiveReader\.vue['"];?\s*$/gm, 'var ArchiveReader = arguments[1]')
    .replace(/^import\s+ArchiveMaintenancePanel\s+from\s+['"].\/archive\/ArchiveMaintenancePanel\.vue['"];?\s*$/gm, 'var ArchiveMaintenancePanel = arguments[2]')
    .replace('export default', 'return')
  return new Function('Vue', 'ArchiveReader', 'ArchiveMaintenancePanel', source)(Vue, ArchiveReader, ArchiveMaintenancePanel)
}
const authenticatedApi = basePath => {
  const actual = createApi(basePath); const options = value => ({ ...value, authStore, needAuth: true, rum: false })
  return { ...actual, execute: value => actual.execute(options(value)), get: (path, params, value = {}) => actual.get(path, params, options(value)), post: (path, body, value = {}) => actual.post(path, body, options(value)), put: (path, body, value = {}) => actual.put(path, body, options(value)) }
}
const mountedGateway = () => createArchiveMaintenanceGateway({ adminApi: authenticatedApi('/archive/admin/v1'), readerApi: authenticatedApi('/archive/v1'), platformApi: authenticatedApi('/agent/platform-skills') })

const panelFixture = ({ catalogStatus = 200, capabilitiesStatus = 200, deferredRequest, deferredInstall, capabilities, appointments } = {}) => {
  const calls = []; let capabilityReads = 0; let publishKey = null
  const oldSkill = { key: 'archive-maintainer', version: 'old-9', packageSha256: 'o'.repeat(64) }
  const newSkill = { key: 'archive-maintainer', version: 'new-10', packageSha256: 'n'.repeat(64) }
  const job = { jobId: 'job-1', title: '水浒', state: 'DRAFTING', revision: '7', appointmentId: 'appt-old', operation: 'ADD_WORK', publicationMode: 'MANUAL', waitReason: 'WAITING_SOURCE', draftId: 'draft-1', handling: handlingFacts() }
  const active = appointments ?? [{ appointmentId: 'appt-old', revision: '2', agentId: 'old-agent', bindingVersion: 'binding-7', status: 'ACTIVE', permissionProfile: 'PUBLISH_VALIDATED', workScopeMode: 'EXPLICIT_WORKS', workIds: ['work-1'], readiness: 'READY', requiredSkill: oldSkill }]
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
    if (path.endsWith('/collections/platform-classics/works')) return admin({ items: [{ workId: 'work-1', title: '水浒', activeEditionId: 'e1', pendingJobId: null }] })
    if (path.endsWith('/events')) return admin([])
    if (path.endsWith('/draft')) return method === 'PUT' ? admin({ draftId:'draft-1', revision: '5', state:'EDITING', content:{ blocks: [], excludedSourceRanges: [] } }) : admin({ draftId:'draft-1', revision: '4', state: 'EDITING', content: { blocks: [], excludedSourceRanges: [] } })
    if (path.endsWith('/drafts/draft-1/validation')) return admin({ validationId:'validation-1', draftId:'draft-1', outcome: 'PASSED', draftRevision: '4', findings: [] })
    if (path.endsWith('/drafts/draft-1/validate')) return admin({ operationId:'op-validation', state:'PENDING' })
    if (path.endsWith('/drafts/draft-1/publish')) { publishKey=options.headers?.['Idempotency-Key']; return admin({ operationId:'op-publish', jobId:'job-1', state:'PENDING' }) }
    if (path.endsWith('/operations/op-validation')) return admin({ operationId:'op-validation', state:'COMMITTED', result:{} })
    if (path.endsWith('/operations/op-publish')) return admin(publicationAdminOperation({key:publishKey,state:'PENDING',result:null}))
    if (path.endsWith('/validate')) return admin({ outcome: 'PASSED', validationId: 'validation-1', draftRevision: '4', findings: [] })
    if (path.endsWith('/publish') || path.endsWith('/cancel') || path.endsWith('/execute') || path.endsWith('/resume') || path.endsWith('/reassign')) return admin(job)
    if (path.endsWith('/revoke')) return admin({ appointmentId: 'appt-old', status: 'REVOKED' })
    if (path.endsWith('/source-snapshots')) return admin({ operationId:'source-op', jobId:null, state:'PENDING' })
    if (path.endsWith('/operations/source-op')) return admin({ operationId:'source-op', state:'COMMITTED', result:{ sourceId: 'source-1', rawByteLength: 6, rawSha256: 'b'.repeat(64) } })
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
    const call = fixture.calls.find(item => item.path.endsWith('/appointments') && item.method === 'POST'); expect(call.body.requiredSkill.version).to.equal('new-10'); expect(call.body).to.include({workScopeMode:'COLLECTION'}); expect(call.body.workIds).to.deep.equal([]); expect(call.headers['If-Match']).to.equal('"v3"'); expect(button(wrapper, '明确任职').attributes('disabled')).to.equal(undefined); wrapper.unmount()
  })

  it('wires EXPLICIT_WORKS from managed works and renders complete server appointment facts', async () => {
    const Panel = loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenancePanel.vue')
    const emptyFixture = panelFixture({ appointments: [] }); globalThis.fetch = emptyFixture.fetch
    const formWrapper = mount(Panel, { attachTo: document.body, props: { gateway: mountedGateway() } }); await waitFor(() => formWrapper.text().includes('EXPLICIT_WORKS：明确作品'))
    const scope = formWrapper.findAll('select').find(item => item.findAll('option').some(option => option.element.value === 'EXPLICIT_WORKS')); await scope.setValue('EXPLICIT_WORKS'); await Vue.nextTick()
    const checkbox = formWrapper.find('input[type="checkbox"]'); expect(checkbox.exists()).to.equal(true); await checkbox.setValue(true)
    const labels = formWrapper.findAll('label'); await labels.find(item => item.text().includes('Agent ID')).find('input').setValue('agent-explicit'); await labels.find(item => item.text().includes('绑定版本')).find('input').setValue('binding-9'); await button(formWrapper, '明确任职').trigger('click'); await waitFor(() => emptyFixture.calls.some(call => call.path.endsWith('/appointments') && call.method === 'POST'))
    const appointCall = emptyFixture.calls.find(call => call.path.endsWith('/appointments') && call.method === 'POST'); expect(appointCall.body).to.include({workScopeMode:'EXPLICIT_WORKS'}); expect(appointCall.body.workIds).to.deep.equal(['work-1']); formWrapper.unmount()

    const summaryFixture = panelFixture(); globalThis.fetch = summaryFixture.fetch
    const summaryWrapper = mount(Panel, { attachTo: document.body, props: { gateway: mountedGateway() } }); await waitFor(() => summaryWrapper.text().includes('绑定 binding-7'))
    expect(summaryWrapper.text()).to.include('范围 EXPLICIT_WORKS（work-1）').and.include('技能 archive-maintainer@old-9').and.include(`包 SHA-256 ${'o'.repeat(64)}`).and.include('READY'); summaryWrapper.unmount()

    const exactSha='d'.repeat(64); const sameVersionFixture=panelFixture({appointments:[{appointmentId:'appt-current',revision:'4',agentId:'agent-current',bindingVersion:'binding-current',status:'ACTIVE',permissionProfile:'DRAFT_ONLY',workScopeMode:'COLLECTION',workIds:[],readiness:'READY',requiredSkill:{key:'archive-maintainer',version:'new-10',packageSha256:exactSha}}]}); globalThis.fetch=sameVersionFixture.fetch
    const sameVersionWrapper=mount(Panel,{attachTo:document.body,props:{gateway:mountedGateway()}}); await waitFor(()=>sameVersionWrapper.text().includes('绑定 binding-current')); expect(sameVersionWrapper.text()).to.include(`技能 archive-maintainer@new-10 · 包 SHA-256 ${exactSha}`).and.not.include(`包 SHA-256 ${'n'.repeat(64)}`); sameVersionWrapper.unmount()
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
    // The structured editor now owns content writes; this existing recovery test keeps its real mounted resume/reassign focus.
    expect(wrapper.findAll('textarea').length).to.be.greaterThan(0)
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


  it('forwards the actual receipt card actions through the mounted ChatPanel without trusting message fields', async () => {
    const Receipt = loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenanceReceiptCard.vue'); const Chat = loadChatPanelSfc(Receipt)
    globalThis.fetch = async () => admin({ jobId: 'job-chat', handling: handlingFacts({ jobId: 'job-chat' }) })
    const wrapper = mount(Chat, { attachTo: document.body, props: { archiveApi: authenticatedApi('/archive/admin/v1'), mentionLabel: () => '', senderText: () => '系统', messages: [{ sender: 'SYSTEM', content: JSON.stringify({ type: 'archive_maintenance_receipt', archiveMaintenance: { jobId: 'job-chat', fakeEditionId: 'never-trusted' } }) }] } })
    await waitFor(() => wrapper.text().includes('水浒传校勘'))
    await button(wrapper, '查看维护单').trigger('click'); await waitFor(() => wrapper.emitted('open-maintenance-job'))
    await button(wrapper, '打开典籍').trigger('click'); await waitFor(() => wrapper.emitted('open-archive-edition'))
    expect(wrapper.emitted('open-maintenance-job').at(-1)[0]).to.deep.equal({ jobId: 'job-chat' })
    expect(wrapper.emitted('open-archive-edition').at(-1)[0]).to.deep.equal({ workId: 'work-1', editionId: 'edition-1' })
    wrapper.unmount()
  })

  it('renders only reauthorized handling facts and emits exact maintenance/reader targets', async () => {
    const Receipt = loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenanceReceiptCard.vue'); const api = authenticatedApi('/archive/admin/v1'); const calls = []
    const job = { jobId: 'job-facts', handling: handlingFacts({ jobId: 'job-facts', completedChapters: '0', totalKnown: true, totalChapters: '12' }) }
    globalThis.fetch = async (url, options = {}) => { calls.push({ path: String(url).split('?')[0], headers: options.headers }); return admin(job) }
    const wrapper = mount(Receipt, { attachTo: document.body, props: { api, content: JSON.stringify({ type: 'archive_maintenance_receipt', archiveMaintenance: { jobId: 'job-facts' } }) } })
    await waitFor(() => wrapper.text().includes('实际章节进度：0 / 12'))
    expect(wrapper.text()).to.include('agent-current · PUBLISH_VALIDATED').and.include('历史任职快照：agent-history')
    expect(calls.every(call => call.headers.Authorization === 'Bearer fixture-token')).to.equal(true)
    await button(wrapper, '查看维护单').trigger('click'); await waitFor(() => wrapper.emitted('open-maintenance'))
    expect(wrapper.emitted('open-maintenance').at(-1)[0]).to.deep.equal({ jobId: 'job-facts' })
    await button(wrapper, '打开典籍').trigger('click'); await waitFor(() => wrapper.emitted('open-edition'))
    expect(wrapper.emitted('open-edition').at(-1)[0]).to.deep.equal({ workId: 'work-1', editionId: 'edition-1' })
    wrapper.unmount()
  })

  it('keeps revoked assignment historical-only while independently allowing a current passed reader target', async () => {
    const Receipt = loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenanceReceiptCard.vue'); const api = authenticatedApi('/archive/admin/v1')
    globalThis.fetch = async () => admin({ jobId: 'job-revoked', handling: handlingFacts({ jobId: 'job-revoked', assignmentStatus: 'REVOKED', completedChapters: '3', totalKnown: false, totalChapters: null }) })
    const wrapper = mount(Receipt, { attachTo: document.body, props: { api, content: JSON.stringify({ type: 'archive_maintenance_receipt', archiveMaintenance: { jobId: 'job-revoked' } }) } })
    await waitFor(() => wrapper.text().includes('当前任职已失效，需要重新改派'))
    expect(wrapper.text()).to.include('3 章完成；总章数未知').and.include('历史任职快照：agent-history').and.not.include('当前任职：agent-current')
    expect(button(wrapper, '打开典籍')).not.to.equal(undefined)
    wrapper.unmount()
    globalThis.fetch = async () => admin({ jobId: 'job-binding', handling: handlingFacts({ jobId: 'job-binding', assignmentStatus: 'BINDING_CHANGED' }) })
    const bindingChanged = mount(Receipt, { attachTo: document.body, props: { api, content: JSON.stringify({ type: 'archive_maintenance_receipt', archiveMaintenance: { jobId: 'job-binding' } }) } })
    await waitFor(() => bindingChanged.text().includes('当前任职已失效，需要重新改派'))
    expect(bindingChanged.text()).to.include('阻塞 REASSIGNMENT_REQUIRED').and.not.include('当前任职：agent-current')
    bindingChanged.unmount()
  })

  it('does not expose a pending, failed, withdrawn, or identity-late handling receipt as a reader target', async () => {
    const Receipt = loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenanceReceiptCard.vue'); const api = authenticatedApi('/archive/admin/v1'); const late = deferred(); let phase = 'pending'
    globalThis.fetch = async () => phase === 'late' ? late.promise : admin({ jobId: 'job-negative', handling: handlingFacts({ jobId: 'job-negative', publicationState: phase === 'withdrawn' ? 'WITHDRAWN' : 'PUBLISHED', verificationState: phase === 'failed' ? 'FAILED' : 'PENDING' }) })
    const content = JSON.stringify({ type: 'archive_maintenance_receipt', archiveMaintenance: { jobId: 'job-negative' } })
    const pending = mount(Receipt, { attachTo: document.body, props: { api, content } }); await waitFor(() => pending.text().includes('不可打开阅读')); expect(button(pending, '打开典籍')).to.equal(undefined); pending.unmount()
    phase = 'failed'; const failed = mount(Receipt, { attachTo: document.body, props: { api, content } }); await waitFor(() => failed.text().includes('FAILED')); expect(button(failed, '打开典籍')).to.equal(undefined); failed.unmount()
    phase = 'withdrawn'; const withdrawn = mount(Receipt, { attachTo: document.body, props: { api, content } }); await waitFor(() => withdrawn.text().includes('WITHDRAWN')); expect(button(withdrawn, '打开典籍')).to.equal(undefined); withdrawn.unmount()
    phase = 'late'; const stale = mount(Receipt, { attachTo: document.body, props: { api, content } }); stopIdentityBoundWork(); late.resolve(admin({ jobId: 'job-negative', handling: handlingFacts({ jobId: 'job-negative' }) })); await flushPromises(); expect(stale.text()).not.to.include('agent-current').and.not.to.include('打开典籍'); stale.unmount()
  })

  it('does not expose malformed PASSED verification or non-positive immutable draft revision as a reader target', async () => {
    const Receipt = loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenanceReceiptCard.vue')
    const variants = [
      ['missing digest', facts => { facts.currentPublication.verification.verificationDigest = null }],
      ['missing checkedAt', facts => { facts.currentPublication.verification.checkedAt = null }],
      ['invalid checkedAt', facts => { facts.currentPublication.verification.checkedAt = 'not-an-instant' }],
      ['null verification revision', facts => { facts.currentPublication.verification.revision = null }],
      ['zero verification revision', facts => { facts.currentPublication.verification.revision = '0' }],
      ['malformed verification revision', facts => { facts.currentPublication.verification.revision = '01' }],
      ['null findings', facts => { facts.currentPublication.verification.findings = null }],
      ['non-string finding', facts => { facts.currentPublication.verification.findings = ['ok', 7] }],
      ['zero immutable draft revision', facts => { facts.currentPublication.receipt.draftRevision = '0' }]
    ]
    for (const [_label, mutate] of variants) {
      const api = authenticatedApi('/archive/admin/v1')
      const handling = handlingFacts({ jobId: 'job-malformed' }); mutate(handling)
      globalThis.fetch = async () => admin({ jobId: 'job-malformed', handling })
      const wrapper = mount(Receipt, { attachTo: document.body, props: { api, content: JSON.stringify({ type: 'archive_maintenance_receipt', archiveMaintenance: { jobId: 'job-malformed' } }) } })
      await waitFor(() => wrapper.text().includes('当前发布：'))
      expect(button(wrapper, '打开典籍'), _label).to.equal(undefined)
      expect(wrapper.emitted('open-edition'), _label).to.equal(undefined)
      wrapper.unmount()
    }
  })

  it('removes an initially readable action when its click-time reauthorization returns malformed PASSED verification', async () => {
    const Receipt = loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenanceReceiptCard.vue')
    const api = authenticatedApi('/archive/admin/v1'); let reads = 0
    globalThis.fetch = async () => {
      const handling = handlingFacts({ jobId: 'job-click-malformed' })
      if (++reads > 1) handling.currentPublication.verification = { state: 'PASSED', revision: '0', verificationDigest: null, findings: null, checkedAt: null }
      return admin({ jobId: 'job-click-malformed', handling })
    }
    const wrapper = mount(Receipt, { attachTo: document.body, props: { api, content: JSON.stringify({ type: 'archive_maintenance_receipt', archiveMaintenance: { jobId: 'job-click-malformed' } }) } })
    await waitFor(() => button(wrapper, '打开典籍'))
    await button(wrapper, '打开典籍').trigger('click')
    await waitFor(() => button(wrapper, '打开典籍') === undefined)
    expect(reads).to.equal(2)
    expect(wrapper.emitted('open-edition')).to.equal(undefined)
    wrapper.unmount()
  })

  it('fences receipt job A/B/A late facts and does not retain a stale current assignment', async () => {
    const Receipt = loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenanceReceiptCard.vue'); const api = authenticatedApi('/archive/admin/v1')
    const firstA = deferred(), B = deferred(), secondA = deferred(); let aReads = 0, bReads = 0
    globalThis.fetch = async url => { const path = String(url).split('?')[0]; if (path.endsWith('/jobs/job-a')) return (++aReads === 1 ? firstA : secondA).promise; bReads += 1; return B.promise }
    const content = id => JSON.stringify({ type: 'archive_maintenance_receipt', archiveMaintenance: { jobId: id } })
    const wrapper = mount(Receipt, { attachTo: document.body, props: { api, content: content('job-a') } })
    await waitFor(() => aReads === 1); await wrapper.setProps({ content: content('job-b') }); await waitFor(() => bReads === 1)
    await wrapper.setProps({ content: content('job-a') }); await waitFor(() => aReads === 2)
    firstA.resolve(admin({ jobId: 'job-a', handling: handlingFacts({ jobId: 'job-a', assignedAgentId: 'stale-agent' }) })); B.resolve(admin({ jobId: 'job-b', handling: handlingFacts({ jobId: 'job-b', assignedAgentId: 'wrong-agent' }) })); secondA.resolve(admin({ jobId: 'job-a', handling: handlingFacts({ jobId: 'job-a', assignedAgentId: 'fresh-agent' }) }))
    await waitFor(() => wrapper.text().includes('fresh-agent'))
    expect(wrapper.text()).not.to.include('stale-agent').and.not.to.include('wrong-agent')
    wrapper.unmount()
  })

  it('uses real createApi.execute PATCH and exact withdraw/source operation routes', async () => {
    const calls=[]; globalThis.fetch=async (url,options={})=>{const path=String(url).split('?')[0];calls.push({path,method:options.method,body:options.body?JSON.parse(options.body):null,headers:options.headers}); if(path.endsWith('/source-snapshots'))return admin({operationId:'source-op',jobId:null,state:'PENDING'}); if(path.endsWith('/operations/source-op'))return admin({operationId:'source-op',state:'COMMITTED',result:{sourceId:'source-1'}}); return admin({})}
    const gateway=mountedGateway(); await gateway.patchDraft('draft-1',{blocks:[],excludedSourceRanges:[]},'4'); await gateway.withdraw('work-1','edition-1',{reason:'withdrawn',replacementActiveEditionId:null},'9'); const source=await gateway.prepareSource({sourceName:'x',sourceVersion:'v',rightsBasis:'r',declaredSha256:'a'.repeat(64),contentBase64:'eA=='}); await gateway.operation(source.operationId)
    const patch=calls.find(call=>call.path.endsWith('/drafts/draft-1')); const withdrawal=calls.find(call=>call.path.endsWith('/works/work-1/editions/edition-1/withdraw')); expect(patch.method).to.equal('PATCH'); expect(patch.headers['If-Match']).to.equal('"v4"'); expect(withdrawal.body).to.deep.equal({reason:'withdrawn',replacementActiveEditionId:null}); expect(withdrawal.headers['If-Match']).to.equal('"v9"'); expect(calls.some(call=>call.path.endsWith('/operations/source-op'))).to.equal(true); expect(calls.every(call=>call.headers.Authorization==='Bearer fixture-token')).to.equal(true)
  })

  it('keeps MANUAL/AUTO explicit and uses canonical Songjiang without private fallback', () => {
    const selectedAgent = Vue.ref(null); const context = useHallChatContext({ agents: Vue.ref([{ agentId: 'agent-appointed', boundToMe: true, canOperate: true }]), portraitShortName: () => '受任好汉', selectedAgent, selectedTask: Vue.ref(null) }); expect(context.enterPrivateConversation({ agentId: 'agent-appointed', boundToMe: true, canOperate: true })).to.equal(true); expect(context.chatContext.value.targetAgentIds).to.deep.equal(['agent-appointed']); context.enterArchiveSongjiangConversation(); expect(context.chatContext.value.targetAgentIds).to.deep.equal(['builtin-songjiang'])
  })
})

describe('archive complete-management mounted paths', function () { this.timeout(10000)
  const jobSelect = wrapper => wrapper.findAll('select').find(item => item.findAll('option').some(option => option.element.value === 'job-1'))
  it('opens an explicit receipt job through the actual LibraryPanel and maintenance panel gateway', async () => {
    const Panel = loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenancePanel.vue')
    const observed = []
    const ArchiveReader = Vue.defineComponent({ setup(_props, { expose }) { expose({ openEdition: async target => { observed.push(target); return true } }); return () => Vue.h('section', { class: 'reader-stub' }) } })
    const Library = loadLibrarySfc(ArchiveReader, Panel); const fixture = panelFixture(); globalThis.fetch = fixture.fetch
    const wrapper = mount(Library, { attachTo: document.body, props: { archiveGateway: mountedGateway(), formatTime: () => '' } })
    expect(await wrapper.vm.openMaintenanceJob({ jobId: 'job-1' })).to.equal(true)
    await waitFor(() => wrapper.text().includes('作业 job-1'))
    expect(fixture.calls.some(call => call.path.endsWith('/jobs/job-1') && call.method === 'GET')).to.equal(true)
    expect(wrapper.find('#library-maintenance-panel').attributes('role')).to.equal('tabpanel')
    await wrapper.vm.openVerifiedEdition({ workId: 'work-card', editionId: 'edition-card' })
    expect(observed).to.deep.equal([{ workId: 'work-card', editionId: 'edition-card' }])
    wrapper.unmount()
  })

  it('loads managed works for withdraw-only and hides publish controls', async () => {
    const Panel = loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenancePanel.vue'); const fixture = panelFixture({ capabilities: () => ({ allowedActions: ['edition.withdraw'] }) }); globalThis.fetch = fixture.fetch
    const wrapper = mount(Panel, { attachTo: document.body, props: { gateway: mountedGateway() } }); await waitFor(() => fixture.calls.some(call => call.path.endsWith('/works')))
    expect(wrapper.text()).to.include('版本与记录'); expect(wrapper.text()).not.to.include('由管理者明确发布'); wrapper.unmount()
  })
  it('uses current appointment snapshot and real missing ADD_WORK body for WAITING_INPUT', async () => {
    const Panel = loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenancePanel.vue'); const fixture = panelFixture(); const normal = fixture.fetch
    globalThis.fetch = async (url, options = {}) => { const path = String(url).split('?')[0]; if (path.endsWith('/jobs/job-1') && (options.method || 'GET') === 'GET') return admin({ ...fixture.job, state: 'WAITING_INPUT', sourceId: null, workId: null, appointmentId: 'appt-old' }); return normal(url, options) }
    const wrapper = mount(Panel, { attachTo: document.body, props: { gateway: mountedGateway() } }); await waitFor(() => jobSelect(wrapper)); const select = jobSelect(wrapper); await select.setValue('job-1'); await select.trigger('change'); await waitFor(() => wrapper.text().includes('补全等待输入'))
    const form = wrapper.findAll('form').find(item => item.text().includes('补全等待输入')); const labels = form.findAll('label'); for (const [name, value] of [['来源 ID','source-new'],['作品唯一 key','water-margin'],['作品标题','水浒传'],['作品语言','zh']]) await labels.find(item => item.text().includes(name)).find('input').setValue(value)
    await form.trigger('submit'); await waitFor(() => fixture.calls.some(call => call.path.endsWith('/resolve-input')))
    const call = fixture.calls.find(call => call.path.endsWith('/resolve-input')); expect(call.body).to.deep.include({ sourceId:'source-new', expectedAppointmentId:'appt-old', expectedAppointmentRevision:'2' }); expect(call.body.expectedSkill.version).to.equal('old-9'); expect(call.body.newWork).to.deep.equal({canonicalKey:'water-margin',title:'水浒传',language:'zh'}); wrapper.unmount()
  })
  it('permits real draft mount when GET current validation is exact 404', async () => {
    const Panel = loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenancePanel.vue'); const fixture = panelFixture(); const normal = fixture.fetch
    globalThis.fetch = async (url, options = {}) => String(url).split('?')[0].endsWith('/drafts/draft-1/validation') ? json({ msg:'no current validation' },404) : normal(url, options)
    const wrapper = mount(Panel, { attachTo: document.body, props: { gateway: mountedGateway() } }); await waitFor(() => jobSelect(wrapper)); const select = jobSelect(wrapper); await select.setValue('job-1'); await select.trigger('change'); await waitFor(() => wrapper.text().includes('草稿版本 4')); expect(wrapper.text()).not.to.include('请求结果尚不明确'); wrapper.unmount()
  })
})

  it('mounts structured block PUT and metadata PATCH through real createApi.execute', async function () { this.timeout(10000)
    const jobSelect = wrapper => wrapper.findAll('select').find(item => item.findAll('option').some(option => option.element.value === 'job-1'))
    const Panel = loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenancePanel.vue'); const fixture = panelFixture(); const normal = fixture.fetch
    const content = { blocks:[{blockType:'CHAPTER',blockKey:'block-1',ordinal:1,title:'第一回',titleSourceRanges:[],paragraphs:[{ordinal:1,text:'原文',sourceRanges:[{startByte:0,endByte:6}]}]}], excludedSourceRanges:[] }
    globalThis.fetch = async (url, options = {}) => { const path=String(url).split('?')[0], method=options.method||'GET'; fixture.calls.push({path,method,body:options.body?JSON.parse(options.body):null,headers:options.headers}); if(path.endsWith('/jobs/job-1/draft')&&method==='GET') return admin({draftId:'draft-1',revision:'4',state:'EDITING',content}); if(path.endsWith('/drafts/draft-1/blocks/block-1')&&method==='GET') return admin({draftId:'draft-1',jobId:'job-1',revision:'4',state:'EDITING',block:content.blocks[0]}); if(path.endsWith('/drafts/draft-1/blocks/block-1')&&method==='PUT') return admin({draftId:'draft-1',jobId:'job-1',revision:'5',state:'EDITING',block:JSON.parse(options.body)}); if(path.endsWith('/drafts/draft-1')&&method==='PATCH') return admin({draftId:'draft-1',revision:'5',state:'EDITING',content}); return normal(url,options) }
    const wrapper=mount(Panel,{attachTo:document.body,props:{gateway:mountedGateway()}}); await waitFor(()=>jobSelect(wrapper)); const jobs=jobSelect(wrapper); await jobs.setValue('job-1'); await jobs.trigger('change'); await waitFor(()=>wrapper.findAll('select').some(item=>item.findAll('option').some(option=>option.element.value==='block-1'))); const blocks=wrapper.findAll('select').find(item=>item.findAll('option').some(option=>option.element.value==='block-1')); await blocks.setValue('block-1'); await blocks.trigger('change'); await waitFor(()=>wrapper.text().includes('结构化章节编辑')); await button(wrapper,'保存章节与来源映射').trigger('click'); await waitFor(()=>fixture.calls.some(call=>call.path.endsWith('/blocks/block-1')&&call.method==='PUT')); await button(wrapper,'保存目录、顺序与排除范围').trigger('click'); await waitFor(()=>fixture.calls.some(call=>call.path.endsWith('/drafts/draft-1')&&call.method==='PATCH')); const put=fixture.calls.find(call=>call.path.endsWith('/blocks/block-1')&&call.method==='PUT'), patch=fixture.calls.find(call=>call.path.endsWith('/drafts/draft-1')&&call.method==='PATCH'); expect(put.headers['If-Match']).to.equal('"v4"'); expect(patch.headers['If-Match']).to.equal('"v4"'); expect(put.body.paragraphs[0].sourceRanges[0]).to.deep.equal({startByte:0,endByte:6}); wrapper.unmount()
  })

it('retains source 202 across lost operation GET and consumes only authoritative committed result', async function () { this.timeout(10000)
  const calls=[]; let phase='lost'; globalThis.fetch=async (url,options={})=>{const path=String(url).split('?')[0],method=options.method||'GET';calls.push({path,method,body:options.body?JSON.parse(options.body):null,headers:options.headers}); if(path.endsWith('/source-snapshots'))return admin({operationId:'source-op',jobId:null,state:'PENDING'}); if(path.endsWith('/operations/source-op'))return phase==='lost'?json({msg:'later'},503):admin({operationId:'source-op',key:options.headers?.['Idempotency-Key']||'k',state:'COMMITTED',result:{sourceId:'source-1',rawByteLength:6,rawSha256:'a'.repeat(64)}}); if(path.endsWith('/operations/by-key'))return json({msg:'not found'},404); return admin({})}
  const gateway=mountedGateway(); const body={sourceName:'x',sourceVersion:'v',rightsBasis:'r',declaredSha256:'a'.repeat(64),contentBase64:'eA=='}; const accepted=await gateway.prepareSource(body); const retained=gateway.retainedIntent('prepare-source'); expect(accepted.operationId).to.equal('source-op'); expect(retained.body).to.deep.equal(body); expect((await gateway.operationByKey('prepare-source')).state).to.equal('UNKNOWN'); expect(gateway.retainedIntent('prepare-source').key).to.equal(retained.key); phase='committed'; const committed=await gateway.operationByKey('prepare-source'); expect(committed.state).to.equal('COMMITTED'); expect(committed.operation.result.sourceId).to.equal('source-1'); expect(gateway.retainedIntent('prepare-source').body).to.deep.equal(body); gateway.acknowledgeRetainedIntent('prepare-source'); expect(gateway.retainedIntent('prepare-source')).to.equal(null)
})

it('loads actual Reader catalog/blocks and withdraws the frozen selected edition', async function () { this.timeout(10000)
  const Panel=loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenancePanel.vue'); const fixture=panelFixture({capabilities:()=>({allowedActions:['edition.withdraw']})}); const normal=fixture.fetch; const seen=[]
  const manifest=id=>(id==='e1'?'1':'2').repeat(64)
  const summary=id=>({blockType:'CHAPTER',blockId:`${id}-c1`,number:1,title:id==='e1'?'第一回':'第一回 修订',paragraphCount:1,utf8ByteLength:12,etag:(id==='e1'?'a':'b').repeat(64)})
  const catalog=id=>({representationSchemaVersion:1,workId:'work-1',title:'水浒',activeEdition:{editionId:id,manifestSha256:manifest(id),sourceSha256:'s'.repeat(64),prefaceParagraphCount:0,chapterParagraphCount:1,readerParagraphCount:1,readerUtf8ByteLength:12,preface:null,chapters:[summary(id)]}})
  const block=id=>({representationSchemaVersion:1,editionId:id,manifestSha256:manifest(id),...summary(id),paragraphCount:1,utf8ByteLength:12,paragraphs:[{paragraphId:`${id}-c1-p1`,ordinal:1,text:id==='e1'?'旧段落正文':'新段落正文',utf8ByteLength:12,sha256:(id==='e1'?'c':'d').repeat(64)}]})
  const version=id=>({publicationId:`pub-${id}`,collectionId:'platform-classics',workId:'work-1',editionId:id,draftRevision:'4',manifestSha256:manifest(id),sourceSha256:'s'.repeat(64),state:'PUBLISHED',actorType:'HUMAN',actorId:'manager-1',authorizationRevision:'3',publishedAt:'2026-10-01T00:00:00Z',withdrawal:null,verification:{state:'PASSED',revision:'1',verificationDigest:'v'.repeat(64),findings:[],checkedAt:'2026-10-01T00:00:01Z'}})
  globalThis.fetch=async(url,options={})=>{const path=String(url).split('?')[0],method=options.method||'GET'; seen.push(path); if(path.endsWith('/works/work-1/editions')&&method==='GET')return admin({workId:'work-1',workRevision:'8',activeEditionId:'e1',editions:[version('e1'),version('e2')]}); const detail=path.match(/\/works\/work-1\/editions\/(e1|e2)$/); if(detail&&method==='GET')return admin(version(detail[1])); const readerCatalog=path.match(/\/archive\/v1\/editions\/(e1|e2)\/catalog$/); if(readerCatalog)return admin(catalog(readerCatalog[1])); const readerBlock=path.match(/\/archive\/v1\/editions\/(e1|e2)\/chapters\/(e1|e2)-c1$/); if(readerBlock)return admin(block(readerBlock[1])); if(path.endsWith('/works/work-1/editions/e1/withdraw')&&method==='POST')return normal(url,options); return normal(url,options)}
  const wrapper=mount(Panel,{attachTo:document.body,props:{gateway:mountedGateway()}})
  await waitFor(()=>wrapper.findAll('select').some(item=>item.findAll('option').some(option=>option.element.value==='work-1')),'managed work missing')
  const work=wrapper.findAll('select').find(item=>item.findAll('option').some(option=>option.element.value==='work-1')); await work.setValue('work-1')
  await waitFor(()=>button(wrapper,'e1'),'history missing'); await button(wrapper,'e1').trigger('click')
  await waitFor(()=>wrapper.text().includes('阅读已核验版本'),`reader detail missing: ${wrapper.text()}`); await waitFor(()=>seen.some(path=>path.endsWith('/editions/e1/chapters/e1-c1')),`primary Reader block missing: ${seen.join(' | ')}`); await flushPromises()
  await button(wrapper,'阅读已核验版本').trigger('click'); expect(wrapper.emitted('open-edition')[0][0]).to.deep.equal({workId:'work-1',editionId:'e1'}); expect(button(wrapper,'由管理者明确发布')).to.equal(undefined)
  const reason=wrapper.findAll('label').find(item=>item.text().includes('下架原因')).find('input'); await reason.setValue('obsolete'); await wrapper.findAll('form').find(item=>item.text().includes('显式下架此版本')).trigger('submit'); await waitFor(()=>fixture.calls.some(call=>call.path.endsWith('/withdraw')),'withdraw missing'); const withdrawal=fixture.calls.find(call=>call.path.endsWith('/withdraw')); expect(withdrawal.body).to.deep.equal({reason:'obsolete',replacementActiveEditionId:null}); expect(withdrawal.headers['If-Match']).to.equal('"v8"'); wrapper.unmount()
})

it('moves actual archive tab focus with roving tab semantics', async function () { this.timeout(10000)
  const Panel=loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenancePanel.vue'); const fixture=panelFixture(); globalThis.fetch=fixture.fetch; const wrapper=mount(Panel,{attachTo:document.body,props:{gateway:mountedGateway()}}); await waitFor(()=>wrapper.findAll('[role="tab"]').length===3); const tabs=wrapper.findAll('[role="tab"]'); await tabs[0].trigger('keydown',{key:'ArrowRight'}); await flushPromises(); expect(document.activeElement).to.equal(tabs[1].element); expect(tabs[1].attributes('aria-controls')).to.equal('archive-panel-jobs'); wrapper.unmount()
})

it('renders WAITING_ASSIGNEE only with a real current appointment snapshot', async function () { this.timeout(10000)
  const Panel=loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenancePanel.vue'); const fixture=panelFixture(); const normal=fixture.fetch; globalThis.fetch=async(url,options={})=>{const path=String(url).split('?')[0];if(path.endsWith('/jobs/job-1')&&(options.method||'GET')==='GET')return admin({...fixture.job,state:'WAITING_ASSIGNEE',sourceId:'source-fixed',workId:'work-1',appointmentId:'appt-old'});return normal(url,options)}; const wrapper=mount(Panel,{attachTo:document.body,props:{gateway:mountedGateway()}}); await waitFor(()=>wrapper.findAll('select').some(item=>item.findAll('option').some(option=>option.element.value==='job-1'))); const select=wrapper.findAll('select').find(item=>item.findAll('option').some(option=>option.element.value==='job-1')); await select.setValue('job-1');await select.trigger('change');await waitFor(()=>wrapper.text().includes('WAITING_ASSIGNEE'));expect(wrapper.text()).to.include('appt-old @ 2');expect(wrapper.text()).to.include('来源已冻结：source-fixed').and.include('目标作品已冻结：work-1'); const form=wrapper.findAll('form').find(item=>item.text().includes('补全等待输入')); expect(form.text()).not.to.include('作品唯一 key'); await form.trigger('submit'); await waitFor(()=>fixture.calls.some(call=>call.path.endsWith('/resolve-input'))); const call=fixture.calls.find(call=>call.path.endsWith('/resolve-input')); expect(call.body).to.include({sourceId:'source-fixed',workId:null}); expect(call.body.newWork).to.equal(null); wrapper.unmount()
})


it('fails closed for mutations and every direct protected loader without accepting late state', async function () { this.timeout(20000)
  const Panel=loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenancePanel.vue')
  const mountDenied = async (kind) => {
    const fixture=panelFixture({capabilities:()=>({allowedActions:['appoint','job.read','job.manage','draft.write','validate','publish','edition.withdraw']})}); const normal=fixture.fetch
    const content={blocks:[{blockType:'CHAPTER',blockKey:'block-1',ordinal:1,title:'第一回',titleSourceRanges:[],paragraphs:[]}],excludedSourceRanges:[]}
    globalThis.fetch=async(url,options={})=>{const path=String(url).split('?')[0],method=options.method||'GET'
      if(kind==='mutation'&&path.endsWith('/revoke'))return json({msg:'forbidden'},403)
      if(path.endsWith('/jobs/job-1/draft')&&method==='GET')return admin({draftId:'draft-1',revision:'4',state:'EDITING',content})
      if(kind==='block'&&path.endsWith('/drafts/draft-1/blocks/block-1'))return json({msg:'forbidden'},403)
      if(kind==='history'&&path.endsWith('/works/work-1/editions'))return json({msg:'forbidden'},403)
      if((kind==='edition'||kind==='comparison')&&path.endsWith('/works/work-1/editions'))return admin({workId:'work-1',workRevision:'8',activeEditionId:'e1',editions:[{editionId:'e1',state:'PUBLISHED'},{editionId:'e2',state:'PUBLISHED'}]})
      if(kind==='edition'&&path.endsWith('/works/work-1/editions/e1'))return json({msg:'expired'},401)
      if(kind==='comparison'&&path.endsWith('/works/work-1/editions/e2'))return json({msg:'forbidden'},403)
      if(kind==='comparison'&&path.endsWith('/works/work-1/editions/e1'))return admin({publicationId:'p1',collectionId:'platform-classics',workId:'work-1',editionId:'e1',draftRevision:'4',manifestSha256:'1'.repeat(64),sourceSha256:'s'.repeat(64),state:'PUBLISHED',actorType:'HUMAN',actorId:'manager',authorizationRevision:'3',publishedAt:'2026-10-01T00:00:00Z',withdrawal:null,verification:{state:'PASSED',revision:'1',verificationDigest:'v'.repeat(64),findings:[],checkedAt:'2026-10-01T00:00:01Z'}})
      if(kind==='comparison'&&path.includes('/archive/v1/editions/e1/catalog'))return json({msg:'gone'},410)
      if(kind==='operation'&&path.endsWith('/operations/op-validation'))return json({msg:'forbidden'},403)
      return normal(url,options)}
    const wrapper=mount(Panel,{attachTo:document.body,props:{gateway:mountedGateway()}}); await waitFor(()=>!wrapper.text().includes('正在核对当前授权'))
    if(kind==='mutation') await button(wrapper,'撤任当前 Agent').trigger('click')
    if(kind==='block'||kind==='operation'){const jobs=wrapper.findAll('select').find(item=>item.findAll('option').some(option=>option.element.value==='job-1'));await jobs.setValue('job-1');await jobs.trigger('change');await waitFor(()=>wrapper.text().includes('草稿版本 4'));if(kind==='block'){const blocks=wrapper.findAll('select').find(item=>item.findAll('option').some(option=>option.element.value==='block-1'));await blocks.setValue('block-1');await blocks.trigger('change')}else await button(wrapper,'校验当前草稿').trigger('click')}
    if(kind==='history'||kind==='edition'||kind==='comparison'){const works=wrapper.findAll('select').find(item=>item.findAll('option').some(option=>option.element.value==='work-1'));await works.setValue('work-1');await works.trigger('change');if(kind!=='history'){await waitFor(()=>button(wrapper,'e1'));await button(wrapper,'e1').trigger('click');if(kind==='comparison'){await waitFor(()=>wrapper.text().includes('比较版本'));const compare=wrapper.findAll('select').find(item=>item.findAll('option').some(option=>option.element.value==='e2'));await compare.setValue('e2');await compare.trigger('change')}}}
    await waitFor(()=>wrapper.text().includes('当前身份认证已失效'),`no fail closed for ${kind}`); expect(wrapper.text()).to.include('当前身份没有典籍维护权限'); expect(wrapper.text()).not.to.include('草稿版本 4').and.not.to.include('绑定 binding-7'); wrapper.unmount()
  }
  for(const kind of ['mutation','block','history','edition','comparison','operation']) await mountDenied(kind)
})

it('fences same-work edition races and binds withdrawal to the visible selected edition', async function () { this.timeout(10000)
  const Panel=loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenancePanel.vue'); const fixture=panelFixture({capabilities:()=>({allowedActions:['edition.withdraw']})}); const normal=fixture.fetch; const e1=deferred(),e2=deferred()
  globalThis.fetch=async(url,options={})=>{const path=String(url).split('?')[0],method=options.method||'GET'; if(path.endsWith('/works/work-1/editions')&&method==='GET')return admin({workId:'work-1',workRevision:'8',activeEditionId:'e2',editions:[{editionId:'e1',state:'PUBLISHED'},{editionId:'e2',state:'PUBLISHED'}]}); if(path.endsWith('/works/work-1/editions/e1')&&method==='GET')return e1.promise; if(path.endsWith('/works/work-1/editions/e2')&&method==='GET')return e2.promise; if(path.includes('/archive/v1/editions/'))return json({msg:'gone'},410); return normal(url,options)}
  const version=id=>({publicationId:`p-${id}`,collectionId:'platform-classics',workId:'work-1',editionId:id,draftRevision:'4',manifestSha256:id.repeat(64).slice(0,64),sourceSha256:'s'.repeat(64),state:'PUBLISHED',actorType:'HUMAN',actorId:'manager',authorizationRevision:'3',publishedAt:'2026-10-01T00:00:00Z',withdrawal:null,verification:{state:'PASSED',revision:'1',verificationDigest:'v'.repeat(64),findings:[],checkedAt:'2026-10-01T00:00:01Z'}})
  const wrapper=mount(Panel,{attachTo:document.body,props:{gateway:mountedGateway()}}); await waitFor(()=>wrapper.findAll('select').some(item=>item.findAll('option').some(option=>option.element.value==='work-1'))); const work=wrapper.findAll('select').find(item=>item.findAll('option').some(option=>option.element.value==='work-1'));await work.setValue('work-1');await work.trigger('change');await waitFor(()=>button(wrapper,'e1'));await button(wrapper,'e1').trigger('click');await button(wrapper,'e2').trigger('click');e2.resolve(admin(version('e2')));await waitFor(()=>wrapper.text().includes('版本 e2'));e1.resolve(admin(version('e1')));await flushPromises();expect(wrapper.text()).to.include('版本 e2').and.not.include('版本 e1发布');const reason=wrapper.findAll('label').find(item=>item.text().includes('下架原因')).find('input');await reason.setValue('freeze target');await wrapper.findAll('form').find(item=>item.text().includes('显式下架此版本')).trigger('submit');await waitFor(()=>fixture.calls.some(call=>call.path.endsWith('/editions/e2/withdraw')));const call=fixture.calls.find(item=>item.path.endsWith('/editions/e2/withdraw'));expect(call.headers['If-Match']).to.equal('"v8"');expect(fixture.calls.some(item=>item.path.endsWith('/editions/e1/withdraw'))).to.equal(false);wrapper.unmount()
})

it('fences work A-B-A history and comparison reverse completions', async function () { this.timeout(10000)
  const Panel=loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenancePanel.vue'); const fixture=panelFixture({capabilities:()=>({allowedActions:['edition.withdraw']})}); const normal=fixture.fetch; const aOld=deferred(),b=deferred(),aNew=deferred();let aReads=0
  globalThis.fetch=async(url,options={})=>{const path=String(url).split('?')[0],method=options.method||'GET';if(path.endsWith('/collections/platform-classics/works'))return admin({items:[{workId:'work-a',title:'A',activeEditionId:'e1'},{workId:'work-b',title:'B',activeEditionId:'b1'}]});if(path.endsWith('/works/work-a/editions')&&method==='GET')return (++aReads===1?aOld:aNew).promise;if(path.endsWith('/works/work-b/editions')&&method==='GET')return b.promise;return normal(url,options)}
  const wrapper=mount(Panel,{attachTo:document.body,props:{gateway:mountedGateway()}});await waitFor(()=>wrapper.findAll('select').some(item=>item.findAll('option').some(option=>option.element.value==='work-a')),'work A missing');const works=wrapper.findAll('select').find(item=>item.findAll('option').some(option=>option.element.value==='work-a'));await works.setValue('work-a');await works.setValue('work-b');await works.setValue('work-a');aNew.resolve(admin({workId:'work-a',workRevision:'9',activeEditionId:'e1-new',editions:[]}));await waitFor(()=>wrapper.text().includes('e1-new'),'latest A history missing');b.resolve(admin({workId:'work-b',workRevision:'4',activeEditionId:'b1',editions:[]}));aOld.resolve(admin({workId:'work-a',workRevision:'1',activeEditionId:'e1-old',editions:[]}));await flushPromises();expect(wrapper.text()).to.include('e1-new').and.not.include('e1-old');wrapper.unmount()

  const comparisonFixture=panelFixture({capabilities:()=>({allowedActions:['edition.withdraw']})}); const fallback=comparisonFixture.fetch; const c2=deferred(),c3=deferred()
  const version=id=>({publicationId:`p-${id}`,collectionId:'platform-classics',workId:'work-a',editionId:id,draftRevision:'4',manifestSha256:id==='e1'?'1'.repeat(64):id==='e2'?'2'.repeat(64):'3'.repeat(64),sourceSha256:'s'.repeat(64),state:'PUBLISHED',actorType:'HUMAN',actorId:'manager',authorizationRevision:'3',publishedAt:'2026-10-01T00:00:00Z',withdrawal:null,verification:{state:'PASSED',revision:'1',verificationDigest:'v'.repeat(64),findings:[],checkedAt:'2026-10-01T00:00:01Z'}})
  const summary=id=>({blockType:'CHAPTER',blockId:`${id}-c1`,number:1,title:`${id} title`,paragraphCount:1,utf8ByteLength:6,etag:'e'.repeat(64)});const catalog=id=>({representationSchemaVersion:1,workId:'work-a',title:'A',activeEdition:{editionId:id,manifestSha256:version(id).manifestSha256,sourceSha256:'s'.repeat(64),prefaceParagraphCount:0,chapterParagraphCount:1,readerParagraphCount:1,readerUtf8ByteLength:6,preface:null,chapters:[summary(id)]}});const block=id=>({representationSchemaVersion:1,editionId:id,manifestSha256:version(id).manifestSha256,...summary(id),paragraphs:[{paragraphId:`${id}-p1`,ordinal:1,text:`${id}正文`,utf8ByteLength:6,sha256:id==='e1'?'a'.repeat(64):id==='e2'?'b'.repeat(64):'c'.repeat(64)}]})
  globalThis.fetch=async(url,options={})=>{const path=String(url).split('?')[0],method=options.method||'GET';if(path.endsWith('/collections/platform-classics/works'))return admin({items:[{workId:'work-a',title:'A',activeEditionId:'e1'}]});if(path.endsWith('/works/work-a/editions')&&method==='GET')return admin({workId:'work-a',workRevision:'10',activeEditionId:'e1',editions:[version('e1'),version('e2'),version('e3')]});if(path.endsWith('/works/work-a/editions/e1'))return admin(version('e1'));if(path.endsWith('/works/work-a/editions/e2'))return c2.promise;if(path.endsWith('/works/work-a/editions/e3'))return c3.promise;const catalogMatch=path.match(/\/archive\/v1\/editions\/(e1|e2|e3)\/catalog$/);if(catalogMatch)return admin(catalog(catalogMatch[1]));const blockMatch=path.match(/\/archive\/v1\/editions\/(e1|e2|e3)\/chapters\/(e1|e2|e3)-c1$/);if(blockMatch)return admin(block(blockMatch[1]));return fallback(url,options)}
  const comparison=mount(Panel,{attachTo:document.body,props:{gateway:mountedGateway()}});await waitFor(()=>comparison.findAll('select').some(item=>item.findAll('option').some(option=>option.element.value==='work-a')));const workSelect=comparison.findAll('select').find(item=>item.findAll('option').some(option=>option.element.value==='work-a'));await workSelect.setValue('work-a');await waitFor(()=>button(comparison,'e1'));await button(comparison,'e1').trigger('click');await waitFor(()=>comparison.text().includes('比较版本'));const compare=comparison.findAll('select').find(item=>item.findAll('option').some(option=>option.element.value==='e3'));await compare.setValue('e2');await compare.setValue('e3');c3.resolve(admin(version('e3')));await waitFor(()=>comparison.text().includes('e1 ↔ e3'),'latest comparison missing');c2.resolve(admin(version('e2')));await flushPromises();expect(comparison.text()).to.include('e1 ↔ e3').and.include('e1正文').and.include('e3正文').and.not.include('e1 ↔ e2');comparison.unmount()
})


it('retains validate 202 key/body until authoritative COMMITTED validation is consumed', async function () { this.timeout(10000)
  const Panel=loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenancePanel.vue'); const fixture=panelFixture(); const normal=fixture.fetch; let operationState='PENDING'; const validateKeys=[]
  globalThis.fetch=async(url,options={})=>{const path=String(url).split('?')[0];if(path.endsWith('/drafts/draft-1/validate')){validateKeys.push(options.headers?.['Idempotency-Key']);return admin({operationId:'op-validation',state:'PENDING'})}if(path.endsWith('/operations/op-validation'))return admin({operationId:'op-validation',state:operationState,result:operationState==='COMMITTED'?{draftId:'draft-1',draftRevision:'4',outcome:'PASSED'}:null});return normal(url,options)}
  const gateway=mountedGateway();const wrapper=mount(Panel,{attachTo:document.body,props:{gateway}});await waitFor(()=>wrapper.findAll('select').some(item=>item.findAll('option').some(option=>option.element.value==='job-1')));const jobs=wrapper.findAll('select').find(item=>item.findAll('option').some(option=>option.element.value==='job-1'));await jobs.setValue('job-1');await waitFor(()=>button(wrapper,'校验当前草稿'));await button(wrapper,'校验当前草稿').trigger('click');await waitFor(()=>validateKeys.length===1);const retained=gateway.retainedIntent('draft-validate:draft-1');expect(retained).not.to.equal(null);expect(retained.revision).to.equal('4');operationState='COMMITTED';await button(wrapper,'校验当前草稿').trigger('click');await waitFor(()=>validateKeys.length===2);expect(validateKeys[1]).to.equal(validateKeys[0]);await waitFor(()=>gateway.retainedIntent('draft-validate:draft-1')===null);expect(wrapper.text()).to.include('校验 PASSED');wrapper.unmount()
})

it('never offers reading for WITHDRAWN plus PASSED or PUBLISHED plus FAILED', async function () { this.timeout(10000)
  const Panel=loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenancePanel.vue');const fixture=panelFixture({capabilities:()=>({allowedActions:['edition.withdraw']})});const normal=fixture.fetch
  const version=(id,state,verificationState)=>({publicationId:`p-${id}`,collectionId:'platform-classics',workId:'work-1',editionId:id,draftRevision:'4',manifestSha256:'1'.repeat(64),sourceSha256:'s'.repeat(64),state,actorType:'HUMAN',actorId:'manager',authorizationRevision:'3',publishedAt:'2026-10-01T00:00:00Z',withdrawal:state==='WITHDRAWN'?{withdrawalId:'w1',editionId:id,reason:'obsolete',actorType:'HUMAN',actorId:'manager',authorizationRevision:'3',withdrawnAt:'2026-10-01T01:00:00Z',requestedReplacementActiveEditionId:null,resultingActiveEditionId:null,resultingWorkRevision:'9',operationKey:'k',outboxState:'PENDING'}:null,verification:{state:verificationState,revision:'2',verificationDigest:'v'.repeat(64),findings:verificationState==='FAILED'?['readback']:[],checkedAt:'2026-10-01T00:00:01Z'}})
  globalThis.fetch=async(url,options={})=>{const path=String(url).split('?')[0],method=options.method||'GET';if(path.endsWith('/works/work-1/editions')&&method==='GET')return admin({workId:'work-1',workRevision:'9',activeEditionId:null,editions:[version('withdrawn','WITHDRAWN','PASSED'),version('failed','PUBLISHED','FAILED')]});if(path.endsWith('/works/work-1/editions/withdrawn'))return admin(version('withdrawn','WITHDRAWN','PASSED'));if(path.endsWith('/works/work-1/editions/failed'))return admin(version('failed','PUBLISHED','FAILED'));if(path.includes('/archive/v1/editions/'))return json({msg:'gone'},410);return normal(url,options)}
  const wrapper=mount(Panel,{attachTo:document.body,props:{gateway:mountedGateway()}});await waitFor(()=>wrapper.findAll('select').some(item=>item.findAll('option').some(option=>option.element.value==='work-1')));const work=wrapper.findAll('select').find(item=>item.findAll('option').some(option=>option.element.value==='work-1'));await work.setValue('work-1');await waitFor(()=>button(wrapper,'withdrawn'));await button(wrapper,'withdrawn').trigger('click');await waitFor(()=>wrapper.text().includes('版本 withdrawn'));expect(button(wrapper,'阅读已核验版本')).to.equal(undefined);await button(wrapper,'failed').trigger('click');await waitFor(()=>wrapper.text().includes('版本 failed'));expect(wrapper.text()).to.include('阅读核验异常');expect(button(wrapper,'阅读已核验版本')).to.equal(undefined);wrapper.unmount()
})

it('rejects a late direct-loader response after a capability refresh fails closed', async function () { this.timeout(10000)
  const Panel=loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenancePanel.vue');const late=deferred();let capabilityReads=0;const fixture=panelFixture({capabilities:()=>({allowedActions:['edition.withdraw']})});const normal=fixture.fetch
  globalThis.fetch=async(url,options={})=>{const path=String(url).split('?')[0];if(path.endsWith('/capabilities')){capabilityReads+=1;return capabilityReads===1?admin({allowedActions:['edition.withdraw']}):json({msg:'forbidden'},403)}if(path.endsWith('/works/work-1/editions'))return late.promise;return normal(url,options)}
  const wrapper=mount(Panel,{attachTo:document.body,props:{gateway:mountedGateway()}});await waitFor(()=>wrapper.findAll('select').some(item=>item.findAll('option').some(option=>option.element.value==='work-1')));const work=wrapper.findAll('select').find(item=>item.findAll('option').some(option=>option.element.value==='work-1'));await work.setValue('work-1');await button(wrapper,'刷新状态').trigger('click');await waitFor(()=>wrapper.text().includes('当前身份认证已失效'));late.resolve(admin({workId:'work-1',workRevision:'99',activeEditionId:'late-secret',editions:[]}));await flushPromises();expect(wrapper.text()).not.to.include('late-secret');expect(wrapper.text()).to.include('当前身份没有典籍维护权限');wrapper.unmount()
})

it('keeps an ambiguous publication POST key non-dismissible and blocks a second POST', async function () { this.timeout(10000)
  const Panel=loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenancePanel.vue'),fixture=panelFixture(),normal=fixture.fetch
  globalThis.fetch=async(url,options={})=>{const path=String(url).split('?')[0],method=options.method||'GET';if(path.endsWith('/drafts/draft-1/publish')&&method==='POST'){await normal(url,options);return json({msg:'lost response'},503)}return normal(url,options)}
  const gateway=mountedGateway(),wrapper=mount(Panel,{attachTo:document.body,props:{gateway}});await waitFor(()=>wrapper.findAll('select').some(item=>item.findAll('option').some(option=>option.element.value==='job-1')));const select=wrapper.findAll('select').find(item=>item.findAll('option').some(option=>option.element.value==='job-1'));await select.setValue('job-1');await select.trigger('change');await waitFor(()=>button(wrapper,'由管理者明确发布')?.attributes('disabled')===undefined);await button(wrapper,'由管理者明确发布').trigger('click');await waitFor(()=>wrapper.text().includes('待核对的未知请求'))
  const posts=()=>fixture.calls.filter(call=>call.path.endsWith('/drafts/draft-1/publish')&&call.method==='POST');expect(posts()).to.have.length(1);expect(gateway.retainedIntent('draft-publish:draft-1')?.key).to.equal(posts()[0].headers['Idempotency-Key']);expect(button(wrapper,'由管理者明确发布').attributes('disabled')).to.equal('');expect(button(wrapper,'明确确认旧请求可能已受理')).to.equal(undefined);await button(wrapper,'由管理者明确发布').trigger('click');await flushPromises();expect(posts()).to.have.length(1);wrapper.unmount()
})

it('retains accepted COMMITTED publication through missing status and refreshes immutable PENDING to current PASSED without another POST', async function () { this.timeout(15000)
  const Panel=loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenancePanel.vue'), fixture=panelFixture(), normal=fixture.fetch
  let phase='lost', directReads=0
  globalThis.fetch=async(url,options={})=>{
    const path=String(url).split('?')[0], method=options.method||'GET'
    if(path.endsWith('/drafts/draft-1/publish')&&method==='POST'){await normal(url,options);return admin({operationId:'op-publish',jobId:'job-1',state:'COMMITTED'})}
    if(path.endsWith('/operations/op-publish')){
      directReads+=1
      if(phase==='lost')return directReads===1?json({msg:'not visible'},404):json({msg:'temporary'},503)
      const key=fixture.calls.find(call=>call.path.endsWith('/drafts/draft-1/publish')&&call.method==='POST')?.headers['Idempotency-Key']
      return admin(phase==='malformed'?publicationAdminOperation({key,verificationState:'PASSED',result:publicationResult({editionId:'fake-edition',readbackState:'PASSED'})}):publicationAdminOperation({key,verificationState:phase==='passed'?'PASSED':'PENDING'}))
    }
    if(path.endsWith('/operations/by-key'))return phase==='lost'?json({msg:'not visible'},404):normal(url,options)
    return normal(url,options)
  }
  const gateway=mountedGateway(), wrapper=mount(Panel,{attachTo:document.body,props:{gateway}})
  await waitFor(()=>wrapper.findAll('select').some(item=>item.findAll('option').some(option=>option.element.value==='job-1')))
  const select=wrapper.findAll('select').find(item=>item.findAll('option').some(option=>option.element.value==='job-1'));await select.setValue('job-1');await select.trigger('change');await waitFor(()=>button(wrapper,'由管理者明确发布')?.attributes('disabled')===undefined)
  await button(wrapper,'由管理者明确发布').trigger('click');await waitFor(()=>wrapper.text().includes('发布操作 COMMITTED'))
  const retained=gateway.retainedIntent('draft-publish:draft-1'), posts=()=>fixture.calls.filter(call=>call.path.endsWith('/drafts/draft-1/publish')&&call.method==='POST')
  expect(retained).to.include({operationId:'op-publish',acceptedState:'COMMITTED',acceptedJobId:'job-1'});expect(posts()).to.have.length(1);expect(button(wrapper,'由管理者明确发布').attributes('disabled')).to.equal('');expect(wrapper.text()).to.include('尚未取得完整权威回执')
  phase='pending';await button(wrapper,'刷新原发布操作/当前核验').trigger('click');await waitFor(()=>wrapper.text().includes('不可变发布结果 PUBLISHED / 初始核验 PENDING'));expect(gateway.retainedIntent('draft-publish:draft-1')).to.equal(null);expect(button(wrapper,'由管理者明确发布').attributes('disabled')).to.equal('');expect(posts()).to.have.length(1)
  phase='passed';await button(wrapper,'刷新原发布操作/当前核验').trigger('click');await waitFor(()=>wrapper.text().includes('阅读核验已通过'));expect(button(wrapper,'阅读已核验版本')).not.to.equal(undefined);expect(posts()).to.have.length(1);expect(posts()[0].headers['Idempotency-Key']).to.equal(retained.key)
  phase='malformed';await button(wrapper,'刷新原发布操作/当前核验').trigger('click');await flushPromises();expect(wrapper.text()).to.include('阅读核验已通过').and.not.include('fake-edition');await button(wrapper,'阅读已核验版本').trigger('click');expect(wrapper.emitted('open-edition').at(-1)[0]).to.deep.equal({workId:'work-1',editionId:'e1'});expect(posts()).to.have.length(1)
  wrapper.unmount()
})

it('rejects malformed publication DTOs without consuming the original key and recovers by that key', async function () { this.timeout(60000)
  const variants=[
    ['immutable readback PASSED',operation=>{operation.result.readbackState='PASSED'}],
    ['immutable readback FAILED',operation=>{operation.result.readbackState='FAILED'}],
    ['missing immutable verification',operation=>{delete operation.result.verification}],
    ['state-only current verification',operation=>{operation.verification={state:'PASSED'}}],
    ['non-canonical current revision',operation=>{operation.verification.revision='01'}],
    ['missing current findings',operation=>{delete operation.verification.findings}],
    ['PASSED without digest',operation=>{operation.verification.verificationDigest=null}],
    ['FAILED without checkedAt',operation=>{operation.verification={state:'FAILED',revision:'2',verificationDigest:'d'.repeat(64),findings:['readback'],checkedAt:null}}]
  ]
  const Panel=loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenancePanel.vue')
  for(const [label,mutate] of variants){
    const fixture=panelFixture(), normal=fixture.fetch; let phase='malformed'; const byKeyKeys=[]
    globalThis.fetch=async(url,options={})=>{
      const path=String(url).split('?')[0],method=options.method||'GET'
      if(path.endsWith('/drafts/draft-1/publish')&&method==='POST'){await normal(url,options);return admin({operationId:'op-publish',jobId:'job-1',state:'COMMITTED'})}
      const key=fixture.calls.find(call=>call.path.endsWith('/drafts/draft-1/publish')&&call.method==='POST')?.headers['Idempotency-Key']
      if(path.endsWith('/operations/op-publish')){
        if(phase==='malformed'){
          const operation=JSON.parse(JSON.stringify(publicationAdminOperation({key,verificationState:label.startsWith('FAILED')?'FAILED':'PASSED'})))
          mutate(operation)
          return admin(operation)
        }
        return json({msg:'not visible by id'},404)
      }
      if(path.endsWith('/operations/by-key')){
        byKeyKeys.push(options.headers?.['Idempotency-Key'])
        return phase==='valid'?admin(publicationAdminOperation({key,verificationState:'PASSED'})):json({msg:'not visible by key'},404)
      }
      return normal(url,options)
    }
    const gateway=mountedGateway(),wrapper=mount(Panel,{attachTo:document.body,props:{gateway}})
    await waitFor(()=>wrapper.findAll('select').some(item=>item.findAll('option').some(option=>option.element.value==='job-1')),`${label}: job missing`)
    const select=wrapper.findAll('select').find(item=>item.findAll('option').some(option=>option.element.value==='job-1'));await select.setValue('job-1');await select.trigger('change')
    await waitFor(()=>button(wrapper,'由管理者明确发布')?.attributes('disabled')===undefined,`${label}: publish unavailable`)
    await button(wrapper,'由管理者明确发布').trigger('click');await waitFor(()=>wrapper.text().includes('尚未取得完整权威回执'),`${label}: malformed receipt rendered`)
    const posts=()=>fixture.calls.filter(call=>call.path.endsWith('/drafts/draft-1/publish')&&call.method==='POST'), retained=gateway.retainedIntent('draft-publish:draft-1')
    expect(posts(),label).to.have.length(1);expect(retained?.key,label).to.equal(posts()[0].headers['Idempotency-Key']);expect(button(wrapper,'由管理者明确发布').attributes('disabled'),label).to.equal('');expect(button(wrapper,'阅读已核验版本'),label).to.equal(undefined)
    phase='valid';await button(wrapper,'刷新原发布操作/当前核验').trigger('click');await waitFor(()=>wrapper.text().includes('阅读核验已通过'),`${label}: valid recovery missing`)
    expect(byKeyKeys.at(-1),label).to.equal(retained.key);expect(gateway.retainedIntent('draft-publish:draft-1'),label).to.equal(null);expect(posts(),label).to.have.length(1);expect(new Set(posts().map(call=>call.headers['Idempotency-Key'])).size,label).to.equal(1);expect(button(wrapper,'阅读已核验版本'),label).not.to.equal(undefined)
    wrapper.unmount();document.body.innerHTML=''
  }
})

it('fences delayed publication POST, operation GET and by-key recovery across job A-B-A selection', async function () { this.timeout(20000)
  const Panel=loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenancePanel.vue'), aPost=deferred(), aByKey=deferred(), calls=[]
  const jobs={
    'job-a':{jobId:'job-a',title:'A',state:'DRAFTING',revision:'7',operation:'ADD_WORK',publicationMode:'MANUAL',draftId:'draft-a'},
    'job-b':{jobId:'job-b',title:'B',state:'DRAFTING',revision:'8',operation:'ADD_WORK',publicationMode:'MANUAL',draftId:'draft-b'}
  }
  const keys={}, directReads={a:0,b:0}; let aDirectReady=false
  globalThis.fetch=async(url,options={})=>{
    const path=String(url).split('?')[0], method=options.method||'GET', body=options.body?JSON.parse(options.body):null
    calls.push({path,method,body,headers:options.headers})
    if(options.headers?.Authorization!=='Bearer fixture-token')return json({msg:'missing auth'},401)
    if(path.endsWith('/capabilities'))return admin({allowedActions:['job.read','job.manage','draft.write','validate','publish']})
    if(path.endsWith('/collections/platform-classics/jobs'))return admin(Object.values(jobs))
    if(path.endsWith('/collections/platform-classics/works'))return admin({items:[]})
    for(const suffix of ['a','b']){
      const jobId=`job-${suffix}`,draftId=`draft-${suffix}`
      if(path.endsWith(`/jobs/${jobId}`))return admin(jobs[jobId])
      if(path.endsWith(`/jobs/${jobId}/events`))return admin([])
      if(path.endsWith(`/jobs/${jobId}/recovery-context`))return admin({jobId,jobRevision:jobs[jobId].revision,previousAppointment:null,candidates:[]})
      if(path.endsWith(`/jobs/${jobId}/draft`))return admin({draftId,jobId,revision:'4',state:'EDITING',content:{blocks:[],excludedSourceRanges:[]}})
      if(path.endsWith(`/drafts/${draftId}/validation`))return admin({validationId:`validation-${suffix}`,draftId,draftRevision:'4',outcome:'PASSED',findings:[]})
      if(path.endsWith(`/drafts/${draftId}/publish`)&&method==='POST'){
        keys[suffix]=options.headers['Idempotency-Key']
        return suffix==='a'?aPost.promise:admin({operationId:'op-b',jobId:'job-b',state:'COMMITTED'})
      }
    }
    if(path.endsWith('/operations/op-a')){directReads.a+=1;if(!aDirectReady)return json({msg:'not visible'},404);return admin(publicationAdminOperation({operationId:'op-a',key:keys.a,jobId:'job-a',draftId:'draft-a',verificationState:'PASSED',result:publicationResult({jobId:'job-a',editionId:'edition-a'})}))}
    if(path.endsWith('/operations/op-b')){directReads.b+=1;return admin(publicationAdminOperation({operationId:'op-b',key:keys.b,jobId:'job-b',draftId:'draft-b',verificationState:'FAILED',result:publicationResult({jobId:'job-b',editionId:'edition-b'})}))}
    if(path.endsWith('/operations/by-key'))return options.headers['Idempotency-Key']===keys.a?aByKey.promise:json({msg:'unknown'},404)
    return admin({})
  }
  const wrapper=mount(Panel,{attachTo:document.body,props:{gateway:mountedGateway()}});await waitFor(()=>wrapper.findAll('select').some(item=>item.findAll('option').some(option=>option.element.value==='job-a')))
  const select=wrapper.findAll('select').find(item=>item.findAll('option').some(option=>option.element.value==='job-a'))
  await select.setValue('job-a');await select.trigger('change');await waitFor(()=>wrapper.text().includes('作业 job-a'));button(wrapper,'由管理者明确发布').trigger('click');await waitFor(()=>calls.some(call=>call.path.endsWith('/drafts/draft-a/publish')&&call.method==='POST'))
  await select.setValue('job-b');await select.trigger('change');await waitFor(()=>wrapper.text().includes('作业 job-b'));expect(button(wrapper,'由管理者明确发布').attributes('disabled')).to.equal(undefined)
  await button(wrapper,'由管理者明确发布').trigger('click');await waitFor(()=>wrapper.text().includes('发布已提交，阅读核验异常'));expect(calls.filter(call=>call.path.endsWith('/drafts/draft-b/publish')&&call.method==='POST')).to.have.length(1)
  await select.setValue('job-a');await select.trigger('change');await waitFor(()=>wrapper.text().includes('作业 job-a'));aPost.resolve(admin({operationId:'op-a',jobId:'job-a',state:'COMMITTED'}));await flushPromises();expect(wrapper.text()).not.to.include('阅读核验已通过')
  button(wrapper,'刷新原发布操作/当前核验').trigger('click');await waitFor(()=>calls.some(call=>call.path.endsWith('/operations/by-key')&&call.headers['Idempotency-Key']===keys.a))
  await select.setValue('job-b');await select.trigger('change');await waitFor(()=>wrapper.text().includes('作业 job-b'));aByKey.resolve(admin(publicationAdminOperation({operationId:'op-a',key:keys.a,jobId:'job-a',draftId:'draft-a',verificationState:'PASSED',result:publicationResult({jobId:'job-a',editionId:'edition-a'})})));await flushPromises();expect(wrapper.text()).to.include('发布已提交，阅读核验异常').and.not.include('edition-a');expect(button(wrapper,'阅读已核验版本')).to.equal(undefined)
  await select.setValue('job-a');await select.trigger('change');await waitFor(()=>wrapper.text().includes('作业 job-a'));aDirectReady=true;await button(wrapper,'刷新原发布操作/当前核验').trigger('click');await waitFor(()=>wrapper.text().includes('阅读核验已通过'));expect(wrapper.text()).not.to.include('阅读核验异常');expect(button(wrapper,'阅读已核验版本')).not.to.equal(undefined)
  expect(calls.filter(call=>call.path.endsWith('/drafts/draft-a/publish')&&call.method==='POST')).to.have.length(1);expect(calls.filter(call=>call.path.endsWith('/drafts/draft-b/publish')&&call.method==='POST')).to.have.length(1);expect(keys.a).not.to.equal(keys.b);wrapper.unmount()
})

it('does not re-enable publish after authoritative FAILED readback', async function () { this.timeout(10000)
  const Panel=loadArchiveSfc('../src/components/juyiting/archive/ArchiveMaintenancePanel.vue');const fixture=panelFixture();const normal=fixture.fetch;globalThis.fetch=async(url,options={})=>String(url).split('?')[0].endsWith('/operations/op-publish')?admin(publicationAdminOperation({key:fixture.calls.find(call=>call.path.endsWith('/drafts/draft-1/publish')&&call.method==='POST')?.headers['Idempotency-Key'],verificationState:'FAILED'})):normal(url,options);const wrapper=mount(Panel,{attachTo:document.body,props:{gateway:mountedGateway()}});await waitFor(()=>wrapper.findAll('select').some(item=>item.findAll('option').some(option=>option.element.value==='job-1')));const select=wrapper.findAll('select').find(item=>item.findAll('option').some(option=>option.element.value==='job-1'));await select.setValue('job-1');await select.trigger('change');await waitFor(()=>button(wrapper,'由管理者明确发布'));await button(wrapper,'由管理者明确发布').trigger('click');await waitFor(()=>wrapper.text().includes('发布已提交，阅读核验异常'));const postCount=()=>fixture.calls.filter(call=>call.path.endsWith('/drafts/draft-1/publish')&&call.method==='POST').length;expect(postCount()).to.equal(1);expect(button(wrapper,'由管理者明确发布').attributes('disabled')).to.equal('');expect(wrapper.findAll('button').some(item=>item.text().includes('阅读已核验版本'))).to.equal(false);await button(wrapper,'刷新原发布操作/当前核验').trigger('click');await waitFor(()=>wrapper.text().includes('发布已提交，阅读核验异常'));expect(postCount()).to.equal(1);wrapper.unmount()
})
