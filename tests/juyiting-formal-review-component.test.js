import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { mount, flushPromises } from '@vue/test-utils'
import { useFormalDeliveries } from '../src/composables/useFormalDeliveries.js'

const filename = new URL('../src/components/deliveries/FormalDeliveryList.vue', import.meta.url).pathname
const listSource = readFileSync(filename, 'utf8')
const { descriptor } = parse(listSource, { filename })
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
      expect(wrapper.find('.is-requested-delivery').text()).to.include('真实读取的正式成果')
      expect(wrapper.find('.formal-artifacts').text()).to.include('交付报告').and.include('固定版本 v2')
      expect(wrapper.find('.formal-technical').attributes()).not.to.have.property('open')
      expect(wrapper.find('.formal-technical').text()).to.include('artifact-1').and.include('a'.repeat(64))
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

  it('keeps long delivery content, previews, and acceptance controls in one bounded scroll region', async () => {
    const exactOutput = {
      artifactId: 'artifact-1', artifactVersion: '2', sha256: 'a'.repeat(64), state: 'AVAILABLE',
      title: 'result.pdf', mimeType: 'application/pdf', byteLength: 128, canPreview: true, canDownload: true
    }
    const longSummary = '长摘要内容 '.repeat(500)
    const deliveries = Array.from({ length: 8 }, (_, index) => ({
      ...delivery, deliveryId: `delivery-${index + 1}`, revision: index + 1, summary: longSummary
    }))
    const wrapper = mount(FormalDeliveryList, {
      props: {
        taskId: 'task-1', identityFingerprint: 'owner-a:client:1', readOutputs: [exactOutput],
        previewOutputKey: `artifact-1:2:${'a'.repeat(64)}`,
        adapter: { list: async () => deliveries, decide: async () => {}, createRework: async () => {} }
      },
      slots: { preview: '<section class="preview-slot">长内容预览</section>' }
    })
    try {
      await flushPromises()
      expect(wrapper.find('.formal-delivery-list').classes()).to.include('formal-delivery-list')
      expect(wrapper.findAll('.formal-delivery-card')).to.have.length(8)
      expect(wrapper.findAll('.formal-delivery-summary')[0].text()).to.have.length.greaterThan(1000)
      expect(wrapper.findAll('.formal-inline-preview')).to.have.length(8)
      expect(wrapper.findAll('form.formal-decision')).to.have.length(8)
      expect(listSource).to.match(/min-height:\s*0;[\s\S]*?overflow-y:\s*auto;[\s\S]*?overflow-x:\s*hidden/)
      expect(listSource).to.match(/overscroll-behavior:\s*contain/)
      expect(listSource).to.include('var(--formal-brand, #923f30)')
    } finally { wrapper.unmount() }
  })

  it('offers exact preview and download actions only for hash-matched formal artifacts', async () => {
    const exactOutput = {
      artifactId: 'artifact-1', artifactVersion: '2', sha256: 'a'.repeat(64), state: 'AVAILABLE',
      title: 'result.pdf', mimeType: 'application/pdf', byteLength: 128, canPreview: true, canDownload: true
    }
    const wrapper = mount(FormalDeliveryList, {
      props: {
        taskId: 'task-1', identityFingerprint: 'owner-a:client:1', readOutputs: [exactOutput],
        adapter: { list: async () => [delivery], decide: async () => {}, createRework: async () => {} }
      },
      slots: { preview: '<section class="preview-slot">固定版本预览</section>' }
    })
    try {
      await flushPromises()
      expect(wrapper.find('.formal-artifact-copy').text()).to.include('result.pdf').and.include('固定版本 v2')
      const preview = wrapper.find('button[aria-label="预览第 2 版交付报告"]')
      const download = wrapper.find('button[aria-label="下载第 2 版交付报告"]')
      expect(preview.exists()).to.equal(true)
      expect(download.exists()).to.equal(true)
      expect(preview.attributes('aria-pressed')).to.equal('false')
      await wrapper.setProps({ previewOutputKey: `artifact-1:2:${'a'.repeat(64)}` })
      expect(wrapper.find('.formal-inline-preview .preview-slot').text()).to.equal('固定版本预览')
      expect(preview.attributes('aria-pressed')).to.equal('true')
      expect(preview.text()).to.equal('收起预览')
      await preview.trigger('click')
      await download.trigger('click')
      expect(wrapper.emitted('preview-output')?.[0]?.[0]).to.deep.equal(exactOutput)
      expect(wrapper.emitted('download-output')?.[0]?.[0]).to.deep.equal(exactOutput)
      await wrapper.setProps({ readOutputs: [{ ...exactOutput, sha256: 'b'.repeat(64) }] })
      expect(wrapper.find('.formal-artifact-actions').exists()).to.equal(false)
    } finally { wrapper.unmount() }
  })
})

