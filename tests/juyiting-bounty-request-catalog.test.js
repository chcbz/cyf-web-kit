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

it('joins an in-flight catalog scan for send preparation and propagates its result', async () => {
  for (const valid of [true, false]) {
    let resolve; let calls = 0
    const body = { data: { data: page('0','1',[{ordinal:'1',request:request('one')}]) } }
    const lane = useHallBountyRequestCatalog({ chatApi: { get: () => ++calls === 1 ? new Promise(done => { resolve = done }) : Promise.resolve(body) },
      enabled: () => true, identityScope: ref('owner'), authorizationGeneration: ref(1),
      getContext: () => ({ conversationId:'conversation_1', taskId:'task_1' }), getContextGeneration: () => 1 })
    try {
      const first = lane.refresh(); const joined = lane.refresh()
      expect(joined).to.equal(first); expect(calls).to.equal(1)
      resolve(valid ? body : { data: {} })
      expect(await first).to.equal(valid); expect(await joined).to.equal(valid)
    } finally { lane.dispose() }
  }
})

it('updates only an event-named request in a 101-round catalog, including a newly discovered low ordinal', async () => {
  const calls = []; let targeted = false
  const records = Array.from({ length: 101 }, (_, i) => ({ ordinal: String(i + 2), request: request(`req_${i + 2}`) }))
  const lane = useHallBountyRequestCatalog({ chatApi: { get: async (_path, params) => {
    calls.push(params)
    if (params.requestId) {
      expect(targeted).to.equal(true)
      return page('0', '1', [{ ordinal: '1', request: request(params.requestId) }])
    }
    const after = BigInt(params.after)
    return page(params.after, '102', records.filter(row => BigInt(row.ordinal) > after).slice(0, 100), params.after === '0', params.after === '0' ? '101' : null)
  } }, enabled: () => true, identityScope: ref('owner'), authorizationGeneration: ref(1),
  getContext: () => ({ conversationId: 'conversation_1', taskId: 'task_1', conversationGeneration: '1' }) })
  try {
    expect(await lane.refresh()).to.equal(true); expect(lane.initialized.value).to.equal(true)
    calls.length = 0; targeted = true
    expect(await lane.refreshRequests(['late', 'late'])).to.equal(true)
    expect(calls).to.deep.equal([{ requestId: 'late', expectedGeneration: '1' }])
    expect(lane.entries.value).to.have.length(102)
    expect(lane.entries.value[0].request.requestId).to.equal('late')
  } finally { lane.dispose() }
})

it('targeted catalog reads fence stale identity, abort on reset, and never replace unrelated history', async () => {
  let resolve; let signal
  const lane = useHallBountyRequestCatalog({ chatApi: { get: async (_path, _params, options) => {
    signal = options.signal; return new Promise(done => { resolve = done })
  } }, enabled: () => true, identityScope: ref('owner'), authorizationGeneration: ref(1),
  getContext: () => ({ conversationId: 'conversation_1', taskId: 'task_1' }) })
  try {
    const flight = lane.refreshRequests(['one'])
    expect(lane.loading.value).to.equal(true)
    lane.reset(); expect(signal.aborted).to.equal(true)
    resolve(page('0', '1', [{ ordinal: '1', request: request('one') }]))
    expect(await flight).to.equal(false); expect(lane.entries.value).to.deep.equal([])
    expect(lane.loading.value).to.equal(false)
  } finally { lane.dispose() }
})

it('rejects targeted response containing another request or an unexpected next page', async () => {
  for (const wrong of ['request', 'pagination']) {
    const lane = useHallBountyRequestCatalog({ chatApi: { get: async () =>
      page('0', '1', [{ ordinal: '1', request: request(wrong === 'request' ? 'other' : 'one') }], wrong === 'pagination', wrong === 'pagination' ? '1' : null)
    }, enabled: () => true, identityScope: ref('owner'), authorizationGeneration: ref(1),
    getContext: () => ({ conversationId: 'conversation_1', taskId: 'task_1' }) })
    try {
      expect(await lane.refreshRequests(['one'])).to.equal(false)
      expect(lane.entries.value).to.deep.equal([]); expect(lane.error.value).not.to.equal('')
    } finally { lane.dispose() }
  }
})

