import { expect } from 'chai'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { completedTextItem, currentOutputDelivery, textDeliveryProjection, outputItemKey } from '../src/composables/juyiting/bountyOutputCatalog.js'
import { typedOutcomeProjection } from '../src/composables/juyiting/hallTypedDeliberation.js'

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/juyiting/completed-message-delivery-v3.json', import.meta.url), 'utf8'))
const originalRequest = projection => ({ requestId: projection.requestId, requestRevision: projection.requestRevision,
  conversationId: projection.conversationId, conversationGeneration: projection.conversationGeneration, state: 'COMPLETED', steps: [] })
const originalTurn = projection => ({ ...originalRequest(projection), turnId: projection.turnId, route: 'CHAT', state: 'FINAL_PERSISTED',
  finalMessageId: projection.outcome.assistantMessageId, contextSnapshotId: projection.outcome.messageSource.snapshotId })
const readText = raw => completedTextItem(raw, originalRequest(fixture()), originalTurn(fixture()), 'task')

describe('explicit persisted completed text deliverable', () => {
  it('reads the actual API final projection as text without creating a step, execution or asset', async () => {
    const raw = fixture(); const item = await readText(raw)
    expect(item.text).to.equal(raw.outcome.text)
    expect(item.messageSource).to.deep.equal(raw.outcome.messageSource)
    expect(item.sha256).to.equal(createHash('sha256').update(raw.outcome.text, 'utf8').digest('hex'))
    expect(Object.isFrozen(item.messageSource)).to.equal(true)
    for (const field of ['stepId', 'outputId', 'executionId', 'runId', 'assetRef']) expect(Object.hasOwn(item, field), field).to.equal(false)
    expect(currentOutputDelivery([item])).to.deep.equal([item])
  })
  it('keeps Chinese multiline and trailing UTF8 bytes unchanged in display and digest', async () => {
    const raw = fixture(); raw.outcome.text = '中文第一行\n第二行\n  '
    const item = await readText(raw)
    expect(item.text).to.equal(raw.outcome.text)
    expect(item.byteLength).to.equal(Buffer.byteLength(raw.outcome.text, 'utf8'))
    expect(item.sha256).to.equal(createHash('sha256').update(raw.outcome.text, 'utf8').digest('hex'))
  })
  it('does not turn missing/false marker, greeting or pending answer into a deliverable', async () => {
    for (const flag of [undefined, false]) {
      const raw = fixture(); delete raw.outcome.messageSource; delete raw.outcome.deliverable
      if (flag !== undefined) raw.outcome.deliverable = flag
      raw.outcome.text = '你好'
      expect(await readText(raw)).to.equal(null)
    }
    const pending = fixture(); pending.state = 'PENDING'; pending.outcome = null
    expect(await readText(pending)).to.equal(null)
  })
  it('rejects malformed marker and unauthorized source additions rather than guessing media/text', async () => {
    for (const mutate of [raw => { raw.outcome.deliverable = 'true' }, raw => { raw.outcome.deliverable = null },
      raw => { delete raw.outcome.messageSource }, raw => { raw.outcome.messageSource.grantId = 'forged' },
      raw => { raw.outcome.messageSource.messageId = 9 }, raw => { raw.outcome.messageSource.finalDigest = `sha256:${'e'.repeat(64)}` },
      raw => { raw.outcome.messageSource.turnId = 'different-turn' }, raw => { raw.outcome.messageSource.snapshotId = 'different-snapshot' },
      raw => { raw.route = 'INSPECT' }, raw => { raw.outcome.kind = 'ACTION_REQUEST' }]) {
      const raw = fixture(); mutate(raw)
      let rejected = false
      try { await readText(raw) } catch { rejected = true }
      expect(rejected).to.equal(true)
    }
  })
  it('requires original task/turn/message/generation/snapshot scope and completed final facts', async () => {
    const raw = fixture()
    for (const patch of [{ finalMessageId: '10' }, { contextSnapshotId: 'changed' }, { state: 'QUEUED' },
      { conversationId: '43' }, { conversationGeneration: '2' }, { requestRevision: '2' }, { requestId: 'foreign' }, { route: 'INSPECT' }]) {
      let rejected = false
      try { await completedTextItem(raw, originalRequest(raw), { ...originalTurn(raw), ...patch }, 'task') } catch { rejected = true }
      expect(rejected, JSON.stringify(patch)).to.equal(true)
    }
    let rejected = false
    try { await completedTextItem(raw, originalRequest(raw), originalTurn(raw), 'foreign-task') } catch { rejected = true }
    expect(rejected).to.equal(true)
  })
  it('does not pick latest among independent text finals or silently union text and media', async () => {
    const one = await readText(fixture()); const two = { ...one, requestId: 'second-request' }
    expect(() => currentOutputDelivery([one, two])).to.throw('尚不明确')
    expect(() => currentOutputDelivery([one, { requestId: 'media', stepId: 'step', outputId: 'image', sha256: 'a'.repeat(64) }])).to.throw('尚不明确')
    expect(outputItemKey({ ...one, messageSource: { ...one.messageSource, snapshotId: 'other' } })).not.to.equal(outputItemKey(one))
  })
  it('rejects marker-only fake source and refuses false-marker source payloads in ordinary UI parsing', () => {
    const raw = fixture(); delete raw.outcome.messageSource
    expect(typedOutcomeProjection(raw)).to.equal(null)
    const falseMarker = fixture(); falseMarker.outcome.deliverable = false
    expect(typedOutcomeProjection(falseMarker)).to.equal(null)
  })
})

