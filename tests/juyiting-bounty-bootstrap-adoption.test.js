import { expect } from 'chai'
import { ref } from 'vue'
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

  it('never adopts the old bootstrap after a different active request exists', async () => {
    const { hall, calls } = harness()
    hall.activeRequest.value = { requestId: 'newer-request', state: 'COMPLETED' }
    expect(await hall.adoptBountyBootstrap(reference())).to.equal(false)
    expect(calls).to.deep.equal([])
  })
})
