import { expect } from 'chai'
import { ref } from 'vue'

import { projectHallTask } from '../src/composables/juyiting/hallTaskPresentation.js'

import { useHallData } from '../src/composables/juyiting/useHallData.js'

describe('useHallData bounty status counts', () => {
  it('keeps status counts based on the full task set after switching filters', async () => {
    const allTasks = [
      { id: 'task-open', status: 'open', requiredAbilities: ['plan'] },
      { id: 'task-assigned', status: 'assigned', requiredAbilities: ['plan'] },
      { id: 'task-running', status: 'running', requiredAbilities: ['execute'] },
      { id: 'task-completed', status: 'completed', requiredAbilities: ['review'] }
    ]
    const calls = []
    const rawStatusCounts = { total: String(allTasks.length) }
    const phaseCounts = { PENDING_ASSIGNMENT: '0', IN_PROGRESS: '0', PENDING_ACCEPTANCE: '0', COMPLETED: '0', HISTORY: '0', UNKNOWN: '0', total: String(allTasks.length) }
    allTasks.forEach(task => {
      rawStatusCounts[task.status] = String(BigInt(rawStatusCounts[task.status] || '0') + 1n)
      const phase = projectHallTask({ task }).phase
      phaseCounts[phase] = String(BigInt(phaseCounts[phase]) + 1n)
    })
    const agentApi = {
      search: async (url, params, options) => {
        calls.push({ url, params })
        if (url === '/tasks/status-counts') {
          options.onSuccess({ phaseCounts, rawStatusCounts })
          return
        }
        const data = params.phase
          ? allTasks.filter(task => projectHallTask({ task }).phase === params.phase)
          : allTasks
        options.onSuccess({ items: data, pageNum: 1, pageSize: 100, total: "0" })
      },
      get: async () => {}
    }

    const hallData = useHallData({
      agentApi,
      log: { warn: () => {} },
      normalizeStatus: (status = '') => status.toLowerCase(),
      selectedAgent: ref(null),
      selectedTask: ref(null),
      taskAgentMatchScore: () => 0
    })

    await hallData.loadTasks()

    expect(hallData.taskStatusCount('IN_PROGRESS')).to.equal('2')
    expect(hallData.taskStatusCount('PENDING_ASSIGNMENT')).to.equal('1')
    expect(hallData.taskStatusCount('COMPLETED')).to.equal('1')

    await hallData.setTaskStatusFilter('IN_PROGRESS')

    expect(hallData.tasks.value.map(task => task.id)).to.deep.equal(['task-assigned', 'task-running'])
    expect(hallData.taskStatusCount('IN_PROGRESS')).to.equal('2')
    expect(hallData.taskStatusCount('PENDING_ASSIGNMENT')).to.equal('1')
    expect(hallData.taskStatusCount('COMPLETED')).to.equal('1')
    expect(calls.map(call => call.url)).to.deep.equal([
      '/tasks/search',
      '/tasks/status-counts',
      '/tasks/search',
      '/tasks/status-counts'
    ])
    expect(calls[2].params).to.include({ phase: 'IN_PROGRESS' })
  })
})

