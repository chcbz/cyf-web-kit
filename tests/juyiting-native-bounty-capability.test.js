import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import {
  capabilityAllowsNewStart,
  capabilityAllowsOriginalReplay,
  createNativeCapabilityObservationFence,
  pointAndStartIntentReadLane,
  loadNativeBountyCapability,
  parseNativeBountyCapability
} from '../src/composables/juyiting/hallNativeBountyCapability.js'

const capability = (overrides = {}) => ({
  schemaVersion: 3,
  taskId: 'task-1',
  targetAgentId: 'agent-1',
  lane: 'ORDINARY_SINGLE_AGENT_ASSIGN_AND_START',
  serverLane: { state: 'READY', blockingReasons: [] },
  nativeExecution: { state: 'READY', transport: 'PERSONAL_WORKSPACE_CONVERSATION_HTTP_V1', schemaVersion: 1, supportedOperations: ['GENERATE_IMAGE'] },
  executionAuthorization: { state: 'UNAVAILABLE', paidExecutionAuthorized: false },
  newStart: { eligible: false, blockingReasons: ['COST_AUTHORIZATION_UNAVAILABLE'] },
  requestedOperations: ['GENERATE_IMAGE'],
  initialOperation: 'GENERATE_IMAGE',
  inputRefsPolicy: 'EMPTY_ONLY',
  originalIntentRecovery: {
    legacyFallbackAllowed: false,
    unknownOrNotFoundMeans: 'RECOVERY_REQUIRED',
    replayPolicy: 'EXPLICIT_USER_EXACT_ORIGINAL_KEY_AND_BODY_ONLY'
  },
  ...overrides
})
const page = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
const panel = readFileSync(new URL('../src/components/juyiting/BountyPanel.vue', import.meta.url), 'utf8')

