import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { setImmediate } from 'node:timers'
import * as Vue from 'vue'
import { mount } from '@vue/test-utils'
import { parse, compileScript } from '@vue/compiler-sfc'
import { useExternalServicePolicy, externalPolicyProjection } from '../src/composables/juyiting/useExternalServicePolicy.js'
import { createApi } from '../src/composables/useHttp.js'
import { useHallData } from '../src/composables/juyiting/useHallData.js'
import { useHallChatContext } from '../src/composables/juyiting/useHallChatContext.js'
import * as candidates from '../src/composables/juyiting/hallAssigneeCandidates.js'
import * as presentation from '../src/composables/juyiting/hallTaskPresentation.js'
import * as cancellation from '../src/composables/juyiting/useHallOrdinaryCancellation.js'
import * as silver from '../src/utils/silverAmount.js'

const pause = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const memory = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) } }
const summary = (agentId = 'external', extra = {}) => ({ agentId, displayName: '承办', providerDisplayName: null, isMine: false, availability: 'offline', ...extra })
const policyValue = (agentId = 'mine', enabled = false, revision = '0') => ({ agentId, enabled, revision })
const owned = (agentId = 'mine') => ({ agentId, boundToMe: true, canOperate: true, status: 'offline', bindingId: '7' })
const mounted = []
afterEach(() => mounted.splice(0).forEach(dispose => dispose()))
const policyHarness = (apiOverrides = {}, storage = memory()) => {
  const agent = Vue.ref(owned()), identity = Vue.ref('t\u0000c\u0000a'), auth = Vue.ref(1), visible = Vue.ref(true)
  const calls = []; let serial = 0, currentValue = policyValue()
  const api = {
    get: async (path, query, options) => { calls.push({ method: 'GET', path, query, options }); return currentValue },
    put: async (path, body, options) => { calls.push({ method: 'PUT', path, body, options }); currentValue = policyValue(agent.value.agentId, body.enabled, String(BigInt(body.expectedRevision) + 1n)); return currentValue },
    ...apiOverrides
  }
  let flow
  const wrapper = mount({ setup() { flow = useExternalServicePolicy({ api, getAgent: () => agent.value,
    identityScope: () => identity.value, authorizationGeneration: () => auth.value, enabled: () => visible.value,
    storage, createKey: () => `key-${++serial}` }); Vue.onUnmounted(flow.dispose); return () => Vue.h('div', flow.status.value) } })
  mounted.push(() => wrapper.unmount())
  return { flow, agent, identity, auth, visible, storage, calls, api, wrapper }
}