describe('useHallData operable roster', () => {
  it('loads an unfiltered current-user operable roster separately from map and visible roster state', async () => {
    const calls = []
    const roster = [
      { agentId: 'huyanzhuo', boundToMe: true, canOperate: true, status: 'offline' },
      { agentId: 'linchong', boundToMe: true, canOperate: false, status: 'online' },
      { agentId: 'wuyong', boundToMe: false, canOperate: true, status: 'online' },
      { agentId: 'missing-contract', boundToMe: true, status: 'online' },
      { agentId: 'songjiang', boundToMe: true, canOperate: true, systemAgent: true, status: 'online' },
      { agentId: 'stale-persona-agent', personaCode: 'stale-persona', boundToMe: true, canOperate: true, status: 'offline' },
      { agentId: 'personal-runtime', boundToMe: true, canOperate: true, status: 'offline' }
    ]
    const agentApi = {
      search: async (url, params, options) => {
        calls.push({ url, params })
        options.onSuccess({ items: roster, pageNum: 1, pageSize: 100, total: "0" })
      },
      get: async (url, _params, options) => options.onSuccess((url === '/personas/catalog' ? [
        { personaCode: 'huyanzhuo', boundToMe: true },
        { personaCode: 'stale-persona', boundToMe: false }
      ] : []))
    }
    const hallData = useHallData({
      agentApi,
      log: { warn: () => {} },
      normalizeStatus: (status = '') => status.toLowerCase(),
      selectedAgent: ref(null),
      selectedTask: ref(null),
      taskAgentMatchScore: () => 0
    })

    await hallData.loadAgents()

    expect(hallData.operableRosterAgents.value.map(agent => agent.agentId)).to.deep.equal(['huyanzhuo', 'personal-runtime'])
    expect(calls.filter(call => call.url === '/roster')).to.have.length(1)
    expect(calls.find(call => call.params.status === undefined && call.params.pageSize === 100)).to.exist
  })

  it('keeps an explicitly operable offline roster selection when the shared map refresh omits it', async () => {
    const selectedAgent = ref({ agentId: 'huyanzhuo', boundToMe: true, canOperate: true, status: 'offline' })
    const agentApi = {
      get: async (url, _params, options) => options.onSuccess((url === '/personas/catalog' ? [] : [])),
      search: async (_url, _params, options) => options.onSuccess({ items: [selectedAgent.value], pageNum: 1, pageSize: 100, total: "0" })
    }
    const hallData = useHallData({
      agentApi,
      log: { warn: () => {} },
      normalizeStatus: (status = '') => status.toLowerCase(),
      selectedAgent,
      selectedTask: ref(null),
      taskAgentMatchScore: () => 0
    })

    await hallData.loadAgents()

    expect(hallData.mapAgents.value).to.deep.equal([])
    expect(hallData.operableRosterAgents.value.map(agent => agent.agentId)).to.deep.equal(['huyanzhuo'])
    expect(selectedAgent.value?.agentId).to.equal('huyanzhuo')
  })

  it('denies persona runtimes absent from catalog, preserves non-persona runtimes, and refreshes filtered and operable projections together', async () => {
    const first = [
      { agentId: 'huyanzhuo-old', personaCode: 'huyanzhuo', boundToMe: true, canOperate: true, status: 'offline' },
      { agentId: 'runtime-only', boundToMe: true, canOperate: true, status: 'offline' }
    ]
    const refreshed = [
      { agentId: 'huyanzhuo-old', personaCode: 'huyanzhuo', boundToMe: true, canOperate: true, status: 'online', fresh: true },
      { agentId: 'runtime-only', boundToMe: true, canOperate: true, status: 'offline' }
    ]
    const selectedAgent = ref(first[0])
    let rosterReads = 0
    const agentApi = {
      get: async (url, _params, options) => options.onSuccess((url === '/personas/catalog' ? [{ personaCode: 'huyanzhuo', boundToMe: true }] : [])),
      search: async (url, _params, options) => {
        if (url !== '/roster') throw new Error(`unexpected ${url}`)
        rosterReads += 1
        options.onSuccess({ items: rosterReads === 1 ? first : refreshed, pageNum: 1, pageSize: 100, total: "0" })
      }
    }
    const hallData = useHallData({ agentApi, log: { warn: () => {} }, normalizeStatus: (status = '') => status.toLowerCase(), selectedAgent, selectedTask: ref(null), taskAgentMatchScore: () => 0 })

    await hallData.loadAgents()
    expect(hallData.operableRosterAgents.value.map(agent => agent.agentId)).to.deep.equal(['huyanzhuo-old', 'runtime-only'])
    expect(selectedAgent.value).to.equal(hallData.operableRosterAgents.value[0])
    await hallData.setAgentFilter('online')
    expect(hallData.agents.value.map(agent => agent.agentId)).to.deep.equal(['huyanzhuo-old'])
    expect(hallData.operableRosterAgents.value.map(agent => agent.agentId)).to.deep.equal(['huyanzhuo-old', 'runtime-only'])
    expect(selectedAgent.value?.fresh).to.equal(true)
    expect(rosterReads).to.equal(2)

    const omittedCatalogData = useHallData({
      agentApi: { get: async (_url, _params, options) => options.onSuccess(([])), search: async (_url, _params, options) => options.onSuccess({ items: first, pageNum: 1, pageSize: 100, total: "0" }) },
      log: { warn: () => {} }, normalizeStatus: (status = '') => status.toLowerCase(), selectedAgent: ref(null), selectedTask: ref(null), taskAgentMatchScore: () => 0
    })
    await omittedCatalogData.loadAgents()
    expect(omittedCatalogData.operableRosterAgents.value.map(agent => agent.agentId)).to.deep.equal(['runtime-only'])
  })

  it('replaces a formerly operable selection with its fresh map object when a refresh revokes operation', async () => {
    const oldSelection = { agentId: 'huyanzhuo', boundToMe: true, canOperate: true, status: 'online', staleFlag: true }
    const freshMapAgent = { agentId: 'huyanzhuo', boundToMe: true, canOperate: false, status: 'busy' }
    const selectedAgent = ref(oldSelection)
    const agentApi = {
      get: async (url, _params, options) => options.onSuccess((url === '/personas/catalog' ? [] : [freshMapAgent])),
      search: async (_url, _params, options) => options.onSuccess({ items: [{ ...freshMapAgent }], pageNum: 1, pageSize: 100, total: "0" })
    }
    const hallData = useHallData({
      agentApi,
      log: { warn: () => {} },
      normalizeStatus: (status = '') => status.toLowerCase(),
      selectedAgent,
      selectedTask: ref(null),
      taskAgentMatchScore: () => 0
    })

    await hallData.loadAgents()

    expect(hallData.operableRosterAgents.value).to.deep.equal([])
    expect(selectedAgent.value).to.equal(hallData.mapAgents.value[0])
    expect(selectedAgent.value).to.not.have.property('staleFlag')
    expect(selectedAgent.value).to.include({ agentId: 'huyanzhuo', canOperate: false, status: 'busy' })
  })

  it('surfaces an application-level unbind rejection instead of showing a success toast path', async () => {
    const calls = []
    const agentApi = {
      delete: async (url) => {
        calls.push(url)
        throw Object.assign(new Error('Agent cannot be unbound while it has durable active work'), { status: 409, code: 'AGENT_BUSY' })
      },
      get: async () => { throw new Error('refresh must not run after rejected DELETE') },
      search: async () => { throw new Error('refresh must not run after rejected DELETE') }
    }
    const hallData = useHallData({
      agentApi,
      log: { warn: () => {} },
      normalizeStatus: (status = '') => status.toLowerCase(),
      selectedAgent: ref(null),
      selectedTask: ref(null),
      taskAgentMatchScore: () => 0
    })

    let failure
    try {
      await hallData.unbindPersona({ personaCode: 'huyanzhuo', boundToMe: true })
    } catch (error) {
      failure = error
    }
    expect(failure?.message).to.equal('Agent cannot be unbound while it has durable active work')
    expect(failure?.code).to.equal('AGENT_BUSY')
    expect(failure?.status).to.equal(409)
    expect(calls).to.deep.equal(['/personas/huyanzhuo/bind'])
  })

  it('does not refresh after the HTTP boundary rejects an application error', async () => {
    const agentApi = {
      delete: async () => { throw Object.assign(new Error('still busy'), { status: 409, code: 'AGENT_BUSY' }) },
      get: async () => { throw new Error('refresh must not run after rejected DELETE') },
      search: async () => { throw new Error('refresh must not run after rejected DELETE') }
    }
    const hallData = useHallData({
      agentApi,
      log: { warn: () => {} },
      normalizeStatus: (status = '') => status.toLowerCase(),
      selectedAgent: ref(null),
      selectedTask: ref(null),
      taskAgentMatchScore: () => 0
    })

    let failure
    try {
      await hallData.unbindPersona({ personaCode: 'huyanzhuo', boundToMe: true })
    } catch (error) {
      failure = error
    }
    expect(failure?.code).to.equal('AGENT_BUSY')
    expect(failure?.status).to.equal(409)
  })

  it('reports an unbind no-op truthfully and refreshes every roster projection after DELETE', async () => {
    const calls = []
    const agentApi = {
      delete: async (url, options) => calls.push({ options, url }),
      get: async (_url, _params, options) => options.onSuccess(([])),
      search: async (url, _params, options) => {
        calls.push({ url })
        options.onSuccess({ items: [], pageNum: 1, pageSize: 100, total: "0" })
      }
    }
    const hallData = useHallData({
      agentApi,
      log: { warn: () => {} },
      normalizeStatus: (status = '') => status.toLowerCase(),
      selectedAgent: ref(null),
      selectedTask: ref(null),
      taskAgentMatchScore: () => 0
    })

    expect(await hallData.unbindPersona({ personaCode: 'huyanzhuo', boundToMe: false })).to.equal(false)
    expect(calls).to.deep.equal([])
    expect(await hallData.unbindPersona({ personaCode: 'huyanzhuo', boundToMe: true })).to.equal(true)
    expect(calls[0].url).to.equal('/personas/huyanzhuo/bind')
    expect(calls.filter(call => call.url === '/roster')).to.have.length(1)
  })
})

