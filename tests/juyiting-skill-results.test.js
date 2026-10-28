import { displayFixture } from './fixtures/juyiting/interface-display-fixture.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { effectScope, ref } from 'vue'
import { skillCapabilityProjection, skillCostInfo, skillCostText } from '../src/composables/juyiting/hallSkillCapabilities.js'
import { skillResultReferences, skillResultProjection, skillResultDataText } from '../src/composables/juyiting/hallSkillResults.js'
import { useHallSkillCapabilities } from '../src/composables/juyiting/useHallSkillCapabilities.js'
import { useHallSkillResults } from '../src/composables/juyiting/useHallSkillResults.js'
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/skill-v4/action-v4.json', import.meta.url)))
const context = { conversationId: '1', conversationGeneration: '1', taskId: 'task' }
const outcome = () => displayFixture({ schemaVersion: 4, route: 'CHAT', conversationId: context.conversationId, conversationGeneration: context.conversationGeneration, requestId: 'req', requestRevision: '1', turnId: 'turn', state: 'READY', inspection: null,
  outcome: { outcomeContractVersion: 4, outcomeId: 'outcome', taskId: 'task', assignmentRevision: '1', assistantMessageId: '2', finalDigest: fixture.final.finalDigest,
    ...Object.fromEntries(Object.entries(fixture.final.outcome).filter(([key]) => key !== 'schemaVersion')),
    action: { ...fixture.final.outcome.action, actionRequestId: 'event' } },
  actionProgress: { actionRequestId: 'event', state: 'ARCHIVING', dispatchVersion: '1', childRequestId: 'child', childRoute: 'EXECUTE', childStateVersion: '2', executionId: 'pwe_test', executionStateVersion: '3', phase: 'ARCHIVING', resultSha256: 'a'.repeat(64) } })
