import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'
import { useHallConversation } from '../src/composables/juyiting/useHallConversation.js'
import { appendHallEventMessage } from '../src/composables/juyiting/hallConversationMessages.js'
import { createHallSseParser } from '../src/composables/juyiting/hallConversationSse.js'
import { cancellationTarget, deliberationBusy, isTerminalTurnState, reduceDeliberationEvent } from '../src/composables/juyiting/hallDeliberationState.js'
import { stopIdentityBoundWork } from '../src/utils/identityLifecycle.js'

const capabilityV2 = { schemaVersion: '2', requestId: true, requestRevision: true, contextSnapshot: true, durableTurns: true, deltaSequence: true, cancel: true, interactionHints: ['chat', 'inspect'] }
const deferred = () => { let resolve; let reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail }); return { promise, resolve, reject } }
const base = ({ chatApi, apiStore = { authorizationGeneration: 1, token: async () => '' }, metadata, context, onDelivery } = {}) => useHallConversation({
  apiStore, chatApi: chatApi || {},
  chatContext: context || ref({ conversationScopeType: 'public', conversationScopeKey: 'public', mode: 'public', participantAgentIds: ['a'], targetAgentIds: ['a'], targetAgentId: 'a' }),
  chatMode: ref('public'), globalStore: { user: { username: 'tester' } }, log: { warn () {}, error () {} },
  openPanel () {}, outgoingMetadata: ref(metadata || { inputRefs: [{ type: 'message', id: '9007199254740993', content: 'must never upload' }] }),
  portraitShortName: agent => agent?.name || '', selectedAgent: ref({ agentId: 'a' }), selectedTask: ref(null), showToast () {}, onDelivery
})

