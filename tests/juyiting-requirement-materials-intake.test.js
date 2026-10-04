import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { ref, nextTick } from 'vue'
import { createRequirementCreateIntentStore, requirementCreateBody, requirementMaterialInputs, requirementMaterialsBody, requirementMaterialsReceipt } from '../src/composables/juyiting/hallRequirementCreateIntent.js'
import { useHallRequirementCreate } from '../src/composables/juyiting/useHallRequirementCreate.js'

const scopeA = '0\u0000client\u0000owner-a', scopeB = '0\u0000client\u0000owner-b'
const attachments = () => ['audio', 'document', 'image', 'text'].map(kind => ({ fileId: `pwf_${kind}`, version: 2 }))
const draft = () => ({ title: ' 汇总资料🦜 ', description: '完整需求\n', attachments: attachments() })
const intent = (schemaVersion = 2) => ({ schemaVersion, key: 'original-key', receipt: null,
  body: schemaVersion === 2 ? requirementMaterialsBody(draft()) : requirementCreateBody({ title: '旧需求', inputRefs: [{ fileId: 'old', version: 1, purpose: 'REFERENCE' }] }) })
const receipt = record => ({ schemaVersion: record.schemaVersion, operationId: record.schemaVersion === 2 ? 'atco2_1' : 'atco_1', taskId: 'task-1',
  requirementRevision: 1, state: 'COMMITTED', task: { id: 'task-1' },
  ...(record.schemaVersion === 2 ? { attachments: record.body.attachments } : { inputRefs: record.body.inputRefs }) })
const memoryStorage = () => {
  const rows = new Map()
  return { rows, getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value), removeItem: key => rows.delete(key) }
}
const flush = async () => { for (let i = 0; i < 8; i++) { await Promise.resolve(); await nextTick() } }
const owned = []
const harness = ({ storage = memoryStorage(), post, get, onCommitted, schemaVersion = 2 } = {}) => {
  const calls = [], adopted = [], scope = ref(scopeA), epoch = ref(1)
  const api = {
    create: async (path, body, options) => { calls.push({ method: 'POST', path, body, key: options.headers['Idempotency-Key'] }); return post ? post(body) : { data: receipt({ schemaVersion: path.endsWith('/v2') ? 2 : 1, body }) } },
    get: async (path, _query, options) => { calls.push({ method: 'GET', path, key: options.headers['Idempotency-Key'] }); return get ? get() : { data: receipt(intent(path.includes('/v2/') ? 2 : 1)) } }
  }
  const h = useHallRequirementCreate({ agentApi: api, storage, schemaVersion, actorScopeKey: scope, identityEpoch: epoch,
    createIdempotencyKey: () => 'new-key', onCommitted: onCommitted || (value => { adopted.push(value); return true }) })
  owned.push(h)
  return { ...h, calls, adopted, storage, scope, epoch }
}

