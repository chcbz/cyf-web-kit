import { expect } from 'chai'
import { ref } from 'vue'
import { useHallBountyAssignmentContext } from '../src/composables/juyiting/useHallBountyAssignmentContext.js'
const context = () => ({ conversationId: '7', conversationGeneration: '1', taskId: '450', targetAgentId: 'wuyong', taskVersion: '8' })
const projection = () => ({ schemaVersion: 1, ...context(), assignmentRevision: '1', baselineGrantVersion: '2', requirementRevision: '1' })
const harness = get => {
  const owner = ref('owner'); const auth = ref(1); const epoch = ref(1); const ctx = ref(context()); const enabled = ref(true)
  const lane = useHallBountyAssignmentContext({ chatApi: { get }, identityScope: owner, authorizationGeneration: auth,
    getContext: () => ctx.value, getContextGeneration: () => epoch.value, enabled: () => enabled.value })
  return { lane, owner, auth, epoch, ctx, enabled }
}
describe('current assignment read without browser point-and-start storage', () => {
  it('uses one authenticated GET and keeps assignment revision distinct from task version', async () => {
    const calls = []; const { lane } = harness(async (...args) => { calls.push(args); return ((projection())) })
    try {
      expect(await lane.refresh()).to.equal(true)
      expect(lane.projection.value.assignmentRevision).to.equal('1')
      expect(calls).to.have.length(1); expect(calls[0][0]).to.equal('/conversations/7/interactions/context')
      expect(calls[0][2].needAuth).to.equal(true)
    } finally { lane.dispose() }
  })
  for (const field of ['conversationId', 'conversationGeneration', 'taskId', 'targetAgentId', 'taskVersion', 'assignmentRevision', 'baselineGrantVersion', 'requirementRevision']) {
    it(`rejects malformed or foreign ${field}`, async () => {
      const h = harness(async () => ((({ ...projection(), [field]: 'wrong' }))))
      try { expect(await h.lane.refresh()).to.equal(false); expect(h.lane.projection.value).to.equal(null) }
      finally { h.lane.dispose() }
    })
  }
  for (const key of ['owner', 'auth', 'epoch', 'ctx', 'enabled']) {
    it(`discards a delayed response after ${key} changes`, async () => {
      let resolve
      const h = harness(() => new Promise(done => { resolve = done }))
      try {
        const first = h.lane.refresh(); expect(h.lane.refresh()).to.equal(first)
        h[key].value = key === 'ctx' ? { ...context(), taskVersion: '9' } : key === 'enabled' ? false : 'changed'
        resolve(((projection())))
        expect(await first).to.equal(false); expect(h.lane.projection.value).to.equal(null)
      } finally { h.lane.dispose() }
    })
  }
  it('cannot clear or overwrite the new scan when an old response arrives', async () => {
    const pending = []; const h = harness(() => new Promise(resolve => pending.push(resolve)))
    try {
      const old = h.lane.refresh(); h.epoch.value++
      const fresh = h.lane.refresh(); pending[0](((projection())))
      expect(await old).to.equal(false); expect(h.lane.loading.value).to.equal(true)
      pending[1](((projection()))); expect(await fresh).to.equal(true)
      h.owner.value = 'different'; expect(h.lane.projection.value).to.equal(null)
    } finally { h.lane.dispose() }
  })

  it('does not reset a binding when request generation or presentation metadata is filled in', async () => {
    const h = harness(async () => projection())
    try {
      expect(await h.lane.refresh()).to.equal(true)
      const trusted = h.lane.projection.value
      h.ctx.value = { ...context(), conversationGeneration: '2', requestId: 'new-request' }
      expect(h.lane.projection.value).to.equal(trusted)
      h.ctx.value = { ...context(), taskVersion: '9' }
      expect(h.lane.projection.value).to.equal(null)
    } finally { h.lane.dispose() }
  })
  it('retains the same authenticated projection during a refresh but fences failed reads', async () => {
    let resolve; let initial = true
    const h = harness(async () => { if (initial) return projection(); return new Promise(done => { resolve = done }) })
    try {
      expect(await h.lane.refresh()).to.equal(true)
      const trusted = h.lane.projection.value; initial = false
      const pending = h.lane.refresh()
      expect(h.lane.loading.value).to.equal(true)
      expect(h.lane.projection.value).to.equal(trusted)
      resolve(projection()); expect(await pending).to.equal(true)
      expect(h.lane.projection.value).to.deep.equal(trusted)
    } finally { h.lane.dispose() }
  })
  it('retains only read-only data on transient errors and clears it on revoked access', async () => {
    let failure = null; const h = harness(async () => { if (failure) throw failure; return projection() })
    try {
      expect(await h.lane.refresh()).to.equal(true); const trusted = h.lane.projection.value
      failure = new Error('temporary unavailable')
      expect(await h.lane.refresh()).to.equal(false); expect(h.lane.projection.value).to.equal(trusted)
      failure = Object.assign(new Error('forbidden'), { status: 403 })
      expect(await h.lane.refresh()).to.equal(false); expect(h.lane.projection.value).to.equal(null)
      expect(h.lane.error.value).to.include('指派上下文')
    } finally { h.lane.dispose() }
  })
})