describe('Juyi Hall Codex durable deliberation web contract', () => {
  it('negotiates v2 before sending and keeps body requestId equal to Idempotency-Key', async () => {
    const sent = []
    const conversation = base({ chatApi: {
      get: async path => path === '/capabilities' ? { data: { data: capabilityV2 } } : { data: { data: {} } },
      create: async (_path, body, options) => { sent.push({ body, options }); options.onStream('{"conversationId":"9007199254740993"}'); options.onStreamEnd() }
    } })
    conversation.setDraft('inspect only')
    await conversation.sendHallMessage()
    expect(sent[0].body.requestId).to.equal(sent[0].options.headers['Idempotency-Key'])
    expect(sent[0].body.requestRevision).to.equal('1')
    expect(sent[0].body.interactionHint).to.equal('inspect')
    expect(sent[0].body.inputRefs).to.deep.equal([{ type: 'message', id: '9007199254740993' }])
    conversation.disposeHallConversation()
  })

  it('takes the send lock and reserves one requestId before delayed capability negotiation', async () => {
    const gate = deferred(); const sent = []
    const conversation = base({ chatApi: {
      get: async () => gate.promise,
      create: async (_path, body, options) => { sent.push({ body, options }); options.onStreamEnd() }
    } })
    conversation.setDraft('send once')
    const first = conversation.sendHallMessage()
    const second = conversation.sendHallMessage()
    expect(await second).to.equal(false)
    expect(conversation.isSubmitting.value).to.equal(true)
    gate.resolve({ data: { data: capabilityV2 } })
    expect(await first).to.equal(true)
    expect(sent).to.have.length(1)
    expect(sent[0].body.requestId).to.equal(sent[0].options.headers['Idempotency-Key'])
    conversation.disposeHallConversation()
  })

  it('fences a capability response after identity reset and never sends with stale identity', async () => {
    const gate = deferred(); let creates = 0
    const apiStore = { authorizationGeneration: 7, token: async () => '' }
    const conversation = base({ apiStore, chatApi: { get: async () => gate.promise, create: async () => { creates++ } } })
    conversation.setDraft('stale identity')
    const sending = conversation.sendHallMessage()
    await Promise.resolve()
    apiStore.authorizationGeneration = 8
    stopIdentityBoundWork()
    gate.resolve({ data: { data: capabilityV2 } })
    expect(await sending).to.equal(false)
    expect(creates).to.equal(0)
    expect(conversation.capabilityState.value.loaded).to.equal(false)
    expect(conversation.activeRequest.value).to.equal(null)
    conversation.disposeHallConversation()
  })

  it('fences a capability response after conversation scope changes', async () => {
    const gate = deferred(); let creates = 0
    const context = ref({ conversationScopeType: 'public', conversationScopeKey: 'public', mode: 'public', targetAgentIds: ['a'] })
    const conversation = base({ context, chatApi: { get: async () => gate.promise, create: async () => { creates++ } } })
    conversation.setDraft('stale scope')
    const sending = conversation.sendHallMessage()
    await Promise.resolve()
    context.value = { conversationScopeType: 'private', conversationScopeKey: 'agent:b', mode: 'private', targetAgentIds: ['b'] }
    gate.resolve({ data: { data: capabilityV2 } })
    expect(await sending).to.equal(false)
    expect(creates).to.equal(0)
    expect(conversation.activeTurns.value).to.deep.equal([])
    conversation.disposeHallConversation()
  })

  it('does not convert AbortError during capability negotiation into legacy fallback', async () => {
    let creates = 0
    const conversation = base({ chatApi: {
      get: async () => { throw new DOMException('identity reset', 'AbortError') },
      create: async () => { creates++ }
    } })
    conversation.setDraft('abort')
    expect(await conversation.sendHallMessage()).to.equal(false)
    expect(creates).to.equal(0)
    expect(conversation.capabilityState.value.loaded).to.equal(false)
    conversation.disposeHallConversation()
  })

  it('falls back to the legacy payload when capabilities are unavailable', async () => {
    const sent = []
    const conversation = base({ chatApi: { get: async () => { throw new Error('404') }, create: async (_p, body, options) => { sent.push({ body, options }); options.onStreamEnd() } } })
    conversation.setDraft('legacy')
    await conversation.sendHallMessage()
    expect(sent[0].body).not.to.have.any.keys('requestId', 'requestRevision', 'interactionHint', 'clientSeenVector', 'inputRefs')
    expect(sent[0].options.headers).to.deep.equal({})
    conversation.disposeHallConversation()
  })

  it('keeps pre-admission status neutral and only renders observed runtime policy', async () => {
    let statusDuringPost = ''; let stateDuringPost; const deliveries = []
    const conversation = base({ onDelivery: delivery => deliveries.push(delivery), chatApi: {
      get: async () => ({ data: { data: capabilityV2 } }),
      create: async (_p, body, options) => {
        statusDuringPost = conversation.deliberationStatus.value
        stateDuringPost = { submitting: conversation.isSubmitting.value, streaming: conversation.isStreaming.value, awaiting: conversation.isAwaitingReply.value, deliveries: deliveries.length }
        options.onStream(JSON.stringify({ agentDelivery: { agentId: 'a', accepted: true, state: 'QUEUED' }, conversationId: '9007199254740993', requestId: body.requestId, turnId: 'turn-x', route: 'CHAT' }))
        options.onStreamEnd()
      }
    } })
    conversation.setDraft('status')
    await conversation.sendHallMessage()
    expect(statusDuringPost).to.equal('正在提交，等待受理')
    expect(statusDuringPost).not.to.match(/Fast|read-only/i)
    expect(stateDuringPost).to.deep.equal({ submitting: true, streaming: false, awaiting: false, deliveries: 0 })
    expect(deliveries).to.have.length(0)
    expect(conversation.deliberationStatus.value).to.equal('CHAT · 排队中')
    conversation.disposeHallConversation()
  })

  it('emits a scene receipt only after delivered or DISPATCHED, never for accepted QUEUED', async () => {
    const deliveries = []; let queuedDeliveryCount = -1
    const conversation = base({ onDelivery: delivery => deliveries.push(delivery), chatApi: {
      get: async () => ({ data: { data: capabilityV2 } }),
      create: async (_path, body, options) => {
        const common = { conversationId: '9007199254740993', requestId: body.requestId, turnId: 'turn-delivery' }
        options.onStream(JSON.stringify({ ...common, state: 'QUEUED', agentDelivery: { agentId: 'a', accepted: true, delivered: false, state: 'QUEUED', turnId: 'turn-delivery' } }))
        queuedDeliveryCount = deliveries.length
        options.onStream(JSON.stringify({ ...common, state: 'DISPATCHED', agentDelivery: { agentId: 'a', accepted: true, delivered: false, state: 'DISPATCHED', turnId: 'turn-delivery' } }))
        options.onStream(JSON.stringify({ ...common, turnId: 'turn-delivered', state: 'QUEUED', agentDelivery: { agentId: 'b', accepted: true, delivered: true, state: 'QUEUED', turnId: 'turn-delivered' } }))
        options.onStreamEnd()
      }
    } })
    conversation.setDraft('delivery truth')
    await conversation.sendHallMessage()
    expect(queuedDeliveryCount).to.equal(0)
    expect(deliveries).to.deep.equal([
      { agentId: 'a', requestId: conversation.activeRequest.value.requestId, turnId: 'turn-delivery' },
      { agentId: 'b', requestId: conversation.activeRequest.value.requestId, turnId: 'turn-delivered' }
    ])
    conversation.disposeHallConversation()
  })

  it('strips every execute/route alias from metadata and sends only controlled top-level hint', async () => {
    const aliases = { interactionHint: 'execute', interaction_type: 'execute', interactionType: 'execute', interactionMode: 'command', action: 'run', route: 'EXECUTE', intent: 'deploy', mode: 'COMMAND', execute: true, executeHint: true, metadataAlias: 'EXECUTE', libraryCitationId: 'ref-1', librarySourceType: 'memory' }
    let sent
    const conversation = base({ metadata: aliases, chatApi: {
      get: async () => ({ data: { data: capabilityV2 } }),
      create: async (_p, body, options) => { sent = body; options.onStreamEnd() }
    } })
    conversation.setDraft('do not execute')
    await conversation.sendHallMessage()
    expect(sent.interactionHint).to.equal('chat')
    expect(sent.metadata).to.deep.include({ scene: 'juyiting', libraryCitationId: 'ref-1', librarySourceType: 'memory' })
    for (const key of Object.keys(aliases).filter(key => !['libraryCitationId', 'librarySourceType'].includes(key))) expect(sent.metadata).not.to.have.property(key)
    conversation.disposeHallConversation()
  })

  it('recovers an unknown v2 POST through request lookup without a second POST', async () => {
    let creates = 0; let requestLookups = 0
    const conversation = base({ chatApi: {
      get: async path => {
        if (path === '/capabilities') return { data: { data: capabilityV2 } }
        if (path.startsWith('/requests/')) { requestLookups++; return { data: { data: { requestId: path.slice(10), conversationId: '9007199254740993', state: 'RUNNING', turns: [{ turnId: '9007199254740995', state: 'QUEUED', stateVersion: '1' }] } } } }
        return { data: { data: {} } }
      },
      getById: async (_p, _id, options) => options?.onSuccess?.({ data: [] }),
      create: async () => { creates++; throw new TypeError('network unknown') }
    } })
    conversation.setDraft('once')
    await conversation.sendHallMessage()
    expect(creates).to.equal(1); expect(requestLookups).to.equal(1)
    expect(conversation.activeTurns.value[0].turnId).to.equal('9007199254740995')
    conversation.disposeHallConversation()
  })

  it('keeps terminal unknown-result recovery non-busy when history reload fails', async () => {
    let requestId; let creates = 0; let contentLoads = 0
    const conversation = base({ chatApi: {
      get: async path => {
        if (path === '/capabilities') return { data: { data: capabilityV2 } }
        return { data: { data: { requestId, requestRevision: '1', conversationId: '9007199254740993', state: 'COMPLETED',
          turns: [{ turnId: 'turn-terminal', requestId, state: 'PUBLISHED', stateVersion: '2', lastDeltaSeq: '1' }] } } }
      },
      getById: async () => { contentLoads += 1; throw new Error('history unavailable') },
      create: async (_path, body) => { creates += 1; requestId = body.requestId; throw new TypeError('transport lost') }
    } })
    conversation.setDraft('terminal recovery')
    expect(await conversation.sendHallMessage()).to.equal(false)
    await Promise.resolve()
    expect(creates).to.equal(1)
    expect(contentLoads).to.equal(1)
    expect(conversation.activeRequest.value.state).to.equal('COMPLETED')
    expect(conversation.isAwaitingReply.value).to.equal(false)
    expect(conversation.isStreaming.value).to.equal(false)
    expect(conversation.isConversationBusy.value).to.equal(false)
    conversation.disposeHallConversation()
  })

  it('fails all-pending cancellation when the returned request view is invalid', async () => {
    let requestId
    const conversation = base({ chatApi: {
      get: async () => ({ data: { data: capabilityV2 } }),
      create: async (_path, body, options) => {
        requestId = body.requestId
        for (const turnId of ['turn-a', 'turn-b']) options.onStream(JSON.stringify({ requestId, turnId, state: 'QUEUED', agentDelivery: { agentId: turnId, accepted: true, state: 'QUEUED', turnId }, conversationId: '9007199254740993' }))
        options.onStreamEnd()
      },
      post: async () => ({ data: { data: { requestId: 'different-request', state: 'CANCELLED', turns: [] } } })
    } })
    conversation.setDraft('cancel group')
    await conversation.sendHallMessage()
    expect(conversation.durableCancelTarget.value).to.deep.equal({ allPending: true })
    expect(await conversation.cancelDeliberation({ allPending: true })).to.equal(false)
    conversation.disposeHallConversation()
  })

  it('rejects null, incomplete, and mismatched single-turn cancel views without changing state', async () => {
    let requestId; const responses = [null, {},
      { requestId: 'wrong-request', turnId: 'turn-a' },
      { requestId: '', turnId: 'wrong-turn' },
      { requestId: '', turnId: 'turn-a', state: 'CANCELLED', stateVersion: '1' }]
    const conversation = base({ chatApi: {
      get: async () => ({ data: { data: capabilityV2 } }),
      create: async (_path, body, options) => {
        requestId = body.requestId
        responses[3].requestId = requestId
        responses[4].requestId = requestId
        options.onStream(JSON.stringify({ type: 'chat_request_replay', requestId, turnId: 'turn-a', conversationId: '9007199254740993',
          state: 'QUEUED', stateVersion: '0' }))
        options.onStreamEnd()
      },
      post: async () => ({ data: { data: responses.shift() } })
    } })
    conversation.setDraft('strict cancel')
    await conversation.sendHallMessage()
    await Promise.resolve()
    const originalRequest = JSON.parse(JSON.stringify(conversation.activeRequest.value))
    const originalTurns = JSON.parse(JSON.stringify(conversation.activeTurns.value))
    for (let index = 0; index < 5; index += 1) {
      expect(await conversation.cancelDeliberation({ turnId: 'turn-a' })).to.equal(false)
      expect(JSON.parse(JSON.stringify(conversation.activeRequest.value))).to.deep.equal(originalRequest)
      expect(JSON.parse(JSON.stringify(conversation.activeTurns.value))).to.deep.equal(originalTurns)
    }
    conversation.disposeHallConversation()
  })

  it('cancels an exact durable turn with a canonical state version and is terminal-idempotent', async () => {
    const posts = []
    let requestId
    const conversation = base({ chatApi: {
      get: async path => {
        if (path === '/capabilities') return { data: { data: capabilityV2 } }
        return { data: { data: { requestId, requestRevision: '1', conversationId: '9007199254740993',
          state: 'RUNNING', stateVersion: '0', turns: [{ turnId: 'turn-a', requestId, requestRevision: '1',
            conversationId: '9007199254740993', state: 'QUEUED', stateVersion: '0', lastDeltaSeq: '0' }] } } }
      },
      create: async (_path, body, options) => {
        requestId = body.requestId
        options.onStream(JSON.stringify({ agentDelivery: { agentId: 'a', accepted: true, state: 'QUEUED' },
          conversationId: '9007199254740993', requestId, turnId: 'turn-a' }))
        await Promise.resolve()
        options.onStreamEnd()
      },
      post: async (path, body) => {
        posts.push({ path, body })
        return { data: { data: { turnId: 'turn-a', requestId, requestRevision: '1', conversationId: '9007199254740993',
          conversationGeneration: '1', targetAgentId: 'a', contextSnapshotId: 'snapshot-a', dispatchId: 'dispatch-a', route: 'CHAT',
          state: 'CANCELLED', stateVersion: '1', lastDeltaSeq: '0', terminalReason: 'user_cancelled', finalMessageId: null,
          createdAt: '100', updatedAt: '101' } } }
      }
    } })
    conversation.setDraft('cancel me')
    await conversation.sendHallMessage()
    await Promise.resolve()
    expect(conversation.durableCancelTarget.value).to.deep.equal({ turnId: 'turn-a' })
    expect(await conversation.cancelDeliberation({ turnId: 'turn-a' })).to.equal(true)
    expect(posts).to.deep.equal([{ path: '/turns/turn-a/cancel', body: { expectedStateVersion: '0' } }])
    expect(conversation.deliberationStatus.value).to.equal('CHAT · 已取消')
    expect(await conversation.cancelDeliberation({ turnId: 'turn-a' })).to.equal(true)
    expect(posts).to.have.length(1)
    conversation.disposeHallConversation()
  })

  it('derives group busy from every child and treats FINAL_PERSISTED/PUBLISHED as terminal', () => {
    let state = { request: { requestId: 'req' }, turns: [] }
    state = reduceDeliberationEvent(state, { requestId: 'req', turnId: 't1', state: 'QUEUED' })
    state = reduceDeliberationEvent(state, { requestId: 'req', turnId: 't2', state: 'QUEUED' })
    state = reduceDeliberationEvent(state, { requestId: 'req', turnId: 't1', type: 'agent_message', state: 'FINAL_PERSISTED' })
    expect(deliberationBusy(state.request, state.turns)).to.equal(true)
    state = reduceDeliberationEvent(state, { requestId: 'req', turnId: 't2', state: 'PUBLISHED' })
    expect(deliberationBusy(state.request, state.turns)).to.equal(false)
    expect(isTerminalTurnState('FINAL_PERSISTED')).to.equal(true)
    expect(isTerminalTurnState('PUBLISHED')).to.equal(true)
  })

  it('allows only higher live stateVersion to advance authoritative turn fields', () => {
    let state = reduceDeliberationEvent({ request: { requestId: 'req' }, turns: [] }, {
      requestId: 'req', turnId: 'turn', state: 'GENERATING', stateVersion: '10', route: 'CHAT', engine: 'fast-engine'
    })
    const versioned = structuredClone(state)
    for (const event of [
      { requestId: 'req', turnId: 'turn', state: 'QUEUED', stateVersion: '9', route: 'EXECUTE' },
      { requestId: 'req', turnId: 'turn', state: 'FAILED', stateVersion: '10', route: 'EXECUTE' },
      { requestId: 'req', turnId: 'turn', state: 'QUEUED', route: 'EXECUTE', engine: 'other' },
      { requestId: 'req', turnId: 'turn', state: 'GENERATING', stateVersion: '10', route: 'CHAT', engine: 'fast-engine' }
    ]) {
      state = reduceDeliberationEvent(state, event)
      expect(state).to.deep.equal(versioned)
    }
    state = reduceDeliberationEvent(state, { requestId: 'req', turnId: 'turn', state: 'FINAL_PERSISTED', stateVersion: '11', route: 'CHAT' })
    expect(state.turns[0]).to.include({ state: 'FINAL_PERSISTED', stateVersion: '11', route: 'CHAT' })
  })

  it('merges replay final into an existing persisted message and removes its placeholder', () => {
    const state = { conversationId: '9007199254740993', messages: [{ localId: 'message-final', sender: 'AGENT', content: 'persisted', streaming: false }], isAwaitingReply: true, isStreaming: true, turnStates: new Map(), manageTurnBusy: true }
    appendHallEventMessage(state, { type: 'agent_message_delta', conversationId: state.conversationId, turnId: 'turn-a', deltaSeq: '1', agentId: 'a', content: 'partial' })
    const result = appendHallEventMessage(state, { type: 'agent_message', conversationId: state.conversationId, turnId: 'turn-a', messageId: 'message-final', senderType: 'agent', agentId: 'a', content: 'authoritative' })
    expect(result.type).to.equal('final')
    expect(state.messages.filter(message => message.localId === 'message-final')).to.have.length(1)
    expect(state.messages).to.have.length(1)
    expect(state.messages[0].content).to.equal('authoritative')
  })

  it('rejects late delta after final and keeps same-agent turns separate', () => {
    const state = { conversationId: '9007199254740993', messages: [], isAwaitingReply: true, isStreaming: true, manageTurnBusy: true }
    const delta = (turnId, deltaSeq, content) => appendHallEventMessage(state, { type: 'agent_message_delta', conversationId: state.conversationId, turnId, deltaSeq, agentId: 'a', content })
    delta('9007199254740995', '1', 'A'); delta('9007199254740997', '1', 'B')
    appendHallEventMessage(state, { type: 'agent_message', conversationId: state.conversationId, turnId: '9007199254740995', messageId: '9007199254740999', senderType: 'agent', agentId: 'a', content: 'A final' })
    expect(delta('9007199254740995', '2', 'late').type).to.equal('late_delta')
    expect(state.messages.find(message => message.turnId === '9007199254740997').content).to.equal('B')
  })

  it('uses explicit allPending or exact turn cancellation targets in UI wiring', () => {
    expect(cancellationTarget({ requestId: 'req' }, [{ turnId: 't1', state: 'QUEUED', stateVersion: '0' }])).to.deep.equal({ turnId: 't1' })
    expect(cancellationTarget({ requestId: 'req' }, [{ turnId: 't1', state: 'QUEUED' }, { turnId: 't2', state: 'STREAMING' }])).to.deep.equal({ allPending: true })
    expect(cancellationTarget({ requestId: 'req' }, [{ turnId: 't1', state: 'QUEUED' }])).to.equal(null)
    const panel = readFileSync(new URL('../src/components/juyiting/ChatPanel.vue', import.meta.url), 'utf8')
    const hall = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
    expect(panel).to.include("$emit('cancel-deliberation', durableCancelTarget)")
    expect(hall).to.include('@cancel-deliberation="cancelDeliberation"')
    expect(hall).not.to.include('@cancel-deliberation="cancelDeliberation()"')
    const sendHandler = hall.slice(hall.indexOf('const handleSendHallMessage'), hall.indexOf('const handleMentionAgent'))
    const mentionHandler = hall.slice(hall.indexOf('const handleMentionAgent'), hall.indexOf('const handleClearChatTarget'))
    expect(sendHandler).not.to.include('收到传令')
    expect(mentionHandler).not.to.include('markAgentSpeaking')
    expect(mentionHandler).not.to.include('收到传令')
    expect(hall).to.include("onDelivery: ({ agentId }) =>")
  })
})