const expected = () => skillResultReferences([outcome()], context)[0]
const result = () => ({ schemaVersion: 2, executionStateVersion: '4', ...context, requestId: 'child', stepId: 'step', executionId: 'pwe_test', state: 'RESULT_COMMITTED', phase: 'COMPLETE', resultSha256: 'a'.repeat(64), data: ['真实数据', { text: '<script>not html</script>' }], outputs: [] })
const drain = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const directory = { catalogRevision: 'catalog_1', items: [{ skillKey: 'analysis.new', skillVersion: '1', title: '分析', state: 'CALLABLE', reasonCode: null, costInfo: { mode: 'UNKNOWN' } }] }
describe('SE2 scoped directory and generic data-only result consumers', () => {
  it('does not confuse unknown costs, package price or runtime ready with callable permission', () => {
    assert.equal(skillCostInfo({ mode: 'FIXED', amount: 10 }).mode, 'UNKNOWN')
    assert.match(skillCostText(null), /不等于免费/)
    assert.match(skillCostText({ mode: 'FIXED', amount: '0.20', currency: 'CNY' }), /非平台实扣/)
    assert.equal(skillCapabilityProjection(directory).items[0].state, 'CALLABLE')
    assert.equal(skillCapabilityProjection({ ...directory, token: 'secret' }), null)
    assert.equal(skillCapabilityProjection({ ...directory, items: [{ ...directory.items[0], state: 'RUNTIME_READY' }] }), null)
  })
  it('derives an exact execution reference without discovering history or guessing IDs', () => {
    assert.equal(expected().executionId, 'pwe_test')
    assert.equal(expected().requestId, 'child')
    assert.equal(skillResultReferences([{ ...outcome(), purpose: 'CHAT', key: 'ui-key' }], context)[0].executionId, 'pwe_test')
    assert.equal(skillResultReferences([outcome()], { ...context, conversationGeneration: '2' }).length, 0)
    const wrong = outcome(); wrong.outcome.action.operation = 'INSPECT_INPUTS'
    assert.equal(skillResultReferences([wrong], context).length, 0)
  })
  it('reads v5 skill results with the same exact execution binding as v4', async () => {
    const v5 = outcome(); v5.outcome.outcomeContractVersion = 5; v5.outcome.deliverable = false
    assert.equal(skillResultReferences([v5], context)[0]?.executionId, 'pwe_test')
    assert.equal(skillResultReferences([v5], { ...context, taskId: 'other' }).length, 0)
    const calls = []; const scope = effectScope(); let service
    scope.run(() => { service = useHallSkillResults({ api: { get: async (...args) => { calls.push(args); return result() } },
      getContext: () => context, getOutcomes: () => [v5], identityKey: () => 'owner', enabled: () => true }) })
    try {
      await drain()
      assert.equal(calls[0][0], '/conversations/1/executions/pwe_test/result')
      assert.equal(service.results.value[0].complete, true)
    } finally { service.dispose(); scope.stop() }
    v5.outcome.outcomeContractVersion = 99
    assert.equal(skillResultReferences([v5], context).length, 0)
  })
  it('permits arbitrary JSON data without fabricating a file or accepting the task', () => {
    const value = skillResultProjection(result(), expected())
    assert.equal(value.complete, true); assert.deepEqual(value.outputs, []); assert.deepEqual(value.data, result().data)
    assert.match(skillResultDataText(value.data), /<script>/)
    assert.equal(skillResultDataText('文本'), '文本')
    assert.equal(Object.hasOwn(skillResultProjection({ ...result(), diagnosticId: 'metadata' }, expected()), 'diagnosticId'), false)
  })
  it('does not declare complete before persisted projection or permit cross-scope result substitution', () => {
    const pending = skillResultProjection({ ...result(), phase: 'ARCHIVING', data: null }, expected())
    assert.equal(pending.complete, false); assert.equal(pending.data, null); assert.deepEqual(pending.outputs, [])
    for (const field of ['conversationId', 'conversationGeneration', 'taskId', 'requestId', 'executionId', 'resultSha256'])
      assert.equal(skillResultProjection({ ...result(), [field]: 'wrong' }, expected()), null, field)
    assert.equal(skillResultProjection({ ...result(), state: 'RUNNING' }, expected()), null)
  })
  it('allows unknown MIME only through exact opaque attachment URLs', () => {
    const item = { outputId: 'out', sha256: 'b'.repeat(64), byteLength: '8', contentMimeType: 'application/x-special', previewUrl: null,
      downloadUrl: '/chat/requests/child/steps/step/outputs/out?download=true', assetRef: null, replaces: null }
    assert.equal(skillResultProjection({ ...result(), outputs: [item] }, expected()).outputs.length, 1)
    assert.equal(skillResultProjection({ ...result(), outputs: [{ ...item, previewUrl: 'https://external' }] }, expected()), null)
  })
  it('directory performs GET only and discards results after owner/auth/context changes', async () => {
    const identity = ref('owner:a:auth1'); let resolve; const calls = []
    const scope = effectScope(); let service
    scope.run(() => { service = useHallSkillCapabilities({ api: { get: (...args) => { calls.push(args); return new Promise(done => { resolve = done }) } },
      getContext: () => ({ taskId: 'task', targetAgentId: 'agent' }), identityKey: () => identity.value, enabled: () => true }) })
    assert.equal(calls[0][0], '/tasks/task/skill-capabilities')
    const old = resolve; identity.value = 'owner:b:auth2'; old((directory)); await drain()
    assert.equal(service.projection.value, null); assert.equal(calls[0][2].signal.aborted, true)
    resolve((directory)); await drain(); assert.equal(service.projection.value.items[0].state, 'CALLABLE')
    service.dispose(); scope.stop()
  })
  it('reads execution before catalog and discards completed data when identity switches', async () => {
    const identity = ref('owner:a'); let resolve; const calls = []; const scope = effectScope(); let service
    scope.run(() => { service = useHallSkillResults({ api: { get: (...args) => { calls.push(args); return new Promise(done => { resolve = done }) } },
      getContext: () => context, getOutcomes: () => [outcome()], identityKey: () => identity.value, enabled: () => true }) })
    assert.equal(calls[0][0], '/conversations/1/executions/pwe_test/result')
    const old = resolve; identity.value = 'owner:b'; old((result())); await drain(); assert.equal(service.results.value.length, 0)
    assert.equal(calls[0][2].signal.aborted, true)
    resolve((result())); await drain(); assert.equal(service.results.value[0].complete, true)
    service.dispose(); scope.stop()
  })
})

