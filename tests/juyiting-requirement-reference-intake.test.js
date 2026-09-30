import { expect } from 'chai'
import { before, after } from 'mocha'
import { readFileSync } from 'node:fs'
import { ref, nextTick } from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { createRequirementCreateIntentStore, requirementCreateBody, requirementCreateReceipt, requirementReferenceInputs } from '../src/composables/juyiting/hallRequirementCreateIntent.js'
import { useHallRequirementCreate } from '../src/composables/juyiting/useHallRequirementCreate.js'
import { createPointAndStartIntentStore, exactPointAndStartScope, pointAndStartBody } from '../src/composables/juyiting/hallPointAndStartIntent.js'
import { useHallPointAndStart } from '../src/composables/juyiting/useHallPointAndStart.js'

const scopeA = '0\u0000client-a\u0000owner-a', scopeB = '0\u0000client-a\u0000owner-b'
const image = (version = 2) => ({ fileId: 'pwf_image', version, purpose: 'REFERENCE' })
const payload = (inputRefs = [image()]) => ({ title: ' 画一只鸟🦜 ', description: '完整原文\n照片风格\n', requiredAbilities: ['image'], inputRefs })
const intent = body => ({ schemaVersion: 1, key: 'original-key', body: requirementCreateBody(body || payload()), receipt: null })
const receipt = (record, taskId = 'task-1') => ({ schemaVersion: 1, operationId: 'atco_1', taskId,
  requirementRevision: 1, state: 'COMMITTED', inputRefs: record.body.inputRefs, task: { id: taskId, title: 'bird', status: 'open' } })
const flush = async () => { for (let i = 0; i < 8; i++) { await Promise.resolve(); await nextTick() } }
const memoryStorage = () => {
  const rows = new Map()
  return { rows, getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value), removeItem: key => rows.delete(key) }
}
const harness = ({ storage = memoryStorage(), scope = ref(scopeA), epoch = ref(1), post, get, onCommitted } = {}) => {
  const calls = [], adopted = []; let keyCount = 0
  const api = {
    create: async (path, body, options) => { calls.push({ method: 'POST', path, body, key: options.headers['Idempotency-Key'] }); return post ? post(body) : { data: receipt({ body }) } },
    get: async (path, _query, options) => { calls.push({ method: 'GET', path, key: options.headers['Idempotency-Key'] }); return get ? get() : { data: receipt(intent()) } }
  }
  const h = useHallRequirementCreate({ agentApi: api, actorScopeKey: scope, identityEpoch: epoch, storage,
    createIdempotencyKey: () => `create-${++keyCount}`, onCommitted: onCommitted || ((value, fence) => { if (!fence.isCurrent()) return false; adopted.push(value); return true }) })
  return { ...h, storage, calls, adopted, scope, epoch, keyCount: () => keyCount }
}
const cleanup = [], owned = value => { cleanup.push(value); return value }

