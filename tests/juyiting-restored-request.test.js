import { expect } from 'chai'
import { ref } from 'vue'
import { setImmediate } from 'node:timers'
import { conversationFrame } from './fixtures/current-chat-stream-mock.js'
import { useHallConversation } from '../src/composables/juyiting/useHallConversation.js'

const scope = { taskId: '474', conversationId: '101', conversationGeneration: '1' }
const entry = (ordinal, state) => {
  const requestId = `request-${ordinal}`
  return { ordinal, request: { requestId, requestRevision: '1', conversationId: '101', conversationGeneration: '1',
    userMessageId: ordinal, state: state === 'STREAMING' ? 'RUNNING' : state, stateVersion: '1', steps: [],
    turns: [{ turnId: `turn-${ordinal}`, requestId, requestRevision: '1', conversationId: '101', conversationGeneration: '1',
      targetAgentId: 'wuyong', contextSnapshotId: `ctx-${ordinal}`, dispatchId: `dispatch-${ordinal}`, route: 'CHAT',
      state, stateVersion: '2776', lastDeltaSeq: '2775', terminalReason: state === 'CANCELLED' ? 'USER_REQUESTED' : null,
      finalMessageId: null, createdAt: '1', updatedAt: '2' }] } }
}
const page = (entries, extra = {}) => ({ schemaVersion: 1, scope, after: '0', through: '185', eventCursor: '0', nextAfter: null, hasMore: false, entries, ...extra })
const instances = []
const setup = (read = async () => page([entry('185', 'STREAMING')]), options = {}, messageItems = []) => {
  const calls = []; const context = ref({ taskId: '474', conversationScopeType: 'bounty', conversationScopeKey: 'task:474', mode: 'bounty', participantAgentIds: ['wuyong'], targetAgentIds: ['wuyong'] })
  const apiStore = { authorizationGeneration: 1, token: async () => null }
  const hall = useHallConversation({ apiStore, chatContext: context,
    chatMode: ref('bounty'), selectedTask: ref({ id: '474' }), selectedAgent: ref(null), outgoingMetadata: ref({}),
    globalStore: { getJiacn: 'owner', user: {} }, log: { warn() {}, error() {} }, openPanel() {}, portraitShortName: () => '', showToast() {}, ...options,
    chatApi: {
      list: async () => ({ items: [{ id: '101', conversationType: 'juyiting', conversationScopeType: 'bounty', conversationScopeKey: 'task:474' }] }),
      get: async (path, params, options) => {
        calls.push({ path, params })
        if (path === '/conversation/messages') return options.onSuccess({ items: messageItems, hasMore: false, nextCursor: null, requestPage: await read(path, params), outcomeSummaries: [] })
        return read(path, params)
      },
      post: async (path, body) => { calls.push({ path, body }); return { ...entry('185', 'CANCELLED').request.turns[0], stateVersion: '2777' } }
    } })
  instances.push(hall); return { hall, calls, context, apiStore }
}
describe('exact-conversation current round restoration', () => {
  afterEach(() => instances.splice(0).forEach(hall => hall.disposeHallConversation()))
  it('restores latest durable ordinal before content/events instead of old cancelled round; cancellation targets its exact checkpoint', async () => {
    const { hall, calls } = setup()
    expect(await hall.loadHallMessages()).to.equal(true)
    expect(hall.activeRequest.value.requestId).to.equal('request-185')
    expect(hall.durableCancelTarget.value).to.deep.equal({ turnId: 'turn-185' })
    expect(calls.map(c => c.path)).to.deep.equal(['/conversation/messages'])
    expect(calls[0].params).to.deep.equal({ id: '101' })
    await hall.cancelDeliberation(hall.durableCancelTarget.value)
    const write = calls.find(c => c.body)
    expect(write.path).to.equal('/turns/turn-185/cancel')
    expect(write.body).to.deep.equal({ expectedStateVersion: '2776' })
  })
  it('subscribes after the request snapshot and receives a reply committed before connection without replaying old history', async () => {
    const originalFetch = global.fetch; let transportRequestId; let controller; let cursor
    const { hall, apiStore } = setup(async () => page([entry('185', 'STREAMING')], { eventCursor: '9007199254740993' }), {},
      Array.from({ length: 20 }, (_, index) => ({ id: String(index + 500), messageType: 'USER', content: `page-message-${index}`, createTime: 1000 })))
    apiStore.token = async () => 'test-token'
    global.fetch = async (_url, options) => {
      const headers = new Headers(options.headers)
      cursor = headers.get('Last-Event-ID'); transportRequestId = headers.get('X-Request-Id')
      return new Response(new ReadableStream({ start(value) { controller = value } }), { status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'X-Request-Id': transportRequestId } })
    }
    const flush = async () => { for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve)) }
    try {
      expect(await hall.loadHallMessages()).to.equal(true); await flush()
      expect(cursor).to.equal('conversation:101:9007199254740993')
      expect(hall.messages.value).to.have.length(20)
      // This delta committed after the restored snapshot, before the live subscription.
      controller.enqueue(new TextEncoder().encode(conversationFrame({ type: 'agent_message_delta', conversationId: '101',
        requestId: 'request-185', turnId: 'turn-185', deltaSeq: '2776', stateVersion: '2777', content: 'gap-reply' }, '9007199254740994', transportRequestId)))
      controller.enqueue(new TextEncoder().encode(conversationFrame({ type: 'stream_ready', conversationId: '101',
        cursor: '9007199254740994', nextCursor: '9007199254740994' }, '9007199254740994', transportRequestId)))
      await flush()
      expect(hall.activeTurns.value[0].lastDeltaSeq).to.equal('2776')
      expect(hall.messages.value.some(message => message.content.includes('gap-reply'))).to.equal(true)
      expect(hall.messages.value).to.have.length(21)
      expect(hall.eventStreamRecovering.value).to.equal(false)
    } finally { hall.disposeHallConversation(); global.fetch = originalFetch }
  })
  it('consumes unloaded historical status/delta replay without changing the restored round or reconnecting', async () => {
    const originalFetch = global.fetch; let controller; let transportRequestId; let fetches = 0
    const hints = []
    const { hall, apiStore } = setup(undefined, { onRequestCatalogHint: async event => { hints.push(event); return true } }); apiStore.token = async () => 'test-token'
    global.fetch = async (_url, options) => {
      fetches++; transportRequestId = new Headers(options.headers).get('X-Request-Id')
      return new Response(new ReadableStream({ start(value) { controller = value } }), { status: 200, headers: { 'Content-Type': 'text/event-stream', 'X-Request-Id': transportRequestId } })
    }
    try {
      expect(await hall.loadHallMessages()).to.equal(true)
      await new Promise(resolve => setImmediate(resolve))
      for (const [seq, event] of [
        ['1', { type: 'interaction.state_changed', requestId: 'request-184', state: 'RUNNING' }],
        ['2', { type: 'agent_message_delta', requestId: 'request-184', turnId: 'turn-184', deltaSeq: '1', stateVersion: '2', delta: 'old' }],
        ['3', { type: 'agent_message_delta', requestId: 'request-185', turnId: 'turn-185', deltaSeq: '2776', stateVersion: '2777', delta: 'current' }]
      ]) controller.enqueue(new TextEncoder().encode(conversationFrame({ ...event, conversationId: '101' }, seq, transportRequestId)))
      await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve))
      expect(hall.activeRequest.value.requestId).to.equal('request-185')
      expect(hall.activeTurns.value[0].lastDeltaSeq).to.equal('2776')
      expect(hall.messages.value.some(message => message.turnId === 'turn-184')).to.equal(false)
      expect(fetches).to.equal(1)
      expect(hall.eventStreamRecovering.value).to.equal(false)
      controller.enqueue(new TextEncoder().encode(conversationFrame({ type: 'stream_ready', conversationId: '101', cursor: '3', nextCursor: '3' }, '3', transportRequestId)))
      await new Promise(resolve => setImmediate(resolve))
      controller.enqueue(new TextEncoder().encode(conversationFrame({ type: 'interaction.state_changed', conversationId: '101', requestId: 'new-other-client', state: 'RUNNING' }, '4', transportRequestId)))
      await new Promise(resolve => setImmediate(resolve))
      expect(hall.activeRequest.value.requestId).to.equal('request-185')
      expect(hints.at(-1).requestId).to.equal('new-other-client')
      expect(fetches).to.equal(1)
    } finally { hall.disposeHallConversation(); global.fetch = originalFetch }
  })
  it('restores the latest request while adopting older displayed request associations in the same response', async () => {
    const { hall, calls } = setup(async () => page([entry('184', 'CANCELLED'), entry('185', 'STREAMING')]))
    expect(await hall.loadHallMessages()).to.equal(true)
    expect(hall.activeRequest.value.requestId).to.equal('request-185')
    expect(hall.messageRequestPage.value.entries.map(value => value.request.requestId)).to.deep.equal(['request-184', 'request-185'])
    expect(calls.map(value => value.path)).to.deep.equal(['/conversation/messages'])
  })
  it('uses one current-round request even when its ordinal is beyond many historical pages', async () => {
    const { hall, calls } = setup(async () => page([entry('10001', 'STREAMING')], { through: '10001' }))
    expect(await hall.loadHallMessages()).to.equal(true)
    expect(calls.filter(call => call.path === '/conversations/101/requests')).to.have.length(0)
    expect(calls[0].params).to.deep.equal({ id: '101' })
    expect(hall.activeRequest.value.requestId).to.equal('request-10001')
  })
  it('loads empty conversation messages without inventing an active request', async () => {
    const { hall } = setup(async () => page([], { through: '0' }))
    expect(await hall.loadHallMessages()).to.equal(true)
    expect(hall.activeRequest.value).to.equal(null)
  })
  for (const mutation of ['foreign-task', 'foreign-conversation', 'boundary', 'has-more', 'missing-event-cursor', 'invalid-event-cursor']) it(`rejects latest ${mutation} without restoring a partial older request`, async () => {
    const { hall, calls } = setup(async () => {
      const next = page([entry('185', 'STREAMING')], { scope: { ...scope } })
      if (mutation === 'boundary') next.through = '186'
      else if (mutation === 'foreign-task') next.scope.taskId = '999'
      else if (mutation === 'foreign-conversation') next.scope.conversationId = '999'
      else if (mutation === 'missing-event-cursor') delete next.eventCursor
      else if (mutation === 'invalid-event-cursor') next.eventCursor = 42
      else { next.through = '186'; next.hasMore = true; next.nextAfter = '185' }
      return next
    })
    expect(await hall.loadHallMessages()).to.equal(false)
    expect(hall.activeRequest.value).to.equal(null)
    expect(hall.conversationLoadError.value).not.to.equal('')
    expect(calls.map(c => c.path)).to.deep.equal(['/conversation/messages'])
    expect(hall.messages.value).to.deep.equal([])
  })
  it('does not reapply a request after the task scope changes during its read', async () => {
    let finish; const pending = new Promise(resolve => { finish = resolve })
    const { hall, context } = setup(() => pending)
    const load = hall.loadHallMessages(); await Promise.resolve(); await Promise.resolve()
    context.value = { ...context.value, taskId: '999', conversationScopeKey: 'task:999' }
    finish(page([entry('185', 'STREAMING')]))
    expect(await load).to.equal(false)
    expect(hall.activeRequest.value).to.equal(null)
  })
})

