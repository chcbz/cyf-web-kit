import { expect } from 'chai'
import { ref } from 'vue'

import { useHallChatContext } from '../src/composables/juyiting/useHallChatContext.js'

describe('useHallChatContext', () => {
  const portraitShortName = agent => agent?.shortName || agent?.name || agent?.agentId || ''
  const agents = [
    { agentId: 'wuyong', name: '吴用' },
    { agentId: 'linchong', name: '林冲' },
    { agentId: 'songjiang', name: '宋江' }
  ]

  it('builds a public conversation scope and mention targets from map agents', () => {
    const selectedAgent = ref(null)
    const selectedTask = ref({ id: 'task-1', title: '巡检悬赏' })
    const mapAgents = ref(agents)
    const context = useHallChatContext({ mapAgents, portraitShortName, selectedAgent, selectedTask })

    context.setMentionAgent(agents[2])

    expect(context.chatMode.value).to.equal('public')
    expect(context.chatTargetText.value).to.equal('全体好汉')
    expect(context.chatContext.value).to.deep.include({
      conversationScopeType: 'public',
      conversationScopeKey: 'public',
      mode: 'public',
      selectedTaskId: 'task-1',
      taskId: 'task-1',
      targetAgentId: 'songjiang'
    })
    expect(context.chatContext.value.targetAgentIds).to.deep.equal(['songjiang'])
  })

  it('scopes bounty conversations to assignees and filters mention choices', () => {
    const selectedAgent = ref(agents[1])
    const selectedTask = ref({
      id: 'task-2',
      title: '联调接口',
      assignedAgentIds: ['wuyong', 'linchong']
    })
    const mapAgents = ref(agents)
    const context = useHallChatContext({ mapAgents, portraitShortName, selectedAgent, selectedTask })

    context.enterBountyDiscussion(selectedTask.value)
    context.setMentionAgent(agents[1])

    expect(selectedAgent.value).to.equal(null)
    expect(context.chatMode.value).to.equal('bounty')
    expect(context.chatMentionAgents.value.map(agent => agent.agentId)).to.deep.equal(['wuyong', 'linchong'])
    expect(context.chatContext.value).to.deep.include({
      conversationScopeType: 'bounty',
      conversationScopeKey: 'task:task-2',
      mode: 'bounty',
      selectedTaskId: 'task-2',
      taskId: 'task-2',
      targetAgentId: 'linchong'
    })
    expect(context.chatContext.value.participantAgentIds).to.deep.equal(['wuyong', 'linchong'])
    expect(context.chatContext.value.targetAgentIds).to.deep.equal(['linchong'])
  })

  it('builds private task and agent scope keys', () => {
    const selectedAgent = ref(agents[0])
    const selectedTask = ref({ id: 'task-3', title: '整理纪要' })
    const mapAgents = ref(agents)
    const context = useHallChatContext({ mapAgents, portraitShortName, selectedAgent, selectedTask })

    context.enterPrivateConversation(agents[0])

    expect(context.chatMode.value).to.equal('private')
    expect(context.chatTargetText.value).to.equal('私聊 / 吴用')
    expect(context.chatContext.value).to.deep.include({
      conversationScopeType: 'private',
      conversationScopeKey: 'task:task-3:agent:wuyong',
      mode: 'private',
      selectedTaskId: 'task-3',
      taskId: 'task-3',
      targetAgentId: 'wuyong'
    })
    expect(context.chatContext.value.participantAgentIds).to.deep.equal(['wuyong'])
    expect(context.chatContext.value.targetAgentIds).to.deep.equal(['wuyong'])
  })

  it('resets stage chat entrance to a fresh public context', () => {
    const selectedAgent = ref(agents[0])
    const selectedTask = ref({ id: 'task-4', title: '风险评估' })
    const mapAgents = ref(agents)
    const context = useHallChatContext({ mapAgents, portraitShortName, selectedAgent, selectedTask })

    context.enterBountyDiscussion(selectedTask.value)
    context.resetToPublic({ clearSelection: true })

    expect(selectedAgent.value).to.equal(null)
    expect(selectedTask.value).to.equal(null)
    expect(context.chatMode.value).to.equal('public')
    expect(context.chatContext.value.conversationScopeKey).to.equal('public')
    expect(context.chatContext.value.targetAgentIds).to.deep.equal([])
  })
})
