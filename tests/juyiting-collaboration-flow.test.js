import { readFileSync } from 'fs'
import { expect } from 'chai'

const hallSource = readFileSync(
  new URL('../src/components/world/JuyiHall.vue', import.meta.url),
  'utf8'
)
const bountySource = readFileSync(
  new URL('../src/components/juyiting/BountyPanel.vue', import.meta.url),
  'utf8'
)
const chatSource = readFileSync(
  new URL('../src/components/juyiting/ChatPanel.vue', import.meta.url),
  'utf8'
)
const dockSource = readFileSync(
  new URL('../src/components/juyiting/BottomDock.vue', import.meta.url),
  'utf8'
)

describe('JuyiHall collaboration flow contract', () => {
  it('uses the persistent dock as the primary action surface', () => {
    expect(hallSource).to.include('<BottomDock')
    expect(dockSource).to.include('agentsTotal')
    expect(dockSource).to.include('tasksTotal')
    expect(dockSource).to.include('selectedAgent')
    expect(dockSource).to.include('selectedTask')
  })

  it('assigns a bounty to an explicit agent instead of hidden selectedAgent only', () => {
    expect(bountySource).to.include("$emit('assign-task', selectedTask, agent)")
    expect(hallSource).to.include('const assignTask = async (task, agent')
    expect(hallSource).to.include('agentId: targetAgent.agentId')
  })

  it('offers task-aware command templates in chat', () => {
    expect(chatSource).to.include('commandTemplates')
    expect(chatSource).to.include('汇报状态')
    expect(chatSource).to.include('评估风险')
    expect(chatSource).to.include('接令确认')
    expect(chatSource).to.include("$emit('apply-template'")
  })

  it('keeps both agent and task context in outgoing chat metadata', () => {
    expect(hallSource).to.include('selectedAgentId: selectedAgent.value?.agentId')
    expect(hallSource).to.include('mentionAgentIds: selectedAgent.value?.agentId ? [selectedAgent.value.agentId] : []')
    expect(hallSource).to.include('selectedTaskId: selectedTask.value?.id')
  })

  it('shows an overflow hint when more than twelve agents are available', () => {
    expect(hallSource).to.include('hiddenAgentCount')
    expect(hallSource).to.match(/slice\(0,\s*12\)/)
  })
})
