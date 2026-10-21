import { completedExecutionDelivery } from './bountyOutputCatalog.js'

/** Context selection only. The server reconstructs all exact retained outputs;
 * this adapter never makes source selectors, finalization writes or model intent. */
export function mediaDeliveryChoices (projections, entries, context) {
  const snapshots = entries.map(entry => entry.request)
  const nodes = []
  let hasMedia = false
  for (const value of projections) {
    if (value.state !== 'READY' || value.route !== 'CHAT' || value.outcome?.taskId !== context.taskId ||
      value.outcome.assignmentRevision !== context.assignmentRevision || value.conversationId !== context.conversationId ||
      value.conversationGeneration !== context.conversationGeneration) continue
    const outcome = value.outcome
    if (outcome.kind === 'ACTION_REQUEST' && value.actionProgress?.childRoute === 'EXECUTE') {
      if (['FAILED', 'CANCELLED'].includes(value.actionProgress.state)) continue
      if (value.actionProgress.state !== 'COMPLETED') return []
      hasMedia = true
      const request = snapshots.find(item => item.requestId === value.requestId)
      const turn = request?.turns?.find(item => item.turnId === value.turnId)
      if (!turn || turn.targetAgentId !== context.targetAgentId) throw new Error('媒体成果上下文尚未核对，请刷新后重试。')
      const { purpose: _purpose, ...raw } = value
      const node = completedExecutionDelivery(raw, request, turn, snapshots, context.taskId)
      if (!node) continue
      if (!node.stepId) throw new Error('本轮媒体成果尚未完成，请等待结果后继续。')
      nodes.push({ ...node, label: `消息 ${request.userMessageId} · ${outcome.text.slice(0, 60)}` })
    } else if (outcome.kind === 'SUBMISSION_REQUEST') {
      hasMedia = true
      nodes.push({ outcomeId: outcome.outcomeId, finalSha256: outcome.finalSha256, deliveryRelation: outcome.deliveryRelation,
        label: `消息 ${outcome.assistantMessageId} · ${outcome.text.slice(0, 60)}` })
    } else if (outcome.kind === 'ANSWER' && outcome.deliverable === true) {
      nodes.push({ outcomeId: outcome.outcomeId, finalSha256: outcome.finalSha256,
        deliveryRelation: outcome.deliveryRelation, label: `消息 ${outcome.assistantMessageId} · ${outcome.text.slice(0, 60)}` })
    }
  }
  if (!hasMedia) return []
  const byId = new Map(nodes.map(node => [node.outcomeId, node]))
  if (byId.size !== nodes.length) throw new Error('成果关联重复，请刷新后重试。')
  const parents = new Set()
  for (const node of nodes) {
    const visited = new Set()
    let cursor = node
    while (cursor.deliveryRelation) {
      if (visited.has(cursor.outcomeId)) throw new Error('成果关联异常，请刷新后重试。')
      visited.add(cursor.outcomeId)
      const relation = cursor.deliveryRelation
      const parent = byId.get(relation.parentOutcomeId)
      if (!parent || parent.finalSha256 !== relation.parentFinalSha256) throw new Error('成果关联尚未完整读取，请刷新后重试。')
      parents.add(parent.outcomeId)
      cursor = parent
    }
  }
  // Independent roots/branches are explicit choices, never sorted into latest-wins.
  return nodes.filter(node => !parents.has(node.outcomeId))
}
