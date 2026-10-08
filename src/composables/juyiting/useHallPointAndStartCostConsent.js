import { computed, ref, unref, watch } from 'vue'
import { createPointAndStartIntentStore, exactPointAndStartId, exactPointAndStartScope } from './hallPointAndStartIntent.js'
import { providerConsentIssueBody, providerConsentReceipt } from './hallPointAndStartProviderConsent.js'

const clone = value => JSON.parse(JSON.stringify(value))
const initialState = () => ({ status: 'IDLE', intent: null, receipt: null, error: null })
const unwrap = result => {
  const envelope = result && Object.hasOwn(result, 'code') ? result : result?.data ?? result
  if (envelope && Object.hasOwn(envelope, 'code')) {
    if (![undefined, null, 'E0', '0', 0, '200', 200].includes(envelope.code)) {
      const error = new Error(envelope.msg || '费用同意读取或办理被拒绝')
      error.code = envelope.code
      error.status = envelope.status
      throw error
    }
    return envelope.data?.data ?? envelope.data
  }
  return envelope?.data ?? envelope
}

/** Frozen core issuer only: no assign, Provider, paid capability, or new session. */
export const useHallPointAndStartCostConsent = ({ agentApi, actorScopeKey, storage = null, keys = {} }) => {
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
  const key = (name) => typeof keys[name] === 'function' ? keys[name]() : globalThis.crypto?.randomUUID?.()
  const store = (captured, taskId) => createPointAndStartIntentStore({ storage, scope: captured, taskId })
  const options = idempotencyKey => ({ autoLoading: false, headers: { 'Idempotency-Key': idempotencyKey } })
  const load = (captured, taskId) => {
    const read = store(captured, taskId).read()
    if (!['ABSENT', 'PRESENT'].includes(read.state)) throw new Error('原点将记录损坏或不可用；未发送新的费用同意')
    return read.record || null
  }
  const save = (captured, intent) => {
    const written = store(captured, intent.taskId).write(intent)
    if (written.state !== 'PRESENT') throw new Error('原费用意图持久化核对失败；未发送请求')
    return written.record
  }
  const publish = (intent, status, error = null) => { state.value = { status, intent, receipt: intent?.providerConsent?.receipt || null, error } }
  const requestPath = taskId => `/tasks/${encodeURIComponent(taskId)}/point-and-start-cost-consents/request`
  const issuePath = taskId => `/tasks/${encodeURIComponent(taskId)}/point-and-start-cost-consents`
  const getOriginal = async intent => unwrap(await agentApi.get(requestPath(intent.taskId), undefined, options(intent.providerConsent.issueKey)))
  const accept = (intent, value, firstIssue = false) => {
    const receipt = providerConsentReceipt(value, intent, intent.providerConsent.receipt)
    if (!receipt || firstIssue && receipt.state !== 'ISSUED') throw new Error('费用同意回执不匹配、越级或版本回退；保留原键核对')
    return { ...intent, providerConsent: { ...intent.providerConsent, receipt } }
  }
  const readReceipt = async (intent, captured, epoch, capturedContext) => {
    const received = await getOriginal(intent)
    if (!current(captured, epoch, capturedContext)) return null
    const next = save(captured, accept(intent, received))
    publish(next, next.providerConsent.receipt.state)
    return next
  }
  const issue = async (intent, captured, epoch, capturedContext, firstIssue = false) => {
    const extension = intent.providerConsent
    const received = unwrap(await agentApi.create(issuePath(intent.taskId), clone(extension.issueBody), options(extension.issueKey)))
    if (!current(captured, epoch, capturedContext)) return null
    const next = save(captured, accept(intent, received, firstIssue))
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

  // New core issuance is allowed only when the shared original-intent slot is absent.
  const prepareAndIssue = ({ taskId, assignment, providerBinding, acknowledgement } = {}) => run(taskId, async (captured, epoch, capturedContext) => {
    if (!contextAllows(taskId, assignment?.agentId)) throw new Error('当前点将上下文已变化；未发送费用同意')
    const existing = load(captured, taskId)
    if (existing) {
      publish(existing, existing.providerConsent ? 'UNKNOWN' : 'ORIGINAL_PENDING')
      return false
    }
    const assignmentKey = key('createAssignmentKey')
    const issueKey = key('createIssueKey')
    if (!exactPointAndStartId(assignmentKey) || !exactPointAndStartId(issueKey)) throw new Error('原点将键或费用同意键无效；未发送请求')
    const issueBody = providerConsentIssueBody({ assignmentIdempotencyKey: assignmentKey, assignment, providerBinding, acknowledgement })
    if (!issueBody) throw new Error('费用同意内容超出冻结合同；未发送请求')
    const intent = save(captured, { schemaVersion: 1, taskId, key: assignmentKey, body: clone(assignment), postAcknowledged: false,
      providerConsent: { schemaVersion: 1, issueKey, issueBody, receipt: null, revoke: null } })
    publish(intent, 'ISSUING')
    return Boolean(await issue(intent, captured, epoch, capturedContext, true))
  })
  const checkOriginal = taskId => run(taskId, async (captured, epoch, capturedContext) => {
    const intent = load(captured, taskId)
    if (!intent?.providerConsent || !contextAllows(taskId, intent.body.agentId)) return false
    publish(intent, intent.providerConsent.receipt ? intent.providerConsent.receipt.state : 'UNKNOWN')
    return Boolean(await readReceipt(intent, captured, epoch, capturedContext))
  })
  // Explicit user recovery only. GET404 alone never means an issue POST was not admitted.
  const resumeOriginal = taskId => run(taskId, async (captured, epoch, capturedContext) => {
    const intent = load(captured, taskId)
    if (!intent?.providerConsent || !contextAllows(taskId, intent.body.agentId)) return false
    publish(intent, intent.providerConsent.receipt ? intent.providerConsent.receipt.state : 'UNKNOWN')
    try { return Boolean(await readReceipt(intent, captured, epoch, capturedContext)) } catch (error) {
      if (!current(captured, epoch, capturedContext)) return false
      if (error?.status !== 404) throw error
      return Boolean(await issue(intent, captured, epoch, capturedContext, false))
    }
  })
  // This is also the explicit retry surface for an UNKNOWN revoke. It always reads first.
  const revokeOriginal = taskId => run(taskId, async (captured, epoch, capturedContext) => {
    let intent = load(captured, taskId)
    if (!intent?.providerConsent || !contextAllows(taskId, intent.body.agentId)) return false
    publish(intent, intent.providerConsent.receipt ? intent.providerConsent.receipt.state : 'UNKNOWN')
    intent = await readReceipt(intent, captured, epoch, capturedContext)
    if (!intent || !current(captured, epoch, capturedContext)) return false
    const receipt = intent.providerConsent.receipt
    if (receipt.state === 'REVOKED') return true
    if (receipt.state === 'CONSUMED') throw new Error('已消费的费用同意不可撤销')
    let revoke = intent.providerConsent.revoke
    if (!revoke) {
      const revokeKey = key('createRevokeKey')
      if (!exactPointAndStartId(revokeKey)) throw new Error('撤销键无效；未发送请求')
      revoke = { key: revokeKey, expectedVersion: receipt.version }
      intent = save(captured, { ...intent, providerConsent: { ...intent.providerConsent, revoke } })
      publish(intent, 'REVOKING')
    }
    const path = `${issuePath(intent.taskId)}/${encodeURIComponent(receipt.consentId)}/revoke`
    const received = unwrap(await agentApi.create(path, { expectedVersion: revoke.expectedVersion }, options(revoke.key)))
    if (!current(captured, epoch, capturedContext)) return false
    const next = save(captured, accept(intent, received))
    publish(next, next.providerConsent.receipt.state)
    return true
  })
  return { state, busy, context, selectContext, prepareAndIssue, checkOriginal, resumeOriginal, revokeOriginal,
    dispose: () => { disposed = true; generation++; stopWatch(); busy.value = false } }
}
