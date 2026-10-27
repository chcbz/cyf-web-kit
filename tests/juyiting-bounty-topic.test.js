import { reactive } from 'vue'
import { expect } from 'chai'
import { useHallBountyTopic, createHallBountyTopicAdopter } from '../src/composables/juyiting/useHallBountyTopic.js'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const setup = (overrides = {}) => {
  const state = reactive({ identity: 'owner-a', authorization: 1, conversationId: '101', conversationGeneration: '1',
    taskId: '537', targetAgentId: 'wuyong' })
  const records = new Map(); const calls = []; let adoptions = 0
  const receipt = { sourceConversationId: '101', sourceConversationGeneration: '1', conversationId: '102',
    conversationGeneration: '1', taskId: '537', targetAgentId: 'wuyong', harmlessFutureField: true }
  const storage = { getItem: key => records.get(key) || null, setItem: (key, value) => records.set(key, value), removeItem: key => records.delete(key) }
  const api = { create: async (...args) => { calls.push(['POST', ...args]); return receipt },
    get: async (...args) => { calls.push(['GET', ...args]); return receipt } }
  const options = { chatApi: api, identityScope: () => state.identity, authorizationGeneration: () => state.authorization,
    getContext: () => ({ conversationId: state.conversationId, conversationGeneration: state.conversationGeneration,
      taskId: state.taskId, targetAgentId: state.targetAgentId }), storage, makeKey: () => 'topic-key-0001',
    adopt: async (value, current) => { expect(current()).to.equal(true); adoptions++; state.conversationId = value.conversationId; return true }, ...overrides }
  const topic = useHallBountyTopic(options)
  return { state, records, calls, receipt, storage, api, topic, options, adoptions: () => adoptions }
}
describe('bounty topic creation and recovery', () => {
  it('persists one key before POST, adopts only authenticated scope receipt, and sends no message', async () => {
    const s = setup(); const create = s.api.create
    s.api.create = async (...args) => { expect([...s.records.values()]).to.deep.equal(['topic-key-0001']); return create(...args) }
    expect(await s.topic.open()).to.equal(true)
    expect(s.calls.map(c => c[0])).to.deep.equal(['POST'])
    expect(s.calls[0][1]).to.equal('/conversations/101/topics')
    expect(s.calls[0][2]).to.deep.equal({ expectedConversationGeneration: '1' })
    expect(s.calls[0][3].headers).to.deep.equal({ 'Idempotency-Key': 'topic-key-0001' })
    expect(s.adoptions()).to.equal(1); expect(s.records.size).to.equal(0)
  })
  it('lost response retains original topic and uses readback after reload, never a second POST', async () => {
    const s = setup(); s.api.create = async () => { throw new Error('transport') }
    expect(await s.topic.open()).to.equal(false); expect(s.state.conversationId).to.equal('101')
    expect(s.records.size).to.equal(1)
    s.topic.dispose()
    const reloaded = useHallBountyTopic(s.options)
    expect(await reloaded.open()).to.equal(true)
    expect(s.calls.map(c => c[0])).to.deep.equal(['GET']); expect(s.adoptions()).to.equal(1)
  })
  it('only explicit missing readback permits same-key POST on a subsequent click', async () => {
    const s = setup({ adopt: async () => false }); await s.topic.open()
    s.api.get = async (...args) => { s.calls.push(['GET', ...args]); throw { status: 404 } }
    await s.topic.open()
    expect(s.calls.map(c => c[0])).to.deep.equal(['POST', 'GET', 'POST'])
    expect(s.calls[0][3].headers).to.deep.equal(s.calls[2][3].headers)
  })
  for (const response of [null, {}, { sourceConversationId: 'other' }]) {
    it(`does not turn invalid successful readback into a new creation: ${JSON.stringify(response)}`, async () => {
      const s = setup({ adopt: async () => false }); await s.topic.open()
      s.api.get = async () => response
      expect(await s.topic.open()).to.equal(false)
      expect(s.calls.filter(c => c[0] === 'POST')).to.have.length(1)
    })
  }
  for (const field of ['taskId', 'targetAgentId', 'sourceConversationId', 'sourceConversationGeneration']) {
    it(`does not adopt cross-scope receipt ${field}`, async () => {
      const s = setup(); s.receipt[field] = 'wrong'
      expect(await s.topic.open()).to.equal(false); expect(s.adoptions()).to.equal(0)
      expect(s.records.size).to.equal(1)
    })
  }
  it('ignores late receipt after task/identity switch and coalesces double click', async () => {
    const s = setup(); let finish
    s.api.create = () => new Promise(resolve => { finish = resolve })
    const first = s.topic.open(); expect(s.topic.busy.value).to.equal(true)
    expect(await s.topic.open()).to.equal(false)
    s.state.identity = 'owner-b'; finish(s.receipt)
    expect(await first).to.equal(false); expect(s.adoptions()).to.equal(0); expect(s.topic.error.value).to.equal('')
  })
  it('releases the old scope on task switch without letting a late response unlock a newer request', async () => {
    const s = setup(); const pending = []
    s.api.create = () => new Promise(resolve => pending.push(resolve))
    const first = s.topic.open(); s.state.taskId = '538'
    expect(s.topic.busy.value).to.equal(false)
    const second = s.topic.open(); expect(s.topic.busy.value).to.equal(true)
    pending[0](s.receipt); expect(await first).to.equal(false)
    expect(s.topic.busy.value).to.equal(true)
    pending[1]({ ...s.receipt, taskId: '538' }); expect(await second).to.equal(true)
    s.topic.dispose()
  })
  it('requires durable session key before any request and rejects after disposal', async () => {
    const s = setup({ storage: null })
    expect(await s.topic.open()).to.equal(false); expect(s.calls).to.deep.equal([])
    s.topic.dispose(); expect(await s.topic.open()).to.equal(false)
  })
  it('does not POST after a forbidden or unavailable readback', async () => {
    const s = setup({ adopt: async () => false }); await s.topic.open()
    for (const status of [401, 403, 409, 503]) {
      s.api.get = async () => { throw { status } }
      expect(await s.topic.open()).to.equal(false)
    }
    expect(s.calls.filter(c => c[0] === 'POST')).to.have.length(1)
  })
})

