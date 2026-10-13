import * as skillResults from '../src/composables/juyiting/useHallSkillResults.js'
import * as skillResultData from '../src/composables/juyiting/hallSkillResults.js'
import { expect } from 'chai'
import { readFileSync, writeFileSync } from 'node:fs'
import * as Vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { mount, flushPromises } from '@vue/test-utils'
import * as outputs from '../src/composables/juyiting/bountyOutputCatalog.js'
import * as ordinary from '../src/composables/juyiting/useHallOrdinaryCancellation.js'
import * as silver from '../src/utils/silverAmount.js'
import { useHallBountyAcceptance } from '../src/composables/juyiting/useHallBountyAcceptance.js'
import { useHallBountyFinalization, safeFinalizationVersion } from '../src/composables/juyiting/useHallBountyFinalization.js'
import { useHallConversationArchive } from '../src/composables/juyiting/useHallConversationArchive.js'

const raw = JSON.parse(readFileSync(new URL('./fixtures/juyiting/completed-message-delivery-v3.json', import.meta.url)))
const request = () => ({ requestId: raw.requestId, requestRevision: raw.requestRevision, conversationId: raw.conversationId,
  conversationGeneration: raw.conversationGeneration, userMessageId: '1', state: 'COMPLETED', stateVersion: '1', steps: [], turns: [{
    turnId: raw.turnId, requestId: raw.requestId, requestRevision: raw.requestRevision, conversationId: raw.conversationId,
    conversationGeneration: raw.conversationGeneration, targetAgentId: 'agent', dispatchId: 'dispatch', route: 'CHAT', state: 'FINAL_PERSISTED',
    stateVersion: '1', lastDeltaSeq: '0', terminalReason: null, createdAt: '1', updatedAt: '1',
    finalMessageId: raw.outcome.assistantMessageId, contextSnapshotId: raw.outcome.messageSource.snapshotId }] })
const Empty = Vue.defineComponent({ render: () => Vue.h('span') })
const compile = (name, imports) => {
  const filename = new URL(`../src/components/juyiting/${name}.vue`, import.meta.url)
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename: filename.pathname })
  const modules = new Proxy({ vue: Vue, '../../composables/juyiting/useHallSkillResults.js': skillResults, '../../composables/juyiting/hallSkillResults.js': skillResultData, ...imports }, { get: (obj, path) => obj[path] || Empty })
  const code = compileScript(descriptor, { id: `five-${name}`, inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_, names, path) => `const { ${names.replace(/\s+as\s+/g, ': ')} } = imports[${JSON.stringify(path)}]`)
    .replace(/^import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_, name, path) => `const ${name} = imports[${JSON.stringify(path)}]`)
    .replace('export default', 'return')
  return new Function('imports', code)(modules)
}
const settle = async () => { for (let i = 0; i < 8; i++) { await flushPromises(); await Vue.nextTick(); await new Promise(resolve => setTimeout(resolve, 5)) } }
const timers = () => {
  const savedTimeout = globalThis.setTimeout; const savedClear = globalThis.clearTimeout; let id = 70000; const jobs = new Map()
  globalThis.setTimeout = (fn, ms, ...args) => ms === 2500 ? (jobs.set(++id, fn), id) : savedTimeout(fn, ms, ...args)
  globalThis.clearTimeout = value => { if (!jobs.delete(value)) savedClear(value) }
  return { jobs, tick: async () => { const batch = [...jobs]; jobs.clear(); for (const [, fn] of batch) fn(); await settle() },
    restore: () => { globalThis.setTimeout = savedTimeout; globalThis.clearTimeout = savedClear } }
}
const acceptanceHarness = () => {
  const reads = []; let snapshot = request()
  const api = { list: async () => ({ data: [{ id: raw.conversationId, conversationType: 'juyiting', conversationScopeType: 'bounty', conversationScopeKey: 'task:task' }] }),
    get: async (path, params) => {
      reads.push({ path, params })
      if (path.endsWith('/requests')) return { data: { schemaVersion: 1, scope: { conversationId: raw.conversationId, conversationGeneration: raw.conversationGeneration, taskId: 'task' },
        after: '0', through: '1', nextAfter: null, hasMore: false, entries: [{ ordinal: '1', request: snapshot }] } }
      if (path.endsWith('/typed-outcome')) return { data: raw }
      if (path.endsWith('/outputs')) return { data: [] }
      if (path === `/requests/${raw.requestId}`) return { data: snapshot }
      throw new Error('unexpected read ' + path)
    }, execute: async () => { throw new Error('No mutations allowed') } }
  const shared = { '../../composables/useHttp.js': { createApi: () => api }, '../../composables/juyiting/bountyOutputCatalog.js': outputs,
    '../../utils/outputDownload.js': { saveOutputBlob() {} }, '../../composables/juyiting/useHallConversationArchive.js': { useHallConversationArchive },
    '../../composables/juyiting/useHallBountyFinalization.js': { useHallBountyFinalization, safeFinalizationVersion },
    '../../composables/juyiting/useHallBountyAcceptance.js': { useHallBountyAcceptance } }
  const Gallery = compile('BountyExecutionOutputs', shared)
  return { reads, Gallery, Panel: compile('BountyAcceptancePanel', { ...shared, './BountyExecutionOutputs.vue': Gallery }),
    setSnapshot: value => { snapshot = value }, counts: () => ({ catalog: reads.filter(x => x.path.endsWith('/requests')).length,
      request: reads.filter(x => x.path === `/requests/${raw.requestId}`).length, typed: reads.filter(x => x.path.endsWith('/typed-outcome')).length }) }
}

