import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { deliveryContextPage, readDeliveryContextPage } from '../src/composables/juyiting/hallDeliveryContext.js'
const fixture = JSON.parse(readFileSync(new URL('./fixtures/hall-delivery-context.json', import.meta.url), 'utf8'))
const payload = () => structuredClone(fixture.data)
const context = { ...fixture.data.scope, assignmentRevision: '3', targetAgentId: 'wuyong' }

describe('current delivery context page', () => {
  it('consumes the shared server response without fetching full outcomes or rounding message IDs', () => {
    const page = deliveryContextPage(payload(), context)
    expect(page.items[0].assistantMessageId).to.equal('9007199254740993')
    expect(page.items[0].label).to.equal('当前成果')
    expect(Object.isFrozen(page.items[0])).to.equal(true)
  })
  it('allows harmless new fields and preserves pending execution separately from choices', () => {
    const data = payload(); data.pendingExecution = true; data.additional = 'ignored'
    expect(deliveryContextPage(data, context).pendingExecution).to.equal(true)
    expect(deliveryContextPage(data, context).items).to.have.length(1)
  })
  it('does not confuse another assignment, conversation, generation or agent with an empty result', () => {
    for (const [key, item] of Object.entries(context)) expect(deliveryContextPage(payload(), { ...context, [key]: `${item}-other` })).to.equal(null)
  })
  it('requires a consistent next cursor and limits a page to fifty choices', () => {
    const data = payload(); data.hasMore = true
    expect(deliveryContextPage(data, context)).to.equal(null)
    data.nextBeforeMessageId = data.items[0].assistantMessageId; data.nextBeforeOutcomeId = data.items[0].outcomeId
    expect(deliveryContextPage(data, context).hasMore).to.equal(true)
    data.items = Array.from({ length: 51 }, (_, index) => ({ ...data.items[0], outcomeId: `o-${index}`, assistantMessageId: String(100 - index) }))
    expect(deliveryContextPage(data, context)).to.equal(null)
  })
  it('rejects duplicate or non-advancing keysets, including equal message IDs', () => {
    const data = payload(); const item = data.items[0]
    expect(deliveryContextPage(data, { ...context, before: item })).to.equal(null)
    expect(deliveryContextPage(data, { ...context, before: { ...item, outcomeId: 'outcome-b' } })).not.to.equal(null)
    data.items.push({ ...item }); expect(deliveryContextPage(data, context)).to.equal(null)
  })
  it('loads one page only even when more independent outcomes exist', async () => {
    const data = payload(); data.hasMore = true; data.nextBeforeMessageId = data.items[0].assistantMessageId; data.nextBeforeOutcomeId = data.items[0].outcomeId
    const calls = []; const controller = new AbortController()
    const chatApi = { get: async (...args) => { calls.push(args); return data } }
    const result = await readDeliveryContextPage({ chatApi, context, signal: controller.signal })
    expect(result.hasMore).to.equal(true); expect(calls).to.have.length(1)
    expect(calls[0][0]).to.equal('/conversations/101/delivery-context')
    expect(calls[0][1]).to.deep.equal({ expectedGeneration: '1', expectedAssignmentRevision: '3' })
    expect(calls[0][2].signal).to.equal(controller.signal)
  })
  it('does not fall back to a historical scan after a failed read', async () => {
    let reads = 0
    const chatApi = { get: async () => { reads++; throw new Error('unavailable') } }
    try { await readDeliveryContextPage({ chatApi, context }); throw new Error('should reject') } catch (error) { expect(error.message).to.equal('unavailable') }
    expect(reads).to.equal(1)
  })
})
