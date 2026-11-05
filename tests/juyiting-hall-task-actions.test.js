import { expect } from 'chai'
import { readFileSync } from 'fs'
import { ref } from 'vue'
import { fundedQuote, fundedReceipt } from './funded-bounty-fixtures.js'

import { useHallData } from '../src/composables/juyiting/useHallData.js'
import { useHallTaskActions } from '../src/composables/juyiting/useHallTaskActions.js'

const hallSource = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')

const createHarness = (response, { canAssign = () => true } = {}) => {
  const apiCalls = []
  const toasts = []
  const calls = { error: 0, success: 0 }
  const tasks = ref([])
  const selectedAgent = ref(null)
  const selectedTask = ref(null)
  const agentApi = {
    create: async (url, payload, options) => {
      apiCalls.push({ payload, url })
      if (response.code !== 'E0') throw Object.assign(new Error(response.msg), { code: response.code, status: response.status })
      const data = response.data ?? null
      options.onSuccess?.(data)
      return data
    }
  }

  const actions = useHallTaskActions({
    agentApi,
    canAssign,
    log: { warn: () => {} },
    playError: () => { calls.error += 1 },
    playSuccess: () => { calls.success += 1 },
    selectedAgent,
    selectedTask,
    showToast: message => toasts.push(message),
    tasks
  })

  return { actions, apiCalls, calls, selectedAgent, selectedTask, toasts, tasks }
}

const createHallData = (selectedAgent, options = {}) => useHallData({
  agentApi: options.agentApi || {},
  log: { warn: () => {} },
  normalizeStatus: (status = '') => status.toLowerCase(),
  selectedAgent,
  selectedTask: options.selectedTask || ref(null),
  taskAgentMatchScore: () => 0
})

