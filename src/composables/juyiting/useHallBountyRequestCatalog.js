import { computed, ref, unref, watch } from 'vue'
import { catalogExecutionSteps, catalogPage, mergeCatalogEntries } from './bountyRequestCatalog.js'

const unwrap = result => result?.data?.data ?? result?.data ?? result
const query = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item != null))
export const useHallBountyRequestCatalog = ({ chatApi, enabled = () => false, identityScope, authorizationGeneration, getContext, getContextGeneration }) => {
  const initialized = ref(false)
  const entries = ref([]); const error = ref(''); const loading = ref(false); const generation = ref(0)
  const scope = computed(() => unref(typeof identityScope === 'function' ? identityScope() : identityScope))
  let disposed = false; let activeScan = null
  const capture = () => ({ generation: generation.value, scope: scope.value, auth: unref(typeof authorizationGeneration === 'function' ? authorizationGeneration() : authorizationGeneration),
    contextGeneration: getContextGeneration?.(), context: { ...(getContext?.() || {}) } })
  const current = captured => !disposed && enabled?.() && captured.generation === generation.value && captured.scope === scope.value &&
    captured.auth === unref(typeof authorizationGeneration === 'function' ? authorizationGeneration() : authorizationGeneration) &&
    captured.contextGeneration === getContextGeneration?.() && JSON.stringify(captured.context) === JSON.stringify(getContext?.() || {})
  const reset = () => { generation.value++; activeScan?.controller.abort(); activeScan = null; initialized.value = false; entries.value = []; error.value = ''; loading.value = false }
  const adoptPage = value => {
    const captured = capture()
    if (!current(captured)) return false
    const context = captured.context
    const page = catalogPage(value, { conversationId: context.conversationId, taskId: context.taskId,
      generation: context.conversationGeneration, after: '0' })
    if (!page || page.hasMore) { error.value = '消息页的议事范围不匹配，请重试。'; return false }
    const merged = mergeCatalogEntries(entries.value, page)
    if (!merged) { error.value = '议事状态已变化，请重试。'; return false }
    entries.value = merged; initialized.value = true; error.value = ''
    return true
  }
  const refresh = () => {
    // Explicit complete-catalog consumers (such as archived task history) join
    // this fenced scan. The live conversation adopts the aggregate message page.
    if (activeScan && current(activeScan.captured)) return activeScan.promise
    if (activeScan) reset()
    const captured = capture(); const context = captured.context
    if (disposed || !enabled?.() || !context.conversationId || !context.taskId) return Promise.resolve(false)
    const scan = { controller: new AbortController(), captured }; activeScan = scan
    loading.value = true; error.value = ''
    scan.promise = (async () => {
      try {
        if (!current(captured)) return false
        let after = '0'; let through = null; let expectedGeneration = context.conversationGeneration || null; let next = true; let merged = entries.value
        while (next) {
          const params = query({ ...(expectedGeneration ? { expectedGeneration } : {}), after, ...(through != null ? { through } : {}) })
          const page = catalogPage(unwrap(await chatApi.get(`/conversations/${encodeURIComponent(context.conversationId)}/requests`, params, { autoLoading: false, needAuth: true, signal: scan.controller.signal })),
            { conversationId: context.conversationId, taskId: context.taskId, generation: expectedGeneration, after, through })
          if (!current(captured)) return false
          if (!page) throw new Error('悬赏成果索引格式或会话绑定不匹配')
          if (through != null && page.through !== through) throw new Error('悬赏成果索引分页边界不一致')
          through = page.through; expectedGeneration = page.scope.conversationGeneration
          const nextMerged = mergeCatalogEntries(merged, page)
          if (!nextMerged) throw new Error('成果列表已变化，请重新加载。')
          merged = nextMerged; after = page.nextAfter || page.through; next = page.hasMore
        }
        if (!current(captured)) return false
        entries.value = merged
        initialized.value = true
        return true
      } catch (cause) { if (current(captured)) error.value = cause?.message || '读取悬赏成果索引失败'; return false } finally {
        if (activeScan === scan) {
          activeScan = null; loading.value = false
        }
      }
    })()
    return scan.promise
  }
  const executionSteps = computed(() => catalogExecutionSteps(entries.value, getContext?.() || {}))
  const stop = watch(scope, reset, { flush: 'sync' })
  return { adoptPage, entries, initialized, executionSteps, error, loading, refresh, reset, dispose: () => { disposed = true; reset(); stop() } }
}