describe('Juyi Hall durable SSE recovery', () => {
  it('reconnects after a valid resync_required from the committed cursor without a replay storm', async () => {
    const originalFetch = global.fetch
    const requests = []; let contentLoads = 0; let conversation
    const fixture = new TextEncoder().encode('id: 8\ndata: {"type":"resync_required","eventSequence":"8","turnId":"turn-a"}\n\n')
    global.fetch = async (_url, options) => {
      requests.push(options)
      return new Response(new ReadableStream({ start (controller) { controller.enqueue(fixture) } }), { status: 200 })
    }
    try {
      conversation = base({
        apiStore: { authorizationGeneration: 1, token: async () => 'token' },
        chatApi: {
          list: async (_path, _payload, options) => options.onSuccess({ data: [{ id: '9007199254740993', conversationType: 'juyiting', conversationScopeType: 'public', conversationScopeKey: 'public' }] }),
          getById: async (_path, _id, options) => { contentLoads += 1; options.onSuccess({ data: [] }) }
        }
      })
      await conversation.loadHallMessages()
      for (let index = 0; index < 12; index += 1) await new Promise(resolve => setImmediate(resolve))
      expect(requests).to.have.length(2)
      expect(requests[1].headers['Last-Event-ID']).to.equal('8')
      expect(contentLoads).to.equal(2)
      for (let index = 0; index < 4; index += 1) await new Promise(resolve => setImmediate(resolve))
      expect(requests).to.have.length(2)
      expect(contentLoads).to.equal(2)
    } finally {
      conversation?.disposeHallConversation()
      global.fetch = originalFetch
    }
  })
})

