import { mergeMessageParts } from './hallMessageParts.js'

const agentMessage = message => ['AGENT', 'ASSISTANT'].includes(message?.sender)
const deliveryNotice = '已生成成果；可预览或下载。'

/** Display-only grouping. Never rewrite the message store or infer links from text/time. */
export const discussionTurns = ({ messages = [], projections = [], conversationId = '', taskId = '' } = {}) => {
  const owners = new Map()
  const rows = messages.map(message => ({ ...message, turnOriginal: message, turnProjections: [], turnRequestIds: [], turnDeliveries: [] }))
  for (const projection of projections) {
    if (projection?.conversationId !== conversationId || projection?.outcome?.taskId !== taskId ||
      projection.outcome.kind !== 'ACTION_REQUEST') continue
    const parents = rows.filter(row => agentMessage(row) && row.localId === projection.outcome.assistantMessageId)
    if (parents.length !== 1) continue
    const parent = parents[0]
    parent.turnProjections.push(projection)
    const child = projection.actionProgress?.childRequestId
    if (!child) continue
    const matches = owners.get(child) || new Set()
    matches.add(parent)
    owners.set(child, matches)
  }
  for (const [child, parents] of owners) {
    // Conflicting linkage stays separate, never picks an arbitrary reply.
    if (parents.size === 1) [...parents][0].turnRequestIds.push(child)
  }
  for (const row of rows) {
    if (!agentMessage(row)) continue
    const typed = projections.find(projection => projection?.conversationId === conversationId &&
      projection?.outcome?.taskId === taskId && projection.outcome.assistantMessageId === row.localId)
    const knownKind = typed?.outcome?.kind || (row.typedOutcomeTaskId === taskId ? row.typedOutcomeKind : '')
    row.turnActionRequest = knownKind === 'ACTION_REQUEST'
    // Stream fragments cannot distinguish an answer from internal execution prose yet.
    row.turnAwaitingType = Boolean(row.streaming || (row.typedOutcomeId && !knownKind))
  }
  const consumed = new Set()
  for (const row of rows) {
    const parents = owners.get(row.requestId)
    if (!agentMessage(row) || row.streaming || !row.parts?.length || parents?.size !== 1 || row.turnProjections.length) continue
    const parent = [...parents][0]
    if (row === parent || (row.agentId && parent.agentId && row.agentId !== parent.agentId)) continue
    parent.parts = mergeMessageParts(parent.parts, row.parts)
    parent.turnDeliveries.push(row.turnOriginal)
    consumed.add(row)
  }
  return rows.filter(row => !consumed.has(row))
}

// ACTION_REQUEST is control-plane prose, not a user answer. Keep the stored original intact.
export const discussionMessageText = message => (message?.turnActionRequest || message?.turnAwaitingType || message?.turnProjections?.length) ? '' : (message?.content || '')
export const discussionFooterStatus = (status, isTaskDiscussion) => isTaskDiscussion &&
  ['本轮回话已结束', '本轮结果已登记', '本轮成果已就绪'].includes(status) ? '' : status

// Suppress only the known backend delivery wrapper after an exact request association.
export const discussionDeliveryText = message => message.content === deliveryNotice ? '' : message.content

export const discussionTurnStatus = projection => ({
  QUEUED: '等待处理', RUNNING: '正在处理', WAITING_PROVIDER: '等待工具结果',
  RESULT_UNKNOWN: '结果待核实', ARCHIVING: '已生成，登记中', COMPLETED: '本轮完成',
  FAILED: '本轮未完成', CANCELLED: '本轮已取消'
})[projection?.actionProgress?.state] || '正在核对处理状态'
