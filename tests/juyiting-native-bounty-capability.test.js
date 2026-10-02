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
import { createControlledImageCapabilityObservationFence } from '../src/composables/juyiting/hallControlledImageBountyCapability.js'

const capability = (overrides = {}) => ({
  schemaVersion: 1,
  taskId: 'task-1',
  targetAgentId: 'agent-1',
  lane: 'ORDINARY_SINGLE_AGENT_ASSIGN_AND_START',
  serverLane: { state: 'READY', blockingReasons: [] },
  nativeExecution: { state: 'READY', transport: 'PERSONAL_WORKSPACE_CONVERSATION_HTTP_V1', schemaVersion: 1, supportedOperations: ['GENERATE_IMAGE'] },
  authorization: { state: 'UNAVAILABLE', paidExecutionAuthorized: false },
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
  })

  it('has a conditional future new-start path only for a coherent legitimate server response', () => {
    const parsed = parseNativeBountyCapability(capability({
      authorization: { state: 'READY', paidExecutionAuthorized: true },
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
    ['UNAVAILABLE paid-looking authority', value => { value.authorization.paidExecutionAuthorized = true }],
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

  it('keeps the actual Hall script and template compilable with the shared resolver wiring', () => {
    const parsed = parse(page, { filename: 'JuyiHall.vue' })
    expect(parsed.errors).to.deep.equal([])
    const script = compileScript(parsed.descriptor, { id: 'task-linked-reference-hall' })
    expect(script.content).to.include('useHallTaskLinkedReferenceInputs')
    const template = compileTemplate({ id: 'task-linked-reference-hall', filename: 'JuyiHall.vue', source: parsed.descriptor.template.content })
    expect(template.errors).to.deep.equal([])
  })

  it('wires native capability, exact persisted recovery, authoritative refs, and no first-turn resend into the real page', () => {
    for (const text of [
      'loadNativeBountyCapability({ agentApi, taskId, targetAgentId })',
      'capabilityAllowsNewStart(pointAndStartCapability.value, task, agent)',
      'capabilityAllowsOriginalReplay(pointAndStartCapability.value, task?.id, agent?.agentId)',
      'useHallTaskLinkedReferenceInputs',
      'pointAndStartReferenceInputs.resolve({',
      'inputRefs: referenceInputs.inputRefs',
      'pointAndStartIntentReadLane(original)',
      'hallIdentityScope, () => selectedAgent.value?.agentId], clearPointAndStartCapability',
      'if (!observation.isCurrent() || task.id !== clickedTaskId || target.agentId !== clickedTargetId) return false',
      'original.state === \'PRESENT\' || original.state === \'CORRUPT\'',
      'await checkPointAndStartOriginal(task)',
      'return adoptBountyBootstrap(reference)',
      'disposePointAndStart()'
    ]) expect(page).to.include(text)
    const assignTask = page.match(/const assignTask = async \(task, agent\) => \{([\s\S]*?)\n\}/)?.[1] || ''
    expect(assignTask).not.to.include('multimediaDeliberationUiEnabled')
    expect(panel).to.include("$emit('check-point-and-start', detailTask)")
    expect(panel).to.include("$emit('resume-point-and-start', detailTask)")
    expect(panel).to.include('不会另建点将或改走旧式点将')
  })
})

// Execute the actual page assignment closure with boundary dependencies. This
// verifies write routing, not a full Vue mount/browser/Provider acceptance.
const actualAssign = page.match(/const assignTask = async \(task, agent\) => \{([\s\S]*?)\n\}\n\nwatch\(/)?.[1]
if (!actualAssign) throw new Error('Actual JuyiHall assignment closure not found')
const pageHarness = ({ original = { state: 'ABSENT' }, offer = null, defer = false, referenceResult = { state: 'READY', inputRefs: [] }, deferReferences = false } = {}) => {
  const h = { identity: 'owner-1', auth: 1, legacy: [], native: [], reads: [], catalog: [], checks: [], toasts: [] }
  const observation = createNativeCapabilityObservationFence({ getIdentityScope: () => h.identity, getAuthorizationGeneration: () => h.auth })
  const controlledObservation = createControlledImageCapabilityObservationFence({ getIdentityScope: () => h.identity, getAuthorizationGeneration: () => h.auth })
  h.invalidate = () => { observation.invalidate(); controlledObservation.invalidate() }
  const deps = {
    pointAndStartIntentState: () => original,
    controlledImageObservation: controlledObservation,
    // Existing native-lane tests must pass an explicit disabled controlled-lane
    // observation before they exercise the legacy/native branch. This preserves
    // the production ordering and makes the late native capability read observable.
    readControlledImageCapability: async () => ({ controlledObservation: 'UNDECLARED' }),
    capabilityOffersControlledImageConsent: () => false,
    pointAndStartIntentReadLane,
    showToast: message => h.toasts.push(message),
    checkPointAndStartOriginal: async task => { h.checks.push(task.id) },
    economyPreviewEnabled: { value: true },
    canAssign: () => true,
    pointAndStartObservation: observation,
    readPointAndStartCapability: async (taskId, targetAgentId) => {
      h.reads.push({ taskId, targetAgentId })
      if (defer) return new Promise(resolve => { h.resolve = () => resolve(offer) })
      return offer
    },
    canUsePointAndStartOffer: (task, agent) => capabilityAllowsNewStart(offer, task, agent),
    pointAndStartReferenceInputs: { resolve: async request => {
      h.catalog.push(request)
      if (deferReferences) return new Promise(resolve => { h.resolveReferences = () => resolve(request.isCurrent() ? referenceResult : { state: 'STALE', inputRefs: [] }) })
      return request.isCurrent() ? referenceResult : { state: 'STALE', inputRefs: [] }
    } },
    startPointAndStart: async intent => { h.native.push(intent); return true },
    explainPointAndStartState: () => 'pending',
    taskWorkspaceBinding: { clearExplicitActor: () => {} },
    runAssignTask: async (task, agent) => { h.legacy.push({ taskId: task.id, agent }); return true },
    tasks: { value: [] },
    markTaskAssigned: () => {}
  }
  h.assign = new Function(...Object.keys(deps), `return async (task, agent) => {${actualAssign}}`)(...Object.values(deps))
  return h
}

describe('actual JuyiHall native assignment routing closure', () => {
  for (const change of ['auth', 'identity', 'selection', 'target']) {
    it(`does not fall through to legacy/native writes after a late ${change} change`, async () => {
      const h = pageHarness({ defer: true })
      const task = { id: 'task-1' }; const agent = { agentId: 'agent-1' }
      const pending = h.assign(task, agent)
      // The controlled-lane observation is awaited first in the real closure;
      // yield only until the native capability read has installed its deferred
      // resolver, then mutate the exact fence under test.
      await Promise.resolve(); await Promise.resolve()
      if (change === 'auth') h.auth++
      if (change === 'identity') h.identity = 'owner-2'
      if (change === 'selection') h.invalidate()
      if (change === 'target') agent.agentId = 'agent-2'
      h.resolve()
      expect(await pending).to.equal(false)
      expect(h.legacy).to.have.length(0)
      expect(h.native).to.have.length(0)
    })
  }

  it('cannot treat unavailable original storage as an absent request', async () => {
    const h = pageHarness({ original: { state: 'UNAVAILABLE' } })
    expect(await h.assign({ id: 'task-1' }, { agentId: 'agent-1' })).to.equal(false)
    expect(h.reads).to.have.length(0)
    expect(h.catalog).to.have.length(0)
    expect(h.legacy).to.have.length(0)
    expect(h.native).to.have.length(0)
  })

  it('honors the durable original before funded or multi-agent lane checks', async () => {
    const h = pageHarness({ original: { state: 'PRESENT' } })
    expect(await h.assign({ id: 'task-1', funding: { mode: 'FUNDED_SINGLE_AGENT' } }, [{ agentId: 'agent-1' }, { agentId: 'agent-2' }])).to.equal(false)
    expect(h.checks).to.deep.equal(['task-1'])
    expect(h.reads).to.have.length(0)
    expect(h.catalog).to.have.length(0)
    expect(h.legacy).to.have.length(0)
    expect(h.native).to.have.length(0)
  })

  it('reports a declared native target missing legitimate cost authority instead of silently doing legacy assignment', async () => {
    const h = pageHarness({ offer: parseNativeBountyCapability(capability()) })
    expect(await h.assign({ id: 'task-1' }, { agentId: 'agent-1' })).to.equal(false)
    expect(h.legacy).to.have.length(0)
    expect(h.native).to.have.length(0)
    expect(h.toasts.join()).to.include('费用授权')
  })

  it('preserves a clearly described legacy-only lane for an undeclared older target', async () => {
    const offer = parseNativeBountyCapability(capability({ nativeExecution: { state: 'UNDECLARED', transport: null, schemaVersion: null, supportedOperations: [] }, requestedOperations: [], initialOperation: null }))
    const h = pageHarness({ offer })
    expect(await h.assign({ id: 'task-1' }, { agentId: 'agent-1' })).to.equal(true)
    expect(h.legacy).to.have.length(1)
    expect(h.native).to.have.length(0)
    expect(h.toasts.join()).to.include('不会自动生成或交付')
  })

  it('uses the explicit clicked task/target and resolved exact references for one coherent authorized intent', async () => {
    const offer = parseNativeBountyCapability(capability({ inputRefsPolicy: 'TASK_LINKED_REFERENCE',
      authorization: { state: 'READY', paidExecutionAuthorized: true }, newStart: { eligible: true, blockingReasons: [] } }))
    const inputRefs = [{ fileId: 'image-1', version: 2, purpose: 'REFERENCE' }]
    const h = pageHarness({ offer, referenceResult: { state: 'READY', inputRefs } })
    expect(await h.assign({ id: 'task-1' }, { agentId: 'agent-1' })).to.equal(true)
    expect(h.legacy).to.have.length(0)
    expect(h.catalog).to.have.length(1)
    expect(h.catalog[0].taskId).to.equal('task-1')
    expect(h.catalog[0].inputRefsPolicy).to.equal('TASK_LINKED_REFERENCE')
    expect(h.native).to.have.length(1)
    expect(h.native[0].task.id).to.equal('task-1')
    expect(h.native[0].agent.agentId).to.equal('agent-1')
    expect(h.native[0].inputRefs).to.deep.equal(inputRefs)
    expect(h.toasts.join()).to.include('1 张任务参考图的精确版本')
  })

  it('does not fall back to legacy or empty refs when authoritative reference resolution fails', async () => {
    const offer = parseNativeBountyCapability(capability({ inputRefsPolicy: 'TASK_LINKED_REFERENCE',
      authorization: { state: 'READY', paidExecutionAuthorized: true }, newStart: { eligible: true, blockingReasons: [] } }))
    const h = pageHarness({ offer, referenceResult: { state: 'BLOCKED', reason: 'CATALOG_UNAVAILABLE', inputRefs: [] } })
    expect(await h.assign({ id: 'task-1' }, { agentId: 'agent-1' })).to.equal(false)
    expect(h.native).to.have.length(0)
    expect(h.legacy).to.have.length(0)
    expect(h.toasts).to.deep.equal(['参考资料未能核对，未办理。'])
  })

  it('fences a late reference catalog on authorization change before any native or legacy write', async () => {
    const offer = parseNativeBountyCapability(capability({ inputRefsPolicy: 'TASK_LINKED_REFERENCE',
      authorization: { state: 'READY', paidExecutionAuthorized: true }, newStart: { eligible: true, blockingReasons: [] } }))
    const h = pageHarness({ offer, deferReferences: true, referenceResult: { state: 'READY', inputRefs: [{ fileId: 'image-1', version: 2, purpose: 'REFERENCE' }] } })
    const pending = h.assign({ id: 'task-1' }, { agentId: 'agent-1' })
    await Promise.resolve(); await Promise.resolve()
    h.auth += 1
    h.resolveReferences()
    expect(await pending).to.equal(false)
    expect(h.native).to.have.length(0)
    expect(h.legacy).to.have.length(0)
  })
})
