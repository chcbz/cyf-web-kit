import { ref, watch } from 'vue'
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

/** Display pagination only: loading old pages must never replay final replies or restart SSE. */
export const useHallMessagePages = ({ chatApi, messages, conversationId, identityKey, captureGuard, guardCurrent, normalize }) => {
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
    initialized = false
    olderLoaded = false
    hasMore.value = false
    loading.value = false
    error.value = ''
  }
  const stop = watch([conversationId, identityKey], reset, { flush: 'sync' })
  const normalizeStored = item => {
    const message = normalize(item)
    return message ? { ...message, historyCreatedAt: item.createTime ?? null } : null
  }
  const beforeMessage = (item, first) => {
    if (item.historyCreatedAt === null && first.historyCreatedAt !== null) return true
    if (item.historyCreatedAt !== null && first.historyCreatedAt === null) return false
    return item.historyCreatedAt < first.historyCreatedAt ||
      (item.historyCreatedAt === first.historyCreatedAt && BigInt(item.localId) < BigInt(first.localId))
  }
  const applyLatest = value => {
    const page = hallMessagePage(value)
    const latest = page.items.map(normalizeStored).filter(Boolean)
    // Retain explicitly loaded older pages; replace the latest window and transient
    // placeholders using the existing authoritative recovery path.
    const first = latest[0]
    const latestIds = new Set(latest.map(item => item.localId))
    const older = olderLoaded && first ? messages.value.filter(item =>
      canonicalWireString(item.localId) && !item.streaming && !latestIds.has(item.localId) && beforeMessage(item, first)) : []
    messages.value = older.concat(latest)
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
          const existing = new Set(messages.value.map(item => item.localId))
          const earlier = page.items.map(normalizeStored).filter(item => item && !existing.has(item.localId))
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
  return { hasMore, loading, error, applyLatest, loadOlder, reset, dispose: () => { stop(); reset() } }
}
