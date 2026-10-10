import { isTerminalMatter } from '../src/composables/juyiting/useHallOrdinaryCancellation.js'
import { before, after } from 'mocha'
import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { compileScript, parse } from '@vue/compiler-sfc'
import { useHallBountyAcceptance } from '../src/composables/juyiting/useHallBountyAcceptance.js'

const scoped = (id = '101', taskId = 'task-1') => ({ id, conversationType: 'juyiting', conversationScopeType: 'bounty', conversationScopeKey: `task:${taskId}` })
const request = (conversationId = '101', _taskId = 'task-1') => ({ requestId: 'request-1', requestRevision: '1', conversationId,
  conversationGeneration: '1', userMessageId: '1', state: 'COMPLETED', stateVersion: '1', turns: [], steps: [] })
const page = (conversationId = '101', taskId = 'task-1', entries = [{ ordinal: '1', request: request(conversationId, taskId) }]) => ({ schemaVersion: 1,
  scope: { conversationId, conversationGeneration: '1', taskId }, after: '0', through: entries.length ? '1' : '0', nextAfter: null, hasMore: false, entries })
const response = value => ({ data: { data: value } })
const deferred = () => { let resolve; return { promise: new Promise(done => { resolve = done }), resolve: value => resolve(value) } }

describe('task acceptance existing scoped source reads', () => {
  const originals = new Map()
  beforeEach(() => {
    for (const key of ['setTimeout', 'clearTimeout']) originals.set(key, globalThis[key])
    globalThis.setTimeout = (fn, delay, ...args) => delay === 2500 ? 999 : originals.get('setTimeout')(fn, delay, ...args)
    globalThis.clearTimeout = id => { if (id !== 999) originals.get('clearTimeout')(id) }
  })
  afterEach(() => { for (const [key, value] of originals) globalThis[key] = value; originals.clear() })
  it('cold-reads a unique task conversation and its durable catalogue, supporting existing callback responses without a write', async () => {
    const calls = []; const api = {
      list: async (path, body, options) => { calls.push([path, body, options.needAuth]); options.onSuccess({ data: [scoped()] }) },
      get: async (path, _params, options) => { calls.push([path, options.needAuth]); return response(page()) },
      execute: () => { throw new Error('read only') }
    }
    const source = useHallBountyAcceptance({ api, taskId: () => 'task-1', identityKey: () => 'owner-1' })
    try {
      await flushPromises()
      expect(source.scope.value).to.deep.equal({ taskId: 'task-1', conversationId: '101' })
      expect(source.catalog.entries.value).to.have.length(1); expect(source.error.value).to.equal('')
      expect(source.legacy.value).to.equal(false)
      expect(calls[0]).to.deep.equal(['/conversation/list', { pageNum: 1, pageSize: 2, orderBy: 'id asc',
        search: { conversationType: 'juyiting', conversationScopeType: 'bounty', conversationScopeKey: 'task:task-1' } }, true])
      expect(calls[1]).to.deep.equal(['/conversations/101/requests', true])
    } finally { source.dispose() }
  })
  it('searches the existing paginated history for the exact original, never substituting its first or latest row', async () => {
    const calls = []; const api = { list: async (_path, body) => { calls.push(body.pageNum); return response(body.pageNum === 1
      ? Array.from({ length: 100 }, (_, i) => scoped(String(i + 1))) : [scoped('999')]) },
    get: async path => { expect(path).to.equal('/conversations/999/requests'); return response(page('999')) } }
    const source = useHallBountyAcceptance({ api, taskId: () => 'task-1', identityKey: () => 'owner-1', conversationId: () => '999' })
    try { await flushPromises(); expect(calls).to.deep.equal([1, 2]); expect(source.scope.value.conversationId).to.equal('999') }
    finally { source.dispose() }
  })
  for (const [label, rows, wanted] of [['ambiguous', [scoped('101'), scoped('102')], ''], ['foreign', [scoped('101', 'foreign')], ''],
    ['missing original', [scoped('102')], '101'], ['unsafe id', [scoped('9007199254740992')], 'bad-id']]) {
    it(`refuses ${label} sources without catalogue access, writes, or a legacy bypass`, async () => {
      let gets = 0
      const source = useHallBountyAcceptance({ api: { list: async () => response(rows), get: async () => { gets++ } },
        taskId: () => 'task-1', identityKey: () => 'owner-1', conversationId: () => wanted })
      try { await flushPromises(); expect(source.scope.value).to.equal(null); expect(source.error.value).not.to.equal(''); expect(gets).to.equal(0); expect(source.legacy.value).to.equal(false) }
      finally { source.dispose() }
    })
  }
  it('retains the old formal domain only for verified absence of native requests, not malformed or failed catalogue reads', async () => {
    for (const [data, legacy] of [[page('101', 'task-1', []), true], [{ schemaVersion: 999 }, false]]) {
      const source = useHallBountyAcceptance({ api: { list: async () => response([scoped()]), get: async () => response(data) },
        taskId: () => 'task-1', identityKey: () => 'owner-1' })
      try { await flushPromises(); expect(source.legacy.value).to.equal(legacy); if (!legacy) expect(source.error.value).not.to.equal('') }
      finally { source.dispose() }
    }
    const absent = useHallBountyAcceptance({ api: { list: async () => response([]) }, taskId: () => 'task-1', identityKey: () => 'owner-1' })
    try { await flushPromises(); expect(absent.legacy.value).to.equal(true) } finally { absent.dispose() }
  })
  it('clears old visible sources on identity/task switches and fences delayed previous-owner responses', async () => {
    const pending = deferred(); const owner = Vue.ref('a'); const task = Vue.ref('task-1'); let first = true; let oldSignal
    const source = useHallBountyAcceptance({ api: {
      list: async (_path, _body, options) => { if (first) { first = false; oldSignal = options.signal; return pending.promise }; return response([scoped('202', 'task-2')]) },
      get: async () => response(page('202', 'task-2'))
    }, taskId: () => task.value, identityKey: () => owner.value })
    try {
      task.value = 'task-2'; owner.value = 'b'; await flushPromises()
      expect(oldSignal.aborted).to.equal(true); expect(source.scope.value.conversationId).to.equal('202')
      pending.resolve(response([scoped()])); await flushPromises()
      expect(source.scope.value).to.deep.equal({ taskId: 'task-2', conversationId: '202' })
      expect(source.catalog.entries.value[0].request.conversationId).to.equal('202'); expect(source.loading.value).to.equal(false)
    } finally { source.dispose() }
  })
  it('fences an old in-flight catalogue and reloads when the explicit conversation changes', async () => {
    const pending = deferred(); const conversation = Vue.ref('101')
    const source = useHallBountyAcceptance({ api: { list: async () => response([scoped('101'), scoped('202')]),
      get: async path => path.includes('/101/') ? pending.promise : response(page('202')) },
    taskId: () => 'task-1', identityKey: () => 'owner-1', conversationId: () => conversation.value })
    try {
      await flushPromises(); conversation.value = '202'; await flushPromises()
      expect(source.scope.value.conversationId).to.equal('202'); expect(source.catalog.entries.value[0].request.conversationId).to.equal('202')
      pending.resolve(response(page())); await flushPromises()
      expect(source.catalog.entries.value[0].request.conversationId).to.equal('202'); expect(source.catalog.loading.value).to.equal(false)
    } finally { source.dispose() }
  })
})

