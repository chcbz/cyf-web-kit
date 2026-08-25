import { expect } from 'chai'
import { readFileSync } from 'fs'
import { customRef, nextTick, ref } from 'vue'
import { useTaskWorkspaceBinding } from '../src/composables/juyiting/useTaskWorkspaceBinding.js'

const hallSource = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const hallDataSource = readFileSync(new URL('../src/composables/juyiting/useHallData.js', import.meta.url), 'utf8')
const hallTaskActionsSource = readFileSync(new URL('../src/composables/juyiting/useHallTaskActions.js', import.meta.url), 'utf8')

function workspaceDouble () {
  const calls = []
  return {
    calls,
    close: () => calls.push({ type: 'close' }),
    dispose: () => calls.push({ type: 'dispose' }),
    open: ({ taskId, actorAgentId }) => {
      calls.push({ type: 'open', taskId, actorAgentId })
      return Promise.resolve()
    }
  }
}

function substitutedRef (substitute) {
  let value = null
  return customRef((track, trigger) => ({
    get () {
      track()
      return value
    },
    set (next) {
      value = substitute(next)
      trigger()
    }
  }))
}

function bindingHarness ({ selectedAgent = ref(null) } = {}) {
  const selectedTask = ref(null)
  const taskWorkspace = workspaceDouble()
  const binding = useTaskWorkspaceBinding({ selectedTask, selectedAgent, taskWorkspace })
  return { binding, selectedAgent, selectedTask, taskWorkspace }
}

const openCalls = workspace => workspace.calls.filter(call => call.type === 'open')

// This models useHallChatContext's non-mentionable private-chat path without changing it:
// it clears selectedAgent and then installs its roster-first fallback in the same tick.
const fallBackToRoster = (selectedAgent, fallback) => {
  selectedAgent.value = null
  selectedAgent.value = fallback
}

