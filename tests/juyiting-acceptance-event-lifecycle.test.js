import { expect } from 'chai'
import { ref } from 'vue'
import { useHallBountyAcceptance } from '../src/composables/juyiting/useHallBountyAcceptance.js'
import { eventMessage } from '../src/utils/messageEnvelope.js'

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)) }
const deferred = () => { let resolve; return { promise: new Promise(done => { resolve = done }), resolve: value => resolve(value) } }
const frame = (id, type, seq) => {
  const ready = type === 'stream_ready'
  const m = eventMessage('request-test', ready ? 'conversation.stream.ready' : 'conversation.event',
    `conversation:${id}:${ready ? 'ready:fixture' : seq}`,
    { type, conversationId: id, ...(ready ? { cursor: String(seq), nextCursor: String(seq) } : { eventSequence: String(seq), occurredAt: 1000 }) })
  return `event: ${m.messageType}\nid: ${m.messageId}\ndata: ${JSON.stringify(m)}\n\n`
}
function harness ({ shared = '', completed = false, getOverride, connectOverride } = {}) {
  const identity = ref('owner'); const task = ref('task-1'); const conversation = ref('101'); const sharedId = ref(shared); const sharedEvent = ref(null)
  const taskCompleted = ref(completed)
  const enabled = ref(true); const doc = new EventTarget(); doc.visibilityState = 'visible'
  const connections = []; let reads = 0; let version = 1
  const page = () => ({ schemaVersion: 1, scope: { conversationId: conversation.value, conversationGeneration: '1', taskId: task.value },
    after: '0', through: '1', nextAfter: null, hasMore: false, entries: [{ ordinal: '1', request: {
      requestId: 'request-1', requestRevision: '1', conversationId: conversation.value, conversationGeneration: '1', userMessageId: '1',
      state: version === 1 ? 'RUNNING' : 'COMPLETED', stateVersion: String(version), turns: [], steps: [] } }] })
  const eventSource = { sharedConversationId: () => sharedId.value, sharedEvent: () => sharedEvent.value,
    connect: async options => {
      let controller; let cancelled = 0
      const body = new ReadableStream({ start: c => { controller = c }, cancel: () => { cancelled++ } })
      const response = { ok: true, status: 200, headers: new Headers({ 'X-Request-Id': 'request-test' }), body }
      const connection = { ...options, response, cancelled: () => cancelled,
        push: (type, seq = 1) => controller.enqueue(new TextEncoder().encode(frame(options.conversationId, type, seq))),
        disconnect: () => controller.error(new TypeError('network disconnected')) }
      connections.push(connection)
      return connectOverride ? connectOverride(connection) : response
    } }
  const source = useHallBountyAcceptance({ taskId: () => task.value, identityKey: () => identity.value, conversationId: () => conversation.value,
    documentRef: doc, taskCompleted: () => taskCompleted.value, enabled: () => enabled.value, eventSource: () => eventSource,
    api: { list: async () => ({ items: [{ id: conversation.value, conversationType: 'juyiting', conversationScopeType: 'bounty', conversationScopeKey: `task:${task.value}` }] }),
      get: async () => { reads++; const snapshot = page(); return getOverride ? getOverride(snapshot, reads) : snapshot } } })
  return { source, identity, task, taskCompleted, conversation, sharedId, sharedEvent, enabled, doc, connections, reads: () => reads,
    finish: () => { version++ }, notify: type => { sharedEvent.value = { type, conversationId: conversation.value } } }
}

