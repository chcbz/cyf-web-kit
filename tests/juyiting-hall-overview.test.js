import { expect } from 'chai'
import { describe, it } from 'mocha'
import { ref } from 'vue'
import { canOpenHallItem, HALL_SOURCES, useHallOverview } from '../src/composables/juyiting/useHallOverview.js'
import { stopIdentityBoundWork } from '../src/utils/identityLifecycle.js'

const item = (sourceType = 'PRIVATE_CASE', sourceId = 'case-a') => ({
  ref: { sourceType, sourceId }, title: '我的事项', status: { code: 'QUEUED', evidenceSource: 'PERSONAL_WORKSPACE_EXECUTION', observedAt: 100 },
  targetAgent: { agentId: 'agent-a' }, nextAction: { PRIVATE_CASE: 'OPEN_CASE', LEGACY_EXECUTION: 'OPEN_EXECUTION', TASK: 'OPEN_TASK', DRAFT: 'EDIT_DRAFT' }[sourceType],
  allowedActions: [{ PRIVATE_CASE: 'OPEN_CASE', LEGACY_EXECUTION: 'OPEN_EXECUTION', TASK: 'OPEN_TASK', DRAFT: 'EDIT_DRAFT' }[sourceType]], updatedAt: 99
})
const part = (items = [], extras = {}) => ({ items, status: 'complete', nextCursor: null, count: null, errorCode: null, ...extras })
const sourceStatus = partitions => Object.fromEntries(Object.entries(partitions).map(([key, value]) => [key, { status: value.status, errorCode: value.errorCode }]))
const overview = (privatePart = part([item()])) => {
  const partitions = { private: privatePart, task: part([item('TASK', 'task-a')]), draft: part([item('DRAFT', 'draft-a')]) }
  return { schemaVersion: 1, sections: { recent: { status: 'complete', partitions }, needsAction: { status: 'complete', partitions: { private: part(), task: part(), draft: part() } } },
    sourceStatus: { recent: sourceStatus(partitions), needsAction: sourceStatus({ private: part(), task: part(), draft: part() }) }, asOf: 100 }
}
const page = (source, value, view = 'recent') => ({ schemaVersion: 1, kind: source, view, q: '', section: { status: value.status, partitions: { [source]: value } }, sourceStatus: sourceStatus({ [source]: value }), asOf: 200 })
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const harness = (handler, owner = ref('tenant\u0000client\u0000owner-a')) => {
  const calls = []
  const model = useHallOverview({ identityScope: owner, identityEpoch: ref(1), api: { execute: options => { calls.push(options); return handler(options) } } })
  return { calls, model, owner }
}

