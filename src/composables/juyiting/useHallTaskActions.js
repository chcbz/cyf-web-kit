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

export const useHallTaskActions = ({
  agentApi,
  canAssign,
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
        onSuccess: (result) => {
          const task = ensureBusinessSuccess(result)?.data
          if (task) {
            tasks.value = [task, ...tasks.value.filter(item => item.id !== task.id)]
            selectedTask.value = task
          }
          playSuccess()
          showToast('榜文已张')
        }
      })
    } catch (error) {
      log.warn('create bounty task failed:', error)
      playError()
      showToast(`张榜未成：${failureReason(error, '请稍后再试')}`)
    }
  }

  const assignTask = async (task, agent) => {
    const targetAgents = Array.isArray(agent) ? agent : [agent].filter(Boolean)
    const hasExplicitAgentId = item => typeof item?.agentId === 'string' && Boolean(item.agentId.trim())
    if (!task?.id || !targetAgents.length || targetAgents.some(item => !hasExplicitAgentId(item))) return false
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
          const assigned = ensureBusinessSuccess(result)?.data
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

  const autoAssignTask = async (task) => {
    if (!task || task.status !== 'open') return
    try {
      await agentApi.create(`/tasks/${task.id}/auto-assign`, {}, {
        autoLoading: false,
        onSuccess: (result) => {
          const assigned = ensureBusinessSuccess(result)?.data || { ...task, status: 'assigned' }
          tasks.value = tasks.value.map(item => item.id === task.id ? { ...item, ...assigned } : item)
          selectedTask.value = { ...task, ...assigned }
          const assignedIds = assigned.assignedAgentIds || (assigned.assignedAgentId ? [assigned.assignedAgentId] : [])
          const assignedNames = assigned.assignees?.map(item => item.agentName || item.agentId).filter(Boolean)
          playSuccess()
          showToast(`宋江已点 ${assignedNames?.length ? assignedNames.join('、') : assignedIds.join('、')} 领令`)
        }
      })
    } catch (error) {
      log.warn('auto assign bounty task failed:', error)
      playError()
      showToast(`宋江点将未成：${failureReason(error, '请看荐单后手动点将')}`)
    }
  }

  const archiveTask = async (task) => {
    if (!task) return
    try {
      await agentApi.create(`/tasks/${task.id}/archive`, {}, {
        autoLoading: false,
        onSuccess: (result) => {
          const archived = ensureBusinessSuccess(result)?.data || { ...task, status: 'archived' }
          tasks.value = tasks.value.map(item => item.id === task.id ? archived : item)
          selectedTask.value = archived
          playSuccess()
          showToast('榜文已收入案卷')
        }
      })
    } catch (error) {
      log.warn('archive bounty task failed:', error)
      playError()
      showToast(`收入案卷未成：${failureReason(error, '请稍后再试')}`)
    }
  }

  return {
    archiveTask,
    autoAssignTask,
    assignTask,
    createTask
  }
}
