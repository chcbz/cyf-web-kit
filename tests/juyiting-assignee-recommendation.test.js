import { readFileSync } from 'node:fs'
import { expect } from 'chai'
import { ref } from 'vue'
import { useHallData } from '../src/composables/juyiting/useHallData.js'
import { parseAssigneeRecommendation } from '../src/composables/juyiting/hallAssigneeRecommendation.js'

const task = () => ({ id: 'task-r1', taskVersion: '7', title: '写一份说明', description: '说明使用方式', status: 'open' })
const agent = { agentId: 'a', name: '好汉', status: 'online', canOperate: true, boundToMe: true, abilities: ['写作'] }
const result = () => ({ taskId: 'task-r1', taskVersion: '7', state: 'READY', observedAt: 1000,
  candidateSetComplete: true, requirementSummary: '写使用说明', questions: [], recommendations: [{ agent, recommendationLevel: 'HIGH',
    quote: { state: 'AVAILABLE', quoteId: 'quote-1', recommendationId: 'recommendation-1', amount: { amountMinor: '13', currency: 'WEN' }, unavailableReason: null }, reason: '登记了写作本领', evidence: [{ id: 'ability:0', kind: 'DECLARED_ABILITY', label: '写作', description: '登记声明', available: true }], gaps: ['受众未知，不保证适合具体使用场景'] }] })
