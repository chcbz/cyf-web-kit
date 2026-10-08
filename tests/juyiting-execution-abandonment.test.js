import { expect } from 'chai'
import { ref } from 'vue'
import { createApi } from '../src/composables/useHttp.js'
import { abandonmentCommand, validAbandonmentReceipt, useHallExecutionAbandonment } from '../src/composables/juyiting/useHallExecutionAbandonment.js'
import { useHallConversation } from '../src/composables/juyiting/useHallConversation.js'

const request = (patch = {}) => ({ requestId: 'request-1', requestRevision: '1', conversationId: '42', conversationGeneration: '1',
  userMessageId: '7', state: 'RUNNING', stateVersion: '0', turns: [], steps: [{ stepId: 'step-1', stepNumber: '1', taskId: 'task-1',
    assignmentRevision: '1', targetAgentId: 'agent-1', kind: 'EXECUTE', state: 'RUNNING', stateVersion: '2', executionIntentId: 'intent-1',
    executionId: 'execution-1', executionState: 'RUNNING' }], ...patch })
const intent = () => ({ conversationId: '42', requestId: 'request-1', idempotencyKey: 'abandon-key-0001', body: abandonmentCommand(request(), '42') })
const receipt = (patch = {}) => ({ operationId: 'a'.repeat(64), conversationId: '42', requestId: 'request-1', stepId: 'step-1', executionId: 'execution-1',
  state: 'CANCELLED', requestStateVersion: '1', stepStateVersion: '3', reason: 'OWNER_ABANDONED_UNDELIVERED', providerAlreadyStarted: true,
  providerStopped: false, paidFactsPreserved: true, ...patch })
const memory = () => { const data = new Map(); return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) } }
const deferred = () => { let resolve; let reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail }); return { promise, resolve, reject } }
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
const setup = (execute = async () => receipt(), options = {}) => {
  const calls = []; const storage = options.storage || memory(); const identityKey = options.identityKey || ref('owner-a')
  const conversationId = options.conversationId || ref('42')
  const client = useHallExecutionAbandonment({ api: { execute: async options => { calls.push(options); return execute(options, calls.length) } },
    storage, identityKey, conversationId, idempotencyKeyFactory: () => 'abandon-key-0001', ...options })
  return { client, calls, storage, identityKey, conversationId }
}

