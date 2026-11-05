import { typedId, typedLong } from './hallTypedDeliberation.js'

/** Consume server-selected heads, not a client reconstruction of all historical outcomes. */
export function deliveryContextPage (value, expected = {}) {
  const scope = value?.scope
  if (value?.schemaVersion !== 1 || !typedId(scope?.conversationId) || !typedLong(scope?.conversationGeneration) || !typedId(scope?.taskId) ||
    !typedLong(value.assignmentRevision, { allowZero: true }) || !typedId(value.targetAgentId) ||
    typeof value.pendingExecution !== 'boolean' || typeof value.hasMore !== 'boolean' || !Array.isArray(value.items) || value.items.length > 50) return null
  const actual = { ...scope, assignmentRevision: value.assignmentRevision, targetAgentId: value.targetAgentId }
  if (Object.entries(actual).some(([key, item]) => expected[key] != null && expected[key] !== item)) return null
  const ids = new Set()
  let previous = expected.before || null
  for (const item of value.items) {
    if (!typedId(item?.outcomeId) || !typedId(item?.requestId) || !typedLong(item?.assistantMessageId) ||
      !/^[a-f0-9]{64}$/.test(item?.finalSha256 || '') || !['ANSWER', 'ACTION_REQUEST', 'SUBMISSION_REQUEST'].includes(item.kind) ||
      typeof item.label !== 'string' || ids.has(item.outcomeId)) return null
    if (previous && (BigInt(item.assistantMessageId) > BigInt(previous.assistantMessageId) ||
      (item.assistantMessageId === previous.assistantMessageId && item.outcomeId >= previous.outcomeId))) return null
    ids.add(item.outcomeId); previous = item
  }
  const last = value.items.at(-1)
  if (value.hasMore
    ? !last || value.nextBeforeMessageId !== last.assistantMessageId || value.nextBeforeOutcomeId !== last.outcomeId
    : value.nextBeforeMessageId !== null || value.nextBeforeOutcomeId !== null) return null
  return Object.freeze({ schemaVersion: 1, scope: Object.freeze({ ...scope }), assignmentRevision: value.assignmentRevision,
    targetAgentId: value.targetAgentId, pendingExecution: value.pendingExecution,
    items: Object.freeze(value.items.map(item => Object.freeze({ ...item }))), hasMore: value.hasMore,
    nextBeforeMessageId: value.nextBeforeMessageId, nextBeforeOutcomeId: value.nextBeforeOutcomeId })
}

/** Exactly one read. The caller owns lifecycle fencing and explicit loading of another page. */
export async function readDeliveryContextPage ({ chatApi, context, before = null, signal }) {
  const params = { expectedGeneration: context.conversationGeneration, expectedAssignmentRevision: context.assignmentRevision }
  if (before) { params.beforeMessageId = before.assistantMessageId; params.beforeOutcomeId = before.outcomeId }
  const result = await chatApi.get(`/conversations/${encodeURIComponent(context.conversationId)}/delivery-context`, params,
    { autoLoading: false, needAuth: true, signal })
  const page = deliveryContextPage(result, { ...context, before })
  if (!page) throw new Error('当前成果上下文已变化，请重新加载。')
  return page
}