const hall = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
const returnBody = hall.slice(hall.indexOf('const continueBountyModification = async'), hall.indexOf('\nconst openTaskWorkspace ='))
const returnToDiscussion = deps => new Function('deps', 'isTerminalMatter', `var { openPanel, apiStore, hallIdentityScope, chatMode, conversationTask, conversationId,
  isConversationBusy, enterBountyDiscussion, loadHallConversationHistory, conversationHistory, conversationHistoryHasMore,
  conversationHistoryError, loadMoreHallConversationHistory, selectHallConversation, showToast, loadHallMessages } = deps;
  ${returnBody}; return continueBountyModification`)(deps, isTerminalMatter)

describe('task acceptance return to original discussion', () => {
  const deps = () => ({ openPanel: () => true, apiStore: { authorizationGeneration: 1 }, hallIdentityScope: Vue.ref('owner'),
    chatMode: Vue.ref('bounty'), conversationTask: Vue.ref({ id: 'task-1' }), conversationId: Vue.ref('101'), isConversationBusy: Vue.ref(false),
    conversationHistory: Vue.ref([]), conversationHistoryHasMore: Vue.ref(false), conversationHistoryError: Vue.ref(''),
    enterBountyDiscussion: () => { throw new Error('do not reset same discussion target or draft') },
    loadHallConversationHistory: async () => {}, selectHallConversation: async () => true,
    showToast: () => {}, loadHallMessages: async () => { throw new Error('no latest conversation substitution') } })
  it('never resumes discussion for a cancelled task while preserving completed receipt viewing separately', async () => {
    const state = deps(); let opens = 0; state.openPanel = () => { opens++; return true }
    expect(await returnToDiscussion(state)({ id: 'task-1', status: 'cancelled' }, null)).to.equal(false)
    expect(opens).to.equal(0)
  })
  it('returns to an already active original without resets, draft changes, polling restarts or new sends', async () => {
    const state = deps(); state.isConversationBusy.value = true
    state.loadHallConversationHistory = () => { throw new Error('must preserve active discussion') }
    expect(await returnToDiscussion(state)({ id: 'task-1' }, { taskId: 'task-1', conversationId: '101' })).to.equal(true)
  })
  it('returns only to a verified exact original beyond the first history page', async () => {
    const state = deps(); const calls = []
    state.conversationHistoryHasMore.value = true
    state.loadHallConversationHistory = async () => { state.conversationHistory.value = [{ id: '202' }] }
    state.loadMoreHallConversationHistory = async () => { calls.push('page'); state.conversationHistory.value.push({ id: '999' }); state.conversationHistoryHasMore.value = false }
    state.selectHallConversation = async id => { calls.push(id); return true }
    expect(await returnToDiscussion(state)({ id: 'task-1' }, { taskId: 'task-1', conversationId: '999' })).to.equal(true)
    expect(calls).to.deep.equal(['page', '999'])
  })
  it('does not adopt an old identity response, foreign task, or switch away from a busy conversation', async () => {
    const state = deps(); let selections = 0
    state.selectHallConversation = async () => { selections++; return true }
    state.loadHallConversationHistory = async () => { state.apiStore.authorizationGeneration++ }
    expect(await returnToDiscussion(state)({ id: 'task-1' }, { taskId: 'task-1', conversationId: '999' })).to.equal(false)
    expect(await returnToDiscussion(state)({ id: 'task-1' }, { taskId: 'foreign', conversationId: '999' })).to.equal(false)
    state.isConversationBusy.value = true
    expect(await returnToDiscussion(state)({ id: 'task-1' }, { taskId: 'task-1', conversationId: '999' })).to.equal(false)
    expect(selections).to.equal(0)
  })
  it('does not guess a latest conversation when no original was identified', async () => {
    const state = deps(); state.conversationId.value = ''; let selections = 0
    state.loadHallConversationHistory = async () => { state.conversationHistory.value = [{ id: '202' }, { id: '303' }] }
    state.selectHallConversation = async () => { selections++; return true }
    expect(await returnToDiscussion(state)({ id: 'task-1' }, null)).to.equal(false)
    expect(selections).to.equal(0)
  })
  it('preserves focused review and funded formal delivery lanes and wires completion to server refresh', () => {
    const start = hall.indexOf('<BountyAcceptancePanel'); const end = hall.indexOf('</BountyAcceptancePanel>', start)
    const integration = hall.slice(start, end)
    expect(integration).to.include('!taskReviewRef').and.include("formalTaskRef.funding?.mode !== 'FUNDED_SINGLE_AGENT'")
    expect(integration).to.include('<template #legacy>').and.include('<FormalTaskDeliveryPanel').and.include('@task-completed="loadTasks"')
    expect(returnBody).not.to.match(/setDraft|pointAnd|sendMessage|createTask/)
  })
})

