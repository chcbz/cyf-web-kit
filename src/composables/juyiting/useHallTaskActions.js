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
          const task = result?.data
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
      showToast('张榜未成')
    }
  }

  const assignTask = async (task, agent = selectedAgent.value) => {
    const targetAgents = Array.isArray(agent) ? agent : [agent].filter(Boolean)
    const targetAgent = targetAgents[0]
    if (!task || !targetAgents.length) return
    if (targetAgents.some(item => !canAssign(task, item))) return
    try {
      await agentApi.create(`/tasks/${task.id}/assign`, {
        agentId: targetAgent.agentId,
        agentIds: targetAgents.map(item => item.agentId)
      }, {
        autoLoading: false,
        onSuccess: () => {
          task.status = 'assigned'
          task.assignedAgentIds = targetAgents.map(item => item.agentId)
          task.assignedAgentId = task.assignedAgentIds[0]
          task.assignedAgentName = targetAgents.map(item => item.name || item.personaName || item.agentId).join('、')
          targetAgents.forEach(item => {
            item.status = 'busy'
            item.currentTaskTitle = task.title
          })
          selectedAgent.value = targetAgent
          selectedTask.value = task
          playSuccess()
          showToast(`${task.title} 已点给 ${task.assignedAgentName}`)
        }
      })
    } catch (error) {
      log.warn('assign bounty task failed:', error)
      playError()
      showToast('点将未成，请重查厅中动静')
    }
  }

  const autoAssignTask = async (task) => {
    if (!task || task.status !== 'open') return
    try {
      await agentApi.create(`/tasks/${task.id}/auto-assign`, {}, {
        autoLoading: false,
        onSuccess: (result) => {
          const assigned = result?.data || { ...task, status: 'assigned' }
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
      showToast('宋江点将未成，请看荐单后手动点将')
    }
  }

  const archiveTask = async (task) => {
    if (!task) return
    try {
      await agentApi.create(`/tasks/${task.id}/archive`, {}, {
        autoLoading: false,
        onSuccess: (result) => {
          const archived = result?.data || { ...task, status: 'archived' }
          tasks.value = tasks.value.map(item => item.id === task.id ? archived : item)
          selectedTask.value = archived
          playSuccess()
          showToast('榜文已收入案卷')
        }
      })
    } catch (error) {
      log.warn('archive bounty task failed:', error)
      playError()
      showToast('收入案卷未成')
    }
  }

  return {
    archiveTask,
    autoAssignTask,
    assignTask,
    createTask
  }
}
