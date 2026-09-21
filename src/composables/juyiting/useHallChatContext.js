import { computed, ref } from 'vue'

export const taskAssigneeIds = (task) => {
  if (!task) return []
  if (Array.isArray(task.assignedAgentIds)) return task.assignedAgentIds
  return task.assignedAgentId ? [task.assignedAgentId] : []
}

export const useHallChatContext = ({
  agents,
  portraitShortName,
  selectedAgent,
  selectedTask
}) => {
  const chatMode = ref('public')
  const taskDiscussionAgentIds = ref([])
  const chatMentionAgentIds = ref([])
  // An explicit conversation subject is independent of browsing another task/agent.
  const conversationSubject = ref({ agentId: '', task: null })
  const conversationTask = computed(() => conversationSubject.value.task)
  const conversationAgent = computed(() => mentionSourceAgents.value.find(agent =>
    agent.agentId === conversationSubject.value.agentId) || null)

  const canMentionAgent = (agent) => Boolean(
    agent?.agentId
    && agent.boundToMe === true
    && agent.canOperate !== false
    && !agent.systemAgent
  )

  const mentionSourceAgents = computed(() => (agents?.value || []).filter(canMentionAgent))
  const mentionSourceAgentIds = computed(() => new Set(mentionSourceAgents.value.map(agent => agent.agentId).filter(Boolean)))
  const selectedAgentMentionable = computed(() => Boolean(conversationAgent.value))
  const allowedMentionIds = (agentIds = []) => agentIds.filter(agentId => mentionSourceAgentIds.value.has(agentId))

  const chatMentionAgents = computed(() => {
    if (!taskDiscussionAgentIds.value.length) return mentionSourceAgents.value
    const allowed = new Set(taskDiscussionAgentIds.value)
    return mentionSourceAgents.value.filter(agent => allowed.has(agent.agentId))
  })

  const chatTargetText = computed(() => {
    if (chatMode.value === 'bounty' && conversationTask.value) return `榜文议事 / ${conversationTask.value.title || conversationTask.value.id}`
    if (chatMode.value === 'private') {
      const name = conversationAgent.value ? portraitShortName(conversationAgent.value) : '当前好汉不可用'
      return conversationTask.value ? `事项密议 / ${name} / ${conversationTask.value.title || conversationTask.value.id}` : `普通密议 / ${name}`
    }
    return '众好汉'
  })

  const chatContext = computed(() => {
    const task = conversationTask.value
    const agentId = conversationSubject.value.agentId
    if (chatMode.value === 'bounty' && task) {
      const participantAgentIds = allowedMentionIds(taskDiscussionAgentIds.value.length
        ? taskDiscussionAgentIds.value
        : taskAssigneeIds(task))
      const targetAgentIds = allowedMentionIds(chatMentionAgentIds.value.length
        ? chatMentionAgentIds.value
        : participantAgentIds)
      return {
        conversationScopeType: 'bounty',
        conversationScopeKey: `task:${task.id}`,
        mode: 'bounty',
        participantAgentIds,
        selectedAgentId: null,
        selectedTaskId: task.id,
        targetAgentIds,
        taskId: task.id,
        targetAgentId: targetAgentIds[0] || ''
      }
    }
    if (chatMode.value === 'private' && agentId) {
      const targets = selectedAgentMentionable.value ? [agentId] : []
      return {
        conversationScopeType: 'private',
        conversationScopeKey: task ? `task:${task.id}:agent:${agentId}` : `agent:${agentId}`,
        mode: 'private',
        participantAgentIds: targets,
        selectedAgentId: targets[0] || null,
        selectedTaskId: task?.id ?? null,
        targetAgentIds: targets,
        taskId: task?.id ?? null,
        targetAgentId: targets[0] || ''
      }
    }
    return {
      conversationScopeType: 'public',
      conversationScopeKey: 'public',
      mode: 'public',
      participantAgentIds: [],
      selectedAgentId: null,
      selectedTaskId: null,
      targetAgentIds: allowedMentionIds(chatMentionAgentIds.value),
      taskId: null,
      targetAgentId: allowedMentionIds(chatMentionAgentIds.value)[0] || ''
    }
  })

  const clearChatTargets = () => {
    taskDiscussionAgentIds.value = []
    chatMentionAgentIds.value = []
  }

  const resetToPublic = ({ clearSelection = false } = {}) => {
    clearChatTargets()
    conversationSubject.value = { agentId: '', task: null }
    chatMode.value = 'public'
    if (clearSelection) {
      selectedTask.value = null
      selectedAgent.value = null
    }
  }

  const enterBountyDiscussion = (task = selectedTask.value) => {
    if (!task?.id) return false
    selectedTask.value = task
    conversationSubject.value = { agentId: '', task: { ...task } }
    selectedAgent.value = null
    chatMentionAgentIds.value = []
    chatMode.value = 'bounty'
    taskDiscussionAgentIds.value = taskAssigneeIds(selectedTask.value)
  }

  const enterPrivateConversation = (agent = selectedAgent.value, { task = null } = {}) => {
    if (!agent?.agentId || !mentionSourceAgentIds.value.has(agent.agentId)) return false
    selectedAgent.value = agent
    chatMentionAgentIds.value = []
    taskDiscussionAgentIds.value = []
    conversationSubject.value = { agentId: agent.agentId, task: task?.id ? { ...task } : null }
    chatMode.value = 'private'
    return true
  }

  const setChatMode = (mode) => {
    if ((mode || 'public') === 'bounty') {
      enterBountyDiscussion(selectedTask.value)
      return
    }
    if ((mode || 'public') === 'private') {
      enterPrivateConversation(selectedAgent.value)
      return
    }
    resetToPublic()
  }

  const setMentionAgent = (agent) => {
    const agentId = agent?.agentId
    chatMentionAgentIds.value = agentId && mentionSourceAgentIds.value.has(agentId) ? [agentId] : []
  }

  return {
    chatContext,
    conversationAgent,
    conversationTask,
    chatMentionAgentIds,
    chatMentionAgents,
    chatMode,
    chatTargetText,
    clearChatTargets,
    enterBountyDiscussion,
    enterPrivateConversation,
    resetToPublic,
    setChatMode,
    setMentionAgent,
    taskDiscussionAgentIds,
    canMentionAgent
  }
}
