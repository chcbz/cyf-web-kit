import { mergeMessageParts } from './hallMessageParts.js'

const agentMessage = message => ['AGENT', 'ASSISTANT'].includes(message?.sender)
const deliveryNotice = '已生成成果；可预览或下载。'

/** Display-only grouping. Never rewrite the message store or infer links from text/time. */
export const discussionTurns = ({ messages = [], projections = [], conversationId = '', taskId = '' } = {}) => {
  const owners = new Map()
  const rows = messages.map(message => ({ ...message, turnOriginal: message, turnProjections: [], turnRequestIds: [], turnDeliveries: [] }))
  for (const projection of projections) {
    if (projection?.conversationId !== conversationId || projection?.outcome?.taskId !== taskId ||
      !['ACTION_REQUEST', 'REVISION_REQUEST'].includes(projection.outcome.kind)) continue
    const parents = rows.filter(row => agentMessage(row) && row.localId === projection.outcome.assistantMessageId)
    if (parents.length !== 1) continue
    const parent = parents[0]
    parent.turnProjections.push(projection)
    const child = projection.outcome.kind === 'REVISION_REQUEST'
      ? projection.reviewProgress?.childRequestId : projection.actionProgress?.childRequestId
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
    if (row.typedDisplayUnavailable) { row.turnAwaitingType = false; continue }
    const typed = projections.find(projection => projection?.conversationId === conversationId &&
      projection?.outcome?.taskId === taskId && projection.outcome.assistantMessageId === row.localId)
    const knownKind = typed?.outcome?.kind || (row.typedOutcomeTaskId === taskId ? row.typedOutcomeKind : '')
    row.turnActionRequest = knownKind === 'ACTION_REQUEST'
    row.turnControlRequest = ['ACTION_REQUEST', 'REVISION_REQUEST'].includes(knownKind)
    // Only Runtime-classified user reply deltas may render before the authoritative final.
    // Missing/unknown purpose remains hidden for mixed-version producers.
    const visibleStream = ['ANSWER', 'CLARIFY'].includes(row.streamOutcomeKind)
    row.turnAwaitingType = Boolean((row.streaming && !visibleStream) || (row.typedOutcomeId && !knownKind))
  }
  const parentOf = new Map()
  for (const row of rows) {
    const parents = owners.get(row.requestId)
    if (!agentMessage(row) || parents?.size !== 1) continue
    const parent = [...parents][0]
    if (row === parent || (row.agentId && parent.agentId && row.agentId !== parent.agentId)) continue
    // Revision children can be another control turn, a text answer or a clarification.
    // Execution deliveries retain the existing final-file association rule.
    const revisionChild = parent.turnProjections.some(p => p.outcome.kind === 'REVISION_REQUEST' && p.reviewProgress?.childRequestId === row.requestId)
    if (!revisionChild && (row.streaming || !row.parts?.length || row.turnProjections.length)) continue
    parentOf.set(row, parent)
  }
  const rootOf = row => {
    const seen = new Set([row]); let root = row
    while (parentOf.has(root)) {
      root = parentOf.get(root)
      if (seen.has(root)) return row // malformed cycle: keep records separate
      seen.add(root)
    }
    return root
  }
  const depth = row => {
    const seen = new Set(); let current = row
    while (parentOf.has(current) && !seen.has(current)) { seen.add(current); current = parentOf.get(current) }
    return seen.size
  }
  const consumed = new Set()
  for (const row of [...rows].sort((a, b) => depth(a) - depth(b))) {
    const root = rootOf(row)
    if (root === row) continue
    root.parts = mergeMessageParts(root.parts, row.parts)
    root.turnDeliveries.push(row)
    root.turnProjections.push(...row.turnProjections)
    root.turnRequestIds = [...new Set([...root.turnRequestIds, ...row.turnRequestIds])]
    root.streaming ||= row.streaming
    consumed.add(row)
  }
  return rows.filter(row => !consumed.has(row))
}

// Execution/revision instructions are control prose, not user answers. Keep originals intact.
export const discussionMessageText = message => (message?.turnControlRequest || message?.turnActionRequest || message?.turnAwaitingType || message?.turnProjections?.length) ? '' : (message?.content || '')
export const discussionFooterStatus = (status, isTaskDiscussion) => isTaskDiscussion &&
  ['本轮回话已结束', '本轮结果已登记', '本轮成果已就绪'].includes(status) ? '' : status

// Suppress only the known backend delivery wrapper after an exact request association.
export const discussionDeliveryText = message => message.content === deliveryNotice ? '' : discussionMessageText(message)

export const discussionTurnStatus = projection => ({
  QUEUED: '等待处理', RUNNING: '正在处理', WAITING_PROVIDER: '等待工具结果',
  RESULT_UNKNOWN: '结果待核实', ARCHIVING: '已生成，登记中', COMPLETED: '本轮完成',
  FAILED: '本轮未完成', CANCELLED: '本轮已取消'
})[projection?.actionProgress?.state] || '正在核对处理状态'

// One user-facing state for the whole linked reply, not one state per internal stage.
export const discussionReplyStatus = message => {
  const projections = message.turnProjections || []
  const latest = projections.at(-1)
  const hasResult = Boolean(message.parts?.length || message.turnDeliveries?.some(row => discussionDeliveryText(row)))
  if (!latest) return message.turnControlRequest ? '正在处理…' : ''
  if (latest.outcome.kind === 'ACTION_REQUEST') {
    const state = latest.actionProgress?.state
    if (['FAILED', 'CANCELLED', 'RESULT_UNKNOWN'].includes(state)) return discussionTurnStatus(latest)
    if (hasResult) return ''
    return state === 'COMPLETED' ? '正在读取成果…' : state === 'ARCHIVING' ? '已生成，登记中' : '正在处理…'
  }
  const review = latest.reviewProgress
  if (review?.state === 'REJECTED') return '本次修改未受理，原成果已保留。'
  if (['FAILED', 'CANCELLED', 'PARTIAL'].includes(review?.childState)) return '本次修改未完成，原成果已保留。'
  if (hasResult) return ''
  return review?.childState === 'COMPLETED' ? '正在读取答复…' : '正在处理…'
}
