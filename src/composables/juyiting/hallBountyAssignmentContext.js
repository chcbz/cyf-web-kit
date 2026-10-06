import { pointAndStartLong } from './hallPointAndStartIntent.js'

// TaskDTO has no assignmentRevision. Keep the grant-owned binding separate
// from the canonical task, and accept only the current authenticated adoption.
// useHallPointAndStart clears this state synchronously on actor/auth/task fences.
export const currentBountyAssignmentRevision = ({ task, targetAgentId, conversationId, state }) => {
  const p = state?.projection
  if (state?.status !== 'ATTACHED' || !p || !p.currentAssignment || p.grantState !== 'ACTIVE' ||
    p.bootstrapState !== 'ADMITTED' || p.taskId !== task?.id || p.targetAgentId !== targetAgentId ||
    p.conversationId !== conversationId || task?.assignedAgentId !== targetAgentId ||
    !pointAndStartLong(task?.taskVersion, true) || p.taskVersion !== task.taskVersion ||
    !pointAndStartLong(p.assignmentRevision, true)) return ''
  return p.assignmentRevision
}
