import { expect } from 'chai'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { completedTextItem, currentOutputDelivery, outputItemKey } from '../src/composables/juyiting/bountyOutputCatalog.js'
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