describe('useHallData deferred Juyi Hall sources', () => {
  it('loads map independently before optional roster, catalog, tasks, and counts', async () => {
    const calls = []
    const hallData = useHallData({
      agentApi: {
        get: async (url, _params, options) => {
          calls.push(url)
          if (url !== '/map') throw new Error(`unexpected get ${url}`)
          options.onSuccess(([{ agentId: 'map-agent', status: 'online' }]))
        },
        search: async url => {
          calls.push(url)
          throw new Error(`unexpected search ${url}`)
        }
      },
      log: { warn: () => {} },
      normalizeStatus: (status = '') => status.toLowerCase(),
      selectedAgent: ref(null),
      selectedTask: ref(null),
      taskAgentMatchScore: () => 0
    })

    await hallData.loadMapAgents()

    expect(calls).to.deep.equal(['/map'])
    expect(hallData.mapAgents.value.map(agent => agent.agentId)).to.deep.equal(['map-agent'])
    expect(hallData.mapLoading.value).to.equal(false)
    expect(hallData.mapError.value).to.equal('')
    expect(hallData.rosterLoading.value).to.equal(false)
    expect(hallData.catalogLoading.value).to.equal(false)
    expect(hallData.tasksLoading.value).to.equal(false)
    expect(hallData.taskCountsLoading.value).to.equal(false)
  })

  it('keeps a successful task list when independent status-count loading fails', async () => {
    const hallData = useHallData({
      agentApi: {
        search: async (url, _params, options) => {
          if (url === '/tasks/search') {
            options.onSuccess({ items: [{ id: 'task-1', status: 'open' }], pageNum: 1, pageSize: 100, total: "0" })
            return
          }
          if (url === '/tasks/status-counts') throw new Error('counts offline')
          throw new Error(`unexpected search ${url}`)
        }
      },
      log: { warn: () => {} },
      normalizeStatus: (status = '') => status.toLowerCase(),
      selectedAgent: ref(null),
      selectedTask: ref(null),
      taskAgentMatchScore: () => 0
    })

    await hallData.loadTasks()

    expect(hallData.tasks.value.map(task => task.id)).to.deep.equal(['task-1'])
    expect(hallData.tasksError.value).to.equal('')
    expect(hallData.taskCountsError.value).to.equal('counts offline')
    expect(hallData.tasksLoading.value).to.equal(false)
    expect(hallData.taskCountsLoading.value).to.equal(false)
    expect(hallData.taskStatusCount('PENDING_ASSIGNMENT')).to.equal('—')
  })

  it('records a failed roster independently without clearing the map source state', async () => {
    const hallData = useHallData({
      agentApi: {
        get: async (url, _params, options) => {
          if (url !== '/map') throw new Error(`unexpected get ${url}`)
          options.onSuccess(([{ agentId: 'map-agent', status: 'online' }]))
        },
        search: async () => { throw new Error('roster offline') }
      },
      log: { warn: () => {} },
      normalizeStatus: (status = '') => status.toLowerCase(),
      selectedAgent: ref(null),
      selectedTask: ref(null),
      taskAgentMatchScore: () => 0
    })

    await hallData.loadMapAgents()
    await hallData.loadRosterAgents()

    expect(hallData.mapAgents.value.map(agent => agent.agentId)).to.deep.equal(['map-agent'])
    expect(hallData.mapError.value).to.equal('')
    expect(hallData.rosterError.value).to.equal('roster offline')
    expect(hallData.rosterLoading.value).to.equal(false)
  })
})