// Mount the production Hall boundary, not just a list with invented rework props.
import { useOutputs } from '../src/composables/useOutputs.js'
const panelFilename = new URL('../src/components/deliveries/FormalTaskDeliveryPanel.vue', import.meta.url).pathname
const panelSource = readFileSync(panelFilename, 'utf8')
const panelScript = compileScript(parse(readFileSync(panelFilename, 'utf8'), { filename: panelFilename }).descriptor,
  { id: 'formal-task-delivery-panel', inlineTemplate: true }).content
  .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
  .replace(/^import\s+FormalDeliveryList\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var { FormalDeliveryList } = deps')
  .replace(/^import\s+OutputPreview\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var { OutputPreview } = deps')
  .replace(/^import\s+\{\s*useOutputs\s*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var { useOutputs } = deps')
  .replace(/^import\s+\{\s*saveOutputBlob\s*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var { saveOutputBlob } = deps')
  .replace('export default', 'return')
const FormalTaskDeliveryPanel = new Function('Vue', 'deps', panelScript)(Vue, {
  FormalDeliveryList, useOutputs,
  OutputPreview: { props: ['item', 'load', 'contextKey'], template: '<section class="output-preview-stub" />' },
  saveOutputBlob: () => {}
})

describe('BF19 production formal rework boundary', () => {
  it('provides a bounded panel shell around the single formal-delivery scroll region', () => {
    expect(panelSource).to.include('class="formal-task-delivery-panel"')
    expect(panelSource).to.match(/grid-template-rows:\s*auto minmax\(0, ?1fr\) auto;[\s\S]*?flex:\s*1 1 auto;[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*hidden/)
  })
  before(() => { for (const name of ['Element', 'HTMLElement', 'SVGElement', 'Node']) globalThis[name] ||= globalThis.window[name] })
  const scope = { taskId: 'task-1', conversationId: 'conversation-1', targetAgentId: 'agent-1', conversationConfirmed: true }
  const output = (state, version) => ({
    outputId: 'output-1', executionId: 'execution-1', fileId: 'file-1', fileVersion: 3,
    contentHash: 'a'.repeat(64), contentMimeType: 'application/pdf', byteLength: 128, committedAt: 1,
    state: 'AVAILABLE', publicationState: 'PUBLISHED', taskId: 'task-1', artifactId: 'artifact-1', artifactVersion: 2,
    formalDeliveryId: 'delivery-1', formalDeliveryRevision: 2, formalDeliveryState: state,
    formalDecisionVersion: version, formalReviewedAt: version ? 2 : null
  })
  const taskOutput = () => ({
    artifactId: 'artifact-1', taskId: 'task-1', workItemId: 'work-1', producerAgentId: 'agent-1',
    artifactType: 'document', title: 'result.pdf', contentHash: 'a'.repeat(64), contentByteLength: 128,
    contentMimeType: 'application/pdf', artifactVersion: 2, visibility: 'task_members', createdAt: 1
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
      outputAdapter: { list: async request => {
        reads.push(request)
        return { items: request.sourceType === 'task' ? [taskOutput()] : [output(current.state, current.deliveryVersion)] }
      } }
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
      expect(reads.some(r => r.sourceType === 'task' && r.sourceId === 'task-1')).to.equal(true)
      expect(reads.some(r => r.sourceType === 'conversation' && r.sourceId === 'conversation-1')).to.equal(true)
    } finally { wrapper.unmount() }
  })
  it('does not borrow foreign task, unconfirmed conversation, or nonselected agent; invalidates stale reads', async () => {
    let resolveRead; let signal; const writes = []
    const wrapper = mount(FormalTaskDeliveryPanel, { props: {
      taskId: 'task-1', identityFingerprint: 'owner:client:1', executionContext: { ...scope, taskId: 'foreign' }, selectedAgentId: 'agent-1',
      deliveryAdapter: { list: async () => [{ ...delivery, state: 'changes_requested', deliveryVersion: 1, reviewedAt: 2, reviewReason: 'revise' }], createRework: async r => writes.push(r) },
      outputAdapter: { list: request => request.sourceType === 'task'
        ? Promise.resolve({ items: [] })
        : (signal = request.signal, new Promise(resolve => { resolveRead = resolve })) }
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
