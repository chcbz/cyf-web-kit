import { before, after } from 'mocha'
import { Buffer } from 'node:buffer'
import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import * as Vue from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { compileScript, parse } from '@vue/compiler-sfc'
import { exactOutputId, outputCatalogItems, outputItemKey, previewKind, scopedExecutionSteps, downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery } from '../src/composables/juyiting/bountyOutputCatalog.js'
import { readOutputRecovery, writeOutputRecovery } from '../src/composables/juyiting/bountyOutputRecovery.js'
import { useHallConversationArchive } from '../src/composables/juyiting/useHallConversationArchive.js'
import { useHallBountyFinalization, safeFinalizationVersion } from '../src/composables/juyiting/useHallBountyFinalization.js'

const filename = fileURLToPath(new URL('../src/components/juyiting/BountyExecutionOutputs.vue', import.meta.url))
const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
const script = compileScript(descriptor, { id: 'hall-bounty-live-output-test', inlineTemplate: true }).content
  .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm,
    (_, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
  .replace(/^import\s+\{\s*createApi\s*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var { createApi } = deps')
  .replace(/^import\s+\{\s*exactOutputId,[^}]+\}\s+from\s+['"][^'"]+['"];?\s*$/gm,
    'var { exactOutputId, outputCatalogItems, outputItemKey, previewKind, scopedExecutionSteps, downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery } = deps')
  .replace(/^import\s+\{\s*saveOutputBlob\s*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var { saveOutputBlob } = deps')
  .replace(/^import\s+\{\s*readOutputRecovery,[^}]+\}\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var { readOutputRecovery, writeOutputRecovery } = deps')
  .replace(/^import\s+\{\s*useHallConversationArchive\s*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var { useHallConversationArchive } = deps')
  .replace(/^import\s+\{\s*useHallBountyFinalization,[^}]+\}\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var { useHallBountyFinalization, safeFinalizationVersion } = deps')
  .replace('export default', 'return')
const zeroDigest = createHash('sha256').update(Buffer.alloc(20)).digest('hex')
const item = stepId => {
  const url = `/chat/requests/request-1/steps/${stepId}/outputs/output_1`
  return { outputId: 'output_1', contentMimeType: 'image/png', sha256: zeroDigest,
    byteLength: 20, previewUrl: url, downloadUrl: `${url}?download=true`, assetRef: { assetId: `ast_${stepId}`, revision: '1' } }
}
const step = id => ({ stepId: id, kind: 'EXECUTE', executionId: `execution-${id}` })

describe('bounty output gallery live owner scope', () => {
  beforeEach(() => window.sessionStorage.clear())
  afterEach(() => window.sessionStorage.clear())
  const previous = new Map()
  before(() => {
    for (const name of ['Element', 'HTMLElement', 'SVGElement', 'Node']) {
      if (globalThis[name]) continue
      previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
      Object.defineProperty(globalThis, name, { value: window[name], configurable: true, writable: true })
    }
  })
  after(() => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  })
  it('keeps reading the current request after its first output and isolates same outputId previews per step', async () => {
    const oldTimeout = globalThis.setTimeout
    const oldClear = globalThis.clearTimeout
    const oldCreate = URL.createObjectURL
    const oldRevoke = URL.revokeObjectURL
    let poll; let requestReads = 0; let created = 0
    const revoked = []; const previewObservers = new Set()
    const mockApi = { get: async path => {
      if (path === '/requests/request-1') return { data: { data: {
        requestId: 'request-1', conversationId: 'conversation-1',
        steps: (requestReads++ === 0) ? [step('step-1')] : [step('step-1'), step('step-2')]
      } } }
      if (path.endsWith('/steps/step-1/outputs')) return { data: { data: [item('step-1')] } }
      if (path.endsWith('/steps/step-2/outputs')) return { data: { data: [item('step-2')] } }
      throw new Error(`unexpected GET ${path}`)
    }, execute: async () => ({ data: new Blob([new Uint8Array(20)], { type: 'image/png' }) }) }
    const Component = new Function('Vue', 'deps', script)(Vue, {
      createApi: () => mockApi, exactOutputId, outputCatalogItems, outputItemKey,
      previewKind, scopedExecutionSteps, downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery, useHallBountyFinalization, safeFinalizationVersion, useHallConversationArchive, readOutputRecovery, writeOutputRecovery, saveOutputBlob: () => {}
    })
    globalThis.setTimeout = (fn, delay, ...args) => delay === 2500 ? (poll = fn, 999) : oldTimeout(fn, delay, ...args)
    globalThis.clearTimeout = id => { if (id === 999) poll = null; else oldClear(id) }
    URL.createObjectURL = () => `blob:test-${++created}`
    URL.revokeObjectURL = url => revoked.push(url)
    let wrapper
    try {
      wrapper = mount(Component, { props: { enabled: true, identityKey: 'owner-a',
        conversationId: 'conversation-1', request: { requestId: 'request-1', conversationId: 'conversation-1' } } })
      await flushPromises()
      expect(wrapper.findAll('.bounty-output')).to.have.length(1)
      expect(poll).to.be.a('function')
      poll()
      await flushPromises()
      expect(requestReads).to.equal(2)
      expect(wrapper.findAll('.bounty-output')).to.have.length(2)
      expect(poll).to.be.a('function')
      for (let index = 0; index < wrapper.findAll('.bounty-output').length; index++) {
        const output = wrapper.findAll('.bounty-output')[index]
        const preview = output.findAll('button').find(button => button.text() === '预览')
        const ready = new Promise(resolve => {
          const observer = new window.MutationObserver(() => {
            if (wrapper.findAll('.bounty-output img').length > index) {
              observer.disconnect(); previewObservers.delete(observer); resolve()
            }
          })
          previewObservers.add(observer); observer.observe(wrapper.element, { childList: true, subtree: true })
        })
        await preview.trigger('click'); await ready
      }
      expect(wrapper.findAll('.bounty-output img').map(image => image.attributes('src')))
        .to.deep.equal(['blob:test-1', 'blob:test-2'])
    } finally {
      try {
        for (const observer of previewObservers) observer.disconnect()
        wrapper?.unmount()
      } finally {
        globalThis.setTimeout = oldTimeout
        globalThis.clearTimeout = oldClear
        URL.createObjectURL = oldCreate
        URL.revokeObjectURL = oldRevoke
      }
    }
    expect(revoked).to.include.members(['blob:test-1', 'blob:test-2'])
  })
  it('emits only a nested assetRef plus exact producer parent for Hall-owned schema-3 edit', async () => {
    const oldTimeout = globalThis.setTimeout
    const oldClear = globalThis.clearTimeout
    const writes = []
    const chatApi = { get: async path => {
      if (path === '/requests/request-1') return { data: { data: { requestId: 'request-1', conversationId: 'conversation-1',
        steps: [{ ...step('step-1'), taskId: 'task-1', assignmentRevision: '3' }] } } }
      if (path.endsWith('/steps/step-1/outputs')) return { data: { data: [item('step-1')] } }
      throw new Error(`unexpected GET ${path}`)
    }, execute: async payload => { writes.push(payload); throw new Error('the output card must never POST an interaction') } }
    const Component = new Function('Vue', 'deps', script)(Vue, {
      createApi: () => chatApi, exactOutputId, outputCatalogItems, outputItemKey, previewKind, scopedExecutionSteps, downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery, useHallBountyFinalization, safeFinalizationVersion, useHallConversationArchive, readOutputRecovery, writeOutputRecovery, saveOutputBlob: () => {}
    })
    globalThis.setTimeout = (fn, delay, ...args) => delay === 2500 ? 999 : oldTimeout(fn, delay, ...args)
    globalThis.clearTimeout = id => { if (id !== 999) oldClear(id) }
    let wrapper
    try {
      wrapper = mount(Component, { props: { enabled: true, identityKey: 'owner-a', conversationId: 'conversation-1', request: { requestId: 'request-1', conversationId: 'conversation-1' } } })
      await flushPromises()
      expect(wrapper.find('.image-rework').exists()).to.equal(false)
      expect(wrapper.text()).to.include('直接在会话中告诉 Agent')
      expect(writes).to.deep.equal([])
      expect(wrapper.emitted('request-followup-edit')).to.equal(undefined)
    } finally {
      wrapper?.unmount(); globalThis.setTimeout = oldTimeout; globalThis.clearTimeout = oldClear
    }
  })
  it('refuses mismatched output bytes and download MIME with a visible error', async () => {
    const originalTimeout = globalThis.setTimeout
    const originalClear = globalThis.clearTimeout
    const itemForCatalog = item('step-1')
    const responses = [
      new Blob([new Uint8Array(20)], { type: 'application/octet-stream' }),
      new Blob([new Uint8Array(19)], { type: 'image/png' })
    ]
    let downloaded = 0
    const chatApi = {
      get: async path => {
        if (path === '/requests/request-1') return { data: { data: {
          requestId: 'request-1', conversationId: 'conversation-1', steps: [step('step-1')]
        } } }
        if (path.endsWith('/steps/step-1/outputs')) return { data: { data: [itemForCatalog] } }
        throw new Error(`unexpected GET ${path}`)
      },
      execute: async () => ({ data: responses.shift() })
    }
    const Component = new Function('Vue', 'deps', script)(Vue, {
      createApi: () => chatApi, exactOutputId, outputCatalogItems, outputItemKey,
      previewKind, scopedExecutionSteps, downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery, useHallBountyFinalization, safeFinalizationVersion, useHallConversationArchive, readOutputRecovery, writeOutputRecovery,
      saveOutputBlob: () => { downloaded++ }
    })
    globalThis.setTimeout = (fn, delay, ...args) => delay === 2500 ? 999 : originalTimeout(fn, delay, ...args)
    globalThis.clearTimeout = id => { if (id !== 999) originalClear(id) }
    let wrapper
    try {
      wrapper = mount(Component, { props: { enabled: true, identityKey: 'owner-a',
        conversationId: 'conversation-1', request: { requestId: 'request-1', conversationId: 'conversation-1' } } })
      await flushPromises()
      const buttons = () => wrapper.findAll('.bounty-output button')
      await buttons().find(button => button.text() === '下载').trigger('click')
      for (let attempt = 0; attempt < 50 && !wrapper.text().includes('媒体类型不匹配'); attempt++) { await new Promise(resolve => originalTimeout(resolve, 10)); await flushPromises() }
      expect(wrapper.text()).to.include('媒体类型不匹配')
      await buttons().find(button => button.text() === '预览').trigger('click')
      await flushPromises()
      expect(wrapper.text()).to.include('成果字节长度与清单不一致')
      expect(wrapper.find('.bounty-output img').exists()).to.equal(false)
      expect(downloaded).to.equal(0)
    } finally {
      wrapper?.unmount(); globalThis.setTimeout = originalTimeout; globalThis.clearTimeout = originalClear
    }
  })
  it('uses the canonical task version separately from assignment revision when finalizing', async () => {
    const oldTimeout = globalThis.setTimeout
    const oldClear = globalThis.clearTimeout
    let submitted
    const catalogItem = { ...item('step-1'), byteLength: 20 }
    const chatApi = { get: async path => {
      if (path === '/requests/request-1') return { data: { data: { requestId: 'request-1', conversationId: 'conversation-1',
        steps: [{ ...step('step-1'), taskId: 'task-1', assignmentRevision: '3' }] } } }
      if (path.endsWith('/steps/step-1/outputs')) return { data: { data: [catalogItem] } }
      throw new Error(`unexpected GET ${path}`)
    }, execute: async () => { throw new Error('unexpected chat write') } }
    const agentApi = { execute: async request => { if (request.method === 'POST') submitted = request; return { data: { data: {
      operationId: 'finalization-1', taskId: 'task-1', conversationId: 'conversation-1', state: 'completed',
      stateVersion: '5', stage: 'TASK_COMPLETED', expectedTaskVersion: '9', expectedAssignmentRevision: '3',
      selectedOutputs: submitted.data.selectedOutputs, deliveryId: 'delivery-1', deliveryState: 'accepted',
      taskState: 'completed', taskVersion: '12', errorCode: null, retryable: false } } } } }
    const Component = new Function('Vue', 'deps', script)(Vue, {
      createApi: base => base === '/agent' ? agentApi : chatApi, exactOutputId, outputCatalogItems, outputItemKey,
      previewKind, scopedExecutionSteps, downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery, useHallBountyFinalization, safeFinalizationVersion, useHallConversationArchive, readOutputRecovery, writeOutputRecovery, saveOutputBlob: () => {}
    })
    globalThis.setTimeout = (fn, delay, ...args) => delay === 2500 ? 999 : oldTimeout(fn, delay, ...args)
    globalThis.clearTimeout = id => { if (id !== 999) oldClear(id) }
    let wrapper
    try {
      wrapper = mount(Component, { props: { acceptance: true, enabled: true, identityKey: 'owner-a', taskVersion: '9',
        conversationId: 'conversation-1', request: { requestId: 'request-1', conversationId: 'conversation-1' } } })
      await flushPromises()
      expect(wrapper.find('input[type="checkbox"]').exists()).to.equal(false)
      await wrapper.find('.finalize-button').trigger('click')
      await flushPromises()
      expect(submitted.data.expectedTaskVersion).to.equal(9)
      expect(submitted.data.expectedAssignmentRevision).to.equal(3)
      expect(wrapper.text()).to.include('需求已完成')
      expect(wrapper.emitted('task-completed')).to.deep.equal([[{ taskId: 'task-1', conversationId: 'conversation-1',
        operationId: 'finalization-1', deliveryId: 'delivery-1', taskVersion: '12' }]])
      await wrapper.find('.finalize-status-button').trigger('click'); await flushPromises()
      expect(wrapper.emitted('task-completed')).to.have.length(1)
    } finally { wrapper?.unmount(); globalThis.setTimeout = oldTimeout; globalThis.clearTimeout = oldClear }
  })

  it('retains the pending archive intent on projection refresh and ignores its late receipt after identity switch', async () => {
    const oldTimeout = globalThis.setTimeout
    const oldClear = globalThis.clearTimeout
    let finishWrite; let sent
    const catalogItem = item('step-1')
    const chatApi = { get: async path => {
      if (path === '/requests/request-1') return { data: { data: { requestId: 'request-1', conversationId: 'conversation-1',
        steps: [{ ...step('step-1'), taskId: 'task-1', assignmentRevision: '3' }] } } }
      if (path.endsWith('/steps/step-1/outputs')) return { data: { data: [catalogItem] } }
      throw new Error(`unexpected GET ${path}`)
    }, execute: request => { sent = request; return new Promise(resolve => { finishWrite = resolve }) } }
    const Component = new Function('Vue', 'deps', script)(Vue, {
      createApi: () => chatApi, exactOutputId, outputCatalogItems, outputItemKey,
      previewKind, scopedExecutionSteps, downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery, useHallBountyFinalization, safeFinalizationVersion, useHallConversationArchive, readOutputRecovery, writeOutputRecovery, saveOutputBlob: () => {}
    })
    globalThis.setTimeout = (fn, delay, ...args) => delay === 2500 ? 999 : oldTimeout(fn, delay, ...args)
    globalThis.clearTimeout = id => { if (id !== 999) oldClear(id) }
    let wrapper
    try {
      wrapper = mount(Component, { props: { enabled: true, identityKey: 'owner-a', conversationId: 'conversation-1',
        request: { requestId: 'request-1', conversationId: 'conversation-1', stateVersion: 1 } } })
      await flushPromises()
      await wrapper.findAll('.bounty-output button').find(button => button.text() === '保存到工作空间').trigger('click')
      await flushPromises()
      expect(sent.headers['Idempotency-Key']).to.match(/^conversation-archive-/)
      await wrapper.setProps({ request: { requestId: 'request-1', conversationId: 'conversation-1', stateVersion: 2 } })
      await flushPromises()
      expect(wrapper.text()).to.include('正在提交保存请求')
      await wrapper.setProps({ identityKey: 'owner-b' })
      await flushPromises()
      finishWrite({ data: { data: { operationId: 'operation-a', state: 'saved', revision: '1', items: [{ ...catalogItem.assetRef, state: 'saved', fileId: 'file-a', version: 1 }] } } })
      await flushPromises()
      expect(wrapper.text()).not.to.include('file-a')
      expect(wrapper.text()).not.to.include('已保存到工作空间')
    } finally { wrapper?.unmount(); globalThis.setTimeout = oldTimeout; globalThis.clearTimeout = oldClear }
  })

  it('does not show a stale finalization receipt after the owner changes', async () => {
    const oldTimeout = globalThis.setTimeout
    const oldClear = globalThis.clearTimeout
    let finishWrite
    const chatApi = { get: async path => {
      if (path === '/requests/request-1') return { data: { data: { requestId: 'request-1', conversationId: 'conversation-1',
        steps: [{ ...step('step-1'), taskId: 'task-1', assignmentRevision: '3' }] } } }
      if (path.endsWith('/steps/step-1/outputs')) return { data: { data: [item('step-1')] } }
      throw new Error(`unexpected GET ${path}`)
    } }
    const agentApi = { execute: () => new Promise(resolve => { finishWrite = resolve }) }
    const Component = new Function('Vue', 'deps', script)(Vue, {
      createApi: base => base === '/agent' ? agentApi : chatApi, exactOutputId, outputCatalogItems, outputItemKey,
      previewKind, scopedExecutionSteps, downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery, useHallBountyFinalization, safeFinalizationVersion, useHallConversationArchive, readOutputRecovery, writeOutputRecovery, saveOutputBlob: () => {}
    })
    globalThis.setTimeout = (fn, delay, ...args) => delay === 2500 ? 999 : oldTimeout(fn, delay, ...args)
    globalThis.clearTimeout = id => { if (id !== 999) oldClear(id) }
    let wrapper
    try {
      wrapper = mount(Component, { props: { acceptance: true, enabled: true, identityKey: 'owner-a', taskVersion: '9',
        conversationId: 'conversation-1', request: { requestId: 'request-1', conversationId: 'conversation-1' } } })
      await flushPromises()
      expect(wrapper.find('input[type="checkbox"]').exists()).to.equal(false)
      await wrapper.find('.finalize-button').trigger('click')
      await flushPromises()
      expect(wrapper.text()).to.include('正在验收')
      await wrapper.setProps({ identityKey: 'owner-b' })
      await flushPromises()
      finishWrite({ data: { data: { stage: 'TASK_COMPLETED', deliveryState: 'accepted', deliveryId: 'delivery-a' } } })
      await flushPromises()
      expect(wrapper.emitted('task-completed')).to.equal(undefined)
      expect(wrapper.text()).not.to.include('delivery-a')
      expect(wrapper.text()).not.to.include('任务已完成')
    } finally { wrapper?.unmount(); globalThis.setTimeout = oldTimeout; globalThis.clearTimeout = oldClear }
  })

  it('downloads verified passive media with its extension and unknown formats as opaque files', async () => {
    const oldTimeout = globalThis.setTimeout
    const oldClear = globalThis.clearTimeout
    const downloads = []
    const png = item('step-1')
    const opaque = { ...item('step-1'), outputId: 'opaque_1', contentMimeType: 'image/svg+xml', previewUrl: null,
      downloadUrl: '/chat/requests/request-1/steps/step-1/outputs/opaque_1?download=true' }
    const chatApi = { get: async path => {
      if (path === '/requests/request-1') return { data: { data: { requestId: 'request-1', conversationId: 'conversation-1', steps: [step('step-1')] } } }
      if (path.endsWith('/steps/step-1/outputs')) return { data: { data: [png, opaque] } }
      throw new Error(`unexpected GET ${path}`)
    }, execute: async request => ({ data: new Blob([new Uint8Array(20)], {
      type: request.url.includes('/opaque_1?') ? 'application/octet-stream' : 'image/png'
    }) }) }
    const Component = new Function('Vue', 'deps', script)(Vue, {
      createApi: () => chatApi, exactOutputId, outputCatalogItems, outputItemKey,
      previewKind, scopedExecutionSteps, downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery, useHallBountyFinalization, safeFinalizationVersion, useHallConversationArchive,
      readOutputRecovery, writeOutputRecovery, saveOutputBlob: value => downloads.push(value)
    })
    globalThis.setTimeout = (fn, delay, ...args) => delay === 2500 ? 999 : oldTimeout(fn, delay, ...args)
    globalThis.clearTimeout = id => { if (id !== 999) oldClear(id) }
    let wrapper
    try {
      wrapper = mount(Component, { props: { enabled: true, identityKey: 'owner-a', conversationId: 'conversation-1',
        request: { requestId: 'request-1', conversationId: 'conversation-1' } } })
      await flushPromises()
      for (const output of wrapper.findAll('.bounty-output')) {
        await output.findAll('button').find(button => button.text() === '下载').trigger('click')
      }
      for (let count = 0; count < 50 && downloads.length < 2; count++) {
        await new Promise(resolve => oldTimeout(resolve, 10)); await flushPromises()
      }
      expect(downloads.map(value => value.item.name)).to.have.members(['output_1.png', 'opaque_1.bin'])
      expect(downloads.map(value => value.blob.type)).to.have.members(['image/png', 'application/octet-stream'])
      expect(wrapper.text()).not.to.include('媒体类型不匹配')
    } finally { wrapper?.unmount(); globalThis.setTimeout = oldTimeout; globalThis.clearTimeout = oldClear }
  })

  it('waits for a real persisted asset then sends only the current archive contract, never a hash or outputRef', async () => {
    const oldTimeout = globalThis.setTimeout; const oldClear = globalThis.clearTimeout
    let poll; let projected = false; const writes = []
    const catalog = () => ({ ...item('step-1'), assetRef: projected ? { assetId: 'ast_ready', revision: '1' } : null })
    const chatApi = { get: async path => {
      if (path === '/requests/request-1') return { data: { data: { requestId: 'request-1', conversationId: 'conversation-1', steps: [step('step-1')] } } }
      if (path.endsWith('/steps/step-1/outputs')) return { data: { data: [catalog()] } }
      throw new Error(`unexpected GET ${path}`)
    }, execute: async options => {
      writes.push(options)
      return { data: { data: { operationId: 'archive-ready', state: 'saved', revision: '1', items: [
        { assetId: 'ast_ready', revision: '1', state: 'saved', fileId: 'workspace-bird', version: 1 }
      ] } } }
    } }
    const stored = new Map(); const storage = { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value) }
    const Component = new Function('Vue', 'deps', script)(Vue, {
      createApi: () => chatApi, exactOutputId, outputCatalogItems, outputItemKey, previewKind, scopedExecutionSteps,
      downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery, useHallBountyFinalization, safeFinalizationVersion, readOutputRecovery, writeOutputRecovery, saveOutputBlob: () => {},
      useHallConversationArchive: args => useHallConversationArchive({ ...args, storage })
    })
    globalThis.setTimeout = (fn, delay, ...args) => delay === 2500 ? (poll = fn, 999) : oldTimeout(fn, delay, ...args)
    globalThis.clearTimeout = id => { if (id === 999) poll = null; else oldClear(id) }
    let wrapper
    try {
      wrapper = mount(Component, { props: { enabled: true, identityKey: 'owner-projection', conversationId: 'conversation-1',
        request: { requestId: 'request-1', conversationId: 'conversation-1' } } })
      await flushPromises()
      const waiting = wrapper.findAll('button').find(button => button.text() === '等待资产登记')
      expect(waiting.attributes()).to.have.property('disabled')
      await waiting.trigger('click'); expect(writes).to.have.length(0)
      projected = true; poll(); await flushPromises()
      expect(writes).to.have.length(0) // Projection reads never start a save.
      await wrapper.findAll('button').find(button => button.text() === '保存到工作空间').trigger('click')
      await flushPromises()
      expect(writes).to.have.length(1)
      expect(writes[0].data).to.deep.equal({ mode: 'create', items: [{ assetRef: { assetId: 'ast_ready', revision: '1' } }] })
      expect(writes[0].url).to.equal('/conversations/conversation-1/archive-operations')
      expect(writes[0].needAuth).to.equal(true)
      expect(writes[0].headers['Idempotency-Key']).to.match(/^conversation-archive-/)
      expect(wrapper.text()).to.include('workspace-bird v1')
      expect(wrapper.findAll('button').find(button => button.text() === '已保存到工作空间').attributes()).to.have.property('disabled')
      expect(stored.size).to.equal(1)
    } finally { wrapper?.unmount(); globalThis.setTimeout = oldTimeout; globalThis.clearTimeout = oldClear }
  })

  it('restores a lost save ACK across remount and reconciles a known operation by GET without another file', async () => {
    const oldTimeout = globalThis.setTimeout; const oldClear = globalThis.clearTimeout
    const calls = []; let reads = 0; let posts = 0
    const pending = state => ({ operationId: 'archive-recovered', state, revision: '1', items: [
      { ...item('step-1').assetRef, state, ...(state === 'saved' ? { fileId: 'workspace-recovered', version: 1 } : {}) }
    ] })
    const chatApi = { get: async path => {
      if (path === '/requests/request-1') return { data: { data: { requestId: 'request-1', conversationId: 'conversation-1', steps: [step('step-1')] } } }
      if (path.endsWith('/steps/step-1/outputs')) return { data: { data: [item('step-1')] } }
      throw new Error(`unexpected GET ${path}`)
    }, execute: async options => {
      calls.push(options)
      if (options.method === 'POST') {
        if (++posts === 1) throw new TypeError('saved on server but ACK lost')
        return { data: { data: pending('pending') } }
      }
      return { data: { data: pending(++reads === 1 ? 'pending' : 'saved') } }
    } }
    const stored = new Map(); const storage = { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value) }
    const Component = new Function('Vue', 'deps', script)(Vue, {
      createApi: () => chatApi, exactOutputId, outputCatalogItems, outputItemKey, previewKind, scopedExecutionSteps,
      downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery, useHallBountyFinalization, safeFinalizationVersion, readOutputRecovery, writeOutputRecovery, saveOutputBlob: () => {},
      useHallConversationArchive: args => useHallConversationArchive({ ...args, storage })
    })
    globalThis.setTimeout = (fn, delay, ...args) => delay === 2500 ? 999 : oldTimeout(fn, delay, ...args)
    globalThis.clearTimeout = id => { if (id !== 999) oldClear(id) }
    const props = { enabled: true, identityKey: 'owner-recovered', conversationId: 'conversation-1',
      request: { requestId: 'request-1', conversationId: 'conversation-1' } }
    const clickSave = async wrapper => {
      await wrapper.findAll('button').find(button => button.text() === '保存到工作空间').trigger('click'); await flushPromises()
    }
    let wrapper
    try {
      wrapper = mount(Component, { props }); await flushPromises(); await clickSave(wrapper)
      expect(wrapper.text()).to.include('网络结果不明确')
      expect(calls).to.have.length(1)
      wrapper.unmount(); wrapper = mount(Component, { props }); await flushPromises()
      expect(calls).to.have.length(1)
      expect(wrapper.text()).to.include('先前的保存操作')
      await clickSave(wrapper)
      expect(calls.map(call => call.method)).to.deep.equal(['POST', 'POST', 'GET'])
      expect(calls[1].headers).to.deep.equal(calls[0].headers)
      expect(calls[1].data).to.deep.equal(calls[0].data)
      wrapper.unmount(); wrapper = mount(Component, { props }); await flushPromises(); await clickSave(wrapper)
      expect(calls.map(call => call.method)).to.deep.equal(['POST', 'POST', 'GET', 'GET'])
      expect(wrapper.text()).to.include('workspace-recovered v1')
      expect(stored.size).to.equal(1)
    } finally { wrapper?.unmount(); globalThis.setTimeout = oldTimeout; globalThis.clearTimeout = oldClear }
  })

  it('restores the locked original acceptance after remount and only explicitly replays after a read-only 404', async () => {
    const oldTimeout = globalThis.setTimeout; const oldClear = globalThis.clearTimeout
    const calls = []; let reads = 0
    const chatApi = { get: async path => {
      if (path === '/requests/request-1') return { data: { data: { requestId: 'request-1', conversationId: 'conversation-1',
        steps: [{ ...step('step-1'), taskId: 'task-1', assignmentRevision: '3' }] } } }
      if (path.endsWith('/steps/step-1/outputs')) return { data: { data: [item('step-1')] } }
      throw new Error(`unexpected GET ${path}`)
    } }
    const agentApi = { execute: async request => {
      calls.push(request)
      if (calls.length === 1) throw new TypeError('lost POST ACK')
      if (request.method === 'GET') { reads++; throw Object.assign(new Error('not visible yet'), { status: 404 }) }
      return { data: { data: { operationId: 'finalization-original', taskId: 'task-1', conversationId: 'conversation-1',
        state: 'completed', stateVersion: '5', stage: 'TASK_COMPLETED', expectedTaskVersion: '9', expectedAssignmentRevision: '3',
        selectedOutputs: request.data.selectedOutputs, deliveryId: 'delivery-original', deliveryState: 'accepted',
        taskState: 'completed', taskVersion: '12', errorCode: null, retryable: false } } }
    } }
    const Component = new Function('Vue', 'deps', script)(Vue, {
      createApi: base => base === '/agent' ? agentApi : chatApi, exactOutputId, outputCatalogItems, outputItemKey,
      previewKind, scopedExecutionSteps, downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery, useHallConversationArchive,
      useHallBountyFinalization, safeFinalizationVersion, readOutputRecovery, writeOutputRecovery, saveOutputBlob: () => {}
    })
    globalThis.setTimeout = (fn, delay, ...args) => delay === 2500 ? 999 : oldTimeout(fn, delay, ...args)
    globalThis.clearTimeout = id => { if (id !== 999) oldClear(id) }
    const props = { acceptance: true, enabled: true, identityKey: 'owner-finalization-recovery', taskVersion: '9', conversationId: 'conversation-1',
      request: { requestId: 'request-1', conversationId: 'conversation-1', stateVersion: '1' } }
    let wrapper
    try {
      wrapper = mount(Component, { props }); await flushPromises()
      expect(wrapper.find('input[type="checkbox"]').exists()).to.equal(false)
      await wrapper.find('.finalize-button').trigger('click'); await flushPromises()
      expect(calls).to.have.length(1)
      expect(wrapper.emitted('task-completed')).to.equal(undefined)
      await wrapper.setProps({ request: { ...props.request, stateVersion: '2' } }); await flushPromises()
      expect(calls).to.have.length(1)
      expect(wrapper.find('input[type="checkbox"]').exists()).to.equal(false)
      wrapper.unmount(); wrapper = mount(Component, { props: { ...props, taskVersion: '12' } }); await flushPromises()
      expect(calls).to.have.length(1)
      expect(wrapper.findAll('.bounty-output')).to.have.length(1)
      expect(wrapper.find('.finalize-button').text()).to.equal('继续验收')
      await wrapper.find('.finalize-status-button').trigger('click'); await flushPromises()
      expect(calls.map(call => call.method)).to.deep.equal(['POST', 'GET'])
      expect(wrapper.text()).not.to.include('需求已完成')
      await wrapper.find('.finalize-button').trigger('click'); await flushPromises()
      expect(reads).to.equal(2)
      expect(calls.map(call => call.method)).to.deep.equal(['POST', 'GET', 'GET', 'POST'])
      expect(calls[3].data).to.deep.equal(calls[0].data)
      expect(calls[3].headers).to.deep.equal(calls[0].headers)
      expect(wrapper.text()).to.include('需求已完成')
      expect(wrapper.text()).not.to.include('delivery-original')
      expect(wrapper.emitted('task-completed')).to.have.length(1)
      expect(wrapper.emitted('task-completed')[0][0].deliveryId).to.equal('delivery-original')
      expect(wrapper.text()).not.to.match(/幂等|原键|晋升/)
      expect(wrapper.find('.finalize-button').attributes()).to.have.property('disabled')
    } finally { wrapper?.unmount(); globalThis.setTimeout = oldTimeout; globalThis.clearTimeout = oldClear }
  })

  for (const [version, revision] of [['', '3'], ['01', '3'], ['9007199254740992', '3'], ['9', ''], ['9', '01']]) {
    it(`refuses unknown/noncanonical task=${JSON.stringify(version)} assignment=${JSON.stringify(revision)} versions before acceptance`, async () => {
      const oldTimeout = globalThis.setTimeout; const oldClear = globalThis.clearTimeout
      const writes = []
      const chatApi = { get: async path => {
        if (path === '/requests/request-1') return { data: { data: { requestId: 'request-1', conversationId: 'conversation-1',
          steps: [{ ...step('step-1'), taskId: 'task-1', assignmentRevision: revision }] } } }
        return { data: { data: [item('step-1')] } }
      } }
      const Component = new Function('Vue', 'deps', script)(Vue, {
        createApi: base => base === '/agent' ? { execute: async request => { writes.push(request) } } : chatApi,
        exactOutputId, outputCatalogItems, outputItemKey, previewKind, scopedExecutionSteps, downloadMimeType, outputDownloadName,
        currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery, useHallConversationArchive, useHallBountyFinalization, safeFinalizationVersion, readOutputRecovery,
        writeOutputRecovery, saveOutputBlob: () => {}
      })
      globalThis.setTimeout = (fn, delay, ...args) => delay === 2500 ? 999 : oldTimeout(fn, delay, ...args)
      globalThis.clearTimeout = id => { if (id !== 999) oldClear(id) }
      let wrapper
      try {
        wrapper = mount(Component, { props: { acceptance: true, enabled: true, identityKey: 'owner-version', taskVersion: version,
          conversationId: 'conversation-1', request: { requestId: 'request-1', conversationId: 'conversation-1' } } })
        await flushPromises(); expect(wrapper.find('input[type="checkbox"]').exists()).to.equal(false)
        await wrapper.find('.finalize-button').trigger('click'); await flushPromises()
        expect(writes).to.have.length(0); expect(wrapper.text()).to.include('版本无法安全确认')
      } finally { wrapper?.unmount(); globalThis.setTimeout = oldTimeout; globalThis.clearTimeout = oldClear }
    })
  }

  it('discovers two indexed output_1 drafts after a storage-free refresh while keeping the historical assignment read-only', async () => {
    const oldTimeout = globalThis.setTimeout; const oldClear = globalThis.clearTimeout
    const downloads = []; const output = (requestId, stepId) => {
      const url = `/chat/requests/${requestId}/steps/${stepId}/outputs/output_1`
      return { outputId: 'output_1', contentMimeType: 'image/png', sha256: zeroDigest, byteLength: 20,
        previewUrl: url, downloadUrl: `${url}?download=true`, assetRef: { assetId: `asset_${requestId}`, revision: '1' } }
    }
    const catalog = [
      { ordinal: '1', request: { requestId: 'request-old', conversationId: 'conversation-1',
        steps: [{ ...step('step-old'), taskId: 'task-1', targetAgentId: 'agent-old', assignmentRevision: '2' }] } },
      { ordinal: '2', request: { requestId: 'request-current', conversationId: 'conversation-1',
        steps: [{ ...step('step-current'), taskId: 'task-1', targetAgentId: 'agent-current', assignmentRevision: '3' }] } }
    ]
    const reads = []; const chatApi = { get: async path => {
      reads.push(path)
      if (path === '/requests/request-old') return { data: { data: catalog[0].request } }
      if (path === '/requests/request-current') return { data: { data: catalog[1].request } }
      if (path.endsWith('/steps/step-old/outputs')) return { data: { data: [output('request-old', 'step-old')] } }
      if (path.endsWith('/steps/step-current/outputs')) return { data: { data: [output('request-current', 'step-current')] } }
      throw new Error(`unexpected GET ${path}`)
    }, execute: async request => {
      expect(request.method).to.equal('GET')
      return { data: new Blob([new Uint8Array(20)], { type: 'image/png' }) }
    } }
    const Component = new Function('Vue', 'deps', script)(Vue, {
      createApi: () => chatApi, exactOutputId, outputCatalogItems, outputItemKey, previewKind, scopedExecutionSteps,
      downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery, useHallBountyFinalization, safeFinalizationVersion,
      useHallConversationArchive, readOutputRecovery, writeOutputRecovery, saveOutputBlob: value => downloads.push(value)
    })
    globalThis.setTimeout = (fn, delay, ...args) => delay === 2500 ? 999 : oldTimeout(fn, delay, ...args)
    globalThis.clearTimeout = id => { if (id !== 999) oldClear(id) }
    let wrapper
    try {
      wrapper = mount(Component, { props: { enabled: true, identityKey: 'owner-a', taskVersion: '9',
        conversationId: 'conversation-1', request: catalog[1].request, catalog } })
      await flushPromises()
      const cards = wrapper.findAll('.bounty-output')
      expect(cards).to.have.length(2)
      expect(reads).to.include.members(['/requests/request-old', '/requests/request-current'])
      expect(cards[0].find('input[type="checkbox"]').exists()).to.equal(false)
      expect(cards[0].find('.image-rework').exists()).to.equal(false)
      expect(cards[1].find('input[type="checkbox"]').exists()).to.equal(false)
      expect(wrapper.find('.finalize-button').exists()).to.equal(false)
      for (const card of cards) await card.findAll('button').find(button => button.text() === '下载').trigger('click')
      for (let attempt = 0; attempt < 20 && downloads.length < 2; attempt++) {
        await new Promise(resolve => oldTimeout(resolve, 5)); await flushPromises()
      }
      expect(downloads).to.have.length(2)
      expect(downloads.map(value => value.item.name)).to.deep.equal(['output_1.png', 'output_1.png'])
      expect(reads.filter(path => path.endsWith('/outputs')).sort()).to.deep.equal([
        '/requests/request-current/steps/step-current/outputs', '/requests/request-old/steps/step-old/outputs'
      ])
    } finally { wrapper?.unmount(); globalThis.setTimeout = oldTimeout; globalThis.clearTimeout = oldClear }
  })

  it('shows only the exact current delivery in task acceptance, pins it through late edits and remounts, and never saves first', async () => {
    const oldTimeout = globalThis.setTimeout; const oldClear = globalThis.clearTimeout
    const calls = []; let catalog = []; let addLate = false
    const output = (requestId, outputId, mime, replaces = null) => {
      const url = `/chat/requests/${requestId}/steps/step-1/outputs/${outputId}`
      return { outputId, contentMimeType: mime, sha256: zeroDigest, byteLength: 20, replaces,
        downloadUrl: `${url}?download=true`, previewUrl: mime === 'application/pdf' ? null : url }
    }
    const first = output('request-1', 'bird', 'image/png')
    const other = output('request-1', 'document', 'application/pdf')
    const parent = { requestId: 'request-1', stepId: 'step-1', outputId: 'bird', sha256: zeroDigest }
    const edit = output('request-edit', 'blue-bird', 'image/png', parent)
    const late = output('request-late', 'green-bird', 'image/png', { ...parent, requestId: 'request-edit', outputId: 'blue-bird' })
    const request = requestId => ({ requestId, conversationId: 'conversation-1', stateVersion: '1',
      steps: [{ ...step('step-1'), taskId: 'task-1', assignmentRevision: '3' }] })
    catalog = [{ ordinal: '1', request: request('request-1') }, { ordinal: '2', request: request('request-edit') }]
    const chatApi = { get: async path => {
      const source = [...catalog, ...(addLate ? [{ request: request('request-late') }] : [])].find(entry => path === `/requests/${entry.request.requestId}`)
      if (source) return { data: { data: source.request } }
      if (path === '/requests/request-1/steps/step-1/outputs') return { data: { data: [first, other] } }
      if (path === '/requests/request-edit/steps/step-1/outputs') return { data: { data: [edit] } }
      if (path === '/requests/request-late/steps/step-1/outputs') return { data: { data: [late] } }
      throw new Error(`unexpected source read ${path}`)
    }, execute: async () => { throw new Error('no archive or tool execution before acceptance') } }
    const agentApi = { execute: async payload => { calls.push(payload); throw new TypeError('unknown acceptance ACK') } }
    const Component = new Function('Vue', 'deps', script)(Vue, {
      createApi: base => base === '/agent' ? agentApi : chatApi, exactOutputId, outputCatalogItems, outputItemKey,
      previewKind, scopedExecutionSteps, downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery,
      useHallConversationArchive, useHallBountyFinalization, safeFinalizationVersion, saveOutputBlob: () => {}
    })
    globalThis.setTimeout = (fn, delay, ...args) => delay === 2500 ? 999 : oldTimeout(fn, delay, ...args)
    globalThis.clearTimeout = id => { if (id !== 999) oldClear(id) }
    const props = { acceptance: true, enabled: true, identityKey: 'owner-exact-delivery', taskVersion: '9',
      conversationId: 'conversation-1', request: catalog.at(-1).request, catalog }
    let wrapper
    try {
      wrapper = mount(Component, { props }); await flushPromises()
      expect(wrapper.findAll('.bounty-output')).to.have.length(2)
      expect(wrapper.findAll('input[type="checkbox"]')).to.have.length(0)
      await wrapper.find('.continue-modification').trigger('click')
      expect(wrapper.emitted('continue-modification')).to.deep.equal([[]]); expect(calls).to.have.length(0)
      await wrapper.find('.finalize-button').trigger('click'); await flushPromises()
      expect(calls).to.have.length(1)
      expect(calls[0].data.selectedOutputs.map(source => source.outputId)).to.deep.equal(['blue-bird', 'document'])
      addLate = true; catalog = [...catalog, { ordinal: '3', request: request('request-late') }]
      await wrapper.setProps({ catalog, request: catalog.at(-1).request }); await flushPromises()
      expect(wrapper.findAll('.bounty-output')).to.have.length(2)
      expect(wrapper.findAll('.bounty-output')[0].text()).to.include('改稿关联：bird')
      expect(wrapper.findAll('.bounty-output')[0].text()).not.to.include('改稿关联：blue-bird')
      expect(calls).to.have.length(1)
      wrapper.unmount(); wrapper = mount(Component, { props: { ...props, catalog, request: catalog.at(-1).request } }); await flushPromises()
      expect(wrapper.findAll('.bounty-output')[0].text()).to.include('改稿关联：bird')
      expect(calls).to.have.length(1)
    } finally { wrapper?.unmount(); globalThis.setTimeout = oldTimeout; globalThis.clearTimeout = oldClear }
  })

  it('renders an explicit real text final and submits original message refs without tools or saving, including remount', async () => {
    const raw = JSON.parse(readFileSync(new URL('./fixtures/juyiting/completed-message-delivery-v3.json', import.meta.url), 'utf8'))
    const request = { requestId: raw.requestId, requestRevision: raw.requestRevision, conversationId: raw.conversationId,
      conversationGeneration: raw.conversationGeneration, state: 'COMPLETED', stateVersion: '1', steps: [], turns: [{
        turnId: raw.turnId, requestId: raw.requestId, requestRevision: raw.requestRevision, conversationId: raw.conversationId,
        conversationGeneration: raw.conversationGeneration, route: 'CHAT', state: 'FINAL_PERSISTED',
        finalMessageId: raw.outcome.assistantMessageId, contextSnapshotId: raw.outcome.messageSource.snapshotId }] }
    const oldTimeout = globalThis.setTimeout; const oldClear = globalThis.clearTimeout
    const calls = []; const reads = []; const downloads = []
    const chatApi = { get: async path => {
      reads.push(path)
      if (path === `/requests/${raw.requestId}`) return { data: { data: request } }
      if (path === `/conversations/${raw.conversationId}/requests/${raw.requestId}/typed-outcome`) return { data: { data: raw } }
      throw new Error(`unexpected read ${path}`)
    }, execute: async () => { throw new Error('no fake output bytes, tools, archive or personal-space prerequisite') } }
    const agentApi = { execute: async options => { calls.push(options); throw new TypeError('unknown ACK') } }
    const Component = new Function('Vue', 'deps', script)(Vue, {
      createApi: base => base === '/agent' ? agentApi : chatApi, exactOutputId, outputCatalogItems, outputItemKey, previewKind,
      scopedExecutionSteps, downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery,
      useHallConversationArchive, useHallBountyFinalization, safeFinalizationVersion, saveOutputBlob: value => downloads.push(value)
    })
    globalThis.setTimeout = (fn, delay, ...args) => delay === 2500 ? 999 : oldTimeout(fn, delay, ...args)
    globalThis.clearTimeout = id => { if (id !== 999) oldClear(id) }
    const props = { enabled: true, acceptance: true, taskId: 'task', taskVersion: '9', conversationId: raw.conversationId,
      identityKey: 'owner-text-page', request, catalog: [{ ordinal: '1', request }] }
    let wrapper
    try {
      wrapper = mount(Component, { props }); await flushPromises()
      for (let i = 0; i < 20 && !wrapper.find('.bounty-output-text').exists(); i++) {
        await new Promise(resolve => oldTimeout(resolve, 5)); await flushPromises()
      }
      expect(wrapper.findAll('.bounty-output')).to.have.length(1)
      expect(wrapper.find('.bounty-output-text').text()).to.equal(raw.outcome.text)
      expect(wrapper.findAll('input[type="checkbox"]')).to.have.length(0)
      expect(calls).to.have.length(0)
      const download = wrapper.findAll('.bounty-output button').find(button => button.text() === '下载')
      await download.trigger('click'); await flushPromises()
      expect(downloads).to.have.length(1)
      expect(downloads[0].item.name).to.equal('文字成果.txt')
      expect(downloads[0].blob.size).to.equal(Buffer.byteLength(raw.outcome.text))
      await wrapper.find('.finalize-button').trigger('click'); await flushPromises()
      expect(calls).to.have.length(1)
      const original = calls[0].data.selectedOutputs[0]
      expect(original.messageSource).to.deep.equal(raw.outcome.messageSource)
      expect(original.sha256).to.equal(createHash('sha256').update(raw.outcome.text).digest('hex'))
      expect(Object.hasOwn(original, 'stepId')).to.equal(false); expect(Object.hasOwn(original, 'outputId')).to.equal(false)
      expect(reads.some(path => path.endsWith('/outputs'))).to.equal(false)
      wrapper.unmount(); wrapper = mount(Component, { props }); await flushPromises()
      // The original text hash is recomputed asynchronously from the read-only persisted final.
      for (let i = 0; i < 20 && !wrapper.find('.bounty-output-text').exists(); i++) {
        await new Promise(resolve => oldTimeout(resolve, 5)); await flushPromises()
      }
      expect(wrapper.find('.bounty-output-text').text()).to.equal(raw.outcome.text)
      expect(calls).to.have.length(1)
      expect(wrapper.text()).to.include('本次验收已冻结 1 项')
      await wrapper.find('.continue-modification').trigger('click')
      expect(wrapper.emitted('continue-modification')).to.deep.equal([[]])
    } finally { wrapper?.unmount(); globalThis.setTimeout = oldTimeout; globalThis.clearTimeout = oldClear }
  })

  it('renders API-generated text append/replace/reset and freezes exactly the displayed source list on acceptance', async () => {
    const groups = JSON.parse(readFileSync(new URL('./fixtures/juyiting/text-delivery-relations-v3.json', import.meta.url), 'utf8'))
    const oldTimeout = globalThis.setTimeout; const oldClear = globalThis.clearTimeout
    globalThis.setTimeout = (fn, delay, ...args) => delay === 2500 ? 999 : oldTimeout(fn, delay, ...args)
    globalThis.clearTimeout = id => { if (id !== 999) oldClear(id) }
    let wrapper
    try {
      for (const group of groups) {
        const sources = [group.updated, group.initial]
        const requests = sources.map(raw => ({ requestId: raw.requestId, requestRevision: raw.requestRevision, conversationId: raw.conversationId,
          conversationGeneration: raw.conversationGeneration, state: 'COMPLETED', stateVersion: '1', steps: [], turns: [{
            turnId: raw.turnId, requestId: raw.requestId, requestRevision: raw.requestRevision, conversationId: raw.conversationId,
            conversationGeneration: raw.conversationGeneration, route: 'CHAT', state: 'FINAL_PERSISTED',
            finalMessageId: raw.outcome.assistantMessageId, contextSnapshotId: raw.outcome.messageSource.snapshotId }] }))
        const calls = []
        const chatApi = { get: async path => {
          const request = requests.find(request => path === `/requests/${request.requestId}`)
          if (request) return { data: { data: request } }
          const raw = sources.find(raw => path === `/conversations/${raw.conversationId}/requests/${raw.requestId}/typed-outcome`)
          if (raw) return { data: { data: raw } }
          throw new Error(`unexpected source read ${path}`)
        }, execute: async () => { throw new Error('must not execute tools or invent output files') } }
        const agentApi = { execute: async options => { calls.push(options); throw new TypeError('unknown acceptance ACK') } }
        const Component = new Function('Vue', 'deps', script)(Vue, {
          createApi: base => base === '/agent' ? agentApi : chatApi, exactOutputId, outputCatalogItems, outputItemKey, previewKind,
          scopedExecutionSteps, downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery,
          useHallConversationArchive, useHallBountyFinalization, safeFinalizationVersion, saveOutputBlob: () => {}
        })
        const props = { enabled: true, acceptance: true, taskId: 'task', taskVersion: '9', conversationId: '42', identityKey: `owner-text-${group.mode}`,
          request: requests[0], catalog: requests.map(request => ({ request })) }
        wrapper = mount(Component, { props }); await flushPromises()
        const count = group.mode === 'APPEND' ? 2 : 1
        for (let i = 0; i < 20 && wrapper.findAll('.bounty-output-text').length !== count; i++) {
          await new Promise(resolve => oldTimeout(resolve, 5)); await flushPromises()
        }
        expect(wrapper.findAll('.bounty-output-text'), group.mode).to.have.length(count)
        expect(wrapper.findAll('.bounty-output-text').at(-1).text()).to.equal('修改原文')
        await wrapper.find('.finalize-button').trigger('click'); await flushPromises()
        const selected = calls[0].data.selectedOutputs
        expect(selected.map(item => item.requestId)).to.deep.equal(group.mode === 'APPEND' ? ['request', 'child'] : ['child'])
        expect(selected.at(-1).messageSource).to.deep.equal(group.updated.outcome.messageSource)
        expect(selected.at(-1).sha256).to.equal(createHash('sha256').update(group.updated.outcome.text).digest('hex'))
        expect(calls).to.have.length(1)
        wrapper.unmount(); wrapper = mount(Component, { props }); await flushPromises()
        for (let i = 0; i < 20 && wrapper.findAll('.bounty-output-text').length !== count; i++) {
          await new Promise(resolve => oldTimeout(resolve, 5)); await flushPromises()
        }
        expect(wrapper.findAll('.bounty-output-text')).to.have.length(count)
        expect(calls).to.have.length(1); expect(wrapper.text()).to.include(`本次验收已冻结 ${count} 项`)
        wrapper.unmount(); wrapper = null
      }
    } finally { wrapper?.unmount(); globalThis.setTimeout = oldTimeout; globalThis.clearTimeout = oldClear }
  })

  it('renders clarified text chains and preserves exact displayed sources through unknown acceptance and remount', async () => {
    const groups = JSON.parse(readFileSync(new URL('./fixtures/juyiting/clarified-text-delivery-v3.json', import.meta.url), 'utf8'))
    const oldTimeout = globalThis.setTimeout; const oldClear = globalThis.clearTimeout
    globalThis.setTimeout = (fn, delay, ...args) => delay === 2500 ? 999 : oldTimeout(fn, delay, ...args)
    globalThis.clearTimeout = id => { if (id !== 999) oldClear(id) }
    let wrapper
    try {
      for (const group of groups) {
        const sources = [group.updated, ...group.clarifications, group.initial]
        const requests = sources.map(raw => ({ requestId: raw.requestId, requestRevision: raw.requestRevision, conversationId: raw.conversationId,
          conversationGeneration: raw.conversationGeneration, state: 'COMPLETED', stateVersion: '1', steps: [], turns: [{
            turnId: raw.turnId, requestId: raw.requestId, requestRevision: raw.requestRevision, conversationId: raw.conversationId,
            conversationGeneration: raw.conversationGeneration, route: 'CHAT', state: 'FINAL_PERSISTED',
            finalMessageId: raw.outcome.assistantMessageId, contextSnapshotId: raw.outcome.messageSource?.snapshotId }] }))
        const calls = []
        const chatApi = { get: async path => {
          const request = requests.find(request => path === `/requests/${request.requestId}`)
          if (request) return { data: { data: request } }
          const raw = sources.find(raw => path === `/conversations/${raw.conversationId}/requests/${raw.requestId}/typed-outcome`)
          if (raw) return { data: { data: raw } }
          throw new Error(`unexpected source read ${path}`)
        }, execute: async () => { throw new Error('must not execute tools or invent output files') } }
        const agentApi = { execute: async options => { calls.push(options); throw new TypeError('unknown acceptance ACK') } }
        const Component = new Function('Vue', 'deps', script)(Vue, {
          createApi: base => base === '/agent' ? agentApi : chatApi, exactOutputId, outputCatalogItems, outputItemKey, previewKind,
          scopedExecutionSteps, downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery,
          useHallConversationArchive, useHallBountyFinalization, safeFinalizationVersion, saveOutputBlob: () => {}
        })
        const props = { enabled: true, acceptance: true, taskId: 'task', taskVersion: '9', conversationId: '42', identityKey: `owner-clarified-text-${group.mode}`,
          request: requests[0], catalog: requests.map(request => ({ request })) }
        wrapper = mount(Component, { props }); await flushPromises()
        const count = group.mode === 'APPEND' ? 2 : 1
        for (let i = 0; i < 20 && wrapper.findAll('.bounty-output-text').length !== count; i++) {
          await new Promise(resolve => oldTimeout(resolve, 5)); await flushPromises()
        }
        expect(wrapper.findAll('.bounty-output-text'), group.mode).to.have.length(count)
        expect(wrapper.findAll('.bounty-output-text').at(-1).text()).to.equal('澄清后的文字')
        await wrapper.find('.finalize-button').trigger('click'); await flushPromises()
        const selected = calls[0].data.selectedOutputs
        expect(selected.map(item => item.requestId)).to.deep.equal(group.mode === 'APPEND' ? ['request', 'clarified'] : ['clarified'])
        expect(selected.at(-1).messageSource).to.deep.equal(group.updated.outcome.messageSource)
        expect(selected.at(-1).sha256).to.equal(createHash('sha256').update(group.updated.outcome.text).digest('hex'))
        expect(calls).to.have.length(1)
        wrapper.unmount(); wrapper = mount(Component, { props }); await flushPromises()
        for (let i = 0; i < 20 && wrapper.findAll('.bounty-output-text').length !== count; i++) {
          await new Promise(resolve => oldTimeout(resolve, 5)); await flushPromises()
        }
        expect(wrapper.findAll('.bounty-output-text')).to.have.length(count)
        expect(calls).to.have.length(1); expect(wrapper.text()).to.include(`本次验收已冻结 ${count} 项`)
        wrapper.unmount(); wrapper = null
      }
    } finally { wrapper?.unmount(); globalThis.setTimeout = oldTimeout; globalThis.clearTimeout = oldClear }
  })

  it('renders an earlier replacement and retains the appended item through exact unknown acceptance and remount', async () => {
    const groups = [JSON.parse(readFileSync(new URL('./fixtures/juyiting/retained-text-delivery-v3.json', import.meta.url), 'utf8'))]
    const oldTimeout = globalThis.setTimeout; const oldClear = globalThis.clearTimeout
    globalThis.setTimeout = (fn, delay, ...args) => delay === 2500 ? 999 : oldTimeout(fn, delay, ...args)
    globalThis.clearTimeout = id => { if (id !== 999) oldClear(id) }
    let wrapper
    try {
      for (const group of groups) {
        const sources = [group.updated, group.question, group.appended, group.initial]
        const requests = sources.map(raw => ({ requestId: raw.requestId, requestRevision: raw.requestRevision, conversationId: raw.conversationId,
          conversationGeneration: raw.conversationGeneration, state: 'COMPLETED', stateVersion: '1', steps: [], turns: [{
            turnId: raw.turnId, requestId: raw.requestId, requestRevision: raw.requestRevision, conversationId: raw.conversationId,
            conversationGeneration: raw.conversationGeneration, route: 'CHAT', state: 'FINAL_PERSISTED',
            finalMessageId: raw.outcome.assistantMessageId, contextSnapshotId: raw.outcome.messageSource?.snapshotId }] }))
        const calls = []
        const chatApi = { get: async path => {
          const request = requests.find(request => path === `/requests/${request.requestId}`)
          if (request) return { data: { data: request } }
          const raw = sources.find(raw => path === `/conversations/${raw.conversationId}/requests/${raw.requestId}/typed-outcome`)
          if (raw) return { data: { data: raw } }
          throw new Error(`unexpected source read ${path}`)
        }, execute: async () => { throw new Error('must not execute tools or invent output files') } }
        const agentApi = { execute: async options => { calls.push(options); throw new TypeError('unknown acceptance ACK') } }
        const Component = new Function('Vue', 'deps', script)(Vue, {
          createApi: base => base === '/agent' ? agentApi : chatApi, exactOutputId, outputCatalogItems, outputItemKey, previewKind,
          scopedExecutionSteps, downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery,
          useHallConversationArchive, useHallBountyFinalization, safeFinalizationVersion, saveOutputBlob: () => {}
        })
        const props = { enabled: true, acceptance: true, taskId: 'task', taskVersion: '9', conversationId: '42', identityKey: 'owner-retained-earlier-text',
          request: requests[0], catalog: requests.map(request => ({ request })) }
        wrapper = mount(Component, { props }); await flushPromises()
        const count = 2
        for (let i = 0; i < 20 && wrapper.findAll('.bounty-output-text').length !== count; i++) {
          await new Promise(resolve => oldTimeout(resolve, 5)); await flushPromises()
        }
        expect(wrapper.findAll('.bounty-output-text'), group.mode).to.have.length(count)
        expect(wrapper.findAll('.bounty-output-text').at(-1).text()).to.equal('澄清后的文字')
        await wrapper.find('.finalize-button').trigger('click'); await flushPromises()
        const selected = calls[0].data.selectedOutputs
        expect(selected.map(item => item.requestId)).to.deep.equal(['earlier-edit', 'append'])
        expect(selected[0].messageSource).to.deep.equal(group.updated.outcome.messageSource)
        expect(selected[0].sha256).to.equal(createHash('sha256').update(group.updated.outcome.text).digest('hex'))
        expect(selected[1].messageSource).to.deep.equal(group.appended.outcome.messageSource)
        expect(selected[1].sha256).to.equal(createHash('sha256').update(group.appended.outcome.text).digest('hex'))
        expect(selected.some(item => item.requestId === group.initial.requestId)).to.equal(false)
        expect(calls).to.have.length(1)
        wrapper.unmount(); wrapper = mount(Component, { props }); await flushPromises()
        for (let i = 0; i < 20 && wrapper.findAll('.bounty-output-text').length !== count; i++) {
          await new Promise(resolve => oldTimeout(resolve, 5)); await flushPromises()
        }
        expect(wrapper.findAll('.bounty-output-text')).to.have.length(count)
        expect(calls).to.have.length(1); expect(wrapper.text()).to.include(`本次验收已冻结 ${count} 项`)
        wrapper.unmount(); wrapper = null
      }
    } finally { wrapper?.unmount(); globalThis.setTimeout = oldTimeout; globalThis.clearTimeout = oldClear }
  })

  it('does not offer fake acceptance for empty, unrelated, or ambiguous deliverables', async () => {
    const oldTimeout = globalThis.setTimeout; const oldClear = globalThis.clearTimeout
    const chatApi = { get: async path => path === '/requests/request-1'
      ? { data: { data: { requestId: 'request-1', conversationId: 'conversation-1', steps: [step('step-1'), step('step-2')] } } }
      : { data: { data: [item(path.includes('step-1') ? 'step-1' : 'step-2')] } } }
    const Component = new Function('Vue', 'deps', script)(Vue, {
      createApi: () => chatApi, exactOutputId, outputCatalogItems, outputItemKey, previewKind, scopedExecutionSteps,
      downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery,
      useHallConversationArchive, useHallBountyFinalization, safeFinalizationVersion, saveOutputBlob: () => {}
    })
    globalThis.setTimeout = (fn, delay, ...args) => delay === 2500 ? 999 : oldTimeout(fn, delay, ...args)
    globalThis.clearTimeout = id => { if (id !== 999) oldClear(id) }
    let wrapper
    try {
      wrapper = mount(Component, { props: { acceptance: true, enabled: true, identityKey: 'owner-empty', conversationId: 'conversation-1' } })
      await flushPromises(); expect(wrapper.find('.finalize-button').exists()).to.equal(false)
      await wrapper.setProps({ request: { requestId: 'request-1', conversationId: 'conversation-1' } }); await flushPromises()
      expect(wrapper.text()).to.include('本次交付范围尚不明确')
      expect(wrapper.find('.finalize-button').exists()).to.equal(false)
      expect(wrapper.findAll('.bounty-output')).to.have.length(0)
    } finally { wrapper?.unmount(); globalThis.setTimeout = oldTimeout; globalThis.clearTimeout = oldClear }
  })

  for (const group of JSON.parse(readFileSync(new URL('./fixtures/juyiting/execution-batch-delivery-v3.json', import.meta.url), 'utf8'))) {
    it(`mounted API ${group.mode} text/media delivery freezes exact shown refs on unknown ACK and remount`, async () => {
      const request = raw => ({ requestId: raw.requestId, requestRevision: raw.requestRevision, conversationId: raw.conversationId,
        conversationGeneration: raw.conversationGeneration, state: 'COMPLETED', steps: [], turns: [{ turnId: raw.turnId,
          requestId: raw.requestId, requestRevision: raw.requestRevision, conversationId: raw.conversationId,
          conversationGeneration: raw.conversationGeneration, targetAgentId: 'agent', route: 'CHAT', state: 'FINAL_PERSISTED',
          finalMessageId: raw.outcome.assistantMessageId, contextSnapshotId: raw.outcome.messageSource?.snapshotId || `${raw.requestId}-snapshot` }] })
      const initial = request(group.initial); const action = request(group.completed)
      const child = { requestId: group.completed.actionProgress.childRequestId, requestRevision: '1', conversationId: '42', conversationGeneration: '1',
        state: 'OUTPUT_COMMITTED', stateVersion: group.completed.actionProgress.childStateVersion, turns: [],
        steps: [{ stepId: 'batch-step', executionId: 'fixture-execution', kind: 'EXECUTE', state: 'OUTPUT_COMMITTED', executionState: 'OUTPUT_COMMITTED',
          taskId: 'task', targetAgentId: 'agent', assignmentRevision: '3' }] }
      const outputs = ['bird', 'tree'].map(outputId => { const url = `/chat/requests/${child.requestId}/steps/batch-step/outputs/${outputId}`
        return { outputId, sha256: zeroDigest, byteLength: 20, contentMimeType: 'image/png', previewUrl: url, downloadUrl: `${url}?download=true`, assetRef: null } })
      let addLate = false; const late = { ...child, requestId: 'unlinked-late' }
      const snapshots = [initial, action, child]; const reads = []; const writes = []
      const api = { get: async path => { reads.push(path)
        if (path.endsWith('/typed-outcome')) return { data: { data: path.includes('/batch-action/') ? group.completed : group.initial } }
        if (path.endsWith('/outputs')) return { data: { data: path.includes('/unlinked-late/') ? outputs.map(value => ({ ...value,
          previewUrl: value.previewUrl.replace(child.requestId, 'unlinked-late'), downloadUrl: value.downloadUrl.replace(child.requestId, 'unlinked-late') })) : outputs } }
        const snapshot = [...snapshots, ...(addLate ? [late] : [])].find(value => path === `/requests/${value.requestId}`)
        if (snapshot) return { data: { data: snapshot } }
        throw new Error('unexpected GET ' + path)
      } }
      const agentApi = { execute: async value => {
        if (value.method === 'GET') { reads.push(value.url); throw { response: { status: 404 } } }
        writes.push(value); throw new TypeError('unknown original ACK')
      } }
      const Component = new Function('Vue', 'deps', script)(Vue, {
        createApi: base => base === '/agent' ? agentApi : api, exactOutputId, outputCatalogItems, outputItemKey, previewKind, scopedExecutionSteps,
        downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery,
        useHallConversationArchive, useHallBountyFinalization, safeFinalizationVersion, saveOutputBlob: () => {}
      })
      const oldTimeout = globalThis.setTimeout; const oldClear = globalThis.clearTimeout
      globalThis.setTimeout = (fn, delay, ...args) => delay === 2500 ? 999 : oldTimeout(fn, delay, ...args)
      globalThis.clearTimeout = id => { if (id !== 999) oldClear(id) }
      let catalog = snapshots.map((request, index) => ({ ordinal: String(index + 1), request }))
      const props = { enabled: true, acceptance: true, taskId: 'task', taskVersion: '9', conversationId: '42', identityKey: `owner-batch-${group.mode}`,
        request: child, catalog }
      const count = group.mode === 'APPEND' ? 3 : 2
      let wrapper
      const settle = async () => { for (let i = 0; i < 30 && wrapper.findAll('.bounty-output').length !== count; i++) {
        await new Promise(resolve => oldTimeout(resolve, 5)); await flushPromises()
      } }
      try {
        wrapper = mount(Component, { props }); await flushPromises(); await settle()
        expect(wrapper.findAll('.bounty-output')).to.have.length(count)
        expect(wrapper.findAll('.bounty-output-text')).to.have.length(group.mode === 'APPEND' ? 1 : 0)
        expect(wrapper.findAll('.bounty-output').some(item => item.text().includes(group.completed.outcome.text))).to.equal(false)
        expect(writes).to.have.length(0)
        await wrapper.find('.finalize-button').trigger('click'); await flushPromises()
        expect(writes).to.have.length(1)
        const original = JSON.parse(JSON.stringify(writes[0].data)); const key = writes[0].headers['Idempotency-Key']
        const selected = original.selectedOutputs
        if (group.mode === 'APPEND') {
          expect(selected[0].messageSource).to.deep.equal(group.initial.outcome.messageSource)
          expect(selected[0].sha256).to.equal(createHash('sha256').update(group.initial.outcome.text).digest('hex'))
          expect(Object.hasOwn(selected[0], 'stepId')).to.equal(false)
        }
        expect(selected.slice(-2).map(item => [item.requestId, item.stepId, item.outputId, item.sha256])).to.deep.equal(
          outputs.map(item => [child.requestId, 'batch-step', item.outputId, item.sha256]))
        addLate = true; catalog = [...catalog, { ordinal: '4', request: late }]
        await wrapper.setProps({ catalog, request: late }); await flushPromises(); await settle()
        expect(wrapper.findAll('.bounty-output')).to.have.length(count); expect(writes).to.have.length(1)
        wrapper.unmount(); wrapper = mount(Component, { props: { ...props, catalog, request: late } }); await flushPromises(); await settle()
        expect(wrapper.findAll('.bounty-output')).to.have.length(count); expect(writes).to.have.length(1)
        await wrapper.find('.finalize-button').trigger('click'); await flushPromises()
        expect(writes).to.have.length(2); expect(writes[1].data).to.deep.equal(original)
        expect(writes[1].headers['Idempotency-Key']).to.equal(key)
        expect(reads.filter(path => path.endsWith('/outputs'))).not.to.have.length(0)
      } finally { wrapper?.unmount(); globalThis.setTimeout = oldTimeout; globalThis.clearTimeout = oldClear }
    })
  }

})