describe('useHallData advisory recommendations', () => {
  it('preserves recommendation diagnostics but uses candidate eligibility even for low-score recommendations without management DTO leakage', async () => {
    const selectedTask = ref({ id: 'task-e01', status: 'open', requiredAbilities: ['planning'] })
    const hallData = useHallData({
      agentApi: {
        get: async () => ({ items: ['agent-excluded', 'agent-legacy'].map(agentId => ({ agentId, displayName: agentId, providerDisplayName: null, isMine: false, availability: 'offline' })), nextAfterAgentId: null }),
        create: async (_url, _body, options) => options.onSuccess(([{
          score: 74,
          eligible: false,
          exclusionReasons: ['AGENT_ABILITY_MISMATCH'],
          scoreParts: { ability: 0, availability: 20, success: 11, load: 15, context: 8, riskPenalty: 0 },
          reason: '宋江首领不建议：AGENT_ABILITY_MISMATCH。',
          matchedAbilities: [],
          agent: { agentId: 'agent-excluded', status: 'online', canOperate: true }
        }, {
          score: 94,
          agent: { agentId: 'agent-legacy', status: 'online', canOperate: true }
        }]))
      },
      log: { warn: () => {} },
      normalizeStatus: (status = '') => status.toLowerCase(),
      selectedAgent: ref(null),
      selectedTask,
      taskAgentMatchScore: () => 0
    })

    await hallData.loadAssigneeCandidates()
    await hallData.loadTaskRecommendations()

    const [excluded, legacy] = hallData.recommendedAgents.value
    expect(excluded).to.include({
      agentId: 'agent-excluded',
      eligible: false,
      recommendationScore: 74,
      recommendationReason: '宋江首领不建议：AGENT_ABILITY_MISMATCH。'
    })
    expect(excluded.exclusionReasons).to.deep.equal(['AGENT_ABILITY_MISMATCH'])
    expect(excluded.scoreParts).to.deep.equal({
      ability: 0, availability: 20, success: 11, load: 15, context: 8, riskPenalty: 0
    })
    expect(hallData.canAssign(selectedTask.value, excluded)).to.equal(true)
    expect(legacy.eligible).to.equal(undefined)
    expect(hallData.canAssign(selectedTask.value, legacy)).to.equal(true)
    expect(legacy).not.to.have.property('canOperate')
  })
})

