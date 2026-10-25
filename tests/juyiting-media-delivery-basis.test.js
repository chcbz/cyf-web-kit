import { expect } from 'chai'
import { ref } from 'vue'
import { readFileSync } from 'node:fs'
import { displayFixtures } from './fixtures/juyiting/interface-display-fixture.mjs'
import { mediaDeliveryChoices } from '../src/composables/juyiting/hallMediaDeliveryBasis.js'
import { typedOutcomeProjection } from '../src/composables/juyiting/hallTypedDeliberation.js'
import { useHallTypedDeliberation } from '../src/composables/juyiting/useHallTypedDeliberation.js'
const context = { conversationId: '42', conversationGeneration: '1', taskId: 'task', targetAgentId: 'agent', assignmentRevision: '3' }
const fixture = () => {
  const mixed = displayFixtures(JSON.parse(readFileSync(new URL('./fixtures/juyiting/media-basis-delivery-v3.json', import.meta.url), 'utf8')))
  const values = [mixed.mediaOne, mixed.mediaTwo]; const entries = []
  for (const value of values) {
    Object.assign(value.outcome, { outcomeContractVersion: 5, deliverable: false, deliveryRelation: null })
    value.outcome.action.parameters = {}
    const p = value.actionProgress
    Object.assign(p, { executionId: `execution-${entries.length}`, executionStateVersion: '6', phase: 'COMPLETE', resultSha256: 'a'.repeat(64) })
    const request = { requestId: value.requestId, requestRevision: value.requestRevision, conversationId: '42', conversationGeneration: '1',
      userMessageId: String(101 + entries.length), state: 'COMPLETED', steps: [], turns: [{ turnId: value.turnId, requestId: value.requestId,
        requestRevision: value.requestRevision, conversationId: '42', conversationGeneration: '1', targetAgentId: 'agent', contextSnapshotId: 'snapshot',
        route: 'CHAT', state: 'FINAL_PERSISTED', finalMessageId: value.outcome.assistantMessageId }] }
    entries.push({ request })
    entries.push({ request: { requestId: p.childRequestId, requestRevision: '1', conversationId: '42', conversationGeneration: '1',
      state: 'RESULT_COMMITTED', stateVersion: p.childStateVersion, turns: [], steps: [{ kind: 'EXECUTE', stepId: `step-${entries.length}`,
        executionId: p.executionId, state: 'RESULT_COMMITTED', executionState: 'RESULT_COMMITTED', taskId: 'task', assignmentRevision: '3', targetAgentId: 'agent' }] } })
  }
  return { values, entries }
}
describe('current v5 media follow-up basis', () => {
  it('recognizes exact RESULT_COMMITTED children without manufacturing text or source selectors', () => {
    const { values, entries } = fixture(); const normalized = values.map(value => typedOutcomeProjection(value))
    expect(normalized.every(Boolean)).to.equal(true)
    const choices = mediaDeliveryChoices(normalized, entries, context)
    expect(choices.map(x => x.outcomeId)).to.deep.equal(values.map(v => v.outcome.outcomeId))
    expect(choices.every(x => x.stepId && !x.messageSource && !x.sourceSelectors)).to.equal(true)
  })
  it('uses a unique causal leaf independent of arrival order; detects hash drift and cycles', () => {
    const { values, entries } = fixture()
    values[1].outcome.deliveryRelation = { mode: 'APPEND', parentOutcomeId: values[0].outcome.outcomeId,
      parentFinalSha256: values[0].outcome.finalSha256, targetOutcomeId: null, targetFinalSha256: null }
    expect(mediaDeliveryChoices([...values].reverse(), entries, context).map(x => x.outcomeId)).to.deep.equal([values[1].outcome.outcomeId])
    values[1].outcome.deliveryRelation.parentFinalSha256 = 'b'.repeat(64)
    expect(() => mediaDeliveryChoices(values, entries, context)).to.throw('完整读取')
    values[1].outcome.deliveryRelation.parentFinalSha256 = values[0].outcome.finalSha256
    values[0].outcome.deliveryRelation = { ...values[1].outcome.deliveryRelation, parentOutcomeId: values[1].outcome.outcomeId, parentFinalSha256: values[1].outcome.finalSha256 }
    expect(() => mediaDeliveryChoices(values, entries, context)).to.throw('异常')
  })
  it('rejects mismatched scope, late children and altered child state', () => {
    const { values, entries } = fixture()
    expect(mediaDeliveryChoices(values, entries, { ...context, assignmentRevision: '4' })).to.deep.equal([])
    expect(() => mediaDeliveryChoices(values, entries.slice(0, 1), context)).to.throw('尚未完成')
    entries[1].request.steps[0].executionState = 'RUNNING'
    expect(() => mediaDeliveryChoices(values, entries, context)).to.throw('执行来源')
  })
  it('does not freeze further discussion after failed or cancelled executions', () => {
    for (const state of ['FAILED', 'CANCELLED']) {
      const { values, entries } = fixture(); values.forEach(v => { v.actionProgress.state = state })
      expect(mediaDeliveryChoices(values, entries, context)).to.deep.equal([])
    }
  })
  it('allows media follow-up after confirmed empty cancellation, but not unknown or nonempty history', async () => {
    for (const mode of ['cancelled', 'unknown', 'partial', 'final', 'execution', 'missing']) {
      const { values, entries } = fixture(); values.splice(1); entries.splice(2)
      const old = { requestId: 'old-cancelled', state: 'RUNNING', steps: [],
        turns: [{ route: 'CHAT', state: 'RUNNING', lastDeltaSeq: '0', finalMessageId: null }] }
      entries.unshift({ request: old }); const calls = []
      const lane = useHallTypedDeliberation({ chatApi: {
        get: async path => values.find(v => path.includes(`/requests/${v.requestId}/`)),
        create: async (_path, body) => { calls.push(body); throw new Error('unknown ACK') }
      }, actorScopeKey: ref('owner'), authorizationGeneration: ref(1), getContext: () => context,
      getContextGeneration: () => 1, getCatalogEntries: () => entries,
      storage: { getItem: () => null, setItem: () => {} }, enabled: () => true })
      try {
        expect(await lane.refresh()).to.equal(false) // A previous failed read must not poison a confirmed cancellation.
        old.state = 'CANCELLED'; old.turns[0].state = 'CANCELLED'
        if (mode === 'unknown') old.state = 'UNKNOWN'
        if (mode === 'partial') old.turns[0].lastDeltaSeq = '1'
        if (mode === 'final') old.turns[0].finalMessageId = '999'
        if (mode === 'execution') old.steps = [{ kind: 'EXECUTE' }]
        if (mode === 'missing') delete old.turns[0].lastDeltaSeq
        await lane.refresh(); await lane.submit({ content: '识别刚才生成的图片' })
        expect(calls.length, mode).to.equal(mode === 'cancelled' ? 1 : 0)
        if (calls.length) expect(calls[0].parentOutcomeId).to.equal(values[0].outcome.outcomeId)
      } finally { lane.dispose() }
    }
  })
  it('requires explicit choice, freezes unknown POST and fences changed authorization', async () => {
    const { values, entries } = fixture(); const calls = []; const gets = []; const identity = ref('owner'); const auth = ref(1)
    entries.push({ request: { requestId: 'ordinary-chat', turns: [{ route: 'CHAT', state: 'PUBLISHED' }], steps: [] } })
    const memory = new Map(); const storage = { getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, value) }
    const lane = useHallTypedDeliberation({ chatApi: { get: async path => { gets.push(path); if (path.includes('/requests/ordinary-chat/')) throw { response: { status: 404 } }; return values.find(v => path.includes(`/requests/${v.requestId}/`)) },
      create: async (_path, body, options) => { calls.push(structuredClone({ body, key: options.headers['Idempotency-Key'] })); throw new Error('unknown ACK') } },
    actorScopeKey: identity, authorizationGeneration: auth, getContext: () => context, getContextGeneration: () => 1,
    getCatalogEntries: () => entries, storage, enabled: () => true })
    try {
      expect(await lane.refresh()).to.equal(true); expect(gets).to.have.length(3)
      await lane.submit({ content: '提交这一份成果' }); expect(calls).to.have.length(0); expect(lane.error.value).to.include('先选择')
      lane.chooseDelivery(values[0].outcome.outcomeId); await lane.submit({ content: '提交这一份成果' })
      expect(calls).to.have.length(1); expect(calls[0].body.parentOutcomeId).to.equal(values[0].outcome.outcomeId)
      expect(calls[0].body.sourceSelectors).to.deep.equal([])
      lane.chooseDelivery(values[1].outcome.outcomeId); await lane.resumeUnknown(); expect(calls[1]).to.deep.equal(calls[0])
      auth.value = 2; expect(lane.selectedDeliveryId.value).to.equal('')
      identity.value = 'other'; expect(lane.deliveryChoices.value).to.deep.equal([])
    } finally { lane.dispose() }
  })
  it('projects submission intent as a reference, with no message source or execute progress', () => {
    const { values } = fixture(); const raw = values[0]
    Object.assign(raw.outcome, { kind: 'SUBMISSION_REQUEST', action: null, deliveryRelation: { mode: 'SUBMIT', parentOutcomeId: 'parent',
      parentFinalSha256: 'a'.repeat(64), targetOutcomeId: null, targetFinalSha256: null } })
    raw.actionProgress = null
    expect(typedOutcomeProjection(raw)?.outcome.kind).to.equal('SUBMISSION_REQUEST')
    raw.outcome.deliverable = true; expect(typedOutcomeProjection(raw)).to.equal(null)
    raw.outcome.deliverable = false; raw.outcome.deliveryRelation.mode = 'APPEND'; expect(typedOutcomeProjection(raw)).to.equal(null)
  })
})