describe('acceptance event ownership and recovery', () => {
  let timers; let originalTimeout; let originalClear; let nextId; let h
  beforeEach(() => {
    timers = new Map(); nextId = 90000; originalTimeout = globalThis.setTimeout; originalClear = globalThis.clearTimeout
    globalThis.setTimeout = (fn, ms, ...args) => ms >= 1000 ? (timers.set(++nextId, fn), nextId) : originalTimeout(fn, ms, ...args)
    globalThis.clearTimeout = id => { if (!timers.delete(id)) originalClear(id) }
  })
  afterEach(() => { h?.source.dispose(); h = null; globalThis.setTimeout = originalTimeout; globalThis.clearTimeout = originalClear })
  it('direct entry subscribes once, batches replay and never scans an idle running request', async () => {
    h = harness(); await settle(); expect(h.connections).to.have.length(1); expect(h.reads()).to.equal(1)
    const stream = h.connections[0]
    for (let i = 1; i <= 100; i++) stream.push('agent_message', i)
    await settle(); expect(h.reads()).to.equal(1)
    stream.push('stream_ready', 100); await settle(); expect(h.reads()).to.equal(2)
    h.finish(); stream.push('execution_terminal', 101); await settle()
    expect(h.reads()).to.equal(3); expect(h.source.catalog.entries.value[0].request.state).to.equal('COMPLETED')
    expect(timers.size).to.equal(0)
  })
  it('completed task history needs neither a connection nor a timer, while manual reads remain available', async () => {
    h = harness({ completed: true }); await settle()
    expect(h.reads()).to.equal(1); expect(h.connections).to.have.length(0); expect(timers.size).to.equal(0)
    await h.source.refreshCatalog(); expect(h.reads()).to.equal(2)
  })
  it('domain completion closes its independent stream and ignores later shared hints', async () => {
    h = harness(); await settle(); const stream = h.connections[0]
    stream.push('stream_ready', 3); await settle(); h.finish(); h.taskCompleted.value = true; await settle()
    expect(stream.signal.aborted).to.equal(true); expect(h.source.catalog.entries.value[0].request.state).to.equal('COMPLETED')
    const reads = h.reads(); h.sharedId.value = '101'; h.notify('agent_message'); await settle()
    expect(h.reads()).to.equal(reads); expect(h.connections).to.have.length(1); expect(timers.size).to.equal(0)
  })
  it('same-conversation chat notifications use no second connection and ignore other conversations', async () => {
    h = harness({ shared: '101' }); await settle(); expect(h.connections).to.have.length(0)
    h.notify('agent_message_delta'); await settle(); expect(h.reads()).to.equal(1)
    h.sharedEvent.value = { type: 'agent_message', conversationId: '202' }; await settle(); expect(h.reads()).to.equal(1)
    h.finish(); h.notify('agent_message'); await settle(); expect(h.reads()).to.equal(2)
    expect(h.source.catalog.entries.value[0].request.state).to.equal('COMPLETED')
    h.notify('stream_disconnected'); await settle(); expect(h.source.error.value).not.to.equal('')
    h.notify('stream_ready'); await settle(); expect(h.source.error.value).to.equal(''); expect(h.connections).to.have.length(0)
  })
  it('hands off to chat before it opens the same connection and resumes independently when chat leaves', async () => {
    h = harness(); await settle(); const stream = h.connections[0]
    stream.push('stream_ready', 3); await settle()
    h.sharedId.value = '101'; await settle(); expect(stream.signal.aborted).to.equal(true); expect(stream.cancelled()).to.equal(1)
    expect(h.connections).to.have.length(1)
    h.sharedId.value = '202'; await settle(); expect(h.connections).to.have.length(2); expect(h.connections[1].cursor).to.equal('3')
    h.connections[1].push('stream_ready', 4); await settle(); expect(timers.size).to.equal(0)
  })
  it('does a trailing authoritative read when an event arrives during the initial snapshot', async () => {
    const pending = deferred()
    h = harness({ getOverride: (snapshot, count) => count === 1 ? pending.promise.then(() => snapshot) : snapshot })
    await settle(); h.finish(); h.connections[0].push('stream_ready', 1); h.connections[0].push('agent_message', 2); await settle()
    expect(h.reads()).to.equal(1); pending.resolve(); await settle(); expect(h.reads()).to.equal(2)
    expect(h.source.catalog.entries.value[0].request.state).to.equal('COMPLETED')
  })
  it('reconnects transport with its cursor and refreshes missed results at ready, not on a scan timer', async () => {
    h = harness(); await settle(); h.connections[0].push('stream_ready', 10); await settle()
    const reads = h.reads(); h.connections[0].disconnect(); await settle(); expect(timers.size).to.equal(1); expect(h.reads()).to.equal(reads)
    h.finish(); const [id, retry] = [...timers][0]; timers.delete(id); retry(); await settle()
    expect(h.connections[1].cursor).to.equal('10'); expect(h.reads()).to.equal(reads)
    h.connections[1].push('stream_ready', 11); await settle()
    expect(h.source.catalog.entries.value[0].request.state).to.equal('COMPLETED'); expect(timers.size).to.equal(0)
  })
  it('hidden and disposed instances close transport and never retain a reconnect timer', async () => {
    h = harness(); await settle(); h.connections[0].disconnect(); await settle(); expect(timers.size).to.equal(1)
    h.doc.visibilityState = 'hidden'; h.doc.dispatchEvent(new Event('visibilitychange')); await settle(); expect(timers.size).to.equal(0)
    const reads = h.reads(); await h.source.refreshCatalog(); expect(h.reads()).to.equal(reads)
    h.doc.visibilityState = 'visible'; h.doc.dispatchEvent(new Event('visibilitychange')); await settle(); expect(h.connections).to.have.length(2)
    h.source.dispose(); await settle(); expect(h.connections[1].signal.aborted).to.equal(true); expect(timers.size).to.equal(0)
  })
  it('cancels a late response when identity and conversation change without mutating the replacement scope', async () => {
    const late = deferred(); let first
    h = harness({ connectOverride: connection => { if (!first) { first = connection; return late.promise }; return connection.response } })
    await settle(); h.identity.value = 'new-owner'; h.conversation.value = '202'; await settle()
    expect(first.signal.aborted).to.equal(true); late.resolve(first.response); await settle()
    expect(first.cancelled()).to.equal(1); expect(h.source.scope.value.conversationId).to.equal('202')
    expect(h.source.catalog.entries.value[0].request.conversationId).to.equal('202'); expect(timers.size).to.equal(0)
  })
  it('does not retry forbidden streams or turn them into successful empty results', async () => {
    h = harness({ connectOverride: () => ({ ok: false, status: 403 }) }); await settle()
    expect(h.connections).to.have.length(1); expect(timers.size).to.equal(0)
    expect(h.source.catalog.entries.value).to.have.length(1); expect(h.source.error.value).not.to.equal('')
  })
})
