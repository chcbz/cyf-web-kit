import { expect } from 'chai'
import { ref } from 'vue'
import { setImmediate } from 'node:timers'
import { useHallConversation } from '../src/composables/juyiting/useHallConversation.js'
import { stopIdentityBoundWork } from '../src/utils/identityLifecycle.js'

const reference = () => ({ taskId: 'task-1', targetAgentId: 'agent-1', assignmentRevision: '7',
  conversationId: '9007199254740993', initialRequestId: 'initial-request-1' })
const requestView = () => ({ requestId: 'initial-request-1', requestRevision: '1',
  conversationId: '9007199254740993', conversationGeneration: '0', userMessageId: '4', state: 'PLANNING', stateVersion: '0', turns: [],
  steps: [{ stepId: 'step-1', stepNumber: '1', taskId: 'task-1', assignmentRevision: '7', targetAgentId: 'agent-1',
    kind: 'EXECUTE', state: 'ADMITTED', stateVersion: '0', executionIntentId: 'intent-1', executionId: null, executionState: 'WAITING_ADMISSION' }] })
const context = () => ({ conversationScopeType: 'bounty', conversationScopeKey: 'task:task-1', mode: 'bounty',
  taskId: 'task-1', selectedTaskId: 'task-1', targetAgentId: 'agent-1', targetAgentIds: ['agent-1'], participantAgentIds: ['agent-1'] })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const instances = []
const harness = (overrides = {}) => {
  const calls = []
  const chatContext = ref(context())
  const selectedTask = ref({ id: 'task-1' })
  const selectedAgent = ref({ agentId: 'agent-1' })
  const apiStore = { authorizationGeneration: 1, token: async () => null }
  const chatApi = {
    get: async (path) => { calls.push(['get', path]); return { data: { data: requestView() } } },
    getById: async (path, id, options) => {
      calls.push(['content', path, id])
      options.onSuccess({ data: [{ id: '4', sender: 'USER', content: '画一只鸟', conversationId: id }] })
    },
    post: async path => { calls.push(['post', path]); throw new Error('no writes allowed') },
    list: async path => { calls.push(['list', path]); throw new Error('list-first inference forbidden') },
    stream: async path => { calls.push(['stream', path]); throw new Error('no bootstrap resend allowed') },
    ...overrides
  }
  const hall = useHallConversation({ apiStore, chatContext, selectedTask, selectedAgent, chatApi, chatMode: ref('bounty'),
    globalStore: { getJiacn: 'hero', user: {} }, log: { warn: () => {}, error: () => {} }, openPanel: () => {},
    outgoingMetadata: ref({}), portraitShortName: agent => agent?.agentId || '', showToast: () => {} })
  instances.push(hall)
  return { hall, calls, apiStore, chatContext, selectedTask, selectedAgent }
}

