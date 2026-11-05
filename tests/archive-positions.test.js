import { expect } from 'chai'
import { mount } from '@vue/test-utils'
import * as Vue from 'vue'
import { defineComponent, nextTick, ref } from 'vue'
import { createEconomyRequestIntentStore } from '../src/composables/juyiting/economyRequestIntent.js'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { useArchivePositions } from '../src/composables/juyiting/useArchivePositions.js'

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
  let api
  const wrapper = mount(defineComponent({ setup() { api = useArchivePositions({ identityScope: () => identity.value, identityEpoch: () => epoch.value, positionApi, storage, createKey: () => 'same-operation' }); return () => null } }))
  return { api, identity, epoch, calls, storage, wrapper }
}

describe('archive position recovery', () => {
  it('passes an explicit selected target and never infers installation success', async () => {
    const h = harness()
    try { await wait(() => !h.api.busy.value); await h.api.submit('/appointments', { positionId: 'editor', agentId: 'lin-chong' }); expect(h.calls[0][1]).to.deep.equal({ positionId: 'editor', agentId: 'lin-chong' }); expect(h.api.notice.value).to.contain('请查看安装进度'); expect(h.api.positions.value.installations).to.deep.equal([]) } finally { h.wrapper.unmount() }
  })
  it('keeps the original key after a lost appointment response', async () => {
    const h = harness({ positionApi: { post: async () => { throw new Error('response lost') } } })
    try { await wait(() => !h.api.busy.value); await h.api.submit('/appointments', { agentId: 'lin-chong' }); expect(h.api.pending.value.key).to.equal('same-operation'); expect(h.api.error.value).to.equal('response lost'); expect(h.api.blocked.value).to.equal(true) } finally { h.wrapper.unmount() }
  })
  it('recovers on remount before allowing another mutation', async () => {
    const storage = memory(); const a = harness({ storage, positionApi: { post: async () => { throw new Error('lost') } } })
    await wait(() => !a.api.busy.value); await a.api.submit('/appointments', { agentId: 'lin-chong' }); a.wrapper.unmount()
    const calls = [], b = harness({ storage, positionApi: { get: async (path, params, options) => { calls.push({ path, options }); return path ? { appointmentId: 'original' } : state() } } })
    try { await wait(() => !b.api.busy.value); expect(calls[0].path).to.equal('/operations/request'); expect(calls[0].options.headers['Idempotency-Key']).to.equal('same-operation'); expect(b.api.pending.value).to.equal(null) } finally { b.wrapper.unmount() }
  })
  it('retries with exactly the original input and key, blocks different input', async () => {
    let count = 0; const sent = []
    const h = harness({ positionApi: { post: async (path, body, options) => { sent.push({ body, options }); if (++count === 1) throw new Error('lost'); return {} } } })
    try { await wait(() => !h.api.busy.value); await h.api.submit('/appointments', { agentId: 'lin-chong' }); await h.api.submit('/appointments', { agentId: 'changed' }); expect(sent.length).to.equal(1); await h.api.retry(); expect(sent.length).to.equal(2); expect(sent[1].options.headers['Idempotency-Key']).to.equal(sent[0].options.headers['Idempotency-Key']); expect(h.api.pending.value).to.equal(null) } finally { h.wrapper.unmount() }
  })
  it('fences late mutation completion after identity switch and retains old recovery only in old namespace', async () => {
    let resolve
    const h = harness({ positionApi: { post: () => new Promise(r => { resolve = r }) } })
    try { await wait(() => !h.api.busy.value); const pending = h.api.submit('/appointments', { agentId: 'lin-chong' }); await wait(() => !!resolve); h.identity.value = 'owner-two'; resolve({ jobId: 'old-owner' }); await pending; await wait(() => !h.api.busy.value); expect(h.api.positions.value.installations).to.deep.equal([]); expect(h.api.pending.value).to.equal(null); expect(h.api.notice.value).to.equal(''); h.identity.value = 'owner-one'; await wait(() => !h.api.busy.value); expect(h.api.pending.value?.key).to.equal('same-operation') } finally { h.wrapper.unmount() }
  })
  it('fails closed when browser recovery storage cannot be written', async () => {
    const h = harness({ storage: { getItem: () => null, setItem: () => { throw new Error('blocked') } } })
    try { await wait(() => !h.api.busy.value); await h.api.submit('/appointments', { positionId: 'editor', agentId: 'a' }); expect(h.calls.length).to.equal(0); expect(h.api.error.value).to.contain('无法可靠保存') } finally { h.wrapper.unmount() }
  })
  it('a validated first-request domain rejection releases the form, not a network/protocol error', async () => {
    const h = harness({ positionApi: { post: async () => { throw Object.assign(new Error('capacity'), { status: 409, code: 'POSITION_CAPACITY_REACHED', failureClass: 'http' }) } } })
    try { await wait(() => !h.api.busy.value); await h.api.submit('/appointments', { positionId: 'editor', agentId: 'a' }); expect(h.api.pending.value).to.equal(null); expect(h.api.blocked.value).to.equal(false); expect(h.api.error.value).to.equal('capacity') } finally { h.wrapper.unmount() }
  })
  it('a rejection after an ambiguous first attempt never discards its recovery key', async () => {
    let count = 0
    const h = harness({ positionApi: { post: async () => { if (++count === 1) throw new Error('lost'); throw Object.assign(new Error('revoked'), { status: 403, code: 'POSITION_AUTHORITY_REVOKED', failureClass: 'http' }) } } })
    try { await wait(() => !h.api.busy.value); await h.api.submit('/appointments', { agentId: 'lin-chong' }); await h.api.retry(); expect(h.api.pending.value?.key).to.equal('same-operation') } finally { h.wrapper.unmount() }
  })
  it('installation retry keeps the original operation and body', async () => {
    let count = 0; const sent = []
    const h = harness({ positionApi: { post: async (path, body) => { sent.push({ path, body }); if (++count === 1) throw new Error('lost'); return {} } } })
    try { await wait(() => !h.api.busy.value); await h.api.submit('/installations/failed/retry', {}); await h.api.retry(); expect(sent).to.deep.equal([{ path: '/installations/failed/retry', body: {} }, { path: '/installations/failed/retry', body: {} }]); expect(h.api.pending.value).to.equal(null) } finally { h.wrapper.unmount() }
  })
  it('retains a legacy job untouched without querying it or blocking appointments', async () => {
    const storage = memory(), reads = []
    const store = createEconomyRequestIntentStore({ storage, scopeKey: () => 'archive-maintenance:owner-one' })
    const old = { key: 'historical-job', body: { kind: 'job', path: '', metadata: {} } }
    store.save('mutation', old)
    const h = harness({ storage, positionApi: { get: async path => { reads.push(path); return state() } } })
    try {
      await wait(() => !h.api.busy.value)
      expect(h.api.blocked.value).to.equal(false)
      await h.api.submit('/appointments', { agentId: 'wuyong', positionId: 'archive-management' })
      expect(reads).to.deep.equal(['', ''])
      expect(store.get('mutation').record).to.deep.equal(old)
      expect(h.calls).to.have.length(1)
      expect(h.api).not.to.have.property('readDraft')
      expect(h.api).not.to.have.property('jobs')
    } finally { h.wrapper.unmount() }
  })
  it('recovers a legacy position by its original key, without replaying it', async () => {
    const storage = memory(), reads = []
    const store = createEconomyRequestIntentStore({ storage, scopeKey: () => 'archive-maintenance:owner-one' })
    store.save('mutation', { key: 'legacy-position', body: { kind: 'position', path: '/appointments', metadata: {} } })
    const h = harness({ storage, positionApi: { get: async (path, params, options) => { reads.push({ path, options }); return path ? {} : state() } } })
    try {
      await wait(() => !h.api.busy.value)
      expect(reads[0].options.headers['Idempotency-Key']).to.equal('legacy-position')
      expect(store.get('mutation').state).to.equal('ABSENT')
      expect(h.calls).to.have.length(0)
    } finally { h.wrapper.unmount() }
  })
  it('keeps appointment actions without a duplicate private-chat entry', async () => {
    const source = readFileSync(new URL('../src/components/juyiting/archive/ArchivePositions.vue', import.meta.url), 'utf8')
    const { descriptor } = parse(source)
    let script = compileScript(descriptor, { id: 'positions', inlineTemplate: true }).content
    script = script.replace(/import \{([^}]+)\} from ["']vue["'];?/g, (_, names) => `const {${names.replace(/ as /g, ': ')}} = Vue`)
      .replace(/import \{ useArchivePositions \} from [^\n]+/g, '')
      .replace('export default', 'return')
    const data = ref({ ...state(), positions: [{ positionId: 'archive', title: '典籍管理', capacity: 1 }], appointments: [{ appointmentId: 'one', agentId: 'wuyong', positionId: 'archive', active: true }] })
    const calls = [], mock = () => ({ positions: data, busy: ref(false), error: ref(''), notice: ref(''), pending: ref(null), blocked: ref(false), reload: () => {}, submit: (...args) => calls.push(args), retry: () => {} })
    const component = new Function('Vue', 'useArchivePositions', script)(Vue, mock)
    const agent = { agentId: 'wuyong', personaName: '吴用' }
    const wrapper = mount(component, { props: { agents: [agent], identityScope: 'owner' } })
    try {
      expect(wrapper.text()).to.contain('任职管理')
      expect(wrapper.text()).not.to.match(/交办典籍维护|维护结果|发布草稿/)
      expect(wrapper.find('input[type=file]').exists()).to.equal(false)
      expect(wrapper.text()).to.contain('好汉详情的“密议”')
      expect(wrapper.findAll('button').some(b => b.text().includes('密议'))).to.equal(false)
      expect(calls).to.deep.equal([])
      await wrapper.findAll('button').find(b => b.text() === '卸任').trigger('click')
      expect(calls).to.deep.equal([['/appointments/one/resign', {}]])
      expect(wrapper.emitted('start-conversation')).to.equal(undefined)
      data.value = state(); await nextTick()
      expect(wrapper.text()).to.contain('暂无任职')
    } finally { wrapper.unmount() }
  })
  for (const name of ['archive/ArchivePositions.vue', 'LibraryPanel.vue', 'archive/ArchiveReader.vue']) {
    it(`compiles the ${name} script and template`, () => {
      const filename = new URL(`../src/components/juyiting/${name}`, import.meta.url)
      const { descriptor, errors } = parse(readFileSync(filename, 'utf8'), { filename: name })
      expect(errors).to.deep.equal([])
      const script = compileScript(descriptor, { id: name })
      expect(compileTemplate({ source: descriptor.template.content, filename: name, id: name, compilerOptions: { bindingMetadata: script.bindings } }).errors).to.deep.equal([])
    })
  }
})
