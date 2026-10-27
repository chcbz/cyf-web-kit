import { expect } from 'chai'
import { mount } from '@vue/test-utils'
import { defineComponent, nextTick, ref } from 'vue'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { useArchiveMaintenance } from '../src/composables/juyiting/useArchiveMaintenance.js'

const state = () => ({ skills: [], positions: [], appointments: [], installations: [] })
const wait = async predicate => {
  for (let n = 0; n < 100; n++) { await new Promise(resolve => setTimeout(resolve, 2)); await nextTick(); if (predicate()) return }
  throw new Error('maintenance state timed out')
}
const memory = () => {
  const values = new Map()
  return { values, getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) }
}
const harness = (options = {}) => {
  const identity = ref('owner-one'), epoch = ref(0), calls = [], storage = options.storage || memory()
  const positionApi = { get: async path => { if (path) throw Object.assign(new Error('missing'), { status: 404 }); return state() }, post: async (...args) => { calls.push(args); return {} }, ...options.positionApi }
  const jobApi = { get: async path => { if (path) throw Object.assign(new Error('missing'), { status: 404 }); return [] }, post: async (...args) => { calls.push(args); return {} }, ...options.jobApi }
  let api
  const wrapper = mount(defineComponent({ setup() { api = useArchiveMaintenance({ identityScope: () => identity.value, identityEpoch: () => epoch.value, positionApi, jobApi, storage, createKey: () => 'same-operation' }); return () => null } }))
  return { api, identity, epoch, calls, storage, wrapper }
}

