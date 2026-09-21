import { expect } from 'chai'
import { ref } from 'vue'

import { useHallChatContext } from '../src/composables/juyiting/useHallChatContext.js'

describe('useHallChatContext', () => {
  const portraitShortName = agent => agent?.shortName || agent?.name || agent?.agentId || ''
  const agents = [
    { agentId: 'wuyong', name: '吴用', boundToMe: true },
    { agentId: 'linchong', name: '林冲', boundToMe: true },
    { agentId: 'songjiang', name: '宋江', boundToMe: false }
  ]

  it('builds a public conversation scope and mention targets from owned roster agents', () => {
    const selectedAgent = ref(null)
    const selectedTask = ref({ id: 'task-1', title: '巡检悬赏' })
    const rosterAgents = ref(agents.slice(0, 2))
    const mapAgents = ref(agents)
    const context = useHallChatContext({ agents: rosterAgents, mapAgents, portraitShortName, selectedAgent, selectedTask })

    context.setMentionAgent(agents[1])

    expect(context.chatMode.value).to.equal('public')
    expect(context.chatTargetText.value).to.equal('众好汉')
    expect(context.chatContext.value).to.deep.include({
      conversationScopeType: 'public',
      conversationScopeKey: 'public',
      mode: 'public',
      selectedTaskId: null,
      taskId: null,
      targetAgentId: 'linchong'
    })
    expect(context.chatContext.value.targetAgentIds).to.deep.equal(['linchong'])

    context.setMentionAgent(agents[2])
    expect(context.chatContext.value.targetAgentIds).to.deep.equal([])
  })

  it('scopes bounty conversations to assignees and filters mention choices', () => {
    const selectedAgent = ref(agents[1])
    const selectedTask = ref({
      id: 'task-2',
      title: '联调接口',
      assignedAgentIds: ['wuyong', 'linchong']
    })
    const rosterAgents = ref(agents.slice(0, 2))
    const mapAgents = ref(agents)
    const context = useHallChatContext({ agents: rosterAgents, mapAgents, portraitShortName, selectedAgent, selectedTask })

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
    const rosterAgents = ref(agents)
    const mapAgents = ref(agents)
    const context = useHallChatContext({ agents: rosterAgents, mapAgents, portraitShortName, selectedAgent, selectedTask })

    context.enterPrivateConversation(agents[0], { task: selectedTask.value })

    expect(context.chatMode.value).to.equal('private')
    expect(context.chatTargetText.value).to.equal('事项密议 / 吴用 / 整理纪要')
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
    const rosterAgents = ref(agents)
    const mapAgents = ref(agents)
    const context = useHallChatContext({ agents: rosterAgents, mapAgents, portraitShortName, selectedAgent, selectedTask })

    context.enterBountyDiscussion(selectedTask.value)
    context.resetToPublic({ clearSelection: true })

    expect(selectedAgent.value).to.equal(null)
    expect(selectedTask.value).to.equal(null)
    expect(context.chatMode.value).to.equal('public')
    expect(context.chatContext.value.conversationScopeKey).to.equal('public')
    expect(context.chatContext.value.targetAgentIds).to.deep.equal([])
  })
  it('keeps ordinary private chat independent from browsing another task or agent', () => {
    const selectedAgent = ref(agents[0])
    const selectedTask = ref({ id: 'task-old', title: '旧榜文' })
    const roster = ref([...agents])
    const context = useHallChatContext({ agents: roster, portraitShortName, selectedAgent, selectedTask })
    context.enterPrivateConversation(agents[0])
    expect(context.chatContext.value.conversationScopeKey).to.equal('agent:wuyong')
    expect(context.chatContext.value.taskId).to.equal(null)
    selectedTask.value = { id: 'task-new', title: '正在浏览的新榜文' }
    selectedAgent.value = agents[1]
    expect(context.chatContext.value.conversationScopeKey).to.equal('agent:wuyong')
    expect(context.chatContext.value.targetAgentId).to.equal('wuyong')
    expect(context.chatTargetText.value).to.equal('普通密议 / 吴用')
    roster.value = [agents[1]]
    expect(context.chatContext.value.conversationScopeKey).to.equal('agent:wuyong')
    expect(context.chatContext.value.targetAgentIds).to.deep.equal([])
    expect(context.conversationAgent.value).to.equal(null)
  })

  it('pins an explicitly chosen task discussion until another discussion is explicitly entered', () => {
    const selectedAgent = ref(agents[0])
    const selectedTask = ref({ id: 'task-a', title: '事项甲', assignedAgentIds: ['wuyong'] })
    const context = useHallChatContext({ agents: ref(agents), portraitShortName, selectedAgent, selectedTask })
    context.enterBountyDiscussion(selectedTask.value)
    selectedTask.value = { id: 'task-b', title: '事项乙', assignedAgentIds: ['linchong'] }
    expect(context.chatContext.value.conversationScopeKey).to.equal('task:task-a')
    expect(context.chatContext.value.targetAgentIds).to.deep.equal(['wuyong'])
    context.enterBountyDiscussion(selectedTask.value)
    expect(context.chatContext.value.conversationScopeKey).to.equal('task:task-b')
    expect(context.chatContext.value.targetAgentIds).to.deep.equal(['linchong'])
  })

})
