import { expect } from 'chai'
import { ref } from 'vue'
import { readFileSync } from 'node:fs'
import { decodeHttpResponse } from '../src/utils/apiEnvelope.js'
import { normalizeHallMessage } from '../src/composables/juyiting/hallConversationMessages.js'
import { messagePageOutcomes, useHallMessagePages } from '../src/composables/juyiting/useHallMessagePages.js'
import { useHallTypedDeliberation } from '../src/composables/juyiting/useHallTypedDeliberation.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/hall-message-outcome.json', import.meta.url), 'utf8'))
const setup = () => {
  const identity = ref('owner'); const context = { conversationId: '42', conversationGeneration: '1', taskId: 'task', targetAgentId: 'agent', assignmentRevision: '3' }
  let calls = 0
  const lane = useHallTypedDeliberation({ chatApi: { get: async () => { calls++; throw new Error('page adoption must not GET') } },
    actorScopeKey: identity, authorizationGeneration: ref(1), getContext: () => context, enabled: () => true })
  return { lane, identity, context, calls: () => calls }
}
describe('message page committed outcome adoption', () => {
  it('consumes the shared server display fixture with no per-request network read', () => {
    const h = setup()
    try {
      expect(h.lane.adoptPage([fixture.data])).to.equal(true)
      expect(h.lane.projections.value[0].outcome.finalSha256).to.equal(fixture.data.outcome.finalSha256)
      expect(h.calls()).to.equal(0)
    } finally { h.lane.dispose() }
  })
  it('retains separate turn associations even when the base request is shared', () => {
    const h = setup(); const other = structuredClone(fixture.data)
    other.turnId = 'second-turn'; other.outcome.outcomeId = 'second-outcome'; other.outcome.assistantMessageId = '10'
    other.outcome.messageSource.turnId = other.turnId; other.outcome.messageSource.messageId = '10'
    try {
      expect(h.lane.adoptPage([fixture.data, other])).to.equal(true)
      expect(h.lane.projections.value).to.have.length(2)
      expect(new Set(h.lane.projections.value.map(value => value.turnId)).size).to.equal(2)
      expect(h.calls()).to.equal(0)
    } finally { h.lane.dispose() }
  })
  it('rejects a page from another conversation without issuing compensating reads', () => {
    const h = setup(); const wrong = { ...fixture.data, conversationId: 'foreign' }
    try {
      expect(h.lane.adoptPage([wrong])).to.equal(false)
      expect(h.lane.projections.value).to.have.length(0); expect(h.calls()).to.equal(0)
      expect(h.lane.error.value).not.to.equal('')
    } finally { h.lane.dispose() }
  })
})

describe('contextual message outcome summaries', () => {
  const page = () => {
    const summary = structuredClone(fixture.data)
    summary.schemaVersion = 1
    delete summary.outcome.text
    return { items: [{ id: '9', content: fixture.data.outcome.text }], outcomeSummaries: [summary] }
  }
  it('consumes the shared complete aggregate envelope through both real page and typed adapters', () => {
    const wire = JSON.parse(readFileSync(new URL('./fixtures/hall-message-outcome-page.json', import.meta.url), 'utf8'))
    const decoded = decodeHttpResponse(JSON.stringify(wire), { status: 200, requestId: wire.requestId }).value
    const h = setup(); const messages = ref([])
    const pages = useHallMessagePages({ chatApi: {}, messages, conversationId: ref('42'), identityKey: h.identity,
      captureGuard: () => 1, guardCurrent: () => true, normalize: item => normalizeHallMessage(item, '') })
    try {
      pages.applyLatest(decoded)
      expect(h.lane.adoptPage(pages.typedOutcomes.value)).to.equal(true)
      expect(messages.value[0].content).to.equal(fixture.data.outcome.text)
      expect(h.lane.projections.value[0].outcome.text).to.equal(messages.value[0].content)
      expect(pages.requestPage.value.eventCursor).to.equal('2')
      expect(h.calls()).to.equal(0)
    } finally { pages.dispose(); h.lane.dispose() }
  })
  it('releases evicted turn projections even when another turn of the same request remains visible', async () => {
    const latest = JSON.parse(readFileSync(new URL('./fixtures/hall-message-outcome-page.json', import.meta.url), 'utf8')).data
    latest.hasMore = true; latest.nextCursor = '2:9'
    const turn = latest.requestPage.entries[0].request.turns[0]
    latest.requestPage.entries[0].request.turns.unshift({ ...turn, turnId: 'old-turn', finalMessageId: '7' })
    const older = structuredClone(latest)
    older.items = [{ ...older.items[0], id: '7', content: 'older-body' }]
    older.hasMore = false; older.nextCursor = null; older.requestPage.eventCursor = null
    older.outcomeSummaries[0].turnId = 'old-turn'
    older.outcomeSummaries[0].outcome.assistantMessageId = '7'
    const messages = ref([])
    const pages = useHallMessagePages({ messages, conversationId: ref('42'), identityKey: ref('owner'),
      captureGuard: () => 1, guardCurrent: () => true, normalize: item => ({ localId: item.id, content: item.content }),
      chatApi: { get: async (_path, _params, options) => options.onSuccess(older) } })
    try {
      pages.applyLatest(latest)
      await pages.loadOlder()
      expect(pages.typedOutcomes.value).to.have.length(2)
      pages.retainWindows([pages.windows.value[0].key])
      expect(pages.typedOutcomes.value.map(value => value.turnId)).to.deep.equal(['old-turn'])
      expect(pages.requestPage.value.entries).to.have.length(1)
      expect(messages.value.map(value => value.localId)).to.deep.equal(['7'])
    } finally { pages.dispose() }
  })
  it('hydrates the standalone presentation from the single same-page message body', () => {
    const value = page()
    expect(messagePageOutcomes(value)).to.deep.equal([fixture.data])
    expect(value.outcomeSummaries[0].outcome).not.to.have.property('text')
  })
  it('leaves readable messages intact when historical structured data is unavailable', () => {
    const value = page()
    value.outcomeSummaries = [{ schemaVersion: 1, requestId: 'request', turnId: 'turn', unavailableReason: 'STORED_OUTCOME_UNAVAILABLE' }]
    expect(messagePageOutcomes(value)).to.deep.equal([])
    expect(value.items[0].content).to.equal(fixture.data.outcome.text)
  })
  it('does not hydrate from another message or silently accept an unknown summary protocol', () => {
    const value = page(); value.items[0].id = '10'
    expect(() => messagePageOutcomes(value)).to.throw('同页消息')
    value.outcomeSummaries[0].schemaVersion = 2
    expect(() => messagePageOutcomes(value)).to.throw('摘要版本')
  })
})