describe('native bounty capability contract', () => {
  it('accepts the current no-cost new-start-false response but keeps exact original replay separately available', () => {
    const parsed = parseNativeBountyCapability(capability())
    expect(parsed).not.to.equal(null)
    expect(capabilityAllowsNewStart(parsed, { id: 'task-1' }, { agentId: 'agent-1' })).to.equal(false)
    expect(capabilityAllowsOriginalReplay(parsed, 'task-1', 'agent-1')).to.equal(true)
    const legacyAuthorization = capability(); legacyAuthorization.authorization = legacyAuthorization.executionAuthorization; delete legacyAuthorization.executionAuthorization
    expect(parseNativeBountyCapability(legacyAuthorization)).to.equal(null)
    const legacySchema = capability({ schemaVersion: 1 })
    expect(parseNativeBountyCapability(legacySchema)).to.equal(null)
    expect(parseNativeBountyCapability(null)).to.equal(null)
  })

  it('has a conditional future new-start path only for a coherent legitimate server response', () => {
    const parsed = parseNativeBountyCapability(capability({
      executionAuthorization: { state: 'READY', paidExecutionAuthorized: true },
      newStart: { eligible: true, blockingReasons: [] }
    }))
    expect(parsed).not.to.equal(null)
    expect(capabilityAllowsNewStart(parsed, { id: 'task-1' }, { agentId: 'agent-1' })).to.equal(true)
  })

  it('accepts only the two frozen input policies without treating either as fee authority', () => {
    for (const inputRefsPolicy of ['EMPTY_ONLY', 'TASK_LINKED_REFERENCE']) {
      const parsed = parseNativeBountyCapability(capability({ inputRefsPolicy }))
      expect(parsed?.inputRefsPolicy).to.equal(inputRefsPolicy)
      expect(capabilityAllowsNewStart(parsed, { id: 'task-1' }, { agentId: 'agent-1' })).to.equal(false)
    }
  })

  for (const [name, mutate] of [
    ['fast transport', value => { value.nativeExecution.transport = 'FAST_CHAT_EXECUTE' }],
    ['EDIT advertisement', value => { value.nativeExecution.supportedOperations = ['EDIT_IMAGE'] }],
    ['unknown input policy', value => { value.inputRefsPolicy = 'LATEST_OR_DRAFT' }],
    ['paid-looking start without authorization', value => { value.newStart = { eligible: true, blockingReasons: [] } }],
    ['legacy fallback permission', value => { value.originalIntentRecovery.legacyFallbackAllowed = true }]
  ]) it(`rejects ${name}`, () => {
    const value = capability(); mutate(value)
    expect(parseNativeBountyCapability(value)).to.equal(null)
  })

  for (const [name, overrides] of [
    ['offline native lane', { nativeExecution: { state: 'OFFLINE', transport: null, schemaVersion: null, supportedOperations: [] }, requestedOperations: [], initialOperation: null }],
    ['stopped server lane', { serverLane: { state: 'NOT_RUNNING', blockingReasons: ['SERVER_NOT_RUNNING'] } }]
  ]) it(`rejects TASK_LINKED_REFERENCE with a contradictory ${name}`, () => {
    expect(parseNativeBountyCapability(capability({ inputRefsPolicy: 'TASK_LINKED_REFERENCE', ...overrides }))).to.equal(null)
  })

  for (const state of ['OFFLINE', 'UNDECLARED', 'DISABLED', 'UNSUPPORTED', 'AMBIGUOUS']) {
    it(`preserves truthful ${state} null native metadata without advertising a new start`, () => {
      const parsed = parseNativeBountyCapability(capability({
        nativeExecution: { state, transport: null, schemaVersion: null, supportedOperations: [] },
        requestedOperations: [], initialOperation: null
      }))
      expect(parsed).not.to.equal(null)
      expect(parsed.nativeExecution.transport).to.equal(null)
      expect(parsed.nativeExecution.schemaVersion).to.equal(null)
      expect(capabilityAllowsNewStart(parsed, { id: 'task-1' }, { agentId: 'agent-1' })).to.equal(false)
      expect(capabilityAllowsOriginalReplay(parsed, 'task-1', 'agent-1')).to.equal(true)
    })
  }

  for (const [name, mutate] of [
    ['READY without native declaration', value => { value.nativeExecution.transport = null; value.nativeExecution.schemaVersion = null }],
    ['READY without supported operation', value => { value.nativeExecution.supportedOperations = [] }],
    ['mixed null/native declaration', value => { value.nativeExecution.schemaVersion = null }],
    ['UNAVAILABLE paid-looking authority', value => { value.executionAuthorization.paidExecutionAuthorized = true }],
    ['requested operation without actual support', value => { value.nativeExecution = { state: 'UNDECLARED', transport: null, schemaVersion: null, supportedOperations: [] } }],
    ['requested operation missing exact initial action', value => { value.initialOperation = null }]
  ]) it(`rejects ${name}`, () => {
    const value = capability(); mutate(value)
    expect(parseNativeBountyCapability(value)).to.equal(null)
  })

  it('invalidates late reads after another target request, selection change, auth generation or identity switch', () => {
    let identity = 'owner-1'
    let generation = 1
    const fence = createNativeCapabilityObservationFence({ getIdentityScope: () => identity, getAuthorizationGeneration: () => generation })
    const first = fence.capture()
    const otherTarget = fence.capture()
    expect(first.isCurrent()).to.equal(false)
    expect(otherTarget.isCurrent()).to.equal(true)
    fence.invalidate()
    expect(otherTarget.isCurrent()).to.equal(false)
    const authRead = fence.capture(); generation++
    expect(authRead.isCurrent()).to.equal(false)
    const identityRead = fence.capture(); identity = 'owner-2'
    expect(identityRead.isCurrent()).to.equal(false)
  })

  it('does not consider inaccessible or corrupt original storage to be an absent intent', () => {
    expect(pointAndStartIntentReadLane({ state: 'ABSENT' })).to.equal('NONE')
    for (const state of ['PRESENT', 'CORRUPT']) expect(pointAndStartIntentReadLane({ state })).to.equal('RECOVERY')
    for (const value of [{ state: 'UNAVAILABLE' }, null, { state: 'UNKNOWN' }]) expect(pointAndStartIntentReadLane(value)).to.equal('UNAVAILABLE')
  })

  it('uses the single frozen lookup query and rejects a response for another exact target', async () => {
    const calls = []
    const agentApi = { get: async (path, query, options) => {
      calls.push({ path, query, options })
      return { data: { data: capability() } }
    } }
    const parsed = await loadNativeBountyCapability({ agentApi, taskId: 'task-1', targetAgentId: 'agent-1' })
    expect(parsed?.taskId).to.equal('task-1')
    expect(calls[0].path).to.equal('/tasks/task-1/point-and-start-capability')
    expect(calls[0].query).to.deep.equal({ targetAgentId: 'agent-1' })
    expect(calls[0].options.autoLoading).to.equal(false)
    const mismatched = await loadNativeBountyCapability({
      agentApi: { get: async () => ({ data: { data: capability({ targetAgentId: 'other-agent' }) } }) },
      taskId: 'task-1', targetAgentId: 'agent-1'
    })
    expect(mismatched).to.equal(null)
  })

  it('actual Hall compiles with generic point-and-deliberate instead of drawing preflight', () => {
    const parsed = parse(page, { filename: 'JuyiHall.vue' })
    expect(parsed.errors).to.deep.equal([])
    const script = compileScript(parsed.descriptor, { id: 'generic-point-hall' })
    expect(script.content).not.to.include('useHallTaskLinkedReferenceInputs')
    expect(script.content).not.to.include('loadControlledImageBountyCapability')
    expect(script.content).not.to.include('loadNativeBountyCapability')
    expect(compileTemplate({ id: 'generic-point-hall', filename: 'JuyiHall.vue', source: parsed.descriptor.template.content }).errors).to.deep.equal([])
    expect(panel).not.to.include('confirm-controlled-image-consent')
    expect(panel).not.to.include('本入口当前仅支持空资料')
    expect(panel).to.include("$emit('check-point-and-start', detailTask)")
  })
})

