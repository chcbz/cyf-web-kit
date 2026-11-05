import { expect } from 'chai'
import { ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { batchDigest, freezeReviewIntent, reviewBody, validateContext, validateHistoryPage, validateReceipt } from '../src/composables/juyiting/hallDeliveryReviewIntent.js'
import { useHallDeliveryReview } from '../src/composables/juyiting/useHallDeliveryReview.js'
const fixture = JSON.parse(readFileSync(new URL('./fixtures/juyiting/delivery-review-contract.json', import.meta.url), 'utf8'))
const clone = value => JSON.parse(JSON.stringify(value))
const context = () => ({ schemaVersion: 1, taskId: 'task_fixture', taskVersion: '7', taskState: 'REVIEWING', assignmentRevision: '1',
  currentDelivery: { deliveryId: 'delivery_fixture', deliveryVersion: '0', state: 'SUBMITTED', batchSha256: fixture.batchDigestVector.expectedSha256,
    summary: '本轮成果', submittedAt: 123, items: fixture.batchDigestVector.items.map(([artifactId, artifactVersion, contentHash, purpose]) => ({
      artifactId, artifactVersion, contentHash, purpose, displayRole: purpose === 'manifest' ? 'MANIFEST' : 'RESULT',
      source: purpose === 'manifest' ? null : { kind: 'COMPLETED_MESSAGE', requestId: 'request-1', messageSource: { turnId: 'turn-1', messageId: '12', snapshotId: 'snapshot-1', finalSha256: 'a'.repeat(64) } }, unavailableReason: null })),
    allowedActions: ['VIEW', 'ACCEPT', 'REQUEST_CHANGES'] }, history: [], pendingOperation: null })
const memory = () => { const map = new Map(); return { map, getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) } }
const setup = (overrides = {}) => {
  const calls = []; const scope = ref('auth-1:owner-a'); const task = ref('task_fixture'); const storage = overrides.storage || memory()
  const api = overrides.api || { get: async (url, params, options) => { calls.push({ method: 'GET', url, ...options }); return context() },
    execute: async request => { calls.push(request); return fixture.acceptResponse.data } }
  const client = useHallDeliveryReview({ api, taskId: task, identityScope: scope, storage, idempotencyKeyFactory: () => 'review-fixture-0001', ...overrides })
  return { client, calls, scope, task, storage }
}
const ready = async client => { await client.refresh(); await flushPromises() }
describe('explicit whole-batch review contract and immutable recovery', () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  before(() => { if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true }) })
  after(() => { if (prior) Object.defineProperty(globalThis, 'crypto', prior); else delete globalThis.crypto })
  it('consumes the same published Java digest vector including the hidden manifest and Unicode', async () => {
    const c = context(); expect(await batchDigest(c.taskId, c.currentDelivery)).to.equal(fixture.batchDigestVector.expectedSha256)
    c.currentDelivery.items.reverse(); expect(await batchDigest(c.taskId, c.currentDelivery)).to.equal(fixture.batchDigestVector.expectedSha256)
    c.currentDelivery.items.pop(); expect(await batchDigest(c.taskId, c.currentDelivery)).not.to.equal(fixture.batchDigestVector.expectedSha256)
    expect(reviewBody(context())).to.deep.equal(fixture.acceptRequest.data)
  })
  it('does not coerce decimal versions or admit unknown fields/source unions/partial batches', () => {
    for (const mutate of [c => { c.taskVersion = 7 }, c => { c.taskVersion = '07' }, c => { c.assignmentRevision = '9223372036854775808' },
      c => { c.owner = 'forged' }, c => { c.currentDelivery.items[1].source.url = 'https://untrusted.invalid' },
      c => { c.currentDelivery.items.push(c.currentDelivery.items[0]) }, c => { c.taskState = 'COMPLETED' },
      c => { c.currentDelivery.items[1].source = null }, c => { c.history = [c.currentDelivery] }]) {
      const c = context(); mutate(c); expect(() => validateContext(c, 'task_fixture')).to.throw()
    }
    const c = context(); c.taskVersion = '9223372036854775807'; expect(validateContext(c, c.taskId).taskVersion).to.equal(c.taskVersion)
  })
  it('only a scoped ACCEPT committed/completed/accepted receipt is completion authority', () => {
    const intent = freezeReviewIntent(context(), 'owner-a', 'review-fixture-0001')
    expect(validateReceipt(fixture.acceptResponse.data, intent).state).to.equal('COMMITTED')
    for (const patch of [{ taskId: 'other' }, { deliveryId: 'other' }, { taskState: 'REVIEWING' }, { deliveryState: 'SUBMITTED' },
      { decision: 'REQUEST_CHANGES' }, { taskVersion: '7' }, { deliveryVersion: '0' }, { sourceRequestId: 'forged' }, { extra: true }, { stateVersion: 2 }])
      expect(() => validateReceipt({ ...fixture.acceptResponse.data, ...patch }, intent)).to.throw()
  })
  it('mount and open only read; explicit confirmation persists the exact whole batch before the sole POST', async () => {
    const s = setup(); try {
      await ready(s.client); expect(s.calls.filter(c => c.method === 'POST')).to.have.length(0)
      expect(await s.client.openConfirmation()).to.equal(true); expect(s.client.dialogOpen.value).to.equal(true)
      expect(s.calls.filter(c => c.method === 'POST')).to.have.length(0)
      const receipt = await s.client.confirmAcceptance()
      expect(receipt.state).to.equal('COMMITTED'); const posts = s.calls.filter(c => c.method === 'POST'); expect(posts).to.have.length(1)
      expect(posts[0].data).to.deep.equal(fixture.acceptRequest.data); expect(posts[0].headers['Idempotency-Key']).to.equal('review-fixture-0001')
      expect([...s.storage.map.values()]).to.have.length(1); expect(s.client.dialogOpen.value).to.equal(false)
      await s.client.confirmAcceptance(); expect(s.calls.filter(c => c.method === 'POST')).to.have.length(1)
    } finally { s.client.dispose() }
  })
  it('a changed current batch closes the frozen confirmation instead of silently replacing its contents', async () => {
    let c = context(); const s = setup({ api: { get: async () => clone(c), execute: async () => { throw new Error('must not POST') } } })
    try { await ready(s.client); await s.client.openConfirmation(); c.taskVersion = '8'; await s.client.refresh()
      expect(s.client.dialogOpen.value).to.equal(false); expect(s.client.error.value).to.include('已更新'); expect(await s.client.confirmAcceptance()).to.equal(null)
    } finally { s.client.dispose() }
  })
  it('lost ACK/remount only queries the original operation; explicit retry keeps the identical key/body', async () => {
    const storage = memory(); const calls = []; let first = true
    const api = { get: async () => context(), execute: async request => { calls.push(request)
      if (request.method === 'POST' && first) { first = false; throw new TypeError('connection lost') }
      if (request.method === 'GET') throw Object.assign(new Error('not yet found'), { status: 404 })
      return fixture.acceptResponse.data
    } }
    const a = setup({ storage, api }); await ready(a.client); await a.client.openConfirmation(); await a.client.confirmAcceptance(); a.client.dispose()
    const b = setup({ storage, api }); try {
      await ready(b.client); await flushPromises(); expect(calls.filter(c => c.method === 'POST')).to.have.length(1)
      expect(calls.some(c => c.method === 'GET' && c.url.endsWith('/request'))).to.equal(true)
      await b.client.resumeOriginal(); const posts = calls.filter(c => c.method === 'POST'); expect(posts).to.have.length(2)
      expect(posts[1].data).to.deep.equal(posts[0].data); expect(posts[1].headers).to.deep.equal(posts[0].headers)
    } finally { b.client.dispose() }
  })
  it('corrupt or unreadable recovery cannot overwrite an existing operation or POST a fresh key', async () => {
    const s = setup(); await ready(s.client); s.client.dispose()
    const key = [...s.storage.map.keys()][0] || 'cyf.hall.delivery-review.v1:auth-1%3Aowner-a:task_fixture'
    s.storage.setItem(key, '{bad')
    const b = setup({ storage: s.storage }); try { await ready(b.client); expect(b.client.operation.value.state).to.equal('recovery_error')
      expect(await b.client.openConfirmation()).to.equal(false); expect(b.calls.filter(c => c.method === 'POST')).to.have.length(0)
    } finally { b.client.dispose() }
  })
  it('storage readback failure prevents dispatch even after explicit confirmation', async () => {
    const s = setup({ storage: { getItem: () => null, setItem: () => {} } }); try {
      await ready(s.client); await s.client.openConfirmation(); expect(await s.client.confirmAcceptance()).to.equal(null)
      expect(s.calls.filter(c => c.method === 'POST')).to.have.length(0); expect(s.client.error.value).to.include('保存')
    } finally { s.client.dispose() }
  })
  it('identity switch aborts observation and ignores a late successful receipt without erasing the old account slot', async () => {
    let finish; const s = setup({ api: { get: async () => context(), execute: request => new Promise(resolve => { finish = resolve }) } })
    try { await ready(s.client); await s.client.openConfirmation(); const pending = s.client.confirmAcceptance(); await flushPromises()
      s.scope.value = 'auth-2:owner-b'; finish(fixture.acceptResponse.data); expect(await pending).to.equal(null)
      expect(s.client.operation.value.receipt).to.equal(null); expect([...s.storage.map.keys()].some(k => k.includes('owner-a'))).to.equal(true)
    } finally { s.client.dispose() }
  })
  it('accepts a semantically identical terminal receipt independent of JSON object-key order, but not changed fields', () => {
    const intent = freezeReviewIntent(context(), 'owner-a', 'review-fixture-0001')
    const receipt = validateReceipt(fixture.acceptResponse.data, intent)
    const reordered = Object.fromEntries(Object.entries(receipt).reverse())
    expect(validateReceipt(reordered, intent, receipt)).to.deep.equal(receipt)
    expect(() => validateReceipt({ ...reordered, retryable: true }, intent, receipt)).to.throw()
  })
  it('authorization-generation refresh recovers the same stored intent by GET only, never a fresh POST', async () => {
    const generation = ref(1); const calls = []
    const api = { get: async () => context(), execute: async request => { calls.push(request); throw new TypeError('lost ACK') } }
    const s = setup({ authorizationGeneration: generation, api })
    try {
      await ready(s.client); await s.client.openConfirmation(); await s.client.confirmAcceptance()
      const stored = [...s.storage.map.entries()]
      generation.value = 2; await flushPromises()
      expect(s.client.operation.value.intent.key).to.equal('review-fixture-0001')
      expect([...s.storage.map.entries()]).to.deep.equal(stored)
      expect(calls.filter(c => c.method === 'POST')).to.have.length(1)
      expect(calls.filter(c => c.method === 'GET')).to.have.length(1)
    } finally { s.client.dispose() }
    const before = calls.length; generation.value = 3; await flushPromises(); expect(calls).to.have.length(before)
  })
  it('does not erase a committed intent until the authoritative accepted batch is read back', async () => {
    let c = context(); const s = setup({ api: { get: async () => clone(c), execute: async () => fixture.acceptResponse.data } })
    try {
      await ready(s.client); await s.client.openConfirmation(); await s.client.confirmAcceptance()
      expect(await s.client.settleOriginal()).to.equal(false); expect(s.storage.map.size).to.equal(1)
      expect(s.client.recoveryNeeded.value).to.equal(true)
      c.taskVersion = '8'; c.taskState = 'COMPLETED'; c.currentDelivery.state = 'ACCEPTED'; c.currentDelivery.deliveryVersion = '1'
      c.currentDelivery.allowedActions = ['VIEW']; c.currentDelivery.batchSha256 = await batchDigest(c.taskId, c.currentDelivery)
      await s.client.refresh()
      expect(s.client.recoveryNeeded.value).to.equal(false)
      expect(s.storage.map.size).to.equal(1) // Hide controls without discarding the original recovery identity.
      expect(await s.client.settleOriginal()).to.equal(true); expect(s.storage.map.size).to.equal(0)
      expect(s.client.operation.value.receipt.state).to.equal('COMMITTED'); expect(s.client.canReview.value).not.to.equal(true)
    } finally { s.client.dispose() }
  })
  it('settles a durable rejection by authoritative read before allowing a new explicit confirmation', async () => {
    const rejection = { ...fixture.acceptResponse.data, state: 'REJECTED', taskState: 'REVIEWING', taskVersion: '7', deliveryState: 'SUBMITTED', deliveryVersion: '0', errorCode: 'DELIVERY_REVIEW_CONFLICT' }
    const s = setup({ api: { get: async () => context(), execute: async () => rejection } })
    try {
      await ready(s.client); await s.client.openConfirmation(); await s.client.confirmAcceptance()
      expect(await s.client.openConfirmation()).to.equal(false)
      expect(await s.client.settleOriginal()).to.equal(true); expect(s.storage.map.size).to.equal(0)
      expect(await s.client.openConfirmation()).to.equal(true)
    } finally { s.client.dispose() }
  })

})

