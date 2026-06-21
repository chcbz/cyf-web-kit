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
          showToast('悬赏已发布')
        }
      })
    } catch (error) {
      log.warn('create bounty task failed:', error)
      playError()
      showToast('发布悬赏失败')
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
          showToast(`${task.title} 已指派给 ${task.assignedAgentName}`)
        }
      })
    } catch (error) {
      log.warn('assign bounty task failed:', error)
      playError()
      showToast('指派失败，请刷新状态后重试')
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
          showToast('悬赏已归档')
        }
      })
    } catch (error) {
      log.warn('archive bounty task failed:', error)
      playError()
      showToast('归档悬赏失败')
    }
  }

  return {
    archiveTask,
    assignTask,
    createTask
  }
}