// Execute the real page closure with recording boundaries, not a copied handler.
const actualAssign = page.match(/const assignTask = async \(task, agent\) => \{([\s\S]*?)\n\}\n\nwatch\(/)?.[1]
if (!actualAssign) throw new Error('Actual JuyiHall assignment closure not found')
const pageHarness = ({ original = { state: 'ABSENT' }, started = true, status = 'ATTACHED', economy = false } = {}) => {
  const calls = []; const deps = {
    pointAndStartIntentState: () => original, pointAndStartIntentReadLane,
    showToast: text => calls.push(['toast', text]), checkPointAndStartOriginal: async task => calls.push(['check', task.id]),
    economyPreviewEnabled: { value: economy }, canAssign: (task, agent) => task.status === 'open' && agent.canOperate !== false,
    startPointAndStart: async value => { calls.push(['generic', value]); return started },
    pointAndStartState: { value: { status } }, observePointAndStart: id => calls.push(['observe', id]),
    explainPointAndStartState: () => '核对原点将', taskWorkspaceBinding: { clearExplicitActor: () => {} },
    runAssignTask: async (task, target) => { calls.push(['other-workflow', task, target]); return true },
    tasks: { value: [] }, markTaskAssigned: () => {}
  }
  return { calls, assign: new Function(...Object.keys(deps), `return async (task, agent) => {${actualAssign}}`)(...Object.values(deps)) }
}

describe('actual page generic point routing', () => {
  const task = () => ({ id: 'task-1', status: 'open' })
  const target = () => ({ agentId: 'explicit-agent', canOperate: true })
  it('ordinary explicit target always enters generic discussion without image/provider preflight', async () => {
    const h = pageHarness(); const t = task(); const a = target()
    expect(await h.assign(t, a)).to.equal(true)
    expect(h.calls).to.deep.equal([['generic', { task: t, agent: a }]])
  })
  it('a generic admission error never falls back to an old assignment', async () => {
    const h = pageHarness({ started: false, status: 'UNKNOWN' })
    expect(await h.assign(task(), target())).to.equal(false)
    expect(h.calls.filter(c => c[0] === 'generic')).to.have.length(1)
    expect(h.calls.some(c => c[0] === 'other-workflow')).to.equal(false)
  })
  it('pending bootstrap starts read-only observation for the same task', async () => {
    const h = pageHarness({ status: 'PREPARING' })
    expect(await h.assign(task(), target())).to.equal(true)
    expect(h.calls.at(-1)).to.deep.equal(['observe', 'task-1'])
  })
  it('acknowledged pending admission still observes after a transient GET failure without resending', async () => {
    const h = pageHarness({ started: false, status: 'PREPARING' })
    expect(await h.assign(task(), target())).to.equal(false)
    expect(h.calls.filter(c => c[0] === 'generic')).to.have.length(1)
    expect(h.calls.at(-1)).to.deep.equal(['observe', 'task-1'])
    expect(h.calls.some(c => c[0] === 'other-workflow')).to.equal(false)
  })
  for (const state of ['PRESENT', 'CORRUPT', 'UNAVAILABLE']) it(`${state} original cannot be bypassed by fresh point`, async () => {
    const h = pageHarness({ original: { state } })
    expect(await h.assign(task(), target())).to.equal(false)
    expect(h.calls.some(c => ['generic', 'other-workflow'].includes(c[0]))).to.equal(false)
    if (state === 'PRESENT') expect(h.calls).to.deep.equal([['check', 'task-1']])
  })
  it('missing explicit target, denied roster authority or stale task never writes', async () => {
    const h = pageHarness()
    for (const [t, a] of [[task(), null], [task(), {}], [task(), { ...target(), canOperate: false }], [{ ...task(), status: 'assigned' }, target()]]) {
      expect(await h.assign(t, a)).to.equal(false)
    }
    expect(h.calls).to.deep.equal([])
  })
  it('funded and multi-agent workflows are not silently turned into ordinary grants', async () => {
    const h = pageHarness({ economy: true }); const a = target()
    expect(await h.assign({ ...task(), funding: { mode: 'FUNDED_SINGLE_AGENT' } }, a)).to.equal(true)
    expect(await h.assign(task(), [a, { agentId: 'second' }])).to.equal(true)
    expect(h.calls.map(c => c[0])).to.deep.equal(['other-workflow', 'other-workflow'])
  })
})
