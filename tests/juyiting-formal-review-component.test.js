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
      expect(wrapper.find('.formal-technical').exists()).to.equal(false)
      expect(wrapper.text()).not.to.include('a'.repeat(64))
      expect(wrapper.findAll('form')).to.have.length(0)
      expect(wrapper.findAll('textarea')).to.have.length(0)
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

  it('keeps long delivery content, previews, without independent decision controls in one bounded scroll region', async () => {
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
      expect(wrapper.findAll('.formal-delivery-card'), wrapper.text()).to.have.length(8)
      expect(wrapper.findAll('.formal-delivery-summary')[0].text()).to.have.length.greaterThan(1000)
      expect(wrapper.findAll('.formal-inline-preview')).to.have.length(8)
      expect(wrapper.findAll('form')).to.have.length(0)
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
      expect(download.exists()).to.equal(false)
      expect(preview.attributes('aria-pressed')).to.equal('false')
      await wrapper.setProps({ previewOutputKey: `artifact-1:2:${'a'.repeat(64)}` })
      expect(wrapper.find('.formal-inline-preview .preview-slot').text()).to.equal('固定版本预览')
      expect(preview.attributes('aria-pressed')).to.equal('true')
      expect(preview.text()).to.equal('收起预览')
      await preview.trigger('click')
      expect(wrapper.emitted('preview-output')?.[0]?.[0]).to.deep.equal(exactOutput)
      expect(wrapper.emitted('download-output')).to.equal(undefined)
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

describe('formal historical panel convergence', () => {
  before(() => { for (const name of ['Element', 'HTMLElement', 'SVGElement', 'Node']) globalThis[name] ||= globalThis.window[name] })
  it('uses the exact task artifact reader and delegates discussion without retaining any decision/rework/download form', async () => {
    const reads = []; let writes = 0
    const wrapper = mount(FormalTaskDeliveryPanel, { props: {
      taskId: 'task-1', identityFingerprint: 'owner:client:1',
      deliveryAdapter: { list: async () => [delivery], decide: async () => { writes++ }, createRework: async () => { writes++ } },
      outputAdapter: { list: async request => { reads.push(request); return { items: [] } } }
    } })
    try {
      await flushPromises()
      expect(wrapper.findAll('form')).to.have.length(0)
      expect(wrapper.findAll('textarea')).to.have.length(0)
      expect(wrapper.find('.formal-task-delivery-intro').text()).to.include('统一使用事项')
      await wrapper.find('.formal-task-delivery-intro button').trigger('click')
      expect(wrapper.emitted('discuss-task')).to.have.length(1)
      expect(wrapper.emitted('rework-created')).to.equal(undefined)
      expect(writes).to.equal(0)
      expect(reads.length).to.be.greaterThan(0)
      for (const request of reads) expect(request).to.include({ sourceType: 'task', sourceId: 'task-1' })
      expect(panelSource).not.to.include('useHallDeliveryReview') // shell is the single review owner
      expect(panelSource).not.to.include('saveOutputBlob')
    } finally { wrapper.unmount() }
  })
  it('preserves one bounded list scroll area and clears preview synchronously on identity/task changes', async () => {
    const wrapper = mount(FormalTaskDeliveryPanel, { props: { taskId: 'task-1', identityFingerprint: 'owner-a',
      deliveryAdapter: { list: async () => [delivery] }, outputAdapter: { list: async () => ({ items: [] }) } } })
    try {
      await flushPromises()
      wrapper.findComponent(FormalDeliveryList).vm.$emit('preview-output', { artifactId: 'artifact-1', artifactVersion: '2', sha256: 'a'.repeat(64) })
      await Vue.nextTick()
      expect(wrapper.findComponent(FormalDeliveryList).props('previewOutputKey')).to.include('artifact-1:2:')
      await wrapper.setProps({ identityFingerprint: 'owner-b' }); await flushPromises()
      expect(wrapper.findComponent(FormalDeliveryList).props('previewOutputKey')).to.equal('')
      expect(panelSource).to.match(/grid-template-rows:\s*auto minmax\(0, ?1fr\) auto;[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*hidden/)
    } finally { wrapper.unmount() }
  })
})
