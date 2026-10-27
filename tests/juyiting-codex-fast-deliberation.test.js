import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'
import { useHallConversation as actualHallConversation } from '../src/composables/juyiting/useHallConversation.js'
import { currentChatStreamMock, conversationFrame } from './fixtures/current-chat-stream-mock.js'
const useHallConversation = options => actualHallConversation({ ...options, chatApi: currentChatStreamMock(options.chatApi) })
import { appendHallEventMessage } from '../src/composables/juyiting/hallConversationMessages.js'
import { createHallSseParser } from '../src/composables/juyiting/hallConversationSse.js'
import { cancellationTarget, deliberationBusy, isTerminalTurnState, reduceDeliberationEvent } from '../src/composables/juyiting/hallDeliberationState.js'
import { stopIdentityBoundWork } from '../src/utils/identityLifecycle.js'

import { hallCapabilities as capabilityV2 } from './fixtures/hall-current-protocol.js'
const deferred = () => { let resolve; let reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail }); return { promise, resolve, reject } }
const base = ({ chatApi, apiStore = { authorizationGeneration: 1, token: async () => '' }, metadata, context, onDelivery, outgoingMetadata, onFinalReply, onTypedOutcome, identityScope, replyCancellationStorage } = {}) => useHallConversation({
  apiStore, identityScope, replyCancellationStorage, chatApi: chatApi || {},
  chatContext: context || ref({ conversationScopeType: 'public', conversationScopeKey: 'public', mode: 'public', participantAgentIds: ['a'], targetAgentIds: ['a'], targetAgentId: 'a' }),
  chatMode: ref('public'), globalStore: { user: { username: 'tester' } }, log: { warn () {}, error () {} },
  openPanel () {}, outgoingMetadata: outgoingMetadata || ref(metadata || { inputRefs: [{ type: 'message', id: '9007199254740993', content: 'must never upload' }] }),
  portraitShortName: agent => agent?.name || '', selectedAgent: ref({ agentId: 'a' }), selectedTask: ref(null), showToast () {}, onDelivery, onFinalReply, onTypedOutcome
})

const durableTurnView = ({ requestId, turnId, state, stateVersion, targetAgentId = 'a', lastDeltaSeq = '0' }) => ({
  turnId, requestId, requestRevision: '1', conversationId: '9007199254740993', conversationGeneration: '1',
  targetAgentId, contextSnapshotId: `snapshot-${turnId}`, dispatchId: `dispatch-${turnId}`, route: 'CHAT', state,
  stateVersion, lastDeltaSeq, terminalReason: state === 'PUBLISHED' ? 'completed' : null,
  finalMessageId: state === 'PUBLISHED' ? `9${turnId === 'turn-a' ? '1' : '2'}` : null,
  createdAt: '100', updatedAt: '200'
})
const durableRequestView = ({ requestId, state, stateVersion, turns }) => ({
  requestId, requestRevision: '1', conversationId: '9007199254740993', conversationGeneration: '1',
  userMessageId: '90', state, stateVersion, turns
})
const flushReadbacks = async (count = 8) => {
  for (let index = 0; index < count; index += 1) await Promise.resolve()
}

