import { computed, ref, unref, watch } from 'vue'
import { exactOutputId } from './bountyOutputCatalog.js'
import { catalogExecutionSteps, catalogPage, mergeCatalogEntries } from './bountyRequestCatalog.js'

const unwrap = result => result?.data?.data ?? result?.data ?? result
const query = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item != null))
export const useHallBountyRequestCatalog = ({ chatApi, enabled = () => false, identityScope, authorizationGeneration, getContext, getContextGeneration }) => {
  const initialized = ref(false); const reads = new Map()
  const entries = ref([]); const error = ref(''); const loading = ref(false); const generation = ref(0)
  const scope = computed(() => unref(typeof identityScope === 'function' ? identityScope() : identityScope))
  let disposed = false; let activeScan = null
  const capture = () => ({ generation: generation.value, scope: scope.value, auth: unref(typeof authorizationGeneration === 'function' ? authorizationGeneration() : authorizationGeneration),
    contextGeneration: getContextGeneration?.(), context: { ...(getContext?.() || {}) } })
  const current = captured => !disposed && enabled?.() && captured.generation === generation.value && captured.scope === scope.value &&
    captured.auth === unref(typeof authorizationGeneration === 'function' ? authorizationGeneration() : authorizationGeneration) &&
    captured.contextGeneration === getContextGeneration?.() && JSON.stringify(captured.context) === JSON.stringify(getContext?.() || {})
  const reset = () => { generation.value++; activeScan?.controller.abort(); activeScan = null; for (const read of reads.values()) read.controller.abort(); reads.clear(); initialized.value = false; entries.value = []; error.value = ''; loading.value = false }
  const refresh = () => {
    // Explicit complete-catalog consumers (such as archived task history) join
    // this fenced scan. The live conversation uses refreshWindow instead.
    if (activeScan && current(activeScan.captured)) return activeScan.promise
    if (activeScan) reset()
    const captured = capture(); const context = captured.context
    if (disposed || !enabled?.() || !context.conversationId || !context.taskId) return Promise.resolve(false)
    const scan = { controller: new AbortController(), captured }; activeScan = scan
    loading.value = true; error.value = ''
    scan.promise = (async () => {
      try {
        if (reads.size) await Promise.all([...reads.values()].map(read => read.promise))
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
          activeScan = null; loading.value = reads.size > 0
        }
      }
    })()
    return scan.promise
  }
  const refreshRequests = async requestIds => {
    const captured = capture()
    if (!current(captured)) return false
    // A targeted hint must not race an explicitly requested full-history snapshot
    // or start a second historical scan.
    if (activeScan && !await activeScan.promise) return false
    if (!current(captured)) return false
    const ids = [...new Set(requestIds)].filter(exactOutputId)
    const results = await Promise.all(ids.map(requestId => {
      const prior = reads.get(requestId)
      if (prior && current(prior.captured)) return prior.promise
      const read = { captured, controller: new AbortController() }
      reads.set(requestId, read)
      loading.value = true
      read.promise = (async () => {
        try {
          const context = captured.context
          const params = query({ requestId, expectedGeneration: context.conversationGeneration || null })
          const page = catalogPage(unwrap(await chatApi.get(`/conversations/${encodeURIComponent(context.conversationId)}/requests`, params,
            { autoLoading: false, needAuth: true, signal: read.controller.signal })),
          { conversationId: context.conversationId, taskId: context.taskId, generation: context.conversationGeneration, after: '0' })
          if (!current(captured)) return false
          if (!page || page.hasMore || page.entries.length !== 1 || page.entries[0].request.requestId !== requestId) throw new Error('本轮成果索引不匹配，请重试。')
          const merged = mergeCatalogEntries(entries.value, page)
          if (!merged) throw new Error('本轮成果状态已变化，请重试。')
          entries.value = merged
          return true
        } catch (cause) { if (current(captured)) error.value = cause?.message || '读取本轮成果索引失败'; return false }
        finally { if (reads.get(requestId) === read) { reads.delete(requestId); loading.value = Boolean(activeScan || reads.size) } }
      })()
      return read.promise
    }))
    return current(captured) && results.every(Boolean)
  }
  // A visible message window is an explicit selection, never a complete history.
  const refreshWindow = async (requestIds, { force = true } = {}) => {
    const captured = capture()
    if (!current(captured)) return false
    if (activeScan && !await activeScan.promise) return false
    if (!current(captured)) return false
    const existing = new Set(entries.value.map(entry => entry.request.requestId))
    const ids = [...new Set(requestIds)].filter(exactOutputId).filter(id => force || !existing.has(id))
    const waiting = [...new Set(ids.map(id => reads.get(id)).filter(read => read && current(read.captured)))]
    const missing = ids.filter(id => !reads.has(id) || !current(reads.get(id).captured))
    const jobs = waiting.map(read => read.promise)
    // Match the existing catalogue page maximum; loaded older message pages may
    // contribute more IDs, but no unrequested history is ever discovered here.
    for (let offset = 0; offset < missing.length; offset += 100) {
      const batch = missing.slice(offset, offset + 100)
      const read = { captured, controller: new AbortController() }
      for (const id of batch) reads.set(id, read)
      loading.value = true
      read.promise = (async () => {
        try {
          const context = captured.context
          const params = new URLSearchParams(batch.map(id => ['requestIds', id]))
          if (context.conversationGeneration) params.set('expectedGeneration', context.conversationGeneration)
          const raw = await chatApi.get(`/conversations/${encodeURIComponent(context.conversationId)}/requests?${params}`, {},
            { autoLoading: false, needAuth: true, signal: read.controller.signal })
          if (!current(captured)) return false
          const page = catalogPage(raw, { conversationId: context.conversationId, taskId: context.taskId,
            generation: context.conversationGeneration, after: '0' })
          if (!page || page.hasMore || page.entries.length !== batch.length || page.entries.some(entry => !batch.includes(entry.request.requestId)))
            throw new Error('可见消息的请求记录不匹配，请重试。')
          const merged = mergeCatalogEntries(entries.value, page)
          if (!merged) throw new Error('本轮成果状态已变化，请重试。')
          entries.value = merged
          return true
        } catch (cause) {
          if (current(captured)) error.value = cause?.message || '读取可见议事记录失败'
          return false
        } finally {
          for (const id of batch) if (reads.get(id) === read) reads.delete(id)
          loading.value = Boolean(activeScan || reads.size)
        }
      })()
      jobs.push(read.promise)
    }
    const results = await Promise.all(jobs)
    if (!current(captured) || !results.every(Boolean)) return false
    initialized.value = true; error.value = ''
    return true
  }
  const executionSteps = computed(() => catalogExecutionSteps(entries.value, getContext?.() || {}))
  const stop = watch(scope, reset, { flush: 'sync' })
  return { entries, initialized, executionSteps, error, loading, refresh, refreshRequests, refreshWindow, reset, dispose: () => { disposed = true; reset(); stop() } }
}