describe('D3.1 owner policy original-operation recovery (mounted real watchers)', () => {
  it('reads owner offline policy, persists exact PUT before send and never sends owner/binding fields', async () => {
    const h = policyHarness(); await pause()
    expect(h.flow.canWrite.value).to.equal(true)
    expect(await h.flow.setEnabled(true)).to.equal(true)
    const put = h.calls.find(call => call.method === 'PUT')
    expect(put.path).to.equal('/mine/external-service-policy')
    expect(put.body).to.deep.equal({ enabled: true, expectedRevision: '0' })
    expect(put.options.headers).to.have.keys('Idempotency-Key', 'X-Request-Id')
    expect(h.flow.receipt.value).to.deep.equal(policyValue('mine', true, '1'))
    expect(h.flow.policy.value.enabled).to.equal(true)
  })
  it('first GET failure is unavailable, never a default false switch or an enabled write', async () => {
    const h = policyHarness({ get: async () => { throw new Error('offline') } }); await pause()
    expect(h.flow.policy.value).to.equal(null)
    expect(h.flow.status.value).to.equal('UNAVAILABLE')
    expect(h.flow.canWrite.value).to.equal(false)
    await h.flow.setEnabled(true)
    expect(h.calls).to.have.length(0)
  })
  it('timeout and request 404 preserve original key/body across remount, block new intent, then same-key replay', async () => {
    const writes = [], storage = memory(); let acknowledged = false
    const api = {
      get: async path => {
        if (path.endsWith('/request')) throw Object.assign(new Error('not found'), { status: 404 })
        return policyValue('mine', acknowledged, acknowledged ? '1' : '0')
      },
      put: async (path, body, options) => { writes.push({ path, body, headers: options.headers }); if (!acknowledged) throw new Error('timeout'); return policyValue('mine', true, '1') }
    }
    const h = policyHarness(api, storage); await pause()
    expect(await h.flow.setEnabled(true)).to.equal(false)
    expect(h.flow.status.value).to.equal('UNKNOWN')
    await h.flow.setEnabled(false); await h.flow.refresh(); await h.flow.checkOriginal()
    expect(writes).to.have.length(1)
    expect(h.flow.status.value).to.equal('UNKNOWN')
    expect(h.flow.error.value).to.include('原操作尚未查到')
    h.wrapper.unmount()
    const again = policyHarness(api, storage); await pause()
    expect(again.flow.status.value).to.equal('UNKNOWN')
    acknowledged = true
    expect(await again.flow.resumeOriginal()).to.equal(true)
    expect(writes).to.have.length(2)
    expect(writes[1]).to.deep.equal(writes[0])
  })
  it('a current GET cannot prove original PUT success; original receipt and newer policy remain distinct', async () => {
    let writes = 0
    const h = policyHarness({ get: async path => path.endsWith('/request') ? policyValue('mine', true, '1') : policyValue('mine', false, writes ? '2' : '0'),
      put: async () => { writes++; throw new Error('lost reply') } })
    await pause(); await h.flow.setEnabled(true)
    await h.flow.refresh()
    expect(h.flow.status.value).to.equal('UNKNOWN')
    expect(await h.flow.checkOriginal()).to.equal(true)
    expect(h.flow.receipt.value).to.deep.equal(policyValue('mine', true, '1'))
    expect(h.flow.policy.value).to.deep.equal(policyValue('mine', false, '2'))
  })
  for (const change of ['identity', 'authorization', 'agent', 'binding', 'visibility', 'unmount']) {
    it(`fences late PUT/GET and cancels observation on ${change}`, async () => {
      const late = deferred(); let signal
      const h = policyHarness({ put: async (_path, _body, options) => { signal = options.signal; return late.promise } })
      await pause(); const pending = h.flow.setEnabled(true)
      if (change === 'identity') h.identity.value = 't\u0000c\u0000b'
      if (change === 'authorization') h.auth.value++
      if (change === 'agent') h.agent.value = owned('other')
      if (change === 'binding') h.agent.value = { ...owned(), bindingId: '8' }
      if (change === 'visibility') h.visible.value = false
      if (change === 'unmount') h.wrapper.unmount()
      expect(signal.aborted).to.equal(true)
      late.resolve(policyValue('mine', true, '1')); await pending; await pause()
      expect(h.flow.receipt.value).to.equal(null)
      expect(h.flow.policy.value?.enabled).not.to.equal(true)
    })
  }
  it('same-identity projection updates do not self-invalidate a pending write', async () => {
    const late = deferred()
    const h = policyHarness({ put: () => late.promise }); await pause()
    const pending = h.flow.setEnabled(true)
    h.agent.value = { ...h.agent.value, name: 'new name', status: 'busy' }
    late.resolve(policyValue('mine', true, '1')); expect(await pending).to.equal(true)
    expect(h.flow.receipt.value.revision).to.equal('1')
  })
  it('does not read or mutate external/system agents; malformed original storage blocks all writes', async () => {
    const h = policyHarness(); await pause(); h.calls.length = 0
    h.agent.value = { ...owned(), boundToMe: false }; await pause(); await h.flow.setEnabled(true)
    expect(h.calls).to.have.length(0)
    const broken = policyHarness({}, { getItem: () => '{broken' }); await pause()
    expect(broken.flow.status.value).to.equal('UNAVAILABLE')
    await broken.flow.setEnabled(true); expect(broken.calls).to.have.length(0)
  })
  it('rejects contradictory receipt and never clears an unknown original on a later 409', async () => {
    const h = policyHarness({ put: async () => policyValue('mine', false, '1') }); await pause()
    await h.flow.setEnabled(true); expect(h.flow.status.value).to.equal('UNKNOWN')
    h.api.put = async () => { throw Object.assign(new Error('revision conflict'), { status: 409 }) }
    await h.flow.resumeOriginal(); expect(h.flow.status.value).to.equal('UNKNOWN')
    expect(h.flow.canWrite.value).to.equal(false)
  })
  it('a first definitive 409 requires a fresh policy read before a new intent', async () => {
    const h = policyHarness({ put: async () => { throw Object.assign(new Error('conflict'), { status: 409 }) } }); await pause()
    await h.flow.setEnabled(true)
    expect(h.flow.status.value).to.equal('UNAVAILABLE')
    expect(h.flow.intent.value).to.equal(null)
    expect(h.flow.canWrite.value).to.equal(false)
    await h.flow.refresh(); expect(h.flow.canWrite.value).to.equal(true)
  })
  it('validates closed DTO and decimal revisions without Number conversion', () => {
    expect(externalPolicyProjection(policyValue('mine', false, '9007199254740993'), 'mine').revision).to.equal('9007199254740993')
    for (const raw of [{ ...policyValue(), owner: 'x' }, policyValue('wrong'), policyValue('mine', false, 1), policyValue('mine', false, '01')]) {
      expect(externalPolicyProjection(raw, 'mine')).to.equal(null)
    }
  })
})

