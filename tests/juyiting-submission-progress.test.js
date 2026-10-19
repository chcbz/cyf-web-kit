import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { computed } from 'vue'
import { actionOutcomeProjection, submissionProgressAdvances } from '../src/composables/juyiting/hallTypedDeliberation.js'
import { displayFixture } from './fixtures/juyiting/interface-display-fixture.mjs'
const progress = () => ({ eventId: `delivery-submit-${'a'.repeat(64)}`, operationId: null, state: 'PENDING', dispatchVersion: '1', operationStateVersion: null, deliveryId: null, errorCode: null, retryable: false })
const fixture = () => displayFixture({ schemaVersion: 4, route: 'CHAT', conversationId: '7', conversationGeneration: '1', requestId: 'request', requestRevision: '1', turnId: 'turn', state: 'READY',
  outcome: { outcomeContractVersion: 4, outcomeId: 'outcome', taskId: 'task', assignmentRevision: '1', assistantMessageId: '101', finalDigest: `sha256:${'b'.repeat(64)}`, kind: 'ANSWER', text: '原始成果', deliverable: true,
    messageSource: { turnId: 'turn', messageId: '101', snapshotId: 'snapshot', finalDigest: `sha256:${'b'.repeat(64)}` } }, submissionProgress: progress() })
const completed = () => ({ ...progress(), operationId: 'operation', operationStateVersion: '9007199254740993', state: 'COMPLETED', deliveryId: 'delivery' })

describe('read-only original-discussion submission progress', () => {
  it('accepts only the current display-six shape, not a new model contract or inferred acceptance', () => {
    const value = fixture(); assert.ok(actionOutcomeProjection(value)); assert.equal(value.schemaVersion, 6); assert.equal(value.outcome.outcomeContractVersion, 4)
    assert.equal(actionOutcomeProjection({ ...value, schemaVersion: 5 }), null)
    delete value.submissionProgress; assert.equal(actionOutcomeProjection(value), null)
  })
  it('requires immutable deliverable CHAT answer and exact event/operation version union', () => {
    for (const patch of [p => { p.submissionProgress.state = 'ACCEPTED' }, p => { p.submissionProgress.operationStateVersion = '1' }, p => { p.submissionProgress.retryable = true },
      p => { p.outcome.deliverable = false; p.outcome.messageSource = null }, p => { p.submissionProgress.deliveryId = 'premature' }, p => { p.submissionProgress.dispatchVersion = '01' },
      p => { p.submissionProgress.eventId = 'event' }, p => { p.submissionProgress.errorCode = 'private storage failure' }, p => { p.submissionProgress.extra = 'authority' }]) {
      const value = fixture(); patch(value); assert.equal(actionOutcomeProjection(value), null)
    }
    const value = fixture(); value.submissionProgress = completed(); assert.ok(actionOutcomeProjection(value))
    value.submissionProgress.operationStateVersion = '9223372036854775808'; assert.equal(actionOutcomeProjection(value), null)
  })
  it('exposes permanent known reasons only and never treats unknown transport results as failed', () => {
    const value = fixture(); value.submissionProgress = { ...progress(), state: 'FAILED', errorCode: 'DELIVERY_REVIEW_REQUIRED' }; assert.ok(actionOutcomeProjection(value))
    value.submissionProgress.retryable = true; assert.equal(actionOutcomeProjection(value), null)
    value.submissionProgress = { ...completed(), errorCode: 'DELIVERY_REVIEW_REQUIRED' }; assert.equal(actionOutcomeProjection(value), null)
  })
  it('merges independent durable counters without rollback, identity replacement or re-POST intent', () => {
    const queued = progress(); const preparing = { ...queued, operationId: 'operation', operationStateVersion: '1' }; const done = completed()
    assert.equal(submissionProgressAdvances(queued, preparing), true); assert.equal(submissionProgressAdvances(preparing, done), true)
    for (const after of [null, queued, { ...done, operationId: 'foreign' }, { ...done, deliveryId: 'foreign' }, { ...done, state: 'PENDING', deliveryId: null }, { ...done, dispatchVersion: '0' }]) assert.equal(submissionProgressAdvances(done, after), false)
    assert.equal(submissionProgressAdvances(preparing, { ...preparing, retryable: true }), false)
    assert.equal(submissionProgressAdvances(preparing, { ...preparing, retryable: true, operationStateVersion: '2' }), true)
    assert.equal(submissionProgressAdvances(done, { ...done, dispatchVersion: '2' }), true)
  })
  it('renders one compact non-blocking notice and no new submission/acceptance action', () => {
    const source = readFileSync(new URL('../src/components/juyiting/BountyTypedOutcomeCard.vue', import.meta.url), 'utf8')
    const { descriptor } = parse(source); const script = compileScript(descriptor, { id: 'submission-card' }).content
    const props = { projection: fixture() }; props.projection.submissionProgress = { ...progress(), state: 'FAILED', errorCode: 'DELIVERY_REVIEW_REQUIRED' }
    const setup = script.replace(/^import .*\n/gm, '').replace('export default', 'return')
    const component = Function('computed', setup)(computed)
    const bindings = component.setup(props, { expose() {}, emit() {} })
    assert.match(bindings.submissionHint.value, /未替换原批次/)
    assert.match(descriptor.template.content, /typed-submission-note.*role="status"/)
    assert.doesNotMatch(descriptor.template.content, /重新提交|重发|验收通过/)
    assert.doesNotMatch(source, /\.create\(|fetch\(|chatApi/)
  })
})
