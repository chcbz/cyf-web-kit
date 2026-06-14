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
