import { computed, getCurrentInstance, onBeforeUnmount, ref, watch } from 'vue'
import { useHallBountyAcceptance } from './useHallBountyAcceptance.js'
import { useHallMessagePages } from './useHallMessagePages.js'
import { normalizeHallMessage } from './hallConversationMessages.js'
import { completedTextItem } from './bountyOutputCatalog.js'

/** Cancelled-task display only. Never a complete acceptance/delivery graph. */
export const useHallTerminalTextHistory = ({ api, taskId, identityKey, documentRef = globalThis.document }) => {
  const source = useHallBountyAcceptance({ api, taskId, identityKey, taskCompleted: () => true,
    loadRequests: false, documentRef })
  const conversationId = computed(() => source.scope.value?.conversationId || '')
  const identity = computed(() => `${identityKey()}\u0000${taskId()}`)
  const messages = ref([]); const items = ref([]); const readError = ref(''); const reading = ref(false)
  let generation = 0; let disposed = false; let controller = null
  const resolved = new Map()
  const pages = useHallMessagePages({ chatApi: api, messages, conversationId, identityKey: identity,
    captureGuard: () => generation, guardCurrent: value => !disposed && value === generation,
    normalize: item => normalizeHallMessage(item, '') })
  const current = captured => !disposed && captured === generation && !!conversationId.value
  const syncItems = () => { items.value = source.catalog.entries.value.flatMap(entry => entry.request.turns.flatMap(turn => resolved.get(`${entry.request.requestId}\u0000${turn.turnId}`) || [])) }
  const readWindow = async captured => {
    if (!current(captured) || !pages.requestPage.value || !source.catalog.adoptPage(pages.requestPage.value)) return false
    const entries = new Map(source.catalog.entries.value.map(entry => [entry.request.requestId, entry.request]))
    for (const outcome of pages.typedOutcomes.value) {
      const request = entries.get(outcome.requestId)
      const turn = request?.turns.find(value => value.turnId === outcome.turnId)
      if (!request || !turn) throw new Error('历史文字成果与原议事回合不匹配。')
      if (outcome.route !== 'CHAT' || outcome.state !== 'READY') continue
      const key = `${request.requestId}\u0000${turn.turnId}`
      if (resolved.has(key)) continue
      const item = await completedTextItem(outcome, request, turn, taskId())
      if (!current(captured)) return false
      resolved.set(key, item ? [item] : [])
    }
    return current(captured)
  }
  const read = async mode => {
    if (disposed || reading.value || !conversationId.value || documentRef?.visibilityState === 'hidden') return false
    const captured = generation; const abort = new AbortController(); controller = abort
    reading.value = true; readError.value = ''
    try {
      if (mode === 'latest') {
        let callback
        const response = await api.get('/conversation/messages', { id: conversationId.value },
          { autoLoading: false, needAuth: true, signal: abort.signal, onSuccess: value => { callback = value } })
        if (!current(captured)) return false
        pages.applyLatest(callback ?? response)
      } else if (mode === 'older') {
        if (!await pages.loadOlder() || !current(captured)) return false
      }
      return await readWindow(captured)
    } catch (cause) {
      if (current(captured) && cause?.name !== 'AbortError') readError.value = cause?.message || '历史文字成果读取失败，请重试当前页。'
      return false
    } finally {
      if (current(captured)) { syncItems(); reading.value = false; controller = null }
    }
  }
  const reset = () => {
    generation++; controller?.abort(); controller = null; pages.reset()
    resolved.clear(); messages.value = []; items.value = []; readError.value = ''; reading.value = false
  }
  const stop = watch([source.scope, identity], () => { reset(); if (conversationId.value) void read('latest') }, { immediate: true, flush: 'sync' })
  const error = computed(() => source.error.value || source.catalog.error.value || readError.value || pages.error.value)
  const loading = computed(() => source.loading.value || reading.value || pages.loading.value)
  // Retry the failed window before allowing another page to advance its cursor.
  const loadOlder = () => error.value ? retry() : read('older')
  const retry = () => source.error.value ? source.refresh() : read(pages.error.value ? 'older' : messages.value.length ? 'retry' : 'latest')
  const dispose = () => { disposed = true; stop(); reset(); pages.dispose(); source.dispose() }
  if (getCurrentInstance()) onBeforeUnmount(dispose)
  return { items, error, loading, hasMore: pages.hasMore, refresh: source.refresh, retry, loadOlder, dispose }
}