describe('useHallData bounty title reload', () => {
  it('keeps the persisted bounty title returned by task search after a refresh', async () => {
    const persistedTask = {
      id: '42',
      title: '夜探祝家庄榜文',
      description: '先探路，再回厅前公议',
      status: 'open',
      requiredAbilities: ['planning']
    }
    const agentApi = {
      search: async (url, _params, options) => {
        options.onSuccess({ items: url === '/tasks/search' ? [persistedTask] : { total: 1, open: 1 }, pageNum: 1, pageSize: 100, total: "0" })
      },
      get: async () => {}
    }
    const hallData = useHallData({
      agentApi,
      log: { warn: () => {} },
      normalizeStatus: (status = '') => status.toLowerCase(),
      selectedAgent: ref(null),
      selectedTask: ref(null),
      taskAgentMatchScore: () => 0
    })

    await hallData.loadTasks()
    await hallData.loadTasks()

    expect(hallData.tasks.value).to.deep.equal([persistedTask])
    expect(hallData.tasks.value[0].title).to.equal('夜探祝家庄榜文')
  })
})

describe('Hall roster request wire types', () => {
  it('sends bounded page integers, not int64 decimal strings', async () => {
    const calls = []
    const hall = useHallData({
      agentApi: { search: async (url, data, options) => {
        calls.push({ url, data })
        options.onSuccess({ items: [], pageNum: 1, pageSize: 100, total: '0' })
      } },
      log: { warn: () => {} }, selectedAgent: ref(null), selectedTask: ref(null),
      normalizeStatus: value => value, taskAgentMatchScore: () => 0
    })
    await hall.loadRosterAgents({ derive: false })
    expect(calls).to.deep.equal([{ url: '/roster', data: { pageNum: 1, pageSize: 100 } }])
  })
})


describe('Hall assignment uses the same authoritative projection as the task view', () => {
  it('never assigns a raw-open task with UNKNOWN or contradictory server phase', async () => {
    const selectedTask = ref({ id: 'a', status: 'open', phase: 'PENDING_ASSIGNMENT' })
    const hall = useHallData({ agentApi: { get: async () => ({ items: [{ agentId: 'wuyong', displayName: '吴用', providerDisplayName: null, isMine: true, availability: 'offline' }], nextAfterAgentId: null }) }, log: { warn: () => {} },
      selectedAgent: ref(null), selectedTask, normalizeStatus: value => value,
      taskAgentMatchScore: () => 0 })
    await hall.loadAssigneeCandidates()
    const agent = { agentId: 'wuyong', status: 'online', canOperate: true }
    try {
      for (const phase of ['UNKNOWN', 'IN_PROGRESS', 'PENDING_ACCEPTANCE', 'unsupported']) {
        expect(hall.canAssign({ id: 'a', status: 'open', phase }, agent), phase).to.equal(false)
      }
      expect(hall.canAssign({ id: 'a', status: 'open', phase: 'PENDING_ASSIGNMENT' }, agent)).to.equal(true)
    } finally { hall.dispose() }
  })
})

