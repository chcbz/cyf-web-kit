import { expect } from 'chai'
import { describe, it } from 'mocha'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { mount, flushPromises } from '@vue/test-utils'
import { sameMarkResult, useHallPrivateMark } from '../src/composables/juyiting/useHallPrivateMark.js'
import { stopIdentityBoundWork } from '../src/utils/identityLifecycle.js'

const source = { sourceType: 'PRIVATE_CASE', sourceId: 'case-1' }
const resultRef = { executionId: 'execution-1', manifestId: 'manifest-1' }
const initial = (values = {}) => ({ ref: source, revision: 0, archived: false, viewedResultRef: null, updatedAt: 1, ...values })
const storage = () => {
  const map = new Map()
  return { getItem: key => map.get(key) || null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key), entries: () => [...map.entries()] }
}
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }
const fail = status => Object.assign(new Error('failure'), { status })
const harness = (handler, options = {}) => {
  const calls = []
  const saved = storage()
  const scope = Vue.ref('tenant\u0000client\u0000owner-a')
  let keys = 0
  const model = useHallPrivateMark({ sourceRef: source, identityScope: scope, storage: saved, keyFactory: () => `mark-key-${++keys}`,
    api: { execute: async request => { calls.push(request); return handler(request, saved) } }, ...options })
  return { model, calls, saved, scope }
}

describe('JYT-UX-W05 MARK-v1 private organization', () => {
  it('reads initial revision zero with no query and persists the non-sensitive intent before PATCH', async () => {
    let current = initial()
    const { model, calls, saved } = harness((request, store) => {
      if (request.method === 'PATCH') {
        const intent = JSON.parse(store.entries()[0][1])
        expect(intent.command).to.deep.equal(request.data)
        expect(intent.key).to.equal(request.headers['Idempotency-Key'])
        current = initial({ revision: 1, archived: true })
      }
      return current
    })
    try {
      await model.load()
      expect(model.mark.value.revision).to.equal(0)
      expect(calls[0]).to.include({ url: '/hall/items/PRIVATE_CASE/case-1/mark', method: 'GET' })
      expect(calls[0]).not.to.have.property('params')
      expect(calls[0]).not.to.have.property('data')
      await model.change({ archived: true })
      expect(calls[1].data).to.deep.equal({ expectedRevision: 0, archived: true, viewedResultRef: null })
      expect(calls.map(call => call.method)).to.deep.equal(['GET', 'PATCH', 'GET'])
      expect(model.mark.value.archived).to.equal(true)
      expect(saved.entries()).to.deep.equal([])
    } finally { model.dispose() }
  })

  it('never sends private mark calls for TASK, DRAFT or an empty scope and never touches an empty storage key', async () => {
    for (const options of [{ sourceRef: { sourceType: 'TASK', sourceId: 'task-1' } }, { sourceRef: { sourceType: 'DRAFT', sourceId: 'draft-1' } }, { identityScope: '' }]) {
      const { model, calls, saved } = harness(() => initial(), options)
      try {
        await model.load()
        await model.change({ archived: true })
        await model.reconcile()
        expect(calls).to.deep.equal([])
        expect(saved.entries()).to.deep.equal([])
      } finally { model.dispose() }
    }
  })

  it('retains a 503 intent through GET401/403 and matching current states; only explicit original-key PATCH resolves it', async () => {
    let mode = 'initial'
    const { model, calls, saved } = harness(request => {
      if (request.method === 'PATCH') {
        if (mode !== 'reconcile') throw fail(503)
        return initial({ revision: 1, archived: true, viewedResultRef: resultRef })
      }
      if (mode === 401 || mode === 403) throw fail(mode)
      return mode === 'initial' ? initial() : initial({ revision: 1, archived: true, viewedResultRef: resultRef })
    })
    try {
      await model.load()
      await model.change({ archived: true, viewedResultRef: resultRef })
      const key = model.pending.value.key
      const command = { ...model.pending.value.command }
      for (const status of [401, 403, 'matching']) {
        mode = status
        await model.load()
        expect(model.pending.value.key).to.equal(key)
        expect(await model.change({ archived: false })).to.equal(null)
      }
      expect(calls.filter(call => call.method === 'PATCH')).to.have.length(1)
      expect(JSON.parse(saved.entries()[0][1])).to.deep.equal({ ref: source, key, command })
      mode = 'reconcile'
      await model.reconcile()
      const patches = calls.filter(call => call.method === 'PATCH')
      expect(patches).to.have.length(2)
      expect(patches[1].headers).to.deep.equal(patches[0].headers)
      expect(patches[1].data).to.deep.equal(patches[0].data)
      expect(model.pending.value).to.equal(null)
      expect(model.mark.value.viewedResultRef).to.deep.equal(resultRef)
    } finally { model.dispose() }
  })

  it('retains a 412 choice, rereads revision, then requires an explicit new confirmation without flipping the intended value', async () => {
    let current = initial()
    let patch = 0
    const { model, calls } = harness(request => {
      if (request.method === 'PATCH') {
        if (++patch === 1) { current = initial({ revision: 7, archived: true }); throw fail(412) }
        current = initial({ revision: 8, archived: request.data.archived })
      }
      return current
    })
    try {
      await model.load()
      await model.change({ archived: true })
      expect(model.pending.value).to.equal(null)
      expect(model.conflict.value.archived).to.equal(true)
      expect(model.currentKnown.value).to.equal(false)
      expect(await model.retryConflict()).to.equal(null)
      await model.load()
      expect(calls.filter(call => call.method === 'PATCH')).to.have.length(1)
      expect(await model.change({ archived: false })).to.equal(null)
      await model.retryConflict()
      const patches = calls.filter(call => call.method === 'PATCH')
      expect(patches[1].data).to.deep.equal({ expectedRevision: 7, archived: true, viewedResultRef: null })
      expect(patches[1].headers['Idempotency-Key']).not.to.equal(patches[0].headers['Idempotency-Key'])
    } finally { model.dispose() }
  })

  it('keeps unknown intent across actual cleanup and scope switches, hiding owner A from owner B', async () => {
    const { model, scope, calls, saved } = harness(request => {
      if (request.method === 'PATCH') throw fail(503)
      return initial()
    })
    try {
      await model.load()
      await model.change({ archived: true })
      const key = model.pending.value.key
      stopIdentityBoundWork()
      expect(model.mark.value).to.equal(null)
      expect(model.pending.value).to.equal(null)
      scope.value = 'tenant\u0000client\u0000owner-b'
      expect(model.pending.value).to.equal(null)
      await model.reconcile()
      expect(calls.filter(call => call.method === 'PATCH')).to.have.length(1)
      scope.value = 'tenant\u0000client\u0000owner-a'
      expect(model.pending.value.key).to.equal(key)
      expect(saved.entries()).to.have.length(1)
    } finally { model.dispose() }
  })

  it('blocks double-click writes and rejects mismatched receipts without releasing the original key', async () => {
    const response = deferred()
    const { model, calls } = harness(request => request.method === 'GET' ? initial() : response.promise)
    try {
      await model.load()
      const writing = model.change({ archived: true })
      expect(await model.change({ archived: false })).to.equal(null)
      response.resolve(initial({ ref: { sourceType: 'PRIVATE_CASE', sourceId: 'wrong-case' }, revision: 1, archived: true }))
      await writing
      expect(model.pending.value.key).to.equal('mark-key-1')
      expect(calls.filter(call => call.method === 'PATCH')).to.have.length(1)
      expect(model.mark.value.archived).to.equal(false)
    } finally { model.dispose() }
  })

  it('does not present a stale archive replay as the current effective archive state', async () => {
    let read = 0
    const { model } = harness(request => request.method === 'PATCH'
      ? initial({ revision: 1, archived: true }) : initial({ revision: read++ ? 1 : 0, archived: false }))
    try {
      await model.load()
      await model.change({ archived: true })
      expect(model.mark.value).to.include({ revision: 1, archived: false })
      expect(model.currentKnown.value).to.equal(true)
    } finally { model.dispose() }
  })

  it('refuses a write when durable intent storage fails', async () => {
    const { model, calls } = harness(() => initial(), { storage: { getItem: () => null, setItem: () => { throw new Error('denied') } } })
    try {
      await model.load()
      expect(await model.change({ archived: true })).to.equal(null)
      expect(calls).to.have.length(1)
      expect(model.error.value).to.include('未发送操作')
    } finally { model.dispose() }
  })
})

