import { expect } from 'chai'
import { ref } from 'vue'
import { setImmediate } from 'node:timers'
import { useHallBountyAcceptance } from '../src/composables/juyiting/useHallBountyAcceptance.js'
import { eventMessage } from '../src/utils/messageEnvelope.js'
import { useHallConversation } from '../src/composables/juyiting/useHallConversation.js'

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)) }
const view = (state = 'RUNNING') => ({ requestId: 'request-186', requestRevision: '1', conversationId: '101', conversationGeneration: '1', userMessageId: '186',
  state, stateVersion: state === 'RUNNING' ? '0' : '1', turns: [{ requestId: 'request-186', requestRevision: '1', conversationId: '101', conversationGeneration: '1',
    turnId: 'turn-186', targetAgentId: 'wuyong', route: 'CHAT', contextSnapshotId: 'ctx-186', dispatchId: 'dispatch-186',
    state: state === 'RUNNING' ? 'QUEUED' : 'FINAL_PERSISTED', stateVersion: state === 'RUNNING' ? '0' : '72', lastDeltaSeq: state === 'RUNNING' ? '0' : '70',
    finalMessageId: state === 'RUNNING' ? null : '187', terminalReason: null }], steps: [] })
const receipt = { schemaVersion: 3, intent: 'DISCUSSION', requestId: 'request-186', userMessageId: '186', turnIds: ['turn-186'], state: 'ADMITTED', stateVersion: '0', eventCursor: '9200',
  statusUrl: '/chat/requests/request-186', typedOutcomeUrl: '/chat/conversations/101/requests/request-186/typed-outcome', replay: false, pendingQuestionId: null }
const context = { taskId: '474', conversationId: '101', conversationGeneration: '1', assignmentRevision: '1', targetAgentId: 'wuyong' }

