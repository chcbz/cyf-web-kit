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

// Existing conversations must not depend on this browser having retained the
// original point-and-start idempotency record. This owner-authenticated GET
// checks the current grant and durable conversation binding on the server.
export const bountyAssignmentContextProjection = (value, expected) => {
  const fields = ['schemaVersion', 'conversationId', 'conversationGeneration', 'taskId', 'targetAgentId',
    'taskVersion', 'assignmentRevision', 'baselineGrantVersion', 'requirementRevision']
  if (!value || Object.keys(value).length !== fields.length || !fields.every(key => Object.hasOwn(value, key)) ||
    value.schemaVersion !== 1 || !pointAndStartLong(value.conversationGeneration) ||
    !pointAndStartLong(value.taskVersion, true) || !pointAndStartLong(value.assignmentRevision, true) ||
    !pointAndStartLong(value.baselineGrantVersion) || !pointAndStartLong(value.requirementRevision) ||
    !['conversationId', 'taskId', 'targetAgentId', 'taskVersion'].every(key =>
      typeof expected[key] === 'string' && expected[key] && value[key] === expected[key]) ||
    (expected.conversationGeneration && value.conversationGeneration !== expected.conversationGeneration)) return null
  return Object.freeze({ ...value })
}