describe('neutral materials v2 atomic creation and immutable dual-version recovery', () => {
  afterEach(() => { owned.splice(0).forEach(h => h.dispose()) })
  it('preserves complete text, supports mixed selections without MIME/purpose and permits no materials', () => {
    const body = requirementMaterialsBody(draft())
    expect(body.title).to.equal(' 汇总资料🦜 '); expect(body.description).to.equal('完整需求\n')
    expect(body.attachments).to.deep.equal(attachments())
    expect(requirementMaterialsBody({ title: '讨论', attachments: [] }).attachments).to.deep.equal([])
    expect(requirementMaterialsBody({ title: '讨论' }).attachments).to.deep.equal([])
    expect(requirementMaterialsBody({ title: '讨论', attachments: null })).to.equal(null)
  })
  it('sorts exact IDs by UTF-8 bytes rather than UTF-16, retaining the selected version', () => {
    expect(requirementMaterialInputs([{ fileId: '𐀀', version: 1 }, { fileId: '\uE000', version: 3 }, { fileId: '\uE000', version: 1 }]))
      .to.deep.equal([{ fileId: '\uE000', version: 1 }, { fileId: '\uE000', version: 3 }, { fileId: '𐀀', version: 1 }])
  })
  for (const field of ['purpose', 'role', 'contentMimeType', 'owner', 'url', 'path', 'operation']) it(`rejects attachment ${field} rather than granting client-supplied authority`, () => {
    expect(requirementMaterialsBody({ ...draft(), attachments: [{ ...attachments()[0], [field]: 'x' }] })).to.equal(null)
  })
  for (const [name, list] of [
    ['duplicates', [attachments()[0], attachments()[0]]], ['latest', [{ fileId: 'a', version: 'latest' }]],
    ['overflow', [{ fileId: 'a', version: 2147483648 }]], ['invalid Unicode', [{ fileId: '\uD800', version: 1 }]],
    ['capacity', Array.from({ length: 33 }, (_, n) => ({ fileId: `f${n}`, version: 1 }))]
  ]) it(`rejects ${name} without dropping selected material`, () => { expect(requirementMaterialInputs(list)).to.equal(null) })
  it('rejects image-only contract and execution/funding fields in v2', () => {
    for (const key of ['inputRefs', 'grossBountyAmountMicro', 'targetAgentId', 'costAuthorizationRef'])
      expect(requirementMaterialsBody({ ...draft(), [key]: [] })).to.equal(null)
    expect(requirementMaterialsBody({ ...draft(), description: '\uD800' })).to.equal(null)
  })
  it('submits one neutral atomic operation with no per-file link calls', async () => {
    const h = harness(); expect(await h.create(draft())).to.equal(true)
    expect(h.calls).to.deep.equal([{ method: 'POST', path: '/tasks/creation-operations/v2', body: requirementMaterialsBody(draft()), key: 'new-key' }])
    expect(h.adopted).to.have.length(1); expect(h.readOriginal().state).to.equal('ABSENT')
  })
  it('freezes body/key through edits, double-click and unknown response', async () => {
    let reject
    const h = harness({ post: () => new Promise((_, fail) => { reject = fail }) }), input = draft()
    const pending = h.create(input); input.attachments[0].version = 7; input.title = 'changed'
    expect(await h.create(input)).to.equal(false)
    reject(new TypeError('network')); expect(await pending).to.equal(false)
    expect(await h.create(input)).to.equal(false)
    expect(h.calls).to.have.length(1); expect(h.readOriginal().record.body).to.deep.equal(requirementMaterialsBody(draft()))
  })
  for (const version of [1, 2]) it(`new v2 UI restores schema${version} using only its original route/key/body`, async () => {
    const storage = memoryStorage(), record = intent(version)
    createRequirementCreateIntentStore({ storage, scope: scopeA }).write(record)
    const h = harness({ storage, get: () => { throw Object.assign(new Error('not found'), { status: 404 }) } })
    await flush()
    const path = `/tasks/creation-operations${version === 2 ? '/v2' : ''}`
    expect(h.calls).to.deep.equal([{ method: 'GET', path: `${path}/request`, key: record.key }])
    expect(await h.create(draft())).to.equal(false); expect(h.calls).to.have.length(1)
    expect(await h.resumeOriginal()).to.equal(true)
    expect(h.calls[1]).to.deep.equal({ method: 'POST', path, key: record.key, body: record.body })
  })
  it('a v2 record survives old API 404 without downgrading, rewriting or retrying automatically', async () => {
    const h = harness({ post: () => { throw Object.assign(new Error('unsupported'), { status: 404 }) } })
    expect(await h.create(draft())).to.equal(false); expect(h.readOriginal().record.schemaVersion).to.equal(2)
    const record = h.readOriginal().record; h.dispose()
    const restored = harness({ storage: h.storage, schemaVersion: 1, get: () => { throw Object.assign(new Error('unsupported'), { status: 404 }) } })
    await flush(); expect(restored.calls).to.deep.equal([{ method: 'GET', path: '/tasks/creation-operations/v2/request', key: 'new-key' }])
    expect(restored.readOriginal().record).to.deep.equal(record)
  })
  it('cannot replace a pending v1 record with a new v2 body even under the same key', () => {
    const store = createRequirementCreateIntentStore({ storage: memoryStorage(), scope: scopeA })
    expect(store.write(intent(1)).state).to.equal('PRESENT')
    expect(store.write(intent(2)).state).to.equal('CORRUPT'); expect(store.read().record).to.deep.equal(intent(1))
  })
  for (const invalid of [receipt(intent(1)), { ...receipt(intent()), attachments: [] }, { ...receipt(intent()), task: { id: 'other' } }])
    it('never settles a wrong-schema/selection/task receipt', async () => {
      expect(requirementMaterialsReceipt(invalid, intent())).to.equal(null)
      const h = harness({ post: () => ({ data: invalid }) }); expect(await h.create(draft())).to.equal(false)
      expect(h.adopted).to.deep.equal([]); expect(h.readOriginal().record.receipt).to.equal(null)
    })
  it('known committed v2 receipt reconciles via GET only', async () => {
    const storage = memoryStorage(), record = intent()
    createRequirementCreateIntentStore({ storage, scope: scopeA }).write({ ...record, receipt: receipt(record) })
    const h = harness({ storage, onCommitted: () => false }); await flush(); await h.resumeOriginal()
    expect(h.calls.map(c => c.method)).to.deep.equal(['GET', 'GET'])
    expect(h.state.value.status).to.equal('COMMITTED')
  })
  for (const boundary of ['scope', 'epoch', 'dispose']) it(`fences late v2 responses across ${boundary}`, async () => {
    let resolve
    const h = harness({ post: body => new Promise(done => { resolve = () => done({ data: receipt({ schemaVersion: 2, body }) }) }), get: () => { throw new Error('unknown') } })
    const pending = h.create(draft())
    if (boundary === 'scope') h.scope.value = scopeB
    if (boundary === 'epoch') h.epoch.value++
    if (boundary === 'dispose') h.dispose()
    resolve(); expect(await pending).to.equal(false); await flush()
    expect(h.adopted).to.deep.equal([])
    expect(createRequirementCreateIntentStore({ storage: h.storage, scope: scopeA }).read().record.receipt).to.equal(null)
  })
})