const hallHarness = get => {
  const task = Vue.ref({ id: 'task', status: 'open', taskVersion: '1' }), identity = Vue.ref('owner-a')
  const data = useHallData({ agentApi: { get, create: async () => { throw new Error('recommend unavailable') } },
    log: { warn() {} }, selectedTask: task, selectedAgent: Vue.ref(null), identityScope: identity, normalizeStatus: value => value })
  mounted.push(data.dispose)
  return { data, task, identity }
}
describe('D3.1 unified candidates and persistent task target', () => {
  it('reads exact task detail for assigned list rows and rejects a read after leaving and returning to the same task', async () => {
    const assigned = { id: 'task', status: 'assigned', taskVersion: '2', assignedAgentId: 'external' }
    const h = hallHarness(async path => path.endsWith('/assignee-candidates') ? { items: [], nextAfterAgentId: null } : { ...assigned, assignedTarget: summary() })
    await pause(); h.task.value = assigned
    expect(await h.data.loadTaskDetail()).to.equal(true)
    expect(candidates.assignedTaskTarget(h.task.value)).to.deep.equal(summary())
    const late = deferred()
    const other = hallHarness(async path => path.endsWith('/assignee-candidates') ? { items: [], nextAfterAgentId: null } : late.promise)
    await pause(); other.task.value = assigned
    const pending = other.data.loadTaskDetail()
    other.task.value = { id: 'other-task', status: 'assigned' }
    other.task.value = assigned
    late.resolve({ ...assigned, assignedTarget: summary() })
    expect(await pending).to.equal(false)
    expect(other.task.value.assignedTarget).to.equal(undefined)
  })
  it('drops unrelated management fields and rejects malformed cursors, duplicate IDs and numeric revisions', () => {
    expect(candidates.assigneeSummary({ ...summary(), canOperate: true })).to.deep.equal(summary())
    expect(candidates.assigneePage({ items: [summary()], nextAfterAgentId: 'wrong' })).to.equal(null)
    expect(candidates.assigneePage({ items: [summary(), summary()], nextAfterAgentId: null })).to.equal(null)
    expect(candidates.assigneePage({ items: [summary()], nextAfterAgentId: null }, 'external')).to.equal(null)
    expect(externalPolicyProjection(policyValue('mine', false, 9007199254740992), 'mine')).to.equal(null)
  })
  it('loads all pages via GET canonical cursor, permits offline/busy external regardless of recommendation', async () => {
    const calls = []
    const h = hallHarness(async (path, query) => { calls.push({ path, query }); return query.afterAgentId
      ? { items: [summary('z', { availability: 'busy', isMine: true })], nextAfterAgentId: null }
      : { items: [summary('external')], nextAfterAgentId: 'external' } })
    await pause(); await h.data.loadTaskRecommendations()
    expect(h.data.recommendedAgents.value).to.deep.equal([])
    expect(h.data.canAssign(h.task.value, summary())).to.equal(true)
    await h.data.loadAssigneeCandidates({ more: true })
    expect(h.data.assigneeCandidates.value.map(item => item.agentId)).to.deep.equal(['external', 'z'])
    expect(h.data.canAssign(h.task.value, summary('z'))).to.equal(true)
    expect(calls[1]).to.deep.equal({ path: '/tasks/task/assignee-candidates', query: { pageSize: 50, afterAgentId: 'external' } })
    expect(h.data.canAssign(h.task.value, { agentId: 'not-in-candidates', canOperate: true, status: 'online' })).to.equal(false)
    expect(h.data.operableRosterAgents.value).to.deep.equal([])
  })
  it('fences stale pages on identity/task change and does not reset on same-task projection or roster filter', async () => {
    const late = deferred(); let reads = 0
    const h = hallHarness(async () => { reads++; return late.promise })
    h.task.value = { ...h.task.value, title: 'new title', taskVersion: '2' }
    h.data.agentFilter.value = 'offline'
    expect(reads).to.equal(1)
    h.identity.value = 'owner-b'
    late.resolve({ items: [summary()], nextAfterAgentId: null }); await pause()
    expect(h.data.assigneeCandidates.value).to.deep.equal([])
    expect(h.data.canAssign({ id: 'task', status: 'open' }, summary())).to.equal(false)
  })
  it('keeps page error visible, never substitutes owned online roster, can refresh after candidate closes', async () => {
    let fail = false
    const h = hallHarness(async () => { if (fail) throw new Error('network'); return { items: [summary()], nextAfterAgentId: null } })
    await pause(); fail = true; await h.data.loadAssigneeCandidates()
    expect(h.data.candidatesError.value).to.equal('network')
    expect(h.data.canAssign(h.task.value, summary())).to.equal(false)
  })
  it('unavailable availability is visible, not a guessed revocation of the task grant', () => {
    const target = summary('external', { availability: 'unavailable' })
    const selectedTask = Vue.ref({ id: 'task', status: 'assigned', assignedAgentId: 'external', assignedTarget: target })
    const chat = useHallChatContext({ agents: Vue.ref([]), selectedTask, selectedAgent: Vue.ref(null), portraitShortName: () => '' })
    chat.enterBountyDiscussion()
    expect(chat.chatContext.value.targetAgentIds).to.deep.equal(['external'])
    expect(candidates.assigneeAvailabilityText(candidates.assignedTaskTarget(selectedTask.value))).to.include('暂不可用')
  })
  it('continues an external task after roster/candidate disappearance, never authorizes private chat or another target', () => {
    const selectedTask = Vue.ref({ id: 'task', status: 'assigned', assignedAgentId: 'external', assignedTarget: summary() })
    const roster = Vue.ref([])
    const chat = useHallChatContext({ agents: roster, selectedTask, selectedAgent: Vue.ref(null), portraitShortName: a => a.displayName })
    chat.enterBountyDiscussion(); chat.setMentionAgent({ agentId: 'stranger' })
    expect(chat.chatContext.value.targetAgentIds).to.deep.equal(['external'])
    expect(chat.chatMentionAgents.value).to.deep.equal([summary()])
    expect(chat.enterPrivateConversation(summary())).to.equal(false)
    expect(candidates.assignedTaskTarget({ ...selectedTask.value, assignedAgentId: 'wrong' })).to.equal(null)
    expect(candidates.assigneeProviderText(summary())).to.equal('其他用户')
    expect(candidates.assignedTaskTarget({ ...selectedTask.value, assignedTarget: null })).to.equal(null)
  })
})

