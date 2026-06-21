import { computed, ref } from 'vue'

export const taskAssigneeIds = (task) => {
  if (!task) return []
  if (Array.isArray(task.assignedAgentIds)) return task.assignedAgentIds
  return task.assignedAgentId ? [task.assignedAgentId] : []
}

export const useHallChatContext = ({
  mapAgents,
  portraitShortName,
  selectedAgent,
  selectedTask
}) => {
  const chatMode = ref('public')
  const taskDiscussionAgentIds = ref([])
  const chatMentionAgentIds = ref([])

  const chatMentionAgents = computed(() => {
    if (!taskDiscussionAgentIds.value.length) return mapAgents.value
    const allowed = new Set(taskDiscussionAgentIds.value)
    return mapAgents.value.filter(agent => allowed.has(agent.agentId))
  })

  const chatTargetText = computed(() => {
    if (chatMode.value === 'bounty' && selectedTask.value) return `悬赏议事 / ${selectedTask.value.title || selectedTask.value.id}`
    if (chatMode.value === 'private' && selectedAgent.value) return `私聊 / ${portraitShortName(selectedAgent.value)}`
    if (!selectedAgent.value) return '全体好汉'
    return `${portraitShortName(selectedAgent.value)} / ${selectedAgent.value.name || selectedAgent.value.agentId}`
  })

  const chatContext = computed(() => {
    if (chatMode.value === 'bounty' && selectedTask.value) {
      const participantAgentIds = taskDiscussionAgentIds.value.length
        ? taskDiscussionAgentIds.value
        : taskAssigneeIds(selectedTask.value)
      const targetAgentIds = chatMentionAgentIds.value.length
        ? chatMentionAgentIds.value
        : participantAgentIds
      return {
        conversationScopeType: 'bounty',
        conversationScopeKey: `task:${selectedTask.value.id}`,
        mode: 'bounty',
        participantAgentIds,
        selectedTaskId: selectedTask.value.id,
        targetAgentIds,
        taskId: selectedTask.value.id,
        targetAgentId: targetAgentIds[0] || ''
      }
    }
    if (chatMode.value === 'private' && selectedAgent.value) {
      const hasTask = Boolean(selectedTask.value?.id)
      return {
        conversationScopeType: 'private',
        conversationScopeKey: hasTask
          ? `task:${selectedTask.value.id}:agent:${selectedAgent.value.agentId}`
          : `agent:${selectedAgent.value.agentId}`,
        mode: 'private',
        participantAgentIds: [selectedAgent.value.agentId],
        selectedTaskId: selectedTask.value?.id,
        targetAgentIds: [selectedAgent.value.agentId],
        taskId: selectedTask.value?.id,
        targetAgentId: selectedAgent.value.agentId
      }
    }
    return {
      conversationScopeType: 'public',
      conversationScopeKey: 'public',
      mode: 'public',
      participantAgentIds: [],
      selectedTaskId: selectedTask.value?.id,
      targetAgentIds: chatMentionAgentIds.value,
      taskId: selectedTask.value?.id,
      targetAgentId: chatMentionAgentIds.value[0] || ''
    }
  })

  const clearChatTargets = () => {
    taskDiscussionAgentIds.value = []
    chatMentionAgentIds.value = []
  }

  const resetToPublic = ({ clearSelection = false } = {}) => {
    clearChatTargets()
    chatMode.value = 'public'
    if (clearSelection) {
      selectedTask.value = null
      selectedAgent.value = null
    }
  }

  const enterBountyDiscussion = (task = selectedTask.value) => {
    if (task) selectedTask.value = task
    selectedAgent.value = null
    chatMentionAgentIds.value = []
    chatMode.value = 'bounty'
    taskDiscussionAgentIds.value = taskAssigneeIds(selectedTask.value)
  }

  const enterPrivateConversation = (agent = selectedAgent.value) => {
    if (agent) selectedAgent.value = agent
    chatMentionAgentIds.value = []
    taskDiscussionAgentIds.value = []
    chatMode.value = 'private'
    if (!selectedAgent.value) {
      selectedAgent.value = chatMentionAgents.value[0] || null
    }
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
    chatMentionAgentIds.value = agent?.agentId ? [agent.agentId] : []
  }

  return {
    chatContext,
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
    taskDiscussionAgentIds
  }
}
