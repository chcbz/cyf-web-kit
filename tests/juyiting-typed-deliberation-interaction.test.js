import { expect } from 'chai'
import { ref } from 'vue'
import { useHallTypedDeliberation } from '../src/composables/juyiting/useHallTypedDeliberation.js'

const clarify = requestId => ({ schemaVersion: 1, conversationId: '7', conversationGeneration: '1', requestId, requestRevision: '1', turnId: `turn-${requestId}`, state: 'READY', outcome: {
  outcomeId: `outcome-${requestId}`, taskId: 'task-1', assignmentRevision: '4', assistantMessageId: '101', finalDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', kind: 'CLARIFY', text: '请补充颜色', clarification: { pendingQuestionId: `pending-${requestId}`, state: 'OPEN', stateVersion: '0', question: '请补充颜色', requiredFacts: ['REQUIREMENT_DETAILS'], replyRequestId: null }, proposal: null } })
const proposal = requestId => ({ schemaVersion: 1, conversationId: '7', conversationGeneration: '1', requestId, requestRevision: '1', turnId: `turn-${requestId}`, state: 'READY', outcome: {
  outcomeId: `outcome-${requestId}`, taskId: 'task-1', assignmentRevision: '4', assistantMessageId: '102', finalDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', kind: 'EXECUTION_PROPOSAL', text: '可生成蓝鸟', clarification: null, proposal: { proposalId: `proposal-${requestId}`, state: 'PROPOSED', stateVersion: '0', operation: 'GENERATE_IMAGE', instruction: '画一只蓝色小鸟', sourceRefIds: [], sourceSelectors: [], parent: null } } })
const store = () => { const values = new Map(); return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) } }
const receipt = (intent, requestId, pendingQuestionId = null) => ({ schemaVersion: 1, intent, requestId, userMessageId: '100', turnIds: [`turn-${requestId}`], state: 'ADMITTED', stateVersion: '0', eventCursor: '9007199254740993', statusUrl: `/chat/requests/${requestId}`, typedOutcomeUrl: `/chat/conversations/7/requests/${requestId}/typed-outcome`, replay: false, pendingQuestionId })
describe('typed natural discussion interaction adapter', () => {
  beforeEach(() => { globalThis.crypto = { randomUUID: () => '00000000-0000-4000-8000-000000000001' } })
  it('posts exact DISCUSSION then only reads the typed projection; selected OPEN reply posts a new CHAT CAS body', async () => {
    const calls = []; const context = ref({ conversationId: '7', conversationGeneration: '1', taskId: 'task-1', targetAgentId: 'agent-1', assignmentRevision: '4' })
    const api = { create: async (path, body, options) => { calls.push(['POST', path, body, options.headers['Idempotency-Key']]); return { data: { data: receipt(body.intent, body.intent === 'DISCUSSION' ? 'request-1' : 'request-2', body.pendingQuestionId) } } },
      get: async path => { calls.push(['GET', path]); return { data: { data: path.includes('request-1') ? clarify('request-1') : clarify('request-2') } } } }
    const lane = useHallTypedDeliberation({ chatApi: api, actorScopeKey: ref('owner'), authorizationGeneration: ref(1), getContext: () => context.value, getContextGeneration: () => 1,
      getCatalogEntries: () => [], storage: store(), enabled: () => true })
    expect(await lane.submit({ content: '请先问我需要补充什么。' })).to.equal(true)
    expect(calls[0][1]).to.equal('/conversations/7/interactions/discussion')
    expect(calls[0][2]).to.deep.include({ schemaVersion: 1, intent: 'DISCUSSION', parentOutcomeId: null, pendingQuestionId: null })
    expect(calls.filter(call => call[0] === 'POST')).to.have.length(1)
    expect(lane.cards.value).to.have.length(1)
    expect(lane.choosePending(lane.projections.value[0])).to.equal(true)
    expect(await lane.submit({ content: '蓝色水彩。' })).to.equal(true)
    expect(calls[2][2]).to.deep.include({ intent: 'CLARIFICATION_REPLY', parentOutcomeId: 'outcome-request-1', pendingQuestionId: 'pending-request-1', expectedPendingQuestionStateVersion: '0' })
    expect(calls.filter(call => call[0] === 'POST')).to.have.length(2)
    lane.dispose()
  })
  it('discovers a proposal from a catalog request and only routes explicit confirmation to the existing v3 adapter', async () => {
    const context = ref({ conversationId: '7', conversationGeneration: '1', taskId: 'task-1', targetAgentId: 'agent-1', assignmentRevision: '4' }); const proposals = []
    const lane = useHallTypedDeliberation({ chatApi: { get: async () => ({ data: { data: proposal('request-3') } }) }, actorScopeKey: ref('owner'), authorizationGeneration: ref(1),
      getContext: () => context.value, getContextGeneration: () => 1, getCatalogEntries: () => [{ request: { requestId: 'request-3' } }], storage: store(), enabled: () => true,
      onProposal: value => { proposals.push(value); return true } })
    expect(await lane.refresh()).to.equal(true)
    expect(await lane.confirmProposal(lane.projections.value[0])).to.equal(true)
    expect(proposals).to.deep.equal([{ kind: 'GENERATE_IMAGE', content: '画一只蓝色小鸟', inputRefs: [], continuationOf: null, projection: proposal('request-3') }])
    lane.dispose()
  })
  it('persists an unknown original key and only re-POSTs that same key after explicit resume', async () => {
    const context = ref({ conversationId: '7', conversationGeneration: '1', taskId: 'task-1', targetAgentId: 'agent-1', assignmentRevision: '4' }); const keys = []; let attempts = 0
    const lane = useHallTypedDeliberation({ chatApi: { create: async (_path, body, options) => { keys.push(options.headers['Idempotency-Key']); attempts++; if (attempts === 1) throw new Error('ack lost'); return { data: { data: receipt(body.intent, 'request-9') } } }, get: async () => ({ data: { data: clarify('request-9') } }) },
      actorScopeKey: ref('owner'), authorizationGeneration: ref(1), getContext: () => context.value, getContextGeneration: () => 1, getCatalogEntries: () => [], storage: store(), enabled: () => true })
    expect(await lane.submit({ content: '请继续讨论。' })).to.equal(false)
    expect(lane.recoveryAvailable.value).to.equal(true)
    expect(await lane.recover()).to.equal(true)
    expect(attempts).to.equal(1)
    expect(await lane.resumeUnknown()).to.equal(true)
    expect(keys).to.have.length(2); expect(keys[0]).to.equal(keys[1])
    lane.dispose()
  })
  it('fences a delayed typed read after identity/context invalidation and never writes during read recovery', async () => {
    const identity = ref('owner-a'); const context = ref({ conversationId: '7', conversationGeneration: '1', taskId: 'task-1', targetAgentId: 'agent-a', assignmentRevision: '4' }); let resolve; let posts = 0
    const lane = useHallTypedDeliberation({ chatApi: { get: () => new Promise(done => { resolve = done }), create: async () => { posts++; throw new Error('unexpected') } }, actorScopeKey: identity, authorizationGeneration: ref(1),
      getContext: () => context.value, getContextGeneration: () => 1, getCatalogEntries: () => [], storage: store(), enabled: () => true })
    const pending = lane.readOne('request-1'); identity.value = 'owner-b'; context.value = { ...context.value, targetAgentId: 'agent-b' }
    resolve({ data: { data: clarify('request-1') } })
    expect(await pending).to.equal(null); expect(lane.cards.value).to.deep.equal([]); expect(posts).to.equal(0)
    lane.dispose()
  })

  it('keeps a selected OPEN clarification across the same-version poll and sends its original CAS reply; version drift still clears it', async () => {
    const context = ref({ conversationId: '7', conversationGeneration: '1', taskId: 'task-1', targetAgentId: 'agent-1', assignmentRevision: '4' }); const calls = []
    const open = clarify('request-poll'); const sameOpen = JSON.parse(JSON.stringify(open)); const changedOpen = JSON.parse(JSON.stringify(open)); changedOpen.outcome.clarification.stateVersion = '1'
    const reads = [open, sameOpen, clarify('request-reply')]
    const lane = useHallTypedDeliberation({ chatApi: { get: async () => ({ data: { data: reads.shift() } }), create: async (_path, body) => { calls.push(body); return { data: { data: receipt(body.intent, 'request-reply', body.pendingQuestionId) } } } },
      actorScopeKey: ref('owner'), authorizationGeneration: ref(1), getContext: () => context.value, getContextGeneration: () => 1, getCatalogEntries: () => [], storage: store(), enabled: () => true })
    expect(await lane.readOne('request-poll')).to.not.equal(null)
    expect(lane.choosePending(lane.projections.value[0])).to.equal(true)
    expect(await lane.readOne('request-poll')).to.not.equal(null)
    expect(lane.selectedPending.value?.pendingQuestionId).to.equal('pending-request-poll')
    expect(await lane.submit({ content: '蓝色水彩。' })).to.equal(true)
    expect(calls).to.have.length(1)
    expect(calls[0]).to.deep.include({ intent: 'CLARIFICATION_REPLY', parentOutcomeId: 'outcome-request-poll', pendingQuestionId: 'pending-request-poll', expectedParentStateVersion: '0', expectedPendingQuestionStateVersion: '0' })
    reads.push(changedOpen)
    expect(await lane.readOne('request-poll')).to.not.equal(null)
    expect(lane.selectedPending.value).to.equal(null)
    lane.dispose()
  })

  it('keeps an answered clarification monotone, clears its selected CAS question, and rejects a foreign task without hiding historical assignment', async () => {
    const context = ref({ conversationId: '7', conversationGeneration: '1', taskId: 'task-1', targetAgentId: 'agent-1', assignmentRevision: '9' })
    const open = clarify('request-monotone')
    const answered = JSON.parse(JSON.stringify(open)); answered.outcome.clarification.state = 'ANSWERED'; answered.outcome.clarification.stateVersion = '1'; answered.outcome.clarification.replyRequestId = 'request-reply'
    const stale = JSON.parse(JSON.stringify(open)); const historical = JSON.parse(JSON.stringify(answered)); historical.requestId = 'request-historical'; historical.turnId = 'turn-request-historical'; historical.outcome.outcomeId = 'outcome-request-historical'; historical.outcome.assignmentRevision = '1'
    const foreign = JSON.parse(JSON.stringify(answered)); foreign.requestId = 'request-foreign'; foreign.turnId = 'turn-request-foreign'; foreign.outcome.outcomeId = 'outcome-request-foreign'; foreign.outcome.taskId = 'task-foreign'
    const replies = [open, answered, stale, historical, foreign]
    const lane = useHallTypedDeliberation({ chatApi: { get: async () => ({ data: { data: replies.shift() } }) }, actorScopeKey: ref('owner'), authorizationGeneration: ref(1),
      getContext: () => context.value, getContextGeneration: () => 1, getCatalogEntries: () => [], storage: store(), enabled: () => true })
    expect(await lane.readOne('request-monotone')).to.not.equal(null)
    expect(lane.choosePending(lane.projections.value[0])).to.equal(true)
    expect(await lane.readOne('request-monotone')).to.not.equal(null)
    expect(lane.selectedPending.value).to.equal(null)
    expect(lane.projections.value[0].outcome.clarification.state).to.equal('ANSWERED')
    expect(await lane.readOne('request-monotone')).to.not.equal(null)
    expect(lane.projections.value[0].outcome.clarification.state).to.equal('ANSWERED')
    expect(await lane.readOne('request-historical')).to.not.equal(null)
    expect(lane.projections.value.find(item => item.requestId === 'request-historical').outcome.assignmentRevision).to.equal('1')
    expect(await lane.readOne('request-foreign')).to.equal(null)
    expect(lane.projections.value[0].outcome.taskId).to.equal('task-1')
    lane.dispose()
  })

  it('reacts to an UNKNOWN persisted original and retains GET-only recovery until explicit original-key resume', async () => {
    const storage = store(); const context = ref({ conversationId: '7', conversationGeneration: '1', taskId: 'task-1', targetAgentId: 'agent-1', assignmentRevision: '4' }); let posts = 0; let gets = 0
    const lane = useHallTypedDeliberation({ chatApi: { create: async () => { posts++; throw new Error('lost') }, get: async () => { gets++; return { data: { data: clarify('request-never') } } } },
      actorScopeKey: ref('owner'), authorizationGeneration: ref(1), getContext: () => context.value, getContextGeneration: () => 1, getCatalogEntries: () => [], storage, enabled: () => true })
    expect(lane.recoveryAvailable.value).to.equal(false)
    expect(await lane.submit({ content: '先记录这次讨论。' })).to.equal(false)
    expect(lane.recoveryAvailable.value).to.equal(true)
    expect(await lane.recover()).to.equal(true); expect(posts).to.equal(1); expect(gets).to.equal(0)
    lane.dispose()
  })
})
