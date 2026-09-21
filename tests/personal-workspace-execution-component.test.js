import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { describe, it } from 'mocha'
import * as Vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { mount } from '@vue/test-utils'

for (const name of ['Element', 'HTMLElement', 'SVGElement', 'Node']) { if (!globalThis[name] && globalThis.window?.[name]) Object.defineProperty(globalThis, name, { value: globalThis.window[name], configurable: true }) }

const source = readFileSync(new URL('../src/components/workspace/PersonalWorkspace.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source, { filename: 'PersonalWorkspace.vue' })
let script = compileScript(descriptor, { id: 'personal-workspace-execution-component', inlineTemplate: true }).content
script = script
  .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
  .replace(/^import\s+\{\s*useApiStore\s*\}\s+from\s+['"]@\/stores\/api['"];?\s*$/gm, 'var { useApiStore } = deps')
  .replace(/^import\s+\{\s*useGlobalStore\s*\}\s+from\s+['"]@\/stores\/global['"];?\s*$/gm, 'var { useGlobalStore } = deps')
  .replace(/^import\s+\{\s*savePersonalWorkspaceBlob,\s*usePersonalWorkspace\s*\}\s+from\s+['"]@\/composables\/usePersonalWorkspace['"];?\s*$/gm, 'var { savePersonalWorkspaceBlob, usePersonalWorkspace } = deps')
  .replace(/^import\s+\{\s*usePersonalWorkspaceExecution\s*\}\s+from\s+['"]@\/composables\/usePersonalWorkspaceExecution['"];?\s*$/gm, 'var { usePersonalWorkspaceExecution } = deps')
  .replace('export default', 'return')

const workspaceMock = () => {
  const detail = Vue.ref(null)
  const workspace = {
    items: Vue.ref([{ fileId: 'file_1', displayName: '案卷.txt', mediaFamily: 'TEXT', originKind: 'USER_UPLOAD', latestVersion: 1, state: 'ACTIVE' }]), loading: Vue.ref(false), nextCursor: Vue.ref(null), listState: Vue.ref('ready'), error: Vue.ref(''), lastOperation: Vue.ref(null), actionState: Vue.ref('idle'), preview: Vue.ref({ kind: 'none' }), detail,
    refresh: async () => true, loadMore: async () => false, revokePreview: () => {}, upload: async () => null, rename: async () => null, appendVersion: async () => null, previewVersion: async () => null, selectPreviewPart: () => false, download: async () => null, usage: async () => null, trash: async () => null, restore: async () => null, dispose: () => {}
  }
  workspace.select = async fileId => { const value = { file: { fileId, displayName: '案卷.txt', state: 'ACTIVE', latestVersion: 1 }, latestVersion: { version: 1 }, versions: [{ version: 1, originalFilename: '案卷.txt', byteLength: 1, createdAt: 1, contentMimeType: 'text/plain' }] }; detail.value = value; return value }
  return workspace
}
const executionMock = () => ({
  agents: Vue.ref([{ agentId: 'agent_1', name: '林冲', status: 'online' }]), rosterState: Vue.ref('ready'), rosterError: Vue.ref(''), selectedAgentId: Vue.ref('agent_1'), selectedAgent: Vue.ref({ agentId: 'agent_1', name: '林冲' }), selectedExecutionAgent: Vue.ref({ agentId: 'agent_1', name: '林冲' }), allowedMimeTypes: Vue.ref(['image/png']), inputMimeTypes: Vue.ref(['text/plain']), capabilityState: Vue.ref('ready'), capabilityError: Vue.ref(''), generationEnabled: Vue.ref(true), execution: Vue.ref({ executionId: 'exec_1', state: 'QUEUED' }), receipt: Vue.ref({ executionId: 'exec_1', targetAgentId: 'agent_1', state: 'QUEUED', outputContentMimeType: 'image/png' }), executionState: Vue.ref('ready'), pending: Vue.ref(true), error: Vue.ref(''), completionNotice: Vue.ref(''), history: Vue.ref([]), historyState: Vue.ref('empty'), historyError: Vue.ref(''), historyNextCursor: Vue.ref(null),
  loadCapabilities: async () => ({ allowedMimeTypes: ['image/png'] }), loadAgents: async () => [], loadHistory: async () => [], recover: async () => [], selectAgent: () => true, create: async () => null, prepareNewRequest: () => true, selectHistoryExecution: async () => null, refreshExecution: async () => null, revokeInputs: async () => null, dispose: () => {}
})

describe('personal workspace execution receipt presentation', () => {
  it('mounts the delivery receipt at submission location, shows terminal errors, and keeps file selection navigation working', async () => {
    const workspace = workspaceMock(); const execution = executionMock(); let executionOptions
    const component = new Function('Vue', 'deps', script)(Vue, {
      useApiStore: () => ({ authorizationGeneration: 1, oauthClientId: 'web-client' }), useGlobalStore: () => ({ user: { id: 'owner-a', tenantId: 'tenant-a' }, getUserId: 'owner-a', getOpenid: '' }),
      usePersonalWorkspace: () => workspace, usePersonalWorkspaceExecution: options => { executionOptions = options; return execution }, savePersonalWorkspaceBlob: () => {}
    })
    const wrapper = mount(component)
    assert.equal(executionOptions.identityScope.value, 'tenant-a\u0000web-client\u0000owner-a')
    await wrapper.findAll('.box-actions button')[1].trigger('click')
    assert.match(wrapper.find('.delivery-modal').text(), /本次交付回执/)
    assert.match(wrapper.find('.delivery-modal').text(), /已接受，等待结果/)
    assert.match(wrapper.find('.delivery-modal').text(), /服务端已接受请求，正在等待结果/)
    assert.equal(wrapper.findAll('.delivery-modal button').find(button => button.text() === '生成交付件').element.disabled, true)
    execution.receipt.value = { ...execution.receipt.value, state: 'FAILED' }; execution.error.value = 'Agent 未能完成本次交付'
    await Vue.nextTick()
    assert.match(wrapper.find('.delivery-modal').text(), /交付失败/)
    assert.match(wrapper.find('.delivery-modal').text(), /Agent 未能完成本次交付/)
    await wrapper.find('.delivery-modal .quiet-action').trigger('click')
    await wrapper.findAll('.box-actions button')[0].trigger('click')
    await wrapper.find('.file-row').trigger('click')
    await Vue.nextTick(); await Vue.nextTick()
    assert.equal(wrapper.find('.detail-modal').exists(), true)
    wrapper.unmount()
  })
})
