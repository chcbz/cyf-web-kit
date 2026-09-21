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
const executionMock = () => {
  const receipt = Vue.ref({ executionId: 'exec_1', targetAgentId: 'agent_1', state: 'QUEUED', outputContentMimeType: 'image/png' })
  const pending = Vue.ref(true)
  const execution = {
    agents: Vue.ref([{ agentId: 'agent_1', name: '林冲', status: 'online' }]), rosterState: Vue.ref('ready'), rosterError: Vue.ref(''), selectedAgentId: Vue.ref('agent_1'), selectedAgent: Vue.ref({ agentId: 'agent_1', name: '林冲' }), selectedExecutionAgent: Vue.ref({ agentId: 'agent_1', name: '林冲' }), allowedMimeTypes: Vue.ref(['image/png']), inputMimeTypes: Vue.ref(['text/plain']), capabilityState: Vue.ref('ready'), capabilityError: Vue.ref(''), generationEnabled: Vue.ref(true), execution: Vue.ref({ executionId: 'exec_1', state: 'QUEUED' }), receipt, executionState: Vue.ref('ready'), pending, unresolvedIntent: Vue.ref(null), error: Vue.ref(''), completionNotice: Vue.ref(''), history: Vue.ref([{ executionId: 'exec_old', targetAgentId: 'agent_1', state: 'FAILED', outputContentMimeType: 'image/png', createdAt: 1 }]), historyState: Vue.ref('ready'), historyError: Vue.ref(''), historyNextCursor: Vue.ref(null),
    loadCapabilities: async () => ({ allowedMimeTypes: ['image/png'] }), loadAgents: async () => [], loadHistory: async () => [], recover: async () => [], selectAgent: () => true, create: async () => null, selectHistoryExecution: async () => null, refreshExecution: async () => null, revokeInputs: async () => null, dispose: () => {}
  }
  execution.prepareNewRequest = () => { receipt.value = null; pending.value = false; execution.execution.value = null; execution.executionState.value = 'idle'; return true }
  return execution
}