it('consumes the shared full event-targeted response fixture through the existing public envelope decoder', async () => {
  const { readFileSync } = await import('node:fs')
  const { decodeHttpResponse } = await import('../src/utils/apiEnvelope.js')
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/hall-request-index-entry.json', import.meta.url), 'utf8'))
  const calls = []
  const lane = useHallBountyRequestCatalog({ chatApi: { get: async (_path, params) => { calls.push(params); return decodeHttpResponse(JSON.stringify(fixture), { status: 200, requestId: fixture.requestId }).value } },
    enabled: () => true, identityScope: ref('owner'), authorizationGeneration: ref(1),
    getContext: () => ({ conversationId: '101', conversationGeneration: '1', taskId: 'task' }) })
  try {
    expect(await lane.refreshRequests(['r7'])).to.equal(true)
    expect(lane.entries.value).to.deep.equal(fixture.data.entries)
    expect(calls).to.deep.equal([{ requestId: 'r7', expectedGeneration: '1' }])
  } finally { lane.dispose() }
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

describe('display-window request batch selection', () => {
  const build = get => useHallBountyRequestCatalog({ chatApi: { get }, enabled: () => true,
    identityScope: ref('owner'), authorizationGeneration: ref(1),
    getContext: () => ({ conversationId: 'conversation_1', taskId: 'task_1', conversationGeneration: '1' }) })
  const selectedPage = ids => {
    const rows = ids.map(id => ({ ordinal: String(Number(id.slice(1)) + 1), request: request(id) }))
      .sort((a, b) => Number(a.ordinal) - Number(b.ordinal))
    return page('0', rows.at(-1)?.ordinal || '0', rows)
  }
  it('reads fifty displayed requests out of ten thousand in one batch, no watermark or history pages', async () => {
    const all = Array.from({ length: 10000 }, (_, i) => `r${i}`); const calls = []
    const lane = build(async (path, params) => {
      const url = new URL(path, 'http://test'); const ids = url.searchParams.getAll('requestIds')
      calls.push(ids); expect(params).to.deep.equal({}); expect(url.searchParams.get('expectedGeneration')).to.equal('1')
      expect(url.searchParams.has('after')).to.equal(false)
      return selectedPage(ids)
    })
    try {
      expect(await lane.refreshWindow(all.slice(-50))).to.equal(true)
      expect(lane.entries.value).to.have.length(50); expect(calls).to.have.length(1)
      expect(calls[0]).to.deep.equal(all.slice(-50))
      expect(await lane.refreshWindow(all.slice(-100), { force: false })).to.equal(true)
      expect(calls).to.have.length(2); expect(calls[1]).to.deep.equal(all.slice(-100, -50))
      expect(lane.entries.value).to.have.length(100)
      await lane.refreshWindow(all.slice(-100), { force: false }); expect(calls).to.have.length(2)
    } finally { lane.dispose() }
  })
  it('chunks explicitly loaded windows at the existing one-hundred-entry limit', async () => {
    const calls = []; const lane = build(async path => { const ids = new URL(path, 'http://test').searchParams.getAll('requestIds'); calls.push(ids); return selectedPage(ids) })
    try { await lane.refreshWindow(Array.from({ length: 205 }, (_, i) => `r${i}`)); expect(calls.map(ids => ids.length)).to.deep.equal([100, 100, 5]); expect(lane.entries.value).to.have.length(205) }
    finally { lane.dispose() }
  })
  it('coalesces overlapping window reads and aborts on reset without reviving old history', async () => {
    const calls = []; const resolves = []; const signals = []
    const lane = build((path, _, options) => { calls.push(new URL(path, 'http://test').searchParams.getAll('requestIds')); signals.push(options.signal); return new Promise(resolve => resolves.push(resolve)) })
    try {
      const one = lane.refreshWindow(['r1', 'r2']); const two = lane.refreshWindow(['r2', 'r3'])
      expect(calls).to.deep.equal([['r1', 'r2'], ['r3']]); lane.reset(); expect(signals.every(signal => signal.aborted)).to.equal(true)
      resolves[0](selectedPage(['r1', 'r2'])); resolves[1](selectedPage(['r3']))
      expect(await one).to.equal(false); expect(await two).to.equal(false); expect(lane.entries.value).to.deep.equal([])
    } finally { lane.dispose() }
  })
  for (const mode of ['missing', 'foreign', 'page', 'failure']) it(`does not mark a ${mode} batch as a complete visible window`, async () => {
    const lane = build(async () => {
      if (mode === 'failure') throw new Error('offline')
      const result = selectedPage(mode === 'missing' ? ['r1'] : mode === 'foreign' ? ['r1', 'r3'] : ['r1', 'r2'])
      if (mode === 'page') { result.hasMore = true; result.nextAfter = result.entries.at(-1).ordinal }
      return result
    })
    try { expect(await lane.refreshWindow(['r1', 'r2'])).to.equal(false); expect(lane.initialized.value).to.equal(false); expect(lane.error.value).not.to.equal('') }
    finally { lane.dispose() }
  })
  it('an empty display window makes no request and does not invent a conversation history', async () => {
    const lane = build(async () => { throw new Error('must not fetch') })
    try { expect(await lane.refreshWindow([])).to.equal(true); expect(lane.entries.value).to.deep.equal([]); expect(lane.initialized.value).to.equal(true) }
    finally { lane.dispose() }
  })
})

it('consumes the shared batch response through the public decoder with repeated query fields intact', async () => {
  const { readFileSync } = await import('node:fs')
  const { decodeHttpResponse } = await import('../src/utils/apiEnvelope.js')
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/hall-request-index-window.json', import.meta.url), 'utf8'))
  const lane = useHallBountyRequestCatalog({ chatApi: { get: async (path, params) => {
    expect(params).to.deep.equal({})
    expect(new URL(path, 'http://test').searchParams.getAll('requestIds')).to.deep.equal(['r7', 'r9000'])
    return decodeHttpResponse(JSON.stringify(fixture), { status: 200, requestId: fixture.requestId }).value
  } }, enabled: () => true, identityScope: ref('owner'), authorizationGeneration: ref(1),
  getContext: () => ({ conversationId: '101', conversationGeneration: '1', taskId: 'task' }) })
  try { expect(await lane.refreshWindow(['r7', 'r9000'])).to.equal(true); expect(lane.entries.value).to.deep.equal(fixture.data.entries) }
  finally { lane.dispose() }
})
