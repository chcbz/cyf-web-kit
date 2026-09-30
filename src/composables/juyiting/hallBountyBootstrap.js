import { canonicalWireString } from './hallConversationMessages.js'
import { exactHallConversationId } from './hallConversationHistory.js'

const exactTextId = value => {
  if (typeof value !== 'string' || !value || value.trim() !== value || /\s/u.test(value)) return false
  return [...value].every(character => {
    const point = character.codePointAt(0)
    return point >= 0x20 && point !== 0x7f && !(point >= 0xd800 && point <= 0xdfff)
  })
}
const wireState = value => typeof value === 'string' && /^[A-Z][A-Z_]*$/.test(value)
const long = (value, allowZero = false) => canonicalWireString(value, { allowZero })
const conversation = value => typeof value === 'string' ? exactHallConversationId(value) : ''

// This is an exact attachment reference, not a grant or execution authorization.
export const bountyBootstrapReference = value => {
  if (!value || !exactTextId(value.taskId) || !exactTextId(value.targetAgentId) ||
      !exactTextId(value.initialRequestId) || !long(value.assignmentRevision, true) ||
      !conversation(value.conversationId)) return null
  return Object.freeze({ taskId: value.taskId, targetAgentId: value.targetAgentId,
    initialRequestId: value.initialRequestId, assignmentRevision: value.assignmentRevision,
    conversationId: value.conversationId })
}

export const sameBountyBootstrapReference = (a, b) => Boolean(a && b &&
  ['taskId', 'targetAgentId', 'initialRequestId', 'assignmentRevision', 'conversationId'].every(key => a[key] === b[key]))

export const bountyBootstrapContextMatches = (context, task, agent, reference) => Boolean(reference &&
  context?.conversationScopeType === 'bounty' && context.conversationScopeKey === `task:${reference.taskId}` &&
  context.taskId === reference.taskId && context.targetAgentId === reference.targetAgentId &&
  Array.isArray(context.targetAgentIds) && context.targetAgentIds.length === 1 &&
  context.targetAgentIds[0] === reference.targetAgentId &&
  (!task || task.id === reference.taskId) && (!agent || agent.agentId === reference.targetAgentId))

// Validate the actual RequestView contract before touching any conversation state.
export const validateBountyBootstrapRequest = (view, reference) => {
  if (!reference || !view || view.requestId !== reference.initialRequestId ||
      view.conversationId !== reference.conversationId || !long(view.requestRevision) ||
      !long(view.conversationGeneration, true) || !long(view.userMessageId) ||
      !long(view.stateVersion, true) || !wireState(view.state) ||
      !Array.isArray(view.turns) || !Array.isArray(view.steps) || view.steps.length !== 1) return null
  const step = view.steps[0]
  if (!step || !exactTextId(step.stepId) || !long(step.stepNumber) ||
      step.taskId !== reference.taskId || step.assignmentRevision !== reference.assignmentRevision ||
      step.targetAgentId !== reference.targetAgentId || !['EXECUTE', 'INSPECT'].includes(step.kind) ||
      !wireState(step.state) || !long(step.stateVersion, true)) return null
  if (step.kind === 'EXECUTE') {
    if (!exactTextId(step.executionIntentId) || !wireState(step.executionState) ||
        (step.executionId !== null && !exactTextId(step.executionId))) return null
  } else if (step.executionIntentId !== null || step.executionId !== null || step.executionState !== null) return null
  const turnIds = new Set()
  for (const turn of view.turns) {
    if (!turn || !exactTextId(turn.turnId) || turnIds.has(turn.turnId) ||
        turn.requestId !== view.requestId || turn.requestRevision !== view.requestRevision ||
        turn.conversationId !== view.conversationId || turn.conversationGeneration !== view.conversationGeneration ||
        turn.targetAgentId !== reference.targetAgentId || !wireState(turn.state) ||
        !long(turn.stateVersion, true) || !long(turn.lastDeltaSeq, true) ||
        !long(turn.createdAt, true) || !long(turn.updatedAt, true) ||
        (turn.finalMessageId !== null && !long(turn.finalMessageId))) return null
    turnIds.add(turn.turnId)
  }
  return { requestId: view.requestId, requestRevision: view.requestRevision, conversationId: view.conversationId,
    conversationGeneration: view.conversationGeneration, userMessageId: view.userMessageId,
    state: view.state, stateVersion: view.stateVersion, turns: view.turns.map(turn => ({ ...turn })),
    steps: [{ stepId: step.stepId, stepNumber: step.stepNumber, taskId: step.taskId,
      assignmentRevision: step.assignmentRevision, targetAgentId: step.targetAgentId,
      kind: step.kind, state: step.state, stateVersion: step.stateVersion,
      executionIntentId: step.executionIntentId, executionId: step.executionId, executionState: step.executionState }] }
}

export const bootstrapReadbackIsCurrent = (current, next) => {
  if (!current) return true
  if (current.requestId !== next.requestId || current.requestRevision !== next.requestRevision ||
      current.conversationId !== next.conversationId || current.conversationGeneration !== next.conversationGeneration ||
      current.userMessageId !== next.userMessageId || !long(current.stateVersion, true) ||
      BigInt(next.stateVersion) < BigInt(current.stateVersion) ||
      (next.stateVersion === current.stateVersion && next.state !== current.state)) return false
  for (const old of current.steps || []) {
    const step = next.steps.find(item => item.stepId === old.stepId)
    if (!step || !long(old.stateVersion, true) || BigInt(step.stateVersion) < BigInt(old.stateVersion) ||
        ['stepNumber', 'taskId', 'assignmentRevision', 'targetAgentId', 'kind', 'executionIntentId'].some(key => old[key] !== step[key]) ||
        (old.executionId && old.executionId !== step.executionId) ||
        (step.stateVersion === old.stateVersion && ['state', 'executionId', 'executionState'].some(key => old[key] !== step[key]))) return false
  }
  return true
}