describe('C07A task workspace wiring', () => {
  it('uses the C06 workspace as the sole stable FE2 entrypoint with explicit actor provenance', () => {
    expect(hallSource).to.include("import { useTaskWorkspace } from '@/composables/juyiting/useTaskWorkspace'")
    expect(hallSource).to.include("import { useTaskWorkspaceBinding } from '@/composables/juyiting/useTaskWorkspaceBinding'")
    expect(hallSource).to.include('const taskWorkspace = taskWorkspaceEnabled ? useTaskWorkspace() : null')
    expect(hallSource).to.include('? useTaskWorkspaceBinding({ selectedTask, selectedAgent, taskWorkspace })')
    expect(hallSource).to.include('taskWorkspace.workspace, connectionState, error, subject, retry, and reload')
    expect(hallSource).to.include("import TaskWorkspacePanel from '@/components/juyiting/TaskWorkspacePanel.vue'")
  })

  it('opens only for an atomically selected map actor and ignores same-id object replacement', async () => {
    const { binding, selectedAgent, selectedTask, taskWorkspace } = bindingHarness()
    try {
      const agent = { agentId: 'map-agent-a', name: 'A' }
      selectedTask.value = { id: 'task-a', title: 'A' }
      binding.selectExplicitActor(agent)
      await nextTick()
      selectedTask.value = { id: 'task-a', title: 'replacement' }
      selectedAgent.value = { agentId: 'map-agent-a', name: 'replacement' }
      await nextTick()
      expect(openCalls(taskWorkspace)).to.deep.equal([{ type: 'open', taskId: 'task-a', actorAgentId: 'map-agent-a' }])
    } finally {
      binding.dispose()
    }
  })

  it('cannot arm a mismatched selection, even if an implicit later return has the requested id', async () => {
    const selectedAgent = substitutedRef(agent => agent?.agentId === 'requested-agent'
      ? { agentId: 'roster-fallback' }
      : agent)
    const { binding, selectedTask, taskWorkspace } = bindingHarness({ selectedAgent })
    try {
      selectedTask.value = { id: 'task-a' }
      binding.selectExplicitActor({ agentId: 'requested-agent' })
      await nextTick()
      expect(binding.explicitActorAgentId.value).to.equal(null)
      selectedAgent.value = { agentId: 'requested-agent' }
      await nextTick()
      expect(binding.explicitActorAgentId.value).to.equal(null)
      expect(openCalls(taskWorkspace)).to.deep.equal([])
    } finally {
      binding.dispose()
    }
  })

  it('clears provenance synchronously so null-to-roster fallback cannot reopen a workspace', async () => {
    const { binding, selectedAgent, selectedTask, taskWorkspace } = bindingHarness()
    try {
      const explicit = { agentId: 'agent-a' }
      selectedTask.value = { id: 'task-a' }
      binding.selectExplicitActor(explicit)
      await nextTick()
      fallBackToRoster(selectedAgent, { agentId: 'agent-a', name: 'roster fallback' })
      await nextTick()
      expect(binding.explicitActorAgentId.value).to.equal(null)
      expect(openCalls(taskWorkspace)).to.have.length(1)
      expect(taskWorkspace.calls.at(-1)).to.deep.equal({ type: 'close' })

      selectedAgent.value = { agentId: 'agent-b', name: 'different roster fallback' }
      await nextTick()
      expect(openCalls(taskWorkspace)).to.have.length(1)
      expect(taskWorkspace.calls.at(-1)).to.deep.equal({ type: 'close' })
    } finally {
      binding.dispose()
    }
  })

  it('clears a valid conversation provenance when its chat flow falls back from a non-mentionable actor', async () => {
    const { binding, selectedAgent, selectedTask, taskWorkspace } = bindingHarness()
    try {
      selectedTask.value = { id: 'task-a' }
      binding.selectExplicitActor({ agentId: 'non-mentionable' })
      fallBackToRoster(selectedAgent, { agentId: 'roster-agent' })
      await nextTick()
      expect(binding.explicitActorAgentId.value).to.equal(null)
      expect(openCalls(taskWorkspace)).to.deep.equal([])
    } finally {
      binding.dispose()
    }
  })

  it('clears before a failed assignment and never re-arms from a late assignment completion', async () => {
    const { binding, selectedAgent, selectedTask, taskWorkspace } = bindingHarness()
    try {
      selectedTask.value = { id: 'task-a' }
      binding.selectExplicitActor({ agentId: 'old-actor' })
      await nextTick()

      // Assignment starts: even a swallowed failure leaves no authorization token behind.
      binding.clearExplicitActor()
      await nextTick()
      expect(binding.explicitActorAgentId.value).to.equal(null)
      expect(openCalls(taskWorkspace)).to.have.length(1)

      // The user makes a fresh explicit U/C selection before an older assignment resolves.
      selectedTask.value = { id: 'task-u' }
      binding.selectExplicitActor({ agentId: 'user-c' })
      await nextTick()
      fallBackToRoster(selectedAgent, { agentId: 'assignment-c' })
      selectedTask.value = { id: 'task-a' }
      await nextTick()

      expect(binding.explicitActorAgentId.value).to.equal(null)
      expect(openCalls(taskWorkspace)).to.deep.equal([
        { type: 'open', taskId: 'task-a', actorAgentId: 'old-actor' },
        { type: 'open', taskId: 'task-u', actorAgentId: 'user-c' }
      ])
    } finally {
      binding.dispose()
    }
  })

  it('cannot reuse a cleared token when a multi-assignment later selects its same first agent id', async () => {
    const { binding, selectedAgent, selectedTask, taskWorkspace } = bindingHarness()
    try {
      selectedTask.value = { id: 'task-a' }
      binding.selectExplicitActor({ agentId: 'first-agent' })
      await nextTick()
      binding.clearExplicitActor()
      selectedAgent.value = { agentId: 'first-agent', name: 'assignment first target' }
      await nextTick()
      expect(binding.explicitActorAgentId.value).to.equal(null)
      expect(openCalls(taskWorkspace)).to.deep.equal([{ type: 'open', taskId: 'task-a', actorAgentId: 'first-agent' }])
    } finally {
      binding.dispose()
    }
  })

  it('supports direct selection and a valid conversation selection as the only ways to open', async () => {
    const { binding, selectedTask, taskWorkspace } = bindingHarness()
    try {
      selectedTask.value = { id: 'task-a' }
      binding.selectExplicitActor({ agentId: 'direct-agent' })
      await nextTick()
      selectedTask.value = { id: 'task-b' }
      binding.selectExplicitActor({ agentId: 'conversation-agent' })
      await nextTick()
      expect(openCalls(taskWorkspace)).to.deep.equal([
        { type: 'open', taskId: 'task-a', actorAgentId: 'direct-agent' },
        { type: 'open', taskId: 'task-b', actorAgentId: 'conversation-agent' }
      ])
    } finally {
      binding.dispose()
    }
  })

  it('uses atomic explicit JuyiHall action inputs, never brief/default or assignment completion, and disposes the real binding on unmount', () => {
    const selectAgentSource = hallSource.slice(hallSource.indexOf('const selectAgent'), hallSource.indexOf('const openPanel'))
    const briefSource = hallSource.slice(hallSource.indexOf('const briefSelectedTask'), hallSource.indexOf('const discussTask'))
    const assignTaskSource = hallSource.slice(hallSource.indexOf('const assignTask'), hallSource.indexOf('const autoAssignTask'))
    const autoAssignTaskSource = hallSource.slice(hallSource.indexOf('const autoAssignTask'), hallSource.indexOf('const archiveTask'))
    const conversationSource = hallSource.slice(hallSource.indexOf('const handleStartAgentConversation'), hallSource.indexOf('const canStartAgentConversation'))
    expect(selectAgentSource).to.include('taskWorkspaceBinding.selectExplicitActor(agent)')
    expect(selectAgentSource).not.to.include('selectedAgent.value = agent')
    expect(briefSource).not.to.include('taskWorkspaceBinding.')
    expect(assignTaskSource.indexOf('taskWorkspaceBinding.clearExplicitActor()')).to.be.lessThan(assignTaskSource.indexOf('await runAssignTask(task, agent)'))
    expect(assignTaskSource).not.to.include('selectExplicitActor')
    expect(assignTaskSource).not.to.include('markExplicitActor')
    expect(autoAssignTaskSource).not.to.include('ExplicitActor')
    expect(conversationSource.indexOf('taskWorkspaceBinding.selectExplicitActor(agent)')).to.be.lessThan(conversationSource.indexOf('enterPrivateConversation(agent)'))
    expect(conversationSource).not.to.include('markExplicitActor')
    expect(hallSource).to.match(/onUnmounted\(\(\) => \{\n\s*taskWorkspaceBinding\.dispose\(\)/)

    const { binding, taskWorkspace } = bindingHarness()
    binding.dispose()
    expect(taskWorkspace.calls.at(-1)).to.deep.equal({ type: 'dispose' })
  })

  it('preserves map/roster separation, no active route, and explicit assignment target handling', () => {
    expect(hallDataSource).to.include("agentApi.get('/map'")
    expect(hallDataSource).to.include("agentApi.search('/roster'")
    expect(hallDataSource).not.to.include("'/active'")
    expect(hallSource).to.include(':map-agents="mapAgents"')
    expect(hallSource).to.include('await runAssignTask(task, agent)')
    expect(hallTaskActionsSource).to.include('agentId: targetAgent.agentId')
  })
})