describe('restored EXECUTE request terminal readback', () => {
  afterEach(() => instances.splice(0).forEach(hall => hall.disposeHallConversation()))
  const execute = (state = 'RUNNING', version = '0') => ({ ordinal: '185', request: {
    requestId: 'execute-185', requestRevision: '1', conversationId: '101', conversationGeneration: '1', userMessageId: '185',
    state, stateVersion: version, turns: [], steps: [{ stepId: 'step-185', stepNumber: '1', taskId: '474', assignmentRevision: '1',
      targetAgentId: 'wuyong', kind: 'EXECUTE', state, stateVersion: version, executionIntentId: 'intent-185', executionId: 'execution-185', executionState: state }]
  } })
  const tick = () => new Promise(resolve => setImmediate(resolve))

  for (const historical of [false, true]) it(`media-final event reads only its active execution (historical=${historical})`, async () => {
    let controller; let transport; const originalFetch = global.fetch
    const { hall, calls, apiStore } = setup(async path => path === '/requests/execute-185'
      ? execute('RESULT_COMMITTED', '1').request : page([execute()]))
    apiStore.token = async () => 'test-token'
    global.fetch = async (_url, options) => {
      transport = new Headers(options.headers).get('X-Request-Id')
      return new Response(new ReadableStream({ start(c) { controller = c } }), { headers: { 'Content-Type': 'text/event-stream', 'X-Request-Id': transport } })
    }
    try {
      expect(await hall.loadHallMessages()).to.equal(true); await tick()
      expect(hall.isConversationBusy.value).to.equal(true)
      // ChatBountyAssetProjector success event has requestId but no CHAT turnId/stateVersion.
      controller.enqueue(new TextEncoder().encode(conversationFrame({ type: 'agent_message', conversationId: '101', requestId: historical ? 'older-execute' : 'execute-185',
        messageId: '900', senderType: 'agent', senderName: '好汉', content: '已生成成果；可预览或下载。', parts: [] }, '1', transport)))
      await tick(); await tick()
      expect(calls.filter(c => c.path === '/requests/execute-185')).to.have.length(historical ? 0 : 1)
      expect(hall.activeRequest.value.state).to.equal(historical ? 'RUNNING' : 'RESULT_COMMITTED')
      expect(hall.isConversationBusy.value).to.equal(historical)
      expect(calls.some(c => c.body)).to.equal(false)
    } finally { hall.disposeHallConversation(); global.fetch = originalFetch }
  })

  it('manual retry rechecks the exact restored request without resending execution', async () => {
    const { hall, calls } = setup(async path => path === '/requests/execute-185'
      ? execute('RESULT_COMMITTED', '1').request : page([execute()]))
    await hall.loadHallMessages()
    expect(hall.isConversationBusy.value).to.equal(true)
    await hall.retryHallConversation()
    expect(calls.filter(c => c.path === '/requests/execute-185')).to.have.length(1)
    expect(hall.activeRequest.value.state).to.equal('RESULT_COMMITTED')
    expect(hall.isConversationBusy.value).to.equal(false)
    expect(calls.some(c => c.body)).to.equal(false)
  })
  for (const failure of ['wrong-generation', 'old-version', 'network']) it(`does not clear busy for ${failure} readback`, async () => {
    const { hall, calls } = setup(async path => {
      if (path !== '/requests/execute-185') return page([execute('RUNNING', '2')])
      if (failure === 'network') throw new Error('synthetic network loss')
      const value = execute('RESULT_COMMITTED', failure === 'old-version' ? '1' : '3').request
      if (failure === 'wrong-generation') value.conversationGeneration = '2'
      return value
    })
    await hall.loadHallMessages()
    await hall.retryHallConversation()
    expect(hall.activeRequest.value.state).to.equal('RUNNING')
    expect(hall.isConversationBusy.value).to.equal(true)
    expect(calls.some(c => c.body)).to.equal(false)
  })

  it('drops late manual recovery after task switch and does not reload history for the new task', async () => {
    let finish
    const { hall, calls, context } = setup(async path => path === '/requests/execute-185'
      ? new Promise(resolve => { finish = resolve }) : page([execute()]))
    await hall.loadHallMessages()
    const before = calls.filter(c => c.path === '/conversation/messages').length
    const retry = hall.retryHallConversation(); await tick()
    context.value = { ...context.value, taskId: '999', conversationScopeKey: 'task:999' }
    finish(execute('RESULT_COMMITTED', '1').request)
    expect(await retry).to.equal(false)
    expect(calls.filter(c => c.path === '/conversation/messages')).to.have.length(before)
    expect(hall.activeRequest.value?.state).not.to.equal('RESULT_COMMITTED')
  })

})