describe('actual Hall conversation adopts the exact admitted bounty bootstrap', () => {
  afterEach(() => { instances.splice(0).forEach(hall => hall.disposeHallConversation()) })

  it('reads exact request and exact history, preserving long IDs, without list/send/write', async () => {
    const { hall, calls } = harness()
    expect(await hall.adoptBountyBootstrap(reference())).to.equal(true)
    expect(calls).to.deep.equal([['get', '/requests/initial-request-1'], ['content', '/conversation/content', '9007199254740993']])
    expect(hall.conversationId.value).to.equal('9007199254740993')
    expect(hall.selectedHallConversationId.value).to.equal('9007199254740993')
    expect(hall.activeRequest.value.steps[0].assignmentRevision).to.equal('7')
    expect(hall.messages.value.some(message => message.content === '画一只鸟')).to.equal(true)
    expect(hall.isAdoptingBountyBootstrap.value).to.equal(false)
    expect(hall.isConversationBusy.value).to.equal(true)
  })

  const genericView = () => {
    const view = requestView(); view.steps = []; view.state = 'RUNNING'
    view.turns = [{ turnId: 'turn-discuss', requestId: view.requestId, requestRevision: view.requestRevision,
      conversationId: view.conversationId, conversationGeneration: view.conversationGeneration,
      targetAgentId: 'agent-1', route: 'CHAT', state: 'RECEIVED', stateVersion: '0', lastDeltaSeq: '0',
      finalMessageId: null, createdAt: '1', updatedAt: '1' }]
    return view
  }
  it('generic bootstrap adopts the exact durable CHAT turn with zero execution steps and no resend', async () => {
    const h = harness({ get: async path => { h.calls.push(['get', path]); return { data: genericView() } } })
    expect(await h.hall.adoptBountyBootstrap({ ...reference(), initialOperation: 'DELIBERATE' })).to.equal(true)
    expect(h.hall.activeRequest.value.steps).to.deep.equal([])
    expect(h.hall.activeTurns.value[0].route).to.equal('CHAT')
    expect(h.calls).to.deep.equal([['get', '/requests/initial-request-1'], ['content', '/conversation/content', '9007199254740993']])
  })
  for (const [label, mutate] of [
    ['wrong target', v => { v.turns[0].targetAgentId = 'foreign' }],
    ['wrong request', v => { v.turns[0].requestId = 'foreign' }],
    ['missing CHAT turn', v => { v.turns = [] }],
    ['execution route', v => { v.turns[0].route = 'EXECUTE' }],
    ['fake execution step', v => { v.steps = requestView().steps }],
    ['ambiguous turns', v => { v.turns.push({ ...v.turns[0], turnId: 'other' }) }]
  ]) it(`generic bootstrap rejects ${label} without opening history`, async () => {
    const view = genericView(); mutate(view)
    const h = harness({ get: async () => ({ data: view }) })
    expect(await h.hall.adoptBountyBootstrap({ ...reference(), initialOperation: 'DELIBERATE' })).to.equal(false)
    expect(h.hall.activeRequest.value).to.equal(null)
    expect(h.calls).to.deep.equal([])
  })

  it('accepts the actual INSPECT bootstrap without forging execution linkage', async () => {
    const view = requestView()
    Object.assign(view.steps[0], { kind: 'INSPECT', executionIntentId: null, executionId: null, executionState: null })
    const { hall } = harness({ get: async () => ({ data: view }) })
    expect(await hall.adoptBountyBootstrap(reference())).to.equal(true)
    expect(hall.activeRequest.value.steps[0].kind).to.equal('INSPECT')
  })

  for (const [label, mutate] of [
    ['another request', v => { v.requestId = 'other' }],
    ['another conversation', v => { v.conversationId = '77' }],
    ['another task', v => { v.steps[0].taskId = 'foreign' }],
    ['another assignment', v => { v.steps[0].assignmentRevision = '8' }],
    ['another explicit Agent', v => { v.steps[0].targetAgentId = 'foreign' }],
    ['no step proof', v => { v.steps = [] }],
    ['ambiguous initial steps', v => { v.steps.push({ ...v.steps[0], stepId: 'step-2' }) }],
    ['CHAT instead of bootstrap action', v => { v.steps[0].kind = 'CHAT' }],
    ['missing execution intent', v => { v.steps[0].executionIntentId = null }],
    ['numeric revision', v => { v.requestRevision = 1 }],
    ['noncanonical revision', v => { v.steps[0].assignmentRevision = '07' }],
    ['numeric generation', v => { v.conversationGeneration = 0 }],
    ['missing message proof', v => { delete v.userMessageId }],
    ['numeric conversation', v => { v.conversationId = 77 }],
    ['missing state fence', v => { delete v.stateVersion }],
    ['wrong turn scope', v => { v.turns = [{ turnId: 'turn-1', requestId: 'foreign' }] }]
  ]) {
    it(`rejects ${label} before modifying state or reading history`, async () => {
      const view = requestView(); mutate(view)
      const { hall, calls } = harness({ get: async path => { calls.push(['get', path]); return { data: view } } })
      hall.messages.value = [{ content: 'preserve previous conversation' }]
      expect(await hall.adoptBountyBootstrap(reference())).to.equal(false)
      expect(hall.activeRequest.value).to.equal(null)
      expect(hall.conversationId.value).to.equal('')
      expect(hall.messages.value[0].content).to.equal('preserve previous conversation')
      expect(calls).to.deep.equal([['get', '/requests/initial-request-1']])
    })
  }

  it('restores a real scoped durable turn as well as native execution steps', async () => {
    const view = requestView()
    view.turns = [{ turnId: 'turn-1', requestId: view.requestId, requestRevision: view.requestRevision,
      conversationId: view.conversationId, conversationGeneration: view.conversationGeneration, targetAgentId: 'agent-1',
      state: 'QUEUED', stateVersion: '0', lastDeltaSeq: '0', finalMessageId: null, createdAt: '1', updatedAt: '1' }]
    const { hall } = harness({ get: async () => ({ data: view }) })
    expect(await hall.adoptBountyBootstrap(reference())).to.equal(true)
    expect(hall.activeTurns.value[0].turnId).to.equal('turn-1')
    expect(hall.activeTurns.value[0].requestRevision).to.equal('1')
  })

  it('rejects malformed attachment IDs and numeric assignment revisions without a read', async () => {
    const { hall, calls } = harness()
    for (const value of [{ ...reference(), initialRequestId: ' padded ' },
      { ...reference(), initialRequestId: '\ud800' }, { ...reference(), assignmentRevision: 7 },
      { ...reference(), conversationId: 77 }]) {
      expect(await hall.adoptBountyBootstrap(value)).to.equal(false)
    }
    expect(calls).to.deep.equal([])
  })

  it('requires the exact bounty task and explicit Agent before making a request', async () => {
    const { hall, chatContext, selectedAgent, calls } = harness()
    chatContext.value.conversationScopeKey = 'task:foreign'
    expect(await hall.adoptBountyBootstrap(reference())).to.equal(false)
    chatContext.value = context()
    selectedAgent.value = { agentId: 'foreign' }
    expect(await hall.adoptBountyBootstrap(reference())).to.equal(false)
    expect(calls).to.deep.equal([])
  })

  it('serializes adoption and prevents concurrent send/list restoration', async () => {
    const read = deferred(); const { hall, calls } = harness({ get: async () => read.promise })
    const pending = hall.adoptBountyBootstrap(reference())
    expect(hall.isConversationBusy.value).to.equal(true)
    expect(await hall.adoptBountyBootstrap(reference())).to.equal(false)
    expect(await hall.sendHallMessage({ content: '画另一只' })).to.equal(false)
    expect(await hall.loadHallMessages({ force: true })).to.equal(false)
    read.resolve({ data: requestView() })
    expect(await pending).to.equal(true)
    expect(calls.map(call => call[0])).to.deep.equal(['content'])
  })

  for (const change of ['identity cleanup', 'auth epoch', 'scope', 'explicit target']) {
    it(`ignores a late request after ${change}`, async () => {
      const read = deferred(); const { hall, calls, apiStore, chatContext } = harness({ get: async () => read.promise })
      const pending = hall.adoptBountyBootstrap(reference())
      if (change === 'identity cleanup') stopIdentityBoundWork()
      if (change === 'auth epoch') apiStore.authorizationGeneration += 1
      if (change === 'scope') chatContext.value = { ...context(), conversationScopeKey: 'task:other', taskId: 'other' }
      if (change === 'explicit target') chatContext.value = { ...context(), targetAgentId: 'other', targetAgentIds: ['other'] }
      read.resolve({ data: requestView() })
      expect(await pending).to.equal(false)
      expect(hall.activeRequest.value).to.equal(null)
      expect(hall.conversationId.value).to.equal('')
      expect(calls).to.deep.equal([])
      expect(hall.isAdoptingBountyBootstrap.value).to.equal(false)
    })
  }

  it('retains accepted request facts after history failure and retries only reads', async () => {
    let fail = true
    const { hall, calls } = harness({ getById: async (path, id, options) => {
      calls.push(['content', path, id])
      if (fail) throw new Error('history unavailable')
      options.onSuccess({ data: [] })
    } })
    expect(await hall.adoptBountyBootstrap(reference())).to.equal(false)
    expect(hall.activeRequest.value.requestId).to.equal('initial-request-1')
    expect(hall.conversationId.value).to.equal(reference().conversationId)
    expect(hall.conversationLoadError.value).to.include('勿重复生成')
    expect(hall.isAdoptingBountyBootstrap.value).to.equal(false)
    fail = false
    expect(await hall.adoptBountyBootstrap(reference())).to.equal(true)
    expect(hall.conversationLoadError.value).to.equal('')
    expect(calls.map(call => call[0])).to.deep.equal(['get', 'content', 'get', 'content'])
  })

  it('does not interpret a 404 request read as permission to resend bootstrap', async () => {
    const { hall, calls } = harness({ get: async () => { throw Object.assign(new Error('not found'), { status: 404 }) } })
    expect(await hall.adoptBountyBootstrap(reference())).to.equal(false)
    expect(hall.activeRequest.value).to.equal(null)
    expect(calls).to.deep.equal([])
  })

  it('does not replace a newer request discovered during request loading', async () => {
    const read = deferred(); const { hall } = harness({ get: async () => read.promise })
    const pending = hall.adoptBountyBootstrap(reference())
    hall.activeRequest.value = { requestId: 'newer-request' }
    read.resolve({ data: requestView() })
    expect(await pending).to.equal(false)
    expect(hall.activeRequest.value.requestId).to.equal('newer-request')
  })

  it('does not apply a late history response over a newer request or changed target', async () => {
    const content = deferred(); const { hall } = harness({ getById: async (_path, _id, options) => {
      await content.promise; options.onSuccess({ data: [{ sender: 'USER', content: 'stale history' }] })
    } })
    const pending = hall.adoptBountyBootstrap(reference())
    await Promise.resolve(); await Promise.resolve()
    expect(hall.activeRequest.value.requestId).to.equal('initial-request-1')
    hall.activeRequest.value = { requestId: 'newer-request' }
    content.resolve()
    expect(await pending).to.equal(false)
    expect(hall.activeRequest.value.requestId).to.equal('newer-request')
    expect(hall.messages.value).to.deep.equal([])
  })

  it('does not regress confirmed request or step versions on explicit read retry', async () => {
    const { hall } = harness()
    expect(await hall.adoptBountyBootstrap(reference())).to.equal(true)
    hall.activeRequest.value = { ...hall.activeRequest.value, stateVersion: '2', state: 'RUNNING',
      steps: [{ ...hall.activeRequest.value.steps[0], stateVersion: '1', executionId: 'execution-1' }] }
    expect(await hall.adoptBountyBootstrap(reference())).to.equal(false)
    expect(hall.activeRequest.value.stateVersion).to.equal('2')
    expect(hall.activeRequest.value.steps[0].executionId).to.equal('execution-1')
  })

  it('releases only this request busy state after canonical OUTPUT_COMMITTED read, not task completion', async () => {
    let committed = false
    const { hall, selectedTask } = harness({ get: async () => {
      const view = requestView()
      if (committed) {
        view.state = 'OUTPUT_COMMITTED'; view.stateVersion = '2'
        Object.assign(view.steps[0], { state: 'OUTPUT_COMMITTED', stateVersion: '2', executionId: 'execution-1', executionState: 'RUNNING' })
      }
      return { data: view }
    } })
    expect(await hall.adoptBountyBootstrap(reference())).to.equal(true)
    expect(hall.isConversationBusy.value).to.equal(true)
    committed = true
    expect(await hall.adoptBountyBootstrap(reference())).to.equal(true)
    expect(hall.isConversationBusy.value).to.equal(false)
    expect(hall.chatConnectionStatus.value).to.equal('本轮成果已就绪')
    expect(selectedTask.value).to.deep.equal({ id: 'task-1' })
  })

  for (const invalidReadback of [false, true]) {
    it(`uses the real SSE parser to read canonical request after native media final${invalidReadback ? ' and rejects a wrong task' : ''}`, async () => {
      const originalFetch = global.fetch
      let controller
      let reads = 0
      const { hall, apiStore, calls, selectedTask } = harness({ get: async path => {
        calls.push(['get', path]); reads += 1
        const view = requestView()
        if (reads > 1) {
          view.state = 'OUTPUT_COMMITTED'; view.stateVersion = '2'
          Object.assign(view.steps[0], { state: 'OUTPUT_COMMITTED', stateVersion: '2', executionId: 'execution-1' })
          if (invalidReadback) view.steps[0].taskId = 'foreign'
        }
        return { data: view }
      } })
      apiStore.token = async () => 'token'
      global.fetch = async () => new Response(new ReadableStream({ start: value => { controller = value } }), {
        status: 200, headers: { 'Content-Type': 'text/event-stream' }
      })
      try {
        expect(await hall.adoptBountyBootstrap(reference())).to.equal(true)
        await new Promise(resolve => setImmediate(resolve))
        const event = { type: 'agent_message', requestId: 'initial-request-1', conversationId: reference().conversationId,
          messageId: '5', eventSequence: '1', eventVersion: '1', senderType: 'agent', agentId: 'agent-1',
          senderName: '好汉', content: '成果已生成', parts: [{ partId: 'part-1', revision: '1', kind: 'image',
            state: 'ready', assetId: 'asset-1', mime: 'image/png' }] }
        controller.enqueue(new TextEncoder().encode(`id: 1\ndata: ${JSON.stringify(event)}\n\n`))
        await new Promise(resolve => setImmediate(resolve))
        await new Promise(resolve => setImmediate(resolve))
        expect(reads).to.equal(2)
        expect(hall.messages.value.find(message => message.content === '成果已生成').parts[0].assetId).to.equal('asset-1')
        expect(hall.activeRequest.value.state).to.equal(invalidReadback ? 'PLANNING' : 'OUTPUT_COMMITTED')
        expect(hall.isConversationBusy.value).to.equal(invalidReadback)
        expect(selectedTask.value).to.deep.equal({ id: 'task-1' })
        expect(calls.filter(call => ['post', 'stream', 'list'].includes(call[0]))).to.deep.equal([])
      } finally {
        hall.disposeHallConversation()
        // The authenticated transport owns cancellation; dispose already closes its reader.
        global.fetch = originalFetch
      }
    })
  }

  for (const eventScope of ['current', 'foreign-conversation', 'historical-request']) {
    it(`real SSE execution_abandoned ${eventScope} is only a scoped authoritative readback hint`, async () => {
      const originalFetch = global.fetch
      let controller; let reads = 0
      const { hall, apiStore, calls, selectedTask } = harness({ get: async path => {
        calls.push(['get', path]); reads++
        const view = requestView()
        const cancelled = eventScope === 'current' && reads > 1
        Object.assign(view, { state: cancelled ? 'CANCELLED' : 'RUNNING', stateVersion: cancelled ? '1' : '0' })
        Object.assign(view.steps[0], { state: cancelled ? 'CANCELLED' : 'RUNNING', stateVersion: cancelled ? '3' : '2',
          executionId: 'execution-1', executionState: cancelled ? 'CANCELLED' : 'RUNNING' })
        return { data: view }
      } })
      apiStore.token = async () => 'token'
      global.fetch = async () => new Response(new ReadableStream({ start: value => { controller = value } }), {
        status: 200, headers: { 'Content-Type': 'text/event-stream' }
      })
      try {
        expect(await hall.adoptBountyBootstrap(reference())).to.equal(true)
        await new Promise(resolve => setImmediate(resolve))
        // History rehydration may assign a fresh presentation timestamp, not a new message.
        const messageFacts = () => hall.messages.value.map(({ localId, sender, content, parts }) => ({ localId, sender, content, parts }))
        const beforeMessages = messageFacts()
        const event = { type: 'execution_abandoned',
          conversationId: eventScope === 'foreign-conversation' ? '43' : reference().conversationId,
          requestId: eventScope === 'historical-request' ? 'older-request' : reference().initialRequestId,
          stepId: 'step-1', eventSequence: '1', eventVersion: '1', receipt: { state: 'CANCELLED' } }
        controller.enqueue(new TextEncoder().encode(`id: 1\ndata: ${JSON.stringify(event)}\n\n`))
        await new Promise(resolve => setImmediate(resolve))
        await new Promise(resolve => setImmediate(resolve))
        // A foreign-conversation frame is rejected by the parser and resyncs the CURRENT scope.
        // This existing recovery must not be mistaken for accepting the foreign receipt.
        expect(reads).to.equal(eventScope === 'historical-request' ? 1 : 2)
        expect(calls.filter(call => call[0] === 'get').every(call => call[1] === '/requests/initial-request-1')).to.equal(true)
        expect(calls.filter(call => call[0] === 'content').every(call => call[2] === reference().conversationId)).to.equal(true)
        expect(hall.activeRequest.value.state).to.equal(eventScope === 'current' ? 'CANCELLED' : 'RUNNING')
        expect(hall.isConversationBusy.value).to.equal(eventScope !== 'current')
        expect(messageFacts()).to.deep.equal(beforeMessages)
        expect(selectedTask.value).to.deep.equal({ id: 'task-1' })
        expect(calls.filter(call => ['post', 'stream', 'list'].includes(call[0]))).to.deep.equal([])
      } finally {
        hall.disposeHallConversation(); global.fetch = originalFetch
      }
    })
  }

  it('never adopts the old bootstrap after a different active request exists', async () => {
    const { hall, calls } = harness()
    hall.activeRequest.value = { requestId: 'newer-request', state: 'COMPLETED' }
    expect(await hall.adoptBountyBootstrap(reference())).to.equal(false)
    expect(calls).to.deep.equal([])
  })
})