describe('explicit text delivery causal replay', () => {
  const item = (id, parent = null, mode = null) => ({ outcomeId: id, requestId: `request-${id}`, text: `原文-${id}`,
    messageSource: { turnId: `turn-${id}`, messageId: '9', snapshotId: `snapshot-${id}`, finalDigest: `sha256:${id === 'one' ? 'a' : id === 'two' ? 'b' : 'c'}`.padEnd(71, id === 'one' ? 'a' : id === 'two' ? 'b' : 'c') },
    deliveryRelation: parent ? { mode, parentOutcomeId: parent.outcomeId, parentFinalDigest: parent.messageSource.finalDigest } : null })
  it('append keeps previous work, replace changes only its exact parent, reset discards previous delivery', () => {
    const one = item('one'); const two = item('two', one, 'APPEND'); const three = item('three', two, 'REPLACE')
    expect(currentOutputDelivery([three, one, two])).to.deep.equal([one, three])
    expect(textDeliveryProjection([two, one]).basis).to.deep.equal({ outcomeId: two.outcomeId, finalDigest: two.messageSource.finalDigest })
    const reset = item('three', two, 'RESET')
    expect(currentOutputDelivery([reset, one, two])).to.deep.equal([reset])
    expect(Object.isFrozen(currentOutputDelivery([two, one]))).to.equal(true)
  })
  it('rejects independent roots, missing parents, altered digests, forks and disconnected cycles', () => {
    const one = item('one'); const two = item('two', one, 'APPEND'); const three = item('three', one, 'REPLACE')
    for (const list of [[one, item('two')], [two], [one, two, three], [one, { ...two, deliveryRelation: { ...two.deliveryRelation, parentFinalDigest: `sha256:${'f'.repeat(64)}` } }], [one, one]]) {
      expect(() => currentOutputDelivery(list)).to.throw()
    }
    const cycleTwo = item('two'); const cycleThree = item('three', cycleTwo, 'APPEND')
    cycleTwo.deliveryRelation = { mode: 'APPEND', parentOutcomeId: cycleThree.outcomeId, parentFinalDigest: cycleThree.messageSource.finalDigest }
    expect(() => currentOutputDelivery([one, cycleTwo, cycleThree])).to.throw('不完整')
  })
  it('only precise true-marked relation metadata passes the original typed reader', () => {
    const value = fixture(); value.outcome.deliveryRelation = { mode: 'APPEND', parentOutcomeId: 'parent', parentFinalDigest: `sha256:${'a'.repeat(64)}` }
    expect(typedOutcomeProjection(value)?.outcome.deliveryRelation).to.deep.equal(value.outcome.deliveryRelation)
    for (const patch of [{ mode: 'LATEST' }, { parentFinalDigest: 'bad' }, { parentOutcomeId: value.outcome.outcomeId }, { authority: 'fake' }]) {
      const bad = structuredClone(value); Object.assign(bad.outcome.deliveryRelation, patch); expect(typedOutcomeProjection(bad)).to.equal(null)
    }
  })
})

describe('actual API-generated text relation read projections', () => {
  it('rebuilds append/replace/reset from real service reads with exact original snapshots and UTF8', async () => {
    const groups = JSON.parse(readFileSync(new URL('./fixtures/juyiting/text-delivery-relations-v3.json', import.meta.url), 'utf8'))
    for (const group of groups) {
      const items = []
      for (const projection of [group.initial, group.updated]) items.push(await completedTextItem(projection, originalRequest(projection), originalTurn(projection), 'task'))
      const actual = currentOutputDelivery(items.reverse())
      expect(actual.map(item => item.requestId), group.mode).to.deep.equal(group.mode === 'APPEND' ? ['request', 'child'] : ['child'])
      expect(actual.at(-1).text).to.equal('修改原文  ')
      expect(actual.at(-1).messageSource).to.deep.equal(group.updated.outcome.messageSource)
      expect(textDeliveryProjection(items).basis).to.deep.equal({ outcomeId: group.updated.outcome.outcomeId, finalDigest: group.updated.outcome.finalDigest })
    }
  })
})

describe('API-verified clarified text delivery replay', () => {
  it('ignores clarification messages and reconstructs all explicit modes from the original text basis', async () => {
    const groups = JSON.parse(readFileSync(new URL('./fixtures/juyiting/clarified-text-delivery-v3.json', import.meta.url), 'utf8'))
    for (const group of groups) {
      const items = []
      for (const projection of [group.updated, ...group.clarifications, group.initial]) {
        const turn = { ...originalRequest(projection), turnId: projection.turnId, route: 'CHAT', state: 'FINAL_PERSISTED',
          finalMessageId: projection.outcome.assistantMessageId, contextSnapshotId: projection.outcome.messageSource?.snapshotId }
        const item = await completedTextItem(projection, originalRequest(projection), turn, 'task')
        if (projection.outcome.kind === 'CLARIFY') expect(item).to.equal(null)
        else items.push(item)
      }
      const delivery = currentOutputDelivery(items)
      expect(delivery.map(item => item.requestId), group.mode).to.deep.equal(group.mode === 'APPEND' ? ['request', 'clarified'] : ['clarified'])
      expect(delivery.at(-1).text).to.equal(group.updated.outcome.text)
      expect(delivery.at(-1).messageSource).to.deep.equal(group.updated.outcome.messageSource)
      expect(delivery.at(-1).deliveryRelation.parentOutcomeId).to.equal(group.initial.outcome.outcomeId)
      expect(delivery.at(-1).deliveryRelation.parentOutcomeId).not.to.equal(group.admissionFacts.parentOutcomeId)
    }
  })
})
