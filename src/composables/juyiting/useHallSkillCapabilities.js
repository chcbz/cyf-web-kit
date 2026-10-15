import { ref, watch } from 'vue'
import { skillCapabilityProjection } from './hallSkillCapabilities.js'
import { typedId } from './hallTypedDeliberation.js'
/** Read-only directory with full owner/auth/task/target fences. It never posts, grants, or approves costs. */
export const useHallSkillCapabilities = ({ api, getContext, identityKey, enabled = () => false }) => {
  const projection = ref(null); const error = ref(''); const loading = ref(false)
  let disposed = false; let controller = null; let epoch = 0
  const fingerprint = () => JSON.stringify([identityKey(), enabled(), getContext()])
  const reset = () => { epoch++; controller?.abort(); controller = null; projection.value = null; error.value = ''; loading.value = false }
  const refresh = async () => {
    reset(); const generation = epoch; const scope = fingerprint(); const context = { ...getContext() }
    if (disposed || !enabled() || !typedId(context.taskId) || !typedId(context.targetAgentId)) return false
    const own = new AbortController(); controller = own; loading.value = true
    const current = () => !disposed && generation === epoch && !own.signal.aborted && fingerprint() === scope
    try {
      const result = await api.get(`/tasks/${encodeURIComponent(context.taskId)}/skill-capabilities`, { targetAgentId: context.targetAgentId }, { autoLoading: false, needAuth: true, signal: own.signal })
      if (!current()) return false
      const value = skillCapabilityProjection(result)
      if (!value) throw new Error('技能目录回执格式不可信')
      projection.value = value; return true
    } catch (cause) { if (current()) error.value = cause?.status === 404 ? '当前事项不可访问' : '技能目录暂不可用；费用未知不影响权限判断'; return false }
    finally { if (current()) { loading.value = false; controller = null } }
  }
  const stop = watch(fingerprint, () => { reset(); if (enabled()) void refresh() }, { flush: 'sync', immediate: true })
  return { projection, error, loading, refresh, reset, dispose: () => { disposed = true; reset(); stop() } }
}
