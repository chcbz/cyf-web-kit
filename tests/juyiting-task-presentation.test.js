import { expect } from 'chai'
import { ref } from 'vue'
import { projectHallTask, validateHallTaskCounts } from '../src/composables/juyiting/hallTaskPresentation.js'
import { useHallData } from '../src/composables/juyiting/useHallData.js'
import { taskStatusFilters, taskStatusText } from '../src/constants/juyiting.js'

const counts = (value = '1') => ({
  phaseCounts: { PENDING_ASSIGNMENT: value, IN_PROGRESS: '0', PENDING_ACCEPTANCE: '0', COMPLETED: '0', HISTORY: '0', UNKNOWN: '0', total: value },
  rawStatusCounts: { open: value, total: value }
})
const task = { id: 'task-a', status: 'reviewing', taskVersion: '7', phase: 'PENDING_ACCEPTANCE' }
const context = { taskId: 'task-a', taskState: 'REVIEWING', taskVersion: '7', currentDelivery: { state: 'SUBMITTED', allowedActions: ['VIEW', 'ACCEPT'] } }
const pending = () => { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }
const data = (api, extra = {}) => useHallData({ agentApi: api, log: { warn () {} }, normalizeStatus: value => value, selectedAgent: ref(null), selectedTask: ref(null), taskAgentMatchScore: () => 0, ...extra })

describe('shared Hall task presentation and authoritative phase counts', () => {
  it('shows four primary stages and retains root terminal reasons without queue or question states', () => {
    expect(taskStatusFilters.filter(item => !item.secondary).map(item => item.value)).to.deep.equal(['PENDING_ASSIGNMENT', 'IN_PROGRESS', 'PENDING_ACCEPTANCE', 'COMPLETED'])
    for (const status of ['assigned', 'planning', 'running', 'blocked']) expect(taskStatusText(status)).to.equal('进行中')
    for (const status of ['claimed', 'queued', 'in_progress', 'submitted', '', 'RUNNING']) expect(projectHallTask({ task: status })).to.include({ phase: 'UNKNOWN', readOnly: true })
    for (const status of ['completed', 'failed', 'cancelled', 'archived']) expect(projectHallTask({ task: status }).readOnly).to.equal(true)
  })
  it('never creates acceptance capability from a raw label, missing batch, stale version, or pending operation', () => {
    expect(projectHallTask({ task }).actions).not.to.include('ACCEPT')
    expect(projectHallTask({ task, reviewContext: context }).actions).to.include('ACCEPT')
    expect(projectHallTask({ task, reviewContext: { ...context, taskVersion: '8' } })).to.include({ phase: 'UNKNOWN', readOnly: true })
    expect(projectHallTask({ task, reviewContext: { ...context, currentDelivery: null } }).phase).to.equal('UNKNOWN')
    expect(projectHallTask({ task, reviewContext: context, pendingOperation: { state: 'PROCESSING' } }).actions).to.deep.equal(['VIEW', 'CHECK_OPERATION'])
    expect(projectHallTask({ task: { ...task, phase: 'UNKNOWN' } }).actions).to.deep.equal(['VIEW'])
  })
  it('preserves count precision, validates totals, and never accepts raw-only or numeric wire counts', () => {
    expect(validateHallTaskCounts(counts('9007199254740993')).phaseCounts.total).to.equal('9007199254740993')
    for (const invalid of [{ total: 1 }, { ...counts(), phaseCounts: { ...counts().phaseCounts, total: 1 } }, counts('-1'), counts('01'), counts('9223372036854775808'), { ...counts(), rawStatusCounts: { open: '2', total: '1' } }]) expect(validateHallTaskCounts(invalid)).to.equal(null)
  })
  it('keeps the active task when it leaves the first page, and when refreshing the list fails', async () => {
    const selectedTask = ref({ id: 'active', status: 'reviewing' })
    let fail = false
    const model = data({ async search (url, params, options) {
      if (url.endsWith('search') && fail) throw new Error('offline')
      options.onSuccess(url.endsWith('search') ? { items: [{ id: 'different', status: 'open' }] } : counts())
    } }, { selectedTask })
    try {
      await model.loadTasks()
      expect(selectedTask.value.id).to.equal('active')
      fail = true
      await model.loadTasks()
      expect(selectedTask.value.id).to.equal('active')
      expect(model.tasksError.value).to.equal('offline')
    } finally { model.dispose() }
  })
  it('fences out-of-order filters, identity resets, counts and teardown without losing current account scope', async () => {
    const identity = ref('owner-a'), calls = []
    const model = data({ async search (url, params, options) {
      const wait = pending(); calls.push({ url, params, options, wait }); await wait.promise
    } }, { identityScope: identity })
    const complete = (start, id) => {
      calls[start].options.onSuccess({ items: [{ id, status: 'open' }] }); calls[start].wait.resolve()
      calls[start + 1].options.onSuccess(counts()); calls[start + 1].wait.resolve()
    }
    const a = model.loadTasks()
    const b = model.setTaskStatusFilter('IN_PROGRESS')
    complete(2, 'new-filter'); await b
    complete(0, 'old-filter'); await a
    expect(model.tasks.value[0].id).to.equal('new-filter')
    expect(calls[2].params).to.include({ phase: 'IN_PROGRESS' })
    expect(calls[2].params).not.to.have.property('status')
    const stale = model.loadTasks()
    identity.value = 'owner-b'
    complete(4, 'wrong-owner'); await stale
    expect(model.tasks.value).to.deep.equal([])
    expect(model.taskStatusCount()).to.equal('—')
    const disposed = model.loadTasks(); model.dispose(); complete(6, 'after-unmount'); await disposed
    expect(model.tasks.value).to.deep.equal([])
  })
  it('rejects stale assignee recommendations after a newer selection, identity change, or unmount', async () => {
    const identity = ref('owner-a'), calls = []
    const model = data({ async create (url, body, options) {
      const wait = pending(); calls.push({ options, wait }); await wait.promise
    } }, { identityScope: identity })
    const complete = (index, id) => {
      calls[index].options.onSuccess([{ agent: { agentId: id } }]); calls[index].wait.resolve()
    }
    const a = model.loadTaskRecommendations({ id: 'task-a' })
    const b = model.loadTaskRecommendations({ id: 'task-b' })
    complete(1, 'current-agent'); await b
    complete(0, 'stale-agent'); expect(await a).to.deep.equal([])
    expect(model.taskRecommendations.value).not.to.have.property('task-a')
    expect(model.taskRecommendations.value['task-b'][0].agent.agentId).to.equal('current-agent')
    const c = model.loadTaskRecommendations({ id: 'task-c' })
    identity.value = 'owner-b'; complete(2, 'wrong-owner'); await c
    expect(model.taskRecommendations.value).to.deep.equal({})
    const d = model.loadTaskRecommendations({ id: 'task-d' })
    model.dispose(); complete(3, 'after-unmount'); await d
    expect(model.taskRecommendations.value).to.deep.equal({})
  })

})
