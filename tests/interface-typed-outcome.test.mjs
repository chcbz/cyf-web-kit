import test from 'node:test'
import assert from 'node:assert/strict'
import { typedOutcomeProjection, discussionBody, actionProgressAdvances } from '../src/composables/juyiting/hallTypedDeliberation.js'
import { skillResultProjection, skillResultReferences, skillResultAdvances } from '../src/composables/juyiting/hallSkillResults.js'
const hash = 'a'.repeat(64)
const progress = { actionRequestId: 'a', state: 'RUNNING', dispatchVersion: '1', childRequestId: 'child', childRoute: 'EXECUTE', childStateVersion: '2', executionId: 'e', executionStateVersion: '9007199254740993', phase: 'RUNNING', resultSha256: null }
const outcome = { outcomeContractVersion: 4, outcomeId: 'o', taskId: 't', assignmentRevision: '0', assistantMessageId: '9223372036854775807', finalSha256: hash, kind: 'ACTION_REQUEST', text: '读取图片\n保持正文', clarification: null, proposal: null, action: { actionRequestId: 'a', actionId: 'image.edit', instruction: '改为蓝色', sourceRefIds: [], parameters: {} }, deliverable: null, messageSource: null, deliveryRelation: null }
const fixture = () => ({ schemaVersion: 6, submissionProgress: null, route: 'CHAT', conversationId: 'c', conversationGeneration: '1', requestId: 'r', requestRevision: '1', turnId: 'turn', state: 'READY', outcome: structuredClone(outcome), inspection: null, actionProgress: { ...progress } })
test('display six is the only public shape; historical contract remains explicit', () => {
  assert.ok(typedOutcomeProjection(fixture()))
  assert.equal(typedOutcomeProjection({ ...fixture(), schemaVersion: 4 }), null)
  const legacy = fixture(); legacy.outcome = { ...legacy.outcome, outcomeContractVersion: 1, kind: 'ANSWER', action: null }; legacy.actionProgress = null
  assert.ok(typedOutcomeProjection(legacy))
  delete legacy.outcome.messageSource; assert.equal(typedOutcomeProjection(legacy), null)
  const bad = fixture(); bad.outcome.finalSha256 = `sha256:${hash}`; assert.equal(typedOutcomeProjection(bad), null)
})
test('skill CAS can advance without chat state version but never roll back or alter committed hash', () => {
  const next = { ...progress, executionStateVersion: '9007199254740994', phase: 'RESULT_READY', resultSha256: hash }
  assert.equal(actionProgressAdvances(progress, next), true)
  assert.equal(actionProgressAdvances(next, progress), false)
  assert.equal(actionProgressAdvances(progress, { ...next, executionStateVersion: progress.executionStateVersion }), false)
  assert.equal(actionProgressAdvances(next, { ...next, executionStateVersion: '9007199254740995', resultSha256: null }), false)
  assert.equal(actionProgressAdvances(progress, { ...next, dispatchVersion: '0' }), false)
})
test('Discussion three preserves legal Unicode and maps only the new selector', () => {
  const input = { intent: 'DISCUSSION', taskId: 't', assignmentRevision: '0', content: '字'.repeat(5000)+'\n😀', sourceSelectors: [{ kind: 'EXECUTION_RESULT', executionId: 'e', resultSha256: hash }] }
  assert.equal(discussionBody(input).schemaVersion, 3); assert.equal(discussionBody(input).content, input.content)
  assert.equal(discussionBody({ ...input, content: '\ud800' }), null)
  assert.equal(discussionBody({ ...input, content: '字'.repeat(200001) }), null)
  assert.equal(discussionBody({ ...input, sourceSelectors: [{ kind: 'EXECUTION_RESULT', executionId: 'e', resultDigest: hash }] }), null)
})
test('skill result two never exposes uncommitted data and keeps exact independent version', () => {
  const [reference] = skillResultReferences([fixture()], { conversationId: 'c', conversationGeneration: '1', taskId: 't' })
  assert.equal(reference.executionId, 'e')
  const result = { schemaVersion: 2, conversationId: 'c', conversationGeneration: '1', taskId: 't', requestId: 'child', stepId: 'step', executionId: 'e', executionStateVersion: progress.executionStateVersion, state: 'RUNNING', phase: 'RESULT_READY', resultSha256: hash, data: null, outputs: [] }
  assert.ok(skillResultProjection(result, reference))
  assert.equal(skillResultProjection({ ...result, data: { premature: true } }, reference), null)
  assert.equal(skillResultProjection({ ...result, executionStateVersion: '1' }, reference), null)
  const next = { ...result, executionStateVersion: '9007199254740994', phase: 'COMPLETE', state: 'RESULT_COMMITTED', data: { ok: true } }
  assert.ok(skillResultProjection(next, reference)); assert.equal(skillResultAdvances(result, next), true); assert.equal(skillResultAdvances(next, result), false)
})
