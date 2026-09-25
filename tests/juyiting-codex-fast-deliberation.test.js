import { expect } from 'chai'
import { ref } from 'vue'
import { useHallConversation } from '../src/composables/juyiting/useHallConversation.js'
import { appendHallEventMessage } from '../src/composables/juyiting/hallConversationMessages.js'

const base = ({ chatApi }) => useHallConversation({
  apiStore: { token: async () => '' }, chatApi,
  chatContext: ref({ conversationScopeType: 'public', conversationScopeKey: 'public', mode: 'public', participantAgentIds: ['a'], targetAgentIds: ['a'], targetAgentId: 'a' }),
  chatMode: ref('public'), globalStore: { user: { username: 'tester' } }, log: { warn () {}, error () {} },
  openPanel () {}, outgoingMetadata: ref({ inputRefs: [{ type: 'message', id: '9007199254740993', content: 'must never upload' }], execute: true, route: 'EXECUTE' }),
  portraitShortName: agent => agent?.name || '', selectedAgent: ref({ agentId: 'a' }), selectedTask: ref(null), showToast () {}
})

describe('Juyi Hall Codex durable deliberation web contract', () => {
  it('negotiates v2 before sending and keeps body requestId equal to Idempotency-Key', async () => {
    const sent = []
    const conversation = base({ chatApi: {
      get: async path => path === '/capabilities' ? { data: { data: { schemaVersion: '2', requestId: true, requestRevision: true, contextSnapshot: true, durableTurns: true, deltaSequence: true, cancel: true, interactionHints: ['chat', 'inspect'] } } } : { data: { data: {} } },
      create: async (_path, body, options) => { sent.push({ body, options }); options.onStream('data: {"conversationId":"9007199254740993"}'); options.onStreamEnd() }
    } })
    conversation.setDraft('inspect only')
    await conversation.sendHallMessage()
    expect(sent).to.have.length(1)
    expect(sent[0].body.requestId).to.equal(sent[0].options.headers['Idempotency-Key'])
    expect(sent[0].body.requestRevision).to.equal('1')
    expect(sent[0].body.interactionHint).to.equal('inspect')
    expect(sent[0].body.inputRefs).to.deep.equal([{ type: 'message', id: '9007199254740993' }])
    expect(sent[0].body.metadata).not.to.have.any.keys('execute', 'route', 'intent')
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

  it('recovers an unknown v2 POST through request lookup without a second POST', async () => {
    let creates = 0; let requestLookups = 0
    const conversation = base({ chatApi: {
      get: async path => {
        if (path === '/capabilities') return { data: { data: { schemaVersion: '2', requestId: true, requestRevision: true, contextSnapshot: true, durableTurns: true, deltaSequence: true, cancel: true, interactionHints: ['chat'] } } }
        if (path.startsWith('/requests/')) {
          requestLookups++
          return { data: { data: { requestId: path.slice(10), conversationId: '9007199254740993', state: 'queued', turns: [{ turnId: '9007199254740995', state: 'queued', stateVersion: '1' }] } } }
        }
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

  it('cancels exactly one durable turn with its string expectedStateVersion', async () => {
    const calls = []
    const conversation = base({ chatApi: {
      post: async (path, body) => { calls.push({ path, body }) }
    } })
    conversation.activeRequest.value = { requestId: 'req-9007199254740993' }
    conversation.activeTurns.value = [{ turnId: '9007199254740995', stateVersion: '9007199254740997', state: 'generating' }]
    expect(await conversation.cancelDeliberation({ turnId: '9007199254740995' })).to.equal(true)
    expect(calls).to.deep.equal([{ path: '/turns/9007199254740995/cancel', body: { expectedStateVersion: '9007199254740997' } }])
    conversation.disposeHallConversation()
  })

  it('keeps Long IDs as strings, drops duplicate/gapped deltas, and keeps same-agent turns separate', () => {
    const state = { conversationId: '9007199254740993', messages: [], isAwaitingReply: true, isStreaming: true }
    const delta = (turnId, deltaSeq, content) => appendHallEventMessage(state, { type: 'agent_message_delta', conversationId: state.conversationId, turnId, deltaSeq, agentId: 'a', content })
    delta('9007199254740995', '1', 'A'); delta('9007199254740997', '1', 'B')
    expect(state.messages).to.have.length(2)
    expect(delta('9007199254740995', '1', 'bad').type).to.equal('duplicate_delta')
    expect(delta('9007199254740995', '3', 'bad').type).to.equal('resync_required')
    expect(state.messages.find(message => message.turnId === '9007199254740995')).to.equal(undefined)
    expect(state.messages.find(message => message.turnId === '9007199254740997').content).to.equal('B')
  })
})
