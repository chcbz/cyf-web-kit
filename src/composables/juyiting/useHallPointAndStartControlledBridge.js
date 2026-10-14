import { computed, ref, unref, watch } from 'vue'
import { createPointAndStartIntentStore, exactPointAndStartId, exactPointAndStartScope } from './hallPointAndStartIntent.js'
import { providerConsentReceipt } from './hallPointAndStartProviderConsent.js'
import { controlledImagePointAndStartReceipt } from './hallControlledImagePointAndStartBridge.js'
const clone = value => JSON.parse(JSON.stringify(value))
const state0 = () => ({ status: 'IDLE', intent: null, receipt: null, error: null })
const unwrap = result => { const e = result && Object.hasOwn(result, 'code') ? result : result?.data ?? result; if (e && Object.hasOwn(e, 'code')) { if (![undefined, null, 'E0', '0', 0, '200', 200].includes(e.code)) { const x = new Error(e.msg || e.message || '受控点将请求被拒绝'); x.code = e.code; x.status = e.status; throw x }; return e.data?.data ?? e.data }; return e?.data ?? e }
/** Historical GET-only audit. Retired image/consent intents can never issue or replay a write. */
export const useHallPointAndStartControlledBridge = ({ agentApi, actorScopeKey, storage = null, onBound = null }) => {
  const scope = computed(() => unref(typeof actorScopeKey === 'function' ? actorScopeKey() : actorScopeKey)); const state = ref(state0()); const busy = ref(false)
  let generation = 0; let disposed = false; const context = ref({ taskId: null, targetAgentId: null })
  const same = (a, b) => a.taskId === b.taskId && a.targetAgentId === b.targetAgentId
  const current = (captured, epoch, capturedContext) => !disposed && captured === scope.value && epoch === generation && same(context.value, capturedContext)
  const selectContext = ({ taskId = null, targetAgentId = null } = {}) => { if ((taskId !== null && !exactPointAndStartId(taskId)) || (targetAgentId !== null && !exactPointAndStartId(targetAgentId))) return false; if (!same(context.value, { taskId, targetAgentId })) { generation++; busy.value = false; context.value = { taskId, targetAgentId }; state.value = state0() }; return true }
  const stop = watch(scope, () => { generation++; busy.value = false; context.value = { taskId: null, targetAgentId: null }; state.value = state0() }, { flush: 'sync' })
  const store = (captured, taskId) => createPointAndStartIntentStore({ storage, scope: captured, taskId })
  const load = (captured, taskId) => { const read = store(captured, taskId).read(); if (!['ABSENT', 'PRESENT'].includes(read.state)) throw new Error('原受控点将记录损坏或不可用；未发送请求'); return read.record || null }
  const options = key => ({ autoLoading: false, headers: { 'Idempotency-Key': key } })
  const issuePath = taskId => `/tasks/${encodeURIComponent(taskId)}/point-and-start-cost-consents`
  const issueReadPath = taskId => `${issuePath(taskId)}/request`
  const bridgePath = taskId => `/tasks/${encodeURIComponent(taskId)}/point-and-start-controlled-image`
  const bridgeReadPath = taskId => `${bridgePath(taskId)}/request`
  const publish = (intent, status, error = null) => { state.value = { status, intent, receipt: intent?.controlledImageBridge?.receipt || intent?.providerConsent?.receipt || null, error } }
  const acceptIssue = (intent, value, first = false) => { const receipt = providerConsentReceipt(value, intent, intent.providerConsent.receipt); if (!receipt || (first && receipt.state !== 'ISSUED')) throw new Error('费用同意回执不匹配；保留原键核对'); return { ...intent, providerConsent: { ...intent.providerConsent, receipt } } }
  const acceptBridge = (intent, value, first = false) => { const receipt = controlledImagePointAndStartReceipt(value, intent, intent.controlledImageBridge.receipt); if (!receipt || first && receipt.providerConsent.state !== 'BOUND') throw new Error('受控点将回执不匹配、越级或版本回退；保留原键核对'); return { ...intent, providerConsent: { ...intent.providerConsent, receipt: receipt.providerConsent }, controlledImageBridge: { ...intent.controlledImageBridge, receipt } } }
  const run = async (taskId, action) => { if (disposed || busy.value || !exactPointAndStartId(taskId) || !exactPointAndStartScope(scope.value) || (context.value.taskId && context.value.taskId !== taskId)) return false; const captured = scope.value; const epoch = generation; const capturedContext = clone(context.value); busy.value = true; try { return Boolean(await action(captured, epoch, capturedContext)) } catch (error) { if (current(captured, epoch, capturedContext)) { let intent = null; try { intent = load(captured, taskId) } catch { intent = null } ; publish(intent, intent ? 'UNKNOWN' : 'REJECTED', error.message) }; return false } finally { if (current(captured, epoch, capturedContext)) busy.value = false } }
  const observe = async (intent, captured, epoch, capturedContext) => { const receipt = intent.controlledImageBridge.receipt; publish(intent, receipt.providerConsent.state); if (onBound && ['BOUND', 'RESERVED', 'CONSUMED'].includes(receipt.providerConsent.state)) await onBound({ intent, receipt, isCurrent: () => current(captured, epoch, capturedContext) }); return intent }
  const start = async () => { publish(null, 'RETIRED', '旧图片及费用同意写入口已退出；请使用当前议事技能'); return false }
  const restore = taskId => {
    const captured = scope.value; const intent = load(captured, taskId)
    if (!intent?.providerConsent) return null
    if (context.value.taskId === null && context.value.targetAgentId === null) selectContext({ taskId, targetAgentId: intent.body.agentId })
    return same(context.value, { taskId, targetAgentId: intent.body.agentId }) ? intent : null
  }
  const readIssue = async (captured, intent) => acceptIssue(intent,
    unwrap(await agentApi.get(issueReadPath(intent.taskId), undefined, options(intent.providerConsent.issueKey))))
  const checkOriginal = taskId => {
    let intent; try { intent = restore(taskId) } catch { return Promise.resolve(false) }
    return !intent ? Promise.resolve(false) : run(taskId, async (captured, epoch, capturedContext) => {
      if (!intent.controlledImageBridge) { const next = await readIssue(captured, intent); if (!current(captured, epoch, capturedContext)) return false; publish(next, next.providerConsent.receipt.state); return true }
      const got = unwrap(await agentApi.get(bridgeReadPath(taskId), undefined, options(intent.key))); if (!current(captured, epoch, capturedContext)) return false
      return Boolean(await observe(acceptBridge(intent, got), captured, epoch, capturedContext))
    })
  }
  // Explicit recovery is observation only; even GET404 cannot authorize another POST.
  const resumeOriginal = checkOriginal
  return { state, busy, context, selectContext, invalidate: () => { generation++; context.value = { taskId: null, targetAgentId: null }; busy.value = false }, start, checkOriginal, resumeOriginal, dispose: () => { disposed = true; generation++; busy.value = false; stop() } }
}