describe('exact requirement/reference create contract', () => {
  afterEach(() => { for (const h of cleanup.splice(0)) h.dispose() })
  it('preserves long Unicode/null/empty original text without task_plan truncation or latest substitution', () => {
    const body = requirementCreateBody({ title: '🦜'.repeat(300), description: '', inputRefs: [image(1)] })
    expect(body.title).to.equal('🦜'.repeat(300)); expect(body.description).to.equal('')
    expect(body.reward).to.equal(null); expect(body.requiredAbilities).to.equal(null); expect(body.inputRefs).to.deep.equal([image(1)])
    expect(requirementCreateBody({ title: 'bird' }).description).to.equal(null)
    expect(requirementCreateBody({ title: 'bird', description: ' ' }).description).to.equal(' ')
  })
  it('allows empty references and canonicalizes only exact selection ordering', () => {
    expect(requirementCreateBody({ title: 'bird' }).inputRefs).to.deep.equal([])
    const other = { fileId: 'pwf_a', version: 4, purpose: 'REFERENCE' }
    expect(requirementReferenceInputs([image(), other])).to.deep.equal([other, image()])
  })
  for (const [name, refs] of [
    ['duplicate', [image(), image()]], ['wrong purpose', [{ ...image(), purpose: 'INPUT' }]],
    ['fractional version', [image(1.2)]], ['out-of-INT version', [image(2147483648)]],
    ['fake owner', [{ ...image(), owner: 'other' }]], ['latest marker', [image('latest')]],
    ['too many refs', Array.from({ length: 33 }, (_, n) => ({ ...image(), fileId: `pwf_${n}` }))]
  ]) it(`rejects ${name} rather than silently filtering material`, () => { expect(requirementReferenceInputs(refs)).to.equal(null) })
  for (const key of ['owner', 'tenantId', 'grossBountyAmountMicro', 'grantId', 'targetAgentId', 'costAuthorizationRef'])
    it(`cannot reinterpret ${key} as ordinary task creation authority`, () => { expect(requirementCreateBody({ ...payload(), [key]: 'fake' })).to.equal(null) })
  it('persists actual NUL-separated scope, encoding keys and isolating owners', () => {
    const storage = memoryStorage(), a = createRequirementCreateIntentStore({ storage, scope: scopeA })
    expect(a.write(intent()).state).to.equal('PRESENT'); expect(a.read().record.body).to.deep.equal(intent().body)
    expect(createRequirementCreateIntentStore({ storage, scope: scopeB }).read().state).to.equal('ABSENT')
    expect([...storage.rows.keys()][0]).to.include('%00')
  })
  it('never overwrites unresolved key/body or accepts null-body/future-schema records', () => {
    const store = createRequirementCreateIntentStore({ storage: memoryStorage(), scope: scopeA })
    store.write(intent())
    for (const value of [{ ...intent(), key: 'new' }, { ...intent(), body: null }, { ...intent(), schemaVersion: 2 }]) expect(store.write(value).state).to.equal('CORRUPT')
    expect(store.read().record).to.deep.equal(intent())
  })
  it('rejects mismatching media/task receipt; exact verified receipt is required to settle', () => {
    const store = createRequirementCreateIntentStore({ storage: memoryStorage(), scope: scopeA }), original = intent()
    store.write(original)
    for (const value of [{ ...receipt(original), inputRefs: [image(3)] }, { ...receipt(original), task: { id: 'other' } }, { ...receipt(original), grant: 'fake' }])
      expect(requirementCreateReceipt(value, original)).to.equal(null)
    expect(store.settle(original).state).to.equal('CORRUPT')
    const confirmed = { ...original, receipt: receipt(original) }
    expect(store.write(confirmed).state).to.equal('PRESENT'); expect(store.settle(confirmed).state).to.equal('ABSENT')
  })
  it('POSTs one atomic operation, not independent legacy task/link writes', async () => {
    const h = owned(harness())
    expect(await h.create(payload())).to.equal(true)
    expect(h.calls).to.deep.equal([{ method: 'POST', path: '/tasks/creation-operations', body: intent().body, key: 'create-1' }])
    expect(h.adopted[0].task.id).to.equal('task-1'); expect(h.readOriginal().state).to.equal('ABSENT')
  })
  it('double-clicks or payload edits in flight cannot replace fixed body/key', async () => {
    let resolve
    const h = owned(harness({ post: body => new Promise(done => { resolve = () => done({ data: receipt({ body }) }) }) }))
    const p = payload(), pending = h.create(p); p.title = 'new draft'; p.inputRefs[0].version = 5
    expect(await h.create(payload([]))).to.equal(false); expect(h.calls).to.have.length(1); expect(h.keyCount()).to.equal(1)
    expect(h.calls[0].body).to.deep.equal(intent().body); resolve(); expect(await pending).to.equal(true)
  })
  it('network-unknown POST retains original and blocks new-key create', async () => {
    const h = owned(harness({ post: () => { throw new TypeError('network') } }))
    expect(await h.create(payload())).to.equal(false); expect(h.state.value.status).to.equal('UNKNOWN')
    expect(await h.create({ title: 'different', inputRefs: [] })).to.equal(false)
    expect(h.calls).to.have.length(1); expect(h.keyCount()).to.equal(1); expect(h.readOriginal().record.key).to.equal('create-1')
  })
  it('remount only GETs; unknown 404 never clears or silently replays', async () => {
    const storage = memoryStorage(); createRequirementCreateIntentStore({ storage, scope: scopeA }).write(intent())
    const h = owned(harness({ storage, get: () => { throw Object.assign(new Error('unknown'), { status: 404 }) } }))
    await flush(); expect(h.calls.map(c => c.method)).to.deep.equal(['GET']); expect(h.state.value.status).to.equal('UNKNOWN')
    expect(h.readOriginal().record.key).to.equal('original-key'); expect(await h.create(payload())).to.equal(false); expect(h.calls).to.have.length(1)
    expect(await h.resumeOriginal()).to.equal(true)
    expect(h.calls[1]).to.deep.equal({ method: 'POST', path: '/tasks/creation-operations', key: 'original-key', body: intent().body })
  })
  it('known committed receipt only GETs even when explicitly resumed', async () => {
    const storage = memoryStorage(), original = intent()
    createRequirementCreateIntentStore({ storage, scope: scopeA }).write({ ...original, receipt: receipt(original) })
    const h = owned(harness({ storage, onCommitted: () => false }))
    await flush(); expect(await h.resumeOriginal()).to.equal(false); expect(h.calls.map(c => c.method)).to.deep.equal(['GET', 'GET'])
    expect(h.state.value.intent.receipt.taskId).to.equal('task-1')
  })
  for (const boundary of ['scope', 'epoch', 'dispose']) it(`fences late POST at ${boundary} boundary`, async () => {
    let resolve
    const h = owned(harness({ post: body => new Promise(done => { resolve = () => done({ data: receipt({ body }) }) }),
      get: () => { throw Object.assign(new Error('unknown'), { status: 404 }) } }))
    const pending = h.create(payload())
    if (boundary === 'scope') h.scope.value = scopeB
    if (boundary === 'epoch') h.epoch.value++
    if (boundary === 'dispose') h.dispose()
    resolve(); expect(await pending).to.equal(false); await flush(); expect(h.adopted).to.deep.equal([])
    expect(createRequirementCreateIntentStore({ storage: h.storage, scope: scopeA }).read().record.receipt).to.equal(null)
    expect(h.calls.filter(c => c.method === 'POST')).to.have.length(1)
  })
  it('corrupt/unavailable records and failed write readback are never absent/writable', async () => {
    const storage = memoryStorage(); createRequirementCreateIntentStore({ storage, scope: scopeA }).write(intent()); storage.rows.set([...storage.rows.keys()][0], '{corrupt')
    const corrupt = owned(harness({ storage })); expect(await corrupt.create(payload())).to.equal(false); expect(corrupt.state.value.status).to.equal('STORAGE_CORRUPT')
    const unavailable = owned(harness({ storage: { getItem: () => { throw new Error('denied') } } }))
    const badWrite = owned(harness({ storage: { getItem: () => null, setItem: () => {} } }))
    for (const h of [corrupt, unavailable, badWrite]) { expect(await h.create(payload())).to.equal(false); expect(h.calls).to.deep.equal([]) }
  })
  it('cleanup failure retains known committed receipt and never creates another operation', async () => {
    const storage = memoryStorage(); storage.removeItem = () => { throw new Error('denied') }
    const h = owned(harness({ storage }))
    expect(await h.create(payload())).to.equal(false); expect(h.state.value.status).to.equal('COMMITTED')
    expect(h.state.value.intent.receipt.taskId).to.equal('task-1'); expect(await h.create(payload())).to.equal(false); expect(h.calls).to.have.length(1)
  })
  it('incompatible/grant-looking responses never acknowledge successful task creation', async () => {
    for (const value of [{ grantId: 'g', taskId: 'task-1' }, { ...receipt(intent()), requirementRevision: 2 }, { ...receipt(intent()), inputRefs: [image(6)] }]) {
      const h = owned(harness({ post: () => ({ data: value }) }))
      expect(await h.create(payload())).to.equal(false); expect(h.adopted).to.deep.equal([]); expect(h.readOriginal().record.receipt).to.equal(null)
    }
  })
  it('existing point-and-start actually reads original intent with real Hall namespace', async () => {
    expect(exactPointAndStartScope(scopeA)).to.equal(true)
    const storage = memoryStorage(), body = pointAndStartBody({ agentId: 'agent-1', taskVersion: '0', requirementRevision: '1', requestedOperations: ['GENERATE_IMAGE'], initialOperation: 'GENERATE_IMAGE' })
    const record = { schemaVersion: 1, taskId: 'task-1', key: 'assign-key', body, postAcknowledged: false, grant: null, projection: null }
    expect(createPointAndStartIntentStore({ storage, scope: scopeA, taskId: 'task-1' }).write(record).state).to.equal('PRESENT')
    let reads = 0
    const h = owned(useHallPointAndStart({ agentApi: { get: async () => { reads++; throw Object.assign(new Error('unknown'), { status: 404 }) } }, actorScopeKey: ref(scopeA), storage }))
    expect(await h.checkOriginal('task-1')).to.equal(false); expect(reads).to.equal(1); expect(h.state.value.intent.key).to.equal('assign-key')
  })
})