describe('archive position and maintenance recovery', () => {
  it('passes an explicit selected target and never infers installation success', async () => {
    const h = harness()
    try { await wait(() => !h.api.busy.value); await h.api.submit('position', '/appointments', { positionId: 'editor', agentId: 'lin-chong' }); expect(h.calls[0][1]).to.deep.equal({ positionId: 'editor', agentId: 'lin-chong' }); expect(h.api.notice.value).to.contain('请查看安装进度'); expect(h.api.positions.value.installations).to.deep.equal([]) } finally { h.wrapper.unmount() }
  })
  it('keeps the original key but never persists source text after a lost response', async () => {
    const h = harness({ jobApi: { post: async () => { throw new Error('response lost') } } })
    try { await wait(() => !h.api.busy.value); await h.api.submit('job', '', { agentId: 'lin-chong', sourceText: 'PRIVATE SOURCE' }); expect(h.api.pending.value.key).to.equal('same-operation'); expect([...h.storage.values.values()].join('')).not.to.contain('PRIVATE SOURCE'); expect(h.api.error.value).to.equal('response lost'); expect(h.api.blocked.value).to.equal(true) } finally { h.wrapper.unmount() }
  })
  it('recovers on remount before allowing another mutation', async () => {
    const storage = memory(); const a = harness({ storage, jobApi: { post: async () => { throw new Error('lost') } } })
    await wait(() => !a.api.busy.value); await a.api.submit('job', '', { agentId: 'lin-chong', sourceText: 'source' }); a.wrapper.unmount()
    const calls = [], b = harness({ storage, jobApi: { get: async (path, params, options) => { calls.push({ path, options }); return path ? { jobId: 'original' } : [] } } })
    try { await wait(() => !b.api.busy.value); expect(calls[0].path).to.equal('/operations/request'); expect(calls[0].options.headers['Idempotency-Key']).to.equal('same-operation'); expect(b.api.pending.value).to.equal(null) } finally { b.wrapper.unmount() }
  })
  it('retries with exactly the original input and key, rejects a different source', async () => {
    let count = 0; const sent = []
    const h = harness({ jobApi: { post: async (path, body, options) => { sent.push({ body, options }); if (++count === 1) throw new Error('lost'); return {} } } })
    try { await wait(() => !h.api.busy.value); await h.api.submit('job', '', { agentId: 'lin-chong', sourceText: 'source' }); await h.api.retry('changed'); expect(sent.length).to.equal(1); await h.api.retry('source'); expect(sent.length).to.equal(2); expect(sent[1].options.headers['Idempotency-Key']).to.equal(sent[0].options.headers['Idempotency-Key']); expect(h.api.pending.value).to.equal(null) } finally { h.wrapper.unmount() }
  })
  it('fences late mutation completion after identity switch and retains old recovery only in old namespace', async () => {
    let resolve
    const h = harness({ jobApi: { post: () => new Promise(r => { resolve = r }) } })
    try { await wait(() => !h.api.busy.value); const pending = h.api.submit('job', '', { agentId: 'lin-chong', sourceText: 'source' }); await wait(() => !!resolve); h.identity.value = 'owner-two'; resolve({ jobId: 'old-owner' }); await pending; await wait(() => !h.api.busy.value); expect(h.api.jobs.value).to.deep.equal([]); expect(h.api.pending.value).to.equal(null); expect(h.api.notice.value).to.equal(''); h.identity.value = 'owner-one'; await wait(() => !h.api.busy.value); expect(h.api.pending.value?.key).to.equal('same-operation') } finally { h.wrapper.unmount() }
  })
  it('fails closed when browser recovery storage cannot be written', async () => {
    const h = harness({ storage: { getItem: () => null, setItem: () => { throw new Error('blocked') } } })
    try { await wait(() => !h.api.busy.value); await h.api.submit('position', '/appointments', { positionId: 'editor', agentId: 'a' }); expect(h.calls.length).to.equal(0); expect(h.api.error.value).to.contain('无法可靠保存') } finally { h.wrapper.unmount() }
  })
  it('a validated first-request domain rejection releases the form, not a network/protocol error', async () => {
    const h = harness({ positionApi: { post: async () => { throw Object.assign(new Error('capacity'), { status: 409, code: 'POSITION_CAPACITY_REACHED', failureClass: 'http' }) } } })
    try { await wait(() => !h.api.busy.value); await h.api.submit('position', '/appointments', { positionId: 'editor', agentId: 'a' }); expect(h.api.pending.value).to.equal(null); expect(h.api.blocked.value).to.equal(false); expect(h.api.error.value).to.equal('capacity') } finally { h.wrapper.unmount() }
  })
  it('a rejection after an ambiguous first attempt never discards its recovery key', async () => {
    let count = 0
    const h = harness({ jobApi: { post: async () => { if (++count === 1) throw new Error('lost'); throw Object.assign(new Error('revoked'), { status: 403, code: 'POSITION_AUTHORITY_REVOKED', failureClass: 'http' }) } } })
    try { await wait(() => !h.api.busy.value); await h.api.submit('job', '', { sourceText: 'source' }); await h.api.retry('source'); expect(h.api.pending.value?.key).to.equal('same-operation') } finally { h.wrapper.unmount() }
  })
  it('failed-job retry references the server source without attaching browser source data', async () => {
    let count = 0; const sent = []
    const h = harness({ jobApi: { post: async (path, body) => { sent.push({ path, body }); if (++count === 1) throw new Error('lost'); return {} } } })
    try { await wait(() => !h.api.busy.value); await h.api.submit('job', '/failed-job/retry', {}); await h.api.retry('not needed'); expect(sent).to.deep.equal([{ path: '/failed-job/retry', body: {} }, { path: '/failed-job/retry', body: {} }]); expect(h.api.pending.value).to.equal(null) } finally { h.wrapper.unmount() }
  })
  for (const name of ['archive/ArchiveMaintenance.vue', 'LibraryPanel.vue', 'archive/ArchiveReader.vue']) {
    it(`compiles the ${name} script and template`, () => {
      const filename = new URL(`../src/components/juyiting/${name}`, import.meta.url)
      const { descriptor, errors } = parse(readFileSync(filename, 'utf8'), { filename: name })
      expect(errors).to.deep.equal([])
      const script = compileScript(descriptor, { id: name })
      expect(compileTemplate({ source: descriptor.template.content, filename: name, id: name, compilerOptions: { bindingMetadata: script.bindings } }).errors).to.deep.equal([])
    })
  }
})
