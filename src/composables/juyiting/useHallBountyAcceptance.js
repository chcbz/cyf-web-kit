import { computed, getCurrentInstance, onBeforeUnmount, ref, watch } from 'vue'
import { exactOutputId } from './bountyOutputCatalog.js'
import { exactHallConversationId } from './hallConversationHistory.js'
import { useHallBountyRequestCatalog } from './useHallBountyRequestCatalog.js'

const unwrap = value => value?.data?.data ?? value?.data ?? value
/** Read existing owner/task scoped sources only. Never choose the latest conversation,
 * create/point/send, or convert a legacy formal delivery into a conversation output. */
export function useHallBountyAcceptance ({ api, taskId, identityKey, conversationId = () => '' }) {
  const scope = ref(null); const loading = ref(false); const error = ref(''); const legacy = ref(false)
  let epoch = 0; let disposed = false; let controller = null; let timer = null
  const identity = computed(() => `${identityKey()}\u0000${taskId()}`)
  const catalog = useHallBountyRequestCatalog({ chatApi: api, identityScope: identity,
    authorizationGeneration: () => epoch, getContextGeneration: () => epoch,
    enabled: () => !disposed && !!scope.value,
    getContext: () => ({ conversationId: scope.value?.conversationId || '', taskId: taskId() }) })
  const valid = captured => !disposed && captured === epoch
  const poll = async captured => {
    const loaded = await catalog.refresh()
    if (valid(captured) && scope.value) {
      error.value = !loaded && !catalog.error.value ? '成果索引暂未能核实，请重新读取。' : ''
      legacy.value = loaded && !catalog.error.value && !catalog.entries.value.length
      timer = setTimeout(() => { void poll(captured) }, 2500)
    }
  }
  const refresh = async () => {
    epoch++; const captured = epoch
    controller?.abort(); if (timer != null) clearTimeout(timer); timer = null
    scope.value = null; catalog.reset(); error.value = ''; legacy.value = false; loading.value = false
    if (disposed || !identityKey() || !exactOutputId(taskId())) return false
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
      await poll(captured)
      return valid(captured)
    } catch (cause) {
      if (valid(captured) && cause?.name !== 'AbortError') error.value = cause?.message || '读取议事成果失败。'
      return false
    } finally { if (valid(captured)) loading.value = false }
  }
  const stop = watch(() => [identity.value, conversationId()], () => { void refresh() }, { immediate: true, flush: 'sync' })
  const dispose = () => { disposed = true; epoch++; controller?.abort(); if (timer != null) clearTimeout(timer); stop(); catalog.dispose() }
  if (getCurrentInstance()) onBeforeUnmount(dispose)
  return { scope, loading, error, legacy, catalog, refresh, dispose }
}
