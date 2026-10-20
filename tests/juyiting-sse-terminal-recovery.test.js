import { expect } from 'chai'
import { ref } from 'vue'
import { setImmediate } from 'node:timers'
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
  let originalFetch; let originalTimer; let originalClear; let hall; let streams; let timers; let reads; let contentReads; let catalogHints; let currentView; let readOverride; let contentOverride; let chatContext; let apiStore
  beforeEach(async () => {
    originalFetch = global.fetch; originalTimer = window.setTimeout; originalClear = window.clearTimeout
    streams = []; timers = new Map(); reads = 0; contentReads = 0; catalogHints = []; currentView = view(); readOverride = null; contentOverride = null
    let timerId = 0
    window.setTimeout = callback => { const id = ++timerId; timers.set(id, callback); return id }
    window.clearTimeout = id => timers.delete(id)
    global.fetch = async (_url, options) => {
      let stream; const body = new ReadableStream({ start(controller) { stream = controller } })
      streams.push(stream)
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream', 'X-Request-Id': new Headers(options.headers).get('X-Request-Id') } })
    }
    chatContext = ref({ taskId: '474', conversationScopeType: 'bounty', conversationScopeKey: 'task:474', mode: 'bounty', participantAgentIds: ['wuyong'], targetAgentIds: ['wuyong'] })
    apiStore = { authorizationGeneration: 1, token: async () => 'fixture-token' }
    hall = useHallConversation({ apiStore, chatContext, chatMode: ref('bounty'), selectedTask: ref({ id: '474' }), selectedAgent: ref(null), outgoingMetadata: ref({}),
      globalStore: { getJiacn: 'owner', user: {} }, log: { warn() {}, error() {} }, openPanel() {}, portraitShortName: () => '', showToast() {},
      onRequestCatalogHint: event => catalogHints.push(event),
      chatApi: {
        list: async () => ({ items: [{ id: '101', conversationType: 'juyiting', conversationScopeType: 'bounty', conversationScopeKey: 'task:474' }] }),
        get: async path => {
          if (path === '/conversations/101/requests') return { schemaVersion: 1, scope: { taskId: '474', conversationId: '101', conversationGeneration: '1' }, after: '0', through: '0', nextAfter: null, hasMore: false, entries: [] }
          expect(path).to.equal('/requests/request-186'); reads++
          return readOverride ? readOverride() : structuredClone(currentView)
        },
        getById: async (_path, id, options) => {
          expect(id).to.equal('101'); contentReads++
          if (contentOverride) return contentOverride(options)
          options.onSuccess(currentView.state === 'COMPLETED' ? [{ id: '187', messageType: 'AGENT', senderType: 'agent', senderName: '吴用', content: '同一原请求的持久最终答复' }] : [])
        }
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
})
