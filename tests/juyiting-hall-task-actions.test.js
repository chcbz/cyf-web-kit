import { expect } from 'chai'
import { ref } from 'vue'

import { useHallData } from '../src/composables/juyiting/useHallData.js'
import { useHallTaskActions } from '../src/composables/juyiting/useHallTaskActions.js'

const createHarness = (response, { canAssign = () => true } = {}) => {
  const apiCalls = []
  const toasts = []
  const calls = { error: 0, success: 0 }
  const tasks = ref([])
  const selectedAgent = ref(null)
  const selectedTask = ref(null)
  const agentApi = {
    create: async (url, payload, options) => {
      apiCalls.push({ payload, url })
      return options.onSuccess(response)
    }
  }

  const actions = useHallTaskActions({
    agentApi,
    canAssign,
    log: { warn: () => {} },
    playError: () => { calls.error += 1 },
    playSuccess: () => { calls.success += 1 },
    selectedAgent,
    selectedTask,
    showToast: message => toasts.push(message),
    tasks
  })

  return { actions, apiCalls, calls, selectedAgent, selectedTask, toasts, tasks }
}

const createHallData = (selectedAgent) => useHallData({
  agentApi: {},
  log: { warn: () => {} },
  normalizeStatus: (status = '') => status.toLowerCase(),
  selectedAgent,
  selectedTask: ref(null),
  taskAgentMatchScore: () => 0
})

describe('useHallTaskActions', () => {
  it('fails closed instead of using selectedAgent when the explicit assignment target is missing or invalid', async () => {
    const harness = createHarness({ code: 'E0' })
    const hiddenSelection = { agentId: 'hidden-agent', name: 'Hidden', status: 'online' }
    harness.selectedAgent.value = hiddenSelection

    const attempts = [
      agent => harness.actions.assignTask({ id: 'task-omitted', title: 'Omitted', status: 'open' }),
      agent => harness.actions.assignTask({ id: 'task-undefined', title: 'Undefined', status: 'open' }, undefined),
      agent => harness.actions.assignTask({ id: 'task-null', title: 'Null', status: 'open' }, null),
      agent => harness.actions.assignTask({ id: 'task-object', title: 'Object', status: 'open' }, {}),
      agent => harness.actions.assignTask({ id: 'task-empty-id', title: 'Empty', status: 'open' }, { agentId: '', status: 'online' }),
      agent => harness.actions.assignTask({ id: 'task-blank-id', title: 'Blank', status: 'open' }, { agentId: '   ', status: 'online' }),
      agent => harness.actions.assignTask({ id: 'task-empty-array', title: 'Empty array', status: 'open' }, []),
      agent => harness.actions.assignTask({ id: 'task-invalid-array', title: 'Invalid array', status: 'open' }, [agent, {}]),
      agent => harness.actions.assignTask(null, agent),
      agent => harness.actions.assignTask({ title: 'Missing task id', status: 'open' }, agent)
    ]

    for (const attempt of attempts) {
      expect(await attempt(hiddenSelection)).to.equal(false)
    }

    expect(harness.apiCalls).to.deep.equal([])
    expect(harness.selectedAgent.value).to.equal(hiddenSelection)
    expect(harness.selectedTask.value).to.equal(null)
    expect(harness.calls).to.deep.equal({ error: 0, success: 0 })
    expect(harness.toasts).to.deep.equal([])
  })

  it('requires an explicit agent id in the real canAssign composable even when selectedAgent is populated', () => {
    const selectedAgent = ref({ agentId: 'hidden-agent', status: 'online' })
    const { canAssign } = createHallData(selectedAgent)
    const task = { id: 'task-a', status: 'open' }

    expect(canAssign(task)).to.equal(false)
    expect(canAssign(task, undefined)).to.equal(false)
    expect(canAssign(task, null)).to.equal(false)
    expect(canAssign(task, {})).to.equal(false)
    expect(canAssign(task, { agentId: '', status: 'online' })).to.equal(false)
    expect(canAssign(task, { agentId: '   ', status: 'online' })).to.equal(false)
    expect(canAssign(task, { agentId: 'explicit-agent', status: 'online' })).to.equal(true)
    expect(selectedAgent.value.agentId).to.equal('hidden-agent')
  })

  it('keeps a task open and shows the backend rejection reason when assignment fails', async () => {
    const harness = createHarness({
      code: 'AGENT_BUSY',
      msg: '卢俊义当前已有进行中的任务',
      status: 409
    })
    const task = { id: '374', title: '纯聊', status: 'open' }
    const agent = { agentId: 'lujunyi', name: '卢俊义', status: 'online' }
    harness.tasks.value = [task]

    expect(await harness.actions.assignTask(task, agent)).to.equal(false)

    expect(task.status).to.equal('open')
    expect(agent.status).to.equal('online')
    expect(harness.apiCalls).to.have.length(1)
    expect(harness.calls).to.deep.equal({ error: 1, success: 0 })
    expect(harness.toasts).to.deep.equal(['点将未成：卢俊义当前已有进行中的任务'])
  })

  it('uses the server task returned by a successful single-agent assignment', async () => {
    const assignedTask = {
      id: '374',
      title: '纯聊',
      status: 'assigned',
      assignedAgentId: 'lujunyi',
      assignedAgentIds: ['lujunyi'],
      assignedAgentName: '卢俊义'
    }
    const harness = createHarness({ code: 'E0', data: assignedTask })
    const task = { id: '374', title: '纯聊', status: 'open' }
    const agent = { agentId: 'lujunyi', name: '卢俊义', status: 'online' }
    harness.tasks.value = [task]

    expect(await harness.actions.assignTask(task, agent)).to.equal(true)

    expect(task).to.include(assignedTask)
    expect(agent.status).to.equal('busy')
    expect(harness.apiCalls).to.deep.equal([{
      url: '/tasks/374/assign',
      payload: { agentId: 'lujunyi', agentIds: ['lujunyi'] }
    }])
    expect(harness.calls).to.deep.equal({ error: 0, success: 1 })
    expect(harness.toasts).to.deep.equal(['纯聊 已点给 卢俊义'])
  })

  it('preserves explicit multi-agent assignment payload and local updates', async () => {
    const harness = createHarness({ code: 'E0' })
    const task = { id: 'multi', title: '合力护送', status: 'open' }
    const agents = [
      { agentId: 'linchong', name: '林冲', status: 'online' },
      { agentId: 'luzhishen', name: '鲁智深', status: 'online' }
    ]

    expect(await harness.actions.assignTask(task, agents)).to.equal(true)

    expect(harness.apiCalls).to.deep.equal([{
      url: '/tasks/multi/assign',
      payload: { agentId: 'linchong', agentIds: ['linchong', 'luzhishen'] }
    }])
    expect(task).to.include({
      status: 'assigned',
      assignedAgentId: 'linchong',
      assignedAgentName: '林冲、鲁智深'
    })
    expect(task.assignedAgentIds).to.deep.equal(['linchong', 'luzhishen'])
    expect(agents.map(agent => agent.status)).to.deep.equal(['busy', 'busy'])
    expect(harness.selectedAgent.value).to.equal(agents[0])
    expect(harness.selectedTask.value).to.equal(task)
  })
})