describe('Juyi Hall durable SSE parser', () => {
  const parse = chunks => {
    const events = []; const cursors = []; const invalid = []
    const parser = createHallSseParser({ conversationId: '9007199254740993', onEvent: event => { events.push(event); return true }, onCursor: cursor => cursors.push(cursor), onInvalid: reason => invalid.push(reason) })
    chunks.forEach(chunk => parser.push(chunk)); parser.finish()
    return { events, cursors, invalid }
  }

  it('injects stream conversationId into API durable payloads that omit it', () => {
    const result = parse(['id: 1\ndata: {"type":"agent_message_delta","eventSequence":"1","turnId":"t","deltaSeq":"1","content":"x"}\n\n'])
    expect(result.events[0].conversationId).to.equal('9007199254740993')
    expect(result.cursors).to.deep.equal(['1'])
  })

  it('handles CRLF split across chunks and multiline data', () => {
    const result = parse(['id: 2\r', '\ndata: {"type":"stream_ready",\r\ndata: "cursor":"2"}\r', '\n\r\n'])
    expect(result.events).to.have.length(1)
    expect(result.events[0]).to.deep.include({ type: 'stream_ready', cursor: '2' })
    expect(result.cursors).to.deep.equal(['2'])
  })

  it('does not advance cursor for invalid JSON', () => {
    const result = parse(['id: 3\ndata: {invalid}\n\n'])
    expect(result.events).to.deep.equal([])
    expect(result.cursors).to.deep.equal([])
    expect(result.invalid).to.deep.equal(['invalid_json'])
  })

  it('rejects an explicit conversation conflict without advancing cursor', () => {
    const result = parse(['id: 4\ndata: {"type":"agent_message_delta","conversationId":"9007199254740994","eventSequence":"4","turnId":"t","deltaSeq":"1","content":"x"}\n\n'])
    expect(result.events).to.deep.equal([])
    expect(result.cursors).to.deep.equal([])
    expect(result.invalid).to.deep.equal(['conversation_conflict'])
  })

  it('rejects a cursor that conflicts with the SSE id', () => {
    const result = parse(['id: 4\ndata: {"type":"stream_ready","cursor":"5"}\n\n'])
    expect(result.cursors).to.deep.equal([])
    expect(result.invalid).to.deep.equal(['cursor_conflict'])
  })


  it('commits a valid resync_required cursor before scheduling one authoritative replay', () => {
    let cursor = '7'; const resyncs = []; const headers = []
    const connect = fixture => {
      headers.push(cursor ? { 'Last-Event-ID': cursor } : {})
      let pending = ''
      const parser = createHallSseParser({
        conversationId: '9007199254740993',
        onEvent: (event, candidate) => {
          if (event.type === 'resync_required') pending = candidate && BigInt(candidate) > BigInt(cursor) ? candidate : ''
          return true
        },
        onCursor: next => { cursor = next },
        onCommitted: (event, committed) => { if (event.type === 'resync_required' && pending === committed) resyncs.push(committed) }
      })
      parser.push(fixture); parser.finish()
    }
    const fixture = 'id: 8\ndata: {"type":"resync_required","eventSequence":"8","turnId":"turn-a"}\n\n'
    connect(fixture)
    connect(fixture)
    expect(resyncs).to.deep.equal(['8'])
    expect(headers).to.deep.equal([{ 'Last-Event-ID': '7' }, { 'Last-Event-ID': '8' }])
  })

  it('rejects non-canonical cursor and Long event fields without advancing cursor', () => {
    const numeric = parse(['id: 6\ndata: {"type":"agent_message_delta","eventSequence":6,"turnId":"t","deltaSeq":"1","content":"x"}\n\n'])
    expect(numeric.cursors).to.deep.equal([])
    expect(numeric.invalid).to.deep.equal(['invalid_event_sequence'])
    const overflow = parse(['id: 9223372036854775808\ndata: {"type":"stream_ready","cursor":"9223372036854775808"}\n\n'])
    expect(overflow.cursors).to.deep.equal([])
    expect(overflow.invalid).to.deep.equal(['invalid_event_id'])
  })

  it('rejects conflicting id and eventSequence without advancing cursor', () => {
    const result = parse(['id: 4\ndata: {"type":"agent_message_delta","eventSequence":"5","turnId":"t","deltaSeq":"1","content":"x"}\n\n'])
    expect(result.events).to.deep.equal([])
    expect(result.cursors).to.deep.equal([])
    expect(result.invalid).to.deep.equal(['event_sequence_conflict'])
  })
})
