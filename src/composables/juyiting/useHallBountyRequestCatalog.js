import { computed, ref, unref, watch } from 'vue'
import { catalogExecutionSteps, catalogPage, mergeCatalogEntries } from './bountyRequestCatalog.js'

/** Page-owned presentation state. This adapter never discovers or fetches requests. */
export const useHallBountyRequestCatalog = ({ enabled = () => false, identityScope, getContext }) => {
  const initialized = ref(false)
  const entries = ref([]); const error = ref('')
  const scope = computed(() => unref(typeof identityScope === 'function' ? identityScope() : identityScope))
  let disposed = false
  const reset = () => { initialized.value = false; entries.value = []; error.value = '' }
  const adoptPage = value => {
    if (disposed || !enabled?.()) return false
    const context = getContext?.() || {}
    const page = catalogPage(value, { conversationId: context.conversationId, taskId: context.taskId,
      generation: context.conversationGeneration, after: '0' })
    if (!page || page.hasMore) { error.value = '消息页的议事范围不匹配，请重试。'; return false }
    const merged = mergeCatalogEntries(entries.value, page)
    if (!merged) { error.value = '议事状态已变化，请重试。'; return false }
    const pageIds = new Set(page.entries.map(entry => entry.request.requestId))
    entries.value = merged.filter(entry => pageIds.has(entry.request.requestId)); initialized.value = true; error.value = ''
    return true
  }
  const executionSteps = computed(() => catalogExecutionSteps(entries.value, getContext?.() || {}))
  const stop = watch(scope, reset, { flush: 'sync' })
  return { adoptPage, entries, initialized, executionSteps, error, reset, dispose: () => { disposed = true; reset(); stop() } }
}
