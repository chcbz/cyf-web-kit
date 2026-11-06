const keyOf = item => String(item.id)
const anchorOf = item => `at:${item.createTime ?? 'n'}:${item.id}`
const requestIdsFor = (ids, response) => (response.requestPage?.entries || []).filter(entry =>
  ids.includes(entry.request.userMessageId) || entry.request.turns.some(turn => ids.includes(turn.finalMessageId))
).map(entry => entry.request.requestId)
const summaryKey = value => `${value.requestId}\u0000${value.turnId}`
const pageBody = (items, response, previous = null) => {
  const ids = new Set(items.map(keyOf))
  const requests = new Set(requestIdsFor([...ids], response))
  const summaries = new Map((previous?.outcomeSummaries || []).map(value => [summaryKey(value), value]))
  for (const value of response.outcomeSummaries || []) summaries.set(summaryKey(value), value)
  return { ...response, items, outcomeSummaries: [...summaries.values()].filter(value =>
    value.outcome ? ids.has(value.outcome.assistantMessageId) : requests.has(value.requestId)) }
}
const boundaryOf = item => ({ id: keyOf(item), createTime: item.createTime ?? null })

/** Body ownership for a continuous history window. Evicted pages keep only locators. */
export class HallHistoryPageCache {
  constructor () { this.pages = []; this.serial = 0; this.bodies = new Map() }
  reset () { this.pages = []; this.bodies.clear(); this.serial = 0 }
  create (items, response, retain = true) {
    const page = { key: `page-${++this.serial}`, ids: items.map(keyOf), cursor: anchorOf(items.at(-1)),
      requestIds: requestIdsFor(items.map(keyOf), response), oldest: boundaryOf(items[0]), newest: boundaryOf(items.at(-1)), height: 0 }
    if (retain) this.bodies.set(page.key, pageBody(items, response))
    return page
  }
  prepend (response) {
    const known = new Set(this.pages.flatMap(page => page.ids || []))
    const items = response.items.filter(item => !known.has(keyOf(item)))
    if (items.length) this.pages.unshift(this.create(items, response))
    return this.pages[0]
  }
  /** Latest reads update known pages but do not refill evicted bodies. */
  latest (response) {
    if (!response.items.length) return
    const known = new Set(this.pages.flatMap(page => page.ids || []))
    const incoming = new Set(response.items.map(keyOf))
    const last = this.pages.at(-1)
    const retain = !last || this.bodies.has(last.key)
    for (const page of this.pages) {
      if (page.gap || !page.ids.some(id => incoming.has(id)) || !this.bodies.has(page.key)) continue
      const nextRequests = requestIdsFor(page.ids, response)
      page.requestIds = [...new Set([...page.requestIds, ...nextRequests])]
      const previous = this.bodies.get(page.key)
      const byId = new Map(previous.items.map(item => [keyOf(item), item]))
      for (const item of response.items) if (page.ids.includes(keyOf(item))) byId.set(keyOf(item), item)
      // Presentation snapshots are supplied separately: no stale response replaces an entire page.
      this.bodies.set(page.key, pageBody(page.ids.map(id => byId.get(id)).filter(Boolean), response, previous))
    }
    const added = response.items.filter(item => !known.has(keyOf(item)))
    if (!added.length) return
    if (last && !response.items.some(item => known.has(keyOf(item))) && response.hasMore) {
      // A reconnect may skip more than twenty new rows. Keep a lazy gap, not an implicit full scan.
      this.pages.push({ key: `gap-${++this.serial}`, gap: true, cursor: response.nextCursor, ids: [], height: 0 })
    }
    else if (last && last.ids.length < 20) {
      // Keep live arrivals in protocol-sized pages, not one reload request per SSE final.
      const portion = added.splice(0, 20 - last.ids.length)
      last.ids.push(...portion.map(keyOf))
      last.newest = boundaryOf(portion.at(-1))
      last.cursor = anchorOf(portion.at(-1))
      last.requestIds = [...new Set([...last.requestIds, ...requestIdsFor(last.ids, response)])]
      if (retain) {
        const previous = this.bodies.get(last.key)
        this.bodies.set(last.key, pageBody([...previous.items, ...portion], response, previous))
      }
    }
    if (added.length) this.pages.push(this.create(added, response, retain))
  }
  load (key, response) {
    const index = this.pages.findIndex(page => page.key === key)
    if (index < 0) return false
    const page = this.pages[index]
    if (!page.gap) {
      const ids = new Set(page.ids)
      page.requestIds = requestIdsFor(page.ids, response)
      this.bodies.set(key, pageBody(response.items.filter(item => ids.has(keyOf(item))), response))
      return true
    }
    const known = new Set(this.pages.flatMap(value => value.ids || []))
    const items = response.items.filter(item => !known.has(keyOf(item)))
    const replacements = []
    if (response.hasMore && !response.items.some(item => known.has(keyOf(item)))) {
      replacements.push({ ...page, cursor: response.nextCursor })
    }
    if (items.length) replacements.push(this.create(items, response))
    this.pages.splice(index, 1, ...replacements)
    return true
  }
  retain (keys) {
    for (const key of this.bodies.keys()) if (!keys.has(key)) this.bodies.delete(key)
  }
  items () {
    return this.pages.flatMap(page => {
      const body = this.bodies.get(page.key)
      if (!body) return []
      const ids = new Set(page.ids)
      return body.items.filter(item => ids.has(keyOf(item)))
    })
  }
}