const page = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
const actualCreate = page.match(/const createTask = async \(payload, acknowledge = \(\) => \{\}\) => \{([\s\S]*?)\n\}\nconst resumeFundedCreate/)?.[1]
if (!actualCreate) throw new Error('Actual JuyiHall create closure missing')
const pageHarness = ({ ordinary = { state: 'ABSENT' }, fundedRecovery = null } = {}) => {
  const h = { ordinary: [], funded: [], toasts: [], acknowledgements: [] }
  const deps = { readRequirementCreateOriginal: () => ordinary, showToast: text => h.toasts.push(text), runCreateTask: async p => { h.funded.push(p); return true },
    markTaskCreated: () => {}, selectedTask: ref({ id: 'funded-task' }), fundedCreateRecovery: ref(fundedRecovery),
    runRequirementCreate: async p => { h.ordinary.push(p); return true }, requirementCreateState: ref({ error: null }) }
  h.create = new Function(...Object.keys(deps), `return async (payload, acknowledge = () => {}) => {${actualCreate}}`)(...Object.values(deps))
  return h
}
describe('actual JuyiHall ordinary/funded boundary', () => {
  it('uses atomic ordinary creation and separate funded route with definitive acknowledgements', async () => {
    const h = pageHarness()
    expect(await h.create(payload(), ok => h.acknowledgements.push(ok))).to.equal(true)
    expect(h.ordinary).to.deep.equal([payload()]); expect(h.funded).to.deep.equal([]); expect(h.acknowledgements).to.deep.equal([true])
    expect(await h.create({ title: 'funded', grossBountyAmountMicro: '5' })).to.equal(true); expect(h.funded).to.have.length(1)
  })
  for (const state of ['PRESENT', 'CORRUPT', 'UNAVAILABLE']) it(`cannot replace ${state} ordinary intent via funded creation`, async () => {
    const h = pageHarness({ ordinary: { state } }); expect(await h.create({ title: 'funded', grossBountyAmountMicro: '5' })).to.equal(false)
    expect(h.funded).to.deep.equal([]); expect(h.ordinary).to.deep.equal([])
  })
  it('does not mix references with funding or bypass unresolved funded-create recovery', async () => {
    const h = pageHarness({ fundedRecovery: { key: 'funding-original' } })
    expect(await h.create(payload())).to.equal(false)
    expect(await h.create({ title: 'funded', grossBountyAmountMicro: '5', inputRefs: [image()] })).to.equal(false)
    expect(h.funded).to.deep.equal([]); expect(h.ordinary).to.deep.equal([])
  })
  it('compiles actual changed SFCs and wires exact recovery handlers', () => {
    for (const name of ['world/JuyiHall.vue', 'juyiting/BountyPanel.vue']) {
      const filename = new URL(`../src/components/${name}`, import.meta.url).pathname
      const { descriptor, errors } = parse(readFileSync(filename, 'utf8'), { filename }); expect(errors).to.deep.equal([])
      const script = compileScript(descriptor, { id: 'reference-intake' })
      expect(compileTemplate({ source: descriptor.template.content, filename, id: 'reference-intake', compilerOptions: { bindingMetadata: script.bindings } }).errors).to.deep.equal([])
    }
    expect(page).to.include('@check-requirement-create="checkRequirementCreate"'); expect(page).to.include('@resume-requirement-create="resumeRequirementCreate"')
  })
})