describe('five fixes real mounted output consumers', () => {
  beforeEach(() => window.sessionStorage.clear())
  it('completed task stops both polling chains after first verified history read (three timer cycles)', async () => {
    const clock = timers(); const h = acceptanceHarness(); let wrapper
    try {
      wrapper = mount(h.Panel, { props: { taskId: 'task', identityKey: 'owner-five', taskVersion: '9', taskCompleted: true } }); await settle()
      expect(wrapper.text()).to.include('任务已完成')
      const initial = h.counts()
      for (let i = 0; i < 3; i++) await clock.tick()
      const expected = 1
      expect(h.counts()).to.deep.equal({ catalog: expected, request: expected, typed: expected })
      if (process.env.JYT_FIVE_EVIDENCE) writeFileSync(`${process.env.JYT_FIVE_EVIDENCE}/poll-after.json`,
        JSON.stringify({ mounted: 'real BountyAcceptancePanel + useHallBountyAcceptance + real BountyExecutionOutputs', cycles: 3, initial, final: h.counts(), reads: h.reads }, null, 2))
    } finally { wrapper?.unmount(); clock.restore() }
  })
})

const panelProps = { embeddedHall: true, detailAllowed: true, identityScope: 'owner-five', authorizationGeneration: 1,
  abilityText: () => '', canAssign: () => true, formatTime: () => '', portraitName: () => '', portraitStyle: () => ({}),
  taskAgentMatchScore: () => 0, taskStateClass: () => '', taskStatusCount: () => 0, taskStatusText: x => x }
const panelTask = (overrides = {}) => ({ id: 'a', title: '原事项A', status: 'assigned', taskVersion: '2', funding: null, assignedAgentIds: ['old-agent'], ...overrides })
const Panel = compile('BountyPanel', { '../../composables/juyiting/useHallOrdinaryCancellation.js': ordinary, '@/utils/silverAmount': silver })
const DialogFixture = Vue.defineComponent({ props: ['show', 'title', 'message'], emits: ['confirm', 'cancel', 'close', 'update:show'],
  template: `<aside v-if="show" class="confirmation-fixture" role="dialog"><h3>{{title}}</h3><p>{{message}}</p><button class="confirm" @click="$emit('update:show', false); $emit('confirm')">确认取消事项</button><button class="dismiss" @click="$emit('update:show', false); $emit('cancel')">保留事项</button></aside>` })