describe('JYT-UX-W05 independent Hall read model', () => {
  it('uses a query-free overview and retains unknown counts and exact source refs', async () => {
    const { model, calls } = harness(async () => overview())
    try {
      expect(await model.refresh()).to.equal(true)
      expect(calls[0]).to.include({ url: '/hall/overview', method: 'GET', needAuth: true, autoLoading: false })
      expect(calls[0]).not.to.have.property('params')
      expect(calls[0]).not.to.have.property('data')
      for (const source of HALL_SOURCES) expect(model.sections.value.recent.partitions[source].count).to.equal(null)
      expect(model.sections.value.recent.partitions.private.items[0].ref).to.deep.equal({ sourceType: 'PRIVATE_CASE', sourceId: 'case-a' })
    } finally { model.dispose() }
  })

  it('retains partial/failed sources without hiding the other source or pretending empty', async () => {
    const response = overview(part([], { status: 'partial', errorCode: 'VIEWED_RESULT_NOT_TRACKED' }))
    response.sections.recent.partitions.task = part([], { status: 'error', errorCode: 'HALL_SOURCE_UNAVAILABLE' })
    response.sourceStatus.recent = sourceStatus(response.sections.recent.partitions)
    const { model } = harness(async () => response)
    try {
      await model.refresh()
      expect(model.sections.value.recent.status).to.equal('partial')
      expect(model.sections.value.recent.partitions.private.status).to.equal('partial')
      expect(model.sections.value.recent.partitions.task.status).to.equal('error')
      expect(model.sections.value.recent.partitions.draft.items).to.have.length(1)
    } finally { model.dispose() }
  })

  it('continues only the requested source with its opaque cursor (not the ID length limit)', async () => {
    const cursor = 'a'.repeat(512)
    const { model, calls } = harness(async options => options.url === '/hall/overview'
      ? overview(part([item()], { nextCursor: cursor }))
      : page('private', part([item(), item('LEGACY_EXECUTION', 'execution-b')])))
    try {
      await model.refresh()
      const task = model.sections.value.recent.partitions.task
      await model.loadPartition('recent', 'private', { append: true })
      expect(calls[1].params).to.deep.equal({ kind: 'private', view: 'recent', q: '', cursor })
      expect(model.sections.value.recent.partitions.private.items.map(value => value.ref.sourceType)).to.deep.equal(['PRIVATE_CASE', 'LEGACY_EXECUTION'])
      expect(model.sections.value.recent.partitions.task).to.equal(task)
      expect(model.sections.value.recent.partitions.private.count).to.equal(null)
      expect(await model.loadPartition('recent', 'all', { append: true })).to.equal(false)
      expect(calls).to.have.length(2)
    } finally { model.dispose() }
  })

  it('retries a failed page with the same cursor while showing retained data as unconfirmed', async () => {
    let retries = 0
    const { model, calls } = harness(async options => {
      if (options.url === '/hall/overview') return overview(part([item()], { nextCursor: 'cursor_a' }))
      if (++retries === 1) throw Object.assign(new Error('storage'), { status: 503 })
      return page('private', part([item('PRIVATE_CASE', 'case-b')]))
    })
    try {
      await model.refresh()
      expect(await model.loadPartition('recent', 'private', { append: true })).to.equal(false)
      expect(model.sections.value.recent.partitions.private).to.include({ status: 'partial', nextCursor: 'cursor_a' })
      expect(model.sections.value.recent.partitions.private.readError).not.to.equal('')
      await model.loadPartition('recent', 'private', { append: true })
      expect(calls[1].params).to.deep.equal(calls[2].params)
      expect(model.sections.value.recent.partitions.private.items).to.have.length(2)
    } finally { model.dispose() }
  })

  for (const status of [401, 403]) it(`clears all summaries after ${status} without issuing any mutation`, async () => {
    const { model, calls } = harness(async options => {
      if (options.url === '/hall/overview') return overview()
      throw Object.assign(new Error('denied'), { status })
    })
    try {
      await model.refresh()
      await model.loadPartition('recent', 'private')
      for (const view of Object.values(model.sections.value)) for (const value of Object.values(view.partitions)) {
        expect(value.items).to.deep.equal([])
        expect(value.status).to.equal('error')
      }
      expect(calls.every(call => call.method === 'GET')).to.equal(true)
    } finally { model.dispose() }
  })

  it('fences late account A results and never displays them for account B', async () => {
    const pending = deferred()
    const { model, owner } = harness(() => pending.promise)
    try {
      const loading = model.refresh()
      owner.value = 'tenant\u0000client\u0000owner-b'
      pending.resolve(overview())
      expect(await loading).to.equal(false)
      expect(model.sections.value.recent.partitions.private.items).to.deep.equal([])
      expect(model.state.value).to.equal('idle')
    } finally { model.dispose() }
  })

  it('does not fetch without a stable scope and clears data on lifecycle identity cleanup', async () => {
    const { model, owner, calls } = harness(async () => overview(), ref(''))
    try {
      await model.refresh()
      expect(calls).to.have.length(0)
      owner.value = 'tenant\u0000client\u0000owner-a'
      await model.refresh()
      stopIdentityBoundWork()
      expect(model.sections.value.recent.partitions.private.items).to.deep.equal([])
    } finally { model.dispose() }
  })

  it('rejects cross-partition source types and mismatched evidence without losing valid partitions', async () => {
    const response = overview(part([item('TASK', 'task-in-private')]))
    response.sourceStatus.recent.task = { status: 'partial', errorCode: 'TASK_REVIEW_NOT_PROJECTED' }
    const { model } = harness(async () => response)
    try {
      await model.refresh()
      expect(model.sections.value.recent.partitions.private.status).to.equal('error')
      expect(model.sections.value.recent.partitions.task.status).to.equal('error')
      expect(model.sections.value.recent.partitions.draft.items).to.have.length(1)
    } finally { model.dispose() }
  })

  it('loads a canonical formal task by ref instead of using an overview summary as a task', async () => {
    const formal = item('TASK', 'task-a')
    const { model, calls } = harness(async () => ({ id: 'task-a', title: '原正式榜文', status: 'assigned' }))
    try {
      const task = await model.loadTask(formal)
      expect(task.title).to.equal('原正式榜文')
      expect(calls[0].url).to.equal('/tasks/task-a')
      expect(model.openingRef.value).to.equal(null)
      expect(canOpenHallItem({ ...formal, allowedActions: [] })).to.equal(false)
      expect(await model.loadTask({ ...formal, allowedActions: [] })).to.equal(null)
      expect(calls).to.have.length(1)
    } finally { model.dispose() }
  })

  it('reports a read error, not a successful empty overview, on 503 or invalid envelope', async () => {
    for (const response of [null, { schemaVersion: 2 }]) {
      const { model } = harness(async () => {
        if (!response) throw Object.assign(new Error('unavailable'), { status: 503 })
        return response
      })
      try {
        await model.refresh()
        expect(model.state.value).to.equal('error')
        expect(model.sections.value.recent.partitions.private.status).to.equal('error')
      } finally { model.dispose() }
    }
  })
})
