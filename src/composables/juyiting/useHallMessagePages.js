import { ref, shallowRef, watch } from 'vue'
import { catalogPage, mergeCatalogEntries } from './bountyRequestCatalog.js'
import { isTerminalRequestState } from './hallDeliberationState.js'
import { HallHistoryPageCache } from './hallHistoryPageCache.js'
import { canonicalWireString } from './hallConversationMessages.js'

export const hallMessagePage = value => {
  if (!value || !Array.isArray(value.items) || typeof value.hasMore !== 'boolean' ||
      (value.hasMore ? typeof value.nextCursor !== 'string' : value.nextCursor !== null)) throw new Error('消息分页响应无效，请重试。')
  if (value.hasMore) {
    const parts = value.nextCursor.split(':')
    if (!value.items.length || parts.length !== 2 || (parts[0] !== 'n' && !canonicalWireString(parts[0], { allowZero: true })) ||
        !canonicalWireString(parts[1])) throw new Error('消息分页游标无效，请重试。')
  }
  return value
}

/** Body is carried once on the wire, in items; outcomes only reference its message ID. */
export const messagePageOutcomes = page => {
  if (!Array.isArray(page.outcomeSummaries)) throw new Error('消息页的答复展示数据缺失，请重试。')
  const messages = new Map(page.items.map(item => [String(item.id), item]))
  return page.outcomeSummaries.flatMap(summary => {
    if (summary?.schemaVersion !== 1) throw new Error('消息页的答复摘要版本无效，请重试。')
    // Historical structured data can be unavailable without hiding its readable message.
    if (summary.unavailableReason === 'STORED_OUTCOME_UNAVAILABLE') return []
    if (!summary.outcome) return [{ ...summary, schemaVersion: 6 }]
    const message = messages.get(summary.outcome.assistantMessageId)
    if (!message || typeof message.content !== 'string') throw new Error('答复摘要缺少同页消息正文，请重试。')
    return [{ ...summary, schemaVersion: 6, outcome: { ...summary.outcome, text: message.content } }]
  })
}

