import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { nextTick, ref } from 'vue'
import { useFormalDeliveries, formalDeliveryReadAdapter } from '../src/composables/useFormalDeliveries.js'

const tick = async () => { await Promise.resolve(); await nextTick(); await Promise.resolve() }
const artifact = overrides => ({ artifactId: 'artifact-1', artifactVersion: 1, contentHash: 'a'.repeat(64), purpose: '交付报告', ...overrides })
const delivery = overrides => ({
  taskId: 'task-1', workItemId: 'work-1', deliveryId: 'delivery-1', revision: 2, deliveryVersion: 0, state: 'submitted', runId: 'run-1', producerAgentId: 'agent-1',
  summary: '正式交付摘要', manifestArtifactId: 'manifest-1', manifestArtifactVersion: 1, submittedAt: 1, taskVersion: 3, workItemVersion: 4,
  items: [artifact()], ...overrides
})

describe('OD10 formal delivery historical read boundary', () => {
  it('keeps frozen versions and owner/task reads but exposes no independent mutation or key factory', async () => {
    const calls = []; let writes = 0
    const history = useFormalDeliveries({ taskId: ref('task-1'), identityFingerprint: ref('owner:client:1'),
      adapter: { list: async request => { calls.push(request); return [delivery({ taskVersion: 0, workItemVersion: 0 })] },
        decide: async () => { writes++ }, createRework: async () => { writes++ } } })
    try {
      await tick()
      expect(calls).to.have.length(1)
      expect(calls[0]).to.include({ taskId: 'task-1' }).and.not.have.property('params')
      expect(history.items.value[0]).to.deep.include({ taskVersion: 0, workItemVersion: 0, items: [artifact()] })
      expect(history).not.to.have.any.keys('decide', 'createRework', 'busyDeliveryId', 'reworkBusyDeliveryId')
      expect(Object.keys(formalDeliveryReadAdapter)).to.deep.equal(['list'])
      await history.refresh(); expect(writes).to.equal(0)
    } finally { history.dispose() }
  })
  it('validates actual read responses, including all fixed artifact and decision versions', async () => {
    const history = useFormalDeliveries({ taskId: ref('task-1'), identityFingerprint: ref('owner:client:1'), adapter: { list: async () => rows } })
    let rows = []
    try {
      await tick()
      for (const artifactVersion of [0, -1, 1.5, '1', NaN, 2147483648]) {
        rows = [delivery({ items: [artifact({ artifactVersion })] })]
        expect(await history.refresh()).to.equal(null); expect(history.items.value).to.deep.equal([])
        expect(history.message.value).to.include('读取失败')
      }
      for (const artifactVersion of [1, 2147483647]) {
        rows = [delivery({ taskVersion: 0, workItemVersion: 0, items: [artifact({ artifactVersion })] })]
        expect(await history.refresh()).to.have.length(1)
      }
      for (const invalid of [delivery({ taskId: 'foreign' }), delivery({ state: 'accepted', deliveryVersion: 0 }),
        delivery({ state: 'changes_requested', deliveryVersion: 1, reviewedAt: 2, reviewReason: null }), delivery({ arbitraryAuthority: true })]) {
        rows = [invalid]; expect(await history.refresh()).to.equal(null); expect(history.items.value).to.deep.equal([])
      }
      rows = [delivery(), delivery()]; expect(await history.refresh()).to.equal(null)
      rows = [delivery({ state: 'changes_requested', deliveryVersion: 1, reviewedAt: 2, reviewReason: '请补充总结页。' })]
      expect(await history.refresh()).to.have.length(1)
      rows = [delivery({ state: 'accepted', deliveryVersion: 1, reviewedAt: 2, reviewReason: null })]
      expect(await history.refresh()).to.have.length(1)
    } finally { history.dispose() }
  })
  for (const outcome of ['success', 'failure']) {
    it(`aborts stale ${outcome} reads synchronously on identity switches and ignores their settlement`, async () => {
      const identity = ref('owner-a'); let settle; let oldSignal; let reads = 0
      const pending = new Promise((resolve, reject) => { settle = outcome === 'success' ? () => resolve([delivery({ summary: 'private-a' })]) : () => reject(new Error('old error')) })
      const history = useFormalDeliveries({ taskId: ref('task-1'), identityFingerprint: identity,
        adapter: { list: async ({ signal }) => { if (++reads === 1) { oldSignal = signal; return pending }; return [delivery({ summary: 'private-b' })] } } })
      try {
        identity.value = 'owner-b'; expect(oldSignal.aborted).to.equal(true); expect(history.items.value).to.deep.equal([])
        await tick(); expect(history.items.value[0].summary).to.equal('private-b')
        settle(); await tick(); expect(history.state.value).to.equal('ready'); expect(history.items.value[0].summary).to.equal('private-b')
      } finally { history.dispose() }
    })
  }
  it('clears old data on forbidden/error, distinguishes empty, never retries in a loop, and stops its watcher on dispose', async () => {
    const identity = ref('owner-a'); let error; let reads = 0; let rows = [delivery()]
    const history = useFormalDeliveries({ taskId: ref('task-1'), identityFingerprint: identity,
      adapter: { list: async () => { reads++; if (error) throw error; return rows } } })
    try {
      await tick(); expect(history.items.value).to.have.length(1)
      error = Object.assign(new Error('denied'), { status: 403 }); await history.refresh()
      expect(history.state.value).to.equal('forbidden'); expect(history.items.value).to.deep.equal([])
      error = new TypeError('offline'); await history.refresh(); expect(history.state.value).to.equal('unknown')
      const count = reads; await tick(); expect(reads).to.equal(count)
      error = null; rows = []; await history.refresh(); expect(history.state.value).to.equal('empty')
      history.dispose(); identity.value = 'owner-b'; await history.refresh(); await tick(); expect(reads).to.equal(count + 1)
    } finally { history.dispose() }
  })
  it('retains GET-only historical API without old decisions, separate rework or nested envelope unwrapping', () => {
    const source = readFileSync(new URL('../src/composables/useFormalDeliveries.js', import.meta.url), 'utf8')
    expect(source).to.include('/formal-deliveries').and.include("method: 'GET'")
    for (const forbidden of ['/decision', '/rework-executions', "method: 'POST'", 'idempotencyKeyFactory', 'leaseToken', 'const unwrap']) expect(source).not.to.include(forbidden)
  })
})
