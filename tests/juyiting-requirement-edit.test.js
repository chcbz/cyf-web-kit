import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { effectScope, ref } from 'vue'
import { requirementPickerMaterials, useHallRequirementEdit } from '../src/composables/juyiting/useHallRequirementEdit.js'

const initial = () => ({ taskId: '1', taskVersion: '0', requirementRevision: '1', title: '原事项', description: '原需求', attachments: [{ fileId: 'file', version: 1 }] })
const after = () => ({ ...initial(), taskVersion: '1', requirementRevision: '2', title: '新事项', description: '新需求' })
function fixture(api = {}) {
  const task = ref({ id: '1', taskVersion: '0' }), identity = ref('owner'), enabled = ref(true), saved = []
  const scope = effectScope(), writes = []
  const agentApi = { get: async () => initial(), put: async (url, body, options) => { writes.push({ url, body, options }); return after() }, ...api }
  const editor = scope.run(() => useHallRequirementEdit({ agentApi, task: () => task.value, identity: () => identity.value, enabled: () => enabled.value, onSaved: value => saved.push(value) }))
  return { editor, scope, task, identity, enabled, saved, writes }
}
const values = () => ({ title: '新事项', description: '新需求', attachments: [{ fileId: 'file', version: 1, displayName: '不上传展示字段' }] })
describe('待承办事项真实需求编辑', () => {
  it('reads current source and saves one full versioned requirement; saved event triggers recommendation once', async () => {
    const f = fixture()
    try {
      expect(await f.editor.load()).to.equal(true)
      expect(f.writes).to.have.length(0)
      expect(await f.editor.save(values())).to.equal(true)
      expect(f.writes).to.have.length(1)
      expect(f.writes[0].body).to.deep.equal({ expectedTaskVersion: '0', expectedRequirementRevision: '1', title: '新事项', description: '新需求', attachments: [{ fileId: 'file', version: 1 }] })
      expect(f.writes[0].options.headers['Idempotency-Key']).to.be.a('string')
      expect(f.saved).to.have.length(1)
      expect(f.editor.pending.value).to.equal(null)
      expect(f.editor.blocked.value).to.equal(false)
    } finally { f.scope.stop() }
  })
  it('leaves cancellation as read-only and rejects blank title without a write', async () => {
    const f = fixture()
    try { await f.editor.load(); expect(await f.editor.save({ ...values(), title: '  ' })).to.equal(false); expect(f.writes).to.have.length(0); expect(f.saved).to.have.length(0) } finally { f.scope.stop() }
  })
  it('retains one exact retry body/key after lost reply and does not emit saved prematurely', async () => {
    const calls = []; let first = true
    const f = fixture({ put: async (url, body, options) => { calls.push({ body, key: options.headers['Idempotency-Key'] }); if (first) { first = false; throw new Error('lost reply') } return after() } })
    try {
      await f.editor.load(); expect(await f.editor.save(values())).to.equal(false)
      expect(f.editor.blocked.value).to.equal(true); expect(f.saved).to.have.length(0)
      expect(await f.editor.save({ ...values(), title: '不替换原请求' })).to.equal(true)
      expect(calls[1]).to.deep.equal(calls[0]); expect(f.saved).to.have.length(1)
    } finally { f.scope.stop() }
  })
  it('can query an unknown save without resubmitting', async () => {
    let reads = 0
    const f = fixture({ get: async () => ++reads === 1 ? initial() : after(), put: async () => { throw new Error('lost reply') } })
    try { await f.editor.load(); await f.editor.save(values()); expect(await f.editor.check()).to.equal(true); expect(f.saved).to.have.length(1); expect(f.editor.pending.value).to.equal(null) } finally { f.scope.stop() }
  })
  it('conflict preserves the edit snapshot and never triggers recommendation', async () => {
    const f = fixture({ put: async () => { throw Object.assign(new Error('state changed'), { status: 409 }) } })
    try { await f.editor.load(); expect(await f.editor.save(values())).to.equal(false); expect(f.saved).to.have.length(0); expect(f.editor.error.value).to.include('已变化'); expect(f.editor.snapshot.value.title).to.equal('原事项'); expect(f.editor.pending.value).to.equal(null) } finally { f.scope.stop() }
  })
  it('late load/save cannot cross an identity or matter switch', async () => {
    let finish
    const f = fixture({ put: () => new Promise(resolve => { finish = resolve }) })
    try { await f.editor.load(); const saving = f.editor.save(values()); f.identity.value = 'other'; finish(after()); expect(await saving).to.equal(false); expect(f.saved).to.have.length(0); expect(f.editor.snapshot.value).to.equal(null) } finally { f.scope.stop() }
  })
  it('state does not permit edits after assignment and disabled reads have no side effects', async () => {
    const f = fixture()
    try { f.enabled.value = false; expect(await f.editor.load()).to.equal(false); expect(await f.editor.save(values())).to.equal(false); expect(f.writes).to.have.length(0) } finally { f.scope.stop() }
  })
})

describe('requirement edit later authoritative state fencing', () => {
  it('does not overwrite a newer task version with a late save receipt', async () => {
    let finish
    const f = fixture({ put: () => new Promise(resolve => { finish = resolve }) })
    try { await f.editor.load(); const saving = f.editor.save(values()); f.task.value = { id: '1', taskVersion: '2' }; finish(after()); expect(await saving).to.equal(false); expect(f.saved).to.have.length(0) } finally { f.scope.stop() }
  })
})

describe('shared matter edit Q/R wire fixture', () => {
  it('consumer uses the same request and canonical receipt as the API fixture', async () => {
    const wire = JSON.parse(readFileSync(new URL('./fixtures/matter-requirement-edit-v1.json', import.meta.url)))
    const before = { ...wire.response.data, taskVersion: '0', requirementRevision: '1' }
    let captured
    const f = fixture({ get: async () => before, put: async (url, body) => { captured = { url, body }; return wire.response.data } })
    try {
      await f.editor.load()
      await f.editor.save({ title: '事项标题', description: '需求', attachments: wire.response.data.attachments })
      expect(captured).to.deep.equal({ url: wire.request.path.replace('/agent', ''), body: wire.request.body.data })
      expect(f.saved[0]).to.deep.equal(wire.response.data)
    } finally { f.scope.stop() }
  })
})


describe('actual workspace picker version boundary', () => {
  it('loads numeric edit snapshots back into canonical picker strings without selecting a newer version', () => {
    expect(requirementPickerMaterials(initial().attachments)).to.deep.equal([{ fileId: 'file', version: '1', displayName: '资料 file' }])
  })
  it('saves real picker string versions as the exact numeric edit contract and accepts the receipt', async () => {
    const f = fixture()
    try {
      await f.editor.load()
      expect(await f.editor.save({ ...values(), attachments: [{ fileId: 'file', version: '1' }] })).to.equal(true)
      expect(f.writes[0].body.attachments).to.deep.equal([{ fileId: 'file', version: 1 }])
      expect(f.saved).to.have.length(1)
    } finally { f.scope.stop() }
  })
  it('rejects out-of-range or fractional picker versions without a write or pending recovery', async () => {
    for (const version of ['2147483648', '1.5']) {
      const f = fixture()
      try {
        await f.editor.load()
        expect(await f.editor.save({ ...values(), attachments: [{ fileId: 'file', version }] })).to.equal(false)
        expect(f.writes).to.have.length(0); expect(f.editor.pending.value).to.equal(null)
      } finally { f.scope.stop() }
    }
  })
})
