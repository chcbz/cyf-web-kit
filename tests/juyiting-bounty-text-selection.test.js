import { expect } from 'chai'
import { before, after } from 'mocha'
import { readFileSync } from 'node:fs'
import { createHash, webcrypto } from 'node:crypto'
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

const receipt = (selection, fileId = 'file-text-1', state = 'saved', extra = {}) => ({
  operationId: `arc_${'a'.repeat(32)}`, state, revision: '3',
  items: [{ sourceKind: 'textSelection', assetId: null, revision: null,
    textSelection: { ...selection, messageRevision: '9' },
    state: state === 'partial_failed' ? 'failed' : state,
    fileId: state === 'saved' ? fileId : null, version: state === 'saved' ? 1 : null,
    errorCode: null, message: null }], ...extra
})
const response = value => ({ data: { data: value } })

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
      const selection = request.data.items[0].textSelection
      return response(receipt(selection))
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
      expect(submitted.data).to.have.all.keys('mode', 'items')
      expect(submitted.data.mode).to.equal('create')
      expect(submitted.data.items).to.have.length(1)
      expect(submitted.data.items[0]).to.have.all.keys('textSelection')
      expect(submitted.data.items[0].textSelection).to.have.all.keys('messageId', 'startCodePoint', 'endCodePoint', 'sha256')
      expect(submitted.data.items[0].textSelection.messageId).to.equal('7')
      expect(submitted.data.items[0].textSelection.startCodePoint).to.equal(1)
      expect(submitted.data.items[0].textSelection.endCodePoint).to.equal(3)
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
      const selection = request.data.items[0].textSelection
      return response(receipt(selection, 'file-text-race'))
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

  it('clears a rejected pre-request digest so the next save recomputes instead of replaying null', async () => {
    const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
    let digestCalls = 0
    let submitted = 0
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
      randomUUID: () => `digest-retry-${++digestCalls}`,
      subtle: { digest: () => {
        const call = digestCalls
        return call === 1 ? Promise.reject(new TypeError('digest unavailable')) : Promise.resolve(new Uint8Array(32).buffer)
      } }
    } })
    const api = { execute: async request => {
      submitted += 1
      const selected = request.data.items[0].textSelection
      return response(receipt(selected, 'file-text-retry'))
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
      await flushPromises()
      await Vue.nextTick()
      expect(submitted).to.equal(0)
      expect(wrapper.text()).to.include('digest unavailable')
      expect(wrapper.text()).not.to.include('重试原保存')
      await save.trigger('click')
      await flushPromises()
      await Vue.nextTick()
      expect(submitted).to.equal(1)
      expect(wrapper.text()).to.include('文字片段已保存')
    } finally {
      wrapper.unmount()
      if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto)
      else delete globalThis.crypto
    }
  })

  it('does not post when a pending digest resolves after unmount', async () => {
    const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
    let resolveDigest
    let submitted = 0
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
      randomUUID: () => 'unmounted-digest',
      subtle: { digest: () => new Promise(resolve => { resolveDigest = resolve }) }
    } })
    const api = { execute: async () => { submitted += 1 } }
    const Component = new Function('Vue', 'deps', script)(Vue, { createApi: () => api })
    const wrapper = mount(Component, { props: { conversationId: '10', identityKey: 'owner',
      message: { localId: '7', content: '甲😀乙丙', streaming: false } } })
    try {
      const textarea = wrapper.find('textarea')
      textarea.element.selectionStart = 1
      textarea.element.selectionEnd = 4
      await textarea.trigger('select')
      await wrapper.findAll('button')[0].trigger('click')
      wrapper.unmount()
      resolveDigest(new Uint8Array(32).buffer)
      await flushPromises()
      expect(submitted).to.equal(0)
    } finally {
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
      const archived = submitted[0].data.items[0].textSelection
      resolveResponse(response(receipt(archived, 'file-text-late')))
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

  const exercise = async (execute, verify, { selectionStart = 1, selectionEnd = 4, crypto = null } = {}) => {
    const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
    const counts = { uuid: 0, digest: 0 }
    let actualDigest
    const actualCrypto = crypto && { randomUUID: () => crypto.randomUUID(),
      subtle: { digest: (...args) => { actualDigest = crypto.subtle.digest(...args); return actualDigest } } }
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: actualCrypto || {
      randomUUID: () => `canonical-intent-${++counts.uuid}`,
      subtle: { digest: async () => { counts.digest++; return new Uint8Array(32).buffer } }
    } })
    const requests = []
    const Component = new Function('Vue', 'deps', script)(Vue, { createApi: () => ({ execute: async request => {
      requests.push(JSON.parse(JSON.stringify(request)))
      return execute(request, requests.length)
    } }) })
    const wrapper = mount(Component, { props: { conversationId: '10', identityKey: 'owner',
      message: { localId: '7', content: '甲😀乙丙', streaming: false } } })
    try {
      const textarea = wrapper.find('textarea')
      textarea.element.selectionStart = selectionStart; textarea.element.selectionEnd = selectionEnd
      await textarea.trigger('select')
      await wrapper.findAll('button')[0].trigger('click')
      if (actualDigest) await actualDigest
      await flushPromises(); await Vue.nextTick()
      await verify({ wrapper, requests, counts })
    } finally {
      wrapper.unmount()
      if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto)
      else delete globalThis.crypto
    }
  }

  for (const state of ['pending', 'saving']) it(`handles 202 ${state} as unconfirmed and resumes the exact original intent`, async () => {
    await exercise((request, count) => ({ status: count === 1 ? 202 : 200,
      ...response(receipt(request.data.items[0].textSelection, 'text-created', count === 1 ? state : 'saved',
        { revision: String(count + 1) })) }), async ({ wrapper, requests, counts }) => {
      expect(wrapper.text()).to.include('尚未确认完成')
      expect(wrapper.text()).not.to.include('文字片段已保存')
      expect(wrapper.findAll('button')[0].attributes('disabled')).to.equal('')
      await wrapper.findAll('button')[1].trigger('click'); await flushPromises()
      expect(requests).to.have.length(2)
      expect(requests[1].data).to.deep.equal(requests[0].data)
      expect(requests[1].headers).to.deep.equal(requests[0].headers)
      expect(counts).to.deep.equal({ uuid: 1, digest: 1 })
      expect(wrapper.text()).to.include('文字片段已保存：text-created v1')
    })
  })

  it('replays a network-unknown save with the same canonical body and idempotency key', async () => {
    await exercise((request, count) => {
      if (count === 1) throw Object.assign(new Error('response lost'), { requestErrorClass: 'network' })
      return response(receipt(request.data.items[0].textSelection))
    }, async ({ wrapper, requests, counts }) => {
      expect(wrapper.text()).to.include('保存结果不明确')
      await wrapper.findAll('button')[1].trigger('click'); await flushPromises()
      expect(requests[1]).to.deep.equal(requests[0])
      expect(counts.uuid).to.equal(1)
      expect(wrapper.text()).to.include('文字片段已保存')
    })
  })

  const malformed = {
    'legacy top-level receipt': value => ({ state: 'saved', textSelection: value.items[0].textSelection,
      sha256: value.items[0].textSelection.sha256, fileId: 'legacy', version: 1 }),
    'wrong source kind': value => { value.items[0].sourceKind = 'assetRef'; return value },
    'missing frozen message revision': value => { delete value.items[0].textSelection.messageRevision; return value },
    'numeric frozen message revision': value => { value.items[0].textSelection.messageRevision = 9; return value },
    'wrong message': value => { value.items[0].textSelection.messageId = '8'; return value },
    'wrong start': value => { value.items[0].textSelection.startCodePoint = 0; return value },
    'wrong end': value => { value.items[0].textSelection.endCodePoint = 4; return value },
    'wrong digest': value => { value.items[0].textSelection.sha256 = 'f'.repeat(64); return value },
    'multiple receipt items': value => { value.items.push(structuredClone(value.items[0])); return value },
    'root/item state mismatch': value => { value.items[0].state = 'pending'; return value },
    'missing operation': value => { delete value.operationId; return value },
    'missing row revision': value => { delete value.revision; return value },
    'empty file': value => { value.items[0].fileId = ''; return value },
    'nonintegral version': value => { value.items[0].version = 1.5; return value }
  }
  for (const [name, mutate] of Object.entries(malformed)) it(`does not claim saved for ${name}`, async () => {
    await exercise(request => response(mutate(receipt(request.data.items[0].textSelection))), ({ wrapper, requests }) => {
      expect(requests).to.have.length(1)
      expect(wrapper.text()).to.include('保存结果不明确')
      expect(wrapper.text()).not.to.include('文字片段已保存')
      expect(wrapper.findAll('button')[1].text()).to.equal('重试原保存')
    })
  })

  for (const drift of ['operation', 'messageRevision', 'backwardRevision']) it(`refuses ${drift} drift after a pending receipt`, async () => {
    await exercise((request, count) => {
      const value = receipt(request.data.items[0].textSelection, 'should-not-appear', count === 1 ? 'saving' : 'saved',
        { revision: count === 1 ? '9007199254740993' : '9007199254740994' })
      if (count === 2 && drift === 'operation') value.operationId = `arc_${'b'.repeat(32)}`
      if (count === 2 && drift === 'messageRevision') value.items[0].textSelection.messageRevision = '10'
      if (count === 2 && drift === 'backwardRevision') value.revision = '9007199254740992'
      return response(value)
    }, async ({ wrapper, requests }) => {
      await wrapper.findAll('button')[1].trigger('click'); await flushPromises()
      expect(requests).to.have.length(2)
      expect(wrapper.text()).to.include('保存结果不明确')
      expect(wrapper.text()).not.to.include('should-not-appear')
    })
  })

  it('reports a confirmed partial_failed item as not saved', async () => {
    await exercise(request => {
      const value = receipt(request.data.items[0].textSelection, null, 'partial_failed')
      value.items[0].errorCode = 'WORKSPACE_CONFLICT'; value.items[0].message = '该文字片段未保存'
      return response(value)
    }, ({ wrapper }) => {
      expect(wrapper.text()).to.include('该文字片段未保存')
      expect(wrapper.text()).not.to.include('文字片段已保存')
      expect(wrapper.text()).not.to.include('保存结果不明确')
    })
  })

  it('hashes the real UTF-8 selected bytes without submitting body text or message revision', async () => {
    await exercise(request => response(receipt(request.data.items[0].textSelection)), ({ requests, wrapper }) => {
      expect(requests[0].data).to.deep.equal({ mode: 'create', items: [{ textSelection: {
        messageId: '7', startCodePoint: 1, endCodePoint: 3,
        sha256: createHash('sha256').update('😀乙', 'utf8').digest('hex')
      } }] })
      expect(wrapper.text()).to.include('文字片段已保存')
    }, { crypto: webcrypto })
  })

  for (const [selectionStart, selectionEnd] of [[1, 2], [2, 3]]) it(`rejects split surrogate boundaries ${selectionStart}:${selectionEnd} without posting`, async () => {
    await exercise(() => { throw Error('must not post') }, ({ wrapper, requests, counts }) => {
      expect(wrapper.text()).to.include('请选择完整字符')
      expect(requests).to.have.length(0)
      expect(counts.digest).to.equal(0)
    }, { selectionStart, selectionEnd })
  })
})
