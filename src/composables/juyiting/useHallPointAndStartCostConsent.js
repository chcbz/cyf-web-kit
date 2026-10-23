import { computed, ref, unref, watch } from 'vue'
import { createPointAndStartIntentStore, exactPointAndStartId, exactPointAndStartScope } from './hallPointAndStartIntent.js'
import { providerConsentReceipt } from './hallPointAndStartProviderConsent.js'

const clone = value => JSON.parse(JSON.stringify(value))
const initialState = () => ({ status: 'IDLE', intent: null, receipt: null, error: null })
const unwrap = result => result

/** Retired consent lane: exact historical GET audit only, never issue/revoke/replay. */
export const useHallPointAndStartCostConsent = ({ agentApi, actorScopeKey, storage = null }) => {
  const scope = computed(() => unref(typeof actorScopeKey === 'function' ? actorScopeKey() : actorScopeKey))
  const state = ref(initialState())
  const busy = ref(false)
  let generation = 0
  let disposed = false
  const context = ref({ taskId: null, targetAgentId: null })
  const sameContext = (left, right) => left.taskId === right.taskId && left.targetAgentId === right.targetAgentId
  const current = (captured, epoch, capturedContext) => !disposed && scope.value === captured && generation === epoch &&
    sameContext(context.value, capturedContext)
  const selectContext = ({ taskId = null, targetAgentId = null } = {}) => {
    if (taskId !== null && !exactPointAndStartId(taskId) || targetAgentId !== null && !exactPointAndStartId(targetAgentId)) return false
    if (sameContext(context.value, { taskId, targetAgentId })) return true
    generation++
    busy.value = false
    context.value = { taskId, targetAgentId }
    if (!disposed) state.value = initialState()
    return true
  }
  const contextAllows = (taskId, targetAgentId = null) =>
    (!context.value.taskId || context.value.taskId === taskId) &&
    (!context.value.targetAgentId || targetAgentId === null || context.value.targetAgentId === targetAgentId)
  const stopWatch = watch(scope, () => { generation++; context.value = { taskId: null, targetAgentId: null }; state.value = initialState(); busy.value = false }, { flush: 'sync' })
  const store = (captured, taskId) => createPointAndStartIntentStore({ storage, scope: captured, taskId })
  const options = idempotencyKey => ({ autoLoading: false, headers: { 'Idempotency-Key': idempotencyKey } })
  const load = (captured, taskId) => {
    const read = store(captured, taskId).read()
    if (!['ABSENT', 'PRESENT'].includes(read.state)) throw new Error('原点将记录损坏或不可用；未发送新的费用同意')
    return read.record || null
  }
  const publish = (intent, status, error = null) => { state.value = { status, intent, receipt: intent?.providerConsent?.receipt || null, error } }
  const requestPath = taskId => `/tasks/${encodeURIComponent(taskId)}/point-and-start-cost-consents/request`
  const getOriginal = async intent => unwrap(await agentApi.get(requestPath(intent.taskId), undefined, options(intent.providerConsent.issueKey)))
  const accept = (intent, value, firstIssue = false) => {
    const receipt = providerConsentReceipt(value, intent, intent.providerConsent.receipt)
    if (!receipt || firstIssue && receipt.state !== 'ISSUED') throw new Error('费用同意回执不匹配、越级或版本回退；保留原键核对')
    return { ...intent, providerConsent: { ...intent.providerConsent, receipt } }
  }
  const readReceipt = async (intent, captured, epoch, capturedContext) => {
    const received = await getOriginal(intent)
    if (!current(captured, epoch, capturedContext)) return null
    const next = accept(intent, received)
    publish(next, next.providerConsent.receipt.state)
    return next
  }
  const run = async (taskId, action) => {
    if (disposed || busy.value || !exactPointAndStartId(taskId) || !exactPointAndStartScope(scope.value) || !contextAllows(taskId)) return false
    const captured = scope.value
    const epoch = generation
    const capturedContext = clone(context.value)
    busy.value = true
    try { return Boolean(await action(captured, epoch, capturedContext)) } catch (error) {
      if (current(captured, epoch, capturedContext)) {
        const intent = (() => { try { return load(captured, taskId) } catch { return null } })()
        publish(intent, intent?.providerConsent ? 'UNKNOWN' : 'REJECTED', error.message)
      }
      return false
    } finally { if (current(captured, epoch, capturedContext)) busy.value = false }
  }

  const retired = async () => { publish(null, 'RETIRED', '旧费用同意写入口已退出；费用仅登记展示'); return false }
  const prepareAndIssue = retired
  const checkOriginal = taskId => run(taskId, async (captured, epoch, capturedContext) => {
    const intent = load(captured, taskId)
    if (!intent?.providerConsent || !contextAllows(taskId, intent.body.agentId)) return false
    publish(intent, intent.providerConsent.receipt ? intent.providerConsent.receipt.state : 'UNKNOWN')
    return Boolean(await readReceipt(intent, captured, epoch, capturedContext))
  })
  const resumeOriginal = checkOriginal
  const revokeOriginal = retired
  return { state, busy, context, selectContext, prepareAndIssue, checkOriginal, resumeOriginal, revokeOriginal,
    dispose: () => { disposed = true; generation++; stopWatch(); busy.value = false } }
}
