import { expect } from 'chai'
import { readFileSync } from 'fs'
import { ref } from 'vue'
import { useHallTaskActions } from '../src/composables/juyiting/useHallTaskActions.js'

const walletSource = readFileSync(new URL('../src/components/Wallet.vue', import.meta.url), 'utf8')
const bountySource = readFileSync(new URL('../src/components/juyiting/BountyPanel.vue', import.meta.url), 'utf8')
const hallSource = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
const httpSource = readFileSync(new URL('../src/composables/useHttp.js', import.meta.url), 'utf8')

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
    expect(bountySource).to.include("settlementPolicy = 'GROSS_INCLUSIVE'")
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
