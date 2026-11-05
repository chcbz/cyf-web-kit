import { readFileSync } from 'node:fs'
import { expect } from 'chai'
import { ref } from 'vue'
import { normalizeHallMessage } from '../src/composables/juyiting/hallConversationMessages.js'
import { hallMessagePage, useHallMessagePages } from '../src/composables/juyiting/useHallMessagePages.js'

const row = id => ({ id: String(id), createTime: 1000, content: `message-${id}` })
const page = (ids, nextCursor = null) => ({ items: ids.map(row), hasMore: nextCursor !== null, nextCursor })
const setup = get => {
  const messages = ref([]), conversationId = ref('100'), identityKey = ref('owner')
  const calls = []
  const pages = useHallMessagePages({ messages, conversationId, identityKey,
    captureGuard: () => identityKey.value, guardCurrent: guard => guard === identityKey.value,
    normalize: item => ({ localId: item.id, timestamp: item.createTime, content: item.content }),
    chatApi: { get: async (...args) => { calls.push(args.slice(0, 2)); return get(...args) } } })
  return { messages, conversationId, identityKey, calls, pages }
}
describe('hall message display pages', () => {
  it('loads twenty older messages in one request and waits for the next explicit page action', async () => {
    const ids = (first, last) => Array.from({ length: last - first + 1 }, (_, index) => first + index)
    const h = setup(async (_path, params, options) => options.onSuccess(params.cursor === '1000:22'
      ? page(ids(2, 21), '1000:2') : page([1])))
    h.pages.applyLatest(page(ids(22, 41), '1000:22'))
    expect(h.messages.value).to.have.length(20)
    expect(h.calls).to.have.length(0)
    expect(await h.pages.loadOlder()).to.equal(true)
    expect(h.calls).to.deep.equal([['/conversation/messages', { id: '100', cursor: '1000:22' }]])
    expect(h.messages.value).to.have.length(40)
    expect(h.pages.hasMore.value).to.equal(true)
    expect(await h.pages.loadOlder()).to.equal(true)
    expect(h.calls).to.have.length(2)
    expect(h.messages.value.map(item => item.localId)).to.deep.equal(ids(1, 41).map(String))
    expect(h.pages.hasMore.value).to.equal(false)
    expect(await h.pages.loadOlder()).to.equal(false)
    expect(h.calls).to.have.length(2)
    h.pages.dispose()
  })

  it('consumes the exact shared HTTP fixture after the existing envelope boundary', () => {
    const wire = JSON.parse(readFileSync(new URL('./fixtures/hall-message-page.json', import.meta.url), 'utf8'))
    expect(wire.protocolVersion).to.equal(1)
    expect(wire.code).to.equal('E0')
    const parsed = hallMessagePage(wire.data)
    expect(parsed.items[0].id).to.equal('9007199254740993')
    expect(parsed.nextCursor).to.equal('1000:9007199254740993')
  })
  it('loads no earlier pages automatically, and requests exactly one page on demand', async () => {
    const h = setup(async (_path, _params, options) => options.onSuccess(page([1, 2])))
    h.pages.applyLatest(page([3, 4], '1000:3'))
    expect(h.calls).to.have.length(0)
    expect(await h.pages.loadOlder()).to.equal(true)
    expect(h.calls).to.deep.equal([['/conversation/messages', { id: '100', cursor: '1000:3' }]])
    expect(h.messages.value.map(row => row.localId)).to.deep.equal(['1', '2', '3', '4'])
    expect(h.pages.hasMore.value).to.equal(false)
    expect(await h.pages.loadOlder()).to.equal(false)
    expect(h.calls).to.have.length(1)
    h.pages.dispose()
  })
  it('keeps explicitly loaded older messages when authoritative latest window refreshes', async () => {
    const h = setup(async (_path, _params, options) => options.onSuccess(page([1, 2])))
    h.pages.applyLatest(page([3, 4], '1000:3'))
    await h.pages.loadOlder()
    h.pages.applyLatest(page([3, 4, 5], '1000:3'))
    expect(h.messages.value.map(row => row.localId)).to.deep.equal(['1', '2', '3', '4', '5'])
    expect(h.pages.hasMore.value).to.equal(false)
    h.pages.dispose()
  })
  it('retains nullable historical timestamps across latest reloads without duplicating messages', async () => {
    const h = setup(async (_path, _params, options) => options.onSuccess({ items: [{ ...row(1), createTime: null }], hasMore: false, nextCursor: null }))
    h.pages.applyLatest(page([3, 4], '1000:3'))
    await h.pages.loadOlder()
    h.pages.applyLatest(page([3, 4, 5], '1000:3'))
    expect(h.messages.value.map(row => row.localId)).to.deep.equal(['1', '3', '4', '5'])
    expect(hallMessagePage({ items: [{ ...row(1), createTime: null }], hasMore: true, nextCursor: 'n:1' }).hasMore).to.equal(true)
    h.pages.dispose()
  })
  it('deduplicates overlapping messages and never automatically reads the next cursor', async () => {
    const h = setup(async (_path, _params, options) => options.onSuccess(page([1, 2, 3], '1000:1')))
    h.pages.applyLatest(page([3, 4], '1000:3'))
    await h.pages.loadOlder()
    expect(h.messages.value.map(row => row.localId)).to.deep.equal(['1', '2', '3', '4'])
    expect(h.calls).to.have.length(1)
    h.pages.dispose()
  })
  for (const key of ['conversationId', 'identityKey']) it(`discards an in-flight page after ${key} changes`, async () => {
    let complete
    const h = setup((_path, _params, options) => new Promise(resolve => { complete = () => { options.onSuccess(page([1, 2])); resolve() } }))
    h.pages.applyLatest(page([3, 4], '1000:3'))
    const flight = h.pages.loadOlder()
    expect(await h.pages.loadOlder()).to.equal(false)
    h[key].value = 'changed'
    h.messages.value = []
    complete()
    expect(await flight).to.equal(false)
    expect(h.messages.value).to.deep.equal([])
    expect(h.pages.loading.value).to.equal(false)
    expect(h.pages.hasMore.value).to.equal(false)
    h.pages.dispose()
  })
  it('retains displayed messages and cursor after failure, allowing explicit retry', async () => {
    let attempts = 0
    const h = setup(async (_path, _params, options) => { if (++attempts === 1) throw new Error('offline'); options.onSuccess(page([1, 2])) })
    h.pages.applyLatest(page([3, 4], '1000:3'))
    expect(await h.pages.loadOlder()).to.equal(false)
    expect(h.messages.value).to.have.length(2)
    expect(h.pages.error.value).to.equal('offline')
    expect(await h.pages.loadOlder()).to.equal(true)
    expect(h.pages.error.value).to.equal('')
    h.pages.dispose()
  })
  it('replaces the matching live turn with its stored final, without dropping another active turn', () => {
    const messages = ref([{ localId: 'live-one', turnId: 'turn-one', streaming: true }, { localId: 'live-two', turnId: 'turn-two', streaming: true }])
    const pages = useHallMessagePages({ chatApi: {}, messages, conversationId: ref('100'), identityKey: ref('owner'),
      captureGuard: () => 1, guardCurrent: () => true, normalize: item => normalizeHallMessage(item, '') })
    try {
      pages.applyLatest({ items: [{ ...row(10), metadata: { turnId: 'turn-one' } }], hasMore: false, nextCursor: null })
      expect(messages.value.map(value => value.localId)).to.deep.equal(['10', 'live-two'])
    } finally { pages.dispose() }
  })
  it('rejects malformed response rather than silently treating it as empty history', () => {
    for (const value of [[], {}, { items: [], hasMore: true, nextCursor: '1000:1' }, page([1], '1000:01')]) {
      expect(() => hallMessagePage(value)).to.throw()
    }
  })
})
