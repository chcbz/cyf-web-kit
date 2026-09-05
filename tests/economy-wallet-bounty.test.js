import { expect } from 'chai'
import { readFileSync } from 'fs'
import { ref } from 'vue'
import { useHallTaskActions } from '../src/composables/juyiting/useHallTaskActions.js'
import { createApi } from '../src/composables/useHttp.js'

const walletSource = readFileSync(new URL('../src/components/Wallet.vue', import.meta.url), 'utf8')
const bountySource = readFileSync(new URL('../src/components/juyiting/BountyPanel.vue', import.meta.url), 'utf8')
const hallSource = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
const httpSource = readFileSync(new URL('../src/composables/useHttp.js', import.meta.url), 'utf8')
const skillMarketRouteSource = readFileSync(new URL('../src/components/economy/SkillMarketRoute.vue', import.meta.url), 'utf8')

describe('economy preview wallet and funded bounty integration', () => {
  it('keeps wallet presentation default-off and formats canonical amounts without number money conversion', () => {
    expect(walletSource).to.include("isEconomyPreviewBuildEnabled(import.meta.env.VITE_ECONOMY_PREVIEW_ENABLED)")
    expect(walletSource).to.include("economyApi.get('/wallet'")
    expect(walletSource).to.include("economyApi.get('/ledger', { limit: '50' }")
    expect(walletSource).to.include('formatSilverMicro')
    expect(walletSource).not.to.match(/parseFloat\(|Number\(wallet\.(availableMicro|heldMicro)/)
    expect(httpSource).to.include("export const economyApi = createApi('/economy')")
  })

  it('layers funded controls onto the legacy bounty board and leaves its explicit-agent event intact', () => {
    expect(bountySource).to.include('fundedPreviewEnabled')
    expect(bountySource).to.include('grossBountyAmountMicro')
    expect(bountySource).to.include("payload.settlementPolicy = 'GROSS_INCLUSIVE'")
    expect(bountySource).to.include("$emit('assign-task', detailTask, agent)")
    expect(bountySource).to.include("$emit('cancel-funding', detailTask)")
    expect(bountySource).to.include("$emit('load-settlement', detailTask)")
    expect(bountySource).to.include('isFundedTask(detailTask) || !selectedAssignees.length')
    expect(bountySource).to.include("detailTask.quote.priceBookVersion")
    expect(hallSource).to.include(':funded-preview-enabled="economyPreviewEnabled"')
    expect(hallSource).to.not.include('/agent/active')
  })

  it('quotes then claims a funded task for the clicked explicit agent without legacy assign or hidden selection', async () => {
    const calls = []
    const task = { id: 'funded-1', title: 'Funded', status: 'open', version: '8', funding: { mode: 'FUNDED_SINGLE_AGENT', remainingMicro: '1000000000' } }
    const clickedAgent = { agentId: 'clicked-agent', name: 'Clicked', status: 'online' }
    const hiddenAgent = ref({ agentId: 'hidden-agent', name: 'Hidden', status: 'online' })
    const selectedTask = ref(null)
    const agentApi = {
      create: async (url, payload, options = {}) => {
        calls.push({ url, payload, options })
        if (url.endsWith('/quotes')) return { data: { code: 'E0', data: { quoteId: 'q-1', agentId: 'clicked-agent', taskVersion: '8', priceBookVersion: 'pb-1' } } }
        if (url.endsWith('/claim')) return { data: { code: 'E0', data: { id: 'funded-1', status: 'assigned', assignedAgentId: 'clicked-agent', assignedAgentIds: ['clicked-agent'] } } }
        throw new Error(`unexpected ${url}`)
      },
      get: async () => ({ data: { code: 'E0', data: { status: 'COMPLETED', refundMicro: '1' } } })
    }
    const actions = useHallTaskActions({
      agentApi, canAssign: () => true, createIdempotencyKey: () => 'idem-1', log: { warn: () => {} }, playError: () => {}, playSuccess: () => {}, selectedAgent: hiddenAgent, selectedTask, showToast: () => {}, tasks: ref([task])
    })

    expect(await actions.assignTask(task, clickedAgent)).to.equal(true)
    expect(calls.map(call => call.url)).to.deep.equal(['/tasks/funded-1/quotes', '/tasks/funded-1/claim'])
    expect(calls[0].payload).to.deep.equal({ agentId: 'clicked-agent', taskVersion: '8' })
    expect(calls[1].payload).to.deep.equal({ agentId: 'clicked-agent', quoteId: 'q-1', taskVersion: '8', allowQueue: false })
    expect(calls.every(call => call.options.headers['Idempotency-Key'] === 'idem-1')).to.equal(true)
    expect(calls.some(call => call.url.endsWith('/assign'))).to.equal(false)
    expect(hiddenAgent.value.agentId).to.equal(clickedAgent.agentId)
    expect(selectedTask.value.id).to.equal(task.id)
  })

  it('blocks funded groups and uses frozen cancel and settlement routes', async () => {
    const calls = []
    const task = { id: 'funded-2', title: 'Funded', status: 'open', version: '9', funding: { mode: 'FUNDED_SINGLE_AGENT', remainingMicro: '10' } }
    const actions = useHallTaskActions({
      agentApi: {
        create: async (url, payload, options = {}) => { calls.push({ url, payload, options }); return { data: { code: 'E0', data: { ...task, funding: { ...task.funding, status: 'CANCELLED' } } } } },
        get: async url => { calls.push({ url }); return { data: { code: 'E0', data: { status: 'CANCELLED', refundMicro: '10' } } } }
      }, canAssign: () => true, createIdempotencyKey: () => 'idem-2', log: { warn: () => {} }, playError: () => {}, playSuccess: () => {}, selectedAgent: ref(null), selectedTask: ref(null), showToast: () => {}, tasks: ref([task])
    })
    expect(await actions.assignTask(task, [{ agentId: 'a' }, { agentId: 'b' }])).to.equal(false)
    expect(calls).to.deep.equal([])
    expect((await actions.loadSettlement(task)).refundMicro).to.equal('10')
    expect(await actions.cancelFunding(task)).to.equal(true)
    expect(calls.map(call => call.url)).to.deep.equal(['/tasks/funded-2/settlement', '/tasks/funded-2/funding/cancel'])
    expect(calls[1].payload).to.deep.equal({ expectedTaskVersion: '9' })
  })
})

describe('funded bounty remediation', () => {
  const fundedTask = (id = 'funded-remediation') => ({
    id,
    title: 'Funded',
    status: 'open',
    version: '8',
    funding: { mode: 'FUNDED_SINGLE_AGENT', remainingMicro: '100' }
  })
  const actionOptions = (agentApi, overrides = {}) => ({
    agentApi,
    canAssign: () => true,
    createIdempotencyKey: (() => { let sequence = 0; return () => `idem-${++sequence}` })(),
    log: { warn: () => {} },
    playError: () => {},
    playSuccess: () => {},
    selectedAgent: ref(null),
    selectedTask: ref(null),
    showToast: () => {},
    tasks: ref([]),
    ...overrides
  })

  it('rejects funded claim and cancel JsonResult bodies without optimistic task mutation', async () => {
    const task = fundedTask()
    const agent = { agentId: 'agent-explicit', name: 'Explicit', status: 'online' }
    const successEvents = []
    const toast = []
    const actions = useHallTaskActions(actionOptions({
      create: async (url) => url.endsWith('/quotes')
        ? { data: { code: 'QUOTE_EXPIRED', msg: '报价已过期' } }
        : { data: { code: 'CANCEL_NOT_ALLOWED', msg: '已开工' } },
      get: async () => ({ data: { code: 'E0', data: {} } })
    }, {
      playSuccess: () => successEvents.push('success'),
      showToast: message => toast.push(message),
      tasks: ref([task])
    }))

    expect(await actions.assignTask(task, agent)).to.equal(false)
    expect(task.status).to.equal('open')
    expect(agent.status).to.equal('online')
    expect(await actions.cancelFunding(task)).to.equal(false)
    expect(task.funding.status).to.equal(undefined)
    expect(successEvents).to.deep.equal([])
    expect(toast.join(' ')).to.include('报价已过期')
    expect(toast.join(' ')).to.include('已开工')
  })

  it('reuses funded create, quote, claim, and cancel keys after ambiguous transport failures', async () => {
    const createKeys = []
    let createAttempts = 0
    const createActions = useHallTaskActions(actionOptions({
      create: async (_url, _payload, options) => {
        createKeys.push(options.headers['Idempotency-Key'])
        if (++createAttempts === 1) throw new TypeError('response lost')
        return { data: { code: 'E0', data: { id: 'created', title: 'Created' } } }
      }
    }))
    const createPayload = { title: 'Created', grossBountyAmountMicro: '100', settlementPolicy: 'GROSS_INCLUSIVE' }
    expect(await createActions.createTask(createPayload)).to.equal(false)
    expect(await createActions.createTask(createPayload)).to.equal(true)
    expect(createKeys).to.deep.equal(['idem-1', 'idem-1'])

    const task = fundedTask('funded-retry')
    const agent = { agentId: 'agent-explicit', name: 'Explicit', status: 'online' }
    const quoteKeys = []
    let quoteAttempts = 0
    const quoteActions = useHallTaskActions(actionOptions({
      create: async (url, _payload, options) => {
        if (url.endsWith('/quotes')) {
          quoteKeys.push(options.headers['Idempotency-Key'])
          if (++quoteAttempts === 1) throw new TypeError('quote response lost')
          return { data: { code: 'E0', data: { quoteId: 'q-retry', agentId: agent.agentId, taskVersion: '8' } } }
        }
        return { data: { code: 'E0', data: { ...task, status: 'assigned' } } }
      }
    }))
    expect(await quoteActions.assignTask(task, agent)).to.equal(false)
    expect(await quoteActions.assignTask(task, agent)).to.equal(true)
    expect(quoteKeys).to.deep.equal(['idem-1', 'idem-1'])

    const claimTask = fundedTask('funded-claim-retry')
    const claimKeys = []
    let claimAttempts = 0
    const claimActions = useHallTaskActions(actionOptions({
      create: async (url, _payload, options) => {
        if (url.endsWith('/quotes')) return { data: { code: 'E0', data: { quoteId: 'q-claim', agentId: agent.agentId, taskVersion: '8' } } }
        claimKeys.push(options.headers['Idempotency-Key'])
        if (++claimAttempts === 1) throw new TypeError('claim response lost')
        return { data: { code: 'E0', data: { ...claimTask, status: 'assigned' } } }
      }
    }))
    expect(await claimActions.assignTask(claimTask, agent)).to.equal(false)
    expect(await claimActions.assignTask(claimTask, agent)).to.equal(true)
    expect(claimKeys).to.deep.equal(['idem-2', 'idem-2'])

    const cancelTask = fundedTask('funded-cancel-retry')
    const cancelKeys = []
    let cancelAttempts = 0
    const cancelActions = useHallTaskActions(actionOptions({
      create: async (_url, _payload, options) => {
        cancelKeys.push(options.headers['Idempotency-Key'])
        if (++cancelAttempts === 1) throw new TypeError('cancel response lost')
        return { data: { code: 'E0', data: { ...cancelTask, funding: { ...cancelTask.funding, status: 'CANCELLED' } } } }
      }
    }))
    expect(await cancelActions.cancelFunding(cancelTask)).to.equal(false)
    expect(await cancelActions.cancelFunding(cancelTask)).to.equal(true)
    expect(cancelKeys).to.deep.equal(['idem-1', 'idem-1'])
  })

  it('keeps funded form state pending and gates skill market discovery and direct routing by the server capability', () => {
    const profileSource = readFileSync(new URL('../src/components/UserProfile.vue', import.meta.url), 'utf8')
    const routerSource = readFileSync(new URL('../src/router/index.js', import.meta.url), 'utf8')
    expect(bountySource).to.include("emit('create-task', payload, (created) =>")
    expect(bountySource).to.include('createPending.value = true')
    expect(bountySource).to.include('Reset only after the parent receives a definitive success acknowledgement')
    expect(walletSource).to.include('const epochMillis = BigInt(value)')
    expect(walletSource).to.include('MAX_ECMASCRIPT_EPOCH_MILLIS')
    expect(profileSource).to.include('v-if="economyPreviewAvailable"')
    expect(profileSource).to.include('fetchEconomyPreviewCapability')
    expect(profileSource).not.to.include("economyApi.get('/wallet'")
    expect(routerSource).to.include("path: '/skill-market'")
    expect(routerSource).to.include("import('@/components/economy/SkillMarketRoute.vue')")
    expect(skillMarketRouteSource).to.include("agentApi.get('/roster'")
    expect(skillMarketRouteSource).to.include('principalScopeFingerprint')
    expect(routerSource).to.include('beforeEnter: economyPreviewRouteGuard')
    expect(routerSource).to.include("return { name: 'UserProfile' }")
  })

  it('classifies actual useHttp 409 error shapes by documented code while retaining ambiguous replay keys', async () => {
    const actualHttpError = async (status, code) => {
      const originalFetch = globalThis.fetch
      globalThis.fetch = async () => new Response(JSON.stringify({ code, msg: code }), {
        status,
        headers: { 'Content-Type': 'application/json' }
      })
      try {
        await createApi('/agent').post('/tasks', {}, { autoLoading: false, needAuth: false })
      } catch (error) {
        return error
      } finally {
        globalThis.fetch = originalFetch
      }
      throw new Error('expected HTTP failure')
    }
    const conflict = await actualHttpError(409, 'IDEMPOTENCY_CONFLICT')
    const insufficient = await actualHttpError(409, 'INSUFFICIENT_SILVER')
    expect(conflict).to.include({ status: 409, code: 'IDEMPOTENCY_CONFLICT' })
    expect(conflict.response).to.be.instanceOf(Response)

    const keys = []
    const actions = useHallTaskActions(actionOptions({
      create: async (_url, _payload, options) => {
        keys.push(options.headers['Idempotency-Key'])
        if (keys.length === 1) throw conflict
        if (keys.length === 2) throw insufficient
        throw new TypeError('response dropped after send')
      }
    }))
    const payload = { title: 'HTTP shape', grossBountyAmountMicro: '1', settlementPolicy: 'GROSS_INCLUSIVE' }
    expect(await actions.createTask(payload)).to.equal(false)
    expect(await actions.createTask(payload)).to.equal(false)
    expect(await actions.createTask(payload)).to.equal(false)
    expect(keys).to.deep.equal(['idem-1', 'idem-2', 'idem-3'])
    expect(await actions.createTask(payload)).to.equal(false)
    expect(keys).to.deep.equal(['idem-1', 'idem-2', 'idem-3', 'idem-3'])
  })

  it('rejects numeric or noncanonical funded task/quote versions before a money mutation', async () => {
    const calls = []
    const actions = useHallTaskActions(actionOptions({
      create: async (...args) => { calls.push(args); return { data: { code: 'E0', data: {} } } }
    }))
    const agent = { agentId: 'agent-explicit' }
    expect(await actions.assignTask({ ...fundedTask('unsafe'), version: 9007199254740993 }, agent)).to.equal(false)
    expect(await actions.assignTask({ ...fundedTask('leading-zero'), version: '08' }, agent)).to.equal(false)
    expect(calls).to.deep.equal([])
  })

})
