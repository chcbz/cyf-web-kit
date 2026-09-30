import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import * as Vue from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { compileScript, parse } from '@vue/compiler-sfc'
import { exactOutputId, outputCatalogItems, outputItemKey, previewKind, scopedExecutionSteps, downloadMimeType, outputDownloadName, outputAssetPart } from '../src/composables/juyiting/bountyOutputCatalog.js'
import { readOutputRecovery, writeOutputRecovery } from '../src/composables/juyiting/bountyOutputRecovery.js'
import { useHallConversationArchive } from '../src/composables/juyiting/useHallConversationArchive.js'
import { useHallBountyFinalization, safeFinalizationVersion } from '../src/composables/juyiting/useHallBountyFinalization.js'

const filename = new URL('../src/components/juyiting/BountyExecutionOutputs.vue', import.meta.url).pathname
const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
const script = compileScript(descriptor, { id: 'hall-bounty-live-output-test', inlineTemplate: true }).content
  .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm,
    (_, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
  .replace(/^import\s+\{\s*createApi\s*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var { createApi } = deps')
  .replace(/^import\s+\{\s*exactOutputId,[^}]+\}\s+from\s+['"][^'"]+['"];?\s*$/gm,
    'var { exactOutputId, outputCatalogItems, outputItemKey, previewKind, scopedExecutionSteps, downloadMimeType, outputDownloadName, outputAssetPart } = deps')
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
      previewKind, scopedExecutionSteps, downloadMimeType, outputDownloadName, outputAssetPart, useHallBountyFinalization, safeFinalizationVersion, useHallConversationArchive, readOutputRecovery, writeOutputRecovery, saveOutputBlob: () => {}
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
  it('reuses the original edit intent after an unknown response and restores the follow-up catalog after remount', async () => {
    const oldTimeout = globalThis.setTimeout
    const oldClear = globalThis.clearTimeout
    let recovery = { followups: [], edits: {} }
    const writes = []; const reads = []
    let attempts = 0
    const chatApi = { get: async path => {
      reads.push(path)
      if (path === '/requests/request-1') return { data: { data: { requestId: 'request-1', conversationId: 'conversation-1',
        steps: [{ ...step('step-1'), taskId: 'task-1', assignmentRevision: '3' }] } } }
      if (path === '/requests/request-2') return { data: { data: { requestId: 'request-2', conversationId: 'conversation-1', steps: [] } } }
      if (path.endsWith('/steps/step-1/outputs')) return { data: { data: [item('step-1')] } }
      throw new Error(`unexpected GET ${path}`)
    }, execute: async payload => {
      if (payload.url !== '/conversations/conversation-1/interactions') throw new Error('unexpected write')
      writes.push(payload)
      if (++attempts === 1) throw new TypeError('unknown network response')
      return { data: { data: { requestId: 'request-2', stepId: 'step-2' } } }
    } }
    const Component = new Function('Vue', 'deps', script)(Vue, {
      createApi: () => chatApi, exactOutputId, outputCatalogItems, outputItemKey, previewKind, scopedExecutionSteps, downloadMimeType, outputDownloadName, outputAssetPart, useHallBountyFinalization, safeFinalizationVersion, useHallConversationArchive,
      readOutputRecovery: () => structuredClone(recovery),
      writeOutputRecovery: (_scope, value) => { recovery = JSON.parse(JSON.stringify(value)); return true }, saveOutputBlob: () => {}
    })
    globalThis.setTimeout = (fn, delay, ...args) => delay === 2500 ? 999 : oldTimeout(fn, delay, ...args)
    globalThis.clearTimeout = id => { if (id !== 999) oldClear(id) }
    const props = { enabled: true, identityKey: 'owner-a', conversationId: 'conversation-1',
      request: { requestId: 'request-1', conversationId: 'conversation-1' } }
    let wrapper
    try {
      wrapper = mount(Component, { props })
      await flushPromises()
      await wrapper.find('.image-rework input').setValue('改成蓝色')
      await wrapper.find('.image-rework').trigger('submit')
      await flushPromises()
      expect(writes).to.have.length(1)
      expect(wrapper.text()).to.include('修改结果不明确')
      expect(Object.keys(recovery.edits)).to.have.length(1)
      wrapper.unmount()
      wrapper = mount(Component, { props })
      await flushPromises()
      expect(wrapper.find('.image-rework button').text()).to.equal('重试原修改')
      expect(wrapper.find('.image-rework input').element.readOnly).to.equal(true)
      expect(wrapper.find('.image-rework input').element.value).to.equal('改成蓝色')
      await wrapper.find('.image-rework').trigger('submit')
      await flushPromises()
      expect(writes).to.have.length(2)
      expect(writes[1].headers['Idempotency-Key']).to.equal(writes[0].headers['Idempotency-Key'])
      expect(writes[1].data).to.deep.equal(writes[0].data)
      expect(recovery.followups).to.deep.equal(['request-2'])
      expect(recovery.edits).to.deep.equal({})
      wrapper.unmount()
      wrapper = mount(Component, { props })
      await flushPromises()
      expect(reads).to.include('/requests/request-2')
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
      previewKind, scopedExecutionSteps, downloadMimeType, outputDownloadName, outputAssetPart, useHallBountyFinalization, safeFinalizationVersion, useHallConversationArchive, readOutputRecovery, writeOutputRecovery,
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
    const agentApi = { execute: async request => { submitted = request; return { data: { data: {
      operationId: 'finalization-1', taskId: 'task-1', conversationId: 'conversation-1', state: 'completed',
      stateVersion: '5', stage: 'TASK_COMPLETED', expectedTaskVersion: '9', expectedAssignmentRevision: '3',
      selectedOutputs: request.data.selectedOutputs, deliveryId: 'delivery-1', deliveryState: 'accepted',
      taskState: 'completed', taskVersion: '12', errorCode: null, retryable: false } } } } }
    const Component = new Function('Vue', 'deps', script)(Vue, {
      createApi: base => base === '/agent' ? agentApi : chatApi, exactOutputId, outputCatalogItems, outputItemKey,
      previewKind, scopedExecutionSteps, downloadMimeType, outputDownloadName, outputAssetPart, useHallBountyFinalization, safeFinalizationVersion, useHallConversationArchive, readOutputRecovery, writeOutputRecovery, saveOutputBlob: () => {}
    })
    globalThis.setTimeout = (fn, delay, ...args) => delay === 2500 ? 999 : oldTimeout(fn, delay, ...args)
    globalThis.clearTimeout = id => { if (id !== 999) oldClear(id) }
    let wrapper
    try {
      wrapper = mount(Component, { props: { enabled: true, identityKey: 'owner-a', taskVersion: '9',
        conversationId: 'conversation-1', request: { requestId: 'request-1', conversationId: 'conversation-1' } } })
      await flushPromises()
      await wrapper.find('input[type="checkbox"]').setValue(true)
      await wrapper.find('.finalize-button').trigger('click')
      await flushPromises()
      expect(submitted.data.expectedTaskVersion).to.equal(9)
      expect(submitted.data.expectedAssignmentRevision).to.equal(3)
      expect(wrapper.text()).to.include('需求已完成')
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
      previewKind, scopedExecutionSteps, downloadMimeType, outputDownloadName, outputAssetPart, useHallBountyFinalization, safeFinalizationVersion, useHallConversationArchive, readOutputRecovery, writeOutputRecovery, saveOutputBlob: () => {}
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
      previewKind, scopedExecutionSteps, downloadMimeType, outputDownloadName, outputAssetPart, useHallBountyFinalization, safeFinalizationVersion, useHallConversationArchive, readOutputRecovery, writeOutputRecovery, saveOutputBlob: () => {}
    })
    globalThis.setTimeout = (fn, delay, ...args) => delay === 2500 ? 999 : oldTimeout(fn, delay, ...args)
    globalThis.clearTimeout = id => { if (id !== 999) oldClear(id) }
    let wrapper
    try {
      wrapper = mount(Component, { props: { enabled: true, identityKey: 'owner-a', taskVersion: '9',
        conversationId: 'conversation-1', request: { requestId: 'request-1', conversationId: 'conversation-1' } } })
      await flushPromises()
      await wrapper.find('input[type="checkbox"]').setValue(true)
      await wrapper.find('.finalize-button').trigger('click')
      await flushPromises()
      expect(wrapper.text()).to.include('正在确认原验收操作')
      await wrapper.setProps({ identityKey: 'owner-b' })
      await flushPromises()
      finishWrite({ data: { data: { stage: 'TASK_COMPLETED', deliveryState: 'accepted', deliveryId: 'delivery-a' } } })
      await flushPromises()
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
      previewKind, scopedExecutionSteps, downloadMimeType, outputDownloadName, outputAssetPart, useHallBountyFinalization, safeFinalizationVersion, useHallConversationArchive,
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
      downloadMimeType, outputDownloadName, outputAssetPart, useHallBountyFinalization, safeFinalizationVersion, readOutputRecovery, writeOutputRecovery, saveOutputBlob: () => {},
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
      downloadMimeType, outputDownloadName, outputAssetPart, useHallBountyFinalization, safeFinalizationVersion, readOutputRecovery, writeOutputRecovery, saveOutputBlob: () => {},
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
      previewKind, scopedExecutionSteps, downloadMimeType, outputDownloadName, outputAssetPart, useHallConversationArchive,
      useHallBountyFinalization, safeFinalizationVersion, readOutputRecovery, writeOutputRecovery, saveOutputBlob: () => {}
    })
    globalThis.setTimeout = (fn, delay, ...args) => delay === 2500 ? 999 : oldTimeout(fn, delay, ...args)
    globalThis.clearTimeout = id => { if (id !== 999) oldClear(id) }
    const props = { enabled: true, identityKey: 'owner-finalization-recovery', taskVersion: '9', conversationId: 'conversation-1',
      request: { requestId: 'request-1', conversationId: 'conversation-1', stateVersion: '1' } }
    let wrapper
    try {
      wrapper = mount(Component, { props }); await flushPromises()
      await wrapper.find('input[type="checkbox"]').setValue(true)
      await wrapper.find('.finalize-button').trigger('click'); await flushPromises()
      expect(calls).to.have.length(1)
      await wrapper.setProps({ request: { ...props.request, stateVersion: '2' } }); await flushPromises()
      expect(calls).to.have.length(1)
      expect(wrapper.find('input[type="checkbox"]').attributes()).to.have.property('disabled')
      wrapper.unmount(); wrapper = mount(Component, { props: { ...props, taskVersion: '12' } }); await flushPromises()
      expect(calls).to.have.length(1)
      expect(wrapper.find('input[type="checkbox"]').element.checked).to.equal(true)
      expect(wrapper.find('.finalize-button').text()).to.equal('继续原验收')
      await wrapper.find('.finalize-status-button').trigger('click'); await flushPromises()
      expect(calls.map(call => call.method)).to.deep.equal(['POST', 'GET'])
      expect(wrapper.text()).not.to.include('需求已完成')
      await wrapper.find('.finalize-button').trigger('click'); await flushPromises()
      expect(reads).to.equal(2)
      expect(calls.map(call => call.method)).to.deep.equal(['POST', 'GET', 'GET', 'POST'])
      expect(calls[3].data).to.deep.equal(calls[0].data)
      expect(calls[3].headers).to.deep.equal(calls[0].headers)
      expect(wrapper.text()).to.include('需求已完成')
      expect(wrapper.text()).to.include('delivery-original')
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
        outputAssetPart, useHallConversationArchive, useHallBountyFinalization, safeFinalizationVersion, readOutputRecovery,
        writeOutputRecovery, saveOutputBlob: () => {}
      })
      globalThis.setTimeout = (fn, delay, ...args) => delay === 2500 ? 999 : oldTimeout(fn, delay, ...args)
      globalThis.clearTimeout = id => { if (id !== 999) oldClear(id) }
      let wrapper
      try {
        wrapper = mount(Component, { props: { enabled: true, identityKey: 'owner-version', taskVersion: version,
          conversationId: 'conversation-1', request: { requestId: 'request-1', conversationId: 'conversation-1' } } })
        await flushPromises(); await wrapper.find('input[type="checkbox"]').setValue(true)
        await wrapper.find('.finalize-button').trigger('click'); await flushPromises()
        expect(writes).to.have.length(0); expect(wrapper.text()).to.include('版本无法安全确认')
      } finally { wrapper?.unmount(); globalThis.setTimeout = oldTimeout; globalThis.clearTimeout = oldClear }
    })
  }

})
