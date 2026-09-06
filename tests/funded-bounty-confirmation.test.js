import { expect } from 'chai'
import { ref } from 'vue'
import { readFileSync } from 'node:fs'
import { useHallTaskActions } from '../src/composables/juyiting/useHallTaskActions.js'
import { createApi } from '../src/composables/useHttp.js'
import { fundedQuote, fundedReceipt } from './funded-bounty-fixtures.js'

const success = data => ({ data: { code: 'E0', data } })
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const harness = (overrides = {}) => {
  const task = { id: 'funded', title: '资金榜', status: 'open', taskVersion: '8', funding: { mode: 'FUNDED_SINGLE_AGENT' } }
  const agent = { agentId: 'explicit-agent', version: '17', status: 'online' }
  const tasks = ref([task])
  const selectedTask = ref(task)
  const selectedAgent = ref({ agentId: 'hidden-agent' })
  const calls = []
  const events = []
  const previews = []
  const confirmation = deferred()
  const previewReady = deferred()
  const actions = useHallTaskActions({
    agentApi: {
      create: async (url, body, options) => {
        calls.push({ url, body, key: options.headers['Idempotency-Key'] })
        return success(url.endsWith('/quotes') ? fundedQuote() : fundedReceipt())
      },
      get: async url => {
        calls.push({ url })
        return success({ ...task, taskVersion: '9', status: 'assigned', assignedAgentId: agent.agentId })
      }
    },
    canAssign: () => true,
    confirmFundedQuote: async preview => {
      previews.push(preview)
      previewReady.resolve(preview)
      return confirmation.promise
    },
    createIdempotencyKey: (() => { let n = 0; return () => `key-${++n}` })(),
    now: () => 1000,
    tasks, selectedTask, selectedAgent,
    playSuccess: () => events.push('success'), playError: () => events.push('error'),
    showToast: message => events.push(message), log: { warn: () => {} },
    ...overrides
  })
  return { actions, task, agent, tasks, selectedTask, selectedAgent, calls, events, previews, confirmation, previewReady }
}

