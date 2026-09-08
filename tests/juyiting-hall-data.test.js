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