describe('selected matter leaving the filtered page after acceptance', () => {
  const counts = { PENDING_ASSIGNMENT: '0', IN_PROGRESS: '0', PENDING_ACCEPTANCE: '0', COMPLETED: '1', HISTORY: '0', UNKNOWN: '0', total: '1' }
  const fixture = get => {
    const selectedTask = ref({ id: 'accepted-task', status: 'reviewing', taskVersion: '3' })
    const identity = ref('owner-a')
    const calls = []
    const hall = useHallData({ selectedTask, selectedAgent: ref(null), identityScope: identity,
      agentApi: { get: async (...args) => { calls.push(args); return get(...args) }, search: async (path, _params, options) => {
        options.onSuccess(path === '/tasks/status-counts' ? { phaseCounts: counts, rawStatusCounts: { completed: '1', total: '1' } } : { items: [], pageNum: 1, pageSize: 30, total: '0' })
      } }, log: { warn: () => {} }, normalizeStatus: value => value, taskAgentMatchScore: () => 0 })
    return { hall, selectedTask, identity, calls }
  }
  it('refreshes the original selected ID once although the completed task is outside the current filter', async () => {
    const f = fixture(async () => ({ id: 'accepted-task', status: 'completed', taskVersion: '4' }))
    try {
      await f.hall.loadTasks({ refreshTaskId: 'accepted-task', minimumTaskVersion: '4' })
      expect(f.selectedTask.value.status).to.equal('completed')
      expect(f.hall.tasks.value).to.deep.equal([])
      expect(f.calls.map(call => call[0])).to.deep.equal(['/tasks/accepted-task'])
      expect(f.hall.tasksError.value).to.equal('')
    } finally { f.hall.dispose() }
  })
  it('does not replace a different selected matter with a late exact read', async () => {
    let finish
    const f = fixture(path => path.endsWith('/assignee-candidates') ? Promise.resolve({ items: [], nextAfterAgentId: null }) : new Promise(resolve => { finish = resolve }))
    try {
      const pending = f.hall.loadTasks()
      while (!finish) await Promise.resolve()
      f.selectedTask.value = { id: 'other', status: 'open', taskVersion: '1' }
      finish({ id: 'accepted-task', status: 'completed', taskVersion: '4' }); await pending
      expect(f.selectedTask.value.id).to.equal('other')
    } finally { f.hall.dispose() }
  })
  it('rejects a stale root version and preserves the original matter with a visible read error', async () => {
    const f = fixture(async () => ({ id: 'accepted-task', status: 'reviewing', taskVersion: '3' }))
    try {
      await f.hall.loadTasks({ refreshTaskId: 'accepted-task', minimumTaskVersion: '4' })
      expect(f.selectedTask.value.taskVersion).to.equal('3')
      expect(f.hall.tasksError.value).to.include('版本尚未核对')
    } finally { f.hall.dispose() }
  })
  it('ignores an old-account read after identity changes', async () => {
    let finish
    const f = fixture(path => path.endsWith('/assignee-candidates') ? Promise.resolve({ items: [], nextAfterAgentId: null }) : new Promise(resolve => { finish = resolve }))
    try {
      const pending = f.hall.loadTasks()
      while (!finish) await Promise.resolve()
      f.identity.value = 'owner-b'; await Promise.resolve()
      finish({ id: 'accepted-task', status: 'completed', taskVersion: '4' }); await pending
      expect(f.selectedTask.value?.id).not.to.equal('accepted-task')
    } finally { f.hall.dispose() }
  })
})


describe('D3.1 assigned list rows versus authoritative detail', () => {
  it('does not replace assignedTarget with a thin search row on refresh', async () => {
    const row = { id: 'task', status: 'assigned', taskVersion: '2', assignedAgentId: 'external' }
    const assignedTarget = { agentId: 'external', displayName: '承办', providerDisplayName: null, isMine: false, availability: 'offline' }
    const selectedTask = ref({ ...row, assignedTarget })
    const reads = []
    const hall = useHallData({ selectedTask, selectedAgent: ref(null), log: { warn() {} }, normalizeStatus: value => value,
      agentApi: {
        get: async path => { reads.push(path); return { ...row, assignedTarget } },
        search: async (path, _params, options) => options.onSuccess(path.endsWith('/status-counts') ? null : { items: [row] })
      } })
    try {
      await hall.loadTasks()
      expect(reads).to.deep.equal(['/tasks/task'])
      expect(selectedTask.value.assignedTarget).to.deep.equal(assignedTarget)
    } finally { hall.dispose() }
  })
})