const openPanel = async (task = panelTask(), extra = {}) => {
  const wrapper = mount(Panel, { props: { ...panelProps, tasks: [task], selectedTask: task, ...extra }, global: { components: { 'var-dialog': DialogFixture } } })
  wrapper.vm.openTask(task); await Vue.nextTick(); return wrapper
}

describe('five fixes cancellation thin confirmation layer', () => {
  it('dismisses without POST, then confirms the exact original integer version once, not a newly selected task', async () => {
    const task = panelTask(); const wrapper = await openPanel(task)
    try {
      await wrapper.get('.ordinary-cancel-action').trigger('click')
      expect(wrapper.get('[role="dialog"]').text()).to.include('原事项A').and.include('服务端核验')
      expect(wrapper.emitted('cancel-task')).to.equal(undefined)
      await wrapper.get('.dismiss').trigger('click'); expect(wrapper.emitted('cancel-task')).to.equal(undefined)
      await wrapper.get('.ordinary-cancel-action').trigger('click')
      await wrapper.get('.confirm').trigger('click')
      expect(wrapper.emitted('cancel-task')).to.have.length(1)
      expect(wrapper.emitted('cancel-task')[0][0]).to.include({ id: 'a', taskVersion: 2 })
      await wrapper.get('.ordinary-cancel-action').trigger('click')
      expect(wrapper.emitted('cancel-task')).to.have.length(1)
    } finally { wrapper.unmount() }
  })
  for (const boundary of ['identity', 'epoch', 'selected-task', 'version', 'status', 'hidden', 'close', 'A-B-A']) {
    it(`closes on ${boundary} change and ignores a late original confirm`, async () => {
      const task = panelTask(); const wrapper = await openPanel(task)
      try {
        await wrapper.get('.ordinary-cancel-action').trigger('click')
        const dialog = wrapper.findComponent(DialogFixture)
        if (boundary === 'identity') await wrapper.setProps({ identityScope: 'other-owner' })
        if (boundary === 'epoch') await wrapper.setProps({ authorizationGeneration: 2 })
        if (boundary === 'selected-task') await wrapper.setProps({ selectedTask: panelTask({ id: 'b' }) })
        if (boundary === 'version') await wrapper.setProps({ selectedTask: panelTask({ taskVersion: '3' }) })
        if (boundary === 'status') await wrapper.setProps({ selectedTask: panelTask({ status: 'running' }) })
        if (boundary === 'hidden') await wrapper.setProps({ detailAllowed: false })
        if (boundary === 'close') wrapper.vm.back()
        if (boundary === 'A-B-A') { await wrapper.setProps({ selectedTask: panelTask({ id: 'b' }) }); await wrapper.setProps({ selectedTask: task }) }
        await Vue.nextTick(); expect(dialog.props('show')).to.equal(false)
        dialog.vm.$emit('confirm'); await Vue.nextTick()
        expect(wrapper.emitted('cancel-task')).to.equal(undefined)
      } finally { wrapper.unmount() }
    })
  }
  it('keeps unresolved as a GET-only check via the original composable, without another Dialog or POST', async () => {
    const task = Vue.ref(panelTask()); const calls = []
    const actions = ordinary.useHallOrdinaryCancellation({ selectedTask: task, tasks: Vue.ref([task.value]), identityScope: Vue.ref('owner-five'),
      agentApi: { create: async () => { calls.push('POST'); throw new TypeError('ACK lost') }, get: async () => { calls.push('GET'); return { data: task.value } } }, log: { warn() {} } })
    let wrapper
    try {
      await actions.cancelTask(task.value)
      task.value = { ...task.value, status: 'running' }
      expect(actions.cancellationState.value.status).to.equal('unresolved')
      wrapper = await openPanel(task.value, { cancellationState: actions.cancellationState.value, onCancelTask: value => actions.cancelTask(value) })
      await wrapper.get('.ordinary-cancel-action').trigger('click'); await settle()
      expect(wrapper.find('[role="dialog"]').exists()).to.equal(false)
      expect(calls).to.deep.equal(['POST', 'GET', 'GET'])
    } finally { wrapper?.unmount(); actions.dispose() }
  })
  for (const [status, label] of [['failed', '失败'], ['blocked', '受阻'], ['cancelled', '已取消']]) it(`distinguishes ${status} in the actual detail advice DOM`, async () => {
    const wrapper = await openPanel(panelTask({ status }))
    try { expect(wrapper.get('.matter-advice-heading').text()).to.include(label) } finally { wrapper.unmount() }
  })
})

