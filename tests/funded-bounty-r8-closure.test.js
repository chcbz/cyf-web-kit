import { expect } from 'chai'
import { ref } from 'vue'
import { createEconomyRequestIntentStore } from '../src/composables/juyiting/economyRequestIntent.js'
import { useHallTaskActions } from '../src/composables/juyiting/useHallTaskActions.js'

const success = data => ({ data: { code: 'E0', data } })
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const memoryStorage = () => {
  const values = new Map()
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
    values
  }
}
const fundedTask = (version = '8') => ({ id: 'funded', title: '资金榜', status: 'open', taskVersion: version, funding: { mode: 'FUNDED_SINGLE_AGENT' } })
const receipt = (overrides = {}) => ({
  taskId: 'funded', fundingStatus: 'REFUNDED', refundTransactionId: 'refund-1', refundedMicro: '100', remainingMicro: '0', taskVersion: '9', fundingVersion: '2', refundedAt: '1000', ...overrides
})
const actionsFor = ({ api, storage = memoryStorage(), scope = () => 'actor-a', tasks = ref([]), selectedTask = ref(null) }) => useHallTaskActions({
  agentApi: api,
  canAssign: () => true,
  fundedActorScopeKey: scope,
  fundedIntentStorage: storage,
  createIdempotencyKey: () => 'stable-key',
  log: { warn: () => {} },
  playError: () => {},
  playSuccess: () => {},
  selectedAgent: ref(null),
  selectedTask,
  showToast: () => {},
  tasks
})

describe('W11/W12 R8 funded recovery closure', () => {
  it('treats a valid empty legacy namespace as per-operation absent, preserves siblings, and permits a second successful funded create', async () => {
    const storage = memoryStorage()
    const key = 'cyf.juyiting.economy-request-intent.v1.actor-a'
    storage.setItem(key, JSON.stringify({ schemaVersion: 1, records: {} }))
    const store = createEconomyRequestIntentStore({ storage, scopeKey: () => 'actor-a' })
    const alpha = { body: { title: 'alpha' }, key: 'alpha-key' }
    const beta = { body: { title: 'beta' }, key: 'beta-key' }
    expect(store.save('alpha', alpha)).to.include({ state: 'PRESENT' })
    expect(store.save('beta', beta)).to.include({ state: 'PRESENT' })
    expect(store.get('alpha').record).to.deep.equal(alpha)
    expect(store.get('beta').record).to.deep.equal(beta)
    expect(store.remove('alpha')).to.include({ state: 'ABSENT' })
    expect(store.save('alpha', alpha).record).to.deep.equal(alpha)
    expect(store.get('beta').record).to.deep.equal(beta)

    const requests = []
    const actions = actionsFor({ storage: memoryStorage(), api: { create: async (_url, body, options) => {
      requests.push({ body, key: options.headers['Idempotency-Key'] })
      return success({ id: `task-${requests.length}`, ...body })
    } } })
    expect(await actions.createTask({ title: 'first', grossBountyAmountMicro: '1', settlementPolicy: 'GROSS_INCLUSIVE' })).to.equal(true)
    expect(await actions.createTask({ title: 'second', grossBountyAmountMicro: '2', settlementPolicy: 'GROSS_INCLUSIVE' })).to.equal(true)
    expect(requests.map(item => item.body.title)).to.deep.equal(['first', 'second'])
  })

  for (const [name, storage] of [
    ['corrupt JSON', { getItem: () => '{', setItem: () => {}, removeItem: () => {} }],
    ['unsupported schema', { getItem: () => JSON.stringify({ schemaVersion: 99, records: {} }), setItem: () => {}, removeItem: () => {} }],
    ['read failure', { getItem: () => { throw new Error('storage denied') }, setItem: () => {}, removeItem: () => {} }]
  ]) {
    it(`fails closed before funded create when recovery storage has ${name}`, async () => {
      let creates = 0
      const actions = actionsFor({ storage, api: { create: async () => { creates += 1; return success({}) } } })
      expect(await actions.createTask({ title: 'must not send', grossBountyAmountMicro: '1', settlementPolicy: 'GROSS_INCLUSIVE' })).to.equal(false)
      expect(creates).to.equal(0)
      expect(actions.fundedCreateRecovery.value).to.equal(null)
    })
  }

  for (const [field, value] of [
    ['taskId', 'other'], ['fundingStatus', 'HELD'], ['refundTransactionId', ''], ['refundedMicro', '01'], ['remainingMicro', 0], ['taskVersion', '8'], ['fundingVersion', 'x'], ['refundedAt', '-1']
  ]) {
    it(`rejects malformed full CancelReceipt field ${field}`, async () => {
      const task = fundedTask()
      let reads = 0
      const actions = actionsFor({
        tasks: ref([task]), selectedTask: ref(task),
        api: {
          create: async () => success(receipt({ [field]: value })),
          get: async () => { reads += 1; return success(task) }
        }
      })
      expect(await actions.cancelFunding(task)).to.equal(false)
      expect(reads).to.equal(0)
    })
  }

  for (const mode of ['shared-object', 'separate-selected']) {
    it(`does not regress ${mode} newer canonical snapshot during funded cancellation readback`, async () => {
      const task = fundedTask()
      const tasks = ref([task])
      const selectedTask = ref(mode === 'shared-object' ? task : { ...task })
      const pendingRead = deferred()
      const actions = actionsFor({
        tasks, selectedTask,
        api: { create: async () => success(receipt()), get: async () => pendingRead.promise }
      })
      const pending = actions.cancelFunding(task)
      const newerTask = { ...task, taskVersion: '10', status: 'completed' }
      if (mode === 'shared-object') Object.assign(task, newerTask)
      else {
        Object.assign(task, newerTask)
        selectedTask.value = { ...newerTask }
      }
      pendingRead.resolve(success({ id: 'funded', taskVersion: '9', status: 'cancelled', funding: { mode: 'FUNDED_SINGLE_AGENT', status: 'REFUNDED' } }))
      expect(await pending).to.equal(true)
      expect(task).to.include({ taskVersion: '10', status: 'completed' })
      expect(selectedTask.value).to.include({ taskVersion: '10', status: 'completed' })
    })
  }
})
