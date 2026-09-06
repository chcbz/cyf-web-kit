import { computed, ref, unref, watch } from 'vue'
import { isCanonicalDecimalString } from '../../utils/silverAmount.js'
import { createEconomyRequestIntentStore } from './economyRequestIntent.js'

const responseBody = result => result && Object.prototype.hasOwnProperty.call(result, 'code') ? result : result?.data ?? result

const isBusinessSuccess = (result) => {
  const code = responseBody(result)?.code
  return code === undefined || code === null || code === 'E0' || code === '0' || code === 0 || code === '200' || code === 200
}

const ensureBusinessSuccess = (result) => {
  const body = responseBody(result)
  if (isBusinessSuccess(body)) return body

  const error = new Error(body?.msg || body?.message || '请求被拒绝')
  error.code = body?.code
  error.status = body?.status
  error.businessFailure = true
  throw error
}

const failureReason = (error, fallback) => error?.message || fallback
const unwrap = (result) => {
  const body = responseBody(result)
  if (body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'code')) return body.data?.data ?? body.data
  return body?.data ?? body
}
const isFundedTask = task => task?.funding?.mode === 'FUNDED_SINGLE_AGENT'
const hasExplicitAgentId = item => typeof item?.agentId === 'string' && Boolean(item.agentId.trim())
const taskVersion = task => {
  const version = task?.taskVersion ?? task?.version
  return isCanonicalDecimalString(version) ? version : ''
}
const DEFINITIVE_FUNDED_FAILURE_CODES = new Set([
  'INSUFFICIENT_SILVER', 'IDEMPOTENCY_CONFLICT', 'FUNDED_TEAM_NOT_SUPPORTED'
])
const isDefinitiveFundedFailure = error => DEFINITIVE_FUNDED_FAILURE_CODES.has(error?.code)
const defaultIdempotencyKey = () => globalThis.crypto?.randomUUID?.() || `economy-${Date.now()}-${Math.random().toString(36).slice(2)}`

