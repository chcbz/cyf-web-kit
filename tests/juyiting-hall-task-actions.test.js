import { expect } from 'chai'
import { ref } from 'vue'

import { useHallTaskActions } from '../src/composables/juyiting/useHallTaskActions.js'

const createHarness = (response) => {
  const toasts = []
  const calls = { error: 0, success: 0 }
  const tasks = ref([])
  const selectedAgent = ref(null)
  const selectedTask = ref(null)
  const agentApi = {
    create: async (_url, _payload, options) => options.onSuccess(response)
  }

  const actions = useHallTaskActions({
    agentApi,
    canAssign: () => true,
    log: { warn: () => {} },
    playError: () => { calls.error += 1 },
    playSuccess: () => { calls.success += 1 },
    selectedAgent,
    selectedTask,
    showToast: message => toasts.push(message),
    tasks
  })

  return { actions, calls, selectedAgent, selectedTask, toasts, tasks }
}

describe('useHallTaskActions', () => {
  it('keeps a task open and shows the backend rejection reason when assignment fails', async () => {
    const harness = createHarness({
      code: 'AGENT_BUSY',
      msg: '卢俊义当前已有进行中的任务',
      status: 409
    })
    const task = { id: '374', title: '纯聊', status: 'open' }
    const agent = { agentId: 'lujunyi', name: '卢俊义', status: 'online' }
    harness.tasks.value = [task]

    await harness.actions.assignTask(task, agent)

    expect(task.status).to.equal('open')
    expect(agent.status).to.equal('online')
    expect(harness.calls).to.deep.equal({ error: 1, success: 0 })
    expect(harness.toasts).to.deep.equal(['点将未成：卢俊义当前已有进行中的任务'])
  })

  it('uses the server task returned by a successful assignment', async () => {
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

    await harness.actions.assignTask(task, agent)

    expect(task).to.include(assignedTask)
    expect(agent.status).to.equal('busy')
    expect(harness.calls).to.deep.equal({ error: 0, success: 1 })
    expect(harness.toasts).to.deep.equal(['纯聊 已点给 卢俊义'])
  })
})
