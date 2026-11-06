import { computed, ref, unref, watch } from 'vue'
import { useHallOrdinaryCancellation } from './useHallOrdinaryCancellation.js'
import { createEconomyRequestIntentStore } from './economyRequestIntent.js'

const failureReason = (error, fallback) => error?.message || fallback
const isFundedTask = task => task?.funding?.mode === 'FUNDED_SINGLE_AGENT'
const valueOf = source => unref(typeof source === 'function' ? source() : source)

export const useHallTaskActions = ({
  agentApi, identityScope, identityEpoch, actionSessionKey, onOrdinaryCancelled,
  fundedActorScopeKey = () => '', fundedIntentStorage = null,
  log, playError, playSuccess, selectedTask, showToast, tasks
}) => {
  const ordinaryCancellation = useHallOrdinaryCancellation({ agentApi, selectedTask, tasks, identityScope, identityEpoch,
    sessionKey: actionSessionKey, onCancelled: onOrdinaryCancelled, showToast, playSuccess, playError, log })
  // Retain unresolved historical evidence only. No replay, migration, key replacement or deletion.
  const fundedActorScope = computed(() => {
    const scope = valueOf(fundedActorScopeKey)
    return typeof scope === 'string' ? scope.trim() : ''
  })
  const fundedCreateRecovery = ref(null)
  watch(fundedActorScope, scope => {
    fundedCreateRecovery.value = null
    const current = createEconomyRequestIntentStore({ storage: fundedIntentStorage, scopeKey: () => scope }).get('funded-create')
    if (current.state === 'PRESENT') fundedCreateRecovery.value = current.record
  }, { immediate: true, flush: 'sync' })

  const loadSettlement = async (task) => {
    if (!task?.id || !isFundedTask(task)) return null
    const scope = valueOf(identityScope)
    const epoch = valueOf(identityEpoch)
    const current = () => scope === valueOf(identityScope) && epoch === valueOf(identityEpoch)
    try {
      const settlement = await agentApi.get(`/tasks/${encodeURIComponent(task.id)}/settlement`, undefined, { autoLoading: false })
      if (!current()) return null
      task.settlement = settlement
      if (selectedTask.value?.id === task.id) selectedTask.value = { ...selectedTask.value, settlement }
      return settlement
    } catch (error) {
      if (!current()) return null
      log.warn('load funded bounty settlement failed:', error)
      playError()
      showToast(`结算详情未取到：${failureReason(error, '请稍后再试')}`)
      return null
    }
  }

  const archiveTask = async (task) => {
    if (!task) return false
    try {
      const archived = await agentApi.create(`/tasks/${task.id}/archive`, {}, { autoLoading: false }) || { ...task, status: 'archived' }
      tasks.value = tasks.value.map(item => item.id === task.id ? archived : item)
      selectedTask.value = archived
      playSuccess()
      showToast('事项已归档')
      return true
    } catch (error) {
      log.warn('archive bounty task failed:', error)
      playError()
      showToast(`收入案卷未成：${failureReason(error, '请稍后再试')}`)
      return false
    }
  }

  return { ...ordinaryCancellation, archiveTask, loadSettlement, fundedCreateRecovery }
}
