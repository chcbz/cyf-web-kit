const isBusinessSuccess = (result) => {
  const code = result?.code
  return code === undefined || code === null || code === 'E0' || code === '0' || code === 0 || code === '200' || code === 200
}

const ensureBusinessSuccess = (result) => {
  if (isBusinessSuccess(result)) return result

  const error = new Error(result?.msg || result?.message || '请求被拒绝')
  error.code = result?.code
  error.status = result?.status
  throw error
}

const failureReason = (error, fallback) => error?.message || fallback
const unwrap = result => result?.data?.data ?? result?.data
const isFundedTask = task => task?.funding?.mode === 'FUNDED_SINGLE_AGENT'
const hasExplicitAgentId = item => typeof item?.agentId === 'string' && Boolean(item.agentId.trim())
const taskVersion = task => typeof (task?.version ?? task?.taskVersion) === 'string' ? (task.version ?? task.taskVersion) : ''
const defaultIdempotencyKey = () => globalThis.crypto?.randomUUID?.() || `economy-${Date.now()}-${Math.random().toString(36).slice(2)}`

export const useHallTaskActions = ({
  agentApi,
  canAssign,
  createIdempotencyKey = defaultIdempotencyKey,
  log,
  playError,
  playSuccess,
  selectedAgent,
  selectedTask,
  showToast,
  tasks
}) => {
  const createTask = async (payload) => {
    try {
      await agentApi.create('/tasks', payload, {
        autoLoading: false,
        headers: payload?.grossBountyAmountMicro ? { 'Idempotency-Key': createIdempotencyKey() } : {},
        onSuccess: (result) => {
          const task = unwrap(ensureBusinessSuccess(result))
          if (task) {
            tasks.value = [task, ...tasks.value.filter(item => item.id !== task.id)]
            selectedTask.value = task
          }
          playSuccess()
          showToast('榜文已张')
        }
      })
      return true
    } catch (error) {
      log.warn('create bounty task failed:', error)
      playError()
      showToast(`张榜未成：${failureReason(error, '请稍后再试')}`)
      return false
    }
  }

  const claimFundedTask = async (task, agent) => {
    if (!task?.id || !hasExplicitAgentId(agent)) return false
    const version = taskVersion(task)
    if (!version) {
      showToast('资金榜文缺少版本，暂不可领令')
      return false
    }
    let assignmentSucceeded = false
    try {
      const quoteResult = await agentApi.create(`/tasks/${task.id}/quotes`, {
        agentId: agent.agentId,
        taskVersion: version
      }, { autoLoading: false, headers: { 'Idempotency-Key': createIdempotencyKey() } })
      const quote = unwrap(ensureBusinessSuccess(quoteResult))
      if (!quote?.quoteId || quote.agentId !== agent.agentId || String(quote.taskVersion) !== version) {
        throw new Error('报价与当前好汉或榜文版本不一致')
      }
      task.quote = quote
      const claimResult = await agentApi.create(`/tasks/${task.id}/claim`, {
        agentId: agent.agentId,
        quoteId: quote.quoteId,
        taskVersion: version,
        allowQueue: false
      }, { autoLoading: false, headers: { 'Idempotency-Key': createIdempotencyKey() } })
      const claimed = unwrap(ensureBusinessSuccess(claimResult))
      Object.assign(task, claimed || { status: 'assigned', assignedAgentId: agent.agentId, assignedAgentIds: [agent.agentId] })
      agent.status = 'busy'
      agent.currentTaskTitle = task.title
      selectedAgent.value = agent
      selectedTask.value = task
      assignmentSucceeded = true
      playSuccess()
      showToast(`${task.title} 已按报价点给 ${agent.name || agent.personaName || agent.agentId}`)
    } catch (error) {
      log.warn('claim funded bounty task failed:', error)
      playError()
      showToast(`领资金榜未成：${failureReason(error, '请重取报价')}`)
    }
    return assignmentSucceeded
  }

  const assignTask = async (task, agent) => {
    const targetAgents = Array.isArray(agent) ? agent : [agent].filter(Boolean)
    if (!task?.id || !targetAgents.length || targetAgents.some(item => !hasExplicitAgentId(item))) return false
    if (isFundedTask(task)) {
      if (targetAgents.length !== 1 || !canAssign(task, targetAgents[0])) return false
      return claimFundedTask(task, targetAgents[0])
    }
    if (targetAgents.some(item => !canAssign(task, item))) return false

    const targetAgent = targetAgents[0]
    let assignmentSucceeded = false
    try {
      await agentApi.create(`/tasks/${task.id}/assign`, {
        agentId: targetAgent.agentId,
        agentIds: targetAgents.map(item => item.agentId)
      }, {
        autoLoading: false,
        onSuccess: (result) => {
          const assigned = unwrap(ensureBusinessSuccess(result))
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
        }
      })
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
      const result = await agentApi.get(`/tasks/${task.id}/settlement`, undefined, { autoLoading: false })
      const settlement = unwrap(ensureBusinessSuccess(result))
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
    try {
      const result = await agentApi.create(`/tasks/${task.id}/funding/cancel`, {
        expectedTaskVersion: taskVersion(task)
      }, { autoLoading: false, headers: { 'Idempotency-Key': createIdempotencyKey() } })
      const cancelled = unwrap(ensureBusinessSuccess(result))
      Object.assign(task, cancelled || {})
      selectedTask.value = task
      playSuccess()
      showToast('资金榜文已撤，余款已退回')
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
      await agentApi.create(`/tasks/${task.id}/auto-assign`, {}, {
        autoLoading: false,
        onSuccess: (result) => {
          const assigned = unwrap(ensureBusinessSuccess(result)) || { ...task, status: 'assigned' }
          tasks.value = tasks.value.map(item => item.id === task.id ? { ...item, ...assigned } : item)
          selectedTask.value = { ...task, ...assigned }
          const assignedIds = assigned.assignedAgentIds || (assigned.assignedAgentId ? [assigned.assignedAgentId] : [])
          const assignedNames = assigned.assignees?.map(item => item.agentName || item.agentId).filter(Boolean)
          playSuccess()
          showToast(`宋江已点 ${assignedNames?.length ? assignedNames.join('、') : assignedIds.join('、')} 领令`)
        }
      })
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
      await agentApi.create(`/tasks/${task.id}/archive`, {}, {
        autoLoading: false,
        onSuccess: (result) => {
          const archived = unwrap(ensureBusinessSuccess(result)) || { ...task, status: 'archived' }
          tasks.value = tasks.value.map(item => item.id === task.id ? archived : item)
          selectedTask.value = archived
          playSuccess()
          showToast('榜文已收入案卷')
        }
      })
      return true
    } catch (error) {
      log.warn('archive bounty task failed:', error)
      playError()
      showToast(`收入案卷未成：${failureReason(error, '请稍后再试')}`)
      return false
    }
  }

  return { archiveTask, autoAssignTask, assignTask, cancelFunding, createTask, loadSettlement }
}
