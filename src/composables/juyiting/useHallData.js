import { computed, ref, toValue, watch } from 'vue'
import { parseAssigneeRecommendation, recommendationTaskKey } from './hallAssigneeRecommendation.js'
import { assigneePage, assignedTaskTarget } from './hallAssigneeCandidates.js'
import { pointAndStartLong } from './hallPointAndStartIntent.js'
import { projectHallTask, validateHallTaskCounts } from './hallTaskPresentation.js'

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
  sceneState,
  identityScope = '',
  authorizationGeneration = 0
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
  const taskStatusFilter = ref('PENDING_ASSIGNMENT')
  const taskAbilityFilter = ref('')
  const taskKeyword = ref('')
  // Each independently fetched source owns its state so a slow optional panel
  // never blocks the map or hides a successful sibling result.
  const mapLoading = ref(false)
  const mapError = ref('')
  const rosterLoading = ref(false)
  const rosterError = ref('')
  const catalogLoading = ref(false)
  const catalogError = ref('')
  const tasksLoading = ref(false)
  const tasksError = ref('')
  const taskCountsLoading = ref(false)
  const taskCountsError = ref('')
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

  const recommendationState = computed(() => {
    const task = selectedTask.value
    const entry = task && taskRecommendations.value[task.id]
    if (!entry) return { state: 'IDLE', result: null }
    return entry.taskKey === recommendationTaskKey(task) ? entry : { state: 'STALE', result: null }
  })
  const recommendedAgents = computed(() => recommendationState.value.state === 'READY'
    ? recommendationState.value.result.recommendations.map(item => ({
      ...(selectedTask.value?.funding?.mode === 'FUNDED_SINGLE_AGENT' ? item.agent : {
        agentId: item.agent.agentId, displayName: item.agent.name,
        providerDisplayName: item.agent.providerDisplayName ?? null, isMine: item.agent.boundToMe,
        availability: item.agent.status
      }), recommendationReason: item.reason, recommendationEvidence: item.evidence,
      recommendationGaps: item.gaps
    })) : [])

  const assigneeCandidates = ref([])
  const candidatesLoading = ref(false)
  const candidatesError = ref('')
  const candidatesNextAfterAgentId = ref(null)
  const candidatesTaskId = ref(null)
  let candidatesEpoch = 0
  let candidatesController = null
  const canAssign = (task, agent) => {
    if (!task || typeof agent?.agentId !== 'string' || !agent.agentId.trim()) return false
    if (!projectHallTask({ task }).actions.includes('ASSIGN')) return false
    // External eligibility belongs only to ordinary point-and-deliberate.
    if (task.funding?.mode === 'FUNDED_SINGLE_AGENT') return agent.canOperate !== false &&
      !agent.systemAgent && normalizeStatus(agent.status) === 'online'
    return (candidatesTaskId.value === task.id && !candidatesError.value &&
      assigneeCandidates.value.some(item => item.agentId === agent.agentId)) ||
      (recommendationState.value.state === 'READY' && recommendationState.value.result.taskId === task.id &&
       recommendationState.value.result.taskVersion === task.taskVersion &&
       recommendationState.value.result.recommendations.some(item => item.agent.agentId === agent.agentId))
  }

  let detailEpoch = 0
  let detailController = null
  let listEpoch = 0
  let countsEpoch = 0
  let recommendationEpoch = 0
  let recommendationRequest = null
  const identityFingerprint = () => `${toValue(authorizationGeneration)}\u0000${toValue(identityScope)}`
  const queryFingerprint = () => `${identityFingerprint()}\u0000${taskAbilityFilter.value}\u0000${taskKeyword.value}`
  const stopRecommendationTask = watch(() => recommendationTaskKey(selectedTask.value), () => {
    recommendationEpoch += 1
    recommendationRequest?.controller.abort()
    recommendationRequest = null
  }, { flush: 'sync' })
  const stopFilters = watch([taskStatusFilter, taskAbilityFilter, taskKeyword], () => {
    listEpoch += 1
    countsEpoch += 1
    taskStatusCounts.value = {}
  }, { flush: 'sync' })
  const stopIdentity = watch(identityFingerprint, () => {
    listEpoch += 1
    countsEpoch += 1
    recommendationEpoch += 1
    recommendationRequest?.controller.abort()
    recommendationRequest = null
    tasks.value = []
    taskStatusCounts.value = {}
    taskRecommendations.value = {}
    selectedTask.value = null
    tasksLoading.value = false
    taskCountsLoading.value = false
    tasksError.value = ''
    taskCountsError.value = ''
  }, { flush: 'sync' })
  const dispose = () => { listEpoch += 1; countsEpoch += 1; recommendationEpoch += 1; stopFilters(); stopIdentity(); stopRecommendationTask(); recommendationRequest?.controller.abort(); stopCandidates(); stopDetailScope(); detailEpoch++; detailController?.abort(); candidatesEpoch++; candidatesController?.abort() }
  // Absence/failure is not zero. Preserve decimal strings; never count the loaded page.
  const taskStatusCount = phase => taskStatusCounts.value.phaseCounts?.[phase || 'total'] ?? '—'

  const stopDetailScope = watch(() => JSON.stringify([identityFingerprint(), selectedTask.value?.id]), () => {
    detailEpoch++; detailController?.abort(); detailController = null
  }, { flush: 'sync' })
  const loadTaskDetail = async (task = selectedTask.value) => {
    if (!task?.id || selectedTask.value?.id !== task.id) return false
    detailController?.abort()
    const epoch = ++detailEpoch, identity = identityFingerprint(), own = new AbortController()
    detailController = own
    const current = () => epoch === detailEpoch && identity === identityFingerprint() && selectedTask.value?.id === task.id && !own.signal.aborted
    tasksError.value = ''
    try {
      const snapshot = await agentApi.get(`/tasks/${encodeURIComponent(task.id)}`, undefined, { autoLoading: false, needAuth: true, signal: own.signal })
      if (!current()) return false
      if (snapshot?.id !== task.id || !pointAndStartLong(snapshot.taskVersion, true) ||
        (pointAndStartLong(selectedTask.value?.taskVersion, true) && BigInt(snapshot.taskVersion) < BigInt(selectedTask.value.taskVersion))) {
        throw new Error('事项详情版本尚未核对，请重查')
      }
      selectedTask.value = snapshot
      return true
    } catch (cause) {
      if (current()) tasksError.value = cause?.message || '事项详情暂不可用，请重查'
      return false
    } finally { if (current()) detailController = null }
  }

  const resetCandidates = () => {
    candidatesEpoch++; candidatesController?.abort(); candidatesController = null
    assigneeCandidates.value = []; candidatesNextAfterAgentId.value = null
    candidatesTaskId.value = null; candidatesLoading.value = false; candidatesError.value = ''
  }
  const loadAssigneeCandidates = async ({ more = false } = {}) => {
    const task = selectedTask.value
    if (!task?.id || !projectHallTask({ task }).actions.includes('ASSIGN') || task.funding?.mode === 'FUNDED_SINGLE_AGENT') return false
    if (more && (candidatesLoading.value || !candidatesNextAfterAgentId.value)) return false
    if (!more) resetCandidates()
    const epoch = ++candidatesEpoch, identity = identityFingerprint(), taskId = task.id
    const after = more ? candidatesNextAfterAgentId.value : null
    const own = new AbortController(); candidatesController = own
    const current = () => epoch === candidatesEpoch && identity === identityFingerprint() && selectedTask.value?.id === taskId && !own.signal.aborted
    candidatesLoading.value = true; candidatesError.value = ''
    try {
      const raw = await agentApi.get(`/tasks/${encodeURIComponent(taskId)}/assignee-candidates`, {
        pageSize: 50, ...(after ? { afterAgentId: after } : {})
      }, { autoLoading: false, needAuth: true, signal: own.signal })
      if (!current()) return false
      const page = assigneePage(raw, after)
      if (!page) throw new Error('承办候选返回未核对，请刷新')
      const previous = more ? assigneeCandidates.value : []
      if (page.items.some(item => previous.some(old => old.agentId === item.agentId))) throw new Error('候选分页已变化，请刷新')
      assigneeCandidates.value = [...previous, ...page.items]
      candidatesTaskId.value = taskId; candidatesNextAfterAgentId.value = page.nextAfterAgentId
      return true
    } catch (cause) {
      if (current()) candidatesError.value = cause?.message || '承办候选暂不可用，请刷新'
      return false
    } finally { if (current()) { candidatesLoading.value = false; candidatesController = null } }
  }
  // Task identity/auth/action, not roster filters or object identity, owns this GET.
  // Task version refreshes do not reset a user's selected candidate mid-operation.
  const stopCandidates = watch(() => JSON.stringify([identityFingerprint(), selectedTask.value?.id,
    projectHallTask({ task: selectedTask.value }).actions.includes('ASSIGN'), selectedTask.value?.funding?.mode]), () => {
    resetCandidates()
    void loadAssigneeCandidates()
  }, { immediate: true, flush: 'sync' })

  const searchTasks = async (params) => {
    let list = []
    await agentApi.search('/tasks/search', params, {
      autoLoading: false,
      onSuccess: (result) => {
        list = result.items
      }
    })
    if (!Array.isArray(list)) throw new Error('事项列表返回格式不正确')
    return list
  }

  const loadTaskStatusCounts = async () => {
    const epoch = ++countsEpoch
    const fingerprint = queryFingerprint()
    const current = () => epoch === countsEpoch && fingerprint === queryFingerprint()
    taskCountsLoading.value = true
    taskCountsError.value = ''
    let counts
    try {
      await agentApi.search('/tasks/status-counts', {
        ability: taskAbilityFilter.value || undefined,
        keyword: taskKeyword.value || undefined
      }, { autoLoading: false, onSuccess: result => { counts = validateHallTaskCounts(result) } })
      if (!current()) return {}
      if (!counts) throw new Error('事项计数尚未核对，请重试')
      taskStatusCounts.value = counts
      return counts
    } catch (error) {
      if (!current()) return {}
      log.warn('load task status counts failed:', error)
      taskCountsError.value = error?.message || '事项计数暂无法读取'
      taskStatusCounts.value = {}
      return {}
    } finally {
      if (current()) taskCountsLoading.value = false
    }
  }

  const loadTaskRecommendations = (task = selectedTask.value, { refresh = false } = {}) => {
    if (!task?.id || !projectHallTask(task ? { task } : {}).actions.includes('ASSIGN')) return Promise.resolve([])
    const taskKey = recommendationTaskKey(task)
    const identity = identityFingerprint()
    const key = `${identity}\u0000${taskKey}`
    if (recommendationRequest?.key === key) return recommendationRequest.promise
    const cached = taskRecommendations.value[task.id]
    if (!refresh && cached?.taskKey === taskKey && cached.state !== 'LOADING') return Promise.resolve(cached.result?.recommendations || [])
    recommendationRequest?.controller.abort()
    const controller = new AbortController()
    const epoch = ++recommendationEpoch
    const current = () => epoch === recommendationEpoch && identity === identityFingerprint() &&
      taskKey === recommendationTaskKey(selectedTask.value)
    const store = (state, result = null) => { if (current()) taskRecommendations.value = {
      ...taskRecommendations.value, [task.id]: { state, result, taskKey }
    } }
    store('LOADING')
    const promise = (async () => {
      try {
        let response
        await agentApi.create(`/tasks/${encodeURIComponent(task.id)}/recommend`, { expectedTaskVersion: task.taskVersion }, {
          autoLoading: false, signal: controller.signal, onSuccess: result => { response = result }
        })
        if (!current()) return []
        const result = parseAssigneeRecommendation(response, task)
        store(result.state, result)
        return result.recommendations
      } catch (error) {
        if (!current()) return []
        log.warn('load task recommendations failed:', error?.code || error?.name)
        store(error?.code === 'RECOMMENDATION_STALE' || error?.status === 409 ? 'STALE' : 'ERROR')
        return []
      } finally {
        if (recommendationRequest?.epoch === epoch) recommendationRequest = null
      }
    })()
    recommendationRequest = { key, epoch, controller, promise }
    return promise
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
    mapLoading.value = true
    mapError.value = ''
    try {
      await agentApi.get('/map', {}, {
        autoLoading: false,
        onSuccess: (result) => {
          mapAgents.value = result.filter(agent => ['online', 'busy'].includes(normalizeStatus(agent.status)))
        }
      })
    } catch (error) {
      log.warn('load map agents failed:', error)
      mapError.value = error?.message || '厅中点将暂无法读取'
      mapAgents.value = []
    } finally {
      mapLoading.value = false
    }
  }

  const loadOperableRosterAgents = async () => {
    deriveRosterProjections()
  }

  const loadRosterAgents = async ({ derive = true } = {}) => {
    rosterLoading.value = true
    rosterError.value = ''
    try {
      await agentApi.search('/roster', {
        pageNum: 1,
        pageSize: 100
      }, {
        autoLoading: false,
        onSuccess: (result) => {
          allRosterAgents.value = result.items
        }
      })
      if (derive) deriveRosterProjections()
    } catch (error) {
      log.warn('load roster agents failed:', error)
      rosterError.value = error?.message || '好汉名册暂无法读取'
      allRosterAgents.value = []
      if (derive) deriveRosterProjections()
    } finally {
      rosterLoading.value = false
    }
  }

  const loadPersonaCatalog = async () => {
    catalogLoading.value = true
    catalogError.value = ''
    try {
      await agentApi.get('/personas/catalog', {}, {
        autoLoading: false,
        onSuccess: (result) => {
          personaCatalog.value = result
        }
      })
      deriveRosterProjections()
    } catch (error) {
      log.warn('load persona catalog failed:', error)
      catalogError.value = error?.message || '招贤令暂无法读取'
      personaCatalog.value = []
      deriveRosterProjections()
    } finally {
      catalogLoading.value = false
    }
  }


  const bindPersona = async (persona, mode = 'local') => {
    // Paid server INITIAL and free REPROVISION both require the hosting DTO flow.
    // Never retry a hosting 503 through the legacy {mode: 'server'} endpoint.
    if (mode !== 'local') throw new Error('请先查看并确认安顿报价。')
    if (!persona?.personaCode || persona.systemAgent || (persona.bound && !persona.boundToMe)) return
    let bindResult = null
    const response = await agentApi.post(`/personas/${persona.personaCode}/bind`, { mode }, {
      autoLoading: false,
      onSuccess: (result) => {
        bindResult = result
      }
    })

    await Promise.all([loadPersonaCatalog(), loadRosterAgents({ derive: false }), loadMapAgents()])
    deriveRosterProjections()
    return bindResult
  }

  const unbindPersona = async (persona) => {
    if (!persona?.personaCode || persona.boundToMe !== true || persona.systemAgent) return false
    const response = await agentApi.delete(`/personas/${persona.personaCode}/bind`, {
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

  const loadTasks = async (options = {}) => {
    const epoch = ++listEpoch
    const fingerprint = `${queryFingerprint()}\u0000${taskStatusFilter.value}`
    const current = () => epoch === listEpoch && fingerprint === `${queryFingerprint()}\u0000${taskStatusFilter.value}`
    tasksLoading.value = true
    tasksError.value = ''
    const baseParams = {
      ability: taskAbilityFilter.value || undefined,
      keyword: taskKeyword.value || undefined,
      pageNum: 1,
      pageSize: 30
    }
    const displayParams = {
      ...baseParams,
      phase: taskStatusFilter.value || undefined
    }
    const selectedId = selectedTask.value?.id
    const listRequest = (async () => {
      try {
        const list = await searchTasks(displayParams)
        if (!current()) return []
        tasks.value = list
        // A task leaving the current page/filter is not deletion or revocation. Keep the
        // active context by ID; refresh the selected projection only when actually present.
        if (selectedTask.value?.id !== selectedId) return list
        const selected = list.find(task => task.id === selectedId)
        const version = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) ? BigInt(value) : null
        const before = version(selectedTask.value?.taskVersion)
        const after = version(selected?.taskVersion)
        const minimum = options?.refreshTaskId === selectedId ? version(options.minimumTaskVersion) : null
        const needsAssignedDetail = selected?.funding?.mode !== 'FUNDED_SINGLE_AGENT' &&
          (selected?.assignedAgentId || selected?.assignedAgentIds?.length === 1) && !assignedTaskTarget(selected)
        if (selected && !needsAssignedDetail && (before === null || (after !== null && after >= before)) && (minimum === null || (after !== null && after >= minimum))) selectedTask.value = selected
        else if (selectedId && selectedTask.value?.id === selectedId) {
          // Acceptance can move the active matter out of this filter/page. Read
          // that exact ID once; a missing list row is not a current detail snapshot.
          try {
            const snapshot = await agentApi.get(`/tasks/${encodeURIComponent(selectedId)}`, undefined, { autoLoading: false, needAuth: true })
            if (!current() || selectedTask.value?.id !== selectedId) return list
            const nextVersion = version(snapshot?.taskVersion)
            const currentVersion = version(selectedTask.value?.taskVersion)
            if (snapshot?.id !== selectedId || nextVersion === null ||
              (currentVersion !== null && nextVersion < currentVersion) || (minimum !== null && nextVersion < minimum)) {
              throw new Error('事项详情版本尚未核对，请重查。')
            }
            selectedTask.value = snapshot
          } catch (error) {
            if (current() && selectedTask.value?.id === selectedId) tasksError.value = error?.message || '事项详情暂无法核对，请重查。'
          }
        }
        return list
      } catch (error) {
        if (!current()) return []
        log.warn('load bounty tasks failed:', error)
        tasksError.value = error?.message || '悬赏榜暂无法读取'
        tasks.value = []
        return []
      } finally {
        if (current()) tasksLoading.value = false
      }
    })()
    const [, counts] = await Promise.all([listRequest, loadTaskStatusCounts()])
    return counts
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
    dispose,
    applySceneEvent,
    applySceneSnapshot,
    agentFilter,
    agents,
    backendSceneAgents,
    backendSceneVersion,
    bindPersona,
    canAssign,
    assigneeCandidates,
    candidatesLoading,
    candidatesError,
    candidatesNextAfterAgentId,
    loadAssigneeCandidates,
    catalogError,
    catalogLoading,
    filteredAgents,
    hiddenAgentCount,
    loadAgents,
    loadMapAgents,
    loadOperableRosterAgents,
    loadPersonaCatalog,
    loadRosterAgents,
    loadTaskDetail,
    loadTaskRecommendations,
    loadTasks,
    mapAgents,
    mapError,
    mapLoading,
    operableRosterAgents,
    personaCatalog,
    recommendedAgents,
    recommendationState,
    rosterError,
    rosterLoading,
    setAgentFilter,
    setTaskStatusFilter,
    taskAbilityFilter,
    taskAbilityOptions,
    taskKeyword,
    taskCountsError,
    taskCountsLoading,
    taskRecommendations,
    tasks,
    taskStatusCount,
    taskStatusFilter,
    tasksError,
    tasksLoading,
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