const create = implementation => {
  const selectedTask = ref(task()), identityScope = ref('owner-a')
  const data = useHallData({ agentApi: { create: implementation, get: async url => url.endsWith('/assignee-candidates') ? ({ items: [{ agentId: 'a', displayName: '好汉', providerDisplayName: null, isMine: true, availability: 'online' }], nextAfterAgentId: null }) : selectedTask.value }, log: { warn() {} },
    normalizeStatus: value => value?.toLowerCase(), selectedAgent: ref(null), selectedTask, identityScope })
  data.agents.value = [agent]
  return { data, selectedTask, identityScope }
}
describe('single-track model assignee recommendation R1', () => {
  it('consumes the complete envelope fixture matched by the actual API controller', () => {
    const envelope = JSON.parse(readFileSync(new URL('./fixtures/billing/task-recommendation-quote.json', import.meta.url), 'utf8'))
    expect(envelope.protocolVersion).to.equal(1); expect(envelope.code).to.equal('E0')
    const parsed = parseAssigneeRecommendation(envelope.data, { id: 'task', taskVersion: '7' })
    expect(parsed.recommendations[0].quote.quoteId).to.equal('quote-1')
    expect(parsed.recommendations[0].quote.amount).to.deep.equal({ amountMinor: '13', currency: 'WEN' })
  })
  it('retains the exact quote identity and rejects missing or malformed prices instead of assuming free', async () => {
    const { data } = create(async (_url, _input, options) => options.onSuccess(result()))
    await data.loadTaskRecommendations()
    expect(data.recommendedAgents.value[0].taskQuote).to.deep.equal(result().recommendations[0].quote)
    data.dispose()
    for (const quote of [undefined, { ...result().recommendations[0].quote, quoteId: '' },
      { ...result().recommendations[0].quote, amount: { amountMinor: '1.2', currency: 'WEN' } },
      { ...result().recommendations[0].quote, amount: { amountMinor: 13, currency: 'WEN' } }]) {
      expect(() => parseAssigneeRecommendation({ ...result(), recommendations: [{ ...result().recommendations[0], quote }] }, task())).to.throw()
    }
    const quote = { state: 'UNAVAILABLE', quoteId: null, recommendationId: 'r1', amount: null, unavailableReason: 'MODEL_PRICE_MISSING' }
    expect(parseAssigneeRecommendation({ ...result(), recommendations: [{ ...result().recommendations[0], quote }] }, task()).recommendations[0].quote).to.deep.equal(quote)
    const zero = { ...result().recommendations[0].quote, amount: { amountMinor: '0', currency: 'WEN' } }
    expect(parseAssigneeRecommendation({ ...result(), recommendations: [{ ...result().recommendations[0], quote: zero }] }, task()).recommendations[0].quote.amount.amountMinor).to.equal('0')
  })
  it('preserves own-first suitable advice and external-first advice when own capability is insufficient', async () => {
    for (const rows of [
      [{ mine: true, level: 'MEDIUM' }, { mine: false, level: 'HIGH' }],
      [{ mine: false, level: 'HIGH' }, { mine: true, level: 'LOW' }]
    ]) {
      const recommendations = rows.map((row, i) => ({ ...result().recommendations[0],
        agent: { ...agent, agentId: `order-${i}`, boundToMe: row.mine }, recommendationLevel: row.level }))
      const { data } = create(async (_url, _input, options) => options.onSuccess({ ...result(), recommendations }))
      await data.loadTaskRecommendations()
      expect(data.recommendedAgents.value.map(a => a.agentId)).to.deep.equal(['order-0', 'order-1'])
      expect(data.recommendedAgents.value.map(a => a.recommendationLevel)).to.deep.equal(rows.map(r => r.level))
      data.dispose()
    }
  })

  it('validates degrees, retains low/unknown rows and preserves model order without making a score', async () => {
    const rows = ['UNKNOWN', 'LOW', 'HIGH', 'MEDIUM'].map((level, index) => ({ ...result().recommendations[0],
      agent: { ...agent, agentId: String(index) }, recommendationLevel: level, evidence: level === 'UNKNOWN' ? [] : result().recommendations[0].evidence }))
    const { data } = create(async (_url, _input, options) => options.onSuccess({ ...result(), recommendations: rows }))
    await data.loadTaskRecommendations()
    expect(data.recommendedAgents.value.map(a => a.recommendationLevel)).to.deep.equal(['UNKNOWN', 'LOW', 'HIGH', 'MEDIUM'])
    data.dispose()
    for (const level of [undefined, 'INVALID', 90]) {
      expect(() => parseAssigneeRecommendation({ ...result(), recommendations: [{ ...rows[2], recommendationLevel: level }] }, task())).to.throw()
    }
    expect(parseAssigneeRecommendation({ ...result(), state: 'NO_MATCH', recommendations: rows.slice(0, 2) }, task()).recommendations).to.have.length(2)
    expect(() => parseAssigneeRecommendation({ ...result(), state: 'NO_CANDIDATES', recommendations: rows.slice(0, 1) }, task())).to.throw()
  })

  it('accepts additive fields but rejects old scored arrays, stale task and unsupported states', () => {
    expect(parseAssigneeRecommendation({ ...result(), future: true }, task()).state).to.equal('READY')
    for (const value of [[], [{ agent, score: 80 }], { ...result(), taskVersion: '8' }, { ...result(), state: 'DONE' },
      { ...result(), recommendations: [] }, { ...result(), state: 'NO_MATCH' }]) {
      expect(() => parseAssigneeRecommendation(value, task())).to.throw()
    }
  })
  it('uses authoritative evidence with no score and coalesces an in-flight request', async () => {
    let release, calls = 0, body
    const { data } = create(async (_url, input, options) => { calls++; body = input; await new Promise(r => { release = r }); options.onSuccess(result()) })
    const first = data.loadTaskRecommendations(), second = data.loadTaskRecommendations()
    expect(first).to.equal(second)
    expect(data.recommendationState.value.state).to.equal('LOADING')
    release(); await first
    expect(calls).to.equal(1); expect(body).to.deep.equal({ expectedTaskVersion: '7' })
    expect(data.recommendedAgents.value[0].recommendationEvidence[0].label).to.equal('写作')
    expect(data.recommendedAgents.value[0]).not.to.have.property('recommendationScore')
    await data.loadTaskRecommendations(); expect(calls).to.equal(1)
    data.dispose()
  })
  it('retains unknown assessments for manual selection without inventing positive recommendations', async () => {
    const { data } = create(async (_url, _input, options) => options.onSuccess({ ...result(), state: 'NO_MATCH', recommendations: [{ ...result().recommendations[0], recommendationLevel: 'UNKNOWN', reason: '资料不足', evidence: [] }] }))
    await data.loadTaskRecommendations(); expect(data.recommendationState.value.state).to.equal('NO_MATCH')
    expect(data.recommendedAgents.value[0].recommendationLevel).to.equal('UNKNOWN'); expect(data.canAssign(task(), agent)).to.equal(true)
    data.dispose()
    const failed = create(async () => { throw new Error('provider offline') })
    await failed.data.loadTaskRecommendations(); expect(failed.data.recommendationState.value.state).to.equal('ERROR')
    expect(failed.data.recommendedAgents.value).to.deep.equal([]); failed.data.dispose()
  })
  it('discards responses after identity or task version changes', async () => {
    for (const scopeChange of [true, false]) {
      let release
      const { data, selectedTask, identityScope } = create(async (_url, _input, options) => { await new Promise(r => { release = r }); options.onSuccess(result()) })
      const request = data.loadTaskRecommendations()
      if (scopeChange) identityScope.value = 'other-owner'
      else selectedTask.value = { ...task(), taskVersion: '8' }
      release(); await request
      expect(data.recommendedAgents.value).to.deep.equal([])
      expect(data.recommendationState.value.state).not.to.equal('LOADING')
      data.dispose()
    }
  })
  it('requires evidence for each recommended candidate, while allowing missing skills', () => {
    const valid = result(); expect(parseAssigneeRecommendation(valid, task())).to.equal(valid)
    valid.recommendations[0].evidence[0].available = false
    expect(() => parseAssigneeRecommendation(valid, task())).to.throw()
  })
  it('rejects removed clarification and questions, retaining explicit stale retry', async () => {
    let calls = 0
    const { data } = create(async () => { calls++; throw Object.assign(new Error(), { code: 'RECOMMENDATION_STALE', status: 409 }) })
    await data.loadTaskRecommendations(); expect(data.recommendationState.value.state).to.equal('STALE')
    await data.loadTaskRecommendations(); expect(calls).to.equal(1)
    await data.loadTaskRecommendations(task(), { refresh: true }); expect(calls).to.equal(2)
    data.dispose()
    for (const value of [
      { ...result(), state: 'NEEDS_CLARIFICATION', recommendations: [], questions: ['面向谁？'] },
      { ...result(), state: 'NEEDS_CLARIFICATION', recommendations: [], questions: [] },
      { ...result(), questions: ['请补充需求'] },
      { ...result(), state: 'NO_MATCH', recommendations: [], questions: ['请补充需求'] }
    ]) expect(() => parseAssigneeRecommendation(value, task())).to.throw()
  })
  it('refreshes detail once before retry, adopts current version and coalesces repeated clicks', async () => {
    const selectedTask = ref(task()), identityScope = ref('owner')
    let release, calls = 0, reads = 0
    const data = useHallData({ selectedTask, selectedAgent: ref(null), identityScope,
      normalizeStatus: v => v, log: { warn() {} }, agentApi: {
        get: async url => {
          if (url.endsWith('/assignee-candidates')) return { items: [], nextAfterAgentId: null }
          reads++; await new Promise(r => { release = r }); return { ...task(), taskVersion: '8' }
        },
        create: async (_url, body, options) => {
          calls++; expect(body.expectedTaskVersion).to.equal('8')
          options.onSuccess({ ...result(), taskVersion: '8' })
        }
      } })
    const first = data.loadTaskRecommendations(selectedTask.value, { refresh: true })
    expect(data.loadTaskRecommendations(selectedTask.value, { refresh: true })).to.equal(first)
    expect(data.recommendationState.value.state).to.equal('LOADING')
    expect(calls).to.equal(0); release(); await first
    expect(reads).to.equal(1); expect(calls).to.equal(1)
    expect(data.recommendationState.value.state).to.equal('READY')
    data.dispose()
  })
  it('does not call the model on failed detail refresh or after identity/task switching', async () => {
    for (const change of ['failure', 'identity', 'task']) {
      const selectedTask = ref(task()), identityScope = ref('owner')
      let release, calls = 0
      const data = useHallData({ selectedTask, selectedAgent: ref(null), identityScope,
        normalizeStatus: v => v, log: { warn() {} }, agentApi: {
          get: async url => {
            if (url.endsWith('/assignee-candidates')) return { items: [], nextAfterAgentId: null }
            await new Promise(r => { release = r })
            if (change === 'failure') throw new Error('offline')
            return { ...task(), taskVersion: '8' }
          }, create: async () => { calls++ }
        } })
      const pending = data.loadTaskRecommendations(selectedTask.value, { refresh: true })
      if (change === 'identity') identityScope.value = 'other'
      if (change === 'task') selectedTask.value = { ...task(), id: 'other' }
      release(); await pending
      expect(calls).to.equal(0)
      expect(data.recommendationState.value.state).to.equal(change === 'failure' ? 'ERROR' : 'IDLE')
      data.dispose()
    }
  })

})