describe('funded bounty explicit quote confirmation (W05 DTO)', () => {
  it('shows the actual quote before any claim; explicit confirmation reads a canonical TaskDTO', async () => {
    const h = harness()
    const pending = h.actions.assignTask(h.task, h.agent)
    const preview = await h.previewReady.promise
    expect(h.calls.map(item => item.url)).to.deep.equal(['/tasks/funded/quotes'])
    expect(preview.quote).to.deep.equal(fundedQuote())
    expect(preview.quote.estimatedTokens).to.deep.equal({ input: '1000', cachedInput: '200', output: '300', reasoning: '400' })
    expect(h.task.status).to.equal('open')
    expect(await h.actions.assignTask(h.task, h.agent)).to.equal(false)
    h.confirmation.resolve(true)
    expect(await pending).to.equal(true)
    expect(h.calls.map(item => item.url)).to.deep.equal(['/tasks/funded/quotes', '/tasks/funded/claim', '/tasks/funded'])
    expect(h.calls[0].body).to.deep.equal({ agentId: 'explicit-agent', modelPreference: { provider: 'openai', model: 'configured-model' }, contextRevision: '8', minimumAcceptedPayoutMicro: '0' })
    expect(h.calls[1].body).to.deep.equal({ agentId: 'explicit-agent', quoteId: 'q-1', taskVersion: '8', allowQueue: false })
    expect(h.task).to.include({ id: 'funded', taskVersion: '9', status: 'assigned', assignedAgentId: 'explicit-agent' })
    expect(h.task).not.to.have.property('claimedAt')
    expect(h.task).not.to.have.property('quoteId')
    expect(h.selectedAgent.value.agentId).to.equal('hidden-agent')
    expect(h.actions.fundedClaimState.value).to.include({ status: 'confirmed', refreshPending: false })
    expect(await h.actions.assignTask(h.task, h.agent)).to.equal(false)
    expect(h.calls).to.have.length(3)
  })

  it('cancels without sending a claim and fails closed with no confirmation handler', async () => {
    const h = harness()
    const pending = h.actions.assignTask(h.task, h.agent)
    await h.previewReady.promise
    h.confirmation.resolve(false)
    expect(await pending).to.equal(false)
    expect(h.calls.map(item => item.url)).to.deep.equal(['/tasks/funded/quotes'])
    const disabled = harness({ confirmFundedQuote: undefined })
    expect(await disabled.actions.assignTask(disabled.task, disabled.agent)).to.equal(false)
    expect(disabled.calls.map(item => item.url)).to.deep.equal(['/tasks/funded/quotes'])
  })

  for (const change of ['expiry', 'task version', 'agent identity', 'agent version', 'new task snapshot']) {
    it(`requires fresh preview when ${change} changes before explicit confirmation`, async () => {
      let clock = 1000
      const h = harness({ now: () => clock })
      const pending = h.actions.assignTask(h.task, h.agent)
      await h.previewReady.promise
      if (change === 'expiry') clock = 9999999999999
      if (change === 'task version') h.task.taskVersion = '9'
      if (change === 'agent identity') h.agent.agentId = 'other-agent'
      if (change === 'agent version') h.agent.version = '18'
      if (change === 'new task snapshot') h.tasks.value = [{ ...h.task, taskVersion: '9' }]
      h.confirmation.resolve(true)
      expect(await pending).to.equal(false)
      expect(h.calls.map(item => item.url)).to.deep.equal(['/tasks/funded/quotes'])
    })
  }

  for (const mismatch of [
    { taskId: 'other' }, { agentId: 'other' }, { taskVersion: 8 }, { taskVersion: '08' },
    { expiresAt: '1000' }, { estimatedComputeMicro: 10 },
    { estimatedTokens: { input: '1', cachedInput: '01', output: '1', reasoning: '1' } }
  ]) {
    it(`rejects invalid server quote ${JSON.stringify(mismatch)} before showing confirmation`, async () => {
      let confirmed = false
      const h = harness({
        agentApi: { create: async () => success(fundedQuote(mismatch)) },
        confirmFundedQuote: async () => { confirmed = true; return true }
      })
      expect(await h.actions.assignTask(h.task, h.agent)).to.equal(false)
      expect(confirmed).to.equal(false)
    })
  }

  it('discards a quote that arrives after a newer task snapshot instead of prompting for stale terms', async () => {
    const quote = deferred()
    let prompted = false
    const h = harness({ agentApi: { create: async () => quote.promise }, confirmFundedQuote: async () => { prompted = true; return true } })
    const pending = h.actions.assignTask(h.task, h.agent)
    h.tasks.value = [{ ...h.task, taskVersion: '9' }]
    quote.resolve(success(fundedQuote()))
    expect(await pending).to.equal(false)
    expect(prompted).to.equal(false)
  })

  it('keeps a confirmed receipt successful and blocks duplicate mutation when readback fails', async () => {
    let posts = 0
    const h = harness({
      agentApi: {
        create: async url => { posts += 1; return success(url.endsWith('/quotes') ? fundedQuote() : fundedReceipt()) },
        get: async () => { throw new TypeError('snapshot refresh unavailable') }
      }, confirmFundedQuote: async () => true
    })
    expect(await h.actions.assignTask(h.task, h.agent)).to.equal(true)
    expect(h.events.filter(event => event === 'success')).to.have.length(1)
    expect(h.events).not.to.include('error')
    expect(h.actions.fundedClaimState.value).to.include({ status: 'confirmed', refreshPending: true })
    expect(h.task.status).to.equal('open') // no fabricated TaskDTO/receipt assignment
    expect(h.task).not.to.have.property('claimedAt')
    expect(await h.actions.assignTask(h.task, h.agent)).to.equal(false)
    expect(posts).to.equal(2)
  })

  it('retries only canonical readback after a confirmed receipt, with no further POST', async () => {
    let posts = 0
    let failRead = true
    const h = harness({
      agentApi: {
        create: async url => { posts += 1; return success(url.endsWith('/quotes') ? fundedQuote() : fundedReceipt()) },
        get: async () => {
          if (failRead) throw new TypeError('readback unavailable')
          return success({ id: 'funded', taskVersion: '9', status: 'assigned', assignedAgentId: 'explicit-agent' })
        }
      }, confirmFundedQuote: async () => true
    })
    expect(await h.actions.assignTask(h.task, h.agent)).to.equal(true)
    failRead = false
    expect(await h.actions.refreshFundedClaim(h.task)).to.equal(true)
    expect(posts).to.equal(2)
    expect(h.task.status).to.equal('assigned')
    expect(h.actions.fundedClaimState.value.refreshPending).to.equal(false)
  })

  it('fences replacement roster snapshots rather than only the originally clicked Agent object', async () => {
    let current = { agentId: 'explicit-agent', version: '17' }
    const h = harness({ resolveFundedAgent: () => current })
    const pending = h.actions.assignTask(h.task, h.agent)
    await h.previewReady.promise
    current = { agentId: 'explicit-agent', version: '18' }
    h.confirmation.resolve(true)
    expect(await pending).to.equal(false)
    expect(h.calls.map(item => item.url)).to.deep.equal(['/tasks/funded/quotes'])
  })

  it('rechecks current roster eligibility as well as its identity/version before claim', async () => {
    let current = { agentId: 'explicit-agent', version: '17', status: 'online' }
    const h = harness({ resolveFundedAgent: () => current, canAssign: (_task, agent) => agent?.status === 'online' })
    const pending = h.actions.assignTask(h.task, h.agent)
    await h.previewReady.promise
    current = { ...current, status: 'busy' }
    h.confirmation.resolve(true)
    expect(await pending).to.equal(false)
    expect(h.calls.map(item => item.url)).to.deep.equal(['/tasks/funded/quotes'])
  })

  it('retains task A confirmed/pending knowledge after claiming task B and switching back', async () => {
    const posts = []
    const h = harness({
      confirmFundedQuote: async () => true,
      agentApi: {
        create: async (url, body) => {
          posts.push(url)
          const taskId = url.split('/')[2]
          return success(url.endsWith('/quotes') ? fundedQuote({ taskId, quoteId: `q-${taskId}` }) :
            fundedReceipt({ taskId, quoteId: body.quoteId }))
        }, get: async () => { throw new TypeError('readback unavailable') }
      }
    })
    expect(await h.actions.assignTask(h.task, h.agent)).to.equal(true)
    const other = { ...h.task, id: 'task-b' }
    h.tasks.value.push(other)
    h.selectedTask.value = other
    expect(h.actions.fundedClaimState.value).to.equal(null)
    expect(await h.actions.assignTask(other, h.agent)).to.equal(true)
    expect(h.actions.fundedClaimState.value).to.include({ taskId: 'task-b', status: 'confirmed' })
    h.selectedTask.value = h.task
    expect(h.actions.fundedClaimState.value).to.include({ taskId: 'funded', status: 'confirmed', refreshPending: true })
    expect(await h.actions.assignTask(h.task, h.agent)).to.equal(false)
    expect(posts).to.have.length(4)
  })

  it('does not accept an error envelope containing otherwise matching receipt data', async () => {
    const h = harness({
      confirmFundedQuote: async () => true,
      agentApi: { create: async url => url.endsWith('/quotes') ? success(fundedQuote()) :
        { data: { code: 'QUOTE_EXPIRED', msg: 'expired', data: fundedReceipt() } } }
    })
    expect(await h.actions.assignTask(h.task, h.agent)).to.equal(false)
    expect(h.actions.fundedClaimState.value.status).to.equal('rejected')
    expect(h.events).not.to.include('success')
  })

  for (const mismatch of [
    { taskId: 'other' }, { agentId: 'other' }, { quoteId: 'other' }, { status: 'open' },
    { taskVersion: '8' }, { taskVersion: '10' }, { taskVersion: 9 }, { claimedAt: '01' }
  ]) {
    it(`retains the original claim for recovery on invalid receipt ${JSON.stringify(mismatch)}`, async () => {
      let reads = 0
      const h = harness({
        agentApi: {
          create: async url => success(url.endsWith('/quotes') ? fundedQuote() : fundedReceipt(mismatch)),
          get: async () => { reads += 1 }
        }, confirmFundedQuote: async () => true
      })
      expect(await h.actions.assignTask(h.task, h.agent)).to.equal(false)
      expect(h.actions.fundedClaimState.value.status).to.equal('unresolved')
      expect(h.task.status).to.equal('open')
      expect(reads).to.equal(0)
    })
  }

  it('reconfirms and exactly replays an ambiguous claim, never obtaining a replacement quote', async () => {
    const sent = []
    const previews = []
    let clock = 1000
    const h = harness({
      now: () => clock,
      confirmFundedQuote: async preview => { previews.push(preview); return true },
      agentApi: {
        create: async (url, body, options) => {
          sent.push({ url, body, key: options.headers['Idempotency-Key'] })
          if (url.endsWith('/quotes')) return success(fundedQuote())
          if (sent.length === 2) throw new TypeError('response lost after claim')
          return success(fundedReceipt())
        }, get: async () => { throw new Error('readback unavailable') }
      }
    })
    expect(await h.actions.assignTask(h.task, h.agent)).to.equal(false)
    clock = 9999999999999 // expired original: explicit recovery, not a new claim/quote
    expect(await h.actions.assignTask(h.task, h.agent)).to.equal(true)
    expect(sent.map(item => item.url)).to.deep.equal(['/tasks/funded/quotes', '/tasks/funded/claim', '/tasks/funded/claim'])
    expect(sent[2]).to.deep.equal(sent[1])
    expect(previews.map(item => item.recovery)).to.deep.equal([false, true])
    expect(previews[1].quote).to.deep.equal(previews[0].quote)
  })

  for (const phase of ['receipt', 'readback']) {
    it(`does not overwrite a newer snapshot while waiting for ${phase}`, async () => {
      const waiting = deferred()
      const started = deferred()
      const h = harness({
        confirmFundedQuote: async () => true,
        agentApi: {
          create: async url => {
            if (url.endsWith('/quotes')) return success(fundedQuote())
            if (phase === 'receipt') { started.resolve(); return waiting.promise }
            return success(fundedReceipt())
          },
          get: async () => {
            if (phase === 'readback') { started.resolve(); return waiting.promise }
            return success({ id: 'funded', taskVersion: '9', status: 'assigned', assignedAgentId: 'explicit-agent' })
          }
        }
      })
      const pending = h.actions.assignTask(h.task, h.agent)
      await started.promise
      const newer = { ...h.task, taskVersion: '11', status: 'completed' }
      h.tasks.value = [newer]
      h.selectedTask.value = newer
      Object.assign(h.task, newer)
      waiting.resolve(success(phase === 'receipt' ? fundedReceipt() : { id: 'funded', taskVersion: '9', status: 'assigned', assignedAgentId: 'explicit-agent' }))
      expect(await pending).to.equal(true)
      expect(h.tasks.value[0]).to.include({ taskVersion: '11', status: 'completed' })
      expect(h.selectedTask.value).to.include({ taskVersion: '11', status: 'completed' })
      expect(h.task).to.include({ taskVersion: '11', status: 'completed' })
      expect(h.agent.status).to.equal('online')
    })
  }

  it('uses actual useHttp JSON envelope/POST/GET contracts with canonical Long strings', async () => {
    const originalFetch = globalThis.fetch
    const requests = []
    const version = '9007199254740993'
    const nextVersion = '9007199254740994'
    globalThis.fetch = async (url, options) => {
      requests.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : null })
      const data = url.endsWith('/quotes') ? fundedQuote({ taskVersion: version }) : url.endsWith('/claim')
        ? fundedReceipt({ taskVersion: nextVersion })
        : { id: 'funded', status: 'assigned', taskVersion: nextVersion, assignedAgentId: 'explicit-agent' }
      return new Response(JSON.stringify({ code: 'E0', data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    try {
      const api = createApi('/agent')
      const authStore = { authorizationGeneration: 1, token: async () => 'test-only-token' }
      const h = harness({
        confirmFundedQuote: async () => true,
        agentApi: {
          create: (url, body, options) => api.create(url, body, { ...options, authStore }),
          get: (url, params, options) => api.get(url, params, { ...options, authStore })
        }
      })
      h.task.taskVersion = version
      expect(await h.actions.assignTask(h.task, h.agent)).to.equal(true)
      expect(requests.map(item => item.method)).to.deep.equal(['POST', 'POST', 'GET'])
      expect(requests[0].body).to.deep.equal({ agentId: 'explicit-agent', modelPreference: { provider: 'openai', model: 'configured-model' }, contextRevision: version, minimumAcceptedPayoutMicro: '0' })
      expect(requests[1].body.taskVersion).to.equal(version)
      expect(h.task.taskVersion).to.equal(nextVersion)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  for (const definitive of [true, false]) {
    it(`uses actual useHttp claim errors for ${definitive ? 'definitive rejection' : 'ambiguous replay'}`, async () => {
      const originalFetch = globalThis.fetch
      const requests = []
      let failClaim = true
      globalThis.fetch = async (url, options) => {
        requests.push({ url, body: options.body ? JSON.parse(options.body) : null, key: options.headers['Idempotency-Key'] })
        if (url.endsWith('/claim') && failClaim) {
          failClaim = false
          return new Response(JSON.stringify({ code: definitive ? 'QUOTE_EXPIRED' : 'INTERNAL_ERROR', msg: 'claim error' }),
            { status: definitive ? 409 : 503, headers: { 'Content-Type': 'application/json' } })
        }
        const data = url.endsWith('/quotes') ? fundedQuote() : url.endsWith('/claim') ? fundedReceipt() :
          { id: 'funded', status: 'assigned', taskVersion: '9', assignedAgentId: 'explicit-agent' }
        return new Response(JSON.stringify({ code: 'E0', data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      try {
        const api = createApi('/agent')
        const authStore = { authorizationGeneration: 1, token: async () => 'test-only-token' }
        const h = harness({
          confirmFundedQuote: async () => true,
          agentApi: {
            create: (url, body, options) => api.create(url, body, { ...options, authStore }),
            get: (url, params, options) => api.get(url, params, { ...options, authStore })
          }
        })
        expect(await h.actions.assignTask(h.task, h.agent)).to.equal(false)
        expect(h.actions.fundedClaimState.value.status).to.equal(definitive ? 'rejected' : 'unresolved')
        expect(await h.actions.assignTask(h.task, h.agent)).to.equal(true)
        const claims = requests.filter(item => item.url.endsWith('/claim'))
        const quotes = requests.filter(item => item.url.endsWith('/quotes'))
        expect(quotes).to.have.length(definitive ? 2 : 1)
        expect(claims).to.have.length(2)
        if (definitive) expect(claims[1].key).not.to.equal(claims[0].key)
        else expect(claims[1]).to.deep.equal(claims[0])
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  }

  it('wires preview confirmation/cancellation and the nested token DTO into the actual UI', () => {
    const panel = readFileSync(new URL('../src/components/juyiting/BountyPanel.vue', import.meta.url), 'utf8')
    const hall = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
    for (const category of ['input', 'cachedInput', 'output', 'reasoning']) expect(panel).to.include(`fundedQuotePreview.quote.estimatedTokens.${category}`)
    expect(panel).to.include("$emit('confirm-funded-quote')")
    expect(panel).to.include("$emit('cancel-funded-quote')")
    expect(hall).to.include('@confirm-funded-quote="settleFundedQuote(true)"')
    expect(hall).to.include('@cancel-funded-quote="settleFundedQuote(false)"')
    expect(panel).to.include('fundedClaimState.refreshPending')
    expect(panel).not.to.include('取价并领令')
  })
})

describe('funded bounty R5 durable intent and cancellation lifecycle', () => {
  const memoryStorage = () => {
    const records = new Map()
    return { getItem: key => records.get(key) || null, setItem: (key, value) => records.set(key, value), removeItem: key => records.delete(key) }
  }

  it('rejects a quote missing the canonical minimum payout before confirmation', async () => {
    let prompted = false
    const h = harness({
      agentApi: { create: async () => success(fundedQuote({ minimumAcceptedPayoutMicro: undefined })) },
      confirmFundedQuote: async () => { prompted = true; return true }
    })
    expect(await h.actions.assignTask(h.task, h.agent)).to.equal(false)
    expect(prompted).to.equal(false)
  })

  it('persists an unknown funded create across remount, preserves original body/key, and isolates another actor scope', async () => {
    const storage = memoryStorage()
    const requests = []
    const api = {
      create: async (_url, body, options) => {
        requests.push({ body, key: options.headers['Idempotency-Key'] })
        if (requests.length === 1) throw new TypeError('response lost after committed reserve')
        return success({ id: `task-${requests.length}`, ...body })
      }
    }
    const original = { title: 'original funded', grossBountyAmountMicro: '100', settlementPolicy: 'GROSS_INCLUSIVE' }
    const first = harness({ agentApi: api, fundedActorScopeKey: () => 'actor-a', fundedIntentStorage: storage })
    expect(await first.actions.createTask(original)).to.equal(false)
    const otherScope = harness({ agentApi: api, fundedActorScopeKey: () => 'actor-b', fundedIntentStorage: storage })
    expect(await otherScope.actions.createTask({ title: 'other actor', grossBountyAmountMicro: '200', settlementPolicy: 'GROSS_INCLUSIVE' })).to.equal(true)
    const remounted = harness({ agentApi: api, fundedActorScopeKey: () => 'actor-a', fundedIntentStorage: storage })
    expect(await remounted.actions.createTask({ title: 'edited draft', grossBountyAmountMicro: '999', settlementPolicy: 'GROSS_INCLUSIVE' })).to.equal(true)
    expect(requests[2]).to.deep.equal(requests[0])
    expect(requests[2].body).to.deep.equal(original)
    expect(requests[1].body.title).to.equal('other actor')
  })

  it('reports an immutable REFUNDED receipt as confirmed when canonical cancellation readback is unavailable', async () => {
    const h = harness({
      agentApi: {
        create: async () => success({ taskId: 'funded', fundingStatus: 'REFUNDED', refundTransactionId: 'tx-1', refundedMicro: '100', remainingMicro: '0', taskVersion: '9', fundingVersion: '2', refundedAt: '1000' }),
        get: async () => { throw new TypeError('canonical readback unavailable') }
      }
    })
    expect(await h.actions.cancelFunding(h.task)).to.equal(true)
    expect(h.events).to.include('success')
    expect(h.events.join(' ')).to.include('已撤确认')
    expect(h.events.join(' ')).not.to.include('撤榜未成')
  })
  it('keeps a verified REFUNDED receipt confirmed when canonical readback is stale', async () => {
    const h = harness({
      agentApi: {
        create: async () => success({ taskId: 'funded', fundingStatus: 'REFUNDED', refundTransactionId: 'tx-stale', refundedMicro: '100', remainingMicro: '0', taskVersion: '9', fundingVersion: '2', refundedAt: '1000' }),
        get: async () => success({ id: 'funded', taskVersion: '8', status: 'open', funding: { mode: 'FUNDED_SINGLE_AGENT' } })
      }
    })
    expect(await h.actions.cancelFunding(h.task)).to.equal(true)
    expect(h.events).to.include('success')
    expect(h.events.join(' ')).to.include('已撤确认')
  })

})