/** Display pagination only: loading old pages must never replay final replies or restart SSE. */
export const useHallMessagePages = ({ chatApi, messages, conversationId, identityKey, captureGuard, guardCurrent, normalize }) => {
  const cache = new HallHistoryPageCache()
  const windows = shallowRef([])
  const windowLoading = ref(new Set())
  const windowErrors = ref({})
  const windowFlights = new Map()
  let latestRequestId = null
  let retentionEnabled = false
  const publishWindows = () => { windows.value = cache.pages.map(page => ({ ...page, loaded: cache.bodies.has(page.key) })) }
  const requestPage = ref(null)
  const typedOutcomes = ref([])
  const hasMore = ref(false)
  const loading = ref(false)
  const error = ref('')
  let before = null
  let initialized = false
  let olderLoaded = false
  let revision = 0
  let controller = null
  const reset = () => {
    revision++
    for (const flight of windowFlights.values()) flight.abort()
    windowFlights.clear(); windowLoading.value = new Set(); windowErrors.value = {}
    cache.reset(); publishWindows(); latestRequestId = null; retentionEnabled = false
    controller?.abort()
    controller = null
    before = null
    requestPage.value = null
    typedOutcomes.value = []
    initialized = false
    olderLoaded = false
    hasMore.value = false
    loading.value = false
    error.value = ''
  }
  const stop = watch([conversationId, identityKey], reset, { flush: 'sync' })
  const normalizeStored = (item, page) => {
    const message = normalize(item)
    if (!message) return null
    const unavailableTurns = new Set((page.outcomeSummaries || []).filter(value => value.unavailableReason).map(value => value.turnId))
    const unavailable = unavailableTurns.has(message.turnId) || (page.requestPage?.entries || []).some(entry =>
      entry.request.turns.some(turn => unavailableTurns.has(turn.turnId) && turn.finalMessageId === message.localId))
    return { ...message, historyCreatedAt: item.createTime ?? null, typedDisplayUnavailable: unavailable }
  }
  const beforeMessage = (item, first) => {
    if (item.historyCreatedAt === null && first.historyCreatedAt !== null) return true
    if (item.historyCreatedAt !== null && first.historyCreatedAt === null) return false
    return item.historyCreatedAt < first.historyCreatedAt ||
      (item.historyCreatedAt === first.historyCreatedAt && BigInt(item.localId) < BigInt(first.localId))
  }
  const adoptRequests = page => {
    if (page.requestPage == null) return
    const pageOutcomes = messagePageOutcomes(page)
    const parsed = catalogPage(page.requestPage, { conversationId: conversationId.value, after: '0' })
    if (!parsed || parsed.hasMore) throw new Error('消息页的议事记录范围不匹配，请重试。')
    const previous = requestPage.value
    const entries = mergeCatalogEntries(previous?.entries || [], parsed)
    if (!entries) throw new Error('消息页的议事状态已变化，请重试。')
    const through = previous && BigInt(previous.through) > BigInt(parsed.through) ? previous.through : parsed.through
    const outcomes = new Map(typedOutcomes.value.map(value => [`${value.requestId}\u0000${value.turnId}`, value]))
    for (const value of pageOutcomes) outcomes.set(`${value.requestId}\u0000${value.turnId}`, value)
    typedOutcomes.value = [...outcomes.values()]
    requestPage.value = { ...parsed, entries, through, eventCursor: parsed.eventCursor ?? previous?.eventCursor ?? null }
  }
  const applyLatest = value => {
    const page = hallMessagePage(value)
    adoptRequests(page)
    const latestRequest = page.requestPage?.entries.at(-1)?.request
    latestRequestId = latestRequest && !isTerminalRequestState(latestRequest.state) ? latestRequest.requestId : null
    cache.latest(page)
    publishWindows()
    const latest = page.items.map(item => normalizeStored(item, page)).filter(Boolean)
    // Retain explicitly loaded older pages; replace the latest window and transient
    // placeholders using the existing authoritative recovery path.
    const first = latest[0]
    const latestIds = new Set(latest.map(item => item.localId))
    const older = olderLoaded && first ? messages.value.filter(item =>
      canonicalWireString(item.localId) && !item.streaming && !latestIds.has(item.localId) && beforeMessage(item, first)) : []
    const finalTurns = new Set(latest.filter(item => !item.streaming).map(item => item.turnId).filter(Boolean))
    const live = messages.value.filter(item => item.streaming && item.turnId && !finalTurns.has(item.turnId))
    messages.value = older.concat(latest, live)
    if (!initialized) { before = page.nextCursor; hasMore.value = page.hasMore }
    initialized = true
    if (retentionEnabled) { syncRetainedMessages(); prunePresentation() }
    return latest
  }
  const loadOlder = async () => {
    if (loading.value || !hasMore.value || !before || !conversationId.value) return false
    const id = conversationId.value
    const guard = captureGuard()
    const generation = revision
    const cursor = before
    const abort = new AbortController()
    controller = abort
    const current = () => generation === revision && guardCurrent(guard) && id === conversationId.value
    loading.value = true
    error.value = ''
    let applied = false
    try {
      await chatApi.get('/conversation/messages', { id, cursor }, {
        autoLoading: false, signal: abort.signal,
        onSuccess: value => {
          if (!current()) return
          const page = hallMessagePage(value)
          if (page.hasMore && page.nextCursor === cursor) throw new Error('消息分页未前进，请重试。')
          adoptRequests(page)
          cache.prepend(page)
          publishWindows()
          const existing = new Set(messages.value.map(item => item.localId))
          const earlier = page.items.map(item => normalizeStored(item, page)).filter(item => item && !existing.has(item.localId))
          messages.value = earlier.concat(messages.value)
          before = page.nextCursor
          hasMore.value = page.hasMore
          olderLoaded = true
          applied = true
        },
        onError: cause => { if (current()) error.value = cause?.message || '更早消息加载失败，请重试。' }
      })
      if (current() && !applied && !error.value) error.value = '更早消息加载失败，请重试。'
    } catch (cause) {
      if (current() && cause?.name !== 'AbortError') error.value = cause?.message || '更早消息加载失败，请重试。'
    } finally {
      if (current()) { loading.value = false; controller = null }
    }
    return applied && current()
  }
  const prunePresentation = () => {
    const allowed = new Set(cache.pages.filter(page => cache.bodies.has(page.key)).flatMap(page => page.requestIds || []))
    if (latestRequestId) allowed.add(latestRequestId)
    // One direct child belongs to its retained parent card; no historical recursive walk.
    for (const value of typedOutcomes.value) if (allowed.has(value.requestId)) {
      for (const progress of [value.actionProgress, value.reviewProgress]) if (progress?.childRequestId) allowed.add(progress.childRequestId)
    }
    const retainedOutcomes = new Set([...cache.bodies.values()].flatMap(body =>
      (body.outcomeSummaries || []).map(value => `${value.requestId}\u0000${value.turnId}`)))
    typedOutcomes.value = typedOutcomes.value.filter(value => retainedOutcomes.has(`${value.requestId}\u0000${value.turnId}`) ||
      (value.requestId === latestRequestId && value.state !== 'READY'))
    if (requestPage.value) requestPage.value = { ...requestPage.value, entries: requestPage.value.entries.filter(entry => allowed.has(entry.request.requestId)) }
  }
  const syncRetainedMessages = () => {
    const rows = cache.pages.flatMap(page => {
      const body = cache.bodies.get(page.key)
      return body ? body.items.filter(item => page.ids.includes(String(item.id))).map(item => normalizeStored(item, body)).filter(Boolean) : []
    })
    const known = new Set(cache.pages.flatMap(page => page.ids))
    const finalTurns = new Set(rows.map(row => row.turnId).filter(Boolean))
    const transient = messages.value.filter(row => !known.has(row.localId) && (!row.streaming || !finalTurns.has(row.turnId)))
    messages.value = rows.concat(transient)
  }
  const retainWindows = keys => {
    retentionEnabled = true
    const retained = new Set(keys)
    // Active streams are external to persisted-page ownership and remain in messages.
    cache.retain(retained)
    for (const [key, abort] of windowFlights) if (!retained.has(key)) { abort.abort(); windowFlights.delete(key) }
    windowLoading.value = new Set(windowFlights.keys())
    syncRetainedMessages(); prunePresentation(); publishWindows()
  }
  const loadWindow = async key => {
    const descriptor = cache.pages.find(page => page.key === key)
    if (!descriptor || cache.bodies.has(key) || windowFlights.has(key) || !conversationId.value) return false
    const id = conversationId.value, captured = captureGuard(), generation = revision
    const abort = new AbortController()
    windowFlights.set(key, abort); windowLoading.value = new Set(windowFlights.keys())
    windowErrors.value = { ...windowErrors.value, [key]: '' }
    const current = () => !abort.signal.aborted && generation === revision && guardCurrent(captured) && id === conversationId.value
    let applied = false
    try {
      await chatApi.get('/conversation/messages', { id, cursor: descriptor.cursor }, {
        autoLoading: false, signal: abort.signal,
        onSuccess: value => {
          if (!current()) return
          const page = hallMessagePage(value)
          if (descriptor.gap && page.hasMore && page.nextCursor === descriptor.cursor) throw new Error('消息分页未前进，请重试。')
          adoptRequests(page)
          applied = cache.load(key, page)
          syncRetainedMessages(); prunePresentation(); publishWindows()
        },
        onError: cause => { if (current()) windowErrors.value = { ...windowErrors.value, [key]: cause?.message || '历史页读取失败，请重试。' } }
      })
      if (current() && !applied && !windowErrors.value[key]) throw new Error('历史页读取失败，请重试。')
    } catch (cause) {
      if (current() && cause?.name !== 'AbortError') windowErrors.value = { ...windowErrors.value, [key]: cause?.message || '历史页读取失败，请重试。' }
    } finally {
      if (windowFlights.get(key) === abort) { windowFlights.delete(key); windowLoading.value = new Set(windowFlights.keys()) }
    }
    return applied && current()
  }
  return { requestPage, typedOutcomes, hasMore, loading, error, windows, windowLoading, windowErrors,
    retainWindows, loadWindow, applyLatest, loadOlder, reset, dispose: () => { stop(); reset() } }
}
