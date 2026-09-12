import { expect } from 'chai'
import { ref } from 'vue'

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
    const countByStatus = allTasks.reduce((acc, task) => {
      acc[task.status] = (acc[task.status] || 0) + 1
      return acc
    }, {})
    const agentApi = {
      search: async (url, params, options) => {
        calls.push({ url, params })
        if (url === '/tasks/status-counts') {
          options.onSuccess({ data: countByStatus })
          return
        }
        const data = params.status
          ? allTasks.filter(task => task.status === params.status)
          : allTasks
        options.onSuccess({ data })
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

    expect(hallData.taskStatusCount('assigned')).to.equal(1)
    expect(hallData.taskStatusCount('running')).to.equal(1)
    expect(hallData.taskStatusCount('completed')).to.equal(1)

    await hallData.setTaskStatusFilter('assigned')

    expect(hallData.tasks.value.map(task => task.id)).to.deep.equal(['task-assigned'])
    expect(hallData.taskStatusCount('assigned')).to.equal(1)
    expect(hallData.taskStatusCount('running')).to.equal(1)
    expect(hallData.taskStatusCount('completed')).to.equal(1)
    expect(calls.map(call => call.url)).to.deep.equal([
      '/tasks/search',
      '/tasks/status-counts',
      '/tasks/search',
      '/tasks/status-counts'
    ])
    expect(calls[2].params).to.include({ status: 'assigned' })
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
        options.onSuccess({ data: roster })
      },
      get: async (url, _params, options) => options.onSuccess({ data: url === '/personas/catalog' ? [
        { personaCode: 'huyanzhuo', boundToMe: true },
        { personaCode: 'stale-persona', boundToMe: false }
      ] : [] })
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
      get: async (url, _params, options) => options.onSuccess({ data: url === '/personas/catalog' ? [] : [] }),
      search: async (_url, _params, options) => options.onSuccess({ data: [selectedAgent.value] })
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
      get: async (url, _params, options) => options.onSuccess({ data: url === '/personas/catalog' ? [{ personaCode: 'huyanzhuo', boundToMe: true }] : [] }),
      search: async (url, _params, options) => {
        if (url !== '/roster') throw new Error(`unexpected ${url}`)
        rosterReads += 1
        options.onSuccess({ data: rosterReads === 1 ? first : refreshed })
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
      agentApi: { get: async (_url, _params, options) => options.onSuccess({ data: [] }), search: async (_url, _params, options) => options.onSuccess({ data: first }) },
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
      get: async (url, _params, options) => options.onSuccess({ data: url === '/personas/catalog' ? [] : [freshMapAgent] }),
      search: async (_url, _params, options) => options.onSuccess({ data: [{ ...freshMapAgent }] })
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

  it('reports an unbind no-op truthfully and refreshes every roster projection after DELETE', async () => {
    const calls = []
    const agentApi = {
      delete: async (url, options) => calls.push({ options, url }),
      get: async (_url, _params, options) => options.onSuccess({ data: [] }),
      search: async (url, _params, options) => {
        calls.push({ url })
        options.onSuccess({ data: [] })
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
          options.onSuccess({ data: [{ agentId: 'map-agent', status: 'online' }] })
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
            options.onSuccess({ data: [{ id: 'task-1', status: 'open' }] })
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
    expect(hallData.taskStatusCount('open')).to.equal(1)
  })

  it('records a failed roster independently without clearing the map source state', async () => {
    const hallData = useHallData({
      agentApi: {
        get: async (url, _params, options) => {
          if (url !== '/map') throw new Error(`unexpected get ${url}`)
          options.onSuccess({ data: [{ agentId: 'map-agent', status: 'online' }] })
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

describe('useHallData E01 candidate compatibility', () => {
  it('preserves authoritative candidate details, denies explicitly excluded candidates, and accepts legacy recommendations', async () => {
    const selectedTask = ref({ id: 'task-e01', status: 'open', requiredAbilities: ['planning'] })
    const hallData = useHallData({
      agentApi: {
        create: async (_url, _body, options) => options.onSuccess({ data: [{
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
        }] })
      },
      log: { warn: () => {} },
      normalizeStatus: (status = '') => status.toLowerCase(),
      selectedAgent: ref(null),
      selectedTask,
      taskAgentMatchScore: () => 0
    })

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
    expect(hallData.canAssign(selectedTask.value, excluded)).to.equal(false)
    expect(legacy.eligible).to.equal(undefined)
    expect(hallData.canAssign(selectedTask.value, legacy)).to.equal(true)
  })
})
