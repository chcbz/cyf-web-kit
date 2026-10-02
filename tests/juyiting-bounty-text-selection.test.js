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
    const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
      randomUUID: () => 'unicode-boundaries',
      subtle: { digest: async () => new Uint8Array(32).buffer }
    } })
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
      await Vue.nextTick()
      expect(submitted.data.outputRef).to.equal(null)
      expect(submitted.data.textSelection.messageId).to.equal('7')
      expect(submitted.data.textSelection.startCodePoint).to.equal(1)
      expect(submitted.data.textSelection.endCodePoint).to.equal(3)
      expect(submitted.data).not.to.have.property('text')
      expect(wrapper.text()).to.include('文字片段已保存')
    } finally {
      wrapper.unmount()
      if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto)
      else delete globalThis.crypto
    }
  })

  it('reserves the first archive intent before a deferred digest so a double click cannot create a second request', async () => {
    const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
    const digests = []
    const submitted = []
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
      randomUUID: () => 'first-click-only',
      subtle: { digest: () => new Promise(resolve => digests.push(resolve)) }
    } })
    const api = { execute: async request => {
      submitted.push(request)
      const selection = request.data.textSelection
      return { data: { data: { state: 'saved', textSelection: selection, sha256: selection.sha256,
        fileId: 'file-text-race', version: 1 } } }
    } }
    const Component = new Function('Vue', 'deps', script)(Vue, { createApi: () => api })
    const wrapper = mount(Component, { props: { conversationId: '10', identityKey: 'owner',
      message: { localId: '7', content: '甲😀乙丙', streaming: false } } })
    try {
      const textarea = wrapper.find('textarea')
      textarea.element.selectionStart = 1
      textarea.element.selectionEnd = 4
      await textarea.trigger('select')
      const save = wrapper.findAll('button')[0]
      await save.trigger('click')
      await Vue.nextTick()
      expect(wrapper.text()).to.include('正在从服务端持久正文冻结选区')
      expect(wrapper.findAll('button')[0].attributes('disabled')).to.equal('')
      await save.trigger('click')
      expect(digests).to.have.length(1)
      expect(submitted).to.have.length(0)
      digests[0](new Uint8Array(32).buffer)
      await flushPromises()
      await Vue.nextTick()
      expect(submitted).to.have.length(1)
      expect(submitted[0].headers['Idempotency-Key']).to.equal('conversation-text-archive-first-click-only')
      expect(wrapper.text()).to.include('文字片段已保存')
    } finally {
      wrapper.unmount()
      if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto)
      else delete globalThis.crypto
    }
  })

  it('does not post or surface an old digest after identity changes', async () => {
    const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
    let resolveDigest
    let submitted = 0
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
      randomUUID: () => 'old-identity',
      subtle: { digest: () => new Promise(resolve => { resolveDigest = resolve }) }
    } })
    const api = { execute: async () => { submitted += 1; throw new Error('must not post old identity') } }
    const Component = new Function('Vue', 'deps', script)(Vue, { createApi: () => api })
    const wrapper = mount(Component, { props: { conversationId: '10', identityKey: 'owner-a',
      message: { localId: '7', content: '甲😀乙丙', streaming: false } } })
    try {
      const textarea = wrapper.find('textarea')
      textarea.element.selectionStart = 1
      textarea.element.selectionEnd = 4
      await textarea.trigger('select')
      await wrapper.findAll('button')[0].trigger('click')
      await wrapper.setProps({ identityKey: 'owner-b' })
      resolveDigest(new Uint8Array(32).buffer)
      await flushPromises()
      expect(submitted).to.equal(0)
      expect(wrapper.text()).not.to.include('文字片段已保存')
      expect(wrapper.text()).not.to.include('正在保存')
    } finally {
      wrapper.unmount()
      if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto)
      else delete globalThis.crypto
    }
  })

  it('does not let an already-posted old selection receipt overwrite the replacement selection', async () => {
    const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
    let resolveResponse
    const submitted = []
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
      randomUUID: () => 'late-selection-receipt',
      subtle: { digest: async () => new Uint8Array(32).buffer }
    } })
    const api = { execute: request => {
      submitted.push(request)
      return new Promise(resolve => { resolveResponse = resolve })
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
      expect(submitted).to.have.length(1)
      textarea.element.selectionStart = 4
      textarea.element.selectionEnd = 5
      await textarea.trigger('select')
      const archived = submitted[0].data.textSelection
      resolveResponse({ data: { data: { state: 'saved', textSelection: archived, sha256: archived.sha256,
        fileId: 'file-text-late', version: 1 } } })
      await flushPromises()
      await Vue.nextTick()
      expect(wrapper.text()).to.include('已选择 1 个字符')
      expect(wrapper.text()).not.to.include('文字片段已保存')
      expect(wrapper.text()).not.to.include('保存回执无法确认')
    } finally {
      wrapper.unmount()
      if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto)
      else delete globalThis.crypto
    }
  })

  it('does not let a replaced selection post or overwrite the new selection state', async () => {
    const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
    let resolveDigest
    let submitted = 0
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
      randomUUID: () => 'old-selection',
      subtle: { digest: () => new Promise(resolve => { resolveDigest = resolve }) }
    } })
    const api = { execute: async () => { submitted += 1; throw new Error('must not post old selection') } }
    const Component = new Function('Vue', 'deps', script)(Vue, { createApi: () => api })
    const wrapper = mount(Component, { props: { conversationId: '10', identityKey: 'owner',
      message: { localId: '7', content: '甲😀乙丙', streaming: false } } })
    try {
      const textarea = wrapper.find('textarea')
      textarea.element.selectionStart = 1
      textarea.element.selectionEnd = 4
      await textarea.trigger('select')
      await wrapper.findAll('button')[0].trigger('click')
      textarea.element.selectionStart = 4
      textarea.element.selectionEnd = 5
      await textarea.trigger('select')
      resolveDigest(new Uint8Array(32).buffer)
      await flushPromises()
      expect(submitted).to.equal(0)
      expect(wrapper.text()).to.include('已选择 1 个字符')
      expect(wrapper.text()).not.to.include('文字片段已保存')
    } finally {
      wrapper.unmount()
      if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto)
      else delete globalThis.crypto
    }
  })
})