// Compile and mount the actual parent SFC; the selection child is a bounded
// emission stub here. Its real workspace/Blob ACL tests belong to picker suite.
let Vue, mount, Panel, Picker
const wrappers = [], domDescriptors = {}
const panelProps = () => ({ identityScope: scopeA, authorizationGeneration: 1, fundedPreviewEnabled: true,
  abilityText: () => '', canAssign: () => false, formatTime: () => '', portraitName: () => '', portraitStyle: () => ({}),
  taskAgentMatchScore: () => 0, taskStateClass: () => '', taskStatusCount: () => 0, taskStatusText: () => '' })
const action = (wrapper, text) => {
  const found = wrapper.findAll('button').find(button => button.text() === text)
  expect(found, `missing button ${text}`).to.exist; return found
}
const openDraft = async wrapper => { await action(wrapper, '张榜').trigger('click') }
const setDraft = async (wrapper, title = '画一只鸟') => {
  await wrapper.find('[name="taskTitle"]').setValue(title)
  await wrapper.find('[name="taskDescription"]').setValue('照片风格')
}
describe('mounted Bounty requirement draft and original recovery', () => {
  before(async () => {
    for (const key of ['SVGElement', 'Element', 'Node']) {
      domDescriptors[key] = Object.getOwnPropertyDescriptor(globalThis, key)
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: window[key] })
    }
    Vue = await import('vue'); ({ mount } = await import('@vue/test-utils'))
    Picker = Vue.defineComponent({ name: 'HallReferenceImagePicker', props: ['modelValue', 'identityScope', 'identityEpoch', 'disabled'], emits: ['update:modelValue'], render: () => Vue.h('span', { class: 'picker-boundary' }) })
    const filename = new URL('../src/components/juyiting/BountyPanel.vue', import.meta.url).pathname
    const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
    const silver = await import('../src/utils/silverAmount.js')
    const imports = new Proxy({ vue: Vue, '@/utils/silverAmount': silver, './HallReferenceImagePicker.vue': Picker }, {
      get: (target, name) => target[name] ?? Vue.defineComponent({ render: () => Vue.h('span') })
    })
    const code = compileScript(descriptor, { id: 'mounted-reference-intake', inlineTemplate: true }).content
      .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_, names, path) =>
        `const { ${names.split(',').map(name => name.trim().replace(/\s+as\s+/, ': ')).join(', ')} } = imports[${JSON.stringify(path)}]`)
      .replace(/^import\s+([^\s]+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_, name, path) => `const ${name} = imports[${JSON.stringify(path)}]`)
      .replace('export default', 'return')
    Panel = new Function('imports', code)(imports)
  })
  afterEach(() => { for (const wrapper of wrappers.splice(0)) wrapper.unmount() })
  after(() => {
    for (const key of Object.keys(domDescriptors)) {
      if (domDescriptors[key]) Object.defineProperty(globalThis, key, domDescriptors[key])
      else delete globalThis[key]
    }
  })
  const panel = (props = {}) => { const wrapper = mount(Panel, { props: { ...panelProps(), ...props } }); wrappers.push(wrapper); return wrapper }
  it('submits optional exact reference selection from the real pre-task form; no guessed taskId', async () => {
    const wrapper = panel(); await openDraft(wrapper); await setDraft(wrapper)
    const selector = wrapper.getComponent(Picker)
    expect(selector.props('identityScope')).to.equal(scopeA)
    expect(selector.props('identityEpoch')).to.equal(1)
    selector.vm.$emit('update:modelValue', [image()]); await nextTick()
    await wrapper.find('form').trigger('submit')
    const [body, acknowledge] = wrapper.emitted('create-task')[0]
    expect(body).to.deep.equal({ title: '画一只鸟', description: '照片风格', requiredAbilities: [], inputRefs: [image()] })
    expect(body).not.to.have.property('taskId')
    acknowledge(true); await nextTick(); expect(wrapper.find('form').exists()).to.equal(false)
  })
  it('allows a no-reference draft and retains edited text/reference after an older success', async () => {
    const wrapper = panel(); await openDraft(wrapper); await setDraft(wrapper)
    await wrapper.find('form').trigger('submit')
    const [body, acknowledge] = wrapper.emitted('create-task')[0]; expect(body.inputRefs).to.deep.equal([])
    await wrapper.find('[name="taskTitle"]').setValue('新稿：画一只蓝鸟')
    wrapper.getComponent(Picker).vm.$emit('update:modelValue', [image(3)]); await nextTick()
    acknowledge(true); await nextTick()
    expect(wrapper.find('form').exists()).to.equal(true); expect(wrapper.find('[name="taskTitle"]').element.value).to.equal('新稿：画一只蓝鸟')
    expect(wrapper.getComponent(Picker).props('modelValue')).to.deep.equal([image(3)])
  })
  it('identity changes clear the old draft and late acknowledgement cannot clear a new actor draft', async () => {
    const wrapper = panel(); await openDraft(wrapper); await setDraft(wrapper)
    wrapper.getComponent(Picker).vm.$emit('update:modelValue', [image()]); await nextTick()
    await wrapper.find('form').trigger('submit'); const oldAck = wrapper.emitted('create-task')[0][1]
    await wrapper.setProps({ identityScope: scopeB, authorizationGeneration: 2 })
    expect(wrapper.find('[name="taskTitle"]').element.value).to.equal(''); expect(wrapper.getComponent(Picker).props('modelValue')).to.deep.equal([])
    await setDraft(wrapper, '另一个用户的新稿'); await wrapper.find('form').trigger('submit')
    oldAck(true); await nextTick()
    expect(wrapper.find('[name="taskTitle"]').element.value).to.equal('另一个用户的新稿')
    expect(action(wrapper, '张榜中…').attributes()).to.have.property('disabled')
    wrapper.emitted('create-task')[1][1](false); await nextTick()
    expect(wrapper.find('[name="taskTitle"]').element.value).to.equal('另一个用户的新稿')
  })
  it('shows immutable unknown original refs and emits explicit check/resume instead of resubmitting current draft', async () => {
    const wrapper = panel({ requirementCreateState: { status: 'UNKNOWN', intent: intent(), error: '结果未知' } })
    expect(wrapper.find('.requirement-create-recovery').text()).to.include('pwf_image v2')
    await action(wrapper, '核对原张榜').trigger('click'); await action(wrapper, '确认继续原张榜').trigger('click')
    expect(wrapper.emitted('check-requirement-create')).to.have.length(1)
    expect(wrapper.emitted('resume-requirement-create')).to.have.length(1)
    expect(wrapper.emitted('create-task')).to.equal(undefined)
  })
  it('never submits hidden ordinary refs as a funded draft', async () => {
    const wrapper = panel(); await openDraft(wrapper); await setDraft(wrapper)
    wrapper.getComponent(Picker).vm.$emit('update:modelValue', [image()]); await nextTick()
    await wrapper.find('.funded-create-toggle input').setValue(true)
    await wrapper.find('[name="grossBountyAmountMicro"]').setValue('5')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.emitted('create-task')).to.equal(undefined)
    expect(wrapper.text()).to.include('资金榜暂不支持普通榜参考图')
  })
})
