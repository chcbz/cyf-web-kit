import { ref, watch } from 'vue'
import { skillResultProjection, skillResultReferences } from './hallSkillResults.js'
/** Read-only execution polling, fenced by full identity and conversation generation. */
export const useHallSkillResults = ({ api, getContext, getOutcomes, identityKey, enabled }) => {
  const results = ref([]); const error = ref(''); const loading = ref(false)
  let epoch = 0; let disposed = false; let controller = null; let timer = null
  const fingerprint = () => JSON.stringify([identityKey(), enabled(), getContext(), getOutcomes()])
  const reset = () => { epoch++; controller?.abort(); controller = null; clearTimeout(timer); timer = null; results.value = []; error.value = ''; loading.value = false }
  const refresh = async () => {
    if (disposed || controller || !enabled()) return
    const generation = epoch; const key = fingerprint(); const context = { ...getContext() }
    const references = skillResultReferences(getOutcomes(), context)
    if (!references.length) return
    const own = new AbortController(); controller = own; loading.value = true
    const current = () => !disposed && generation === epoch && key === fingerprint() && !own.signal.aborted
    try {
      const next = []
      for (const reference of references) {
        try {
          const response = await api.get(`/conversations/${encodeURIComponent(context.conversationId)}/executions/${encodeURIComponent(reference.executionId)}/result`, {}, { autoLoading: false, needAuth: true, signal: own.signal })
          if (!current()) return
          const result = skillResultProjection(response?.data?.schemaVersion === 1 ? response.data : response?.data?.data ?? response?.data ?? response, reference)
          if (!result) throw new Error('技能结果来源或归档状态不匹配')
          next.push(Object.freeze({ ...result, reference }))
        } catch (cause) {
          if (!current()) return
          if ((cause?.response?.status ?? cause?.status) !== 404) throw cause
          // The exact child is not yet visible; never replace it with a history item.
          next.push(Object.freeze({ executionId: reference.executionId, phase: 'QUEUED', complete: false, data: null, outputs: [], reference }))
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
  const stop = watch(fingerprint, () => { reset(); if (enabled()) void refresh() }, { immediate: true, flush: 'sync' })
  return { results, error, loading, refresh, dispose: () => { disposed = true; reset(); stop() } }
}
