import { computed, ref, unref, watch } from 'vue'
import { bountyBootstrapReference } from './hallBountyBootstrap.js'
import { createPointAndStartIntentStore, exactPointAndStartId, exactPointAndStartScope, pointAndStartBody,
  pointAndStartGrant, pointAndStartLong, pointAndStartProjection } from './hallPointAndStartIntent.js'

const unwrap = result => {
  const envelope = result && Object.hasOwn(result, 'code') ? result : result?.data ?? result
  if (envelope && Object.hasOwn(envelope, 'code')) {
    if (![undefined, null, 'E0', '0', 0, '200', 200].includes(envelope.code)) {
      const error = new Error(envelope.msg || '点将读取或办理被拒绝')
      error.code = envelope.code
      error.status = envelope.status
      throw error
    }
    return envelope.data?.data ?? envelope.data
  }
  return envelope?.data ?? envelope
}
const clone = value => JSON.parse(JSON.stringify(value))
const initialState = () => ({ status: 'IDLE', intent: null, projection: null, error: null })

/** Negotiation is supplied by the server-capability integration, never the UI flag.
 * This source slice does not advertise support or authorize fees/tools itself. */
export const useHallPointAndStart = ({ agentApi, actorScopeKey, storage = null,
  isSupported = () => false, canReplayOriginal = () => false, canAssign = () => false, createIdempotencyKey = () => globalThis.crypto.randomUUID(),
  onAdmitted = async () => false }) => {
  const scope = computed(() => unref(typeof actorScopeKey === 'function' ? actorScopeKey() : actorScopeKey))
  const state = ref(initialState())
  const busy = ref(false)
  let generation = 0
  let disposed = false
  const current = (captured, epoch) => !disposed && scope.value === captured && generation === epoch
  const stopWatch = watch(scope, () => { generation++; state.value = initialState(); busy.value = false }, { flush: 'sync' })
  const store = (captured, taskId) => createPointAndStartIntentStore({ storage, scope: captured, taskId })
  const readIntent = (captured, taskId) => {
    const read = store(captured, taskId).read()
    if (!['ABSENT', 'PRESENT'].includes(read.state)) throw new Error('原点将恢复记录损坏或不可用；未发送新的点将')
    return read.record || null
  }
  const persist = (captured, intent) => {
    const saved = store(captured, intent.taskId).write(intent)
    if (saved.state !== 'PRESENT') throw new Error('原点将记录持久化核对失败；请核对原请求')
    return saved.record
  }
  const options = key => ({ autoLoading: false, ...(key ? { headers: { 'Idempotency-Key': key } } : {}) })
  const get = async (path, key) => unwrap(await agentApi.get(path, undefined, options(key)))
  const project = async (intent, captured, epoch) => {
    const value = await get(`/tasks/${encodeURIComponent(intent.taskId)}/assignment-operation`, intent.key)
    if (!current(captured, epoch)) return null
    const projection = pointAndStartProjection(value, intent, intent.projection)
    if (!projection) throw new Error('原点将投影不匹配或版本回退；未再次办理')
    intent = persist(captured, { ...intent, projection })
    state.value = { status: !projection.currentAssignment ? 'HISTORICAL' : projection.bootstrapState === 'ADMITTED'
      ? 'ADMITTED' : projection.bootstrapState === 'DEAD' ? 'FAILED' : 'PREPARING', intent, projection, error: null }
    if (!projection.currentAssignment || projection.bootstrapState !== 'ADMITTED') return intent
    const task = await get(`/tasks/${encodeURIComponent(intent.taskId)}`)
    if (!current(captured, epoch)) return null
    if (task?.id !== intent.taskId || !pointAndStartLong(task.taskVersion, true) ||
      BigInt(task.taskVersion) < BigInt(projection.taskVersion) || task.assignedAgentId !== intent.body.agentId ||
      !['assigned', 'running', 'submitted', 'completed'].includes(task.status)) throw new Error('点将已确认，当前榜文快照尚未核对；未补发首轮')
    // A newer task snapshot may reflect reassignment; recheck the original action
    // before attaching, instead of treating taskVersion as assignmentRevision.
    if (task.taskVersion !== projection.taskVersion) {
      const fresh = pointAndStartProjection(await get(`/tasks/${encodeURIComponent(intent.taskId)}/assignment-operation`, intent.key), intent, projection)
      if (!current(captured, epoch)) return null
      if (!fresh || !fresh.currentAssignment || fresh.taskVersion !== task.taskVersion) throw new Error('榜文已变化；请只读重查原点将')
      intent = persist(captured, { ...intent, projection: fresh })
      state.value = { ...state.value, intent, projection: fresh }
    }
    if (!current(captured, epoch)) return null
    const adopted = await onAdmitted({ task: clone(task), targetAgentId: intent.body.agentId,
      reference: bountyBootstrapReference(intent.projection), isCurrent: () => current(captured, epoch) })
    if (!current(captured, epoch)) return null
    state.value = { ...state.value, status: adopted === true ? 'ATTACHED' : 'ADMITTED' }
    return intent
  }
  const send = async (intent, captured, epoch) => {
    const result = unwrap(await agentApi.create(`/tasks/${encodeURIComponent(intent.taskId)}/assign`, clone(intent.body), options(intent.key)))
    if (!current(captured, epoch)) return null
    const grant = pointAndStartGrant(result, intent)
    if (!grant) throw new Error('原点将回执未能匹配；保留原键核对，不重新点将')
    intent = persist(captured, { ...intent, grant, postAcknowledged: true })
    state.value = { status: 'CONFIRMED', intent, projection: intent.projection || null, error: null }
    return project(intent, captured, epoch)
  }
  const run = async (taskId, action) => {
    if (disposed || busy.value || !exactPointAndStartId(taskId) || !exactPointAndStartScope(scope.value)) return false
    const captured = scope.value
    const epoch = generation
    busy.value = true
    try { return Boolean(await action(captured, epoch)) } catch (error) {
      if (current(captured, epoch)) state.value = { ...state.value,
        status: state.value.intent?.postAcknowledged || state.value.projection ? state.value.status : state.value.intent ? 'UNKNOWN' : 'REJECTED', error: error.message }
      return false
    } finally { if (current(captured, epoch)) busy.value = false }
  }
  const checkOriginal = taskId => run(taskId, async (captured, epoch) => {
    const intent = readIntent(captured, taskId)
    if (!intent) return false
    if (intent.providerConsent) {
      state.value = { status: 'COST_CONSENT_PENDING', intent, projection: null, error: '费用意图须使用费用同意恢复；未调用旧点将' }
      return false
    }
    state.value = { status: intent.projection ? 'CONFIRMED' : 'UNKNOWN', intent, projection: intent.projection || null, error: null }
    return project(intent, captured, epoch)
  })
  const start = ({ task, agent, requestedOperations, initialOperation, inputRefs = [] }) => {
    // Capture the explicit clicked target and selection before any asynchronous
    // read. Editing the draft while GET runs must never alter the admitted body.
    const taskId = task?.id
    const targetId = agent?.agentId
    let ops, refs
    try { ops = clone(requestedOperations); refs = clone(inputRefs) } catch { return Promise.resolve(false) }
    return run(taskId, async (captured, epoch) => {
      if (isSupported(task, agent) !== true || task?.funding?.mode === 'FUNDED_SINGLE_AGENT' ||
      !exactPointAndStartId(targetId)) throw new Error('此榜或目标尚未协商支持新办理流程')
      const old = readIntent(captured, taskId)
      if (old) {
        const consentPending = Boolean(old.providerConsent)
        state.value = { status: consentPending ? 'COST_CONSENT_PENDING' : 'UNKNOWN', intent: old, projection: consentPending ? null : old.projection || null,
          error: consentPending ? '存在费用同意意图，请使用费用意图恢复；未调用旧点将' : null }
        throw new Error(consentPending ? '存在费用同意意图，请使用费用意图恢复；未调用旧点将' : '存在原点将记录，请明确核对或恢复原操作')
      }
      const requirement = await get(`/tasks/${encodeURIComponent(taskId)}/requirements/current`)
      if (!current(captured, epoch)) return false
      if (task?.id !== taskId || agent?.agentId !== targetId) throw new Error('榜文或显式目标已变化；未发送点将')
      const canonical = await get(`/tasks/${encodeURIComponent(taskId)}`)
      if (!current(captured, epoch)) return false
      if (task?.id !== taskId || agent?.agentId !== targetId) throw new Error('榜文或显式目标已变化；未发送点将')
      if (requirement?.taskId !== taskId || !pointAndStartLong(requirement.taskVersion, true) ||
      !pointAndStartLong(requirement.requirementRevision) || typeof requirement.title !== 'string' || !requirement.title ||
      !(requirement.description === null || typeof requirement.description === 'string') ||
      !/^[a-f0-9]{64}$/.test(requirement.contentSha256) || !['CREATE', 'RECONFIRM'].includes(requirement.source) ||
      canonical?.id !== taskId || canonical.taskVersion !== requirement.taskVersion ||
      canonical.status !== 'open' || canAssign(canonical, agent) !== true || isSupported(canonical, agent) !== true) throw new Error('真实需求修订、榜文版本或目标准入未能核对')
      const body = pointAndStartBody({ agentId: targetId, taskVersion: requirement.taskVersion,
        requirementRevision: requirement.requirementRevision, requestedOperations: ops, initialOperation, inputRefs: refs })
      if (!body) throw new Error('动作、资料或版本超出当前写合同；未发送点将')
      const key = createIdempotencyKey()
      if (!exactPointAndStartId(key)) throw new Error('原点将键无效；未发送点将')
      const intent = persist(captured, { schemaVersion: 1, taskId, key, body, postAcknowledged: false })
      state.value = { status: 'SENDING', intent, projection: null, error: null }
      return send(intent, captured, epoch)
    })
  }
  // This method is ONLY for an explicit user recovery action. Refresh/mount uses
  // checkOriginal; GET404 is not evidence that the POST was never admitted.
  const resumeOriginal = taskId => run(taskId, async (captured, epoch) => {
    const intent = readIntent(captured, taskId)
    if (!intent) return false
    if (intent.providerConsent) {
      state.value = { status: 'COST_CONSENT_PENDING', intent, projection: null, error: '费用意图须使用费用同意恢复；未调用旧点将' }
      return false
    }
    state.value = { status: intent.postAcknowledged ? 'CONFIRMED' : 'UNKNOWN', intent, projection: intent.projection || null, error: null }
    try { return await project(intent, captured, epoch) } catch (error) {
      if (!current(captured, epoch)) return false
      if (error?.status !== 404 || error?.code !== 'ASSIGNMENT_OPERATION_UNAVAILABLE' ||
        intent.postAcknowledged || intent.projection || canReplayOriginal({ id: taskId }, { agentId: intent.body.agentId }) !== true) throw error
      return send(intent, captured, epoch)
    }
  })
  return { state, busy, start, checkOriginal, resumeOriginal,
    dispose: () => { disposed = true; generation++; stopWatch(); busy.value = false } }
}