describe('five fixes poll lifecycle and projection hints', () => {
  beforeEach(() => window.sessionStorage.clear())
  it('quiets a terminal request even before domain acceptance, but preserves manual refresh', async () => {
    const clock = timers(); const h = acceptanceHarness(); let wrapper
    try {
      wrapper = mount(h.Panel, { props: { taskId: 'task', identityKey: 'owner-refresh', taskVersion: '9' } }); await settle()
      for (let i = 0; i < 3; i++) await clock.tick()
      expect(h.counts()).to.deep.equal({ catalog: 1, request: 1, typed: 1 })
      await wrapper.get('.output-refresh').trigger('click'); await settle()
      expect(h.counts()).to.deep.equal({ catalog: 2, request: 2, typed: 2 })
      await wrapper.setProps({ taskVersion: '10' }); await settle()
      expect(h.counts().catalog).to.equal(3)
      expect(wrapper.find('.finalize-button').exists()).to.equal(true)
    } finally { wrapper?.unmount(); clock.restore() }
  })
  it('keeps active execution refreshing across three cycles then stops both chains at terminal snapshots', async () => {
    const clock = timers(); const h = acceptanceHarness(); let wrapper
    try {
      const active = { ...request(), state: 'RUNNING', stateVersion: '2', turns: [] }
      h.setSnapshot(active)
      wrapper = mount(h.Panel, { props: { taskId: 'task', identityKey: 'owner-active' } }); await settle()
      for (let i = 0; i < 3; i++) await clock.tick()
      expect(h.counts().catalog).to.equal(4); expect(h.counts().request).to.equal(4)
      h.setSnapshot({ ...request(), stateVersion: '3' }); await clock.tick(); await settle()
      const settled = h.counts(); expect(wrapper.find('.bounty-output-text').exists()).to.equal(true)
      for (let i = 0; i < 3; i++) await clock.tick()
      expect(h.counts()).to.deep.equal(settled); expect(clock.jobs.size).to.equal(0)
    } finally { wrapper?.unmount(); clock.restore() }
  })
  it('does not mistake a completed parent with a live EXECUTE step or pending turn for stable terminal history', () => {
    expect(outputs.outputRequestPending({ ...request(), steps: [{ kind: 'EXECUTE', executionState: 'RUNNING' }] })).to.equal(true)
    expect(outputs.outputRequestPending({ ...request(), turns: [{ state: 'STREAMING' }] })).to.equal(true)
    expect(outputs.outputRequestPending({ ...request(), steps: [{ kind: 'EXECUTE', executionState: 'OUTPUT_COMMITTED' }] })).to.equal(false)
    expect(outputs.outputRequestPending({ ...request(), state: 'PARTIAL', turns: [{ state: 'STREAMING' }] })).to.equal(true)
  })
  it('mounts a finalized parent with a live EXECUTE step, retains both refresh chains until OUTPUT_COMMITTED', async () => {
    const clock = timers(); const h = acceptanceHarness(); let wrapper
    try {
      const step = { stepId: 'step', stepNumber: '1', taskId: 'task', assignmentRevision: '3', targetAgentId: 'agent', kind: 'EXECUTE',
        state: 'ADMITTED', stateVersion: '1', executionIntentId: 'intent', executionId: 'execution', executionState: 'RUNNING' }
      h.setSnapshot({ ...request(), steps: [step] })
      wrapper = mount(h.Panel, { props: { taskId: 'task', identityKey: 'owner-child' } }); await settle()
      for (let i = 0; i < 3; i++) await clock.tick()
      expect(h.counts()).to.deep.equal({ catalog: 4, request: 4, typed: 4 })
      h.setSnapshot({ ...request(), steps: [{ ...step, state: 'OUTPUT_COMMITTED', stateVersion: '2', executionState: 'OUTPUT_COMMITTED' }] })
      await clock.tick(); const terminal = h.counts(); for (let i = 0; i < 3; i++) await clock.tick()
      expect(h.counts()).to.deep.equal(terminal); expect(clock.jobs.size).to.equal(0)
    } finally { wrapper?.unmount(); clock.restore() }
  })
  it('hides/stops and reopens a live consumer, then disposes without a remaining timer or late scope write', async () => {
    const clock = timers(); const h = acceptanceHarness(); let wrapper
    try {
      h.setSnapshot({ ...request(), state: 'RUNNING', turns: [] })
      wrapper = mount(h.Panel, { props: { taskId: 'task', identityKey: 'owner-visible' } }); await settle()
      expect(clock.jobs.size).to.equal(2)
      await wrapper.setProps({ enabled: false }); await settle()
      const hidden = h.counts(); for (let i = 0; i < 3; i++) await clock.tick()
      expect(h.counts()).to.deep.equal(hidden); expect(clock.jobs.size).to.equal(0)
      await wrapper.setProps({ enabled: true }); await settle(); expect(h.counts().catalog).to.equal(hidden.catalog + 1)
      wrapper.unmount(); wrapper = null
      const final = h.counts(); await clock.tick(); expect(h.counts()).to.deep.equal(final); expect(clock.jobs.size).to.equal(0)
    } finally { wrapper?.unmount(); clock.restore() }
  })
  it('refreshes on any catalog stateVersion change (not only the last request), ignores identical projection copies', async () => {
    const clock = timers(); const h = acceptanceHarness(); let wrapper
    try {
      const snapshot = request(); const props = { enabled: true, acceptance: true, taskId: 'task', taskVersion: '9', conversationId: raw.conversationId,
        identityKey: 'owner-projection', request: snapshot, catalog: [{ ordinal: '1', request: snapshot }] }
      wrapper = mount(h.Gallery, { props }); await settle()
      await wrapper.setProps({ catalog: structuredClone(props.catalog) }); await settle()
      expect(h.counts().request).to.equal(1)
      await wrapper.setProps({ catalog: [{ ordinal: '1', request: { ...snapshot, stateVersion: '2' } }] }); await settle()
      expect(h.counts().request).to.equal(2)
      await wrapper.setProps({ enabled: false }); await settle(); expect(clock.jobs.size).to.equal(0)
      await wrapper.setProps({ enabled: true }); await settle(); expect(h.counts().request).to.equal(3)
    } finally { wrapper?.unmount(); clock.restore() }
  })
  it('aborts an in-flight catalog on disable and never admits its late response', async () => {
    const clock = timers(); const enabled = Vue.ref(true); let resolve, signal
    const source = useHallBountyAcceptance({ taskId: () => 'task', identityKey: () => 'owner-abort', enabled: () => enabled.value,
      api: { list: async () => ({ data: [{ id: raw.conversationId, conversationType: 'juyiting', conversationScopeType: 'bounty', conversationScopeKey: 'task:task' }] }),
        get: (_path, _params, options) => { signal = options.signal; return new Promise(done => { resolve = done }) } } })
    try {
      await settle(); enabled.value = false; expect(signal.aborted).to.equal(true)
      resolve({ data: {} }); await settle(); expect(source.scope.value).to.equal(null); expect(source.catalog.entries.value).to.deep.equal([])
      expect(clock.jobs.size).to.equal(0)
    } finally { source.dispose(); clock.restore() }
  })
  it('does not lose a stateVersion refresh hint while the original catalogue read is in flight', async () => {
    const clock = timers(); const version = Vue.ref('1'); let resolve, reads = 0
    const entryPage = snapshot => ({ data: { schemaVersion: 1, scope: { conversationId: '42', conversationGeneration: '1', taskId: 'task' },
      after: '0', through: '1', nextAfter: null, hasMore: false, entries: [{ ordinal: '1', request: snapshot }] } })
    const source = useHallBountyAcceptance({ taskId: () => 'task', identityKey: () => 'version-inflight', stateVersion: () => version.value,
      api: { list: async () => ({ data: [{ id: '42', conversationType: 'juyiting', conversationScopeType: 'bounty', conversationScopeKey: 'task:task' }] }),
        get: async () => { reads++; return reads === 1 ? new Promise(done => { resolve = done }) : entryPage({ ...request(), state: 'RUNNING', stateVersion: '2', turns: [] }) } } })
    try {
      await settle(); version.value = '2'
      resolve(entryPage(request())); await settle()
      expect(reads).to.equal(2); expect(source.catalog.entries.value[0].request.stateVersion).to.equal('2')
      expect(clock.jobs.size).to.equal(1)
    } finally { source.dispose(); clock.restore() }
  })
  it('queues a gallery version refresh during GET, and aborts/fences a late old-identity response', async () => {
    const clock = timers(); let wrapper, resolve, capturedSignal, reads = 0
    const lateApi = { get: async (path, _params, options) => {
      if (path.endsWith('/typed-outcome')) return { data: raw }
      reads++; capturedSignal = options.signal
      if (reads === 1) return new Promise(done => { resolve = done })
      return { data: request() }
    }, execute: async () => { throw new Error('read only') } }
    const Gallery = compile('BountyExecutionOutputs', { '../../composables/useHttp.js': { createApi: () => lateApi },
      '../../composables/juyiting/bountyOutputCatalog.js': outputs, '../../utils/outputDownload.js': { saveOutputBlob() {} },
      '../../composables/juyiting/useHallConversationArchive.js': { useHallConversationArchive },
      '../../composables/juyiting/useHallBountyFinalization.js': { useHallBountyFinalization, safeFinalizationVersion } })
    try {
      wrapper = mount(Gallery, { props: { enabled: true, acceptance: true, taskId: 'task', conversationId: '42', identityKey: 'old', request: request() } })
      await settle(); await wrapper.setProps({ request: { ...request(), stateVersion: '2' } })
      resolve({ data: request() }); await settle(); expect(reads).to.equal(2)
      // Same context stays fenced; a different identity must synchronously abort.
      reads = 0; await wrapper.setProps({ identityKey: 'delayed-owner' }); await settle()
      expect(reads).to.equal(1); const oldSignal = capturedSignal
      await wrapper.setProps({ enabled: false }); expect(oldSignal.aborted).to.equal(true)
      resolve({ data: request() }); await settle()
      expect(wrapper.find('.bounty-output-text').exists()).to.equal(false); expect(clock.jobs.size).to.equal(0)
    } finally { wrapper?.unmount(); clock.restore() }
  })
  it('cancelled history source is terminal/read-only even when its existing request projection is pending', async () => {
    const clock = timers(); const h = acceptanceHarness(); h.setSnapshot({ ...request(), state: 'RUNNING', turns: [] })
    // Same composable used by JuyiHall terminalConversationHistory, not an output replacement.
    let reads = 0
    const source = useHallBountyAcceptance({ taskId: () => 'task', identityKey: () => 'cancelled-history', taskCompleted: () => true,
      api: { list: async () => ({ data: [{ id: '42', conversationType: 'juyiting', conversationScopeType: 'bounty', conversationScopeKey: 'task:task' }] }),
        get: async () => { reads++; return { data: { schemaVersion: 1, scope: { conversationId: '42', conversationGeneration: '1', taskId: 'task' },
          after: '0', through: '1', nextAfter: null, hasMore: false, entries: [{ ordinal: '1', request: { ...request(), state: 'RUNNING', turns: [] } }] } } } } })
    try { await settle(); for (let i = 0; i < 3; i++) await clock.tick(); expect(reads).to.equal(1); expect(clock.jobs.size).to.equal(0) }
    finally { source.dispose(); clock.restore() }
  })
})
