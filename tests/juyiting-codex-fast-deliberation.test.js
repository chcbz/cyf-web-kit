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
const base = ({ chatApi, apiStore = { authorizationGeneration: 1, token: async () => '' }, metadata, context } = {}) => useHallConversation({
  apiStore, chatApi: chatApi || {},
  chatContext: context || ref({ conversationScopeType: 'public', conversationScopeKey: 'public', mode: 'public', participantAgentIds: ['a'], targetAgentIds: ['a'], targetAgentId: 'a' }),
  chatMode: ref('public'), globalStore: { user: { username: 'tester' } }, log: { warn () {}, error () {} },
  openPanel () {}, outgoingMetadata: ref(metadata || { inputRefs: [{ type: 'message', id: '9007199254740993', content: 'must never upload' }] }),
  portraitShortName: agent => agent?.name || '', selectedAgent: ref({ agentId: 'a' }), selectedTask: ref(null), showToast () {}
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
    let statusDuringPost = ''
    const conversation = base({ chatApi: {
      get: async () => ({ data: { data: capabilityV2 } }),
      create: async (_p, body, options) => {
        statusDuringPost = conversation.deliberationStatus.value
        options.onStream(JSON.stringify({ agentDelivery: { agentId: 'a', accepted: true, state: 'QUEUED' }, conversationId: '9007199254740993', requestId: body.requestId, turnId: 'turn-x', route: 'CHAT' }))
        options.onStreamEnd()
      }
    } })
    conversation.setDraft('status')
    await conversation.sendHallMessage()
    expect(statusDuringPost).to.equal('正在提交，等待受理')
    expect(statusDuringPost).not.to.match(/Fast|read-only/i)
    expect(conversation.deliberationStatus.value).to.equal('CHAT · 排队中')
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
          state: 'CANCELLED', stateVersion: '1', lastDeltaSeq: '0' } } }
      }
    } })
    conversation.setDraft('cancel me')
    await conversation.sendHallMessage()
    await Promise.resolve()
    expect(conversation.durableCancelTarget.value).to.deep.equal({ turnId: 'turn-a' })
    expect(await conversation.cancelDeliberation({ turnId: 'turn-a' })).to.equal(true)
    expect(posts).to.deep.equal([{ path: '/turns/turn-a/cancel', body: { expectedStateVersion: '0' } }])
    expect(conversation.deliberationStatus.value).to.equal('已取消')
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
