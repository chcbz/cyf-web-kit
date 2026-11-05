import { expect } from 'chai'
import { readFileSync } from 'fs'
import { ref } from 'vue'

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


  it('keeps the JuyiHall assignment wrapper fail-closed before delegating to task actions', () => {
    const wrapper = hallSource.match(/const assignTask = async \(task, agent\) => \{([\s\S]*?)\n\}/)?.[1] || ''
    expect(wrapper).to.include('const targetAgents = Array.isArray(agent) ? agent : [agent].filter(Boolean)')
    expect(wrapper).to.include('const hasExplicitAgentId')
    expect(wrapper).to.include('if (!task?.id) return false')
    expect(wrapper).to.include('if (!targetAgents.length || targetAgents.some(item => !hasExplicitAgentId(item))) return false')
    expect(wrapper).to.include("original.state === 'PRESENT' || original.state === 'CORRUPT'")
    expect(wrapper.indexOf("original.state === 'PRESENT' || original.state === 'CORRUPT'")).to.be.lessThan(wrapper.indexOf('const targetAgents = Array.isArray(agent)'))
    expect(wrapper).to.include("if (targetAgents.some(item => !canAssign(task, item))) return false")
    expect(wrapper).to.include('await startPointAndStart({ task, agent: targetAgents[0] })')
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





  it('ordinary selection remains single-agent and goes through quoted point-and-start', () => {
    expect(hallSource).to.include("targetAgents.length !== 1")
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