describe('useHallTaskActions', () => {
  it('fails closed instead of using selectedAgent when the explicit assignment target is missing or invalid', async () => {
    const harness = createHarness({ code: 'E0' })
    const hiddenSelection = { agentId: 'hidden-agent', name: 'Hidden', status: 'online' }
    harness.selectedAgent.value = hiddenSelection

    const attempts = [
      agent => harness.actions.assignTask({ id: 'task-omitted', title: 'Omitted', status: 'open' }),
      agent => harness.actions.assignTask({ id: 'task-undefined', title: 'Undefined', status: 'open' }, undefined),
      agent => harness.actions.assignTask({ id: 'task-null', title: 'Null', status: 'open' }, null),
      agent => harness.actions.assignTask({ id: 'task-object', title: 'Object', status: 'open' }, {}),
      agent => harness.actions.assignTask({ id: 'task-empty-id', title: 'Empty', status: 'open' }, { agentId: '', status: 'online' }),
      agent => harness.actions.assignTask({ id: 'task-blank-id', title: 'Blank', status: 'open' }, { agentId: '   ', status: 'online' }),
      agent => harness.actions.assignTask({ id: 'task-empty-array', title: 'Empty array', status: 'open' }, []),
      agent => harness.actions.assignTask({ id: 'task-invalid-array', title: 'Invalid array', status: 'open' }, [agent, {}]),
      agent => harness.actions.assignTask(null, agent),
      agent => harness.actions.assignTask({ title: 'Missing task id', status: 'open' }, agent)
    ]

    for (const attempt of attempts) {
      expect(await attempt(hiddenSelection)).to.equal(false)
    }

    expect(harness.apiCalls).to.deep.equal([])
    expect(harness.selectedAgent.value.agentId).to.equal(hiddenSelection.agentId)
    expect(harness.selectedTask.value).to.equal(null)
    expect(harness.calls).to.deep.equal({ error: 0, success: 0 })
    expect(harness.toasts).to.deep.equal([])
  })

  it('keeps the JuyiHall assignment wrapper fail-closed before delegating to task actions', () => {
    const wrapper = hallSource.match(/const assignTask = async \(task, agent\) => \{([\s\S]*?)\n\}/)?.[1] || ''
    expect(wrapper).to.include('const targetAgents = Array.isArray(agent) ? agent : [agent].filter(Boolean)')
    expect(wrapper).to.include('const hasExplicitAgentId')
    expect(wrapper).to.include('if (!task?.id) return false')
    expect(wrapper).to.include('if (!targetAgents.length || targetAgents.some(item => !hasExplicitAgentId(item))) return false')
    expect(wrapper).to.include("original.state === 'PRESENT' || original.state === 'CORRUPT'")
    expect(wrapper.indexOf("original.state === 'PRESENT' || original.state === 'CORRUPT'")).to.be.lessThan(wrapper.indexOf('const targetAgents = Array.isArray(agent)'))
    expect(wrapper).to.include("if (task.funding?.mode !== 'FUNDED_SINGLE_AGENT' && targetAgents.some(item => !canAssign(task, item))) return false")
    expect(wrapper).to.include('await runAssignTask(task, agent)')
    expect(wrapper).not.to.include('selectedAgent.value')
  })

  it('requires an explicit server-eligible agent id even when selectedAgent is populated', async () => {
    const selectedAgent = ref({ agentId: 'hidden-agent', status: 'online' })
    const task = { id: 'task-a', status: 'open' }
    const { canAssign, loadAssigneeCandidates } = createHallData(selectedAgent, { selectedTask: ref(task), agentApi: { get: async () => ({ items: [{ agentId: 'explicit-agent', displayName: 'Explicit', providerDisplayName: null, isMine: true, availability: 'online' }], nextAfterAgentId: null }) } })
    expect(canAssign(task, { agentId: 'explicit-agent' })).to.equal(false)
    expect(await loadAssigneeCandidates()).to.equal(true)

    expect(canAssign(task)).to.equal(false)
    expect(canAssign(task, undefined)).to.equal(false)
    expect(canAssign(task, null)).to.equal(false)
    expect(canAssign(task, {})).to.equal(false)
    expect(canAssign(task, { agentId: '', status: 'online' })).to.equal(false)
    expect(canAssign(task, { agentId: '   ', status: 'online' })).to.equal(false)
    expect(canAssign(task, { agentId: 'explicit-agent', status: 'online' })).to.equal(true)
    expect(selectedAgent.value.agentId).to.equal('hidden-agent')
  })

  it('does not send unquoted ordinary assignments or fabricate local success', async () => {
    const harness = createHarness({ code: 'E0', data: { status: 'assigned' } })
    const task = { id: 'ordinary', status: 'open' }
    const agents = [{ agentId: 'a', status: 'online' }, { agentId: 'b', status: 'online' }]
    for (const target of [agents[0], agents]) expect(await harness.actions.assignTask(task, target)).to.equal(false)
    expect(harness.apiCalls).to.deep.equal([])
    expect(task.status).to.equal('open')
    expect(agents.map(a => a.status)).to.deep.equal(['online', 'online'])
    expect(harness.calls).to.deep.equal({ error: 0, success: 0 })
    expect(harness.actions).not.to.have.property('autoAssignTask')
  })

  it('routes a funded task through an explicit quote and claim instead of legacy assignment', async () => {
    const apiCalls = []
    const funded = { id: 'funded', title: '资金榜', status: 'open', version: '8', funding: { mode: 'FUNDED_SINGLE_AGENT', remainingWen: '100' } }
    const agent = { agentId: 'explicit-agent', name: '显式好汉', status: 'online' }
    const selectedAgent = ref({ agentId: 'hidden-agent', status: 'online' })
    const selectedTask = ref(null)
    const actions = useHallTaskActions({
      agentApi: { create: async (url, payload) => { apiCalls.push({ url, payload }); return url.endsWith('/quotes') ? fundedQuote({ quoteId: 'q1' }) : fundedReceipt({ quoteId: 'q1' }) } },
      canAssign: () => true, confirmFundedQuote: async () => true, createIdempotencyKey: () => 'idem', log: { warn: () => {} }, playError: () => {}, playSuccess: () => {}, selectedAgent, selectedTask, showToast: () => {}, tasks: ref([funded])
    })
    expect(await actions.assignTask(funded, agent)).to.equal(true)
    expect(apiCalls.map(call => call.url)).to.deep.equal(['/tasks/funded/quotes', '/tasks/funded/claim'])
    expect(selectedAgent.value.agentId).to.equal('hidden-agent')
    expect(actions.fundedClaimState.value).to.include({ status: 'confirmed', refreshPending: true })
  })

  it('ordinary selection remains single-agent and goes through quoted point-and-start', () => {
    expect(hallSource).to.include("task.funding?.mode !== 'FUNDED_SINGLE_AGENT' && targetAgents.length !== 1")
    expect(hallSource).to.include('await startPointAndStart({ task, agent: targetAgents[0] })')
    for (const path of ['../src/stores/agent.js', '../src/components/juyiting/RewardBoard.vue', '../src/composables/juyiting/useHallTaskActions.js']) {
      const source = readFileSync(new URL(path, import.meta.url), 'utf8')
      expect(source).not.to.match(/\/auto-assign|\/assign`/)
    }
    const panel = readFileSync(new URL('../src/components/juyiting/BountyPanel.vue', import.meta.url), 'utf8')
    expect(panel).not.to.include('auto-assign-task')
    expect(panel).not.to.include('assign-selected-agents')
  })
})
