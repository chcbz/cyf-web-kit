import assert from 'node:assert/strict'
import fs from 'node:fs'
import { discussionBody, sourceSelector, actionOutcomeProjection, actionProgressAdvances } from '../src/composables/juyiting/hallTypedDeliberation.js'
import { pointAndStartProjection, createPointAndStartIntentStore } from '../src/composables/juyiting/hallPointAndStartIntent.js'

const clone = x => JSON.parse(JSON.stringify(x))
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/skill-v4/action-v4.json', import.meta.url)))
const project = () => ({ schemaVersion: 4, route: 'CHAT', conversationId: '1', conversationGeneration: '1', requestId: 'req', requestRevision: '1', turnId: 'turn', state: 'READY', inspection: null,
  outcome: { outcomeContractVersion: 4, outcomeId: 'outcome', taskId: 'task', assignmentRevision: '1', assistantMessageId: '2', finalDigest: fixture.final.finalDigest,
    ...Object.fromEntries(Object.entries(fixture.final.outcome).filter(([k]) => k !== 'schemaVersion')),
    action: { ...clone(fixture.final.outcome.action), actionRequestId: 'event' } },
  actionProgress: { actionRequestId: 'event', state: 'ARCHIVING', dispatchVersion: '1', childRequestId: 'child', childRoute: 'EXECUTE', childStateVersion: '2', executionId: 'pwe_test', phase: 'ARCHIVING', resultDigest: 'a'.repeat(64) } })

describe('SE2 single discussion-v2 and action-v4 consumer', () => {
  it('has explicit material scope and strict tagged selectors', () => {
    const base = { intent: 'DISCUSSION', taskId: 'task', assignmentRevision: '1', content: '修改资料' }
    for (const materialScope of ['TASK_DEFAULT', 'EXPLICIT', 'NONE']) assert.equal(discussionBody({ ...base, materialScope }).materialScope, materialScope)
    assert.equal(discussionBody(base).schemaVersion, 2)
    const upload = { kind: 'TASK_LINKED_WORKSPACE_VERSION', fileId: 'f', version: '1', purpose: 'INPUT' }
    const result = { kind: 'EXECUTION_RESULT', executionId: 'pwe_result', resultDigest: 'a'.repeat(64) }
    assert.deepEqual(sourceSelector(result), result)
    assert.equal(discussionBody({ ...base, materialScope: 'NONE', sourceSelectors: [upload] }), null)
    assert.equal(discussionBody({ ...base, sourceSelectors: [upload, upload] }), null)
    assert.equal(sourceSelector({ ...result, resultDigest: 'wrong' }), null)
    assert.equal(sourceSelector({ ...upload, producerExecutionId: 'fake' }), null)
  })
  it('projects an unknown skill parameter object without granting execution or approving costs', () => {
    const p = project()
    p.outcome.action.actionId = 'act_new-extension-without-core-code'
    assert.deepEqual(actionOutcomeProjection(p)?.outcome.action.parameters, { prompt: '改变颜色' })
    assert.equal(actionOutcomeProjection(p)?.actionProgress.state, 'ARCHIVING')
    const forged = clone(p); forged.outcome.action.skill = { skillKey: 'fake' }
    assert.equal(actionOutcomeProjection(forged), null)
  })
  it('does not claim complete while archiving or permit new INSPECT routes', () => {
    const p = project(); p.actionProgress.state = 'COMPLETED'
    assert.equal(actionOutcomeProjection(p), null)
    p.actionProgress.phase = 'COMPLETE'; assert.equal(actionOutcomeProjection(p)?.actionProgress.state, 'COMPLETED')
    const old = clone(p); old.route = 'INSPECT'; assert.equal(actionOutcomeProjection(old, {}, 'INSPECT'), null)
    const after = clone(p.actionProgress); after.state = 'RUNNING'
    assert.equal(actionProgressAdvances(p.actionProgress, after), false)
  })
  it('accepts schema2 known platform operations without exact-two coupling and rejects unknown operations', () => {
    const intent = { schemaVersion: 2, taskId: 'task', body: { targetAgentId: 'agent', expectedTaskVersion: '0', requirementRevision: '1' } }
    const p = { schemaVersion: 2, taskId: 'task', targetAgentId: 'agent', requirementRevision: '1', assignmentRevision: '1', taskVersion: '1', grantVersion: '1', stateVersion: '0', grantId: 'grant', bootstrapId: 'bootstrap', grantState: 'ACTIVE', bootstrapState: 'PENDING', currentAssignment: true, permittedOperations: ['DELIBERATE', 'EXECUTE_SKILL'], inputs: [], initialOperation: 'DELIBERATE', conversationId: null, initialRequestId: null }
    assert.ok(pointAndStartProjection(p, intent))
    p.permittedOperations = ['DELIBERATE']; assert.ok(pointAndStartProjection(p, intent))
    p.permittedOperations.push('UNKNOWN_TOOL'); assert.equal(pointAndStartProjection(p, intent), null)
    p.permittedOperations = ['DELIBERATE', 'INSPECT_INPUTS']; assert.equal(pointAndStartProjection(p, intent), null)
  })
  it('never writes old image/consent intents to the new store', () => {
    const storage = { getItem: () => null, setItem: () => assert.fail('unexpected write') }
    const store = createPointAndStartIntentStore({ storage, scope: 'owner', taskId: 'task' })
    assert.equal(store.write({ schemaVersion: 1 }).state, 'UNAVAILABLE')
  })
})
