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
    assert.equal(skillResultProjection({ ...result(), token: 'leak' }, expected()), null)
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
