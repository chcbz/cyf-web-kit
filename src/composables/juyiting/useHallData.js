import { computed, ref } from 'vue'

import {
  canonicalSceneVersion,
  compareSceneVersions,
  publishSceneVersion
} from './sceneVersion.js'

export const useHallData = ({
  agentApi,
  log,
  normalizeStatus,
  selectedAgent,
  selectedTask,
  taskAgentMatchScore,
  sceneState
}) => {
  const agents = ref([])
  const mapAgents = ref([])
  const operableRosterAgents = ref([])
  const allRosterAgents = ref([])
  const personaCatalog = ref([])
  const tasks = ref([])
  const taskRecommendations = ref({})
  const taskStatusCounts = ref({})
  const agentFilter = ref('all')
  const taskStatusFilter = ref('open')
  const taskAbilityFilter = ref('')
  const taskKeyword = ref('')
  const backendSceneAgents = ref([])
  const backendSceneVersion = ref(0)
  let backendSceneCursor = '0'

  const filteredAgents = computed(() => agents.value)
  const isCurrentUserOperable = agent => agent?.boundToMe === true && agent?.canOperate === true && !agent?.systemAgent

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

  const canAssign = (task, agent) => {
    if (!task || typeof agent?.agentId !== 'string' || !agent.agentId.trim()) return false
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

  const reconcileSelectedAgent = () => {
    const selectedId = selectedAgent.value?.agentId
    if (!selectedId) return
    const freshOperableAgent = operableRosterAgents.value.find(agent => agent?.agentId === selectedId)
    if (freshOperableAgent) {
      selectedAgent.value = freshOperableAgent
      return
    }
    const freshMapAgent = mapAgents.value.find(agent => agent?.agentId === selectedId)
    selectedAgent.value = freshMapAgent || null
  }

  const deriveRosterProjections = () => {
    agents.value = agentFilter.value === 'all'
      ? allRosterAgents.value
      : allRosterAgents.value.filter(agent => normalizeStatus(agent?.status) === agentFilter.value)
    const catalogByPersona = new Map(personaCatalog.value
      .filter(persona => typeof persona?.personaCode === 'string' && persona.personaCode)
      .map(persona => [persona.personaCode, persona]))
    operableRosterAgents.value = allRosterAgents.value.filter(agent => {
      if (!isCurrentUserOperable(agent)) return false
      // Persona runtimes have an authoritative binding projection in the catalog. A missing
      // catalog record is not authority to retain a stale persona runtime after dismissal.
      if (agent?.personaCode) return catalogByPersona.get(agent.personaCode)?.boundToMe === true
      return true
    })
    reconcileSelectedAgent()
  }

  const loadMapAgents = async () => {
    try {
      await agentApi.get('/map', {}, {
        autoLoading: false,
        onSuccess: (result) => {
          mapAgents.value = (result?.data || []).filter(agent => ['online', 'busy'].includes(normalizeStatus(agent.status)))
        }
      })
    } catch (error) {
      log.warn('load map agents failed:', error)
      mapAgents.value = []
    }
  }

  const loadOperableRosterAgents = async () => {
    deriveRosterProjections()
  }

  const loadRosterAgents = async ({ derive = true } = {}) => {
    try {
      await agentApi.search('/roster', {
        pageNum: 1,
        pageSize: 100
      }, {
        autoLoading: false,
        onSuccess: (result) => {
          allRosterAgents.value = result?.data || []
        }
      })
      if (derive) deriveRosterProjections()
    } catch (error) {
      log.warn('load roster agents failed:', error)
      allRosterAgents.value = []
      if (derive) deriveRosterProjections()
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
    // Paid server INITIAL and free REPROVISION both require the hosting DTO flow.
    // Never retry a hosting 503 through the legacy {mode: 'server'} endpoint.
    if (mode !== 'local') throw new Error('山寨安顿必须先核对服务端租约和报价；不会改走旧式 server 接口。')
    if (!persona?.personaCode || persona.systemAgent || (persona.bound && !persona.boundToMe)) return
    let bindResult = null
    await agentApi.post(`/personas/${persona.personaCode}/bind`, { mode }, {
      autoLoading: false,
      onSuccess: (result) => {
        bindResult = result?.data || null
      }
    })
    await Promise.all([loadPersonaCatalog(), loadRosterAgents({ derive: false }), loadMapAgents()])
    deriveRosterProjections()
    return bindResult
  }

  const unbindPersona = async (persona) => {
    if (!persona?.personaCode || persona.boundToMe !== true || persona.systemAgent) return false
    await agentApi.delete(`/personas/${persona.personaCode}/bind`, {
      autoLoading: false
    })
    await Promise.all([loadPersonaCatalog(), loadRosterAgents({ derive: false }), loadMapAgents()])
    deriveRosterProjections()
    return true
  }

  const loadAgents = async () => {
    await Promise.all([loadMapAgents(), loadRosterAgents({ derive: false }), loadPersonaCatalog()])
    deriveRosterProjections()
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

  const applySceneSnapshot = (snapshot) => {
    const cursor = canonicalSceneVersion(snapshot?.sceneVersion)
    if (!snapshot || cursor == null
      || compareSceneVersions(cursor, backendSceneCursor) < 0) return false
    const result = sceneState?.applySnapshot?.(snapshot)
    if (result?.accepted === false) return false
    backendSceneCursor = cursor
    backendSceneVersion.value = publishSceneVersion(cursor)
    backendSceneAgents.value = (Array.isArray(snapshot.agents) ? snapshot.agents : [])
      .map(sceneAgentIdentity)
      .filter(Boolean)
    return true
  }

  const applySceneEvent = (event) => {
    const cursor = canonicalSceneVersion(event?.sceneVersion)
    if (!event || cursor == null
      || compareSceneVersions(cursor, backendSceneCursor) <= 0) return false
    sceneState?.applyEvent?.(event)
    backendSceneCursor = cursor
    backendSceneVersion.value = publishSceneVersion(cursor)
    return true
  }

  return {
    applySceneEvent,
    applySceneSnapshot,
    agentFilter,
    agents,
    backendSceneAgents,
    backendSceneVersion,
    bindPersona,
    canAssign,
    filteredAgents,
    hiddenAgentCount,
    loadAgents,
    loadMapAgents,
    loadOperableRosterAgents,
    loadPersonaCatalog,
    loadRosterAgents,
    loadTaskRecommendations,
    loadTasks,
    mapAgents,
    operableRosterAgents,
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

const sceneAgentIdentity = (source) => {
  if (!source?.agentId || !source?.personaCode) return null
  return {
    agentId: source.agentId,
    personaCode: source.personaCode,
    ...(source.status === undefined ? {} : { status: source.status }),
    ...(source.available === undefined ? {} : { available: Boolean(source.available) })
  }
}
