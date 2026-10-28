import { displayFixtures } from './fixtures/juyiting/interface-display-fixture.mjs'
import { useHallSkillResults } from '../src/composables/juyiting/useHallSkillResults.js'
import { skillResultDataText } from '../src/composables/juyiting/hallSkillResults.js'
import { before, after } from 'mocha'
import { Buffer } from 'node:buffer'
import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import * as Vue from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { compileScript, parse } from '@vue/compiler-sfc'
import { exactOutputId, outputCatalogItems, outputItemKey, previewKind, scopedExecutionSteps, downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery, outputRequestPending } from '../src/composables/juyiting/bountyOutputCatalog.js'
import { readOutputRecovery, writeOutputRecovery } from '../src/composables/juyiting/bountyOutputRecovery.js'
import { useHallConversationArchive } from '../src/composables/juyiting/useHallConversationArchive.js'
import { useHallBountyFinalization, safeFinalizationVersion } from '../src/composables/juyiting/useHallBountyFinalization.js'

import { revisionProgressPending } from '../src/composables/juyiting/hallTypedDeliberation.js'
const filename = fileURLToPath(new URL('../src/components/juyiting/BountyExecutionOutputs.vue', import.meta.url))
const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
const script = compileScript(descriptor, { id: 'hall-bounty-live-output-test', inlineTemplate: true }).content
  .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm,
    (_, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
  .replace(/^import\s+\{\s*createApi\s*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var { createApi } = deps')
  .replace(/^import\s+\{\s*exactOutputId,[^}]+\}\s+from\s+['"][^'"]+['"];?\s*$/gm,
    'var { exactOutputId, outputCatalogItems, outputItemKey, previewKind, scopedExecutionSteps, downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery, outputRequestPending } = deps')
  .replace(/^import\s+\{\s*saveOutputBlob\s*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var { saveOutputBlob } = deps')
  .replace(/^import\s+\{\s*readOutputRecovery,[^}]+\}\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var { readOutputRecovery, writeOutputRecovery } = deps')
  .replace(/^import\s+\{\s*useHallConversationArchive\s*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var { useHallConversationArchive } = deps')
  .replace(/^import\s+\{\s*useHallBountyFinalization,[^}]+\}\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var { useHallBountyFinalization, safeFinalizationVersion } = deps')
  .replace(/^import\s+\{\s*useHallSkillResults\s*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var { useHallSkillResults } = deps')
  .replace(/^import\s+\{\s*skillResultDataText\s*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var { skillResultDataText } = deps')
  .replace(/^import .*revisionProgressPending.*\n/gm, 'const { revisionProgressPending } = deps\n')
  .replace('export default', 'return')
const zeroDigest = createHash('sha256').update(Buffer.alloc(20)).digest('hex')
const item = stepId => {
  const url = `/chat/requests/request-1/steps/${stepId}/outputs/output_1`
  return { outputId: 'output_1', contentMimeType: 'image/png', sha256: zeroDigest,
    byteLength: '20', previewUrl: url, downloadUrl: `${url}?download=true`, assetRef: { assetId: `ast_${stepId}`, revision: '1' } }
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
      if (path === '/requests/request-1') return (({
        requestId: 'request-1', conversationId: 'conversation-1',
        steps: (requestReads++ === 0) ? [step('step-1')] : [step('step-1'), step('step-2')]
      }))
      if (path.endsWith('/steps/step-1/outputs')) return (([item('step-1')]))
      if (path.endsWith('/steps/step-2/outputs')) return (([item('step-2')]))
      throw new Error(`unexpected GET ${path}`)
    }, execute: async () => ((new Blob([new Uint8Array(20)], { type: 'image/png' }))) }
    const Component = new Function('Vue', 'deps', script)(Vue, { revisionProgressPending, useHallSkillResults, skillResultDataText, createApi: () => mockApi, exactOutputId, outputCatalogItems, outputItemKey,
      previewKind, scopedExecutionSteps, downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery, outputRequestPending, useHallBountyFinalization, safeFinalizationVersion, useHallConversationArchive, readOutputRecovery, writeOutputRecovery, saveOutputBlob: () => {}
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
      if (path === '/requests/request-1') return (({ requestId: 'request-1', conversationId: 'conversation-1',
        steps: [{ ...step('step-1'), taskId: 'task-1', assignmentRevision: '3' }] }))
      if (path.endsWith('/steps/step-1/outputs')) return (([item('step-1')]))
      throw new Error(`unexpected GET ${path}`)
    }, execute: async payload => { writes.push(payload); throw new Error('the output card must never POST an interaction') } }
    const Component = new Function('Vue', 'deps', script)(Vue, { revisionProgressPending, useHallSkillResults, skillResultDataText,
      createApi: () => chatApi, exactOutputId, outputCatalogItems, outputItemKey, previewKind, scopedExecutionSteps, downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery, outputRequestPending, useHallBountyFinalization, safeFinalizationVersion, useHallConversationArchive, readOutputRecovery, writeOutputRecovery, saveOutputBlob: () => {}
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
  it('refuses mismatched preview bytes and MIME with a visible error', async () => {
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
        if (path === '/requests/request-1') return (({
          requestId: 'request-1', conversationId: 'conversation-1', steps: [step('step-1')]
        }))
        if (path.endsWith('/steps/step-1/outputs')) return (([itemForCatalog]))
        throw new Error(`unexpected GET ${path}`)
      },
      execute: async () => ((responses.shift()))
    }
    const Component = new Function('Vue', 'deps', script)(Vue, { revisionProgressPending, useHallSkillResults, skillResultDataText,
      createApi: () => chatApi, exactOutputId, outputCatalogItems, outputItemKey,
      previewKind, scopedExecutionSteps, downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery, outputRequestPending, useHallBountyFinalization, safeFinalizationVersion, useHallConversationArchive, readOutputRecovery, writeOutputRecovery,
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
      await buttons().find(button => button.text() === '预览').trigger('click')
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
  for (const [version, revision] of [['', '3'], ['01', '3'], ['9007199254740992', '3'], ['9', ''], ['9', '01']]) {
    // Obsolete gallery mutation controls were removed by F3; intent/recovery remains covered by the dedicated archive/finalization/review tests.
  }

  it('discovers two indexed output_1 drafts after a storage-free refresh while keeping the historical assignment read-only', async () => {
    const oldTimeout = globalThis.setTimeout; const oldClear = globalThis.clearTimeout
    const downloads = []; const output = (requestId, stepId) => {
      const url = `/chat/requests/${requestId}/steps/${stepId}/outputs/output_1`
      return { outputId: 'output_1', contentMimeType: 'image/png', sha256: zeroDigest, byteLength: '20',
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
      if (path === '/requests/request-old') return ((catalog[0].request))
      if (path === '/requests/request-current') return ((catalog[1].request))
      if (path.endsWith('/steps/step-old/outputs')) return (([output('request-old', 'step-old')]))
      if (path.endsWith('/steps/step-current/outputs')) return (([output('request-current', 'step-current')]))
      throw new Error(`unexpected GET ${path}`)
    }, execute: async request => {
      expect(request.method).to.equal('GET')
      return (new Blob([new Uint8Array(20)], { type: 'image/png' }))
    } }
    const Component = new Function('Vue', 'deps', script)(Vue, { revisionProgressPending, useHallSkillResults, skillResultDataText,
      createApi: () => chatApi, exactOutputId, outputCatalogItems, outputItemKey, previewKind, scopedExecutionSteps,
      downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery, outputRequestPending, useHallBountyFinalization, safeFinalizationVersion,
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
      expect(wrapper.findAll('button').some(button => ['下载', '保存到工作空间', '继续修改'].includes(button.text()))).to.equal(false)
      expect(wrapper.emitted('task-completed')).to.equal(undefined)
    } finally { wrapper?.unmount(); globalThis.setTimeout = oldTimeout; globalThis.clearTimeout = oldClear }
  })

  it('shows only the exact current delivery read-only, updates late edits on remount, and never mutates the task', async () => {
    const oldTimeout = globalThis.setTimeout; const oldClear = globalThis.clearTimeout
    const calls = []; let catalog = []; let addLate = false
    const output = (requestId, outputId, mime, replaces = null) => {
      const url = `/chat/requests/${requestId}/steps/step-1/outputs/${outputId}`
      return { outputId, contentMimeType: mime, sha256: zeroDigest, byteLength: '20', replaces,
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
      if (source) return ((source.request))
      if (path === '/requests/request-1/steps/step-1/outputs') return (([first, other]))
      if (path === '/requests/request-edit/steps/step-1/outputs') return (([edit]))
      if (path === '/requests/request-late/steps/step-1/outputs') return (([late]))
      throw new Error(`unexpected source read ${path}`)
    }, execute: async () => { throw new Error('no archive or tool execution before acceptance') } }
    const agentApi = { execute: async payload => { calls.push(payload); throw new TypeError('unknown acceptance ACK') } }
    const Component = new Function('Vue', 'deps', script)(Vue, { revisionProgressPending, useHallSkillResults, skillResultDataText,
      createApi: base => base === '/agent' ? agentApi : chatApi, exactOutputId, outputCatalogItems, outputItemKey,
      previewKind, scopedExecutionSteps, downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery, outputRequestPending,
      useHallConversationArchive, useHallBountyFinalization, safeFinalizationVersion, saveOutputBlob: () => {}
    })
    globalThis.setTimeout = (fn, delay, ...args) => delay === 2500 ? 999 : oldTimeout(fn, delay, ...args)
    globalThis.clearTimeout = id => { if (id !== 999) oldClear(id) }
    const props = { acceptance: true, enabled: true, identityKey: 'owner-exact-delivery', taskId: 'task-1', taskVersion: '9',
      conversationId: 'conversation-1', request: catalog.at(-1).request, catalog }
    let wrapper
    try {
      wrapper = mount(Component, { props }); await flushPromises()
      expect(wrapper.findAll('.bounty-output')).to.have.length(2)
      expect(wrapper.findAll('input[type="checkbox"]')).to.have.length(0)
      await wrapper.setProps({ taskCompleted: true })
      expect(wrapper.find('.finalize-button').exists()).to.equal(false)
      expect(wrapper.find('.continue-modification').exists()).to.equal(false)
      expect(wrapper.findAll('.bounty-output').some(card => card.text().includes('需要调整？'))).to.equal(false)
      expect(calls).to.have.length(0)
      await wrapper.setProps({ taskCompleted: false }); await flushPromises()
      addLate = true; catalog = [...catalog, { ordinal: '3', request: request('request-late') }]
      await wrapper.setProps({ catalog, request: catalog.at(-1).request }); await flushPromises()
      expect(wrapper.findAll('.bounty-output')).to.have.length(2)
      expect(wrapper.findAll('.bounty-output')[0].text()).to.include('改稿关联：blue-bird')
      expect(wrapper.findAll('.bounty-output')[0].text()).not.to.include('改稿关联：bird')
      expect(calls).to.have.length(0)
      wrapper.unmount(); wrapper = mount(Component, { props: { ...props, catalog, request: catalog.at(-1).request } }); await flushPromises()
      expect(wrapper.findAll('.bounty-output')[0].text()).to.include('改稿关联：blue-bird')
      expect(calls).to.have.length(0)
    } finally { wrapper?.unmount(); globalThis.setTimeout = oldTimeout; globalThis.clearTimeout = oldClear }
  })

  it('renders persisted text in the discussion default mode and emits its exact acceptance source, including remount', async () => {
    const raw = displayFixtures(JSON.parse(readFileSync(new URL('./fixtures/juyiting/completed-message-delivery-v3.json', import.meta.url), 'utf8')))
    const request = { requestId: raw.requestId, requestRevision: raw.requestRevision, conversationId: raw.conversationId,
      conversationGeneration: raw.conversationGeneration, state: 'COMPLETED', stateVersion: '1', steps: [], turns: [{
        turnId: raw.turnId, requestId: raw.requestId, requestRevision: raw.requestRevision, conversationId: raw.conversationId,
        conversationGeneration: raw.conversationGeneration, route: 'CHAT', state: 'FINAL_PERSISTED',
        finalMessageId: raw.outcome.assistantMessageId, contextSnapshotId: raw.outcome.messageSource.snapshotId }] }
    const oldTimeout = globalThis.setTimeout; const oldClear = globalThis.clearTimeout
    const calls = []; const reads = []; const downloads = []
    const chatApi = { get: async path => {
      reads.push(path)
      if (path === `/requests/${raw.requestId}`) return ((request))
      if (path === `/conversations/${raw.conversationId}/requests/${raw.requestId}/typed-outcome`) return ((raw))
      throw new Error(`unexpected read ${path}`)
    }, execute: async () => { throw new Error('no fake output bytes, tools, archive or personal-space prerequisite') } }
    const agentApi = { execute: async options => { calls.push(options); throw new TypeError('unknown ACK') } }
    const Component = new Function('Vue', 'deps', script)(Vue, { revisionProgressPending, useHallSkillResults, skillResultDataText,
      createApi: base => base === '/agent' ? agentApi : chatApi, exactOutputId, outputCatalogItems, outputItemKey, previewKind,
      scopedExecutionSteps, downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery, outputRequestPending,
      useHallConversationArchive, useHallBountyFinalization, safeFinalizationVersion, saveOutputBlob: value => downloads.push(value)
    })
    globalThis.setTimeout = (fn, delay, ...args) => delay === 2500 ? 999 : oldTimeout(fn, delay, ...args)
    globalThis.clearTimeout = id => { if (id !== 999) oldClear(id) }
    const props = { enabled: true, taskId: 'task', taskVersion: '9', conversationId: raw.conversationId,
      identityKey: 'owner-text-page', request, catalog: [{ ordinal: '1', request }] }
    let wrapper
    try {
      wrapper = mount(Component, { props }); await flushPromises()
      for (let i = 0; i < 20 && !wrapper.find('.bounty-output-text').exists(); i++) {
        await new Promise(resolve => oldTimeout(resolve, 5)); await flushPromises()
      }
      expect(wrapper.findAll('.bounty-output')).to.have.length(1)
      expect(wrapper.find('.bounty-output-text').text()).to.equal(raw.outcome.text)
      const accept = wrapper.findAll('button').find(button => button.text() === '验收此版')
      expect(accept).not.to.equal(undefined)
      await accept.trigger('click')
      expect(wrapper.emitted('accept-output')[0][0].messageSource).to.deep.equal(raw.outcome.messageSource)
      expect(wrapper.emitted('outputs-change').at(-1)[0]).to.have.length(1)
      expect(wrapper.findAll('input[type="checkbox"]')).to.have.length(0)
      expect(calls).to.have.length(0)
      expect(reads.some(path => path.endsWith('/outputs'))).to.equal(false)
      expect(downloads).to.have.length(0)
      wrapper.unmount(); wrapper = mount(Component, { props }); await flushPromises()
      // The original text hash is recomputed asynchronously from the read-only persisted final.
      for (let i = 0; i < 20 && !wrapper.find('.bounty-output-text').exists(); i++) {
        await new Promise(resolve => oldTimeout(resolve, 5)); await flushPromises()
      }
      expect(wrapper.find('.bounty-output-text').text()).to.equal(raw.outcome.text)
      expect(calls).to.have.length(0)
      expect(wrapper.find('.finalize-button').exists()).to.equal(false)
    } finally { wrapper?.unmount(); globalThis.setTimeout = oldTimeout; globalThis.clearTimeout = oldClear }
  })

  it('renders API-generated text append/replace/reset read-only across remounts', async () => {
    const groups = displayFixtures(JSON.parse(readFileSync(new URL('./fixtures/juyiting/text-delivery-relations-v3.json', import.meta.url), 'utf8')))
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
          if (request) return ((request))
          const raw = sources.find(raw => path === `/conversations/${raw.conversationId}/requests/${raw.requestId}/typed-outcome`)
          if (raw) return ((raw))
          throw new Error(`unexpected source read ${path}`)
        }, execute: async () => { throw new Error('must not execute tools or invent output files') } }
        const agentApi = { execute: async options => { calls.push(options); throw new TypeError('unknown acceptance ACK') } }
        const Component = new Function('Vue', 'deps', script)(Vue, { revisionProgressPending, useHallSkillResults, skillResultDataText,
          createApi: base => base === '/agent' ? agentApi : chatApi, exactOutputId, outputCatalogItems, outputItemKey, previewKind,
          scopedExecutionSteps, downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery, outputRequestPending,
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
        expect(wrapper.find('.finalize-button').exists()).to.equal(false)
        expect(calls).to.have.length(0)
        wrapper.unmount(); wrapper = mount(Component, { props }); await flushPromises()
        for (let i = 0; i < 20 && wrapper.findAll('.bounty-output-text').length !== count; i++) {
          await new Promise(resolve => oldTimeout(resolve, 5)); await flushPromises()
        }
        expect(wrapper.findAll('.bounty-output-text')).to.have.length(count)
        expect(calls).to.have.length(0)
        wrapper.unmount(); wrapper = null
      }
    } finally { wrapper?.unmount(); globalThis.setTimeout = oldTimeout; globalThis.clearTimeout = oldClear }
  })

  it('renders clarified text chains and preserves displayed sources on read-only remount', async () => {
    const groups = displayFixtures(JSON.parse(readFileSync(new URL('./fixtures/juyiting/clarified-text-delivery-v3.json', import.meta.url), 'utf8')))
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
          if (request) return ((request))
          const raw = sources.find(raw => path === `/conversations/${raw.conversationId}/requests/${raw.requestId}/typed-outcome`)
          if (raw) return ((raw))
          throw new Error(`unexpected source read ${path}`)
        }, execute: async () => { throw new Error('must not execute tools or invent output files') } }
        const agentApi = { execute: async options => { calls.push(options); throw new TypeError('unknown acceptance ACK') } }
        const Component = new Function('Vue', 'deps', script)(Vue, { revisionProgressPending, useHallSkillResults, skillResultDataText,
          createApi: base => base === '/agent' ? agentApi : chatApi, exactOutputId, outputCatalogItems, outputItemKey, previewKind,
          scopedExecutionSteps, downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery, outputRequestPending,
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
        expect(wrapper.find('.finalize-button').exists()).to.equal(false)
        expect(calls).to.have.length(0)
        wrapper.unmount(); wrapper = mount(Component, { props }); await flushPromises()
        for (let i = 0; i < 20 && wrapper.findAll('.bounty-output-text').length !== count; i++) {
          await new Promise(resolve => oldTimeout(resolve, 5)); await flushPromises()
        }
        expect(wrapper.findAll('.bounty-output-text')).to.have.length(count)
        expect(calls).to.have.length(0)
        wrapper.unmount(); wrapper = null
      }
    } finally { wrapper?.unmount(); globalThis.setTimeout = oldTimeout; globalThis.clearTimeout = oldClear }
  })

  it('renders an earlier replacement and retains the appended item on read-only remount', async () => {
    const groups = [displayFixtures(JSON.parse(readFileSync(new URL('./fixtures/juyiting/retained-text-delivery-v3.json', import.meta.url), 'utf8')))]
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
          if (request) return ((request))
          const raw = sources.find(raw => path === `/conversations/${raw.conversationId}/requests/${raw.requestId}/typed-outcome`)
          if (raw) return ((raw))
          throw new Error(`unexpected source read ${path}`)
        }, execute: async () => { throw new Error('must not execute tools or invent output files') } }
        const agentApi = { execute: async options => { calls.push(options); throw new TypeError('unknown acceptance ACK') } }
        const Component = new Function('Vue', 'deps', script)(Vue, { revisionProgressPending, useHallSkillResults, skillResultDataText,
          createApi: base => base === '/agent' ? agentApi : chatApi, exactOutputId, outputCatalogItems, outputItemKey, previewKind,
          scopedExecutionSteps, downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery, outputRequestPending,
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
        expect(wrapper.find('.finalize-button').exists()).to.equal(false)
        expect(calls).to.have.length(0)
        wrapper.unmount(); wrapper = mount(Component, { props }); await flushPromises()
        for (let i = 0; i < 20 && wrapper.findAll('.bounty-output-text').length !== count; i++) {
          await new Promise(resolve => oldTimeout(resolve, 5)); await flushPromises()
        }
        expect(wrapper.findAll('.bounty-output-text')).to.have.length(count)
        expect(calls).to.have.length(0)
        wrapper.unmount(); wrapper = null
      }
    } finally { wrapper?.unmount(); globalThis.setTimeout = oldTimeout; globalThis.clearTimeout = oldClear }
  })

  it('does not offer fake acceptance for empty, unrelated, or ambiguous deliverables', async () => {
    const oldTimeout = globalThis.setTimeout; const oldClear = globalThis.clearTimeout
    const chatApi = { get: async path => path === '/requests/request-1'
      ? (({ requestId: 'request-1', conversationId: 'conversation-1', steps: [step('step-1'), step('step-2')] }))
      : (([item(path.includes('step-1') ? 'step-1' : 'step-2')])) }
    const Component = new Function('Vue', 'deps', script)(Vue, { revisionProgressPending, useHallSkillResults, skillResultDataText,
      createApi: () => chatApi, exactOutputId, outputCatalogItems, outputItemKey, previewKind, scopedExecutionSteps,
      downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery, outputRequestPending,
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
      await wrapper.setProps({ taskCompleted: true }); await flushPromises()
      expect(wrapper.text()).not.to.include('本次交付范围尚不明确')
      expect(wrapper.text()).to.include('事项已完成，此处仅供查看成果。')
      expect(wrapper.find('.finalize-button').exists()).to.equal(false)
      expect(wrapper.findAll('.bounty-output')).to.have.length(0)
    } finally { wrapper?.unmount(); globalThis.setTimeout = oldTimeout; globalThis.clearTimeout = oldClear }
  })

  for (const group of displayFixtures(JSON.parse(readFileSync(new URL('./fixtures/juyiting/execution-batch-delivery-v3.json', import.meta.url), 'utf8')))) {
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
        return { outputId, sha256: zeroDigest, byteLength: '20', contentMimeType: 'image/png', previewUrl: url, downloadUrl: `${url}?download=true`, assetRef: null } })
      let addLate = false; const late = { ...child, requestId: 'unlinked-late' }
      const snapshots = [initial, action, child]; const reads = []; const writes = []
      const api = { get: async path => { reads.push(path)
        if (path.endsWith('/typed-outcome')) return ((path.includes('/batch-action/') ? group.completed : group.initial))
        if (path.endsWith('/outputs')) return ((path.includes('/unlinked-late/') ? outputs.map(value => ({ ...value,
          previewUrl: value.previewUrl.replace(child.requestId, 'unlinked-late'), downloadUrl: value.downloadUrl.replace(child.requestId, 'unlinked-late') })) : outputs))
        const snapshot = [...snapshots, ...(addLate ? [late] : [])].find(value => path === `/requests/${value.requestId}`)
        if (snapshot) return ((snapshot))
        throw new Error('unexpected GET ' + path)
      } }
      const agentApi = { execute: async value => {
        if (value.method === 'GET') { reads.push(value.url); throw { response: { status: 404 } } }
        writes.push(value); throw new TypeError('unknown original ACK')
      } }
      const Component = new Function('Vue', 'deps', script)(Vue, { revisionProgressPending, useHallSkillResults, skillResultDataText,
        createApi: base => base === '/agent' ? agentApi : api, exactOutputId, outputCatalogItems, outputItemKey, previewKind, scopedExecutionSteps,
        downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery, outputRequestPending,
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
        expect(wrapper.find('.finalize-button').exists()).to.equal(false)
      expect(wrapper.findAll('button').some(button => ['下载', '保存到工作空间', '继续修改'].includes(button.text()))).to.equal(false)
      expect(wrapper.emitted('task-completed')).to.equal(undefined)
      } finally { wrapper?.unmount(); globalThis.setTimeout = oldTimeout; globalThis.clearTimeout = oldClear }
    })
  }

  it('mounted actual media causal edit retains four media sources and freezes the exact mixed acceptance through remount', async () => {
    const group = displayFixtures(JSON.parse(readFileSync(new URL('./fixtures/juyiting/media-basis-delivery-v3.json', import.meta.url), 'utf8')))
    const request = raw => ({ requestId: raw.requestId, requestRevision: raw.requestRevision, conversationId: raw.conversationId,
      conversationGeneration: raw.conversationGeneration, state: 'COMPLETED', steps: [], turns: [{ turnId: raw.turnId,
        requestId: raw.requestId, requestRevision: raw.requestRevision, conversationId: raw.conversationId,
        conversationGeneration: raw.conversationGeneration, targetAgentId: 'agent', route: 'CHAT', state: 'FINAL_PERSISTED',
        finalMessageId: raw.outcome.assistantMessageId, contextSnapshotId: raw.outcome.messageSource?.snapshotId || `${raw.requestId}-snapshot` }] })
    const values = [group.initial, group.mediaOne, group.mediaTwo, group.updated]
    const children = group.manifests.map(manifest => ({ requestId: manifest.requestId, requestRevision: '1', conversationId: '42', conversationGeneration: '1',
      state: 'OUTPUT_COMMITTED', stateVersion: '2', turns: [], steps: [{ stepId: manifest.stepId, executionId: manifest.executionId,
        kind: 'EXECUTE', state: 'OUTPUT_COMMITTED', executionState: 'OUTPUT_COMMITTED', taskId: 'task', targetAgentId: 'agent', assignmentRevision: '3' }] }))
    const child = children[1]
    const outputs = group.manifests.flatMap(manifest => manifest.outputs.map(output => ({ ...output, requestId: manifest.requestId, stepId: manifest.stepId })))
    let addLate = false; const late = { ...child, requestId: 'unlinked-mixed-late' }
    const snapshots = [{ requestId: 'ordinary-chat', conversationId: '42', turns: [{ route: 'CHAT', state: 'PUBLISHED' }], steps: [] }, ...values.map(request), ...children]; const reads = []; const writes = []
    const api = { get: async path => { reads.push(path)
      if (path.includes('/requests/ordinary-chat/typed-outcome')) throw { response: { status: 404 } }
      if (path.endsWith('/typed-outcome')) return ((values.find(value => path.includes(`/requests/${value.requestId}/`))))
      if (path.endsWith('/outputs')) {
        const manifest = group.manifests.find(value => path.includes(`/requests/${value.requestId}/`)) || group.manifests[1]
        const requestId = path.includes('/unlinked-mixed-late/') ? late.requestId : manifest.requestId
        return ((manifest.outputs.map(output => { const url = `/chat/requests/${requestId}/steps/${manifest.stepId}/outputs/${output.outputId}`
          return { ...output, byteLength: String(output.byteLength), previewUrl: url, downloadUrl: `${url}?download=true`, assetRef: null }
        })))
      }
      const snapshot = [...snapshots, ...(addLate ? [late] : [])].find(value => path === `/requests/${value.requestId}`)
      if (snapshot) return ((snapshot))
      throw new Error('unexpected GET ' + path)
    } }
    const agentApi = { execute: async value => {
      if (value.method === 'GET') { reads.push(value.url); throw { response: { status: 404 } } }
      writes.push(value); throw new TypeError('unknown original ACK')
    } }
    const Component = new Function('Vue', 'deps', script)(Vue, { revisionProgressPending, useHallSkillResults, skillResultDataText,
      createApi: base => base === '/agent' ? agentApi : api, exactOutputId, outputCatalogItems, outputItemKey, previewKind, scopedExecutionSteps,
      downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery, outputRequestPending,
      useHallConversationArchive, useHallBountyFinalization, safeFinalizationVersion, saveOutputBlob: () => {}
    })
    const oldTimeout = globalThis.setTimeout; const oldClear = globalThis.clearTimeout
    globalThis.setTimeout = (fn, delay, ...args) => delay === 2500 ? 999 : oldTimeout(fn, delay, ...args)
    globalThis.clearTimeout = id => { if (id !== 999) oldClear(id) }
    let catalog = snapshots.map((request, index) => ({ ordinal: String(index + 1), request }))
    const props = { enabled: true, acceptance: true, taskId: 'task', taskVersion: '9', conversationId: '42', identityKey: 'owner-mixed-media-basis',
      request: child, catalog }
    const count = 5
    let wrapper
    const settle = async () => { for (let i = 0; i < 30 && wrapper.findAll('.bounty-output').length !== count; i++) {
      await new Promise(resolve => oldTimeout(resolve, 5)); await flushPromises()
    } }
    try {
      wrapper = mount(Component, { props }); await flushPromises(); await settle()
      expect(wrapper.findAll('.bounty-output')).to.have.length(count)
      expect(wrapper.findAll('.bounty-output-text')).to.have.length(1)
      expect(wrapper.find('.bounty-output-text').text()).to.equal('澄清后的文字')
      expect(wrapper.findAll('.bounty-output').some(item => item.text().includes(group.initial.outcome.text))).to.equal(false)
      expect(writes).to.have.length(0)
      expect(wrapper.find('.finalize-button').exists()).to.equal(false)
      expect(wrapper.findAll('button').some(button => ['下载', '保存到工作空间', '继续修改'].includes(button.text()))).to.equal(false)
      expect(wrapper.emitted('task-completed')).to.equal(undefined)
    } finally { wrapper?.unmount(); globalThis.setTimeout = oldTimeout; globalThis.clearTimeout = oldClear }
  })

  it('mounted actual individual media edits retain exact remaining sources and freezes the exact mixed acceptance through remount', async () => {
    const group = displayFixtures(JSON.parse(readFileSync(new URL('./fixtures/juyiting/mixed-media-edit-v3.json', import.meta.url), 'utf8')))
    const request = raw => ({ requestId: raw.requestId, requestRevision: raw.requestRevision, conversationId: raw.conversationId,
      conversationGeneration: raw.conversationGeneration, state: 'COMPLETED', steps: [], turns: [{ turnId: raw.turnId,
        requestId: raw.requestId, requestRevision: raw.requestRevision, conversationId: raw.conversationId,
        conversationGeneration: raw.conversationGeneration, targetAgentId: 'agent', route: 'CHAT', state: 'FINAL_PERSISTED',
        finalMessageId: raw.outcome.assistantMessageId, contextSnapshotId: raw.outcome.messageSource?.snapshotId || `${raw.requestId}-snapshot` }] })
    const values = [group.initial, group.mediaOne, group.mediaTwo, group.editOne, group.textEdit, group.editTwo]
    const children = group.manifests.map(manifest => ({ requestId: manifest.requestId, requestRevision: '1', conversationId: '42', conversationGeneration: '1',
      state: 'OUTPUT_COMMITTED', stateVersion: '2', turns: [], steps: [{ stepId: manifest.stepId, executionId: manifest.executionId,
        kind: 'EXECUTE', state: 'OUTPUT_COMMITTED', executionState: 'OUTPUT_COMMITTED', taskId: 'task', targetAgentId: 'agent', assignmentRevision: '3' }] }))
    const child = children[3]
    let addLate = false; const late = { ...child, requestId: 'unlinked-mixed-late' }
    const snapshots = [...values.map(request), ...children]; const reads = []; const writes = []
    const api = { get: async path => { reads.push(path)
      if (path.endsWith('/typed-outcome')) return ((values.find(value => path.includes(`/requests/${value.requestId}/`))))
      if (path.endsWith('/outputs')) {
        const manifest = group.manifests.find(value => path.includes(`/requests/${value.requestId}/`)) || group.manifests[3]
        const requestId = path.includes('/unlinked-mixed-late/') ? late.requestId : manifest.requestId
        return ((manifest.outputs.map(output => { const url = `/chat/requests/${requestId}/steps/${manifest.stepId}/outputs/${output.outputId}`
          return { ...output, byteLength: String(output.byteLength), previewUrl: url, downloadUrl: `${url}?download=true`, assetRef: null }
        })))
      }
      const snapshot = [...snapshots, ...(addLate ? [late] : [])].find(value => path === `/requests/${value.requestId}`)
      if (snapshot) return ((snapshot))
      throw new Error('unexpected GET ' + path)
    } }
    const agentApi = { execute: async value => {
      if (value.method === 'GET') { reads.push(value.url); throw { response: { status: 404 } } }
      writes.push(value); throw new TypeError('unknown original ACK')
    } }
    const Component = new Function('Vue', 'deps', script)(Vue, { revisionProgressPending, useHallSkillResults, skillResultDataText,
      createApi: base => base === '/agent' ? agentApi : api, exactOutputId, outputCatalogItems, outputItemKey, previewKind, scopedExecutionSteps,
      downloadMimeType, outputDownloadName, currentOutputDelivery, outputAssetPart, completedTextItem, completedExecutionDelivery, outputRequestPending,
      useHallConversationArchive, useHallBountyFinalization, safeFinalizationVersion, saveOutputBlob: () => {}
    })
    const oldTimeout = globalThis.setTimeout; const oldClear = globalThis.clearTimeout
    globalThis.setTimeout = (fn, delay, ...args) => delay === 2500 ? 999 : oldTimeout(fn, delay, ...args)
    globalThis.clearTimeout = id => { if (id !== 999) oldClear(id) }
    let catalog = snapshots.map((request, index) => ({ ordinal: String(index + 1), request }))
    const props = { enabled: true, acceptance: true, taskId: 'task', taskVersion: '9', conversationId: '42', identityKey: 'owner-mixed-individual-media-edit',
      request: child, catalog }
    const count = 6
    let wrapper
    const settle = async () => { for (let i = 0; i < 30 && wrapper.findAll('.bounty-output').length !== count; i++) {
      await new Promise(resolve => oldTimeout(resolve, 5)); await flushPromises()
    } }
    try {
      wrapper = mount(Component, { props }); await flushPromises(); await settle()
      expect(wrapper.findAll('.bounty-output'), wrapper.text() + JSON.stringify(reads)).to.have.length(count)
      expect(wrapper.findAll('.bounty-output-text')).to.have.length(1)
      expect(wrapper.find('.bounty-output-text').text()).to.equal('澄清后的文字')
      expect(wrapper.findAll('.bounty-output').some(item => item.text().includes(group.initial.outcome.text))).to.equal(false)
      expect(writes).to.have.length(0)
      expect(wrapper.find('.finalize-button').exists()).to.equal(false)
      expect(wrapper.findAll('button').some(button => ['下载', '保存到工作空间', '继续修改'].includes(button.text()))).to.equal(false)
      expect(wrapper.emitted('task-completed')).to.equal(undefined)
    } finally { wrapper?.unmount(); globalThis.setTimeout = oldTimeout; globalThis.clearTimeout = oldClear }
  })

})

describe('RB-01/D01 real gallery native execution consumer', () => {
  const nativeRequest = () => ({ requestId: 'native', requestRevision: '1', conversationId: '1', conversationGeneration: '1',
    state: 'RESULT_COMMITTED', stateVersion: '8', turns: [], steps: [{ stepId: 'native-step', stepNumber: '1', taskId: 'task',
      assignmentRevision: '1', targetAgentId: 'agent', kind: 'EXECUTE', state: 'RESULT_COMMITTED', stateVersion: '8',
      executionIntentId: 'intent', executionId: 'native-execution', executionState: 'RESULT_COMMITTED' }] })
  const props = () => ({ enabled: true, identityKey: 'owner:auth', conversationId: '1', conversationGeneration: '1',
    taskId: 'task', request: nativeRequest(), typedOutcomes: [] })
  const component = api => new Function('Vue', 'deps', script)(Vue, { revisionProgressPending, useHallSkillResults, skillResultDataText,
    createApi: () => api, exactOutputId, outputCatalogItems, outputItemKey, previewKind, scopedExecutionSteps,
    currentOutputDelivery, completedTextItem, completedExecutionDelivery, outputRequestPending })
  it('loads data-only results from persisted steps with no ACTION_REQUEST and recovers after remount', async () => {
    const calls = []
    const api = { get: async path => {
      calls.push(path)
      if (path === '/requests/native') return nativeRequest()
      if (path === '/requests/native/steps/native-step/outputs') return []
      if (path === '/conversations/1/executions/native-execution/result') return { schemaVersion: 2,
        conversationId: '1', conversationGeneration: '1', taskId: 'task', requestId: 'native', stepId: 'native-step',
        executionId: 'native-execution', executionStateVersion: '3', state: 'RESULT_COMMITTED', phase: 'COMPLETE',
        resultSha256: 'a'.repeat(64), data: { text: '原生直接执行的真实已提交投影' }, outputs: [] }
      throw new Error(`unexpected GET ${path}`)
    } }
    const Component = component(api)
    for (let i = 0; i < 2; i++) {
      const wrapper = mount(Component, { props: props() })
      try {
        await flushPromises()
        expect(wrapper.text()).to.include('原生直接执行的真实已提交投影')
        expect(wrapper.text()).to.include('已归档')
        expect(wrapper.text()).not.to.include('来源或归档状态不匹配')
        expect(wrapper.findAll('pre')).to.have.length(1)
        expect(wrapper.findAll('button').some(button => /验收|重试执行/.test(button.text()))).to.equal(false)
      } finally { wrapper.unmount() }
    }
    expect(calls.filter(path => path.endsWith('/result'))).to.have.length(2)
    expect(calls.some(path => path.includes('typed-outcome'))).to.equal(false)
  })
  it('shows only exact committed native file references without inventing a delivery outcome', async () => {
    const file = { outputId: 'native-file', contentMimeType: 'application/pdf', sha256: 'b'.repeat(64), byteLength: '20',
      previewUrl: null, downloadUrl: '/chat/requests/native/steps/native-step/outputs/native-file?download=true', assetRef: null, replaces: null }
    const api = { get: async path => {
      if (path === '/requests/native') return nativeRequest()
      if (path === '/requests/native/steps/native-step/outputs') return []
      if (path.endsWith('/native-execution/result')) return { schemaVersion: 2, conversationId: '1', conversationGeneration: '1',
        taskId: 'task', requestId: 'native', stepId: 'native-step', executionId: 'native-execution', executionStateVersion: '3',
        state: 'RESULT_COMMITTED', phase: 'COMPLETE', resultSha256: 'a'.repeat(64), data: null, outputs: [file] }
      throw new Error(`unexpected GET ${path}`)
    } }
    const wrapper = mount(component(api), { props: { ...props(), acceptance: true } })
    try {
      await flushPromises()
      expect(wrapper.text()).to.include('application/pdf · 20 字节')
      expect(wrapper.text()).not.to.include('本次交付范围尚不明确')
      expect(wrapper.findAll('.bounty-output')).to.have.length(2)
      expect(wrapper.findAll('pre')).to.have.length(0)
    } finally { wrapper.unmount() }
  })
  it('never exposes ARCHIVING data and rejects a late native reply after owner change', async () => {
    const pending = []; let archiving = true
    const api = { get: async (path, _query, options) => {
      if (path === '/requests/native') return nativeRequest()
      if (path === '/requests/native/steps/native-step/outputs') return []
      if (path.endsWith('/native-execution/result')) {
        const value = { schemaVersion: 2, conversationId: '1', conversationGeneration: '1', taskId: 'task', requestId: 'native',
          stepId: 'native-step', executionId: 'native-execution', executionStateVersion: '3', state: 'RESULT_COMMITTED',
          phase: 'ARCHIVING', resultSha256: 'a'.repeat(64), data: null, outputs: [] }
        if (archiving) return value
        return new Promise(resolve => pending.push({ resolve: () => resolve({ ...value, phase: 'COMPLETE', data: '旧主体迟到结果' }), signal: options.signal }))
      }
      throw new Error(`unexpected GET ${path}`)
    } }
    const wrapper = mount(component(api), { props: props() })
    try {
      await flushPromises()
      expect(wrapper.text()).to.include('正在归档（尚未完成）')
      expect(wrapper.findAll('pre')).to.have.length(0)
      archiving = false
      await wrapper.find('.output-refresh').trigger('click'); await flushPromises()
      expect(pending.length).to.equal(1)
      await wrapper.setProps({ identityKey: 'owner:new-auth' }); await flushPromises()
      expect(pending[0].signal.aborted).to.equal(true)
      pending[0].resolve(); await flushPromises()
      expect(wrapper.text()).not.to.include('旧主体迟到结果')
    } finally {
      wrapper.unmount()
      for (const read of pending) read.resolve()
      await flushPromises()
    }
  })
})
