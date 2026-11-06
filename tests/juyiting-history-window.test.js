import { expect } from 'chai'
import { historyWindowSegments, historyWindowAnchor, historyWindowAnchorTop, retainedHistoryPageKeys } from '../src/composables/juyiting/hallHistoryWindow.js'

const pages = count => Array.from({ length: count }, (_, index) => ({ key: String(index), height: 500, cursor: `at:1000:${20 * (index + 1)}` }))
describe('continuous variable-height history window geometry', () => {
  it('bounds rendered pages by viewport, not by the number of visited pages', () => {
    const history = pages(10000)
    const segments = historyWindowSegments(history, { top: 2500000, height: 700 })
    expect(segments.filter(segment => !segment.spacer)).to.have.length.lessThan(7)
    expect(segments.filter(segment => segment.spacer)).to.have.length(2)
    expect(segments.reduce((sum, segment) => sum + segment.height, 0)).to.equal(5000000)
  })
  it('keeps only explicit distant interaction pins without retaining the intervening pages', () => {
    const history = pages(10000)
    const view = { top: 2500000, height: 700, pinned: new Set(['1', '9998']) }
    const retained = retainedHistoryPageKeys(history, view)
    expect(retained.has('1')).to.equal(true)
    expect(retained.has('9998')).to.equal(true)
    expect(retained.has('2000')).to.equal(false)
    expect(retained.size).to.be.lessThan(9)
    expect(historyWindowSegments(history, view).filter(segment => segment.spacer)).to.have.length(4)
  })
  it('restores the same page offset after prepend, release and media resize', () => {
    const history = pages(10)
    const anchor = historyWindowAnchor(history, 1250, 700)
    expect(anchor).to.deep.equal({ key: '2', within: 250 })
    history.unshift({ key: 'older', height: 800 })
    expect(historyWindowAnchorTop(history, anchor, 700)).to.equal(2050)
    history[1].height = 1300
    expect(historyWindowAnchorTop(history, anchor, 700)).to.equal(2850)
    // Releasing body data does not change measured page height.
    history[1].items = undefined
    expect(historyWindowAnchorTop(history, anchor, 700)).to.equal(2850)
  })
  it('uses measured heights rather than a message-count truncation', () => {
    const history = [{ key: 'tall', height: 20000 }, ...pages(20)]
    expect([...retainedHistoryPageKeys(history, { top: 5000, height: 700 })]).to.deep.equal(['tall'])
    expect(historyWindowAnchor(history, 19999, 700)).to.deep.equal({ key: 'tall', within: 19999 })
    expect(historyWindowAnchor(history, 20000, 700)).to.deep.equal({ key: '0', within: 0 })
  })
  it('handles initial unknown sizes and missing anchors without inventing a scroll target', () => {
    expect(historyWindowSegments([])).to.deep.equal([])
    expect(historyWindowAnchor([], 0)).to.equal(null)
    expect(historyWindowAnchorTop(pages(2), { key: 'gone', within: 10 }, 700)).to.equal(null)
    expect(historyWindowSegments([{ key: 'unknown' }], { height: 600 })[0].height).to.equal(600)
  })
})

import { HallHistoryPageCache } from '../src/composables/juyiting/hallHistoryPageCache.js'
const response = (first, last, hasMore = first > 1) => ({
  items: Array.from({ length: last - first + 1 }, (_, i) => ({ id: String(first + i), createTime: 1000, content: `body-${first + i}` })),
  hasMore, nextCursor: hasMore ? `1000:${first}` : null
})
describe('history page body ownership', () => {
  it('releases body data while retaining stable reload locators', () => {
    const cache = new HallHistoryPageCache()
    cache.latest(response(981, 1000))
    for (let end = 980; end >= 20; end -= 20) {
      const page = cache.prepend(response(end - 19, end))
      cache.retain(new Set([page.key]))
    }
    expect(cache.pages).to.have.length(50)
    expect(cache.bodies.size).to.equal(1)
    expect(cache.items()).to.have.length(20)
    expect(cache.pages.at(-1).cursor).to.equal('at:1000:1000')
    expect(cache.pages.every(page => !('content' in page) && !('items' in page))).to.equal(true)
    cache.load(cache.pages.at(-1).key, response(981, 1000))
    expect(cache.items().at(-1).id).to.equal('1000')
  })
  it('does not refill latest bodies while reading far-away history', () => {
    const cache = new HallHistoryPageCache()
    cache.latest(response(21, 40))
    const old = cache.prepend(response(1, 20))
    cache.retain(new Set([old.key]))
    cache.latest(response(23, 42))
    expect(cache.bodies.size).to.equal(1)
    expect(cache.items().map(item => item.id)).to.deep.equal(response(1, 20).items.map(item => item.id))
    expect(cache.pages.at(-1).ids).to.deep.equal(['41', '42'])
    cache.load(cache.pages.at(-1).key, response(23, 42))
    expect(cache.items().slice(-2).map(item => item.id)).to.deep.equal(['41', '42'])
  })
  it('locates reconnect gaps lazily without losing intervening messages', () => {
    const cache = new HallHistoryPageCache()
    cache.latest(response(1, 20))
    cache.latest(response(61, 80))
    const gap = cache.pages.find(page => page.gap)
    expect(gap.cursor).to.equal('1000:61')
    cache.load(gap.key, response(41, 60))
    expect(cache.pages.find(page => page.gap).cursor).to.equal('1000:41')
    cache.load(gap.key, response(21, 40))
    cache.load(gap.key, response(1, 20))
    expect(cache.pages.some(page => page.gap)).to.equal(false)
    expect(cache.items().map(item => item.id)).to.deep.equal(response(1, 80).items.map(item => item.id))
  })
  it('coalesces live arrivals into twenty-message reload pages', () => {
    const cache = new HallHistoryPageCache()
    cache.latest(response(1, 20))
    for (let last = 21; last <= 60; last++) cache.latest(response(last - 19, last))
    expect(cache.pages.map(page => page.ids.length)).to.deep.equal([20, 20, 20])
    expect(cache.items().map(item => item.id)).to.deep.equal(response(1, 60).items.map(item => item.id))
    expect(cache.pages.at(-1).cursor).to.equal('at:1000:60')
    cache.retain(new Set([cache.pages[0].key]))
    for (let last = 61; last <= 80; last++) cache.latest(response(last - 19, last))
    expect(cache.pages.map(page => page.ids.length)).to.deep.equal([20, 20, 20, 20])
    expect(cache.bodies.size).to.equal(1)
  })
  it('pins only named pages, and reset releases both data and locators', () => {
    const cache = new HallHistoryPageCache()
    cache.latest(response(41, 60))
    cache.prepend(response(21, 40))
    cache.prepend(response(1, 20))
    cache.retain(new Set([cache.pages[0].key, cache.pages[2].key]))
    expect(cache.bodies.size).to.equal(2)
    expect(cache.items()).to.have.length(40)
    cache.reset()
    expect(cache.pages).to.deep.equal([])
    expect(cache.bodies.size).to.equal(0)
  })
})
