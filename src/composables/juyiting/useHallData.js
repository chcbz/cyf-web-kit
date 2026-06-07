import { computed, ref } from 'vue'

export const useHallData = ({
  agentApi,
  log,
  normalizeStatus,
  selectedAgent,
  selectedTask,
  taskAgentMatchScore
}) => {
  const agents = ref([])
  const tasks = ref([])
  const agentFilter = ref('all')
  const taskStatusFilter = ref('')
  const taskAbilityFilter = ref('')
  const taskKeyword = ref('')

  const filteredAgents = computed(() => {
    if (agentFilter.value === 'all') return agents.value
    if (agentFilter.value === 'busy') {
      return agents.value.filter(agent => ['busy', 'running'].includes(normalizeStatus(agent.status)))
    }
    return agents.value.filter(agent => normalizeStatus(agent.status) === agentFilter.value)
  })

  const visibleAgents = computed(() => filteredAgents.value.slice(0, 12))
  const hiddenAgentCount = computed(() => Math.max(filteredAgents.value.length - visibleAgents.value.length, 0))

  const taskAbilityOptions = computed(() => {
    const abilities = new Set()
    tasks.value.forEach(task => (task.requiredAbilities || []).forEach(ability => abilities.add(ability)))
    agents.value.forEach(agent => (agent.abilities || []).forEach(ability => abilities.add(ability)))
    return [...abilities].sort()
  })

  const recommendedAgents = computed(() => {
    if (!selectedTask.value) return []
    return agents.value
      .filter(agent => ['idle', 'online', ''].includes(normalizeStatus(agent.status || 'online')))
      .map(agent => ({ agent, score: taskAgentMatchScore(selectedTask.value, agent) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(item => item.agent)
  })

  const canAssign = (task, agent = selectedAgent.value) => {
    if (!task || !agent) return false
    if (!['open', 'pending', ''].includes(normalizeStatus(task.status))) return false
    return ['idle', 'online', ''].includes(normalizeStatus(agent.status || 'online'))
  }

  const taskStatusCount = (status) => {
    if (!status) return tasks.value.length
    return tasks.value.filter(task => normalizeStatus(task.status) === status).length
  }

  const loadAgents = async () => {
    try {
      await agentApi.get('/active', {}, {
        autoLoading: false,
        onSuccess: (result) => {
          agents.value = result?.data || []
          if (selectedAgent.value && !agents.value.some(agent => agent.agentId === selectedAgent.value.agentId)) {
            selectedAgent.value = null
          }
        }
      })
    } catch (error) {
      log.warn('加载活跃 Agent 列表失败:', error)
      agents.value = []
      selectedAgent.value = null
    }
  }

  const loadTasks = async () => {
    try {
      await agentApi.search('/tasks/search', {
        status: taskStatusFilter.value || undefined,
        ability: taskAbilityFilter.value || undefined,
        keyword: taskKeyword.value || undefined,
        pageNum: 1,
        pageSize: 30
      }, {
        autoLoading: false,
        onSuccess: (result) => {
          const list = result?.data || []
          tasks.value = list
          if (selectedTask.value && !tasks.value.some(task => task.id === selectedTask.value.id)) {
            selectedTask.value = null
          }
        }
      })
    } catch (error) {
      log.warn('加载悬赏榜失败:', error)
      tasks.value = []
      selectedTask.value = null
    }
  }

  const setTaskStatusFilter = async (status) => {
    taskStatusFilter.value = status
    await loadTasks()
  }

  return {
    agentFilter,
    agents,
    canAssign,
    filteredAgents,
    hiddenAgentCount,
    loadAgents,
    loadTasks,
    recommendedAgents,
    setTaskStatusFilter,
    taskAbilityFilter,
    taskAbilityOptions,
    taskKeyword,
    tasks,
    taskStatusCount,
    taskStatusFilter,
    visibleAgents
  }
}
