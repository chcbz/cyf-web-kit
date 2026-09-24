import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { mount, flushPromises } from '@vue/test-utils'
import { useFormalDeliveries } from '../src/composables/useFormalDeliveries.js'

const filename = new URL('../src/components/deliveries/FormalDeliveryList.vue', import.meta.url).pathname
const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
const script = compileScript(descriptor, { id: 'hall-formal-review-component', inlineTemplate: true }).content
  .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
  .replace(/^import\s+\{\s*useFormalDeliveries\s*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var { useFormalDeliveries } = deps')
  .replace('export default', 'return')
const FormalDeliveryList = new Function('Vue', 'deps', script)(Vue, { useFormalDeliveries })
const delivery = {
  taskId: 'task-1', workItemId: 'work-1', deliveryId: 'delivery-1', revision: 2, deliveryVersion: 0,
  state: 'submitted', runId: 'run-1', producerAgentId: 'agent-1', summary: '真实读取的正式成果',
  manifestArtifactId: 'manifest-1', manifestArtifactVersion: 1, submittedAt: 1, taskVersion: 3, workItemVersion: 4,
  items: [{ artifactId: 'artifact-1', artifactVersion: 2, contentHash: 'a'.repeat(64), purpose: '交付报告' }]
}

describe('W05 real formal-review component boundary', () => {
  // This suite must mount independently, not depend on another component test
  // having populated jsdom constructors on Node's global object first.
  const previousDomGlobals = new Map()
  before(() => {
    for (const name of ['Element', 'HTMLElement', 'SVGElement', 'Node']) {
      if (globalThis[name]) continue
      previousDomGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
      Object.defineProperty(globalThis, name, {
        value: globalThis.window[name], writable: true, configurable: true
      })
    }
  })
  after(() => {
    for (const [name, descriptor] of previousDomGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
    previousDomGlobals.clear()
  })
  it('locates only a fetched exact delivery, reports stale summary refs, and never writes on opening or identity changes', async () => {
    const requests = []
    let writes = 0
    const wrapper = mount(FormalDeliveryList, {
      props: {
        taskId: 'task-1', identityFingerprint: 'owner-a:client:1', focusDeliveryId: 'delivery-1',
        adapter: {
          list: async request => { requests.push(request); return requests.length === 1 ? [delivery] : [] },
          decide: async () => { writes += 1 }, createRework: async () => { writes += 1 }
        }
      }
    })
    try {
      await flushPromises()
      expect(wrapper.findAll('.is-requested-delivery')).to.have.length(1)
      expect(wrapper.find('.is-requested-delivery').text()).to.include('真实读取的正式成果').and.include('artifact-1 · v2')
      expect(wrapper.find('form.formal-decision').exists()).to.equal(true)
      await wrapper.setProps({ focusDeliveryId: 'no-longer-readable' })
      expect(wrapper.find('.is-requested-delivery').exists()).to.equal(false)
      expect(wrapper.find('[role="status"]').text()).to.include('尚未在当前列表核对到')
      await wrapper.setProps({ identityFingerprint: 'owner-b:client:2' })
      await flushPromises()
      expect(wrapper.find('.formal-delivery-card').exists()).to.equal(false)
      expect(writes).to.equal(0)
      expect(requests).to.have.length(2)
      requests.forEach(request => {
        expect(request.taskId).to.equal('task-1')
        expect(request).not.to.have.property('params')
      })
    } finally { wrapper.unmount() }
  })
})

// Mount the production Hall boundary, not just a list with invented rework props.
import { useOutputs } from '../src/composables/useOutputs.js'
const panelFilename = new URL('../src/components/deliveries/FormalTaskDeliveryPanel.vue', import.meta.url).pathname
const panelScript = compileScript(parse(readFileSync(panelFilename, 'utf8'), { filename: panelFilename }).descriptor,
  { id: 'formal-task-delivery-panel', inlineTemplate: true }).content
  .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
  .replace(/^import\s+FormalDeliveryList\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var { FormalDeliveryList } = deps')
  .replace(/^import\s+\{\s*useOutputs\s*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var { useOutputs } = deps')
  .replace('export default', 'return')
const FormalTaskDeliveryPanel = new Function('Vue', 'deps', panelScript)(Vue, { FormalDeliveryList, useOutputs })

describe('BF19 production formal rework boundary', () => {
  before(() => { for (const name of ['Element', 'HTMLElement', 'SVGElement', 'Node']) globalThis[name] ||= globalThis.window[name] })
  const scope = { taskId: 'task-1', conversationId: 'conversation-1', targetAgentId: 'agent-1', conversationConfirmed: true }
  const output = (state, version) => ({
    outputId: 'output-1', executionId: 'execution-1', fileId: 'file-1', fileVersion: 3,
    contentHash: 'a'.repeat(64), contentMimeType: 'application/pdf', byteLength: 128, committedAt: 1,
    state: 'AVAILABLE', publicationState: 'PUBLISHED', taskId: 'task-1', artifactId: 'artifact-1', artifactVersion: 2,
    formalDeliveryId: 'delivery-1', formalDeliveryRevision: 2, formalDeliveryState: state,
    formalDecisionVersion: version, formalReviewedAt: version ? 2 : null
  })
  it('refreshes exact outputs after decision, sends version 0 not revision 2, and creates rework once', async () => {
    let current = { ...delivery }
    const decisions = []; const reworks = []; const reads = []
    const wrapper = mount(FormalTaskDeliveryPanel, { props: {
      taskId: 'task-1', identityFingerprint: 'owner:client:1', executionContext: scope, selectedAgentId: 'agent-1',
      deliveryAdapter: {
        list: async () => [{ ...current }],
        decide: async request => { decisions.push(request); current = { ...delivery, state: 'changes_requested', deliveryVersion: 1, reviewedAt: 2, reviewReason: request.reviewReason } },
        createRework: async request => { reworks.push(request); return { executionId: 'rework-1' } }
      },
      outputAdapter: { list: async request => { reads.push(request); return { items: [output(current.state, current.deliveryVersion)] } } }
    } })
    try {
      await flushPromises()
      await wrapper.find('textarea').setValue('补充应急方案')
      await wrapper.find('form.formal-decision').trigger('submit', { submitter: { value: 'changes_requested' } })
      await flushPromises()
      expect(decisions).to.have.length(1)
      expect(decisions[0].expectedDeliveryVersion).to.equal(0)
      expect(wrapper.find('form.formal-rework').exists()).to.equal(true)
      await wrapper.find('form.formal-rework textarea').setValue('按验收意见新增一页')
      await wrapper.find('form.formal-rework').trigger('submit')
      await flushPromises()
      expect(reworks).to.have.length(1)
      expect(reworks[0]).to.include({ conversationId: 'conversation-1', targetAgentId: 'agent-1' })
      expect(reworks[0].delivery.deliveryVersion).to.equal(1)
      expect(reworks[0].source.fileRef).to.deep.equal({ fileId: 'file-1', fileVersion: '3' })
      expect(wrapper.find('form.formal-rework').exists()).to.equal(false)
      expect(wrapper.emitted('rework-created')).to.have.length(1)
      expect(reads.every(r => r.sourceId === 'conversation-1')).to.equal(true)
    } finally { wrapper.unmount() }
  })
  it('does not borrow foreign task, unconfirmed conversation, or nonselected agent; invalidates stale reads', async () => {
    let resolveRead; let signal; const writes = []
    const wrapper = mount(FormalTaskDeliveryPanel, { props: {
      taskId: 'task-1', identityFingerprint: 'owner:client:1', executionContext: { ...scope, taskId: 'foreign' }, selectedAgentId: 'agent-1',
      deliveryAdapter: { list: async () => [{ ...delivery, state: 'changes_requested', deliveryVersion: 1, reviewedAt: 2, reviewReason: 'revise' }], createRework: async r => writes.push(r) },
      outputAdapter: { list: request => { signal = request.signal; return new Promise(resolve => { resolveRead = resolve }) } }
    } })
    try {
      await flushPromises()
      expect(resolveRead).to.equal(undefined)
      await wrapper.setProps({ executionContext: { ...scope, conversationConfirmed: false } })
      await flushPromises(); expect(resolveRead).to.equal(undefined)
      await wrapper.setProps({ executionContext: scope, selectedAgentId: 'other-agent' })
      await flushPromises(); expect(resolveRead).to.equal(undefined)
      await wrapper.setProps({ selectedAgentId: 'agent-1' }); await flushPromises()
      expect(signal.aborted).to.equal(false)
      await wrapper.setProps({ identityFingerprint: '', selectedAgentId: '' }); await flushPromises()
      expect(signal.aborted).to.equal(true)
      resolveRead({ items: [output('changes_requested', 1)] }); await flushPromises()
      expect(wrapper.find('form.formal-rework').exists()).to.equal(false)
      expect(writes).to.have.length(0)
    } finally { wrapper.unmount() }
  })
  it('refuses mismatched decision versions and unrelated/private outputs', async () => {
    for (const changes of [{ formalDecisionVersion: 2 }, { formalDeliveryId: 'other-delivery' }, { taskId: 'other-task' }, { taskId: null }]) {
      const wrapper = mount(FormalTaskDeliveryPanel, { props: {
        taskId: 'task-1', identityFingerprint: 'owner:client:1', executionContext: scope, selectedAgentId: 'agent-1',
        deliveryAdapter: { list: async () => [{ ...delivery, state: 'changes_requested', deliveryVersion: 1, reviewedAt: 2, reviewReason: 'revise' }] },
        outputAdapter: { list: async () => ({ items: [{ ...output('changes_requested', 1), ...changes }] }) }
      } })
      try { await flushPromises(); expect(wrapper.find('form.formal-rework').exists()).to.equal(false) } finally { wrapper.unmount() }
    }
  })
})