export const useHallTaskActions = ({
  agentApi,
  canAssign,
  fundedActorScopeKey = () => '',
  fundedIntentStorage = typeof window !== 'undefined' ? window.localStorage : null,
  createIdempotencyKey = defaultIdempotencyKey,
  confirmFundedQuote = async () => false,
  resolveFundedAgent = agent => agent,
  now = () => Date.now(),
  log,
  playError,
  playSuccess,
  selectedAgent,
  selectedTask,
  showToast,
  tasks
}) => {
  // Keep the key for an unresolved request so retrying after a timeout or lost
  // response replays the exact same server-side operation instead of charging twice.
  const fundedActorScope = computed(() => {
    const scope = unref(typeof fundedActorScopeKey === 'function' ? fundedActorScopeKey() : fundedActorScopeKey)
    return typeof scope === 'string' ? scope.trim() : ''
  })
  // Cleanup must use the namespace that created the request, never whichever
  // principal happened to load while its response was in flight.
  const intentStoreForScope = scope => createEconomyRequestIntentStore({
    storage: fundedIntentStorage,
    scopeKey: () => scope
  })
  const pendingOperationKeys = new Map()
  const acquirePendingOperationKey = operation => {
    if (!pendingOperationKeys.has(operation)) pendingOperationKeys.set(operation, createIdempotencyKey())
    return pendingOperationKeys.get(operation)
  }
  const settlePendingOperation = operation => pendingOperationKeys.delete(operation)
  const fundedRequest = async (operation, send) => {
    try {
      const result = await send(acquirePendingOperationKey(operation))
      const payload = unwrap(ensureBusinessSuccess(result))
      // A successful decoded response is completion certainty. Only documented
      // definitive no-effect failures release a key; unknown outcomes replay it.
      settlePendingOperation(operation)
      return payload
    } catch (error) {
      if (isDefinitiveFundedFailure(error)) settlePendingOperation(operation)
      throw error
    }
  }

  const fundedCreateRecovery = ref(null)
  const fundedCreateStorageFailure = state => state === 'CORRUPT'
    ? '资金榜恢复记录损坏或版本未知；为防止重复扣款，已停止张榜。'
    : '资金榜恢复记录不可用；为防止重复扣款，已停止张榜。'
  const readFundedCreateRecovery = () => {
    const scope = fundedActorScope.value
    const current = intentStoreForScope(scope).get('funded-create')
    fundedCreateRecovery.value = current.state === 'PRESENT' ? current.record : null
    return current
  }
  // The authenticated principal can arrive after this composable mounts. Scope
  // changes must discard the prior actor presentation before reading its own
  // namespace so no recovery action can cross actor boundaries.
  watch(fundedActorScope, () => {
    fundedCreateRecovery.value = null
    readFundedCreateRecovery()
  }, { immediate: true, flush: 'sync' })
  const sendFundedCreate = async (intent, scope) => {
    const task = unwrap(ensureBusinessSuccess(await agentApi.create('/tasks', intent.body, {
      autoLoading: false, headers: { 'Idempotency-Key': intent.key }, onSuccess: ensureBusinessSuccess
    })))
    const removed = intentStoreForScope(scope).remove('funded-create')
    if (removed.state !== 'ABSENT') throw new Error(fundedCreateStorageFailure(removed.state))
    // An old principal's success is durable, but it must not replace the newer
    // principal's recovery panel, task list, selection, or toast presentation.
    if (fundedActorScope.value !== scope) return true
    fundedCreateRecovery.value = null
    tasks.value = [task, ...tasks.value.filter(item => item.id !== task.id)]
    selectedTask.value = task
    playSuccess(); showToast('榜文已张')
    return true
  }
  const createTask = async (payload) => {
    const funded = Boolean(payload?.grossBountyAmountMicro)
    if (!funded) {
      try {
        const task = unwrap(ensureBusinessSuccess(await agentApi.create('/tasks', payload, { autoLoading: false, onSuccess: ensureBusinessSuccess })))
        if (task) { tasks.value = [task, ...tasks.value.filter(item => item.id !== task.id)]; selectedTask.value = task }
        playSuccess(); showToast('榜文已张'); return true
      } catch (error) { log.warn('create bounty task failed:', error); playError(); showToast(`张榜未成：${failureReason(error, '请稍后再试')}`); return false }
    }
    const scope = fundedActorScope.value
    const store = intentStoreForScope(scope)
    const current = readFundedCreateRecovery()
    if (current.state === 'PRESENT') {
      showToast('存在未确认的原资金榜请求；请核对原正文并明确选择恢复，当前编辑稿未提交。')
      return false
    }
    if (current.state !== 'ABSENT') { showToast(fundedCreateStorageFailure(current.state)); return false }
    const saved = store.save('funded-create', { body: JSON.parse(JSON.stringify(payload)), key: createIdempotencyKey() })
    fundedCreateRecovery.value = saved.record || null
    if (saved.state !== 'PRESENT') { showToast(fundedCreateStorageFailure(saved.state)); return false }
    try { return await sendFundedCreate(saved.record, scope) } catch (error) {
      if (isDefinitiveFundedFailure(error)) {
        const removed = store.remove('funded-create')
        if (removed.state === 'ABSENT' && fundedActorScope.value === scope) fundedCreateRecovery.value = null
      }
      log.warn('create bounty task failed:', error); playError(); showToast(`张榜未成：${failureReason(error, '请稍后再试')}`); return false
    }
  }
  const resumeFundedCreate = async () => {
    const scope = fundedActorScope.value
    const store = intentStoreForScope(scope)
    const current = readFundedCreateRecovery()
    if (current.state !== 'PRESENT') { showToast(current.state === 'ABSENT' ? '没有待恢复的资金榜请求。' : fundedCreateStorageFailure(current.state)); return false }
    try { return await sendFundedCreate(current.record, scope) } catch (error) {
      if (isDefinitiveFundedFailure(error)) {
        const removed = store.remove('funded-create')
        if (removed.state === 'ABSENT' && fundedActorScope.value === scope) fundedCreateRecovery.value = null
      }
      log.warn('resume funded bounty create failed:', error); playError(); showToast(`原资金榜恢复未成：${failureReason(error, '请核对原请求')}`); return false
    }
  }

  const fundedClaimStates = ref(new Map())
  const lastClaimTaskId = ref(null)
  const fundedClaimState = computed(() => fundedClaimStates.value.get(selectedTask.value?.id || lastClaimTaskId.value) || null)
  const setFundedClaimState = state => {
    fundedClaimStates.value.set(state.taskId, state)
    lastClaimTaskId.value = state.taskId
  }
  const fundedClaimsInFlight = new Set()
  // Uncertain claims retain both the exact quote/body and key; never obtain a
  // replacement quote merely because the claim response was lost.
  const unresolvedClaims = new Map()
  const confirmedClaims = new Map()
  const validString = value => typeof value === 'string' && Boolean(value.trim())
  const unexpired = quote => isCanonicalDecimalString(quote?.expiresAt) && BigInt(quote.expiresAt) > BigInt(now())
  const matchingQuote = (quote, id, agentId, version) =>
    validString(quote?.quoteId) && quote.taskId === id && quote.agentId === agentId &&
    isCanonicalDecimalString(quote.taskVersion) && quote.taskVersion === version &&
    validString(quote.priceBookVersion) && validString(quote.recommendation) &&
    Array.isArray(quote.reasonCodes) && quote.reasonCodes.every(code => typeof code === 'string') &&
    ['input', 'cachedInput', 'output', 'reasoning'].every(key => isCanonicalDecimalString(quote.estimatedTokens?.[key])) &&
    ['estimatedComputeMicro', 'worstComputeMicro', 'platformFeeMicro', 'estimatedAgentPayoutMicro',
      'worstAgentPayoutMicro', 'minimumAcceptedPayoutMicro'].every(key => isCanonicalDecimalString(quote[key])) &&
    isCanonicalDecimalString(quote.expiresAt)
  const definitiveClaimFailures = new Set(['QUOTE_EXPIRED', 'TASK_VERSION_CONFLICT', 'AGENT_NOT_READY',
    'REQUIRED_SKILLS_MISMATCH', 'INSUFFICIENT_BOUNTY_BUDGET'])
  const agentVersionOf = agent => agent?.version ?? agent?.agentVersion ?? agent?.expectedAgentVersion
  const currentAgentMatches = (agent, agentId, version) => {
    const current = resolveFundedAgent(agent)
    return agent.agentId === agentId && agentVersionOf(agent) === version &&
      current?.agentId === agentId && agentVersionOf(current) === version
  }
  const currentTaskSnapshots = (id, task) => [task, ...tasks.value, selectedTask.value].filter(item => item?.id === id)
  const isCurrentPreview = (id, task, agent, agentId, version, agentVersion) =>
    task.id === id && currentAgentMatches(agent, agentId, agentVersion) &&
    currentTaskSnapshots(id, task).every(item => taskVersion(item) === version && item.status === 'open') &&
    canAssign(task, agent) && canAssign(task, resolveFundedAgent(agent))
  const matchingReceipt = (receipt, operation) => receipt?.taskId === operation.taskId &&
    receipt.agentId === operation.body.agentId && receipt.quoteId === operation.body.quoteId &&
    receipt.status === 'assigned' && isCanonicalDecimalString(receipt.taskVersion) &&
    // W05 receiptVersion = request.taskVersion + 1, including idempotent replay.
    BigInt(receipt.taskVersion) === BigInt(operation.body.taskVersion) + 1n &&
    isCanonicalDecimalString(receipt.claimedAt)

  const refreshClaimedTask = async (task, receipt) => {
    const snapshot = unwrap(ensureBusinessSuccess(await agentApi.get(`/tasks/${encodeURIComponent(receipt.taskId)}`, undefined, { autoLoading: false })))
    if (snapshot?.id !== receipt.taskId || !validString(snapshot.status) || !isCanonicalDecimalString(snapshot.taskVersion) ||
      BigInt(snapshot.taskVersion) < BigInt(receipt.taskVersion) ||
      (snapshot.taskVersion === receipt.taskVersion && (snapshot.status !== 'assigned' ||
        snapshot.assignedAgentId !== receipt.agentId))) throw new Error('领令已确认，榜文快照尚未同步')
    // Only canonical TaskDTO snapshots are applied. Never copy receipt fields or
    // overwrite an equal/newer snapshot, including one delivered while GET ran.
    for (const current of new Set(currentTaskSnapshots(receipt.taskId, task))) {
      const version = taskVersion(current)
      if (version && BigInt(snapshot.taskVersion) > BigInt(version)) Object.assign(current, snapshot)
    }
    const state = fundedClaimStates.value.get(receipt.taskId)
    if (state?.quoteId === receipt.quoteId) state.refreshPending = false
    return true
  }

  const refreshFundedClaim = async (task) => {
    const receipt = confirmedClaims.get(task?.id)
    if (!receipt) return false
    try {
      return await refreshClaimedTask(task, receipt)
    } catch (error) {
      log.warn('confirmed funded claim snapshot refresh pending:', error)
      showToast('领令已确认；榜文刷新待完成，请稍后重查')
      return false
    }
  }

  const claimFundedTask = async (task, agent) => {
    if (!task?.id || !hasExplicitAgentId(agent)) return false
    const id = task.id
    if (fundedClaimsInFlight.has(id) || confirmedClaims.has(id)) return false
    const agentId = agent.agentId
    const agentVersion = agentVersionOf(agent)
    const version = taskVersion(task)
    const recovery = unresolvedClaims.get(id)
    if (!version || (agentVersion !== undefined && !isCanonicalDecimalString(agentVersion)) ||
      (recovery && recovery.body.agentId !== agentId)) {
      showToast('榜文版本无效，或原领令尚待原好汉核对')
      return false
    }
    fundedClaimsInFlight.add(id)
    try {
      let operation = recovery
      if (!operation) {
        if (!isCurrentPreview(id, task, agent, agentId, version, agentVersion)) return false
        // This is a synthetic preview route, not provider billing. These frozen
        // canonical fields are required by the quote DTO and must not be omitted.
        const quoteRequest = {
          agentId,
          modelPreference: { provider: 'openai', model: 'configured-model' },
          contextRevision: version,
          minimumAcceptedPayoutMicro: '0'
        }
        const quote = await fundedRequest(`funded-quote:${id}:${agentId}:${version}`, key => agentApi.create(`/tasks/${encodeURIComponent(id)}/quotes`, quoteRequest, { autoLoading: false, headers: { 'Idempotency-Key': key }, onSuccess: ensureBusinessSuccess }))
        if (!matchingQuote(quote, id, agentId, version) || !unexpired(quote) ||
          !isCurrentPreview(id, task, agent, agentId, version, agentVersion)) throw new Error('报价已过期或榜文/好汉已变，请重新预览')
        operation = {
          taskId: id,
          quote: JSON.parse(JSON.stringify(quote)),
          body: { agentId, quoteId: quote.quoteId, taskVersion: version, allowQueue: false },
          key: null
        }
      }
      const approved = await confirmFundedQuote({
        quote: JSON.parse(JSON.stringify(operation.quote)),
        taskTitle: task.title,
        agentName: agent.name || agent.personaName || agentId,
        recovery: Boolean(recovery)
      })
      if (approved !== true) return false
      // Recovery only replays the previously confirmed operation (even if its
      // quote has since expired); it never silently replaces the quote/body.
      if (task.id !== id || !currentAgentMatches(agent, agentId, agentVersion) ||
        (!recovery && (!unexpired(operation.quote) ||
          !isCurrentPreview(id, task, agent, agentId, version, agentVersion)))) {
        showToast('报价已过期或榜文/好汉已变，请重新预览')
        return false
      }
      if (!operation.key) operation.key = createIdempotencyKey()
      unresolvedClaims.set(id, operation)
      setFundedClaimState({ taskId: id, agentId, quoteId: operation.body.quoteId, status: 'confirming' })
      let receipt
      try {
        receipt = unwrap(ensureBusinessSuccess(await agentApi.create(`/tasks/${encodeURIComponent(id)}/claim`, { ...operation.body }, {
          autoLoading: false, headers: { 'Idempotency-Key': operation.key }, onSuccess: ensureBusinessSuccess
        })))
        if (!matchingReceipt(receipt, operation)) throw new Error('领令回执不匹配；请核对原领令，不要重新取价')
      } catch (error) {
        if (isDefinitiveFundedFailure(error) || definitiveClaimFailures.has(error?.code)) unresolvedClaims.delete(id)
        setFundedClaimState({ taskId: id, agentId, quoteId: operation.body.quoteId,
          status: unresolvedClaims.has(id) ? 'unresolved' : 'rejected' })
        throw error
      }
      // Receipt success is durable knowledge before a fallible snapshot read.
      confirmedClaims.set(id, receipt)
      unresolvedClaims.delete(id)
      setFundedClaimState({ taskId: id, agentId, quoteId: receipt.quoteId, status: 'confirmed', refreshPending: true })
      playSuccess()
      showToast('领令已确认，正在刷新榜文')
      try {
        await refreshClaimedTask(task, receipt)
      } catch (error) {
        log.warn('confirmed funded claim snapshot refresh pending:', error)
        showToast('领令已确认；榜文刷新待完成，请重查，勿重复领令')
      }
      return true
    } catch (error) {
      log.warn('claim funded bounty task failed:', error)
      playError()
      showToast(`领资金榜未成：${failureReason(error, '请核对原领令')}`)
      return false
    } finally {
      fundedClaimsInFlight.delete(id)
    }
  }

  const assignTask = async (task, agent) => {
    const targetAgents = Array.isArray(agent) ? agent : [agent].filter(Boolean)
    if (!task?.id || !targetAgents.length || targetAgents.some(item => !hasExplicitAgentId(item))) return false
    if (isFundedTask(task)) {
      if (targetAgents.length !== 1) return false
      return claimFundedTask(task, targetAgents[0])
    }
    if (targetAgents.some(item => !canAssign(task, item))) return false

    const targetAgent = targetAgents[0]
    let assignmentSucceeded = false
    try {
      const assigned = unwrap(ensureBusinessSuccess(await agentApi.create(`/tasks/${task.id}/assign`, {
        agentId: targetAgent.agentId,
        agentIds: targetAgents.map(item => item.agentId)
      }, { autoLoading: false, onSuccess: ensureBusinessSuccess })))
      Object.assign(task, assigned || {
        status: 'assigned',
        assignedAgentIds: targetAgents.map(item => item.agentId),
        assignedAgentId: targetAgent.agentId,
        assignedAgentName: targetAgents.map(item => item.name || item.personaName || item.agentId).join('、')
      })
      targetAgents.forEach(item => {
        item.status = 'busy'
        item.currentTaskTitle = task.title
      })
      selectedAgent.value = targetAgent
      selectedTask.value = task
      assignmentSucceeded = true
      playSuccess()
      showToast(`${task.title} 已点给 ${task.assignedAgentName}`)
      return assignmentSucceeded
    } catch (error) {
      log.warn('assign bounty task failed:', error)
      playError()
      showToast(`点将未成：${failureReason(error, '请重查厅中动静')}`)
      return false
    }
  }

  const loadSettlement = async (task) => {
    if (!task?.id || !isFundedTask(task)) return null
    try {
      const settlement = unwrap(ensureBusinessSuccess(await agentApi.get(`/tasks/${task.id}/settlement`, undefined, { autoLoading: false })))
      task.settlement = settlement
      selectedTask.value = task
      return settlement
    } catch (error) {
      log.warn('load funded bounty settlement failed:', error)
      playError()
      showToast(`结算详情未取到：${failureReason(error, '请稍后再试')}`)
      return null
    }
  }

  const cancelFunding = async (task) => {
    if (!task?.id || !isFundedTask(task) || !taskVersion(task)) return false
    const version = taskVersion(task)
    try {
      const receipt = await fundedRequest(`funded-cancel:${task.id}:${version}`, key => agentApi.create(`/tasks/${task.id}/funding/cancel`, {
        expectedTaskVersion: version
      }, { autoLoading: false, headers: { 'Idempotency-Key': key }, onSuccess: ensureBusinessSuccess }))
      if (receipt?.taskId !== task.id || receipt?.fundingStatus !== 'REFUNDED' ||
        !validString(receipt?.refundTransactionId) || !['refundedMicro', 'remainingMicro', 'taskVersion', 'fundingVersion', 'refundedAt'].every(field => isCanonicalDecimalString(receipt?.[field])) ||
        BigInt(receipt.taskVersion) <= BigInt(version)) {
        throw new Error('撤榜回执不匹配；请核对原撤榜，不要重复扣款')
      }
      try {
        const canonical = unwrap(ensureBusinessSuccess(await agentApi.get(`/tasks/${encodeURIComponent(task.id)}`, undefined, { autoLoading: false })))
        if (canonical?.id !== task.id || !isCanonicalDecimalString(taskVersion(canonical)) || BigInt(taskVersion(canonical)) < BigInt(receipt.taskVersion)) {
          throw new Error('榜文快照尚未同步')
        }
        for (const current of new Set(currentTaskSnapshots(task.id, task))) {
          const currentVersion = taskVersion(current)
          if (!currentVersion || BigInt(taskVersion(canonical)) > BigInt(currentVersion)) Object.assign(current, canonical)
        }
        showToast('资金榜文已撤，余款已退回')
      } catch (refreshError) {
        // The immutable REFUNDED receipt is already confirmed. A stale/lost
        // readback is refresh-pending, never evidence to re-send the mutation.
        log.warn('confirmed funded cancellation snapshot refresh pending:', refreshError)
        showToast('资金榜文已撤确认；榜文刷新待完成，请稍后重查，勿重复撤榜')
      }
      playSuccess()
      return true
    } catch (error) {
      log.warn('cancel funded bounty failed:', error)
      playError()
      showToast(`撤榜未成：${failureReason(error, '仅可在开工前撤榜')}`)
      return false
    }
  }

  const autoAssignTask = async (task) => {
    if (!task || task.status !== 'open' || isFundedTask(task)) return false
    try {
      const assigned = unwrap(ensureBusinessSuccess(await agentApi.create(`/tasks/${task.id}/auto-assign`, {}, { autoLoading: false, onSuccess: ensureBusinessSuccess }))) || { ...task, status: 'assigned' }
      tasks.value = tasks.value.map(item => item.id === task.id ? { ...item, ...assigned } : item)
      selectedTask.value = { ...task, ...assigned }
      const assignedIds = assigned.assignedAgentIds || (assigned.assignedAgentId ? [assigned.assignedAgentId] : [])
      const assignedNames = assigned.assignees?.map(item => item.agentName || item.agentId).filter(Boolean)
      playSuccess()
      showToast(`宋江已点 ${assignedNames?.length ? assignedNames.join('、') : assignedIds.join('、')} 领令`)
      return true
    } catch (error) {
      log.warn('auto assign bounty task failed:', error)
      playError()
      showToast(`宋江点将未成：${failureReason(error, '请看荐单后手动点将')}`)
      return false
    }
  }

  const archiveTask = async (task) => {
    if (!task) return false
    try {
      const archived = unwrap(ensureBusinessSuccess(await agentApi.create(`/tasks/${task.id}/archive`, {}, { autoLoading: false, onSuccess: ensureBusinessSuccess }))) || { ...task, status: 'archived' }
      tasks.value = tasks.value.map(item => item.id === task.id ? archived : item)
      selectedTask.value = archived
      playSuccess()
      showToast('榜文已收入案卷')
      return true
    } catch (error) {
      log.warn('archive bounty task failed:', error)
      playError()
      showToast(`收入案卷未成：${failureReason(error, '请稍后再试')}`)
      return false
    }
  }

  return { archiveTask, autoAssignTask, assignTask, cancelFunding, createTask, loadSettlement, fundedClaimState, refreshFundedClaim, fundedCreateRecovery, resumeFundedCreate }
}
