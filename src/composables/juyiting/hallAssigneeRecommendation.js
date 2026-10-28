// R1 only. Additive harmless fields are allowed; old scored arrays are not a second lane.
const text = value => typeof value === 'string' && value.trim().length > 0
const strings = value => Array.isArray(value) && value.every(text)
export const recommendationTaskKey = task => JSON.stringify([task?.id, task?.taskVersion, task?.title, task?.description])
export const parseAssigneeRecommendation = (value, task) => {
  if (!value || Array.isArray(value) || value.taskId !== task?.id || value.taskVersion !== task?.taskVersion ||
      !['READY', 'NEEDS_CLARIFICATION', 'NO_MATCH', 'NO_CANDIDATES'].includes(value.state) ||
      !Number.isSafeInteger(value.observedAt) || value.observedAt < 0 || !text(value.requirementSummary) ||
      typeof value.candidateSetComplete !== 'boolean' || !strings(value.questions) || !Array.isArray(value.recommendations)) throw new Error('承办推荐返回格式不正确')
  const seen = new Set()
  for (const item of value.recommendations) {
    const agent = item?.agent
    if (!text(agent?.agentId) || seen.has(agent.agentId) || !text(agent.name) || !strings(agent.abilities) ||
        typeof agent.canOperate !== 'boolean' || typeof agent.boundToMe !== 'boolean' || !text(agent.status) ||
        !text(item.reason) || !strings(item.gaps) || !Array.isArray(item.evidence) || !item.evidence.length ||
        !item.evidence.every(e => text(e?.id) && text(e.kind) && text(e.label) && text(e.description) && e.available === true)) throw new Error('承办推荐依据未能核对')
    seen.add(agent.agentId)
  }
  if ((value.state === 'READY') !== Boolean(value.recommendations.length) ||
      (value.state === 'NEEDS_CLARIFICATION' && !value.questions.length)) throw new Error('承办推荐状态不一致')
  return value
}
