import { computed, ref, unref, watch } from 'vue'
import { createPointAndStartIntentStore, exactPointAndStartId, exactPointAndStartScope, pointAndStartBody, pointAndStartLong } from './hallPointAndStartIntent.js'
import { providerConsentAcknowledgement, providerConsentIssueBody, providerConsentReceipt } from './hallPointAndStartProviderConsent.js'
import { controlledImagePointAndStartReceipt, controlledImagePointAndStartWrapper } from './hallControlledImagePointAndStartBridge.js'
const clone = value => JSON.parse(JSON.stringify(value))
const state0 = () => ({ status: 'IDLE', intent: null, receipt: null, error: null })
const unwrap = result => { const e = result && Object.hasOwn(result, 'code') ? result : result?.data ?? result; if (e && Object.hasOwn(e, 'code')) { if (![undefined, null, 'E0', '0', 0, '200', 200].includes(e.code)) { const x = new Error(e.msg || e.message || '受控点将请求被拒绝'); x.code = e.code; x.status = e.status; throw x }; return e.data?.data ?? e.data }; return e?.data ?? e }
/** Controlled sibling flow: explicit acknowledgement, core issue, persisted exact wrapper, bridge POST/readback. */
export const useHallPointAndStartControlledBridge = ({ agentApi, actorScopeKey, storage = null, keys = {}, onBound = null }) => {
  const scope = computed(() => unref(typeof actorScopeKey === 'function' ? actorScopeKey() : actorScopeKey)); const state = ref(state0()); const busy = ref(false)
  let generation = 0; let disposed = false; const context = ref({ taskId: null, targetAgentId: null })
  const same = (a, b) => a.taskId === b.taskId && a.targetAgentId === b.targetAgentId
  const current = (captured, epoch, capturedContext) => !disposed && captured === scope.value && epoch === generation && same(context.value, capturedContext)
  const selectContext = ({ taskId = null, targetAgentId = null } = {}) => { if ((taskId !== null && !exactPointAndStartId(taskId)) || (targetAgentId !== null && !exactPointAndStartId(targetAgentId))) return false; if (!same(context.value, { taskId, targetAgentId })) { generation++; busy.value = false; context.value = { taskId, targetAgentId }; state.value = state0() }; return true }
  const stop = watch(scope, () => { generation++; busy.value = false; context.value = { taskId: null, targetAgentId: null }; state.value = state0() }, { flush: 'sync' })
  const store = (captured, taskId) => createPointAndStartIntentStore({ storage, scope: captured, taskId })
  const load = (captured, taskId) => { const read = store(captured, taskId).read(); if (!['ABSENT', 'PRESENT'].includes(read.state)) throw new Error('原受控点将记录损坏或不可用；未发送请求'); return read.record || null }
  const save = (captured, intent) => { const read = store(captured, intent.taskId).write(intent); if (read.state !== 'PRESENT') throw new Error('原受控点将记录持久化核对失败；未发送请求'); return read.record }
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
  const postBridge = async (intent, captured, epoch, capturedContext) => { const received = unwrap(await agentApi.create(bridgePath(intent.taskId), clone(intent.controlledImageBridge.wrapper), options(intent.key))); if (!current(captured, epoch, capturedContext)) return null; const next = save(captured, acceptBridge(intent, received, true)); return observe(next, captured, epoch, capturedContext) }
  const start = ({ task, agent, requestedOperations, initialOperation, inputRefs = [], providerBinding, acknowledgement } = {}) => {
    const taskId = task?.id; const targetAgentId = agent?.agentId
    return run(taskId, async (captured, epoch, capturedContext) => {
      if (!same(context.value, { taskId, targetAgentId }) || acknowledgement !== providerConsentAcknowledgement) throw new Error('必须由当前用户明确确认未知外部账户的一次图像请求；未发送请求')
      if (load(captured, taskId)) { publish(load(captured, taskId), 'UNKNOWN'); return false }
      const requirement = unwrap(await agentApi.get(`/tasks/${encodeURIComponent(taskId)}/requirements/current`, undefined, { autoLoading: false }))
      if (!current(captured, epoch, capturedContext)) return false
      const canonical = unwrap(await agentApi.get(`/tasks/${encodeURIComponent(taskId)}`, undefined, { autoLoading: false }))
      if (!current(captured, epoch, capturedContext) || requirement?.taskId !== taskId || !pointAndStartLong(requirement.taskVersion, true) || !pointAndStartLong(requirement.requirementRevision) || canonical?.id !== taskId || canonical.taskVersion !== requirement.taskVersion || canonical.status !== 'open') throw new Error('真实需求修订、榜文版本或目标准入未能核对')
      const assignment = pointAndStartBody({ agentId: targetAgentId, taskVersion: requirement.taskVersion, requirementRevision: requirement.requirementRevision, requestedOperations, initialOperation, inputRefs })
      const assignmentKey = typeof keys.createAssignmentKey === 'function' ? keys.createAssignmentKey() : globalThis.crypto?.randomUUID?.(); const issueKey = typeof keys.createIssueKey === 'function' ? keys.createIssueKey() : globalThis.crypto?.randomUUID?.()
      const issueBody = providerConsentIssueBody({ assignmentIdempotencyKey: assignmentKey, assignment, providerBinding, acknowledgement })
      if (!exactPointAndStartId(assignmentKey) || !exactPointAndStartId(issueKey) || !issueBody) throw new Error('受控点将内容超出冻结合同；未发送请求')
      let intent = save(captured, { schemaVersion: 1, taskId, key: assignmentKey, body: clone(assignment), postAcknowledged: false, providerConsent: { schemaVersion: 1, issueKey, issueBody, receipt: null, revoke: null } }); publish(intent, 'ISSUING')
      const issued = unwrap(await agentApi.create(issuePath(taskId), clone(issueBody), options(issueKey))); if (!current(captured, epoch, capturedContext)) return false
      intent = save(captured, acceptIssue(intent, issued, true)); const wrapper = controlledImagePointAndStartWrapper(intent, intent.providerConsent.receipt); if (!wrapper) throw new Error('费用同意尚未可绑定；未发送受控点将')
      intent = save(captured, { ...intent, controlledImageBridge: { schemaVersion: 1, wrapper, receipt: null } }); publish(intent, 'BINDING')
      return Boolean(await postBridge(intent, captured, epoch, capturedContext))
    })
  }
  const restore = taskId => {
    const captured = scope.value; const intent = load(captured, taskId)
    if (!intent?.providerConsent) return null
    if (context.value.taskId === null && context.value.targetAgentId === null) selectContext({ taskId, targetAgentId: intent.body.agentId })
    return same(context.value, { taskId, targetAgentId: intent.body.agentId }) ? intent : null
  }
  const bindIssued = (captured, intent, value) => {
    const issued = acceptIssue(intent, value)
    if (issued.providerConsent.receipt.state !== 'ISSUED') return issued
    if (issued.controlledImageBridge) return issued
    const wrapper = controlledImagePointAndStartWrapper(issued, issued.providerConsent.receipt)
    if (!wrapper) throw new Error('费用同意尚未可绑定；未发送受控点将')
    return save(captured, { ...issued, controlledImageBridge: { schemaVersion: 1, wrapper, receipt: null } })
  }
  const readIssue = async (captured, intent) => bindIssued(captured, intent,
    unwrap(await agentApi.get(issueReadPath(intent.taskId), undefined, options(intent.providerConsent.issueKey))))
  const checkOriginal = taskId => {
    let intent; try { intent = restore(taskId) } catch { return Promise.resolve(false) }
    return !intent ? Promise.resolve(false) : run(taskId, async (captured, epoch, capturedContext) => {
      if (!intent.controlledImageBridge) { const next = await readIssue(captured, intent); if (!current(captured, epoch, capturedContext)) return false; publish(next, next.controlledImageBridge ? 'BINDING' : next.providerConsent.receipt.state); return Boolean(next.controlledImageBridge) }
      const got = unwrap(await agentApi.get(bridgeReadPath(taskId), undefined, options(intent.key))); if (!current(captured, epoch, capturedContext)) return false
      return Boolean(await observe(save(captured, acceptBridge(intent, got)), captured, epoch, capturedContext))
    })
  }
  const resumeOriginal = taskId => {
    let intent; try { intent = restore(taskId) } catch { return Promise.resolve(false) }
    return !intent ? Promise.resolve(false) : run(taskId, async (captured, epoch, capturedContext) => {
      if (!intent.controlledImageBridge) {
        try { intent = await readIssue(captured, intent) } catch (error) {
          if (!current(captured, epoch, capturedContext)) return false
          if (error?.status !== 404) throw error
          const issued = unwrap(await agentApi.create(issuePath(taskId), clone(intent.providerConsent.issueBody), options(intent.providerConsent.issueKey)))
          if (!current(captured, epoch, capturedContext)) return false
          intent = bindIssued(captured, intent, issued)
        }
        if (!current(captured, epoch, capturedContext) || !intent.controlledImageBridge) return false
      }
      try { const got = unwrap(await agentApi.get(bridgeReadPath(taskId), undefined, options(intent.key))); if (!current(captured, epoch, capturedContext)) return false; return Boolean(await observe(save(captured, acceptBridge(intent, got)), captured, epoch, capturedContext)) } catch (error) { if (!current(captured, epoch, capturedContext)) return false; if (error?.status !== 404) throw error; return Boolean(await postBridge(intent, captured, epoch, capturedContext)) }
    })
  }
  return { state, busy, context, selectContext, invalidate: () => { generation++; context.value = { taskId: null, targetAgentId: null }; busy.value = false }, start, checkOriginal, resumeOriginal, dispose: () => { disposed = true; generation++; busy.value = false; stop() } }
}
