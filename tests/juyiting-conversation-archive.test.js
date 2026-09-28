import { expect } from 'chai'
import { describe, it } from 'mocha'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { mount } from '@vue/test-utils'
import { useHallConversationArchive } from '../src/composables/juyiting/useHallConversationArchive.js'
import { revisionOf } from '../src/composables/juyiting/hallMessageParts.js'

for (const name of ['Element', 'HTMLElement', 'SVGElement', 'Node']) {
  if (!globalThis[name]) Object.defineProperty(globalThis, name, { value: globalThis.window[name], configurable: true })
}

const part = (changes = {}) => ({ partId: 'part-1', kind: 'image', state: 'ready', assetId: 'asset-1', revision: '3', filename: 'bird.png', mime: 'image/png', ...changes })
const receipt = (state, item = {}, changes = {}) => ({ operationId: 'operation-1', state, revision: '1', items: [{ assetId: 'asset-1', revision: '3', state: state === 'saved' ? 'saved' : state === 'partial_failed' ? 'failed' : state, ...item }], ...changes })
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

const loadParts = archive => {
  const filename = new URL('../src/components/juyiting/HallMessageParts.vue', import.meta.url).pathname
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
  const code = compileScript(descriptor, { id: 'hall-message-parts-archive', inlineTemplate: true }).content
    .replace(/^import \{([^}]+)\} from ["']vue["'];?$/m, (_line, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
    .replace(/^import HallMessageMedia from ['"].+['"];?$/m, "const HallMessageMedia = { template: '<div class=\\\"media-stub\\\" />' }")
    .replace(/^import \{ useHallConversationArchive \} from ['"].+['"];?$/m, 'const { useHallConversationArchive } = deps')
    .replace(/^import \{ revisionOf \} from ['"].+['"];?$/m, 'const { revisionOf } = deps')
    .replace('export default', 'return')
  return new Function('Vue', 'deps', code)(Vue, { useHallConversationArchive: () => archive, revisionOf })
}

describe('JYT-MMD-W2 conversation archive operations', () => {
  it('posts only the persisted asset reference, then shows saved only after a validated status receipt', async () => {
    const calls = []
    const api = { execute: async options => {
      calls.push(options)
      if (options.method === 'POST') return { data: receipt('pending') }
      return { data: receipt('saved', { fileId: 'workspace-file-1', version: 2 }) }
    } }
    const archives = useHallConversationArchive({ api, conversationId: Vue.ref('conversation-1'), identityEpoch: Vue.ref('owner-a'), idempotencyKeyFactory: () => 'archive-key-0001' })
    try {
      const result = await archives.save(part({ url: 'https://model.invalid/bird.png', path: '/tmp/bird.png' }))
      expect(result.state).to.equal('saved')
      expect(calls).to.have.length(2)
      expect(calls[0]).to.include({ method: 'POST', url: '/conversations/conversation-1/archive-operations' })
      expect(calls[0].headers).to.deep.equal({ 'Idempotency-Key': 'archive-key-0001' })
      expect(calls[0].data).to.deep.equal({ mode: 'create', items: [{ assetRef: { assetId: 'asset-1', revision: '3' } }] })
      expect(JSON.stringify(calls[0].data)).not.to.include('model.invalid')
      expect(calls[1]).to.include({ method: 'GET', url: '/conversations/conversation-1/archive-operations/operation-1' })
      expect(archives.statusFor(part()).state).to.equal('saved')
      expect(archives.statusFor(part()).message).to.include('workspace-file-1 v2')
    } finally { archives.dispose() }
  })

  it('does not issue duplicate save operations and reuses the original idempotency key for an explicitly retried unknown response', async () => {
    const calls = []
    let resolveFirst
    let attempt = 0
    const api = { execute: options => {
      calls.push(options)
      attempt += 1
      if (attempt === 1) return new Promise(resolve => { resolveFirst = resolve })
      if (attempt === 2) throw new TypeError('network unavailable')
      return Promise.resolve({ data: receipt('saved', { assetId: 'asset-2', fileId: 'workspace-file-1', version: 2 }) })
    } }
    const archives = useHallConversationArchive({ api, conversationId: Vue.ref('conversation-1'), identityEpoch: Vue.ref('owner-a'), idempotencyKeyFactory: () => 'archive-key-0002' })
    try {
      const first = archives.save(part())
      const duplicate = archives.save(part())
      expect(calls).to.have.length(1)
      resolveFirst({ data: receipt('saved', { fileId: 'workspace-file-1', version: 2 }) })
      await first
      expect(await duplicate).to.equal(null)
      expect(calls).to.have.length(1)

      const other = part({ assetId: 'asset-2', partId: 'part-2' })
      await archives.save(other)
      expect(archives.statusFor(other).state).to.equal('unknown')
      await archives.retry(other)
      expect(calls).to.have.length(3)
      expect(calls[1].headers['Idempotency-Key']).to.equal(calls[2].headers['Idempotency-Key'])
      expect(archives.statusFor(other).state).to.equal('saved')
    } finally { archives.dispose() }
  })

  it('never turns malformed or partial receipts into a local saved result', async () => {
    let sequence = 0
    const api = { execute: async () => {
      sequence += 1
      return { data: sequence === 1 ? receipt('saved', { fileId: 'workspace-file-1' }) : receipt('partial_failed', { assetId: 'asset-2', message: '空间写入失败' }) }
    } }
    const archives = useHallConversationArchive({ api, conversationId: Vue.ref('conversation-1'), identityEpoch: Vue.ref('owner-a'), idempotencyKeyFactory: () => `archive-key-${sequence + 10}` })
    try {
      await archives.save(part())
      expect(archives.statusFor(part()).state).to.equal('error')
      const second = part({ assetId: 'asset-2', partId: 'part-2' })
      await archives.save(second)
      expect(archives.statusFor(second).state).to.equal('partial_failed')
      expect(archives.statusFor(second).state).not.to.equal('saved')
    } finally { archives.dispose() }
  })

  it('aborts and clears pending archive state when the owner identity changes', async () => {
    let resolvePost
    const identity = Vue.ref('owner-a')
    const api = { execute: () => new Promise(resolve => { resolvePost = resolve }) }
    const archives = useHallConversationArchive({ api, conversationId: Vue.ref('conversation-1'), identityEpoch: identity, idempotencyKeyFactory: () => 'archive-key-0004' })
    try {
      const pending = archives.save(part())
      expect(archives.statusFor(part()).state).to.equal('saving')
      identity.value = 'owner-b'
      await Vue.nextTick()
      resolvePost({ data: receipt('saved', { fileId: 'workspace-file-1', version: 2 }) })
      await pending
      await flush()
      expect(archives.records.value).to.deep.equal({})
      expect(archives.statusFor(part()).state).to.equal('idle')
    } finally { archives.dispose() }
  })

  it('renders save only for ready persisted assets and leaves existing media controls intact', async () => {
    const saves = []
    const archive = { statusFor: () => ({ state: 'idle', message: '', busy: false, operationId: '' }), save: item => { saves.push(item); return Promise.resolve(null) }, retry: () => Promise.resolve(null) }
    const wrapper = mount(loadParts(archive), { props: { conversationId: 'conversation-1', identityKey: 'owner-a', parts: [part({ kind: 'text', text: '可保存文本' }), part({ partId: 'missing-asset', assetId: '' }), part({ partId: 'processing', state: 'processing' })] } })
    try {
      expect(wrapper.findAll('.part-save-button')).to.have.length(1)
      expect(wrapper.findAll('.media-stub')).to.have.length(1)
      await wrapper.get('.part-save-button').trigger('click')
      expect(saves).to.deep.equal([part({ kind: 'text', text: '可保存文本' })])
    } finally { wrapper.unmount() }
  })
})
