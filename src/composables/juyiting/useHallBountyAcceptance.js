import { computed, getCurrentInstance, onBeforeUnmount, ref, watch } from 'vue'
import { exactOutputId } from './bountyOutputCatalog.js'
import { exactHallConversationId } from './hallConversationHistory.js'
import { isAcceptanceProjectionEvent, readHallAcceptanceEvents } from './hallAcceptanceEvents.js'
import { useHallBountyRequestCatalog } from './useHallBountyRequestCatalog.js'

const unwrap = value => value?.items
/** Read existing owner/task scoped sources only. Never choose the latest conversation,
 * create/point/send, or convert a legacy formal delivery into a conversation output. */
export function useHallBountyAcceptance ({ api, taskId, identityKey, conversationId = () => '', enabled = () => true, taskCompleted = () => false, stateVersion = () => '', eventSource = () => null, documentRef = globalThis.document }) {
  const scope = ref(null); const loading = ref(false); const readError = ref(''); const streamError = ref(''); const legacy = ref(false)
  const error = computed(() => readError.value || streamError.value)
  let epoch = 0; let disposed = false; let controller = null; let readQueued = false
  let streamController = null; let streamGeneration = 0; let retryTimer = null; let failures = 0; let cursor = ''
  const identity = computed(() => `${identityKey()}\u0000${taskId()}`)
  const catalog = useHallBountyRequestCatalog({ chatApi: api, identityScope: identity,
    authorizationGeneration: () => epoch, getContextGeneration: () => epoch,
    enabled: () => !disposed && enabled() && !!scope.value,
    getContext: () => ({ conversationId: scope.value?.conversationId || '', taskId: taskId() }) })
  const visible = () => documentRef?.visibilityState !== 'hidden'
  const valid = captured => !disposed && enabled() && captured === epoch
  const readCatalog = async captured => {
    if (!valid(captured) || !scope.value || !visible()) return false
    if (catalog.loading.value) { readQueued = true; return false }
    const loaded = await catalog.refresh()
    if (valid(captured) && scope.value) {
      readError.value = catalog.error.value || (!loaded ? '成果索引暂未能核实，请重新读取。' : '')
      legacy.value = loaded && !catalog.error.value && !catalog.entries.value.length
      if (readQueued) { readQueued = false; return readCatalog(captured) }
    }
    return loaded
  }
  // Only transport failures reconnect. No timer reads the catalogue while idle.
  // A matching chat owns the connection even during its reconnect window.
  const shared = () => !!scope.value && eventSource()?.sharedConversationId?.() === scope.value.conversationId
  const stopStream = () => {
    streamGeneration++
    streamController?.abort(); streamController = null
    if (retryTimer != null) clearTimeout(retryTimer)
    retryTimer = null
  }
  const startStream = async () => {
    const source = eventSource()
    if (!source || !valid(epoch) || !visible() || !scope.value || shared() || streamController) return
    const captured = epoch; const generation = ++streamGeneration
    const id = scope.value.conversationId; const transport = new AbortController()
    streamController = transport
    const current = () => valid(captured) && generation === streamGeneration && !transport.signal.aborted
    try {
      const response = await source.connect({ conversationId: id, signal: transport.signal, cursor })
      if (!current()) { await response?.body?.cancel(); return }
      if (!response) { streamError.value = '议事成果实时更新暂不可用，请重新读取。'; return }
      await readHallAcceptanceEvents({ response, conversationId: id, signal: transport.signal,
        onCursor: value => { if (current()) cursor = value },
        onRefresh: () => {
          if (!current()) return
          failures = 0; streamError.value = ''
          void readCatalog(captured)
        } })
    } catch (cause) {
      if (!current() || cause?.name === 'AbortError') return
      streamError.value = '议事成果实时更新暂不可用，请重新读取。'
      if ([401, 403, 501].includes(cause?.status)) return
      if ([400, 409, 410].includes(cause?.status)) cursor = ''
      failures++
      const base = Math.min(30000, 1000 * 2 ** Math.min(failures - 1, 5))
      retryTimer = setTimeout(() => {
        retryTimer = null
        if (current()) void startStream()
      }, Math.min(30000, base + Math.floor(base * Math.random())))
    } finally {
      if (generation === streamGeneration) streamController = null
    }
  }
  const syncStream = () => { stopStream(); failures = 0; void startStream() }
  const refresh = async () => {
    epoch++; readQueued = false; const captured = epoch
    controller?.abort(); stopStream(); cursor = ''; failures = 0
    scope.value = null; catalog.reset(); readError.value = ''; streamError.value = ''; legacy.value = false; loading.value = false
    if (disposed || !visible() || !enabled() || !identityKey() || !exactOutputId(taskId())) return false
    controller = new AbortController(); loading.value = true
    const signal = controller.signal
    try {
      const wanted = conversationId()
      if (wanted && !exactHallConversationId(wanted)) throw new Error('议事来源标识无效。')
      let pageNum = 1; let found = null
      do {
        // Two rows suffice to detect ambiguity. An explicit original is searched through
        // the existing paginated history, never replaced by a newer conversation.
        const pageSize = wanted ? 100 : 2
        let callbackResult
        const response = await api.list('/conversation/list', { pageNum, pageSize,
          orderBy: 'id asc', search: { conversationType: 'juyiting', conversationScopeType: 'bounty', conversationScopeKey: `task:${taskId()}` } },
        { autoLoading: false, needAuth: true, signal, onSuccess: value => { callbackResult = value } })
        if (!valid(captured)) return false
        const rows = unwrap(callbackResult ?? response)
        if (!Array.isArray(rows) || rows.some(row => row?.conversationType !== 'juyiting' || row.conversationScopeType !== 'bounty' ||
            row.conversationScopeKey !== `task:${taskId()}` || !exactHallConversationId(row.id))) throw new Error('议事来源范围不匹配。')
        if (!wanted) {
          if (rows.length > 1) throw new Error('议事来源不唯一，请先回到该事项的原会话。')
          found = rows[0] || null; break
        }
        found = rows.find(row => exactHallConversationId(row.id) === wanted) || null
        if (found || rows.length < pageSize) break
        pageNum++
      } while (valid(captured))
      if (!found) {
        if (wanted) throw new Error('原议事暂不可读取；未改用其他会话。')
        legacy.value = true; return true
      }
      scope.value = Object.freeze({ taskId: taskId(), conversationId: exactHallConversationId(found.id) })
      await readCatalog(captured)
      return valid(captured)
    } catch (cause) {
      if (valid(captured) && cause?.name !== 'AbortError') readError.value = cause?.message || '读取议事成果失败。'
      return false
    } finally { if (valid(captured)) loading.value = false }
  }
  const stop = watch(() => [identity.value, conversationId(), enabled()], () => { void refresh() }, { immediate: true, flush: 'sync' })
  const stopStreamWatch = watch(() => [scope.value?.conversationId, eventSource(), eventSource()?.sharedConversationId?.()], syncStream, { flush: 'sync' })
  const stopSharedEvents = watch(() => eventSource()?.sharedEvent?.(), event => {
    if (!shared() || !visible() || !valid(epoch) || event?.conversationId !== scope.value?.conversationId) return
    if (event.type === 'stream_disconnected') streamError.value = '议事成果实时更新暂不可用，请重新读取。'
    else if (event.type === 'stream_ready' || isAcceptanceProjectionEvent(event)) { streamError.value = ''; void readCatalog(epoch) }
  }, { flush: 'sync' })
  const stopProjection = watch(() => [taskCompleted(), stateVersion()], () => {
    if (scope.value) void readCatalog(epoch)
  }, { flush: 'sync' })
  const onVisibility = () => {
    syncStream()
    if (visible()) { if (scope.value) void readCatalog(epoch); else void refresh() }
  }
  documentRef?.addEventListener?.('visibilitychange', onVisibility)
  const dispose = () => { documentRef?.removeEventListener?.('visibilitychange', onVisibility); disposed = true; epoch++; controller?.abort(); stopStream(); stop(); stopProjection(); stopStreamWatch(); stopSharedEvents(); catalog.dispose() }
  if (getCurrentInstance()) onBeforeUnmount(dispose)
  return { scope, loading, error, legacy, catalog, refresh, refreshCatalog: () => readCatalog(epoch), dispose }
}
