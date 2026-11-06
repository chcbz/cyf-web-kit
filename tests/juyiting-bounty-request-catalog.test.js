import { expect } from 'chai'
import { catalogPage, catalogRequest, mergeCatalogEntries } from '../src/composables/juyiting/bountyRequestCatalog.js'
const scope={conversationId:'conversation_1',conversationGeneration:'1',taskId:'task_1'}
const request=id => ({requestId:id,requestRevision:'1',conversationId:'conversation_1',conversationGeneration:'1',userMessageId:'1',state:'COMPLETED',stateVersion:'1',turns:[],steps:[{stepId:`step_${id}`,stepNumber:'1',taskId:'task_1',assignmentRevision:'0',targetAgentId:'agent_1',kind:'EXECUTE',state:'COMPLETED',stateVersion:'1',executionIntentId:`intent_${id}`,executionId:`execution_${id}`,executionState:'OUTPUT_COMMITTED'}]})
const page=(after,through,entries,hasMore=false,nextAfter=null) => ({schemaVersion:1,scope,after,through,nextAfter,hasMore,entries})
const turn = (patch = {}) => ({ turnId: 'turn_1', requestId: 'one', requestRevision: '1', conversationId: 'conversation_1',
  conversationGeneration: '1', targetAgentId: 'agent_1', contextSnapshotId: 'snapshot_1', dispatchId: 'dispatch_1', route: 'CHAT',
  state: 'PUBLISHED', stateVersion: '1', lastDeltaSeq: '0', terminalReason: null, finalMessageId: '2', createdAt: '1', updatedAt: '1', ...patch })
describe('bounty request catalog contract',() => {
  it('merges two pages without confusing request state and step state versions',() => {
    const first=catalogPage(page('0','101',[{ordinal:'1',request:request('one')}],true,'1')); const second=catalogPage(page('1','101',[{ordinal:'101',request:request('two')}]))
    const merged=mergeCatalogEntries([],first); expect(mergeCatalogEntries(merged,second).map(v => v.request.requestId)).to.deep.equal(['one','two'])
  })
  it('rejects unsafe pagination and scope drift',() => {
    expect(catalogPage(page('01','1',[]))).to.equal(null)
    expect(catalogPage({...page('0','1',[]),scope:{...scope,conversationGeneration:'0'}})).to.equal(null)
  })
})
import { ref } from 'vue'
import { useHallBountyRequestCatalog } from '../src/composables/juyiting/useHallBountyRequestCatalog.js'
it('rejects a mismatched continuation cursor and independently advances a step while request state is unchanged', () => {
  const base=request('one'); base.turns=[turn({ turnId: 'turn_one' })]
  const first=catalogPage(page('0','2',[{ordinal:'1',request:base}],true,'1'))
  const advance=structuredClone(base); advance.steps[0].stateVersion='2'; advance.steps[0].executionState='OUTPUT_COMMITTED'; advance.turns=[turn({ turnId: 'turn_one', stateVersion: '2' })]
  const next=catalogPage(page('1','2',[{ordinal:'2',request:advance}]))
  expect(catalogPage(page('2','2',[]),{after:'1',through:'2'})).to.equal(null)
  const merged=mergeCatalogEntries(mergeCatalogEntries([],first),next)
  expect(merged[0].request.steps[0].stateVersion).to.equal('2')
  expect(merged[0].request.turns[0].stateVersion).to.equal('2')
})

it('accepts the frozen nullable execution link union and rejects foreign or incomplete bound TurnView data', () => {
  const pending = request('one')
  pending.state = 'PLANNING'; pending.steps[0] = { ...pending.steps[0], state: 'ADMITTED', executionId: null, executionState: 'WAITING_ADMISSION' }
  expect(catalogRequest(pending, scope)).to.equal(true)
  const chat = structuredClone(pending)
  chat.steps = [{ ...chat.steps[0], kind: 'CHAT', state: 'WAITING_USER', executionIntentId: null, executionId: null, executionState: null }]
  expect(catalogRequest(chat, scope)).to.equal(true)
  const historical = structuredClone(pending)
  historical.turns = [turn({ targetAgentId: 'agent_historical', terminalReason: 'completed' })]
  expect(catalogRequest(historical, scope)).to.equal(true)
  const foreign = structuredClone(pending)
  foreign.steps = []; foreign.turns = [turn({ conversationId: 'other_conversation' })]
  expect(catalogRequest(foreign, scope)).to.equal(false)
  const incomplete = structuredClone(pending)
  incomplete.steps = []; incomplete.turns = [{ turnId: 'turn_1', stateVersion: '1' }]
  expect(catalogRequest(incomplete, scope)).to.equal(false)
  const badChatLink = structuredClone(chat)
  badChatLink.steps[0].executionState = 'FORGED'
  expect(catalogRequest(badChatLink, scope)).to.equal(false)
})

it('decodes the shared latest snapshot cursor without losing bigint precision', async () => {
  const { readFileSync } = await import('node:fs')
  const { decodeHttpResponse } = await import('../src/utils/apiEnvelope.js')
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/hall-request-latest.json', import.meta.url), 'utf8'))
  const decoded = decodeHttpResponse(JSON.stringify(fixture), { status: 200, requestId: fixture.requestId }).value
  expect(catalogPage(decoded, { conversationId: '101', taskId: 'task' }).eventCursor).to.equal('9007199254740993')
  expect(catalogPage({ ...decoded, eventCursor: 9007199254740993 })).to.equal(null)
  expect(catalogPage({ ...decoded, eventCursor: '-1' })).to.equal(null)
})

describe('aggregate message-page request adoption', () => {
  const build = (identity = ref('owner')) => useHallBountyRequestCatalog({ chatApi: { get: () => { throw new Error('Display adoption must not GET') } },
    enabled: () => true, identityScope: identity, authorizationGeneration: ref(1), getContext: () => scope })
  it('replaces the supplied retained window without ID-set or single-request follow-up reads', () => {
    const lane = build()
    try {
      expect(lane.adoptPage(page('0', '2', [{ ordinal: '2', request: request('two') }]))).to.equal(true)
      expect(lane.adoptPage(page('0', '1', [{ ordinal: '1', request: request('one') }]))).to.equal(true)
      expect(lane.entries.value.map(value => value.request.requestId)).to.deep.equal(['one'])
      expect(lane.initialized.value).to.equal(true)
      expect(lane).not.to.have.property('refreshRequests')
      expect(lane).not.to.have.property('refreshWindow')
    } finally { lane.dispose() }
  })
  it('rejects foreign scopes and incomplete aggregate pages without compensating reads', () => {
    const lane = build()
    try {
      expect(lane.adoptPage({ ...page('0', '1', []), scope: { ...scope, conversationId: 'foreign' } })).to.equal(false)
      expect(lane.adoptPage(page('0', '2', [{ ordinal: '1', request: request('one') }], true, '1'))).to.equal(false)
      expect(lane.entries.value).to.deep.equal([])
    } finally { lane.dispose() }
  })
  it('clears adopted state on identity changes and cannot adopt after disposal', () => {
    const identity = ref('owner'); const lane = build(identity)
    const value = page('0', '1', [{ ordinal: '1', request: request('one') }])
    expect(lane.adoptPage(value)).to.equal(true)
    identity.value = 'other'
    expect(lane.entries.value).to.deep.equal([])
    lane.dispose()
    expect(lane.adoptPage(value)).to.equal(false)
  })
})
