import { computed, unref } from 'vue'

const valueOf = value => typeof value === 'function' ? value() : unref(value)
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 100 &&
  value === value.trim() && ![...value].some(character => character.codePointAt(0) < 32)

const explicitAssignedAgentId = task => {
  const agentId = task?.assignedAgentId
  if (!validId(agentId)) return ''
  const listed = Array.isArray(task?.assignedAgentIds) ? task.assignedAgentIds : []
  const uniqueListed = [...new Set(listed.filter(validId))]
  return uniqueListed.length === 0 || uniqueListed.length === 1 && uniqueListed[0] === agentId ? agentId : ''
}

/**
 * Proves only the facts a formal TASK start may inherit from Hall state.  It
 * deliberately does not select an actor, create a conversation, or infer an
 * ambiguous work item; the execution boundary receives blank values until the
 * exact task scope is known.
 */
export function useFormalTaskExecutionScope ({
  selectedTask,
  chatContext,
  conversationId,
  identityScope,
  taskWorkspaceEnabled,
  taskWorkspaceSubject,
  taskWorkspaceSnapshot,
  taskWorkspaceConnectionState,
  taskWorkspaceError
} = {}) {
  return computed(() => {
    const task = valueOf(selectedTask)
    const taskId = validId(task?.id) ? task.id : ''
    const targetAgentId = explicitAssignedAgentId(task)
    const context = valueOf(chatContext) || {}
    const matchingBountyDiscussion = Boolean(taskId && targetAgentId &&
      context.mode === 'bounty' &&
      context.conversationScopeType === 'bounty' &&
      context.conversationScopeKey === `task:${taskId}` &&
      context.taskId === taskId &&
      context.targetAgentId === targetAgentId &&
      Array.isArray(context.targetAgentIds) && context.targetAgentIds.length === 1 && context.targetAgentIds[0] === targetAgentId)
    const candidateConversationId = valueOf(conversationId)
    const confirmedConversationId = matchingBountyDiscussion && validId(candidateConversationId)
      ? candidateConversationId
      : ''
    const workspaceEnabled = valueOf(taskWorkspaceEnabled) === true
    const subject = valueOf(taskWorkspaceSubject)
    const subjectMatches = workspaceEnabled && subject?.taskId === taskId && subject?.actorAgentId === targetAgentId
    const workspace = valueOf(taskWorkspaceSnapshot)
    const workspaceMatches = subjectMatches && workspace?.task?.taskId === taskId &&
      workspace.task.assignedAgentId === targetAgentId
    const readyRequiredItems = workspaceMatches && Array.isArray(workspace.workItems)
      ? workspace.workItems.filter(item => item?.requiredItem === true && item.status === 'ready' &&
        // Lease expiry clears the item assignee; task-level assignment above remains authoritative.
        // Match beginTaskExecution: one required ready item, unassigned or owned by this exact target.
        (item.assigneeAgentId === null || item.assigneeAgentId === targetAgentId))
      : []
    const workspaceAvailable = ['snapshot_ready', 'live', 'reconnecting'].includes(valueOf(taskWorkspaceConnectionState))

    let authorizationReason = ''
    if (!taskId) authorizationReason = '当前未选定正式榜文，不能关联资料或开始正式办理。'
    else if (!valueOf(identityScope)) authorizationReason = '当前身份范围尚未确认，不能读取或授权正式任务资料。'
    else if (!targetAgentId) authorizationReason = '当前榜文没有唯一明确的 assignedAgentId；请先完成单 Agent 点将并刷新榜文。'
    else if (!matchingBountyDiscussion) authorizationReason = '请先进入本榜文的正式议事并确认唯一已指派好汉；不会使用其他榜文或私人会话。'
    else if (!confirmedConversationId) authorizationReason = '本榜文正式议事尚未返回已确认 conversationId；请完成议事后重试。'
    else if (!workspaceEnabled) authorizationReason = '协作工作台功能未启用，无法核对本榜文的必需工作项。'
    else if (!subjectMatches) authorizationReason = '请在本榜文中明确选择已指派好汉并等待该榜文协作工作台快照；不会切换或推定承办人。'
    else if (!workspaceAvailable) authorizationReason = valueOf(taskWorkspaceError)?.status === 503
      ? '本榜文协作工作台当前返回 503，未核对必需工作项，不能开始正式办理。'
      : '本榜文协作工作台尚未可用，未核对必需工作项，不能开始正式办理。'
    else if (!workspaceMatches) authorizationReason = '协作工作台快照不属于当前榜文或已指派好汉，不能授权正式执行。'
    else if (readyRequiredItems.length === 0) authorizationReason = '当前榜文没有可由该已指派好汉领取的 ready 必需工作项，不能开始正式办理。'
    else if (readyRequiredItems.length !== 1) authorizationReason = '当前榜文存在多个匹配的 ready 必需工作项，无法任意选择一个开始正式办理。'

    return {
      taskId,
      conversationId: confirmedConversationId,
      targetAgentId,
      conversationConfirmed: Boolean(confirmedConversationId),
      formalExecutionAuthorized: !authorizationReason,
      authorizationReason
    }
  })
}