describe('current-only formal review and explicit history keyset pages', () => {
  it('consumes the exact shared public-envelope fixture and immutable batch digest', async () => {
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/juyiting/delivery-review-pages.json', import.meta.url), 'utf8'))
    const c = validateContext(fixture.currentResponse.data, 'task_fixture')
    const page = validateHistoryPage(fixture.historyResponse.data)
    expect(c.schemaVersion).to.equal(2); expect(c.history).to.deep.equal([])
    expect(await batchDigest(c.taskId, c.currentDelivery)).to.equal(c.currentDelivery.batchSha256)
    expect(await batchDigest(c.taskId, page.items[0])).to.equal(page.items[0].batchSha256)
    expect(page.items[0].allowedActions).to.deep.equal(['VIEW'])
  })
  const current = () => ({ ...context(), schemaVersion: 2 })
  const historical = async id => {
    const batch = { ...context().currentDelivery, deliveryId: id, allowedActions: ['VIEW'] }
    batch.batchSha256 = await batchDigest('task_fixture', batch)
    return batch
  }
  it('loads no history on current reads or confirmation, and only one page for explicit opening', async () => {
    const calls = []; const b = await historical('old-1')
    const s = setup({ api: { get: async (url, params) => { calls.push({ url, params }); return url.endsWith('/delivery-review-history') ? { items: [b], nextCursor: '81', hasMore: true } : current() } } })
    try {
      await ready(s.client); await s.client.openConfirmation()
      expect(calls.filter(c => c.url.endsWith('/delivery-review-history'))).to.have.length(0)
      expect(s.client.canReview.value).to.equal(true)
      await s.client.ensureHistory(); await s.client.ensureHistory()
      expect(calls.filter(c => c.url.endsWith('/delivery-review-history'))).to.have.length(1)
      expect(s.client.historyContext.value.history).to.deep.equal([b]); expect(s.client.context.value.history).to.deep.equal([])
    } finally { s.client.dispose() }
  })
  it('retains loaded pages and current acceptance when an older page fails, retrying the same cursor', async () => {
    const b = await historical('old-1'); const c = await historical('old-2'); const cursors = []; let fail = true
    const s = setup({ api: { get: async (url, params) => {
      if (!url.endsWith('/delivery-review-history')) return current()
      cursors.push(params.beforeRevision || null)
      if (!params.beforeRevision) return { items: [b], nextCursor: '81', hasMore: true }
      if (fail) throw new Error('history unavailable')
      return { items: [c], nextCursor: null, hasMore: false }
    } } })
    try {
      await ready(s.client); await s.client.loadHistory(); expect(await s.client.loadHistory()).to.equal(false)
      expect(s.client.historyError.value).to.equal('history unavailable'); expect(s.client.canReview.value).to.equal(true)
      expect(s.client.historyContext.value.history).to.deep.equal([b]); fail = false
      expect(await s.client.loadHistory()).to.equal(true); expect(cursors).to.deep.equal([null, '81', '81'])
      expect(s.client.historyContext.value.history).to.deep.equal([b, c]); expect(s.client.historyHasMore.value).to.equal(false)
    } finally { s.client.dispose() }
  })
  it('keeps more than 100 explicitly loaded batches without using them as acceptance authority', async () => {
    const batches = await Promise.all(Array.from({ length: 125 }, (_, i) => historical(`old-${125 - i}`)))
    let pages = 0
    const s = setup({ api: { get: async url => {
      if (!url.endsWith('/delivery-review-history')) return current()
      const items = batches.slice(pages * 20, ++pages * 20); const more = pages * 20 < batches.length
      return { items, nextCursor: more ? String(126 - pages * 20) : null, hasMore: more }
    } } })
    try {
      await ready(s.client); await s.client.loadHistory()
      expect(pages).to.equal(1)
      while (s.client.historyHasMore.value) await s.client.loadHistory()
      expect(pages).to.equal(7); expect(s.client.historyContext.value.history).to.have.length(125)
      expect(s.client.context.value.history).to.deep.equal([]); expect(s.client.canReview.value).to.equal(true)
      await s.client.refresh(); expect(pages).to.equal(7); expect(s.client.historyContext.value.history).to.have.length(125)
    } finally { s.client.dispose() }
  })
  it('does not skip a corrupt digest or nonadvancing cursor', async () => {
    const b = await historical('old-1'); let response = { items: [b], nextCursor: '81', hasMore: true }
    const s = setup({ api: { get: async url => url.endsWith('/delivery-review-history') ? response : current() } })
    try {
      await ready(s.client); await s.client.loadHistory()
      expect(await s.client.loadHistory()).to.equal(false)
      response = { items: [{ ...b, batchSha256: '0'.repeat(64) }], nextCursor: '61', hasMore: true }
      expect(await s.client.loadHistory()).to.equal(false)
      expect(s.client.historyContext.value.history).to.deep.equal([b]); expect(s.client.historyHasMore.value).to.equal(true)
    } finally { s.client.dispose() }
  })
  for (const boundary of ['version', 'identity', 'dispose']) it(`cancels an in-flight page on ${boundary} change and fences its late result`, async () => {
    let resolve; let signal; let c = current(); let reads = 0
    const s = setup({ api: { get: async (url, _params, options) => {
      if (!url.endsWith('/delivery-review-history')) return c
      reads++; signal = options.signal; return new Promise(done => { resolve = done })
    } } })
    try {
      await ready(s.client); const pending = s.client.loadHistory(); expect(await s.client.loadHistory()).to.equal(false)
      expect(reads).to.equal(1)
      if (boundary === 'version') { c = { ...c, taskVersion: '8' }; await s.client.refresh() }
      else if (boundary === 'identity') { s.scope.value = 'other'; await ready(s.client) }
      else s.client.dispose()
      expect(signal.aborted).to.equal(true)
      resolve({ items: [await historical('old-1')], nextCursor: null, hasMore: false }); await pending
      expect(s.client.historyLoaded.value).to.equal(false); expect(s.client.historyContext.value?.history || []).to.deep.equal([])
    } finally { s.client.dispose() }
  })
  it('uses explicit legacy v1 complete history without probing a new endpoint', async () => {
    const s = setup()
    try { await ready(s.client); const count = s.calls.length; await s.client.loadHistory(); expect(s.calls).to.have.length(count); expect(s.client.historyLoaded.value).to.equal(true) }
    finally { s.client.dispose() }
  })
})
