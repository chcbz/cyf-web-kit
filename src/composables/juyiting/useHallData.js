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
  const personaCatalog = ref([])
  const tasks = ref([])
  const taskRecommendations = ref({})
  const taskStatusCounts = ref({})
  const agentFilter = ref('all')
  const taskStatusFilter = ref('')
  const taskAbilityFilter = ref('')
  const taskKeyword = ref('')

  const filteredAgents = computed(() => agents.value)

  const visibleAgents = computed(() => mapAgents.value
    .filter(agent => ['online', 'busy'].includes(normalizeStatus(agent.status)))
    .slice(0, 12))
  const hiddenAgentCount = computed(() => Math.max(mapAgents.value.length - visibleAgents.value.length, 0))

  const taskAbilityOptions = computed(() => {
    const abilities = new Set()
    tasks.value.forEach(task => (task.requiredAbilities || []).forEach(ability => abilities.add(ability)))
    agents.value.forEach(agent => (agent.abilities || []).forEach(ability => abilities.add(ability)))
    return [...abilities].sort()
  })

  const recommendedAgents = computed(() => {
    if (!selectedTask.value) return []
    const serverRecommendations = taskRecommendations.value[selectedTask.value.id] || []
    if (serverRecommendations.length) {
      return serverRecommendations
        .map(recommendation => ({
          ...(recommendation.agent || {}),
          recommendationScore: recommendation.score,
          recommendationReason: recommendation.reason,
          recommendationParts: {
            ability: recommendation.abilityScore,
            status: recommendation.statusScore,
            success: recommendation.successScore,
            load: recommendation.loadScore,
            recent: recommendation.recentScore
          },
          matchedAbilities: recommendation.matchedAbilities || [],
          capability: recommendation.capability || null
        }))
    }
    return agents.value
      .filter(agent => agent.canOperate !== false && normalizeStatus(agent.status) === 'online')
      .map(agent => ({ agent, score: taskAgentMatchScore(selectedTask.value, agent) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(item => item.agent)
  })

  const canAssign = (task, agent = selectedAgent.value) => {
    if (!task || !agent) return false
    if (normalizeStatus(task.status) !== 'open') return false
    if (agent.canOperate === false || agent.systemAgent) return false
    return normalizeStatus(agent.status) === 'online'
  }

  const taskStatusCount = (status) => {
    if (Object.keys(taskStatusCounts.value).length) {
      return Number(taskStatusCounts.value[status || 'total'] || 0)
    }
    if (!status) return tasks.value.length
    return tasks.value.filter(task => normalizeStatus(task.status) === status).length
  }

  const searchTasks = async (params) => {
    let list = []
    await agentApi.search('/tasks/search', params, {
      autoLoading: false,
      onSuccess: (result) => {
        list = result?.data || []
      }
    })
    return list
  }

  const loadTaskStatusCounts = async () => {
    let counts = {}
    await agentApi.search('/tasks/status-counts', {
      ability: taskAbilityFilter.value || undefined,
      keyword: taskKeyword.value || undefined
    }, {
      autoLoading: false,
      onSuccess: (result) => {
        counts = result?.data || {}
      }
    })
    return counts
  }

  const loadTaskRecommendations = async (task = selectedTask.value) => {
    if (!task?.id) return []
    let recommendations = []
    try {
      await agentApi.create(`/tasks/${task.id}/recommend`, {}, {
        autoLoading: false,
        onSuccess: (result) => {
          recommendations = result?.data || []
          taskRecommendations.value = {
            ...taskRecommendations.value,
            [task.id]: recommendations
          }
        }
      })
    } catch (error) {
      log.warn('load task recommendations failed:', error)
      taskRecommendations.value = {
        ...taskRecommendations.value,
        [task.id]: []
      }
    }
    return recommendations
  }

  const loadMapAgents = async () => {
    try {
      await agentApi.get('/map', {}, {
        autoLoading: false,
        onSuccess: (result) => {
          mapAgents.value = (result?.data || []).filter(agent => ['online', 'busy'].includes(normalizeStatus(agent.status)))
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

  const loadPersonaCatalog = async () => {
    try {
      await agentApi.get('/personas/catalog', {}, {
        autoLoading: false,
        onSuccess: (result) => {
          personaCatalog.value = result?.data || []
        }
      })
    } catch (error) {
      log.warn('load persona catalog failed:', error)
      personaCatalog.value = []
    }
  }

  const bindPersona = async (persona, mode = 'local') => {
    if (!persona?.personaCode || persona.systemAgent || (persona.bound && !persona.boundToMe)) return
    let bindResult = null
    await agentApi.post(`/personas/${persona.personaCode}/bind`, { mode }, {
      autoLoading: false,
      onSuccess: (result) => {
        bindResult = result?.data || null
      }
    })
    await Promise.all([loadPersonaCatalog(), loadRosterAgents(), loadMapAgents()])
    return bindResult
  }

  const unbindPersona = async (persona) => {
    if (!persona?.personaCode || !persona.boundToMe || persona.systemAgent) return
    await agentApi.delete(`/personas/${persona.personaCode}/bind`, {
      autoLoading: false
    })
    await Promise.all([loadPersonaCatalog(), loadRosterAgents(), loadMapAgents()])
  }

  const loadAgents = async () => {
    await Promise.all([loadMapAgents(), loadRosterAgents(), loadPersonaCatalog()])
  }

  const loadTasks = async () => {
    try {
      const baseParams = {
        ability: taskAbilityFilter.value || undefined,
        keyword: taskKeyword.value || undefined,
        pageNum: 1,
        pageSize: 30
      }
      const displayParams = {
        ...baseParams,
        status: taskStatusFilter.value || undefined
      }
      const [list, counts] = await Promise.all([
        searchTasks(displayParams),
        loadTaskStatusCounts()
      ])

      tasks.value = list
      taskStatusCounts.value = counts
      if (selectedTask.value && !tasks.value.some(task => task.id === selectedTask.value.id)) {
        selectedTask.value = null
      } else if (selectedTask.value) {
        await loadTaskRecommendations(selectedTask.value)
      }
    } catch (error) {
      log.warn('load bounty tasks failed:', error)
      tasks.value = []
      taskStatusCounts.value = {}
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
    bindPersona,
    canAssign,
    filteredAgents,
    hiddenAgentCount,
    loadAgents,
    loadMapAgents,
    loadPersonaCatalog,
    loadRosterAgents,
    loadTaskRecommendations,
    loadTasks,
    mapAgents,
    personaCatalog,
    recommendedAgents,
    setAgentFilter,
    setTaskStatusFilter,
    taskAbilityFilter,
    taskAbilityOptions,
    taskKeyword,
    taskRecommendations,
    tasks,
    taskStatusCount,
    taskStatusFilter,
    unbindPersona,
    visibleAgents
  }
}