describe('existing prototype topic menu', () => {
  const source = readFileSync(new URL('../prototypes/juyiting/interaction-completion.js', import.meta.url), 'utf8')
  const helpers = source.slice(source.indexOf('function historyTitle'), source.indexOf('// End topic transition helpers.'))
  const run = () => { const box = vm.createContext({ structuredClone, serial: 0 }); vm.runInContext(helpers, box); return box }
  it('preserves old messages, draft and selection on round-trip without changing the task', () => {
    const box = run(); const task = { title: 'Original', files: ['task-material'] }
    const ctx = { task, messages: [{ text: 'old' }], chatDraft: 'old draft', chatFiles: ['ref-a'], quote: 'quote', outputs: ['out-a'] }
    expect(box.startConversationTopic(ctx)).to.equal(true)
    expect(ctx.task).to.equal(task); expect(ctx.messages).to.deep.equal([]); expect(ctx.chatFiles).to.deep.equal([])
    ctx.chatDraft = 'new draft'; ctx.chatFiles.push('ref-b')
    expect(box.selectConversationTopic(ctx, 'demo-topic-1')).to.equal(true)
    expect(ctx.historyOpen).to.equal(false); expect(ctx.messages).to.deep.equal([{ text: 'old' }]); expect(ctx.chatDraft).to.equal('old draft')
    expect(ctx.chatFiles).to.deep.equal(['ref-a']); expect(ctx.quote).to.equal('quote')
    expect(box.selectConversationTopic(ctx, 'demo-topic-2')).to.equal(true); expect(ctx.chatDraft).to.equal('new draft')
    expect(ctx.chatFiles).to.deep.equal(['ref-b']); expect(task.files).to.deep.equal(['task-material'])
  })
  it('keeps separate task books and never uses new topic to restart pending or completed work', () => {
    const box = run(); const a = { task: {}, messages: [{ text: 'A' }], outputs: [], chatDraft: '', chatFiles: [] }; const b = { task: {}, messages: [{ text: 'B' }], outputs: [], chatDraft: '', chatFiles: [] }
    box.startConversationTopic(a); box.startConversationTopic(b); box.selectConversationTopic(a, 'demo-topic-1')
    expect(a.messages[0].text).to.equal('A'); box.selectConversationTopic(b, 'demo-topic-3'); expect(b.messages[0].text).to.equal('B')
    a.pending = true; expect(box.startConversationTopic(a)).to.equal(false)
    a.pending = false; a.task.complete = true; expect(box.startConversationTopic(a)).to.equal(false)
  })
})


describe('confirmed topic adoption through existing history selection', () => {
  const fixture = () => {
    const state = { identity: 'owner-a:1', taskId: '537', mode: 'bounty', conversationId: '101', history: [], selected: [] }
    const options = { identity: () => state.identity, taskId: () => state.taskId, mode: () => state.mode,
      conversationId: () => state.conversationId, history: () => state.history,
      loadHistory: async () => { state.history = [{ id: '102' }] },
      select: async id => { state.selected.push(id); state.conversationId = id; return true } }
    return { state, options }
  }
  it('refreshes history before selecting a confirmed topic', async () => {
    const { state, options } = fixture()
    expect(await createHallBountyTopicAdopter(options)({ conversationId: '102' }, () => true)).to.equal(true)
    expect(state.selected).to.deep.equal(['102'])
  })
  it('does not discard the old topic when the new one is not in authenticated history', async () => {
    const { state, options } = fixture(); options.loadHistory = async () => {}
    expect(await createHallBountyTopicAdopter(options)({ conversationId: '102' }, () => true)).to.equal(false)
    expect(state.conversationId).to.equal('101'); expect(state.selected).to.deep.equal([])
  })
  it('does not select after context changes during history loading', async () => {
    const { state, options } = fixture(); options.loadHistory = async () => { state.history = [{ id: '102' }]; state.taskId = '538' }
    expect(await createHallBountyTopicAdopter(options)({ conversationId: '102' }, () => true)).to.equal(false)
    expect(state.selected).to.deep.equal([])
  })
  it('keeps a confirmed selected topic on content-load failure instead of creating again', async () => {
    const { state, options } = fixture(); options.select = async id => { state.conversationId = id; return false }
    expect(await createHallBountyTopicAdopter(options)({ conversationId: '102' }, () => true)).to.equal(true)
  })
  it('rejects an identity change while content is loading', async () => {
    const { state, options } = fixture(); options.select = async id => { state.conversationId = id; state.identity = 'owner-b:2'; return true }
    expect(await createHallBountyTopicAdopter(options)({ conversationId: '102' }, () => true)).to.equal(false)
  })
})