const loadPanel = name => {
  const { descriptor } = parse(readFileSync(new URL(`../src/components/juyiting/${name}.vue`, import.meta.url), 'utf8'))
  const Empty = Vue.defineComponent({ render: () => Vue.h('span') })
  const imports = new Proxy({ vue: Vue, '@/composables/juyiting/hallAssigneeCandidates.js': candidates,
    '../../composables/juyiting/hallTaskPresentation.js': presentation,
    '../../composables/juyiting/useHallOrdinaryCancellation.js': cancellation, '@/utils/silverAmount': silver }, { get: (target, key) => target[key] || Empty })
  const code = compileScript(descriptor, { id: `d31-${name}`, inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_, names, path) => `const { ${names.replace(/\s+as\s+/g, ': ')} } = imports[${JSON.stringify(path)}]`)
    .replace(/^import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_, name, path) => `const ${name} = imports[${JSON.stringify(path)}]`)
    .replace('export default', 'return')
  return new Function('imports', code)(imports)
}
describe('D3.1 actual detail surfaces', () => {
  it('renders only an owned detail switch and distinct unavailable/original-recovery states', async () => {
    const wrapper = mount(loadPanel('AgentPanel'), { props: { selectedAgent: owned(), active: true,
      abilityText: () => '', portraitName: () => '', portraitStyle: () => ({}), statusClass: () => '', statusText: () => '',
      externalPolicy: policyValue(), externalPolicyCanWrite: true } })
    mounted.push(() => wrapper.unmount())
    expect(wrapper.find('.external-policy').exists()).to.equal(true)
    await wrapper.get('[role="switch"]').trigger('click')
    expect(wrapper.emitted('set-external-policy')[0]).to.deep.equal([true])
    await wrapper.setProps({ externalPolicy: null, externalPolicyStatus: 'UNAVAILABLE' })
    expect(wrapper.find('[role="switch"]').exists()).to.equal(false)
    expect(wrapper.text()).to.include('设置不可用')
    await wrapper.setProps({ externalPolicyStatus: 'UNKNOWN' })
    expect(wrapper.text()).to.include('以原键继续')
    await wrapper.setProps({ selectedAgent: { ...owned(), boundToMe: false } })
    expect(wrapper.find('.external-policy').exists()).to.equal(false)
  })
  it('uses inline confirmation, provider/availability, pagination and assignedTarget without operable roster', async () => {
    const task = { id: 'task', title: '需求', description: '内容', status: 'open', taskVersion: '1' }
    const wrapper = mount(loadPanel('BountyPanel'), { props: { embeddedHall: true, selectedTask: task,
      assigneeCandidates: [summary()], candidatesNextAfterAgentId: 'external', canAssign: () => true,
      abilityText: () => '', formatTime: () => '', portraitName: () => '', portraitStyle: () => ({}),
      taskStatusText: () => '', taskStateClass: () => '', taskStatusCount: () => '0', taskAgentMatchScore: () => 0 } })
    mounted.push(() => wrapper.unmount())
    wrapper.vm.openTask(task); await Vue.nextTick()
    expect(wrapper.text()).to.include('资料由该Agent运行环境及所使用的模型服务处理')
    await wrapper.findAll('button').find(b => b.text() === '另选承办Agent').trigger('click')
    expect(wrapper.text()).to.include('其他用户 · 离线')
    await wrapper.findAll('button').find(b => b.text() === '加载更多候选').trigger('click')
    expect(wrapper.emitted('more-candidates')).to.have.length(1)
    await wrapper.get('.matter-primary-action').trigger('click')
    expect(wrapper.emitted('assign-task')[0][1].agentId).to.equal('external')
    await wrapper.setProps({ selectedTask: { ...task, status: 'assigned', assignedAgentId: 'external', assignedTarget: summary() }, assigneeCandidates: [] })
    const discuss = wrapper.findAll('button').find(b => b.text() === '继续议事')
    expect(discuss).not.to.equal(undefined)
    await discuss.trigger('click'); expect(wrapper.emitted('discuss-task')[0][1].agentId).to.equal('external')
  })
})


