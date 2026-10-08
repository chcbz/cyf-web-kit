import { computed, ref, unref, watch } from 'vue'
import { catalogExecutionSteps, catalogPage, mergeCatalogEntries } from './bountyRequestCatalog.js'

const unwrap = result => result?.data?.data ?? result?.data ?? result
const query = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item != null))
export const useHallBountyRequestCatalog = ({ chatApi, enabled = () => false, identityScope, authorizationGeneration, getContext, getContextGeneration }) => {
  const entries = ref([]); const error = ref(''); const loading = ref(false); const generation = ref(0)
  const scope = computed(() => unref(typeof identityScope === 'function' ? identityScope() : identityScope))
  let disposed = false; let refreshQueued = false; let activeScan = null
  const capture = () => ({ generation: generation.value, scope: scope.value, auth: unref(typeof authorizationGeneration === 'function' ? authorizationGeneration() : authorizationGeneration),
    contextGeneration: getContextGeneration?.(), context: { ...(getContext?.() || {}) } })
  const current = captured => !disposed && enabled?.() && captured.generation === generation.value && captured.scope === scope.value &&
    captured.auth === unref(typeof authorizationGeneration === 'function' ? authorizationGeneration() : authorizationGeneration) &&
    captured.contextGeneration === getContextGeneration?.() && JSON.stringify(captured.context) === JSON.stringify(getContext?.() || {})
  const reset = () => { generation.value++; activeScan = null; entries.value = []; error.value = ''; loading.value = false }
  const refresh = async () => {
    if (loading.value) { refreshQueued = true; return false }
    const captured = capture(); const context = captured.context
    if (!enabled?.() || !context.conversationId || !context.taskId) return false
    const scan = {}; activeScan = scan
    loading.value = true; error.value = ''
    try {
      let after = '0'; let through = null; let expectedGeneration = context.conversationGeneration || null; let next = true; let merged = entries.value
      while (next) {
        const params = query({ ...(expectedGeneration ? { expectedGeneration } : {}), after, ...(through != null ? { through } : {}) })
        const page = catalogPage(unwrap(await chatApi.get(`/conversations/${encodeURIComponent(context.conversationId)}/requests`, params, { autoLoading: false, needAuth: true })),
          { conversationId: context.conversationId, taskId: context.taskId, generation: expectedGeneration, after, through })
        if (!current(captured) || !page) return false
        if (through != null && page.through !== through) throw new Error('悬赏成果索引分页边界不一致')
        through = page.through; expectedGeneration = page.scope.conversationGeneration
        const nextMerged = mergeCatalogEntries(merged, page)
        if (!nextMerged) throw new Error('悬赏成果索引回执冲突')
        merged = nextMerged; after = page.nextAfter || page.through; next = page.hasMore
      }
      if (!current(captured)) return false
      entries.value = merged
      return true
    } catch (cause) { if (current(captured)) error.value = cause?.message || '读取悬赏成果索引失败'; return false } finally {
      if (activeScan === scan) {
        activeScan = null; loading.value = false
        if (refreshQueued) { refreshQueued = false; void refresh() }
      }
    }
  }
  const hint = () => { if (!enabled?.()) return false; void refresh(); return true }
  const executionSteps = computed(() => catalogExecutionSteps(entries.value, getContext?.() || {}))
  const stop = watch(scope, reset, { flush: 'sync' })
  return { entries, executionSteps, error, loading, refresh, hint, reset, dispose: () => { disposed = true; reset(); stop() } }
}
