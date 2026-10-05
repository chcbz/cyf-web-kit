import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { completedTextItem, completedExecutionDelivery, currentOutputDelivery, currentDeliveryProjection } from '../src/composables/juyiting/bountyOutputCatalog.js'
import { typedOutcomeProjection } from '../src/composables/juyiting/hallTypedDeliberation.js'

const groups = JSON.parse(readFileSync(new URL('./fixtures/juyiting/execution-batch-delivery-v3.json', import.meta.url), 'utf8'))
const clone = value => JSON.parse(JSON.stringify(value))
const request = raw => ({ requestId: raw.requestId, requestRevision: raw.requestRevision, conversationId: raw.conversationId,
  conversationGeneration: raw.conversationGeneration, state: 'COMPLETED', steps: [] })
const turn = raw => ({ ...request(raw), turnId: raw.turnId, targetAgentId: 'agent', route: 'CHAT', state: 'FINAL_PERSISTED',
  finalMessageId: raw.outcome.assistantMessageId, contextSnapshotId: raw.requestId === 'request' ? raw.outcome.messageSource.snapshotId : `${raw.requestId}-snapshot` })
const child = raw => ({ requestId: raw.actionProgress.childRequestId, requestRevision: '1', conversationId: raw.conversationId,
  conversationGeneration: raw.conversationGeneration, state: 'OUTPUT_COMMITTED', stateVersion: raw.actionProgress.childStateVersion,
  steps: [{ kind: 'EXECUTE', stepId: 'fixture-step', executionId: 'fixture-execution', state: 'OUTPUT_COMMITTED', executionState: 'OUTPUT_COMMITTED',
    taskId: 'task', targetAgentId: 'agent', assignmentRevision: raw.outcome.assignmentRevision }] })
const batch = raw => ['one', 'two'].map((outputId, i) => ({ requestId: raw.actionProgress.childRequestId, stepId: 'fixture-step',
  outputId, sha256: (i ? 'b' : 'a').repeat(64), contentMimeType: 'image/png', replaces: null }))
const node = raw => completedExecutionDelivery(raw, request(raw), turn(raw), [child(raw)], 'task')
const text = raw => completedTextItem(raw, request(raw), turn(raw), 'task')