describe('D3.1 real HTTP serializer and policy/candidate consumers (synthetic transport)', () => {
  it('sends closed Q PUT plus unchanged key/requestId and GET queries; parses R without precision loss', async () => {
    const savedFetch = globalThis.fetch
    const wires = []
    const api = createApi('/agent')
    const authStore = { authorizationGeneration: 1, token: async () => 'synthetic-test-only' }
    const options = opts => ({ ...opts, authStore, rum: false })
    let applied = false
    const original = policyValue('mine', true, '9007199254740994')
    let h
    globalThis.fetch = async (url, config) => {
      wires.push({ url, config })
      const id = config.headers['X-Request-Id']
      let value
      if (url.includes('/assignee-candidates')) value = { items: [summary()], nextAfterAgentId: null }
      else if (config.method === 'PUT') {
        const envelope = JSON.parse(config.body)
        expect(Object.keys(envelope).sort()).to.deep.equal(['data', 'protocolVersion', 'requestId'])
        expect(envelope.data).to.deep.equal({ enabled: true, expectedRevision: '9007199254740993' })
        expect(envelope.requestId).to.equal(id)
        expect(envelope.protocolVersion).to.equal(1)
        applied = true
        throw new TypeError('synthetic lost receipt')
      } else value = applied ? original : policyValue('mine', false, '9007199254740993')
      return new Response(JSON.stringify({ protocolVersion: 1, requestId: id, code: 'E0', msg: 'ok', data: value }),
        { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': id } })
    }
    try {
      h = policyHarness({ get: (path, query, opts) => api.get(path, query, options(opts)), put: (path, body, opts) => api.put(path, body, options(opts)) })
      await pause()
      expect(h.flow.policy.value.revision).to.equal('9007199254740993')
      await h.flow.setEnabled(true)
      expect(h.flow.status.value).to.equal('UNKNOWN')
      await h.flow.checkOriginal()
      expect(h.flow.receipt.value).to.deep.equal(original)
      const put = wires.find(wire => wire.config.method === 'PUT')
      const request = wires.find(wire => wire.url.endsWith('/request'))
      expect(request.config.body).to.equal(undefined)
      for (const header of ['Idempotency-Key', 'X-Request-Id']) expect(request.config.headers[header]).to.equal(put.config.headers[header])
      const page = await api.get('/tasks/task/assignee-candidates', { pageSize: 50, afterAgentId: 'a/b' }, options({}))
      expect(candidates.assigneePage(page).items).to.deep.equal([summary()])
      expect(wires.at(-1).url).to.include('pageSize=50').and.include('afterAgentId=a%2Fb')
      expect(wires.at(-1).config.body).to.equal(undefined)
    } finally { h?.wrapper.unmount(); globalThis.fetch = savedFetch }
  })
})
