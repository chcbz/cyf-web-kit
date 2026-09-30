import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { compileScript, parse } from '@vue/compiler-sfc'

const filename = new URL('../src/components/juyiting/BountyTextSelectionArchive.vue', import.meta.url).pathname
const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
const script = compileScript(descriptor, { id: 'bounty-text-selection-test', inlineTemplate: true }).content
  .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm,
    (_, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
  .replace(/^import\s+\{\s*createApi\s*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var { createApi } = deps')
  .replace('export default', 'return')

describe('bounty persisted text selection archive', () => {
  const previous = new Map()
  before(() => { for (const name of ['Element', 'HTMLElement', 'SVGElement', 'Node']) { if (globalThis[name]) continue; previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { value: window[name], configurable: true, writable: true }) } })
  after(() => { for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name] } })
  it('sends Unicode code-point boundaries and the selected bytes digest only', async () => {
    let submitted
    const api = { execute: async request => {
      submitted = request
      const selection = request.data.textSelection
      return { data: { data: { state: 'saved', textSelection: selection, sha256: selection.sha256,
        fileId: 'file-text-1', version: 1 } } }
    } }
    const Component = new Function('Vue', 'deps', script)(Vue, { createApi: () => api })
    const wrapper = mount(Component, { props: { conversationId: '10', identityKey: 'owner',
      message: { localId: '7', content: '甲😀乙丙', streaming: false } } })
    try {
      const textarea = wrapper.find('textarea')
      textarea.element.selectionStart = 1
      textarea.element.selectionEnd = 4
      await textarea.trigger('select')
      await wrapper.findAll('button')[0].trigger('click')
      await flushPromises()
      expect(submitted.data.outputRef).to.equal(null)
      expect(submitted.data.textSelection.messageId).to.equal('7')
      expect(submitted.data.textSelection.startCodePoint).to.equal(1)
      expect(submitted.data.textSelection.endCodePoint).to.equal(3)
      expect(submitted.data).not.to.have.property('text')
      expect(wrapper.text()).to.include('文字片段已保存')
    } finally { wrapper.unmount() }
  })
})
