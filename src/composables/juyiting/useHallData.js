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
  const taskAgentFilter = ref('')
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
  const tasksHasMore = ref(false)
  let tasksPage = 0
  let loadedTaskQuery = ''
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

  // Roster is independent of its visible status filter; preserve encountered external /
  // historical assignees when the task page or phase changes. Never use recommendations.
  const encounteredTaskAgents = ref([])
  const taskAgentOptions = computed(() => {
    const options = new Map(encounteredTaskAgents.value.map(agent => [agent.agentId, agent]))
    allRosterAgents.value.forEach(agent => {
      if (agent?.agentId != null && String(agent.agentId) !== '') {
        const agentId = String(agent.agentId)
        options.set(agentId, { agentId, displayName: agent.name || agentId })
      }
    })
    if (taskAgentFilter.value && !options.has(taskAgentFilter.value)) {
      options.set(taskAgentFilter.value, { agentId: taskAgentFilter.value, displayName: taskAgentFilter.value })
    }
    return [...options.values()].sort((a, b) => a.displayName.localeCompare(b.displayName) || a.agentId.localeCompare(b.agentId))
  })
  const rememberTaskAgents = list => {
    const options = new Map(encounteredTaskAgents.value.map(agent => [agent.agentId, agent]))
    list.forEach(task => {
      const ids = Array.isArray(task.assignedAgentIds) ? task.assignedAgentIds : [task.assignedAgentId]
      ids.forEach(id => {
        if (id == null || String(id) === '') return
        const agentId = String(id)
        const target = task.assignedTarget?.agentId === agentId ? task.assignedTarget : null
        options.set(agentId, { agentId, displayName: target?.displayName || (ids.length === 1 && task.assignedAgentName) || options.get(agentId)?.displayName || agentId })
      })
    })
    encounteredTaskAgents.value = [...options.values()]
  }

  const recommendationPreparation = ref(null)
  let recommendationRefresh = null
  const recommendationState = computed(() => {
    if (recommendationPreparation.value?.taskId === selectedTask.value?.id &&
        recommendationPreparation.value?.identity === identityFingerprint()) return { state: 'LOADING', result: null }
    const task = selectedTask.value
    const entry = task && taskRecommendations.value[task.id]
    if (!entry) return { state: 'IDLE', result: null }
    return entry.taskKey === recommendationTaskKey(task) ? entry : { state: 'STALE', result: null }
  })
  const recommendedAgents = computed(() => ['READY', 'NO_MATCH'].includes(recommendationState.value.state)
    ? recommendationState.value.result.recommendations.map(item => ({
      agentId: item.agent.agentId, displayName: item.agent.name,
      providerDisplayName: item.agent.providerDisplayName ?? null, isMine: item.agent.boundToMe,
      availability: item.agent.status, recommendationLevel: item.recommendationLevel, recommendationReason: item.reason, recommendationEvidence: item.evidence,
      recommendationGaps: item.gaps, taskQuote: item.quote
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
    return (candidatesTaskId.value === task.id && !candidatesError.value &&
      assigneeCandidates.value.some(item => item.agentId === agent.agentId)) ||
      (['READY', 'NO_MATCH'].includes(recommendationState.value.state) && recommendationState.value.result.taskId === task.id &&
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
  const queryFingerprint = () => `${identityFingerprint()}\u0000${taskAgentFilter.value}\u0000${taskKeyword.value}`
  const stopRecommendationTask = watch(() => recommendationTaskKey(selectedTask.value), () => {
    recommendationEpoch += 1
    recommendationRequest?.controller.abort()
    recommendationRequest = null
  }, { flush: 'sync' })
  const stopFilters = watch([taskStatusFilter, taskAgentFilter, taskKeyword], () => {
    listEpoch += 1
    countsEpoch += 1
    tasksHasMore.value = false
    tasksLoading.value = false
    tasksPage = 0
    loadedTaskQuery = ''
    taskStatusCounts.value = {}
  }, { flush: 'sync' })
  const stopIdentity = watch(identityFingerprint, () => {
    listEpoch += 1
    countsEpoch += 1
    recommendationEpoch += 1
    recommendationRequest?.controller.abort()
    recommendationRequest = null
    tasks.value = []
    tasksHasMore.value = false
    tasksPage = 0
    loadedTaskQuery = ''
    taskAgentFilter.value = ''
    encounteredTaskAgents.value = []
    allRosterAgents.value = []
    taskStatusCounts.value = {}
    taskRecommendations.value = {}
    selectedTask.value = null
    tasksLoading.value = false
    taskCountsLoading.value = false
    tasksError.value = ''
    taskCountsError.value = ''
  }, { flush: 'sync' })
  const dispose = () => { recommendationRefresh = null; recommendationPreparation.value = null; listEpoch += 1; countsEpoch += 1; recommendationEpoch += 1; stopFilters(); stopIdentity(); stopRecommendationTask(); recommendationRequest?.controller.abort(); stopCandidates(); stopDetailScope(); detailEpoch++; detailController?.abort(); candidatesEpoch++; candidatesController?.abort() }
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
    let page = null
    await agentApi.search('/tasks/search', params, {
      autoLoading: false,
      onSuccess: (result) => {
        page = result
      }
    })
    if (!Array.isArray(page?.items)) throw new Error('事项列表返回格式不正确')
    return page
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
        assignedAgentId: taskAgentFilter.value || undefined,
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

  const generateTaskRecommendations = (task = selectedTask.value, { refresh = false } = {}) => {
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

  // Explicit retry refreshes the authoritative detail first; no automatic model retry.
  // Keep preparation separate from the model epoch: adopting a new task version
  // intentionally invalidates any old response via the existing synchronous watcher.
  const loadTaskRecommendations = (task = selectedTask.value, { refresh = false } = {}) => {
    const identity = identityFingerprint()
    if (recommendationRefresh?.taskId === task?.id && recommendationRefresh.identity === identity) return recommendationRefresh.promise
    if (!refresh) return generateTaskRecommendations(task)
    if (!task?.id || selectedTask.value?.id !== task.id) return Promise.resolve([])
    if (recommendationRequest?.key === `${identity}\u0000${recommendationTaskKey(task)}`) return recommendationRequest.promise
    const operation = { taskId: task.id, identity }
    recommendationPreparation.value = operation
    const promise = (async () => {
      const loaded = await loadTaskDetail(task)
      if (recommendationRefresh !== operation || identity !== identityFingerprint() || selectedTask.value?.id !== task.id) return []
      if (!loaded) {
        taskRecommendations.value = { ...taskRecommendations.value, [task.id]: {
          state: 'ERROR', result: null, taskKey: recommendationTaskKey(selectedTask.value)
        } }
        return []
      }
      return await generateTaskRecommendations(selectedTask.value, { refresh: true })
    })().finally(() => {
      if (recommendationRefresh === operation) { recommendationRefresh = null; recommendationPreparation.value = null }
    })
    operation.promise = promise
    recommendationRefresh = operation
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
    const identity = identityFingerprint()
    rosterLoading.value = true
    rosterError.value = ''
    try {
      await agentApi.search('/roster', {
        pageNum: 1,
        pageSize: 100
      }, {
        autoLoading: false,
        onSuccess: (result) => {
          if (identity === identityFingerprint()) allRosterAgents.value = result.items
        }
      })
      if (identity === identityFingerprint() && derive) deriveRosterProjections()
    } catch (error) {
      if (identity !== identityFingerprint()) return
      log.warn('load roster agents failed:', error)
      rosterError.value = error?.message || '好汉名册暂无法读取'
      allRosterAgents.value = []
      if (identity === identityFingerprint() && derive) deriveRosterProjections()
    } finally {
      if (identity === identityFingerprint()) rosterLoading.value = false
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


  const bindPersona = async () => {
    throw new Error('请先查看并确认安顿报价；两种接应方式均通过租约办理。')
  }

  const preparePersonaRemoval = async persona => {
    if (!persona?.personaCode || !persona.agentId || persona.boundToMe !== true || persona.systemAgent) return null
    const identity = identityFingerprint()
    const { agentId, personaCode } = persona
    const lookup = await agentApi.get(`/${encodeURIComponent(agentId)}/hosting-lease`, undefined, { autoLoading: false })
    if (identity !== identityFingerprint()) return null
    const lease = lookup?.lease
    if (!lookup?.managed || lease?.agentId !== agentId || lease?.personaCode !== personaCode ||
      typeof lease.leaseId !== 'string' || !lease.leaseId || !['ACTIVE', 'LOCKED', 'FINISHING'].includes(lease.status)) {
      throw new Error('暂无法核对可移除的租约，请稍后重试；不会执行旧式解绑。')
    }
    return Object.freeze({ agentId, personaCode, leaseId: lease.leaseId, identity })
  }

  const unbindPersona = async (persona, removal) => {
    if (!persona?.personaCode || persona.boundToMe !== true || persona.systemAgent ||
      !removal?.leaseId || removal.agentId !== persona.agentId || removal.personaCode !== persona.personaCode ||
      removal.identity !== identityFingerprint()) return false
    const response = await agentApi.delete(`/personas/${encodeURIComponent(persona.personaCode)}/bind`, {
      autoLoading: false,
      data: { agentId: removal.agentId, leaseId: removal.leaseId }
    })
    if (response?.agentId !== removal.agentId || response?.leaseId !== removal.leaseId || response?.status !== 'FINISHING') {
      throw new Error('移除结果尚未确认，请刷新租约后重试。')
    }
    if (removal.identity === identityFingerprint()) {
      await Promise.all([loadPersonaCatalog(), loadRosterAgents({ derive: false }), loadMapAgents()])
      deriveRosterProjections()
    }
    return true
  }

  const loadAgents = async () => {
    await Promise.all([loadMapAgents(), loadRosterAgents({ derive: false }), loadPersonaCatalog()])
    deriveRosterProjections()
  }

  const loadTasks = async (options = {}) => {
    const append = options?.append === true
    const fingerprint = `${queryFingerprint()}\u0000${taskStatusFilter.value}`
    if (append && (tasksLoading.value || !tasksHasMore.value || loadedTaskQuery !== fingerprint)) return []
    const pageNum = append ? tasksPage + 1 : 1
    if (!append) { tasksHasMore.value = false; tasksPage = 0; loadedTaskQuery = '' }
    const epoch = ++listEpoch
    const current = () => epoch === listEpoch && fingerprint === `${queryFingerprint()}\u0000${taskStatusFilter.value}`
    tasksLoading.value = true
    tasksError.value = ''
    const baseParams = {
      assignedAgentId: taskAgentFilter.value || undefined,
      keyword: taskKeyword.value || undefined,
      pageNum,
      pageSize: 30
    }
    const displayParams = {
      ...baseParams,
      phase: taskStatusFilter.value || undefined
    }
    const selectedId = selectedTask.value?.id
    const listRequest = (async () => {
      try {
        const page = await searchTasks(displayParams)
        if (!current()) return []
        const list = page.items
        const hasMore = list.length > 0 && BigInt(pageNum * baseParams.pageSize) < BigInt(page.total)
        tasks.value = append ? [...new Map([...tasks.value, ...list].map(task => [task.id, task])).values()] : list
        tasksPage = pageNum
        loadedTaskQuery = fingerprint
        tasksHasMore.value = hasMore
        rememberTaskAgents(list)
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
        else if ((!append || selected) && selectedId && selectedTask.value?.id === selectedId) {
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
        if (!append) tasks.value = []
        return []
      } finally {
        if (current()) tasksLoading.value = false
      }
    })()
    const [, counts] = await Promise.all([listRequest, append ? Promise.resolve(null) : loadTaskStatusCounts()])
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
    candidatesTaskId,
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
    loadMoreTasks: () => loadTasks({ append: true }),
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
    taskAgentFilter,
    taskAgentOptions,
    taskKeyword,
    taskCountsError,
    taskCountsLoading,
    taskRecommendations,
    tasks,
    taskStatusCount,
    taskStatusFilter,
    tasksError,
    tasksLoading,
    tasksHasMore,
    preparePersonaRemoval,
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
