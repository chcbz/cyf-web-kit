import { expect } from 'chai'
import { ref } from 'vue'
import { useHallData } from '../src/composables/juyiting/useHallData.js'

const row = id => ({ id, title: id, status: 'open', taskVersion: '1' })
const firstPage = Array.from({ length: 30 }, (_, index) => row(`task-${index}`))
const counts = { phaseCounts: { PENDING_ASSIGNMENT: '32', IN_PROGRESS: '0', PENDING_ACCEPTANCE: '0', COMPLETED: '0', HISTORY: '0', UNKNOWN: '0', total: '32' }, rawStatusCounts: { open: '32', total: '32' } }
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const fixture = handler => {
  const calls = []
  const identity = ref('owner-a')
  const data = useHallData({
    identityScope: identity, selectedAgent: ref(null), selectedTask: ref(null),
    log: { warn: () => {} }, normalizeStatus: value => value,
    agentApi: { search: async (url, params, options) => {
      calls.push({ url, params })
      options.onSuccess(url === '/tasks/status-counts' ? counts : await handler(params))
    } }
  })
  return { data, calls, identity, pages: () => calls.filter(call => call.url === '/tasks/search').map(call => call.params.pageNum) }
}

describe('matters list pagination owner', () => {
  it('appends successive pages, deduplicates rows and keeps independent counts', async () => {
    const f = fixture(params => ({ items: params.pageNum === 1 ? firstPage : [row('task-29'), row('task-30'), row('task-31')], total: '32' }))
    try {
      await f.data.loadTasks()
      expect(f.data.tasksHasMore.value).to.equal(true)
      await f.data.loadMoreTasks()
      expect(f.data.tasks.value).to.have.length(32)
      expect(f.data.tasksHasMore.value).to.equal(false)
      await f.data.loadMoreTasks()
      expect(f.pages()).to.deep.equal([1, 2])
      expect(f.calls.filter(call => call.url === '/tasks/status-counts')).to.have.length(1)
      expect(f.data.taskStatusCount('PENDING_ASSIGNMENT')).to.equal('32')
    } finally { f.data.dispose() }
  })

  it('keeps loaded rows after a failed append and retries the failed page only', async () => {
    let fail = true
    const f = fixture(params => {
      if (params.pageNum === 2 && fail) throw new Error('offline')
      return { items: params.pageNum === 1 ? firstPage : [row('last')], total: '31' }
    })
    try {
      await f.data.loadTasks(); await f.data.loadMoreTasks()
      expect(f.data.tasks.value).to.deep.equal(firstPage)
      expect(f.data.tasksError.value).to.equal('offline')
      expect(f.data.tasksHasMore.value).to.equal(true)
      fail = false; await f.data.loadMoreTasks()
      expect(f.pages()).to.deep.equal([1, 2, 2])
      expect(f.data.tasksError.value).to.equal('')
      expect(f.data.tasks.value.at(-1).id).to.equal('last')
    } finally { f.data.dispose() }
  })

  it('suppresses concurrent append requests', async () => {
    const wait = deferred()
    const f = fixture(params => params.pageNum === 1 ? { items: firstPage, total: '31' } : wait.promise)
    try {
      await f.data.loadTasks()
      const pending = f.data.loadMoreTasks()
      await f.data.loadMoreTasks()
      expect(f.pages()).to.deep.equal([1, 2])
      wait.resolve({ items: [row('last')], total: '31' }); await pending
    } finally { f.data.dispose() }
  })

  it('drops a late append after changing filters and starts the new filter at page one', async () => {
    const wait = deferred()
    const f = fixture(params => params.pageNum === 2 ? wait.promise : { items: params.phase === 'COMPLETED' ? [row('new-filter')] : firstPage, total: params.phase === 'COMPLETED' ? '1' : '31' })
    try {
      await f.data.loadTasks()
      const pending = f.data.loadMoreTasks()
      await f.data.setTaskStatusFilter('COMPLETED')
      wait.resolve({ items: [row('stale')], total: '31' }); await pending
      expect(f.pages()).to.deep.equal([1, 2, 1])
      expect(f.data.tasks.value.map(task => task.id)).to.deep.equal(['new-filter'])
      expect(f.data.tasksHasMore.value).to.equal(false)
      expect(f.data.tasksLoading.value).to.equal(false)
    } finally { f.data.dispose() }
  })

  it('invalidates pagination on an unsubmitted search or identity change', async () => {
    const wait = deferred()
    const f = fixture(params => params.pageNum === 2 ? wait.promise : { items: firstPage, total: '31' })
    try {
      await f.data.loadTasks()
      f.data.taskKeyword.value = 'new search'
      await f.data.loadMoreTasks()
      expect(f.pages()).to.deep.equal([1])
      await f.data.loadTasks()
      const pending = f.data.loadMoreTasks()
      f.identity.value = 'owner-b'
      wait.resolve({ items: [row('other-owner')], total: '31' }); await pending
      expect(f.data.tasks.value).to.deep.equal([])
      expect(f.data.tasksHasMore.value).to.equal(false)
      expect(f.data.tasksLoading.value).to.equal(false)
    } finally { f.data.dispose() }
  })
})