describe('explicit text to execution batch delivery', () => {
  for (const group of groups) it(`replays API ${group.mode} metadata without delivering action prose or manufacturing a text step`, async () => {
    const initial = await text(group.initial); const action = node(group.completed); const outputs = batch(group.completed)
    expect(await text(group.completed)).to.equal(null)
    expect(action.finalDigest).to.equal(group.queued.outcome.finalDigest)
    expect(currentOutputDelivery([initial, ...outputs], [action])).to.deep.equal(group.mode === 'APPEND' ? [initial, ...outputs] : outputs)
    const restored = clone({ items: [initial, ...outputs], actions: [action] })
    expect(currentOutputDelivery(restored.items, restored.actions)).to.deep.equal(group.mode === 'APPEND' ? restored.items : restored.items.slice(1))
    expect(Object.hasOwn(initial, 'stepId')).to.equal(false)
    expect(Object.isFrozen(action.deliveryRelation)).to.equal(true)
  })
  it('waits for the exact output-committed child, never delivers queued/failed/cancelled action prose', async () => {
    const group = groups[0]; const initial = await text(group.initial)
    for (const state of ['QUEUED', 'FAILED']) {
      const raw = clone(group.queued); raw.actionProgress.state = state
      const pending = completedExecutionDelivery(raw, request(raw), turn(raw), [], 'task')
      expect(() => currentOutputDelivery([initial], [pending])).to.throw('尚未完成')
    }
    for (const state of ['RUNNING', 'FAILED', 'CANCELLED']) {
      const raw = clone(group.completed); raw.actionProgress.state = state
      const pending = completedExecutionDelivery(raw, request(raw), turn(raw), [child(raw)], 'task')
      expect(() => currentOutputDelivery([initial, ...batch(raw)], [pending])).to.throw('尚未完成')
    }
    const raw = group.completed
    expect(() => currentOutputDelivery([initial], [node(raw)])).to.throw('尚未明确')
    expect(() => currentOutputDelivery([initial], [completedExecutionDelivery(raw, request(raw), turn(raw), [], 'task')])).to.throw('尚未完成')
  })
  it('rejects foreign scope, wrong child step/run readiness and source tampering', () => {
    const raw = groups[0].completed
    for (const patch of [{ conversationId: 'foreign' }, { conversationGeneration: '2' }, { requestRevision: '2' },
      { state: 'COMPLETED' }, { stateVersion: '999' }]) {
      expect(() => completedExecutionDelivery(raw, request(raw), turn(raw), [{ ...child(raw), ...patch }], 'task')).to.throw()
    }
    for (const patch of [{ taskId: 'foreign' }, { assignmentRevision: '4' }, { targetAgentId: 'other' },
      { kind: 'CHAT' }, { state: 'RUNNING' }, { executionState: 'RUNNING' }, { executionId: null }]) {
      const snapshot = child(raw); Object.assign(snapshot.steps[0], patch)
      expect(() => completedExecutionDelivery(raw, request(raw), turn(raw), [snapshot], 'task')).to.throw()
    }
    expect(() => completedExecutionDelivery(raw, request(raw), { ...turn(raw), finalMessageId: '999' }, [child(raw)], 'task')).to.throw()
    expect(() => completedExecutionDelivery(raw, request(raw), turn(raw), [child(raw)], 'foreign')).to.throw()
    const inspection = clone(raw); inspection.actionProgress.childRoute = 'INSPECT'
    expect(() => completedExecutionDelivery(inspection, request(inspection), turn(inspection), [child(inspection)], 'task')).to.throw('查阅动作')
  })
  it('does not union unlinked batches or infer intent from sources, arrival order, or MIME', async () => {
    const group = groups[0]; const initial = await text(group.initial); const action = node(group.completed); const outputs = batch(group.completed)
    expect(() => currentOutputDelivery([initial, ...outputs])).to.throw('尚不明确')
    expect(() => currentOutputDelivery([initial, ...outputs, { ...outputs[0], requestId: 'independent' }], [action])).to.throw('未关联')
    expect(() => currentOutputDelivery([initial, ...outputs], [action, action])).to.throw()
    expect(() => currentOutputDelivery([initial, ...outputs, outputs[0]], [action])).to.throw('重复')
    expect(() => currentOutputDelivery([initial, ...outputs], [{ ...action, deliveryRelation: { ...action.deliveryRelation, parentFinalDigest: `sha256:${'f'.repeat(64)}` } }])).to.throw('歧义')
    expect(() => currentOutputDelivery([initial, ...outputs], [{ ...action, outcomeId: 'branch', deliveryRelation: action.deliveryRelation }, action])).to.throw()
    const edited = { ...outputs[0], replaces: { requestId: 'old', stepId: 's', outputId: 'o', sha256: 'a'.repeat(64) } }
    expect(() => currentOutputDelivery([initial, edited, outputs[1]], [action])).to.throw('尚未明确')
  })
  it('strictly parses batch intent but never accepts REPLACE, target fields, CLARIFY or deliverable action prose', () => {
    const raw = groups[0].completed
    for (const change of [value => { value.outcome.deliverable = true }, value => { value.outcome.deliveryRelation.mode = 'REPLACE' },
      value => { value.outcome.deliveryRelation.targetOutcomeId = 'earlier'; value.outcome.deliveryRelation.targetFinalDigest = `sha256:${'a'.repeat(64)}` }]) {
      const value = clone(raw); change(value); expect(typedOutcomeProjection(value)).to.equal(null)
    }
  })
})

const mixed = JSON.parse(readFileSync(new URL('./fixtures/juyiting/media-basis-delivery-v3.json', import.meta.url), 'utf8'))
const mixedChildren = mixed.manifests.map(manifest => ({ requestId: manifest.requestId, requestRevision: '1', conversationId: '42',
  conversationGeneration: '1', state: 'OUTPUT_COMMITTED', stateVersion: '2', turns: [], steps: [{ kind: 'EXECUTE', stepId: manifest.stepId,
    executionId: manifest.executionId, state: 'OUTPUT_COMMITTED', executionState: 'OUTPUT_COMMITTED', taskId: 'task', targetAgentId: 'agent', assignmentRevision: '3' }] }))
