import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { effectScope, ref } from 'vue'
import { useHallTaskActions } from '../src/composables/juyiting/useHallTaskActions.js'
import { createEconomyRequestIntentStore } from '../src/composables/juyiting/economyRequestIntent.js'
import { projectHallTask } from '../src/composables/juyiting/hallTaskPresentation.js'

const storage = () => {
  const rows = new Map()
  return { getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value), removeItem: key => rows.delete(key), rows }
}
const createHarness = (options = {}) => {
  const scope = effectScope()
  const calls = []
  const actor = ref('actor-a')
  const selectedTask = ref(null)
  const tasks = ref([])
  const store = options.storage || storage()
  const actions = scope.run(() => useHallTaskActions({
    agentApi: { create: (...args) => { calls.push(['POST', ...args]); throw new Error('unexpected write') },
      get: async (...args) => { calls.push(['GET', ...args]); return options.read ? options.read(...args) : { status: 'SETTLED' } } },
    fundedActorScopeKey: actor, fundedIntentStorage: store,
    identityScope: actor, identityEpoch: () => 1, selectedTask, tasks,
    log: { warn: () => {} }, playError: () => {}, playSuccess: () => {}, showToast: () => {}
  }))
  return { actions, calls, actor, selectedTask, tasks, store, dispose: () => scope.stop() }
}
const original = title => ({ key: `key-${title}`, body: { title, grossBountyAmountWen: '100', settlementPolicy: 'GROSS_INCLUSIVE' } })

describe('funded history retirement', () => {
  it('exposes no old create, assign, quote, claim, refund or replay commands', () => {
    const h = createHarness()
    try {
      for (const command of ['createTask', 'assignTask', 'autoAssignTask', 'cancelFunding', 'resumeFundedCreate', 'refreshFundedClaim']) expect(h.actions).not.to.have.property(command)
      expect(h.calls).to.deep.equal([])
    } finally { h.dispose() }
  })

  it('reads only the current actor original and never rewrites or deletes recovery evidence', () => {
    const store = storage()
    for (const actor of ['actor-a', 'actor-b']) expect(createEconomyRequestIntentStore({ storage: store, scopeKey: () => actor }).save('funded-create', original(actor)).state).to.equal('PRESENT')
    const before = [...store.rows]
    const h = createHarness({ storage: store })
    try {
      expect(h.actions.fundedCreateRecovery.value).to.deep.equal(original('actor-a'))
      h.actor.value = 'actor-b'
      expect(h.actions.fundedCreateRecovery.value).to.deep.equal(original('actor-b'))
      h.actor.value = ''
      expect(h.actions.fundedCreateRecovery.value).to.equal(null)
      expect([...store.rows]).to.deep.equal(before)
      expect(h.calls).to.deep.equal([])
    } finally { h.dispose() }
  })

  it('does not turn unavailable or corrupt recovery storage into a write', () => {
    for (const store of [null, { getItem: () => '{invalid', setItem: () => { throw new Error('must not write') } }]) {
      const h = createHarness({ storage: store })
      try { expect(h.actions.fundedCreateRecovery.value).to.equal(null); expect(h.calls).to.deep.equal([]) } finally { h.dispose() }
    }
  })

  it('loads historical settlement with GET only and preserves task state and balance', async () => {
    const h = createHarness()
    const task = { id: 'old/a', status: 'completed', funding: { mode: 'FUNDED_SINGLE_AGENT', remainingWen: '0' } }
    h.selectedTask.value = task
    try {
      expect(await h.actions.loadSettlement(task)).to.deep.equal({ status: 'SETTLED' })
      expect(h.calls.map(call => call.slice(0, 2))).to.deep.equal([['GET', '/tasks/old%2Fa/settlement']])
      expect(task.status).to.equal('completed'); expect(task.funding.remainingWen).to.equal('0')
    } finally { h.dispose() }
  })

  it('does not apply a late history response to a different identity', async () => {
    let finish
    const h = createHarness({ read: () => new Promise(resolve => { finish = resolve }) })
    const task = { id: 'old', status: 'completed', funding: { mode: 'FUNDED_SINGLE_AGENT' } }
    h.selectedTask.value = task
    try {
      const pending = h.actions.loadSettlement(task)
      h.actor.value = 'actor-b'; h.selectedTask.value = { id: 'new-actor-task' }
      finish({ status: 'SETTLED' })
      expect(await pending).to.equal(null); expect(task).not.to.have.property('settlement')
      expect(h.selectedTask.value.id).to.equal('new-actor-task')
    } finally { h.dispose() }
  })

  it('keeps every old funding phase read-only without changing server phase or amount facts', () => {
    for (const status of ['open', 'assigned', 'running', 'reviewing', 'completed', 'cancelled']) {
      const task = { id: 'old', status, funding: { mode: 'FUNDED_SINGLE_AGENT', grossBountyAmountWen: '100' } }
      const result = projectHallTask({ task, pendingOperation: { key: 'old' } })
      expect(result.readOnly).to.equal(true); expect(result.actions).to.deep.equal(['VIEW'])
      expect(result.rawStatus).to.equal(status); expect(task.funding.grossBountyAmountWen).to.equal('100')
    }
    expect(projectHallTask({ task: { id: 'new', status: 'open' } }).actions).to.include('ASSIGN')
  })

  it('has no old funded mutation URLs, confirmation dialog, or recovery buttons in production consumers', () => {
    const actions = readFileSync(new URL('../src/composables/juyiting/useHallTaskActions.js', import.meta.url), 'utf8')
    const panel = readFileSync(new URL('../src/components/juyiting/BountyPanel.vue', import.meta.url), 'utf8')
    const hall = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
    expect(actions).not.to.match(/\/quotes|\/claim|\/funding\/cancel|\/funding\/complete/)
    for (const event of ['resume-funded-create', 'cancel-funding', 'confirm-funded-quote', 'refresh-funded-claim']) {
      expect(panel).not.to.include(event); expect(hall).not.to.include(event)
    }
    expect(panel).to.include('历史资金榜请求（仅供查阅）')
    expect(panel).to.include("$emit('load-settlement', detailTask)")
    expect(hall).to.include('await startPointAndStart({ task, agent: targetAgents[0] })')
  })
})