describe('Juyi Hall Codex durable deliberation web contract', () => {
  it('negotiates v2 before sending and keeps body requestId equal to Idempotency-Key', async () => {
    const sent = []
    const conversation = base({ chatApi: {
      get: async path => path === '/capabilities' ? ((capabilityV2)) : (({})),
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

  it('normalizes text once at the send entry and forwards the same content', async () => {
    let conversions = 0; const sent = []
    const content = { toString: () => { conversions++; return '  one normalized message  ' } }
    const conversation = base({ chatApi: {
      get: async () => ((capabilityV2)),
      create: async (_path, body, options) => { sent.push(body); options.onStreamEnd() }
    } })
    try {
      expect(await conversation.sendHallMessage({ content })).to.equal(true)
      expect(conversions).to.equal(1)
      expect(sent).to.have.length(1)
      expect(sent[0].content).to.equal('one normalized message')
      expect(conversation.messages.value[0].content).to.equal(sent[0].content)
    } finally { conversation.disposeHallConversation() }
  })

  it('rejects empty text and non-string voice before protocol checks or state changes', async () => {
    let reads = 0; let sends = 0
    const conversation = base({ chatApi: {
      get: async () => { reads++; return (capabilityV2) },
      create: async () => { sends++ }
    } })
    try {
      conversation.setDraft('keep draft')
      for (const content of ['', '  ', 0, false]) {
        expect(await conversation.sendHallMessage({ content })).to.equal(false)
      }
      for (const content of [undefined, null, 12, {}, [], { toString: () => { throw new Error('voice must not coerce') } }]) {
        expect(await conversation.sendHallMessage({ source: 'voice', content })).to.equal(false)
      }
      expect(reads).to.equal(0)
      expect(sends).to.equal(0)
      expect(conversation.draft.value).to.equal('keep draft')
      expect(conversation.isSubmitting.value).to.equal(false)
      expect(conversation.deliberationStatus.value).to.equal('')
      expect(conversation.activeRequest.value).to.equal(null)
      expect(conversation.messages.value).to.deep.equal([])
    } finally { conversation.disposeHallConversation() }
  })

  for (const [flag, value] of [
    ['isSubmitting', true], ['isAdoptingBountyBootstrap', true], ['isStreaming', true], ['isAwaitingReply', true],
    ['conversationHistoryDeletingId', 'conversation-1'], ['conversationLoadError', 'cannot load'],
    ['activeRequest', { requestId: 'unknown-request', state: 'SUBMITTING' }]
  ]) {
    it(`blocks send through the shared entry guard while ${flag} is active`, async () => {
      let reads = 0; let sends = 0
      const conversation = base({ chatApi: {
        get: async () => { reads++; return (capabilityV2) },
        create: async () => { sends++ }
      } })
      try {
        conversation.setDraft('keep draft')
        conversation[flag].value = value
        expect(await conversation.sendHallMessage()).to.equal(false)
        expect(reads).to.equal(0)
        expect(sends).to.equal(0)
        expect(conversation.draft.value).to.equal('keep draft')
        expect(conversation.messages.value).to.deep.equal([])
        expect(conversation[flag].value).to.deep.equal(value)
      } finally { conversation.disposeHallConversation() }
    })
  }

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
    gate.resolve(((capabilityV2)))
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
    gate.resolve(((capabilityV2)))
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
    gate.resolve(((capabilityV2)))
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

  for (const failure of ['network', 'unsupported', 'missing-client']) {
    it(`does not send or clear the draft when current protocol is unavailable (${failure})`, async () => {
      const sent = []; let available = false; let probes = 0
      const chatApi = {
        get: async path => {
          if (path !== '/capabilities') return ({})
          probes++
          if (available) return ((capabilityV2))
          if (failure === 'network') throw new Error('network unavailable')
          return (({ ...capabilityV2, durableTurns: false }))
        },
        create: async (_p, body, options) => { sent.push({ body, options }); options.onStreamEnd() }
      }
      const get = chatApi.get
      if (failure === 'missing-client') delete chatApi.get
      const conversation = base({ chatApi })
      conversation.setDraft('keep my draft')
      expect(await conversation.sendHallMessage()).to.equal(false)
      expect(sent).to.have.length(0)
      expect(conversation.draft.value).to.equal('keep my draft')
      expect(conversation.messages.value).to.have.length(0)
      expect(conversation.isSubmitting.value).to.equal(false)
      expect(conversation.capabilityState.value.loaded).to.equal(false)
      expect(conversation.deliberationStatus.value).to.include('消息未发送')
      available = true
      chatApi.get = get
      expect(await conversation.sendHallMessage()).to.equal(true)
      expect(sent).to.have.length(1)
      expect(sent[0].body.requestId).to.equal(sent[0].options.headers['Idempotency-Key'])
      expect(sent[0].body.requestRevision).to.equal('1')
      expect(probes).to.equal(failure === 'missing-client' ? 1 : 2)
      expect(conversation.draft.value).to.equal('')
      conversation.disposeHallConversation()
    })
  }

  it('keeps pre-admission status neutral and only renders observed runtime policy', async () => {
    let statusDuringPost = ''; let stateDuringPost; const deliveries = []
    const conversation = base({ onDelivery: delivery => deliveries.push(delivery), chatApi: {
      get: async () => (((capabilityV2))),
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
    expect(conversation.deliberationStatus.value).to.equal('排队中')
    conversation.disposeHallConversation()
  })

  it('emits a scene receipt only after delivered or DISPATCHED, never for accepted QUEUED', async () => {
    const deliveries = []; let queuedDeliveryCount = -1
    const conversation = base({ onDelivery: delivery => deliveries.push(delivery), chatApi: {
      get: async () => (((capabilityV2))),
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
      get: async () => (((capabilityV2))),
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
        if (path === '/capabilities') return ((capabilityV2))
        if (path.startsWith('/requests/')) { requestLookups++; return ((durableRequestView({ requestId: path.slice(10), state: 'RUNNING', stateVersion: '1', turns: [durableTurnView({ requestId: path.slice(10), turnId: '9007199254740995', state: 'QUEUED', stateVersion: '1' })] }))) }
        return (({}))
      },
      getById: async (_p, _id, options) => options?.onSuccess?.(([])),
      create: async () => { creates++; throw new TypeError('network unknown') }
    } })
    conversation.setDraft('once')
    await conversation.sendHallMessage()
    expect(creates).to.equal(1); expect(requestLookups).to.equal(1)
    expect(conversation.activeTurns.value[0].turnId).to.equal('9007199254740995')
    conversation.disposeHallConversation()
  })

  it('does not write recovery status or messages after identity changes during unknown POST readback', async () => {
    const gate = deferred(); const started = deferred(); let creates = 0
    const conversation = base({ chatApi: {
      get: async path => {
        if (path === '/capabilities') return (capabilityV2)
        started.resolve(path)
        return gate.promise
      },
      create: async () => { creates++; throw new TypeError('unknown POST result') }
    } })
    conversation.setDraft('old identity')
    const sending = conversation.sendHallMessage()
    const path = await started.promise
    stopIdentityBoundWork()
    gate.resolve(({ requestId: path.slice('/requests/'.length), state: 'RUNNING', conversationId: '1001', turns: [] }))
    expect(await sending).to.equal(false)
    expect(creates).to.equal(1)
    expect(conversation.messages.value).to.deep.equal([])
    expect(conversation.activeRequest.value).to.equal(null)
    expect(conversation.deliberationStatus.value).to.equal('')
    expect(conversation.isAwaitingReply.value).to.equal(false)
    conversation.disposeHallConversation()
  })

  it('readbacks an API-shaped unversioned final and converges a versioned queued turn to PUBLISHED', async () => {
    let requestId; let requestLookups = 0
    const conversation = base({ chatApi: {
      get: async path => {
        if (path === '/capabilities') return ((capabilityV2))
        requestLookups += 1
        return ((durableRequestView({ requestId, state: 'COMPLETED', stateVersion: '2',
          turns: [durableTurnView({ requestId, turnId: 'turn-a', state: 'PUBLISHED', stateVersion: '2', lastDeltaSeq: '1' })] })))
      },
      create: async (_path, body, options) => {
        requestId = body.requestId
        options.onStream(JSON.stringify({ type: 'chat_request_replay', requestId, requestRevision: '1', turnId: 'turn-a',
          conversationId: '9007199254740993', state: 'QUEUED', stateVersion: '1', targetAgentId: 'a', route: 'CHAT' }))
        options.onStream(JSON.stringify({ type: 'agent_message', requestId, requestRevision: '1', turnId: 'turn-a',
          dispatchId: 'dispatch-turn-a', targetAgentId: 'a', contextSnapshotId: 'snapshot-turn-a',
          conversationId: '9007199254740993', conversationGeneration: '1', messageId: '91', finalSeq: '1',
          content: '权威终稿', senderType: 'agent', senderName: 'Agent A', occurredAt: '200' }))
        options.onStreamEnd()
      }
    } })
    conversation.conversationId.value = '9007199254740993'
    conversation.setDraft('unversioned final')
    await conversation.sendHallMessage()
    await flushReadbacks()
    expect(requestLookups).to.equal(1)
    expect(conversation.activeTurns.value[0]).to.include({ turnId: 'turn-a', state: 'PUBLISHED', stateVersion: '2' })
    expect(conversation.isConversationBusy.value).to.equal(false)
    expect(conversation.isAwaitingReply.value).to.equal(false)
    expect(conversation.messages.value.filter(message => message.localId === '91')).to.have.length(1)
    conversation.disposeHallConversation()
  })

  it('forces a post-final readback when an unversioned final joins stale post-error recovery', async () => {
    const stale = deferred(); const fresh = deferred()
    let requestId; let streamOptions; let requestLookups = 0
    const conversation = base({ chatApi: {
      get: async path => {
        if (path === '/capabilities') return ((capabilityV2))
        requestLookups += 1
        return requestLookups === 1 ? stale.promise : fresh.promise
      },
      create: async (_path, body, options) => {
        requestId = body.requestId
        streamOptions = options
        options.onStream(JSON.stringify({ type: 'chat_request_replay', requestId, requestRevision: '1', turnId: 'turn-a',
          conversationId: '9007199254740993', state: 'QUEUED', stateVersion: '1', targetAgentId: 'a', route: 'CHAT' }))
        throw new TypeError('transport lost after admission')
      }
    } })
    conversation.conversationId.value = '9007199254740993'
    conversation.setDraft('post-error final race')
    const sending = conversation.sendHallMessage()
    await flushReadbacks()
    expect(requestLookups).to.equal(1)
    streamOptions.onStream(JSON.stringify({ type: 'agent_message', requestId, requestRevision: '1', turnId: 'turn-a',
      dispatchId: 'dispatch-turn-a', targetAgentId: 'a', contextSnapshotId: 'snapshot-turn-a',
      conversationId: '9007199254740993', conversationGeneration: '1', messageId: '91', finalSeq: '1',
      content: 'transport外终稿', senderType: 'agent', senderName: 'Agent A', occurredAt: '200' }))
    stale.resolve(((durableRequestView({ requestId, state: 'RUNNING', stateVersion: '1',
      turns: [durableTurnView({ requestId, turnId: 'turn-a', state: 'QUEUED', stateVersion: '1', lastDeltaSeq: '0' })] }))))
    await flushReadbacks(16)
    expect(requestLookups).to.equal(2)
    expect(conversation.isConversationBusy.value).to.equal(true)
    fresh.resolve(((durableRequestView({ requestId, state: 'COMPLETED', stateVersion: '2',
      turns: [durableTurnView({ requestId, turnId: 'turn-a', state: 'PUBLISHED', stateVersion: '2', lastDeltaSeq: '1' })] }))))
    expect(await sending).to.equal(false)
    await flushReadbacks(16)
    expect(requestLookups).to.equal(2)
    expect(conversation.activeTurns.value[0]).to.include({ state: 'PUBLISHED', stateVersion: '2' })
    expect(conversation.isConversationBusy.value).to.equal(false)
    conversation.disposeHallConversation()
  })

  it('coalesces group final readbacks, stays busy after failure, then converges on one pending rerun', async () => {
    const first = deferred(); const second = deferred(); let requestId; let requestLookups = 0
    const conversation = base({ chatApi: {
      get: async path => {
        if (path === '/capabilities') return ((capabilityV2))
        requestLookups += 1
        return requestLookups === 1 ? first.promise : second.promise
      },
      create: async (_path, body, options) => {
        requestId = body.requestId
        for (const [turnId, agentId] of [['turn-a', 'a'], ['turn-b', 'b']]) {
          options.onStream(JSON.stringify({ type: 'chat_request_replay', requestId, requestRevision: '1', turnId,
            conversationId: '9007199254740993', state: 'QUEUED', stateVersion: '1', targetAgentId: agentId, route: 'CHAT' }))
        }
        const final = (turnId, agentId, messageId) => options.onStream(JSON.stringify({ type: 'agent_message', requestId,
          requestRevision: '1', turnId, dispatchId: `dispatch-${turnId}`, targetAgentId: agentId,
          contextSnapshotId: `snapshot-${turnId}`, conversationId: '9007199254740993', conversationGeneration: '1',
          messageId, finalSeq: '1', content: `final-${turnId}`, senderType: 'agent', senderName: agentId, occurredAt: '200' }))
        final('turn-a', 'a', '91')
        final('turn-a', 'a', '91')
        final('turn-b', 'b', '92')
        options.onStreamEnd()
      }
    } })
    conversation.conversationId.value = '9007199254740993'
    conversation.setDraft('group finals')
    await conversation.sendHallMessage()
    expect(requestLookups).to.equal(1)
    expect(conversation.isConversationBusy.value).to.equal(true)
    first.reject(new Error('readback unavailable'))
    await flushReadbacks(12)
    expect(requestLookups).to.equal(2)
    expect(conversation.isConversationBusy.value).to.equal(true)
    second.resolve(((durableRequestView({ requestId, state: 'COMPLETED', stateVersion: '2', turns: [
      durableTurnView({ requestId, turnId: 'turn-a', state: 'PUBLISHED', stateVersion: '2', lastDeltaSeq: '1' }),
      durableTurnView({ requestId, turnId: 'turn-b', state: 'PUBLISHED', stateVersion: '2', targetAgentId: 'b', lastDeltaSeq: '1' })
    ] }))))
    await flushReadbacks(12)
    expect(requestLookups).to.equal(2)
    expect(conversation.activeTurns.value.map(turn => turn.state)).to.deep.equal(['PUBLISHED', 'PUBLISHED'])
    expect(conversation.isConversationBusy.value).to.equal(false)
    conversation.disposeHallConversation()
  })

  it('ignores a late unversioned-final readback after identity lifecycle reset', async () => {
    const gate = deferred(); let requestId; let requestLookups = 0
    const conversation = base({ chatApi: {
      get: async path => {
        if (path === '/capabilities') return ((capabilityV2))
        requestLookups += 1
        return gate.promise
      },
      create: async (_path, body, options) => {
        requestId = body.requestId
        options.onStream(JSON.stringify({ type: 'chat_request_replay', requestId, requestRevision: '1', turnId: 'turn-a',
          conversationId: '9007199254740993', state: 'QUEUED', stateVersion: '1', targetAgentId: 'a', route: 'CHAT' }))
        options.onStream(JSON.stringify({ type: 'agent_message', requestId, requestRevision: '1', turnId: 'turn-a',
          dispatchId: 'dispatch-turn-a', targetAgentId: 'a', contextSnapshotId: 'snapshot-turn-a',
          conversationId: '9007199254740993', conversationGeneration: '1', messageId: '91', finalSeq: '1',
          content: 'late final', senderType: 'agent', senderName: 'Agent A', occurredAt: '200' }))
        options.onStreamEnd()
      }
    } })
    conversation.conversationId.value = '9007199254740993'
    conversation.setDraft('identity fence')
    await conversation.sendHallMessage()
    expect(requestLookups).to.equal(1)
    stopIdentityBoundWork()
    gate.resolve(((durableRequestView({ requestId, state: 'COMPLETED', stateVersion: '2',
      turns: [durableTurnView({ requestId, turnId: 'turn-a', state: 'PUBLISHED', stateVersion: '2' })] }))))
    await flushReadbacks(12)
    expect(conversation.activeRequest.value).to.equal(null)
    expect(conversation.activeTurns.value).to.deep.equal([])
    expect(conversation.messages.value).to.deep.equal([])
    conversation.disposeHallConversation()
  })

  it('uses a true trailing debounce for continuous deltas and reads back once after final', async () => {
    const originalSetTimeout = window.setTimeout; const originalClearTimeout = window.clearTimeout
    const timers = []; let now = 0; let requestId; let requestLookups = 0
    window.setTimeout = (callback, delay) => {
      const timer = { callback, delay, dueAt: now + delay, cleared: false }
      timers.push(timer)
      return timer
    }
    window.clearTimeout = timer => { if (timer) timer.cleared = true }
    const advance = async milliseconds => {
      const target = now + milliseconds
      while (true) {
        const timer = timers.filter(item => !item.cleared && item.dueAt <= target).sort((left, right) => left.dueAt - right.dueAt)[0]
        if (!timer) break
        now = timer.dueAt
        timer.cleared = true
        timer.callback()
        await flushReadbacks()
      }
      now = target
    }
    let conversation
    try {
      conversation = base({ chatApi: {
        get: async path => {
          if (path === '/capabilities') return ((capabilityV2))
          requestLookups += 1
          return ((durableRequestView({ requestId, state: 'COMPLETED', stateVersion: '2',
            turns: [durableTurnView({ requestId, turnId: 'turn-a', state: 'PUBLISHED', stateVersion: '2', lastDeltaSeq: '12' })] })))
        },
        create: async (_path, body, options) => {
          requestId = body.requestId
          options.onStream(JSON.stringify({ type: 'chat_request_replay', requestId, requestRevision: '1', turnId: 'turn-a',
            conversationId: '9007199254740993', state: 'QUEUED', stateVersion: '1', targetAgentId: 'a', route: 'CHAT' }))
          for (let sequence = 1; sequence <= 12; sequence += 1) {
            const deltaSeq = String(sequence)
            options.onStream(JSON.stringify({ type: 'agent_message_delta', requestId, requestRevision: '1', turnId: 'turn-a',
              dispatchId: 'dispatch-turn-a', targetAgentId: 'a', conversationId: '9007199254740993',
              conversationGeneration: '1', deltaSeq, content: deltaSeq }))
            await advance(100)
            expect(requestLookups).to.equal(0)
          }
          expect(timers.filter(timer => timer.delay === 250 && !timer.cleared)).to.have.length(1)
          options.onStream(JSON.stringify({ type: 'agent_message', requestId, requestRevision: '1', turnId: 'turn-a',
            dispatchId: 'dispatch-turn-a', targetAgentId: 'a', contextSnapshotId: 'snapshot-turn-a',
            conversationId: '9007199254740993', conversationGeneration: '1', messageId: '91', finalSeq: '12',
            content: 'final-after-deltas', senderType: 'agent', senderName: 'Agent A', occurredAt: '200' }))
          await flushReadbacks()
          expect(requestLookups).to.equal(1)
          options.onStreamEnd()
        }
      } })
      conversation.conversationId.value = '9007199254740993'
      conversation.setDraft('delta trailing debounce')
      await conversation.sendHallMessage()
      await flushReadbacks()
      expect(requestLookups).to.equal(1)
      expect(conversation.isConversationBusy.value).to.equal(false)
    } finally {
      conversation?.disposeHallConversation()
      window.setTimeout = originalSetTimeout
      window.clearTimeout = originalClearTimeout
    }
  })

  it('keeps terminal unknown-result recovery non-busy when history reload fails', async () => {
    let requestId; let creates = 0; let contentLoads = 0
    const conversation = base({ chatApi: {
      get: async path => {
        if (path === '/capabilities') return ((capabilityV2))
        return ((durableRequestView({ requestId, state: 'COMPLETED', stateVersion: '2', turns: [durableTurnView({ requestId, turnId: 'turn-terminal', state: 'PUBLISHED', stateVersion: '2', lastDeltaSeq: '1' })] })))
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
      get: async () => (((capabilityV2))),
      create: async (_path, body, options) => {
        requestId = body.requestId
        for (const turnId of ['turn-a', 'turn-b']) options.onStream(JSON.stringify({ requestId, turnId, state: 'QUEUED', agentDelivery: { agentId: turnId, accepted: true, state: 'QUEUED', turnId }, conversationId: '9007199254740993' }))
        options.onStreamEnd()
      },
      post: async () => ((({ requestId: 'different-request', state: 'CANCELLED', turns: [] })))
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
      get: async () => (((capabilityV2))),
      create: async (_path, body, options) => {
        requestId = body.requestId
        responses[3].requestId = requestId
        responses[4].requestId = requestId
        options.onStream(JSON.stringify({ type: 'chat_request_replay', requestId, turnId: 'turn-a', conversationId: '9007199254740993',
          state: 'QUEUED', stateVersion: '0' }))
        options.onStreamEnd()
      },
      post: async () => (((responses.shift())))
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

  for (const mode of ['conflict', 'unknown', 'completed']) {
    it(`reconciles ${mode} cancellation without an automatic second POST`, async () => {
      let requestId, posts = 0, queried = 0, cancelled = false
      const bodies = []
      const conversation = base({ chatApi: {
        get: async path => {
          if (path === '/capabilities') return capabilityV2
          queried += 1
          const done = mode === 'completed' && posts > 0
          return durableRequestView({ requestId, state: cancelled ? 'CANCELLED' : done ? 'COMPLETED' : 'RUNNING', stateVersion: '2',
            turns: [durableTurnView({ requestId, turnId: 'turn-a', state: cancelled ? 'CANCELLED' : done ? 'PUBLISHED' : 'STREAMING', stateVersion: '2' })] })
        },
        create: async (_path, body, options) => {
          requestId = body.requestId
          options.onStream(JSON.stringify({ type: 'chat_request_replay', requestId, turnId: 'turn-a',
            conversationId: '9007199254740993', state: 'QUEUED', stateVersion: '0' }))
          options.onStreamEnd()
        },
        post: async (_path, body) => {
          posts += 1; bodies.push(body)
          if (posts === 1) throw mode === 'unknown' ? new TypeError('connection lost') : Object.assign(new Error('conflict'), { status: 409, code: 'CHAT_REQUEST_CONFLICT' })
          cancelled = true
          return durableTurnView({ requestId, turnId: 'turn-a', state: 'CANCELLED', stateVersion: '3' })
        }
      } })
      conversation.setDraft('cancel test'); await conversation.sendHallMessage(); await flushReadbacks()
      expect(await conversation.cancelDeliberation({ turnId: 'turn-a' })).to.equal(mode === 'completed')
      expect(posts).to.equal(1); expect(queried).to.be.greaterThan(0)
      if (mode === 'conflict') {
        expect(conversation.activeTurns.value[0].stateVersion).to.equal('2')
        expect(conversation.deliberationStatus.value).to.include('尚未停止')
        await conversation.cancelDeliberation({ turnId: 'turn-a' })
        expect(posts).to.equal(2); expect(bodies[1].expectedStateVersion).to.equal('2')
      } else if (mode === 'unknown') {
        expect(conversation.deliberationStatus.value).to.include('尚未确认')
        await conversation.cancelDeliberation({ turnId: 'turn-a' }); expect(posts).to.equal(1)
        cancelled = true
        expect(await conversation.cancelDeliberation({ turnId: 'turn-a' })).to.equal(true)
        expect(posts).to.equal(1)
      } else {
        expect(conversation.activeTurns.value[0].state).to.equal('PUBLISHED')
        expect(conversation.isAwaitingReply.value).to.equal(false)
      }
      conversation.disposeHallConversation()
    })
  }

  it('restores an unknown stop across remount for the exact identity/request and only reads it back', async () => {
    const records = new Map()
    const storage = { getItem: key => records.get(key) || null, setItem: (key, value) => records.set(key, value), removeItem: key => records.delete(key) }
    const identityScope = ref('0\u0000client\u0000owner')
    let posts = 0, reads = 0, requestId, done = false
    const chatApi = {
      get: async path => {
        if (path === '/capabilities') return capabilityV2
        reads += 1
        return durableRequestView({ requestId, state: done ? 'CANCELLED' : 'RUNNING', stateVersion: '2', turns: [durableTurnView({ requestId, turnId: 'turn-a', state: done ? 'CANCELLED' : 'STREAMING', stateVersion: '2' })] })
      },
      create: async (_path, body, options) => {
        requestId = body.requestId
        options.onStream(JSON.stringify({ type: 'chat_request_replay', requestId, turnId: 'turn-a', conversationId: '9007199254740993', state: 'STREAMING', stateVersion: '2' })); options.onStreamEnd()
      },
      post: async () => { posts += 1; throw new TypeError('connection lost') }
    }
    const options = { chatApi, identityScope, replyCancellationStorage: storage }
    const first = base(options)
    first.setDraft('stop then reload'); await first.sendHallMessage(); await flushReadbacks()
    await first.cancelDeliberation({ turnId: 'turn-a' })
    expect(records.size).to.equal(1)
    const snapshot = JSON.parse(JSON.stringify({ request: first.activeRequest.value, turns: first.activeTurns.value, id: first.conversationId.value }))
    first.disposeHallConversation()
    const restored = base(options)
    restored.conversationId.value = snapshot.id; restored.activeRequest.value = snapshot.request; restored.activeTurns.value = snapshot.turns
    expect(restored.replyCancellationState.value.unknown).to.equal(true)
    identityScope.value = '0\u0000client\u0000other'
    expect(restored.replyCancellationState.value).to.equal(null)
    identityScope.value = '0\u0000client\u0000owner'
    const readsBefore = reads
    // Even a different supplied target must not widen a previously unknown operation.
    expect(await restored.cancelDeliberation({ allPending: true })).to.equal(false)
    expect(reads).to.be.greaterThan(readsBefore); expect(posts).to.equal(1)
    done = true
    expect(await restored.cancelDeliberation()).to.equal(true)
    expect(posts).to.equal(1); expect(records.size).to.equal(0)
    expect(restored.replyCancellationState.value).to.equal(null)
    restored.disposeHallConversation()
  })

  it('deduplicates concurrent cancellation and accepts a same-version terminal receipt', async () => {
    let requestId, posts = 0
    const pending = deferred()
    const conversation = base({ chatApi: {
      get: async path => path === '/capabilities' ? capabilityV2 : durableRequestView({ requestId, state: posts ? 'CANCELLED' : 'RUNNING', stateVersion: '3',
        turns: [durableTurnView({ requestId, turnId: 'turn-a', state: posts ? 'CANCELLED' : 'STREAMING', stateVersion: '3' })] }),
      create: async (_path, body, options) => {
        requestId = body.requestId
        options.onStream(JSON.stringify({ type: 'chat_request_replay', requestId, turnId: 'turn-a',
          conversationId: '9007199254740993', state: 'STREAMING', stateVersion: '3' })); options.onStreamEnd()
      },
      post: async () => { posts += 1; return pending.promise }
    } })
    conversation.setDraft('cancel test'); await conversation.sendHallMessage(); await flushReadbacks()
    const first = conversation.cancelDeliberation({ turnId: 'turn-a' })
    expect(conversation.replyCancellationState.value).to.include({ inFlight: true, unknown: false })
    expect(await conversation.cancelDeliberation({ turnId: 'turn-a' })).to.equal(false)
    expect(posts).to.equal(1)
    pending.resolve(durableTurnView({ requestId, turnId: 'turn-a', state: 'CANCELLED', stateVersion: '3' }))
    expect(await first).to.equal(true)
    expect(conversation.replyCancellationState.value).to.equal(null)
    expect(posts).to.equal(1)
    conversation.disposeHallConversation()
  })

  it('cancels an exact durable turn with a canonical state version and is terminal-idempotent', async () => {
    const posts = []
    let requestId
    const conversation = base({ chatApi: {
      get: async path => {
        if (path === '/capabilities') return ((capabilityV2))
        return ((durableRequestView({ requestId, state: posts.length ? 'CANCELLED' : 'RUNNING', stateVersion: posts.length ? '1' : '0', turns: [durableTurnView({ requestId, turnId: 'turn-a', state: posts.length ? 'CANCELLED' : 'QUEUED', stateVersion: posts.length ? '1' : '0' })] })))
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
        return (({ turnId: 'turn-a', requestId, requestRevision: '1', conversationId: '9007199254740993',
          conversationGeneration: '1', targetAgentId: 'a', contextSnapshotId: 'snapshot-a', dispatchId: 'dispatch-a', route: 'CHAT',
          state: 'CANCELLED', stateVersion: '1', lastDeltaSeq: '0', terminalReason: 'user_cancelled', finalMessageId: null,
          createdAt: '100', updatedAt: '101' }))
      }
    } })
    conversation.setDraft('cancel me')
    await conversation.sendHallMessage()
    await Promise.resolve()
    expect(conversation.durableCancelTarget.value).to.deep.equal({ turnId: 'turn-a' })
    conversation.messages.value.push({ sender: 'AGENT', turnId: 'turn-a', content: 'partial', streaming: true, statusText: '正在回话' })
    conversation.messages.value.push({ sender: 'AGENT', turnId: 'other-turn', content: 'other', streaming: true })
    expect(await conversation.cancelDeliberation({ turnId: 'turn-a' })).to.equal(true)
    expect(posts).to.deep.equal([{ path: '/turns/turn-a/cancel', body: { expectedStateVersion: '0', expectedLastDeltaSeq: '0' } }])
    expect(conversation.deliberationStatus.value).to.equal('已取消')
    expect(conversation.messages.value.find(m => m.turnId === 'turn-a')).to.include({ streaming: false, content: 'partial', statusText: '已停止（未完成）' })
    expect(conversation.messages.value.find(m => m.turnId === 'other-turn').streaming).to.equal(true)
    expect(await conversation.cancelDeliberation({ turnId: 'turn-a' })).to.equal(true)
    expect(posts).to.have.length(1)
    conversation.disposeHallConversation()
  })

  it('does not resurrect a historical request delta after the current request is cancelled', async () => {
    let requestId
    const conversation = base({ chatApi: {
      get: async path => path === '/capabilities' ? capabilityV2 : durableRequestView({ requestId,
        state: 'CANCELLED', turns: [durableTurnView({ requestId, turnId: 'turn-a', state: 'CANCELLED' })] }),
      create: async (_path, body, options) => {
        requestId = body.requestId
        options.onStream(JSON.stringify({ agentDelivery: { agentId: 'a', accepted: true, state: 'QUEUED' },
          conversationId: '9007199254740993', requestId, turnId: 'turn-a' }))
        conversation.activeRequest.value = { ...conversation.activeRequest.value, requestId, state: 'CANCELLED' }
        conversation.activeTurns.value = [durableTurnView({ requestId, turnId: 'turn-a', state: 'CANCELLED' })]
        options.onStream(JSON.stringify({ type: 'agent_message_delta', conversationId: '9007199254740993',
          requestId: 'historical-request', turnId: 'historical-turn', deltaSeq: '1', content: 'old partial', agentId: 'a' }))
        options.onStreamEnd()
      }
    } })
    try {
      conversation.setDraft('recover stopped reply'); await conversation.sendHallMessage(); await flushReadbacks()
      expect(conversation.messages.value.some(message => message.content === 'old partial')).to.equal(false)
      expect(conversation.messages.value.some(message => message.streaming)).to.equal(false)
      expect(conversation.activeRequest.value.requestId).to.equal(requestId)
    } finally { conversation.disposeHallConversation() }
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

  it('keeps streamed state version and delta checkpoint atomic for cancellation', () => {
    let state = { request: { requestId: 'req' }, turns: [{ turnId: 'turn', state: 'QUEUED', stateVersion: '0', lastDeltaSeq: '0' }] }
    state = reduceDeliberationEvent(state, { type: 'agent_message_delta', requestId: 'req', turnId: 'turn', stateVersion: '587', deltaSeq: '586' })
    expect(state.turns[0]).to.include({ state: 'STREAMING', stateVersion: '587', lastDeltaSeq: '586' })
    const before = structuredClone(state)
    for (const patch of [{ stateVersion: '586', deltaSeq: '585' }, { stateVersion: '587', deltaSeq: '0' }]) {
      state = reduceDeliberationEvent(state, { type: 'agent_message_delta', requestId: 'req', turnId: 'turn', ...patch })
      expect(state).to.deep.equal(before)
    }
    state = reduceDeliberationEvent(state, { requestId: 'req', turnId: 'turn', state: 'CANCELLED', stateVersion: '590', lastDeltaSeq: '588' })
    expect(state.turns[0]).to.include({ state: 'CANCELLED', stateVersion: '590', lastDeltaSeq: '588' })
    const stopped = structuredClone(state)
    state = reduceDeliberationEvent(state, { type: 'agent_message_delta', requestId: 'req', turnId: 'turn', stateVersion: '591', deltaSeq: '589' })
    expect(state).to.deep.equal(stopped)
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
    expect(panel).to.include("$emit('cancel-deliberation', $event)")
    expect(panel).to.include(':reply-cancellation-state="replyCancellationState"')
    expect(panel).not.to.include('title="取消待处理回话"')
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
  for (const type of ['typed_question_answered', 'delivery_submission_completed']) {
    it(`commits ${type} cursor for a non-active request without resync replay`, async () => {
      const originalFetch = global.fetch
      const requests = []; const hints = []; let contentLoads = 0; let conversation
      global.fetch = async (_url, options) => {
        requests.push(options)
        return new Response(new ReadableStream({ start: controller => controller.enqueue(new TextEncoder().encode(
          conversationFrame({ type, conversationId: '9007199254740993', eventSequence: '8', requestId: 'request-child', turnId: 'turn-child' }, '8', new Headers(options.headers).get('X-Request-Id')))) }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream', 'X-Request-Id': new Headers(options.headers).get('X-Request-Id') } })
      }
      try {
        conversation = base({
          apiStore: { authorizationGeneration: 1, token: async () => 'token' },
          onTypedOutcome: event => hints.push(event.requestId),
          chatApi: {
            list: async (_path, _payload, options) => options.onSuccess({ items: [{ id: '9007199254740993', conversationType: 'juyiting', conversationScopeType: 'public', conversationScopeKey: 'public' }], nextCursor: null, hasMore: false }),
            getById: async (_path, _id, options) => { contentLoads++; options.onSuccess([]) }
          }
        })
        await conversation.loadHallMessages()
        for (let index = 0; index < 12; index++) await new Promise(resolve => setImmediate(resolve))
        expect(requests).to.have.length(1)
        expect(contentLoads).to.equal(1)
        expect(hints).to.deep.equal(['request-child'])
      } finally { conversation?.disposeHallConversation(); global.fetch = originalFetch }
    })
  }

  it('reconnects after a valid resync_required from the committed cursor without a replay storm', async () => {
    const originalFetch = global.fetch
    const requests = []; let contentLoads = 0; let conversation
    const fixture = requestId => new TextEncoder().encode(conversationFrame({ type: 'resync_required', conversationId: '9007199254740993', eventSequence: '8', turnId: 'turn-a' }, '8', requestId))
    global.fetch = async (_url, options) => {
      requests.push(options)
      return new Response(new ReadableStream({ start (controller) { controller.enqueue(fixture(new Headers(options.headers).get('X-Request-Id'))) } }), { status: 200, headers: { 'Content-Type': 'text/event-stream', 'X-Request-Id': new Headers(options.headers).get('X-Request-Id') } })
    }
    try {
      conversation = base({
        apiStore: { authorizationGeneration: 1, token: async () => 'token' },
        chatApi: {
          list: async (_path, _payload, options) => options.onSuccess(({ items: [{ id: '9007199254740993', conversationType: 'juyiting', conversationScopeType: 'public', conversationScopeKey: 'public' }], nextCursor: null, hasMore: false })),
          getById: async (_path, _id, options) => { contentLoads += 1; options.onSuccess(([])) }
        }
      })
      await conversation.loadHallMessages()
      for (let index = 0; index < 12; index += 1) await new Promise(resolve => setImmediate(resolve))
      expect(requests).to.have.length(2)
      expect(new Headers(requests[1].headers).get('Last-Event-ID')).to.equal('conversation:9007199254740993:8')
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

// Pre-envelope SSE parser suite retired; current malformed/scope/cursor/chunk regressions live in interface-conversation-sse.test.mjs.


// The transport deliberately remains pending after business completion. These tests
// exercise the real composable rather than a mock that equates EOF with completion.
describe('HALL-ROUND-WEB-20261011 request-scoped closeout', () => {
  const id = '9007199254740993'
  const contextFor = (key = 'public', targets = ['a']) => ({ conversationScopeType: 'public', conversationScopeKey: key,
    mode: 'public', participantAgentIds: targets, targetAgentIds: targets, targetAgentId: targets[0] })
  const harness = ({ targets = ['a'], contentGet, apiStore, outgoingMetadata, onFinalReply, context = ref(contextFor('public', targets)) } = {}) => {
    const posts = []; const views = new Map(); const reads = []; let contentReads = 0
    const conversation = base({ context, apiStore, outgoingMetadata, onFinalReply, chatApi: {
      get: async path => {
        if (path === '/capabilities') return (capabilityV2)
        const requestId = decodeURIComponent(path.slice('/requests/'.length))
        reads.push(requestId)
        const view = views.get(requestId)
        if (view instanceof Error) throw view
        return (view)
      },
      list: async (_path, _params, options) => options.onSuccess(({ items: [{ id, conversationType: 'juyiting',
        conversationScopeType: context.value.conversationScopeType, conversationScopeKey: context.value.conversationScopeKey }], nextCursor: null, hasMore: false })),
      getById: async (_path, conversationId, options) => {
        contentReads++
        if (contentGet) return contentGet(conversationId, options, conversation)
        options.onSuccess(([]))
      },
      create: (_path, body, options) => {
        const transport = deferred()
        const post = { body, options, transport, cancels: 0 }
        posts.push(post)
        views.set(body.requestId, durableRequestView({ requestId: body.requestId, state: 'RUNNING', stateVersion: '1',
          turns: targets.map(agent => durableTurnView({ requestId: body.requestId, turnId: `turn-${agent}`, targetAgentId: agent, state: 'QUEUED', stateVersion: '1' })) }))
        options.onStreamOpen({ cancel: () => { post.cancels++; post.onCancel?.() } })
        for (const agent of targets) options.onStream(JSON.stringify({ requestId: body.requestId, requestRevision: '1',
          conversationId: id, conversationGeneration: '1', turnId: `turn-${agent}`, targetAgentId: agent,
          agentDelivery: { accepted: true, agentId: agent, state: 'QUEUED' } }))
        return transport.promise
      }
    } })
    conversation.conversationId.value = id
    const viewFor = (post, state = 'COMPLETED', turnStates = targets.map(() => 'PUBLISHED')) => durableRequestView({
      requestId: post.body.requestId, state, stateVersion: '2', turns: targets.map((agent, index) => durableTurnView({
        requestId: post.body.requestId, turnId: `turn-${agent}`, targetAgentId: agent, state: turnStates[index], stateVersion: '2', lastDeltaSeq: '1'
      }))
    })
    const readback = async (post, view) => {
      views.set(post.body.requestId, view)
      conversation.refreshExecutionRequest({ conversationId: id, requestId: post.body.requestId })
      await flushReadbacks(24)
    }
    const send = async (content = 'first') => {
      const sending = conversation.sendHallMessage({ content })
      await flushReadbacks(24)
      return { sending, post: posts.at(-1) }
    }
    return { conversation, posts, views, reads, viewFor, readback, send, context, contentReads: () => contentReads }
  }

  it('settles a never-resolving POST from full GET, keeps history and sends two exact requests in one conversation', async () => {
    const finals = []; const h = harness({ onFinalReply: final => finals.push(final) })
    try {
      const first = await h.send()
      first.post.options.onStream(JSON.stringify({ type: 'agent_message', conversationId: id, conversationGeneration: '1',
        requestId: first.post.body.requestId, requestRevision: '1', turnId: 'turn-a', messageId: '91', finalSeq: '1',
        content: 'first final', senderType: 'agent', senderName: 'Agent A', occurredAt: '200' }))
      await h.readback(first.post, h.viewFor(first.post))
      expect(await first.sending).to.equal(true)
      expect(first.post.options.signal.aborted).to.equal(true)
      expect(first.post.cancels).to.equal(1)
      expect(h.conversation.isConversationBusy.value).to.equal(false)
      expect(h.conversation.messages.value.some(message => message.content === 'first final')).to.equal(true)
      expect(finals.map(final => final.messageId)).to.deep.equal(['91'])
      const second = await h.send('second')
      expect(h.posts).to.have.length(2)
      expect(h.posts.map(post => post.body.conversationId)).to.deep.equal([id, id])
      expect(first.post.body.requestId).not.to.equal(second.post.body.requestId)
      expect(h.conversation.messages.value.some(message => message.content === 'first final')).to.equal(true)
      await h.readback(second.post, h.viewFor(second.post, 'FAILED', ['FAILED']))
      expect(await second.sending).to.equal(true)
      expect(h.conversation.deliberationStatus.value).to.include('失败')
    } finally { h.conversation.disposeHallConversation() }
  })

  for (const [label, mutate] of [
    ['partial with a running child', view => { view.state = 'PARTIAL'; view.turns[1].state = 'STREAMING' }],
    ['UNKNOWN child', view => { view.turns[1].state = 'UNKNOWN' }],
    ['RECOVERY_REQUIRED child', view => { view.turns[1].state = 'RECOVERY_REQUIRED' }],
    ['empty turns', view => { view.turns = [] }],
    ['missing admitted turn', view => { view.turns.pop() }],
    ['duplicate turns', view => { view.turns[1] = { ...view.turns[0] } }],
    ['foreign request', view => { view.requestId = 'foreign' }],
    ['foreign revision', view => { view.requestRevision = '2' }],
    ['foreign conversation', view => { view.conversationId = 'other' }],
    ['foreign generation', view => { view.conversationGeneration = '2' }],
    ['foreign child scope', view => { view.turns[1].conversationGeneration = '2' }],
    ['missing request generation', view => { delete view.conversationGeneration }],
    ['lower request version', view => { view.stateVersion = '0' }],
    ['lower turn version', view => { view.turns[1].stateVersion = '0' }],
    ['nonterminal aggregate with terminal children', view => { view.state = 'RUNNING' }]
  ]) {
    it(`does not unlock on ${label}`, async () => {
      const h = harness({ targets: ['a', 'b'] })
      try {
        const { sending, post } = await h.send()
        const invalid = h.viewFor(post); mutate(invalid)
        await h.readback(post, invalid)
        expect(h.conversation.isConversationBusy.value).to.equal(true)
        expect(post.options.signal.aborted).to.equal(false)
        expect(post.cancels).to.equal(0)
        expect(await h.conversation.sendHallMessage({ content: 'must not send' })).to.equal(false)
        expect(h.posts).to.have.length(1)
        await h.readback(post, h.viewFor(post, 'PARTIAL', ['PUBLISHED', 'FAILED']))
        expect(await sending).to.equal(true)
        expect(post.cancels).to.equal(1)
        expect(h.conversation.isConversationBusy.value).to.equal(false)
        expect(h.conversation.deliberationStatus.value).to.include('部分')
      } finally { h.conversation.disposeHallConversation() }
    })
  }

  for (const state of ['FAILED', 'CANCELLED', 'COMPLETED']) {
    it(`releases ${state} from full GET exactly once without treating failure/cancellation as an answer`, async () => {
      const finals = []; const h = harness({ onFinalReply: final => finals.push(final) })
      try {
        const { post, sending } = await h.send()
        const view = h.viewFor(post, state, [state === 'COMPLETED' ? 'FINAL_PERSISTED' : state])
        await h.readback(post, view)
        await h.readback(post, view)
        post.options.onStreamEnd()
        post.options.onStreamEnd()
        expect(await sending).to.equal(true)
        expect(post.cancels).to.equal(1)
        expect(h.conversation.activeRequest.value.state).to.equal(state)
        expect(h.conversation.isConversationBusy.value).to.equal(false)
        expect(finals).to.deep.equal([])
      } finally { h.conversation.disposeHallConversation() }
    })
  }

  it('EOF is transport-only: pending GET and failed terminal readback retain the gate without another POST', async () => {
    const h = harness()
    try {
      const { post, sending } = await h.send()
      post.options.onStreamEnd(); post.transport.resolve()
      expect(await sending).to.equal(true)
      await flushReadbacks(24)
      expect(h.conversation.isConversationBusy.value).to.equal(true)
      await h.readback(post, new Error('GET unavailable'))
      expect(h.conversation.deliberationStatus.value).to.equal('需要恢复核对')
      expect(await h.conversation.sendHallMessage({ content: 'retry must not POST' })).to.equal(false)
      expect(h.posts).to.have.length(1)
      await h.readback(post, h.viewFor(post))
      expect(h.conversation.isConversationBusy.value).to.equal(false)
    } finally { h.conversation.disposeHallConversation() }
  })

  it('ignores old late delta/error/end/open and eventual transport completion after a new request starts', async () => {
    const metadata = ref({ libraryCitationId: 'first-citation' }); const h = harness({ outgoingMetadata: metadata })
    try {
      const first = await h.send()
      await h.readback(first.post, h.viewFor(first.post, 'CANCELLED', ['CANCELLED']))
      expect(await first.sending).to.equal(true)
      metadata.value = { libraryCitationId: 'second-citation' }
      const second = await h.send('second')
      metadata.value = { libraryCitationId: 'new draft metadata' }
      const before = JSON.stringify(h.conversation.messages.value)
      first.post.options.onStream(JSON.stringify({ conversationId: id, content: 'late old text' }))
      first.post.options.onError('late error', new Error('late'))
      first.post.options.onStreamEnd()
      let lateOpenCancelled = 0
      first.post.options.onStreamOpen({ cancel: () => { lateOpenCancelled++ } })
      first.post.transport.reject(new Error('late old rejection'))
      await flushReadbacks(24)
      expect(lateOpenCancelled).to.equal(1)
      expect(JSON.stringify(h.conversation.messages.value)).to.equal(before)
      expect(h.conversation.activeRequest.value.requestId).to.equal(second.post.body.requestId)
      expect(second.post.options.signal.aborted).to.equal(false)
      expect(second.post.cancels).to.equal(0)
      expect(metadata.value).to.deep.equal({ libraryCitationId: 'new draft metadata' })
      expect(h.conversation.isConversationBusy.value).to.equal(true)
      await h.readback(second.post, h.viewFor(second.post, 'CANCELLED', ['CANCELLED']))
      expect(await second.sending).to.equal(true)
    } finally { h.conversation.disposeHallConversation() }
  })

  it('does not let the old finally clear a new send started synchronously during final content recovery', async () => {
    const metadata = ref({}); let secondSending; let launched = false
    const h = harness({ outgoingMetadata: metadata, contentGet: (_id, options, conversation) => {
      if (!launched) {
        launched = true
        metadata.value = { libraryCitationId: 'second' }
        secondSending = conversation.sendHallMessage({ content: 'second from recovery' })
      }
      options.onSuccess(([{ id: '91', senderType: 'agent', content: 'first body' }]))
    } })
    try {
      const first = await h.send()
      await h.readback(first.post, h.viewFor(first.post))
      expect(await first.sending).to.equal(true)
      expect(h.posts).to.have.length(2)
      expect(h.posts[1].body.metadata.libraryCitationId).to.equal('second')
      expect(h.conversation.activeRequest.value.requestId).to.equal(h.posts[1].body.requestId)
      expect(h.posts[1].options.signal.aborted).to.equal(false)
      expect(h.conversation.isConversationBusy.value).to.equal(true)
      expect(h.conversation.messages.value.some(message => message.content === 'first body')).to.equal(false)
      await h.readback(h.posts[1], h.viewFor(h.posts[1], 'CANCELLED', ['CANCELLED']))
      expect(await secondSending).to.equal(true)
    } finally { h.conversation.disposeHallConversation() }
  })

  it('fences A→B→A and identity reset even with the same conversation ID and late old readback', async () => {
    const context = ref(contextFor()); const apiStore = { authorizationGeneration: 1, token: async () => '' }
    const h = harness({ context, apiStore })
    try {
      const first = await h.send()
      context.value = contextFor('B'); context.value = contextFor()
      expect(await first.sending).to.equal(false)
      h.conversation.conversationId.value = id
      const second = await h.send('new A')
      first.post.options.onStream(JSON.stringify({ requestId: first.post.body.requestId, conversationId: id, content: 'stale A' }))
      first.post.options.onStreamEnd(); first.post.transport.resolve()
      await h.readback(first.post, h.viewFor(first.post))
      expect(h.conversation.activeRequest.value.requestId).to.equal(second.post.body.requestId)
      expect(second.post.options.signal.aborted).to.equal(false)
      apiStore.authorizationGeneration++
      stopIdentityBoundWork()
      expect(await second.sending).to.equal(false)
      second.post.options.onStreamEnd()
      await h.readback(second.post, h.viewFor(second.post))
      expect(h.conversation.messages.value).to.deep.equal([])
      expect(h.conversation.activeRequest.value).to.equal(null)
    } finally { h.conversation.disposeHallConversation() }
  })

  it('releases the business gate while missing final body recovery fails, then reuses history GET on refresh', async () => {
    let fail = true; const h = harness({ contentGet: (_id, options) => {
      if (fail) throw new Error('history unavailable')
      options.onSuccess(([{ id: '91', senderType: 'agent', content: 'persisted body' }]))
    } })
    try {
      const { post, sending } = await h.send()
      await h.readback(post, h.viewFor(post))
      expect(await sending).to.equal(true)
      expect(h.conversation.activeRequest.value.state).to.equal('COMPLETED')
      expect(h.conversation.isConversationBusy.value).to.equal(false)
      expect(h.conversation.deliberationStatus.value).to.equal('回话已结束，正文加载待重试')
      expect(h.contentReads()).to.equal(1)
      fail = false
      // The existing refresh path rereads the same conversation; no model POST.
      expect(await h.conversation.retryHallConversation()).to.equal(true)
      expect(h.conversation.messages.value.some(message => message.content === 'persisted body')).to.equal(true)
      expect(h.posts).to.have.length(1)
      post.options.onStreamEnd()
      const second = await h.send('allowed despite missing body')
      expect(h.posts).to.have.length(2)
      await h.readback(second.post, h.viewFor(second.post))
      expect(await second.sending).to.equal(true)
      expect(h.conversation.messages.value.some(message => message.content === 'persisted body')).to.equal(true)
      expect(h.contentReads()).to.equal(2)
    } finally { h.conversation.disposeHallConversation() }
  })

  it('keeps terminal-owned abort successful when cancel synchronously sends EOF and rejects the POST', async () => {
    const h = harness()
    try {
      const { post, sending } = await h.send()
      post.onCancel = () => {
        post.options.onStreamEnd()
        post.transport.reject(new DOMException('own terminal abort', 'AbortError'))
      }
      await h.readback(post, h.viewFor(post, 'CANCELLED', ['CANCELLED']))
      expect(await sending).to.equal(true)
      expect(post.cancels).to.equal(1)
      expect(h.conversation.isConversationBusy.value).to.equal(false)
      expect(h.conversation.messages.value.some(message => message.sender === 'SYSTEM')).to.equal(false)
    } finally { h.conversation.disposeHallConversation() }
  })

  it('a queued old poll neither reads the new request nor clears the new round poll', async () => {
    const originalSet = window.setInterval; const originalClear = window.clearInterval
    const polls = []; const cleared = []
    window.setInterval = callback => { polls.push(callback); return polls.length }
    window.clearInterval = timer => { cleared.push(timer) }
    const h = harness()
    try {
      const first = await h.send()
      first.post.options.onStreamEnd()
      await h.readback(first.post, h.viewFor(first.post, 'CANCELLED', ['CANCELLED']))
      expect(await first.sending).to.equal(true)
      const second = await h.send('second')
      second.post.options.onStreamEnd()
      await flushReadbacks(24)
      const latestTimer = polls.length; const readCount = h.reads.length
      await polls[0]()
      expect(h.reads).to.have.length(readCount)
      expect(cleared).not.to.include(latestTimer)
      expect(h.conversation.activeRequest.value.requestId).to.equal(second.post.body.requestId)
      expect(h.conversation.isConversationBusy.value).to.equal(true)
      await h.readback(second.post, h.viewFor(second.post, 'CANCELLED', ['CANCELLED']))
      expect(await second.sending).to.equal(true)
    } finally {
      h.conversation.disposeHallConversation()
      window.setInterval = originalSet; window.clearInterval = originalClear
    }
  })

  it('closing either POST leaves the independent authenticated conversation GET events reader alive', async () => {
    const originalFetch = global.fetch
    let eventSignal; let eventCancels = 0; let fetches = 0
    global.fetch = async (_url, options) => {
      fetches++; eventSignal = options.signal
      return new Response(new ReadableStream({ cancel: () => { eventCancels++ } }), { status: 200, headers: { 'Content-Type': 'text/event-stream', 'X-Request-Id': new Headers(options.headers).get('X-Request-Id') } })
    }
    const h = harness({ apiStore: { authorizationGeneration: 1, token: async () => 'test-token' } })
    try {
      await h.conversation.loadHallMessages()
      await flushReadbacks(24)
      expect(fetches).to.equal(1)
      expect(eventSignal.aborted).to.equal(false)
      for (const content of ['first', 'second']) {
        const { post, sending } = await h.send(content)
        await h.readback(post, h.viewFor(post, 'CANCELLED', ['CANCELLED']))
        expect(await sending).to.equal(true)
        expect(post.options.signal.aborted).to.equal(true)
        expect(eventSignal.aborted).to.equal(false)
        expect(eventCancels).to.equal(0)
        expect(fetches).to.equal(1)
      }
      expect(h.posts).to.have.length(2)
    } finally {
      h.conversation.disposeHallConversation()
      await flushReadbacks(24)
      global.fetch = originalFetch
    }
  })


  it('does not apply ordinary round settlement to bounty admission or media/action child requests', async () => {
    const context = ref({ ...contextFor(), conversationScopeType: 'bounty', conversationScopeKey: 'task:task-1', mode: 'bounty', taskId: 'task-1' })
    const h = harness({ context })
    try {
      const { post, sending } = await h.send('bounty existing lifecycle')
      await h.readback(post, h.viewFor(post, 'CANCELLED', ['CANCELLED']))
      expect(post.options.signal.aborted).to.equal(false)
      expect(post.cancels).to.equal(0)
      expect(await h.conversation.sendHallMessage({ content: 'POST still open' })).to.equal(false)
      post.options.onStreamEnd(); post.transport.resolve()
      expect(await sending).to.equal(true)
      expect(post.cancels).to.equal(0)
      expect(h.posts).to.have.length(1)
    } finally { h.conversation.disposeHallConversation() }
  })


  it('returns stale rather than successful if identity changes synchronously inside terminal final notification', async () => {
    const apiStore = { authorizationGeneration: 1, token: async () => '' }
    const h = harness({ apiStore, onFinalReply: () => {
      apiStore.authorizationGeneration++
      stopIdentityBoundWork()
    } })
    try {
      const { post, sending } = await h.send()
      post.options.onStream(JSON.stringify({ type: 'agent_message', conversationId: id, conversationGeneration: '1',
        requestId: post.body.requestId, requestRevision: '1', turnId: 'turn-a', messageId: '91', finalSeq: '1',
        content: 'terminal body', senderType: 'agent', occurredAt: '200' }))
      await h.readback(post, h.viewFor(post))
      expect(await sending).to.equal(false)
      expect(h.conversation.conversationId.value).to.equal('')
      expect(h.conversation.activeRequest.value).to.equal(null)
      expect(h.conversation.messages.value).to.deep.equal([])
      expect(h.contentReads()).to.equal(0)
    } finally { h.conversation.disposeHallConversation() }
  })

})
