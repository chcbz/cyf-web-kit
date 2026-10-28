import { ref, watch } from 'vue'
import { skillResultAdvances, skillResultProjection, skillResultReferences } from './hallSkillResults.js'
/** Read-only execution polling, fenced by full identity and conversation generation. */
export const useHallSkillResults = ({ api, getContext, getOutcomes, getRequests = () => [], identityKey, enabled }) => {
  const results = ref([]); const error = ref(''); const loading = ref(false)
  let epoch = 0; let disposed = false; let controller = null; let timer = null
  const scopeFingerprint = () => JSON.stringify([identityKey(), enabled(), getContext()])
  const fingerprint = () => JSON.stringify([scopeFingerprint(), getOutcomes(), getRequests()])
  let previousScope = null
  const reset = (clear = true) => { epoch++; controller?.abort(); controller = null; clearTimeout(timer); timer = null; if (clear) results.value = []; error.value = ''; loading.value = false }
  const refresh = async () => {
    if (disposed || controller || !enabled()) return
    clearTimeout(timer); timer = null
    const generation = epoch; const key = fingerprint(); const context = { ...getContext() }
    const references = skillResultReferences(getOutcomes(), context, getRequests())
    if (!references.length) return
    const own = new AbortController(); controller = own; loading.value = true
    const current = () => !disposed && generation === epoch && key === fingerprint() && !own.signal.aborted
    try {
      const next = []
      for (const reference of references) {
        try {
          const response = await api.get(`/conversations/${encodeURIComponent(context.conversationId)}/executions/${encodeURIComponent(reference.executionId)}/result`, {}, { autoLoading: false, needAuth: true, signal: own.signal })
          if (!current()) return
          const result = skillResultProjection(response, reference)
          if (!result) throw new Error('技能结果来源或归档状态不匹配')
          const previous = results.value.find(item => item.executionId === result.executionId)
          if (previous?.executionStateVersion != null && !skillResultAdvances(previous, result)) next.push(previous)
          else next.push(Object.freeze({ ...result, reference }))
        } catch (cause) {
          if (!current()) return
          if ((cause?.response?.status ?? cause?.status) !== 404) throw cause
          // Missing/invisible is not evidence of a queue or completion; never scan history.
          const previous = results.value.find(item => item.executionId === reference.executionId)
          if (previous) { next.push(previous); continue }
          next.push(Object.freeze({ executionId: reference.executionId, phase: 'UNKNOWN', complete: false, data: null, outputs: [], reference }))
        }
      }
      if (current()) { results.value = next; error.value = '' }
    } catch (cause) { if (current()) error.value = cause.message || '读取技能结果失败' }
    finally {
      if (current()) {
        controller = null; loading.value = false
        if (!error.value && results.value.some(value => !value.complete && !['FAILED', 'CANCELLED'].includes(value.phase)))
          timer = setTimeout(() => { timer = null; void refresh() }, 2500)
      }
    }
  }
  // Request/outcome projections may fill in within one security scope. Keep only
  // still-bound results, cancel obsolete reads, and never let their replies land.
  // Identity, task, conversation or generation changes clear all state instead.
  const stop = watch(fingerprint, () => {
    const scope = scopeFingerprint(); reset(scope !== previousScope); previousScope = scope
    const references = skillResultReferences(getOutcomes(), getContext(), getRequests())
    results.value = results.value.filter(result => references.some(reference =>
      reference.executionId === result.executionId && reference.requestId === result.reference.requestId &&
      (reference.stepId == null || reference.stepId === (result.stepId ?? result.reference.stepId))))
    if (enabled()) void refresh()
  }, { immediate: true, flush: 'sync' })
  return { results, error, loading, refresh, dispose: () => { disposed = true; reset(); stop() } }
}
