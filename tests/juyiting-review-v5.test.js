import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { typedOutcomeProjection, reviewProgressAdvances, revisionProgressPending, revisionProgressHint } from '../src/composables/juyiting/hallTypedDeliberation.js'
import { displayFixture } from './fixtures/juyiting/interface-display-fixture.mjs'
const f = JSON.parse(readFileSync(new URL('./fixtures/juyiting/message-review-v5.json', import.meta.url)))
const fixture = () => displayFixture({ schemaVersion: 5, route: 'CHAT', ...Object.fromEntries(['conversationId', 'conversationGeneration', 'requestId', 'requestRevision', 'turnId'].map(k => [k, f.binding[k]])), state: 'READY',
  outcome: { ...Object.fromEntries(Object.entries(f.outcome).filter(([k]) => k !== 'schemaVersion')), outcomeContractVersion: 5, outcomeId: f.parentOutcomeId, taskId: f.basis.taskId, assignmentRevision: f.basis.assignmentRevision, assistantMessageId: '101', finalDigest: f.parentFinalDigest },
  reviewProgress: { operationId: null, state: 'QUEUED', stateVersion: '0', sourceRequestId: f.binding.requestId, childRequestId: null, childState: null, childStateVersion: null } })
describe('message-origin v5 revision strict reader', () => {
  it('reads the shared Java/Runtime revision and keeps child acceptance distinct from task completion', () => {
    const v = fixture(); assert.ok(typedOutcomeProjection(v))
    v.reviewProgress = { ...v.reviewProgress, operationId: 'review', state: 'COMMITTED', stateVersion: '2', childRequestId: 'child', childState: 'RUNNING', childStateVersion: '0' }
    assert.ok(typedOutcomeProjection(v)); assert.equal(v.outcome.deliverable, false)
    const next = { ...v.reviewProgress, childState: 'COMPLETED', childStateVersion: '9007199254740993' }
    assert.equal(reviewProgressAdvances(v.reviewProgress, next), true)
    assert.equal(reviewProgressAdvances(next, v.reviewProgress), false)
  })
  it('rejects missing union/progress, forged child and terminal rollback rather than guessing', () => {
    for (const change of [v => { delete v.outcome.revision }, v => { delete v.reviewProgress }, v => { v.reviewProgress.childRequestId = 'premature' }, v => { v.outcome.deliverable = true }, v => { v.outcome.outcomeContractVersion = 4 }]) {
      const v = fixture(); change(v); assert.equal(typedOutcomeProjection(v), null)
    }
  })
})

// Exercise the real read adapter: a child already projected as PENDING must still advance.
import { useHallTypedDeliberation } from '../src/composables/juyiting/useHallTypedDeliberation.js'
import { effectScope } from 'vue'
describe('revision feedback and existing refresh continuation', () => {
  it('keeps queued/running revisions live without treating child completion as acceptance', () => {
    const value = fixture()
    assert.equal(revisionProgressPending(value), true)
    assert.match(revisionProgressHint(value.reviewProgress), /尚未开始修改/)
    value.reviewProgress = { ...value.reviewProgress, operationId: 'review', state: 'COMMITTED', stateVersion: '2', childRequestId: 'child', childState: 'RUNNING', childStateVersion: '0' }
    assert.equal(revisionProgressPending(value), true)
    value.reviewProgress.childState = 'COMPLETED'
    assert.equal(revisionProgressPending(value), false)
    assert.match(revisionProgressHint(value.reviewProgress), /不|以当前成果为准/)
    value.reviewProgress = { ...value.reviewProgress, state: 'REJECTED', childRequestId: null, childState: null, childStateVersion: null }
    assert.equal(revisionProgressPending(value), false)
    assert.match(revisionProgressHint(value.reviewProgress), /未受理/)
  })
  it('re-reads the committed child on later parent refresh without any POST or new listener', async () => {
    const parent = fixture()
    parent.reviewProgress = { ...parent.reviewProgress, operationId: 'review', state: 'COMMITTED', stateVersion: '2', childRequestId: 'child', childState: 'RUNNING', childStateVersion: '0' }
    const child = { ...fixture(), requestId: 'child', turnId: 'child-turn', state: 'PENDING', outcome: null, reviewProgress: null }
    const calls = []; let completed = false
    const scope = effectScope()
    const context = { conversationId: parent.conversationId, conversationGeneration: parent.conversationGeneration, taskId: parent.outcome.taskId, assignmentRevision: parent.outcome.assignmentRevision, targetAgentId: f.binding.targetAgentId }
    const adapter = scope.run(() => useHallTypedDeliberation({ chatApi: {
      get: async path => { calls.push(path); if (path.includes('/child/')) return completed ? { ...child, state: 'READY', outcome: { ...parent.outcome, outcomeId: 'child-outcome', kind: 'ANSWER', text: '修改后答复', revision: null } } : child; return parent },
      create: () => { throw new Error('Read recovery must not POST') }
    }, actorScopeKey: 'owner', authorizationGeneration: 1, getContext: () => context, getContextGeneration: () => 1,
    getCatalogEntries: () => [{ request: { requestId: parent.requestId, turns: [{ route: 'CHAT' }] } }], enabled: () => true }))
    try {
      await adapter.refresh(); assert.equal(adapter.projections.value.find(p => p.requestId === 'child')?.state, 'PENDING')
      completed = true; await adapter.refresh()
      assert.equal(adapter.projections.value.find(p => p.requestId === 'child')?.state, 'READY')
      assert.equal(calls.filter(p => p.includes('/child/')).length, 2)
    } finally { adapter.dispose(); scope.stop() }
  })
})