const page = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const quickCreateBody = page.match(/const handleQuickRequest = async request => \{([\s\S]*?)\n\}\n\nconst openOverviewTask/)?.[1]
if (!quickCreateBody) throw new Error('Actual quick creation closure missing')
describe('new product entry wiring, no quick legacy task/link writes', () => {
  it('both forms use one neutral picker and Hall config enables only atomic schema2 for new requirements', () => {
    for (const name of ['HallOverview', 'BountyPanel']) {
      const source = readFileSync(new URL(`../src/components/juyiting/${name}.vue`, import.meta.url), 'utf8')
      expect(source).to.include('import HallMaterialPicker')
      expect(source).not.to.include('HallReferenceImagePicker')
    }
    const setup = page.match(/\} = useHallRequirementCreate\(\{([\s\S]*?)\n\}\)/)?.[1]
    expect(setup).to.include('schemaVersion: 2')
    expect(page).not.to.include('useHallQuickMatter')
  })
  it('quick submission preserves full text and mixed fixed attachments, with one atomic POST and no Provider', async () => {
    const h = harness(), selectedTask = ref(null), opens = [], panels = []
    const createTask = async input => { const ok = await h.create(input); if (ok) selectedTask.value = h.adopted.at(-1).task; return ok }
    const deps = { hallIdentityScope: h.scope, apiStore: { authorizationGeneration: 1 }, createTask,
      requirementCreateState: h.state, openPanel: (...args) => panels.push(args), hallReadRevision: ref(0), selectedTask,
      openOverviewTask: task => opens.push(task) }
    const quick = new Function(...Object.keys(deps), `return async request => {${quickCreateBody}}`)(...Object.values(deps))
    const text = ' 结合图、文档与音频整理方案\n保持完整🦜 '
    expect(await quick({ request: text, materials: attachments() })).to.equal(true)
    expect(h.calls).to.have.length(1)
    expect(h.calls[0].path).to.equal('/tasks/creation-operations/v2')
    expect(h.calls[0].body).to.deep.equal(requirementMaterialsBody({ title: text, description: text, attachments: attachments() }))
    expect(opens).to.deep.equal([]); expect(panels).to.deep.equal([['agents']])
    h.dispose()
  })
  it('quick unknown response opens original recovery without falling back to task/link writes', async () => {
    const h = harness({ post: () => { throw new TypeError('network') } }), panels = [], opens = []
    const deps = { hallIdentityScope: h.scope, apiStore: { authorizationGeneration: 1 }, createTask: input => h.create(input),
      requirementCreateState: h.state, openPanel: (...args) => panels.push(args), hallReadRevision: ref(0), selectedTask: ref(null),
      openOverviewTask: task => opens.push(task) }
    const quick = new Function(...Object.keys(deps), `return async request => {${quickCreateBody}}`)(...Object.values(deps))
    expect(await quick({ request: '整理资料', materials: attachments() })).to.equal(false)
    expect(h.calls).to.have.length(1); expect(opens).to.deep.equal([])
    expect(panels).to.deep.equal([['tasks', { root: true }]])
    expect(h.readOriginal().record.body.attachments).to.deep.equal(attachments())
    h.dispose()
  })
})