describe('SSE interrupted typed round terminal recovery', () => {
  let streamHeaders; let originalFetch; let originalTimer; let originalClear; let hall; let streams; let timers; let reads; let contentReads; let catalogHints; let currentView; let readOverride; let contentOverride; let chatContext; let apiStore; let catalogResult
  beforeEach(async () => {
    originalFetch = global.fetch; originalTimer = window.setTimeout; originalClear = window.clearTimeout
    catalogResult = true; streams = []; streamHeaders = []; timers = new Map(); reads = 0; contentReads = 0; catalogHints = []; currentView = view(); readOverride = null; contentOverride = null
    let timerId = 0
    window.setTimeout = callback => { const id = ++timerId; timers.set(id, callback); return id }
    window.clearTimeout = id => timers.delete(id)
    global.fetch = async (_url, options) => {
      let stream; const body = new ReadableStream({ start(controller) { stream = controller } })
      streams.push(stream); streamHeaders.push(new Headers(options.headers))
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream', 'X-Request-Id': new Headers(options.headers).get('X-Request-Id') } })
    }
    chatContext = ref({ taskId: '474', conversationScopeType: 'bounty', conversationScopeKey: 'task:474', mode: 'bounty', participantAgentIds: ['wuyong'], targetAgentIds: ['wuyong'] })
    apiStore = { authorizationGeneration: 1, token: async () => 'fixture-token' }
    hall = useHallConversation({ apiStore, chatContext, chatMode: ref('bounty'), selectedTask: ref({ id: '474' }), selectedAgent: ref(null), outgoingMetadata: ref({}),
      globalStore: { getJiacn: 'owner', user: {} }, log: { warn() {}, error() {} }, openPanel() {}, portraitShortName: () => '', showToast() {},
      onRequestCatalogHint: event => { catalogHints.push(event); return catalogResult },
      chatApi: {
        list: async () => ({ items: [{ id: '101', conversationType: 'juyiting', conversationScopeType: 'bounty', conversationScopeKey: 'task:474' }] }),
        get: async (path, params, options) => {
          if (path === '/conversation/messages') {
            expect(params.id).to.equal('101'); contentReads++
            const pageOptions = { ...options, onSuccess: messages => options.onSuccess({ items: messages, hasMore: false, nextCursor: null, outcomeSummaries: [], requestPage: { schemaVersion: 1, scope: { taskId: '474', conversationId: '101', conversationGeneration: '1' }, after: '0', through: '0', nextAfter: null, hasMore: false, entries: [], eventCursor: '0' } }) }
            if (contentOverride) return contentOverride(pageOptions)
            return pageOptions.onSuccess(currentView.state === 'COMPLETED' ? [{ id: '187', messageType: 'AGENT', senderType: 'agent', senderName: '吴用', content: '同一原请求的持久最终答复' }] : [])
          }
          if (path === '/conversations/101/requests') return { schemaVersion: 1, scope: { taskId: '474', conversationId: '101', conversationGeneration: '1' }, after: '0', through: '0', nextAfter: null, hasMore: false, entries: [], eventCursor: '0' }
          expect(path).to.equal('/requests/request-186'); reads++
          return readOverride ? readOverride() : structuredClone(currentView)
        },
      } })
    expect(await hall.loadHallMessages()).to.equal(true)
    expect(await hall.adoptTypedDiscussionReceipt({ receipt, context })).to.equal(true)
    await flush()
    expect(hall.isConversationBusy.value).to.equal(true)
    expect(streams).to.have.length(1)
  })
  afterEach(() => { hall?.disposeHallConversation(); global.fetch = originalFetch; window.setTimeout = originalTimer; window.clearTimeout = originalClear })
  const disconnect = async () => { streams.at(-1).error(new TypeError('network error: ERR_HTTP2_PROTOCOL_ERROR')); await flush() }
  const reconnect = async () => { expect(timers.size).to.equal(1); const [id, callback] = [...timers][0]; timers.delete(id); await callback(); await flush() }

  it('keeps original-conversation discovery independent of chat replay and reconnects', async () => {
    let catalogueReads = 0
    const acceptance = useHallBountyAcceptance({ taskId: () => '474', identityKey: () => 'owner',
      api: { list: async () => ({ items: [{ id: '101', conversationType: 'juyiting', conversationScopeType: 'bounty', conversationScopeKey: 'task:474' }] }),
        get: async () => { catalogueReads++; return { schemaVersion: 1, scope: { taskId: '474', conversationId: '101', conversationGeneration: '1' },
          after: '0', through: '1', nextAfter: null, hasMore: false, entries: [{ ordinal: '1', request: { ...structuredClone(currentView),
            turns: currentView.turns.map(turn => ({ ...turn, createdAt: '1000', updatedAt: '2000' })) } }] } } } })
    const emit = (type, sequence) => {
      const ready = type === 'stream_ready'
      const m = eventMessage(streamHeaders.at(-1).get('X-Request-Id'), ready ? 'conversation.stream.ready' : 'conversation.event',
        `conversation:101:${ready ? 'ready:fixture' : sequence}`, { type, conversationId: '101',
          ...(ready ? { cursor: String(sequence), nextCursor: String(sequence) } : { requestId: 'request-186', eventSequence: String(sequence), occurredAt: 1000 }) })
      streams.at(-1).enqueue(new TextEncoder().encode(`event: ${m.messageType}\nid: ${m.messageId}\ndata: ${JSON.stringify(m)}\n\n`))
    }
    try {
      await flush(); expect(streams).to.have.length(1); expect(catalogueReads).to.equal(0)
      expect(acceptance.catalog.error.value).to.equal('')
      emit('delivery_submission_completed', 9201); await flush(); expect(catalogueReads).to.equal(0)
      emit('stream_ready', 9201); await flush(); expect(catalogueReads).to.equal(0)
      currentView = view('COMPLETED'); emit('delivery_submission_completed', 9202); await flush()
      expect(catalogueReads).to.equal(0); expect(acceptance.catalog.entries.value).to.deep.equal([])
      expect(hall).not.to.have.property('acceptanceEventSource')
      await disconnect(); expect(hall).not.to.have.property('acceptanceEventSource')
      expect(acceptance.error.value).to.equal(''); expect(streams).to.have.length(1)
      await reconnect(); expect(streams).to.have.length(2)
      emit('stream_ready', 9202); await flush(); expect(catalogueReads).to.equal(0); expect(acceptance.error.value).to.equal('')
    } finally { acceptance.dispose() }
    expect(hall).not.to.have.property('acceptanceEventSource')
  })
  for (const active of [true, false]) it(`retains replay changes across disconnect with active request=${active}`, async () => {
    if (!active) hall.activeRequest.value = null
    const emit = (type, sequence) => {
      const ready = type === 'stream_ready'
      const m = eventMessage(streamHeaders.at(-1).get('X-Request-Id'), ready ? 'conversation.stream.ready' : 'conversation.event',
        `conversation:101:${ready ? 'ready:fixture' : sequence}`, { type, conversationId: '101',
          ...(ready ? { cursor: String(sequence), nextCursor: String(sequence) } : { requestId: 'historical-review', eventSequence: String(sequence), occurredAt: 1000 }) })
      streams.at(-1).enqueue(new TextEncoder().encode(`event: ${m.messageType}\nid: ${m.messageId}\ndata: ${JSON.stringify(m)}\n\n`))
    }
    const before = catalogHints.length
    emit('delivery_review_changed', 9201); await flush()
    expect(catalogHints).to.have.length(before)
    await disconnect(); await reconnect()
    expect(streamHeaders.at(-1).get('Last-Event-ID')).to.equal('conversation:101:9201')
    expect(catalogHints).to.have.length(before + (active ? 1 : 0))
    // The server does not replay the acknowledged event again.
    emit('stream_ready', 9201); await flush()
    expect(catalogHints.slice(before).map(hint => hint.type)).to.deep.equal(['resync_required'])
    emit('delivery_review_changed', 9202); await flush()
    expect(catalogHints.at(-1).requestId).to.equal('historical-review')
    expect(catalogHints).to.have.length(before + 2)
  })
  it('reads the exact terminal request and persistent final before the existing reconnect, without a second send or listener', async () => {
    currentView = view('COMPLETED'); await disconnect(); await reconnect()
    expect(reads).to.equal(2)
    expect(hall.activeRequest.value.state).to.equal('COMPLETED')
    expect(hall.isConversationBusy.value).to.equal(false)
    expect(hall.messages.value.map(m => m.content)).to.include('同一原请求的持久最终答复')
    expect(catalogHints.some(h => h.requestId === 'request-186' && h.conversationId === '101')).to.equal(true)
    expect(streams).to.have.length(2)
    expect(timers.size).to.equal(0)
  })
  it('does not reread an already rendered final on another transport failure', async () => {
    currentView = view('COMPLETED'); await disconnect(); await reconnect()
    const count = contentReads
    await disconnect(); await reconnect()
    expect(contentReads).to.equal(count)
    expect(hall.isConversationBusy.value).to.equal(false)
    expect(streams).to.have.length(3)
  })
  it('keeps a visible recovery hint when terminal status is known but final content could not load', async () => {
    currentView = view('COMPLETED'); contentOverride = async () => { throw new Error('history unavailable') }
    await disconnect(); await reconnect()
    expect(hall.activeRequest.value.state).to.equal('COMPLETED')
    expect(hall.isConversationBusy.value).to.equal(false)
    expect(hall.deliberationStatus.value).to.equal('回话已结束，正文加载待重试')
    expect(hall.messages.value).to.have.length(0)
    expect(streams).to.have.length(2)
  })
  it('does not turn a transient read failure into an execution failure or stop reconnecting', async () => {
    readOverride = async () => { throw new Error('read temporarily unavailable') }
    await disconnect(); await reconnect()
    expect(hall.activeRequest.value.state).to.equal('RUNNING')
    expect(hall.isConversationBusy.value).to.equal(true)
    expect(streams).to.have.length(2)
  })
  for (const field of ['conversationId', 'conversationGeneration', 'requestRevision']) it(`rejects a foreign ${field} in recovery readback`, async () => {
    currentView = { ...view('COMPLETED'), [field]: '999' }
    await disconnect(); await reconnect()
    expect(hall.activeRequest.value.state).to.equal('RUNNING')
    expect(contentReads).to.equal(2)
    expect(catalogHints).to.have.length(0)
  })
  it('rejects another generation in a turn even when the request header matches', async () => {
    currentView = view('COMPLETED'); currentView.turns[0].conversationGeneration = '999'
    await disconnect(); await reconnect()
    expect(hall.activeRequest.value.state).to.equal('RUNNING')
    expect(contentReads).to.equal(2)
  })
  it('retains pending execution when authority still reports RUNNING', async () => {
    await disconnect(); await reconnect()
    expect(hall.activeRequest.value.state).to.equal('RUNNING')
    expect(hall.isConversationBusy.value).to.equal(true)
    expect(hall.messages.value).to.have.length(0)
    expect(streams).to.have.length(2)
  })
  it('does not regress a newer terminal round on delayed authoritative readback', async () => {
    let resolve; readOverride = () => new Promise(done => { resolve = done })
    await disconnect(); const [id, callback] = [...timers][0]; timers.delete(id); const recovery = callback(); await flush()
    hall.activeRequest.value = { ...view('COMPLETED'), stateVersion: '4' }
    hall.activeTurns.value = view('COMPLETED').turns
    resolve(view()); await recovery; await flush()
    expect(hall.activeRequest.value.stateVersion).to.equal('4')
    expect(hall.activeRequest.value.state).to.equal('COMPLETED')
    expect(contentReads).to.equal(2)
  })
  it('discards readback after the original task changes while GET is in flight', async () => {
    let resolve; readOverride = () => new Promise(done => { resolve = done })
    await disconnect(); const [id, callback] = [...timers][0]; timers.delete(id); const recovery = callback(); await flush()
    expect(resolve).to.be.a('function')
    chatContext.value = { ...chatContext.value, taskId: '999', conversationScopeKey: 'task:999' }; await flush()
    resolve(view('COMPLETED')); await recovery; await flush()
    expect(hall.activeRequest.value).to.equal(null)
    expect(hall.messages.value).to.have.length(0)
    expect(streams).to.have.length(1)
  })
  it('discards late final content after authorization switches', async () => {
    currentView = view('COMPLETED'); let finish
    contentOverride = options => new Promise(resolve => { finish = () => { options.onSuccess([{ id: '187', senderType: 'agent', content: 'must not leak' }]); resolve() } })
    await disconnect(); const [id, callback] = [...timers][0]; timers.delete(id); const recovery = callback(); await flush()
    expect(finish).to.be.a('function'); apiStore.authorizationGeneration++
    finish(); await recovery; await flush()
    expect(hall.messages.value.some(m => m.content === 'must not leak')).to.equal(false)
    expect(catalogHints).to.have.length(0)
    expect(streams).to.have.length(1)
  })
  it('retries failed projection reads on the existing timer while keeping the healthy SSE', async () => {
    catalogResult = false
    hall.refreshExecutionRequest({ conversationId: '101', requestId: 'request-186' })
    await flush(); expect(timers.size).to.equal(1)
    catalogResult = true
    const before = reads
    await reconnect()
    expect(streams).to.have.length(1)
    expect(reads).to.equal(before)
    expect(timers.size).to.equal(0)
    expect(catalogHints).to.have.length(2)
  })
  it('retains failed reads across repeated retry without a second timer or send', async () => {
    catalogResult = false
    hall.refreshExecutionRequest({ conversationId: '101', requestId: 'request-186' })
    await flush(); await reconnect()
    expect(timers.size).to.equal(1); expect(streams).to.have.length(1)
    catalogResult = true; await reconnect(); expect(timers.size).to.equal(0)
  })
  it('drops projection recovery on actual identity change', async () => {
    catalogResult = false
    hall.refreshExecutionRequest({ conversationId: '101', requestId: 'request-186' }); await flush()
    chatContext.value = { ...chatContext.value, taskId: '475', conversationScopeKey: 'task:475' }
    await flush(); expect(timers.size).to.equal(0)
  })

})
