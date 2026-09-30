import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import {
  capabilityAllowsNewStart,
  capabilityAllowsOriginalReplay,
  loadNativeBountyCapability,
  parseNativeBountyCapability
} from '../src/composables/juyiting/hallNativeBountyCapability.js'

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

  for (const [name, mutate] of [
    ['fast transport', value => { value.nativeExecution.transport = 'FAST_CHAT_EXECUTE' }],
    ['EDIT advertisement', value => { value.nativeExecution.supportedOperations = ['EDIT_IMAGE'] }],
    ['reference input policy', value => { value.inputRefsPolicy = 'TASK_LINKED_REFERENCE' }],
    ['paid-looking start without authorization', value => { value.newStart = { eligible: true, blockingReasons: [] } }],
    ['legacy fallback permission', value => { value.originalIntentRecovery.legacyFallbackAllowed = true }]
  ]) it(`rejects ${name}`, () => {
    const value = capability(); mutate(value)
    expect(parseNativeBountyCapability(value)).to.equal(null)
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

  it('wires native capability, exact persisted recovery, empty refs, and no first-turn resend into the real page', () => {
    for (const text of [
      'loadNativeBountyCapability({ agentApi, taskId, targetAgentId })',
      'capabilityAllowsNewStart(pointAndStartCapability.value, task, agent)',
      'capabilityAllowsOriginalReplay(pointAndStartCapability.value, task?.id, agent?.agentId)',
      'inputRefs: []',
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