describe('execution abandonment immutable recovery and authority boundaries', () => {
  it('admits only one exact running EXECUTE with canonical request/step versions', () => {
    expect(abandonmentCommand(request(), '42')).to.deep.equal(intent().body)
    for (const candidate of [request({ state: 'COMPLETED' }), request({ stateVersion: 0 }), request({ stateVersion: '01' }),
      request({ stateVersion: '9223372036854775807' }), request({ steps: [] }), request({ steps: [...request().steps, ...request().steps] }),
      request({ steps: [{ ...request().steps[0], executionId: null }] }), request({ steps: [{ ...request().steps[0], kind: 'INSPECT' }] }),
      request({ steps: [{ ...request().steps[0], state: 'OUTPUT_COMMITTED' }] }), request({ conversationId: '43' })]) {
      expect(abandonmentCommand(candidate, '42')).to.equal(null)
    }
  })
  it('validates every receipt binding, exact increment and truthful paid/Provider facts', () => {
    expect(validAbandonmentReceipt(receipt(), intent())).to.equal(true)
    for (const patch of [{ operationId: 'not-a-hash' }, { conversationId: '43' }, { requestId: 'other' }, { stepId: 'other' }, { executionId: 'other' },
      { state: 'COMPLETED' }, { requestStateVersion: '2' }, { stepStateVersion: 3 }, { reason: 'REFUNDED' },
      { providerAlreadyStarted: false }, { providerStopped: true }, { paidFactsPreserved: false }, { extra: true }]) {
      expect(validAbandonmentReceipt(receipt(patch), intent())).to.equal(false)
    }
  })
  it('persists and reads back the exact original command before a single authenticated POST', async () => {
    const context = setup(async options => {
      expect(JSON.parse([...context.storage.data.values()][0])).to.deep.equal(intent())
      expect(options.data).to.deep.equal(intent().body)
      expect(options.url).to.equal('/conversations/42/requests/request-1/abandon-execution')
      return { data: { data: receipt() } }
    })
    try {
      expect(await context.client.submit(request())).to.deep.equal(receipt())
      expect(context.calls.length).to.equal(1)
      expect(context.calls[0]).to.include({ method: 'POST', autoLoading: false, needAuth: true })
      expect(context.calls[0].headers).to.deep.equal({ 'Idempotency-Key': 'abandon-key-0001' })
      expect(context.client.status.value.state).to.equal('completed')
      await context.client.submit(request()); await context.client.resume()
      expect(context.calls.length).to.equal(1)
    } finally { context.client.dispose() }
  })
  it('uses actual createApi/useHttp/fetch with authenticated exact JSON and original-key readback', async () => {
    const originalFetch = globalThis.fetch; const wire = []
    const api = createApi('/chat')
    const { client } = setup(undefined, { api: { execute: options => api.execute({ ...options, rum: false,
      authStore: { authorizationGeneration: 1, token: async () => 'test-abandonment-token' } }) } })
    globalThis.fetch = async (url, options) => {
      wire.push({ url: String(url), options })
      if (wire.length === 1) return new Response(JSON.stringify({ message: 'conflict' }), { status: 409, headers: { 'Content-Type': 'application/json' } })
      return new Response(JSON.stringify({ data: receipt() }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    try {
      expect(await client.submit(request())).to.equal(null)
      expect(client.status.value.state).to.equal('unknown'); expect(client.status.value.message).to.include('已有成果')
      expect(await client.check()).to.deep.equal(receipt())
      expect(wire.map(call => call.options.method)).to.deep.equal(['POST', 'GET'])
      expect(wire.every(call => call.url === '/chat/conversations/42/requests/request-1/abandon-execution')).to.equal(true)
      expect(wire.every(call => call.options.headers.Authorization === 'Bearer test-abandonment-token')).to.equal(true)
      expect(wire.every(call => call.options.headers['Idempotency-Key'] === 'abandon-key-0001')).to.equal(true)
      expect(JSON.parse(wire[0].options.body)).to.deep.equal(intent().body)
      expect(wire[1].options.body).to.equal(undefined)
    } finally { client.dispose(); globalThis.fetch = originalFetch }
  })
  it('serializes double clicks and cannot replace the original request while a write is unknown', async () => {
    const pending = deferred(); const { client, calls } = setup(() => pending.promise)
    try {
      const first = client.submit(request()); await client.submit(request({ requestId: 'other' }))
      expect(calls.length).to.equal(1)
      pending.reject(new TypeError('lost ack')); await first
      expect(client.status.value.state).to.equal('unknown')
      await client.submit(request({ requestId: 'other' })); expect(calls.length).to.equal(1)
      expect(client.status.value.intent).to.deep.equal(intent())
    } finally { client.dispose() }
  })
  it('a GET404 retains the original key/body and explicit resume never sends new generation', async () => {
    const { client, calls } = setup(async (_options, n) => {
      if (n === 1) throw new TypeError('lost ack')
      if (n === 2) throw Object.assign(new Error('not found yet'), { status: 404 })
      return receipt()
    })
    try {
      await client.submit(request()); await client.check()
      expect(client.status.value.state).to.equal('unknown'); await client.resume()
      expect(calls.map(item => item.method)).to.deep.equal(['POST', 'GET', 'POST'])
      expect(calls[1]).not.to.have.property('data')
      expect(calls[0].data).to.equal(calls[2].data)
      expect(new Set(calls.map(item => item.headers['Idempotency-Key'])).size).to.equal(1)
      expect(calls.every(item => item.url.endsWith('/abandon-execution'))).to.equal(true)
      expect(client.status.value.state).to.equal('completed')
    } finally { client.dispose() }
  })
  it('remount only restores intent; queries the original operation without auto POST', async () => {
    const storage = memory(); const first = setup(async () => { throw new TypeError('unknown') }, { storage })
    await first.client.submit(request()); first.client.dispose()
    const next = setup(undefined, { storage })
    try {
      expect(next.client.status.value.state).to.equal('unknown'); expect(next.calls).to.deep.equal([])
      await next.client.check(); expect(next.calls.map(call => call.method)).to.deep.equal(['GET'])
      expect(next.client.status.value.state).to.equal('completed')
    } finally { next.client.dispose() }
  })
  it('identity and conversation switches abort and suppress late old receipts while retaining the original scope record', async () => {
    for (const changeIdentity of [true, false]) {
      const pending = deferred(); const { client, calls, identityKey, conversationId, storage } = setup(() => pending.promise)
      try {
        const submitted = client.submit(request())
        if (changeIdentity) identityKey.value = 'owner-b'; else conversationId.value = '43'
        expect(calls[0].signal.aborted).to.equal(true); expect(client.status.value.intent).to.equal(null)
        pending.resolve(receipt()); await submitted
        expect(client.status.value.receipt).to.equal(null); expect(storage.data.size).to.equal(1)
        if (changeIdentity) identityKey.value = 'owner-a'; else conversationId.value = '42'
        expect(client.status.value.state).to.equal('unknown'); expect(client.status.value.intent).to.deep.equal(intent())
      } finally { client.dispose() }
    }
  })
  it('rejects corrupt persisted intent instead of overwriting it or starting a new operation', async () => {
    const storage = memory(); const storeKey = 'juyiting:execution-abandon:v1:owner-a:42'
    storage.setItem(storeKey, '{broken')
    const { client, calls } = setup(undefined, { storage })
    try {
      expect(client.status.value.state).to.equal('recovery_error')
      await client.submit(request()); await client.resume(); await client.check()
      expect(calls).to.deep.equal([]); expect(storage.getItem(storeKey)).to.equal('{broken')
    } finally { client.dispose() }
  })
  it('does not POST if recovery storage is denied or readback differs', async () => {
    for (const storage of [{ getItem: () => null, setItem: () => { throw new Error('denied') } }, { getItem: () => null, setItem: () => {} }]) {
      const { client, calls } = setup(undefined, { storage })
      try { await client.submit(request()); expect(calls.length).to.equal(0); expect(client.status.value.state).to.equal('recovery_error') } finally { client.dispose() }
    }
  })
  it('conflict and malformed receipt stay unconfirmed and preserve the original operation', async () => {
    for (const response of [() => { throw Object.assign(new Error('staged result'), { status: 409 }) }, () => receipt({ providerStopped: true })]) {
      const { client, calls } = setup(response)
      try {
        expect(await client.submit(request())).to.equal(null); expect(calls.length).to.equal(1)
        expect(client.status.value.state).to.equal('unknown'); expect(client.status.value.receipt).to.equal(null)
        expect(client.status.value.intent).to.deep.equal(intent())
      } finally { client.dispose() }
    }
  })
  it('dispose aborts only owned requests and never publishes a late receipt', async () => {
    const pending = deferred(); const { client, calls } = setup(() => pending.promise)
    const promise = client.submit(request()); client.dispose(); pending.resolve(receipt()); await promise
    expect(calls[0].signal.aborted).to.equal(true); expect(client.status.value.receipt).to.equal(null)
  })
})

const conversation = (get, hints = []) => useHallConversation({ apiStore: { authorizationGeneration: 1, token: async () => '' },
  chatApi: { get }, chatContext: ref({ conversationScopeType: 'bounty', conversationScopeKey: 'task:task-1', mode: 'bounty',
    participantAgentIds: ['agent-1'], targetAgentIds: ['agent-1'], targetAgentId: 'agent-1' }),
  chatMode: ref('bounty'), globalStore: { user: { username: 'owner-a' } }, log: { warn () {}, error () {} },
  openPanel () {}, outgoingMetadata: ref({}), portraitShortName: () => '', selectedAgent: ref({ agentId: 'agent-1' }),
  selectedTask: ref({ id: 'task-1' }), showToast () {}, onRequestCatalogHint: event => hints.push(event) })

describe('execution abandonment authoritative request readback', () => {
  it('treats the scoped receipt as a hint, never as local request completion', async () => {
    const pending = deferred(); const calls = []; const hints = []
    const client = conversation(async path => { calls.push(path); return pending.promise }, hints)
    try {
      client.conversationId.value = '42'; client.activeRequest.value = request(); client.isAwaitingReply.value = true
      expect(client.refreshExecutionRequest(receipt())).to.equal(true)
      expect(client.activeRequest.value.state).to.equal('RUNNING')
      expect(calls).to.deep.equal(['/requests/request-1']); expect(hints.length).to.equal(1)
      const terminal = request({ state: 'CANCELLED', stateVersion: '1', steps: [{ ...request().steps[0], state: 'CANCELLED', stateVersion: '3', executionState: 'CANCELLED' }] })
      pending.resolve({ data: { data: terminal } }); await flush()
      expect(client.activeRequest.value.state).to.equal('CANCELLED'); expect(client.isAwaitingReply.value).to.equal(false)
    } finally { client.disposeHallConversation() }
  })
  it('foreign conversation and request hints cannot replace active request, historical request only refreshes the catalog', async () => {
    const calls = []; const hints = []; const client = conversation(async path => { calls.push(path); return {} }, hints)
    try {
      client.conversationId.value = '42'; client.activeRequest.value = request()
      expect(client.refreshExecutionRequest(receipt({ conversationId: '43' }))).to.equal(false)
      expect(client.refreshExecutionRequest(receipt({ requestId: '' }))).to.equal(false)
      expect(client.refreshExecutionRequest(receipt({ requestId: 'older-request' }))).to.equal(true)
      expect(calls).to.deep.equal([]); expect(hints.length).to.equal(1)
      expect(client.activeRequest.value.state).to.equal('RUNNING')
    } finally { client.disposeHallConversation() }
  })
})
