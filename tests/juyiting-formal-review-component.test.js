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