// Existing ChatDeliberationService.RequestView / StepView fields only. There is
// deliberately no ACTION_REQUEST, child, outcome ID or invented protocol marker.
const nativeRequest = () => ({ requestId: 'native', requestRevision: '1', conversationId: '1', conversationGeneration: '1',
  state: 'RESULT_COMMITTED', stateVersion: '9007199254740993', turns: [], steps: [{ stepId: 'native-step', stepNumber: '1',
    taskId: 'task', assignmentRevision: '1', targetAgentId: 'agent', kind: 'EXECUTE', state: 'RESULT_COMMITTED',
    stateVersion: '9007199254740993', executionIntentId: 'intent', executionId: 'native-execution', executionState: 'RESULT_COMMITTED' }] })
const nativeResult = () => ({ ...result(), requestId: 'native', stepId: 'native-step', executionId: 'native-execution' })
describe('RB-01/D01 native request-step result discovery', () => {
  const cleanups = []
  afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup() })
  const mountResults = (api, options = {}) => {
    const scope = effectScope(); let service
    scope.run(() => { service = useHallSkillResults({ api, getContext: () => context, getOutcomes: () => [],
      getRequests: () => [nativeRequest()], identityKey: () => 'owner:auth', enabled: () => true, ...options }) })
    cleanups.push(() => { service.dispose(); scope.stop() })
    return service
  }
  it('discovers a direct execution and recovers identical references after refresh without manufacturing an action', () => {
    const request = nativeRequest()
    const references = skillResultReferences([], context, [request])
    assert.deepEqual(references, [{ ...context, requestId: 'native', stepId: 'native-step', executionId: 'native-execution' }])
    assert.deepEqual(skillResultReferences([], context, [JSON.parse(JSON.stringify(request))]), references)
    assert.equal(Object.hasOwn(references[0], 'executionStateVersion'), false)
    assert.equal(Object.hasOwn(references[0], 'outcomeId'), false)
    assert.equal(skillResultProjection(nativeResult(), references[0]).complete, true)
  })
  it('rejects wrong generation, task, step or request identity without parsing completion prose', () => {
    const request = nativeRequest()
    for (const patch of [{ conversationId: 'other' }, { conversationGeneration: '2' }, { requestId: '../other' }, { requestRevision: 1 }])
      assert.deepEqual(skillResultReferences([], context, [{ ...request, ...patch }]), [])
    for (const patch of [{ taskId: 'other' }, { stepId: '../other' }, { executionId: null }, { kind: 'CHAT' }])
      assert.deepEqual(skillResultReferences([], context, [{ ...request, steps: [{ ...request.steps[0], ...patch }] }]), [])
    assert.deepEqual(skillResultReferences([{ text: '已完成，最新文件 native-execution' }], context, []), [])
    const [reference] = skillResultReferences([], context, [request])
    assert.equal(skillResultProjection({ ...nativeResult(), stepId: 'other' }, reference), null)
    assert.equal(skillResultProjection({ ...nativeResult(), schemaVersion: 3 }, reference), null)
  })
  it('joins matching history and request links once but never picks between conflicting bindings', () => {
    const request = { ...nativeRequest(), requestId: 'child', steps: [{ ...nativeRequest().steps[0], executionId: 'pwe_test' }] }
    const refs = skillResultReferences([outcome()], context, [request, request])
    assert.equal(refs.length, 1); assert.equal(refs[0].stepId, 'native-step'); assert.equal(refs[0].outcomeId, 'outcome')
    assert.deepEqual(skillResultReferences([outcome()], context, [{ ...request, requestId: 'other' }]), [])
    const otherStep = { ...request, steps: [{ ...request.steps[0], stepId: 'other-step' }] }
    assert.deepEqual(skillResultReferences([], context, [request, otherStep, request]), [])
  })
  it('reads native and submitted historical facts through GET only, with no action outcomes required for native', async () => {
    const paths = []
    const service = mountResults({ get: async path => { paths.push(path); return path.includes('native-execution') ? nativeResult() : result() } },
      { getOutcomes: () => [outcome()] })
    await drain()
    assert.deepEqual(paths.sort(), ['/conversations/1/executions/native-execution/result', '/conversations/1/executions/pwe_test/result'])
    assert.equal(service.error.value, ''); assert.equal(service.results.value.length, 2)
    assert.ok(service.results.value.every(value => value.complete))
  })
  it('keeps ARCHIVING data private and displays only the authoritative COMPLETE snapshot', async () => {
    let response = { ...nativeResult(), phase: 'ARCHIVING', data: null }
    const service = mountResults({ get: async () => response })
    await drain(); assert.equal(service.results.value[0].complete, false); assert.equal(service.results.value[0].data, null)
    response = { ...nativeResult(), executionStateVersion: '5' }
    await service.refresh(); assert.equal(service.results.value[0].complete, true)
    response = { ...nativeResult(), executionStateVersion: '3' }
    await service.refresh(); assert.equal(service.results.value[0].executionStateVersion, '5')
  })
  it('does not turn a missing read into QUEUED, success, or a write retry', async () => {
    let available = false; let calls = 0
    const service = mountResults({ get: async () => { calls++; if (!available) throw Object.assign(new Error('missing'), { status: 404 }); return nativeResult() } })
    await drain(); assert.equal(service.results.value[0].phase, 'UNKNOWN'); assert.equal(service.results.value[0].complete, false)
    available = true; await service.refresh(); assert.equal(service.results.value[0].complete, true); assert.equal(calls, 2)
  })
  it('retains a complete result during same-scope projection enrichment but removes unbound results immediately', async () => {
    const requests = ref([nativeRequest()]); const reads = []
    const service = mountResults({ get: (...args) => new Promise(resolve => reads.push({ args, resolve })) }, { getRequests: () => requests.value })
    reads[0].resolve(nativeResult()); await drain()
    requests.value = [{ ...nativeRequest(), stateVersion: '9007199254740994' }]
    assert.equal(service.results.value[0].complete, true); assert.equal(reads.length, 2)
    requests.value = []
    assert.equal(reads[1].args[2].signal.aborted, true); assert.deepEqual(service.results.value, [])
    reads[1].resolve(nativeResult()); await drain(); assert.deepEqual(service.results.value, [])
  })
  it('fences real identity, generation and task changes and cleans up pending reads on disposal', async () => {
    const identity = ref('owner:a'); const currentContext = ref(context); const requests = ref([nativeRequest()]); const reads = []
    const service = mountResults({ get: (...args) => new Promise(resolve => reads.push({ args, resolve })) },
      { identityKey: () => identity.value, getContext: () => currentContext.value, getRequests: () => requests.value })
    identity.value = 'owner:b'
    assert.equal(reads[0].args[2].signal.aborted, true)
    reads[0].resolve(nativeResult()); await drain(); assert.deepEqual(service.results.value, [])
    reads[1].resolve(nativeResult()); await drain(); assert.equal(service.results.value[0].complete, true)
    currentContext.value = { ...context, conversationGeneration: '2' }
    assert.deepEqual(service.results.value, [])
    requests.value = [{ ...nativeRequest(), conversationGeneration: '2' }]
    assert.equal(reads.length, 3)
    currentContext.value = { ...context, conversationGeneration: '2', taskId: 'other' }
    assert.equal(reads[2].args[2].signal.aborted, true)
    reads[2].resolve({ ...nativeResult(), conversationGeneration: '2' }); await drain(); assert.deepEqual(service.results.value, [])
    requests.value = [{ ...requests.value[0], steps: [{ ...requests.value[0].steps[0], taskId: 'other' }] }]
    assert.equal(reads.length, 4)
    service.dispose(); assert.equal(reads[3].args[2].signal.aborted, true)
    reads[3].resolve({ ...nativeResult(), conversationGeneration: '2', taskId: 'other' }); await drain()
    assert.deepEqual(service.results.value, []); assert.equal(service.loading.value, false)
  })
})