describe('bounded event projection invalidation', () => {
  afterEach(() => instances.splice(0).forEach(hall => hall.disposeHallConversation()))
  it('preserves all changed request identities arriving during an in-flight refresh', async () => {
    const hints = []; let finish
    const { hall } = setup(undefined, { onRequestCatalogHint: async event => {
      hints.push(event)
      if (hints.length === 1) await new Promise(resolve => { finish = resolve })
      return true
    } })
    hall.conversationId.value = '101'
    const first = hall.refreshHallProjections({ type: 'agent_message', conversationId: '101', requestId: 'one' })
    const joined = hall.refreshHallProjections({ type: 'agent_message', conversationId: '101', requestId: 'two' })
    hall.refreshHallProjections({ type: 'action_started', conversationId: '101', requestId: 'three', childRequestId: 'child' })
    expect(joined).to.equal(first); finish(); expect(await first).to.equal(true)
    expect(hints).to.have.length(2)
    expect(hints[1].events.map(event => event.requestId)).to.deep.equal(['two', 'three'])
    expect(hints[1].events[1].childRequestId).to.equal('child')
  })
  it('101 historical event frames trigger one projection refresh at stream-ready, then live hints stay targeted', async () => {
    const originalFetch = global.fetch; const hints = []; let controller; let transportRequestId
    const { hall, apiStore } = setup(undefined, { onRequestCatalogHint: async event => { hints.push(event); return true } })
    apiStore.token = async () => 'test-token'
    global.fetch = async (_url, options) => {
      transportRequestId = new Headers(options.headers).get('X-Request-Id')
      return new Response(new ReadableStream({ start(value) { controller = value } }), { status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'X-Request-Id': transportRequestId } })
    }
    const settle = () => new Promise(resolve => setImmediate(resolve))
    const push = (event, seq) => controller.enqueue(new TextEncoder().encode(conversationFrame({ conversationId: '101', ...event }, seq, transportRequestId)))
    try {
      expect(await hall.loadHallMessages()).to.equal(true); await settle()
      for (let i = 1; i <= 101; i++) push({ type: 'action_failed', requestId: `old-${i}` }, String(i))
      await settle(); expect(hints).to.deep.equal([])
      push({ type: 'stream_ready', cursor: '101', nextCursor: '101' }, '101')
      await settle(); expect(hints.map(hint => hint.type)).to.deep.equal(['resync_required'])
      push({ type: 'delivery_review_changed', requestId: 'live-request', parentOutcomeId: 'review-outcome', childRequestId: 'new-child' }, '102')
      await settle(); expect(hints).to.have.length(2); expect(hints[1].requestId).to.equal('live-request'); expect(hints[1].childRequestId).to.equal('new-child')
    } finally { hall.disposeHallConversation(); global.fetch = originalFetch }
  })
})