for (const name of ['Element', 'HTMLElement', 'SVGElement', 'Node']) {
  if (!globalThis[name]) Object.defineProperty(globalThis, name, { value: globalThis.window[name], configurable: true })
}
const loadComponent = api => {
  const filename = new URL('../src/components/juyiting/HallPrivateMark.vue', import.meta.url).pathname
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
  const script = compileScript(descriptor, { id: 'private-mark-test', inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_line, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
    .replace(/^import\s+\{[^}]+\}\s+from\s+['"]@\/composables\/juyiting\/useHallPrivateMark['"];?\s*$/gm, 'var { sameMarkResult, useHallPrivateMark } = deps')
    .replace('export default', 'return')
  return new Function('Vue', 'deps', script)(Vue, { sameMarkResult, useHallPrivateMark: options => useHallPrivateMark({ ...options, api, storage: storage(), keyFactory: () => 'mounted-mark-key' }) })
}

describe('JYT-UX-W05 real private mark component', () => {
  it('marks only explicitly viewed fixed results; reading or rendering never auto-marks or accepts', async () => {
    const calls = []
    let current = initial()
    const component = loadComponent({ execute: async request => {
      calls.push(request)
      if (request.method === 'PATCH') current = initial({ revision: 1, viewedResultRef: request.data.viewedResultRef })
      return current
    } })
    const wrapper = mount(component, { props: { sourceRef: source, resultRef, identityScope: 'owner-client' } })
    try {
      await flushPromises()
      expect(calls.map(call => call.method)).to.deep.equal(['GET'])
      expect(wrapper.text()).to.include('不代表正式验收')
      await wrapper.findAll('button').find(button => button.text() === '明确标记这批成果已查看').trigger('click')
      await flushPromises()
      expect(calls[1].data).to.deep.equal({ expectedRevision: 0, archived: false, viewedResultRef: resultRef })
      expect(wrapper.text()).to.include('当前这批固定成果已标记查看')
      expect(wrapper.emitted('changed')).to.have.length(1)
      expect(calls.every(call => call.url.endsWith('/mark'))).to.equal(true)
    } finally { wrapper.unmount() }
  })

  it('has no viewed-result action without a verified available manifest and no private actions on TASK', async () => {
    const calls = []
    const component = loadComponent({ execute: async request => { calls.push(request); return initial() } })
    const wrapper = mount(component, { props: { sourceRef: source, identityScope: 'owner-client' } })
    try {
      await flushPromises()
      expect(wrapper.findAll('button').some(button => button.text().includes('成果已查看'))).to.equal(false)
      await wrapper.setProps({ sourceRef: { sourceType: 'TASK', sourceId: 'task-1' }, resultRef })
      await flushPromises()
      expect(wrapper.find('.hall-private-mark').exists()).to.equal(false)
      expect(calls).to.have.length(1)
    } finally { wrapper.unmount() }
  })
})