describe('personal workspace execution receipt presentation', () => {
  it('mounts the delivery receipt at submission location, shows terminal errors, and keeps file selection navigation working', async () => {
    const workspace = workspaceMock(); const execution = executionMock(); let executionOptions
    const component = new Function('Vue', 'deps', script)(Vue, {
      useApiStore: () => ({ authorizationGeneration: 1, oauthClientId: 'web-client' }), useGlobalStore: () => ({ user: { id: 'owner-a', tenantId: 'tenant-a' }, getUserId: 'owner-a', getOpenid: '' }),
      usePersonalWorkspace: () => workspace, usePersonalWorkspaceExecution: options => { executionOptions = options; return execution }, savePersonalWorkspaceBlob: () => {}
    })
    const wrapper = mount(component)
    assert.equal(executionOptions.identityScope.value, 'tenant-a\u0000web-client\u0000owner-a')
    execution.receipt.value = null; execution.historyState.value = 'loading'
    await Vue.nextTick()
    assert.match(wrapper.find('.box-footnote').text(), /最近执行：查询中/)
    execution.historyState.value = 'error'
    await Vue.nextTick()
    assert.match(wrapper.find('.box-footnote').text(), /最近执行：查询失败/)
    execution.historyState.value = 'empty'; execution.history.value = []
    await Vue.nextTick()
    assert.match(wrapper.find('.box-footnote').text(), /最近执行：暂无/)
    execution.receipt.value = { executionId: 'exec_1', targetAgentId: 'agent_1', state: 'QUEUED', outputContentMimeType: 'image/png' }; execution.historyState.value = 'ready'; execution.history.value = [{ executionId: 'exec_old', targetAgentId: 'agent_1', state: 'FAILED', outputContentMimeType: 'image/png', createdAt: 1 }]
    await Vue.nextTick()
    await wrapper.findAll('.box-actions button')[1].trigger('click')
    const delivery = wrapper.find('.delivery-modal')
    assert.equal(wrapper.classes().includes('is-progress-view'), true)
    assert.equal(delivery.element.children[1].classList.contains('delivery-receipt'), true)
    assert.match(delivery.text(), /交付进度/)
    assert.match(delivery.text(), /本次交付回执/)
    assert.match(delivery.text(), /已接受，等待结果/)
    assert.equal(delivery.find('.composer-steps').exists(), false)
    assert.equal(delivery.find('details.execution-history').attributes('open'), undefined)
    await delivery.find('summary').trigger('click')
    assert.equal(delivery.find('details.execution-history').element.open, true)
    assert.equal(delivery.find('.history-row').element.disabled, false)
    const queuedReceipt = execution.receipt.value
    execution.receipt.value = null; execution.executionState.value = 'unknown'; execution.unresolvedIntent.value = { idempotencyKey: 'pending-key' }
    await Vue.nextTick()
    assert.match(delivery.text(), /只查询原请求，不会再次提交/)
    assert.equal(delivery.find('.composer-steps').exists(), false)
    assert.equal(delivery.findAll('button').find(button => button.text().includes('另起一项新交付')).element.disabled, true)
    execution.receipt.value = queuedReceipt; execution.executionState.value = 'ready'; execution.unresolvedIntent.value = null
    execution.receipt.value = { ...execution.receipt.value, state: 'FAILED' }; execution.pending.value = false; execution.error.value = 'Agent 未能完成本次交付'
    await Vue.nextTick()
    assert.match(delivery.text(), /交付失败/)
    const newRequest = delivery.findAll('button').find(button => button.text().includes('另起一项新交付'))
    await newRequest.trigger('click')
    await Vue.nextTick()
    assert.match(delivery.text(), /直接生成交付件/)
    assert.equal(delivery.find('.composer-steps').exists(), true)
    assert.equal(wrapper.classes().includes('is-progress-view'), false)
    await wrapper.find('.delivery-modal .modal-heading .quiet-action').trigger('click')
    await wrapper.findAll('.box-actions button')[0].trigger('click')
    await wrapper.find('.file-row').trigger('click')
    await Vue.nextTick(); await Vue.nextTick()
    assert.equal(wrapper.find('.detail-modal').exists(), true)
    wrapper.unmount()
  })
  it('W04 embeds only file browsing, keeps the source list inert in detail, and consumes one local return', async () => {
    const workspace = workspaceMock()
    const execution = executionMock()
    let executionLoads = 0
    execution.loadAgents = execution.loadCapabilities = execution.recover = async () => { executionLoads += 1 }
    const component = new Function('Vue', 'deps', script)(Vue, {
      useApiStore: () => ({ authorizationGeneration: 1, oauthClientId: 'web-client' }),
      useGlobalStore: () => ({ user: { id: 'owner-a' } }),
      usePersonalWorkspace: () => workspace, usePersonalWorkspaceExecution: () => execution, savePersonalWorkspaceBlob: () => {}
    })
    const wrapper = mount(component, { attachTo: document.body, props: { embedded: true } })
    try {
      await Vue.nextTick()
      assert.equal(wrapper.find('.box-modal').exists(), false)
      assert.equal(wrapper.find('.delivery-modal').exists(), false)
      assert.equal(executionLoads, 0)
      const list = wrapper.find('.library-modal').element
      await wrapper.setProps({ detailAllowed: false })
      assert.equal(wrapper.find('.file-row').element.disabled, true)
      await wrapper.find('.file-row').trigger('click')
      assert.equal(workspace.detail.value, null)
      await wrapper.setProps({ detailAllowed: true })
      await wrapper.find('.file-row').trigger('click')
      await Vue.nextTick()
      assert.equal(wrapper.find('.detail-modal').exists(), true)
      assert.equal(list.getAttribute('inert'), '')
      assert.equal(list.getAttribute('aria-hidden'), 'true')
      assert.equal(wrapper.text().includes('办事笺'), false)
      assert.equal(wrapper.vm.canGoBack, true)
      assert.equal(wrapper.vm.back(), true)
      await Vue.nextTick()
      assert.equal(wrapper.find('.library-modal').element, list)
      assert.equal(list.hasAttribute('inert'), false)
      assert.equal(document.activeElement, wrapper.find('.file-row').element)
      assert.equal(wrapper.vm.back(), false)
    } finally {
      wrapper.unmount()
    }
  })

})
