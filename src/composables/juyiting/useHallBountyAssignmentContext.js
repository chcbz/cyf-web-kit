import { computed, ref, unref, watch } from 'vue'
import { bountyAssignmentContextProjection } from './hallBountyAssignmentContext.js'

export const useHallBountyAssignmentContext = ({ chatApi, identityScope, authorizationGeneration,
  getContext, getContextGeneration, enabled = () => false }) => {
  const read = value => unref(typeof value === 'function' ? value() : value)
  const fingerprint = computed(() => JSON.stringify([read(identityScope), read(authorizationGeneration),
    getContextGeneration?.(), getContext(), enabled()]))
  const projection = ref(null); const error = ref(''); const loading = ref(false)
  let disposed = false; let flight = null
  const reset = () => { flight?.controller.abort(); flight = null; projection.value = null; error.value = ''; loading.value = false }
  const stop = watch(fingerprint, reset, { flush: 'sync' })
  const refresh = () => {
    if (disposed || !enabled()) return Promise.resolve(false)
    if (flight) return flight.promise
    const captured = fingerprint.value; const context = { ...getContext() }
    if (!context.conversationId || !context.taskId || !context.targetAgentId || !context.taskVersion) return Promise.resolve(false)
    const scan = { controller: new AbortController() }; flight = scan
    const current = () => !disposed && captured === fingerprint.value && flight === scan
    loading.value = true; error.value = ''; projection.value = null
    scan.promise = (async () => {
      try {
        const result = await chatApi.get(`/conversations/${encodeURIComponent(context.conversationId)}/interactions/context`,
          undefined, { autoLoading: false, needAuth: true, signal: scan.controller.signal })
        if (!current()) return false
        const value = bountyAssignmentContextProjection(result?.data?.data ?? result?.data ?? result, context)
        if (!value) throw new Error('当前指派与会话绑定不一致，请刷新事项后重试；未发送消息。')
        projection.value = value
        return true
      } catch {
        if (current()) error.value = '当前指派上下文未能核对，请刷新事项后重试；未发送消息。'
        return false
      } finally {
        if (flight === scan) { flight = null; loading.value = false }
      }
    })()
    return scan.promise
  }
  return { projection, error, loading, refresh, dispose: () => { disposed = true; reset(); stop() } }
}