const mixedOutputs = mixed.manifests.flatMap(manifest => manifest.outputs.map(output => ({ ...output,
  requestId: manifest.requestId, stepId: manifest.stepId, replaces: null })))
const mixedActions = [mixed.mediaOne, mixed.mediaTwo].map(raw => completedExecutionDelivery(raw, request(raw), turn(raw), mixedChildren, 'task'))

describe('actual API completed media causal basis and retained mixed delivery', () => {
  it('retains both precise manifests while replacing only the earlier text, independently of arrival order', async () => {
    const original = await text(mixed.initial); const updated = await text(mixed.updated); const appended = await text(mixed.appended)
    const before = currentDeliveryProjection([original, ...mixedOutputs], mixedActions)
    expect(before.items).to.deep.equal([original, ...mixedOutputs])
    expect(before.basis).to.deep.equal({ outcomeId: mixed.mediaTwo.outcome.outcomeId, finalDigest: mixed.mediaTwo.outcome.finalDigest })
    for (const items of [[original, ...mixedOutputs, updated], [updated, ...mixedOutputs.slice().reverse(), original]]) {
      const current = currentDeliveryProjection(items, mixedActions.slice().reverse())
      expect(current.items[0]).to.deep.equal(updated)
      expect(current.items.slice(1).map(item => [item.requestId, item.stepId, item.outputId, item.sha256]).sort()).to.deep.equal(
        mixed.targetsAfterEdit.filter(target => target.outputSource).map(target => Object.values({ requestId: target.outputSource.requestId,
          stepId: target.outputSource.stepId, outputId: target.outputSource.outputId, sha256: target.outputSource.sha256 })).sort())
      expect(current.basis).to.deep.equal({ outcomeId: mixed.updated.outcome.outcomeId, finalDigest: mixed.updated.outcome.finalDigest })
    }
    expect(currentDeliveryProjection([original, ...mixedOutputs, appended, updated], mixedActions).items).to.deep.equal([updated, ...mixedOutputs, appended])
  })
  it('never substitutes media as a text target or accepts missing, independent or stale causal sources', async () => {
    const original = await text(mixed.initial); const updated = await text(mixed.updated)
    const bad = { ...updated, deliveryRelation: { ...updated.deliveryRelation, targetOutcomeId: mixed.mediaOne.outcome.outcomeId,
      targetFinalDigest: mixed.mediaOne.outcome.finalDigest } }
    expect(() => currentDeliveryProjection([original, ...mixedOutputs, bad], mixedActions)).to.throw()
    expect(() => currentDeliveryProjection([original, ...mixedOutputs], mixedActions.slice(1))).to.throw()
    expect(() => currentDeliveryProjection([original, ...mixedOutputs.slice(2)], mixedActions)).to.throw()
    expect(() => currentDeliveryProjection([original, ...mixedOutputs, { ...mixedOutputs[0], requestId: 'unlinked' }], mixedActions)).to.throw()
  })
  it('recognizes an original completed action media root but not a second independent root or inspection prose', () => {
    const root = clone(mixed.mediaOne); delete root.outcome.deliveryRelation
    const action = completedExecutionDelivery(root, request(root), turn(root), mixedChildren, 'task')
    const projection = currentDeliveryProjection(mixedOutputs.slice(0, 2), [action])
    expect(projection.items).to.deep.equal(mixedOutputs.slice(0, 2))
    expect(projection.basis).to.deep.equal({ outcomeId: root.outcome.outcomeId, finalDigest: root.outcome.finalDigest })
    const second = { ...mixedActions[1], deliveryRelation: null }
    expect(() => currentDeliveryProjection(mixedOutputs, [action, second])).to.throw()
    root.actionProgress.childRoute = 'INSPECT'
    expect(completedExecutionDelivery(root, request(root), turn(root), mixedChildren, 'task')).to.equal(null)
  })
})
