import { existsSync, readFileSync } from 'fs'
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
const librarySource = readFileSync(
  new URL('../src/components/juyiting/LibraryPanel.vue', import.meta.url),
  'utf8'
)
const hallStageUrl = new URL('../src/components/juyiting/HallStage.vue', import.meta.url)
const hallDataUrl = new URL('../src/composables/juyiting/useHallData.js', import.meta.url)
const hallConversationUrl = new URL('../src/composables/juyiting/useHallConversation.js', import.meta.url)
const hallDataSource = readFileSync(hallDataUrl, 'utf8')
const hallConversationSource = readFileSync(hallConversationUrl, 'utf8')

describe('JuyiHall collaboration flow contract', () => {
  it('uses the stage header as the primary action surface without the duplicate dock', () => {
    expect(hallSource).not.to.include('<BottomDock')
    expect(hallSource).not.to.include("import BottomDock")
    expect(hallStageUrl).to.not.equal(undefined)
    expect(readFileSync(hallStageUrl, 'utf8')).not.to.include("title=\"宋江号令\"")
    expect(readFileSync(hallStageUrl, 'utf8')).not.to.include("title=\"协同会办\"")
    expect(readFileSync(hallStageUrl, 'utf8')).to.include("title=\"藏经阁\"")
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
    expect(hallConversationSource).to.include('selectedAgentId: selectedAgent.value?.agentId')
    expect(hallConversationSource).to.include('mentionAgentIds: selectedAgent.value?.agentId ? [selectedAgent.value.agentId] : []')
    expect(hallConversationSource).to.include('selectedTaskId: selectedTask.value?.id')
    expect(hallConversationSource).to.include('...(outgoingMetadata?.value || {})')
  })

  it('keeps low-value SongJiang and coordination panels out of the primary hall surface', () => {
    expect(hallSource).not.to.include('<CommandPanel')
    expect(hallSource).not.to.include('<CoordinationPanel')
    expect(hallSource).not.to.include("import CommandPanel")
    expect(hallSource).not.to.include("import CoordinationPanel")
    expect(hallSource).to.include('<LibraryPanel')
    expect(librarySource).to.include('向量检索')
    expect(hallSource).to.include("chatApi.search('/library/search'")
  })

  it('shows an overflow hint when more than twelve agents are available', () => {
    expect(hallSource).to.include('hiddenAgentCount')
    expect(hallDataSource).to.match(/slice\(0,\s*12\)/)
  })

  it('keeps roster status filtering independent from map agents', () => {
    expect(hallDataSource).to.not.include("'/active'")
    expect(hallDataSource).to.include("agentApi.get('/map'")
    expect(hallDataSource).to.include("agentApi.search('/roster'")
    expect(hallDataSource).to.include('mapAgents')
    expect(hallDataSource).to.match(/visibleAgents\s*=\s*computed\(\(\)\s*=>\s*mapAgents\.value\.slice\(0,\s*12\)/)
    expect(hallSource).to.include(':map-agents="mapAgents"')
    expect(hallSource).to.include(':tasks-total="tasks.length"')
    expect(hallSource).not.to.include('<strong>{{ agents.length }}</strong>')
    expect(hallSource).to.include('@set-agent-filter="setAgentFilter"')
  })

  it('splits hall stage, data, and conversation responsibilities into dedicated units', () => {
    expect(existsSync(hallStageUrl)).to.equal(true)
    expect(existsSync(hallDataUrl)).to.equal(true)
    expect(existsSync(hallConversationUrl)).to.equal(true)
    expect(hallSource).to.include("import HallStage from '@/components/juyiting/HallStage.vue'")
    expect(hallSource).to.include("import { useHallData } from '@/composables/juyiting/useHallData'")
    expect(hallSource).to.include("import { useHallConversation } from '@/composables/juyiting/useHallConversation'")
  })
})

const hallStageSource = () => readFileSync(hallStageUrl, 'utf8')
