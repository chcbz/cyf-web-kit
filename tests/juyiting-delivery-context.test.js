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

// Exercise the actual composable with the complete network trace (no API wrapper).
import { ref } from 'vue'
import { useHallTypedDeliberation } from '../src/composables/juyiting/useHallTypedDeliberation.js'
const memory = () => { const map = new Map(); return { getItem: key => map.get(key), setItem: (key, value) => map.set(key, value) } }
const harness = (read = async () => payload()) => {
  const calls = []; const actor = ref('owner'); const authorization = ref(1); const active = { ...context }
  const lane = useHallTypedDeliberation({ chatApi: {
    get: async (...args) => { calls.push(['GET', ...args]); return read(...args) },
    create: async (...args) => { calls.push(['POST', ...args]); throw new Error('lost receipt') }
  }, actorScopeKey: actor, authorizationGeneration: authorization, getContext: () => active,
  getCatalogEntries: () => { throw new Error('send must not read the history catalog') },
  storage: memory(), enabled: () => true })
  return { lane, calls, actor, authorization, active }
}
const flush = () => new Promise(resolve => setImmediate(resolve))
describe('bounded delivery context on the actual send path', () => {
  it('uses one summary GET then POST, and UNKNOWN retry reuses body/key without another GET', async () => {
    const h = harness()
    try {
      await h.lane.submit({ content: '继续' })
      expect(h.calls.map(call => call[0])).to.deep.equal(['GET', 'POST'])
      expect(h.calls[1][2].parentOutcomeId).to.equal('outcome-a')
      await h.lane.resumeUnknown()
      expect(h.calls.map(call => call[0])).to.deep.equal(['GET', 'POST', 'POST'])
      expect(h.calls[2]).to.deep.equal(h.calls[1])
    } finally { h.lane.dispose() }
  })
  it('locks before the context read and does not create duplicate requests', async () => {
    let finish; const h = harness(() => new Promise(resolve => { finish = resolve }))
    try {
      const sending = h.lane.submit({ content: '继续' })
      expect(h.lane.busy.value).to.equal(true)
      expect(await h.lane.submit({ content: '重复' })).to.equal(false)
      expect(h.calls).to.have.length(1)
      finish(payload()); await sending
      expect(h.calls.map(call => call[0])).to.deep.equal(['GET', 'POST'])
      expect(h.lane.busy.value).to.equal(false)
    } finally { h.lane.dispose() }
  })
  for (const mode of ['identity', 'authorization', 'assignment', 'dispose']) it(`does not post after ${mode} changes during the context read`, async () => {
    let finish; const h = harness(() => new Promise(resolve => { finish = resolve }))
    try {
      const sending = h.lane.submit({ content: '继续' })
      const signal = h.calls[0][3].signal
      if (mode === 'identity') h.actor.value = 'other'
      if (mode === 'authorization') h.authorization.value++
      if (mode === 'assignment') h.active.assignmentRevision = '4'
      if (mode === 'dispose') h.lane.dispose()
      finish(payload()); expect(await sending).to.equal(false)
      expect(h.calls).to.have.length(1)
      if (['identity', 'dispose'].includes(mode)) expect(signal.aborted).to.equal(true)
    } finally { h.lane.dispose() }
  })
  it('loads another page only explicitly and rechecks a page-two selection by exact ID', async () => {
    const first = payload(); first.hasMore = true; first.nextBeforeMessageId = first.items[0].assistantMessageId; first.nextBeforeOutcomeId = 'outcome-a'
    const second = payload(); second.items[0] = { ...second.items[0], assistantMessageId: '8', outcomeId: 'outcome-older' }
    const h = harness(async (_path, params) => params.beforeMessageId || params.outcomeId ? second : first)
    try {
      expect(await h.lane.refreshDeliveryChoices()).to.equal(true)
      expect(h.calls).to.have.length(1)
      expect(h.lane.deliveryHasMore.value).to.equal(true)
      await h.lane.loadMoreDeliveryChoices()
      expect(h.calls[1][2].beforeMessageId).to.equal('9007199254740993')
      h.lane.chooseDelivery('outcome-older')
      await h.lane.refreshDeliveryChoices()
      expect(h.lane.selectedDeliveryId.value).to.equal('outcome-older')
      await h.lane.submit({ content: '继续旧成果' })
      expect(h.calls.at(-2)[2]).to.deep.equal({ expectedGeneration: '1', expectedAssignmentRevision: '3', outcomeId: 'outcome-older' })
      expect(h.calls.at(-1)[2].parentOutcomeId).to.equal('outcome-older')
    } finally { h.lane.dispose() }
  })
  for (const mode of ['removed', 'digest']) it(`does not silently substitute a ${mode} explicit selection`, async () => {
    let changed = false
    const h = harness(async () => { const data = payload(); if (changed) { if (mode === 'removed') data.items = []; else data.items[0].finalSha256 = 'b'.repeat(64) }; return data })
    try {
      await h.lane.refreshDeliveryChoices(); h.lane.chooseDelivery('outcome-a'); changed = true
      await h.lane.refreshDeliveryChoices(); await h.lane.submit({ content: '继续' })
      expect(h.calls.every(call => call[0] === 'GET')).to.equal(true)
      expect(h.lane.error.value).to.include('重新选择')
    } finally { h.lane.dispose() }
  })
  it('reports context read failures without a full-history fallback or UNKNOWN receipt', async () => {
    const h = harness(async () => { throw new Error('offline') })
    try {
      expect(await h.lane.submit({ content: '继续' })).to.equal(false)
      expect(h.calls).to.have.length(1); expect(h.lane.error.value).to.equal('offline')
      expect(h.lane.busy.value).to.equal(false); expect(h.lane.recoveryAvailable.value).to.equal(false)
    } finally { h.lane.dispose() }
  })
  it('pending execution suppresses automatic parent without blocking a new discussion', async () => {
    const data = payload(); data.pendingExecution = true
    const h = harness(async () => data)
    try { await h.lane.submit({ content: '补充说明' }); expect(h.calls.at(-1)[2].parentOutcomeId).to.equal(null) }
    finally { h.lane.dispose() }
  })
  it('clarification replies retain their CAS and skip the context read', async () => {
    const h = harness()
    try {
      h.lane.choosePending({ outcome: { kind: 'CLARIFY', outcomeId: 'question-outcome', clarification: {
        state: 'OPEN', stateVersion: '2', pendingQuestionId: 'question', question: '颜色？'
      } } })
      await h.lane.submit({ content: '蓝色' })
      expect(h.calls.map(call => call[0])).to.deep.equal(['POST'])
      expect(h.calls[0][2]).to.include({ intent: 'CLARIFICATION_REPLY', parentOutcomeId: 'question-outcome', expectedPendingQuestionStateVersion: '2' })
    } finally { h.lane.dispose() }
  })
  it('invalidated page reads cannot replace a new identity result or clear its loading flag', async () => {
    const resolvers = []; const h = harness(() => new Promise(resolve => resolvers.push(resolve)))
    try {
      const old = h.lane.refreshDeliveryChoices(); h.actor.value = 'other'
      const fresh = h.lane.refreshDeliveryChoices(); resolvers[0](payload()); await old; await flush()
      expect(h.lane.deliveryLoading.value).to.equal(true); expect(h.lane.deliveryChoices.value).to.deep.equal([])
      resolvers[1](payload()); await fresh
      expect(h.lane.deliveryLoading.value).to.equal(false); expect(h.lane.deliveryChoices.value).to.have.length(1)
    } finally { h.lane.dispose() }
  })
})
