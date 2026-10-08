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
it('reads every page through a fixed bound without storage', async() => {
  const calls=[]; const context=ref({conversationId:'conversation_1',taskId:'task_1',targetAgentId:'agent_1',assignmentRevision:'0'}); const generation=ref(1)
  const entries=Array.from({length:101},(_,i) => ({ordinal:String(i+1),request:request(`req_${i+1}`)}))
  const api={get:async(_path,params) => {calls.push(params); const after=Number(params.after||0); const rows=entries.filter(v => Number(v.ordinal)>after).slice(0,100); return {data:{data:page(String(after),'101',rows,after===0,after===0?'100':null)}}}}
  const lane=useHallBountyRequestCatalog({chatApi:api,enabled:() => true,identityScope:ref('owner'),authorizationGeneration:ref(1),getContext:() => context.value,getContextGeneration:() => generation.value})
  expect(await lane.refresh()).to.equal(true); expect(lane.entries.value).to.have.length(101); expect(calls).to.deep.equal([{after:'0'},{expectedGeneration:'1',after:'100',through:'101'}]); lane.dispose()
})

it('rescans from zero for a late low ordinal without deleting the already verified page', async () => {
  const calls=[]; const context=ref({conversationId:'conversation_1',taskId:'task_1'}); const contextGeneration=ref(1)
  let scan=0
  const api={get:async(_path,params) => {
    calls.push({...params}); const late=scan++ >= 1
    const records=late ? [{ordinal:'1',request:request('late')},{ordinal:'101',request:request('one')}] : [{ordinal:'101',request:request('one')}]
    const after=BigInt(params.after || '0'); const rows=records.filter(row => BigInt(row.ordinal)>after)
    return {data:{data:page(String(after),late?'101':'101',rows)}}
  }}
  const lane=useHallBountyRequestCatalog({chatApi:api,enabled:() => true,identityScope:ref('owner'),authorizationGeneration:ref(1),getContext:() => context.value,getContextGeneration:() => contextGeneration.value})
  expect(await lane.refresh()).to.equal(true)
  expect(await lane.refresh()).to.equal(true)
  expect(calls.map(value => value.after)).to.deep.equal(['0','0'])
  expect(lane.entries.value.map(value => value.request.requestId)).to.deep.equal(['late','one'])
  lane.dispose()
})

it('drops a delayed read after identity, target, or generation fencing without a write', async () => {
  const identity=ref('owner-a'); const auth=ref(1); const context=ref({conversationId:'conversation_1',taskId:'task_1',targetAgentId:'agent-a',assignmentRevision:'0'}); const contextGeneration=ref(1)
  let resolve; let gets=0; let posts=0
  const api={get:async() => {gets++; return new Promise(done => {resolve=done})},execute:async() => {posts++; throw new Error('catalog is read-only')}}
  const lane=useHallBountyRequestCatalog({chatApi:api,enabled:() => true,identityScope:identity,authorizationGeneration:auth,getContext:() => context.value,getContextGeneration:() => contextGeneration.value})
  const pending=lane.refresh()
  identity.value='owner-b'; auth.value=2; context.value={...context.value,targetAgentId:'agent-b'}; contextGeneration.value++
  resolve({data:{data:page('0','1',[{ordinal:'1',request:request('one')}])}})
  expect(await pending).to.equal(false)
  expect(gets).to.equal(1); expect(posts).to.equal(0); expect(lane.entries.value).to.deep.equal([])
  lane.dispose()
})

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

it('releases only its own scan slot when durable conversation generation invalidates an in-flight scan', async () => {
  const contextGeneration=ref(1); let resolveFirst; let calls=0
  const api={get:async() => { calls++; if(calls===1)return await new Promise(resolve => {resolveFirst=resolve}); return {data:{data:page('0','1',[{ordinal:'1',request:request('one')}])}} }}
  const lane=useHallBountyRequestCatalog({chatApi:api,enabled:() => true,identityScope:ref('owner'),authorizationGeneration:ref(1),
    getContext:() => ({conversationId:'conversation_1',taskId:'task_1'}),getContextGeneration:() => contextGeneration.value})
  try {
    const first=lane.refresh(); contextGeneration.value++
    resolveFirst({data:{data:page('0','1',[{ordinal:'1',request:request('one')}])}})
    expect(await first).to.equal(false)
    expect(lane.loading.value).to.equal(false)
    expect(await lane.refresh()).to.equal(true)
    expect(lane.entries.value).to.have.length(1)
  } finally { lane.dispose() }
})

it('an old scan completion cannot clear the slot or loading state of the new context scan', async () => {
  let resolveOld; let resolveNew; let calls=0
  const api={get:async() => await new Promise(resolve => { if(++calls===1)resolveOld=resolve; else resolveNew=resolve })}
  const lane=useHallBountyRequestCatalog({chatApi:api,enabled:() => true,identityScope:ref('owner'),authorizationGeneration:ref(1),
    getContext:() => ({conversationId:'conversation_1',taskId:'task_1'}),getContextGeneration:() => 1})
  try {
    const old=lane.refresh(); lane.reset(); const next=lane.refresh()
    const body={data:{data:page('0','1',[{ordinal:'1',request:request('one')}])}}
    resolveOld(body); expect(await old).to.equal(false); expect(lane.loading.value).to.equal(true)
    resolveNew(body); expect(await next).to.equal(true); expect(lane.loading.value).to.equal(false)
  } finally {lane.dispose()}
})
