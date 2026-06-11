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
  const mapAgents = ref([])
  const tasks = ref([])
  const agentFilter = ref('all')
  const taskStatusFilter = ref('')
  const taskAbilityFilter = ref('')
  const taskKeyword = ref('')

  const filteredAgents = computed(() => agents.value)

  const visibleAgents = computed(() => mapAgents.value.slice(0, 12))
  const hiddenAgentCount = computed(() => Math.max(mapAgents.value.length - visibleAgents.value.length, 0))

  const taskAbilityOptions = computed(() => {
    const abilities = new Set()
    tasks.value.forEach(task => (task.requiredAbilities || []).forEach(ability => abilities.add(ability)))
    agents.value.forEach(agent => (agent.abilities || []).forEach(ability => abilities.add(ability)))
    return [...abilities].sort()
  })

  const recommendedAgents = computed(() => {
    if (!selectedTask.value) return []
    return agents.value
      .filter(agent => normalizeStatus(agent.status) === 'online')
      .map(agent => ({ agent, score: taskAgentMatchScore(selectedTask.value, agent) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(item => item.agent)
  })

  const canAssign = (task, agent = selectedAgent.value) => {
    if (!task || !agent) return false
    if (normalizeStatus(task.status) !== 'open') return false
    return normalizeStatus(agent.status) === 'online'
  }

  const taskStatusCount = (status) => {
    if (!status) return tasks.value.length
    return tasks.value.filter(task => normalizeStatus(task.status) === status).length
  }

  const loadMapAgents = async () => {
    try {
      await agentApi.get('/map', {}, {
        autoLoading: false,
        onSuccess: (result) => {
          mapAgents.value = result?.data || []
          if (selectedAgent.value && !mapAgents.value.some(agent => agent.agentId === selectedAgent.value.agentId)) {
            selectedAgent.value = null
          }
        }
      })
    } catch (error) {
      log.warn('load map agents failed:', error)
      mapAgents.value = []
      selectedAgent.value = null
    }
  }

  const loadRosterAgents = async () => {
    try {
      await agentApi.search('/roster', {
        status: agentFilter.value === 'all' ? undefined : agentFilter.value,
        pageNum: 1,
        pageSize: 100
      }, {
        autoLoading: false,
        onSuccess: (result) => {
          agents.value = result?.data || []
        }
      })
    } catch (error) {
      log.warn('load roster agents failed:', error)
      agents.value = []
    }
  }

  const loadAgents = async () => {
    await Promise.all([loadMapAgents(), loadRosterAgents()])
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
      log.warn('load bounty tasks failed:', error)
      tasks.value = []
      selectedTask.value = null
    }
  }

  const setAgentFilter = async (status) => {
    agentFilter.value = status
    await loadRosterAgents()
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
    loadMapAgents,
    loadRosterAgents,
    loadTasks,
    mapAgents,
    recommendedAgents,
    setAgentFilter,
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
