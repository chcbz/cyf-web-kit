import { ref, watch } from 'vue'
import { catalogPage, mergeCatalogEntries } from './bountyRequestCatalog.js'
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
    if (!initialized || !olderLoaded) { before = page.nextCursor; hasMore.value = page.hasMore }
    initialized = true
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
  return { requestPage, typedOutcomes, hasMore, loading, error, applyLatest, loadOlder, reset, dispose: () => { stop(); reset() } }
}