describe('mounted task acceptance panel', () => {
  const installed = []
  before(() => { for (const name of ['Element', 'HTMLElement', 'SVGElement', 'Node']) if (!globalThis[name]) {
    installed.push(name); Object.defineProperty(globalThis, name, { value: window[name], configurable: true })
  } })
  after(() => { for (const name of installed) delete globalThis[name] })
  const filename = new URL('../src/components/juyiting/BountyAcceptancePanel.vue', import.meta.url)
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename: filename.pathname })
  const script = compileScript(descriptor, { id: 'acceptance-panel-test', inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
    .replace(/^import\s+\{\s*(createApi|useHallBountyAcceptance)\s*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, (_, name) => `var { ${name} } = deps`)
    .replace(/^import\s+BountyExecutionOutputs\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var { BountyExecutionOutputs } = deps')
    .replace('export default', 'return')
  it('uses the original source and task version and forwards acceptance completion and modification without choosing an actor', async () => {
    const scope = Object.freeze({ taskId: 'task-1', conversationId: '101' }); const receipt = Object.freeze({ taskId: 'task-1', operationId: 'accepted' })
    const Gallery = Vue.defineComponent({ props: { acceptance: Boolean, enabled: Boolean, taskVersion: String, conversationId: String, catalog: Array }, emits: ['task-completed', 'continue-modification'],
      setup: (_props, { emit }) => () => Vue.h('button', { onClick: () => { emit('task-completed', receipt); emit('continue-modification') } }, '操作') })
    const source = { scope: Vue.ref(scope), loading: Vue.ref(false), error: Vue.ref(''), legacy: Vue.ref(false),
      catalog: { entries: Vue.ref([{ ordinal: '1', request: request() }]), error: Vue.ref('') } }
    const Component = new Function('Vue', 'deps', script)(Vue, { createApi: () => ({}), useHallBountyAcceptance: () => source, BountyExecutionOutputs: Gallery })
    const wrapper = mount(Component, { props: { taskId: 'task-1', identityKey: 'owner-1', taskVersion: '9' },
      slots: { legacy: '<div class="legacy-domain">旧成果</div>' } })
    try {
      const gallery = wrapper.findComponent(Gallery)
      expect(gallery.props()).to.include({ acceptance: true, enabled: true, taskVersion: '9', conversationId: '101' })
      await gallery.find('button').trigger('click')
      expect(wrapper.emitted('task-completed')).to.deep.equal([[receipt]])
      expect(wrapper.emitted('continue-modification')).to.deep.equal([[scope]])
      source.catalog.error.value = 'failed catalogue'; await Vue.nextTick()
      expect(gallery.props('enabled')).to.equal(false)
      source.catalog.error.value = ''
      source.legacy.value = true; await Vue.nextTick()
      expect(wrapper.findComponent(Gallery).exists()).to.equal(false); expect(wrapper.find('.legacy-domain').exists()).to.equal(true)
      source.legacy.value = false; source.loading.value = true; await Vue.nextTick()
      expect(wrapper.findComponent(Gallery).exists()).to.equal(false)
    } finally { wrapper.unmount() }
  })
})
