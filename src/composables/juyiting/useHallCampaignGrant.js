import { onScopeDispose, ref, watch } from 'vue'
import { isWenMoney } from '../../utils/wenAmount.js'

/** One authenticated hall-entry event per identity activation. Never awaited by the hall flow. */
export function useHallCampaignGrant ({ economyApi, identityScope, authorizationGeneration, onError }) {
  const status = ref('idle')
  let controller
  let generation = 0
  const notify = async () => {
    controller?.abort()
    const currentGeneration = ++generation
    if (!identityScope.value) { status.value = 'idle'; return false }
    controller = new AbortController()
    status.value = 'pending'
    try {
      const receipt = await economyApi.create('/events', { event: 'HALL_ENTERED' },
        { autoLoading: false, signal: controller.signal })
      if (currentGeneration !== generation) return false
      if (!Array.isArray(receipt?.grants) || receipt.grants.some(grant =>
        typeof grant.campaignRef !== 'string' || !grant.campaignRef ||
        typeof grant.transactionId !== 'string' || !grant.transactionId ||
        grant.status !== 'POSTED' || !isWenMoney(grant.amount))) {
        throw new Error('活动发放回执不可用')
      }
      status.value = 'confirmed'
      return true
    } catch (error) {
      if (currentGeneration !== generation) return false
      status.value = 'unconfirmed'
      onError?.(error)
      return false // Re-entry/retry sends the same event; only the server knows claimed campaigns.
    }
  }
  watch([identityScope, authorizationGeneration], notify, { immediate: true, flush: 'sync' })
  onScopeDispose(() => { generation += 1; controller?.abort() })
  return { status, retry: notify }
}
