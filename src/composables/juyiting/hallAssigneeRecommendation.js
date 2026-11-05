import { isWenMoney, formatWenMoney } from '../../utils/wenAmount.js'
// One all-candidate assessment contract; recommendation degree is not a success probability.
const text = value => typeof value === 'string' && value.trim().length > 0
export const isAvailableTaskQuote = quote => quote?.state === 'AVAILABLE' && text(quote.quoteId) && text(quote.recommendationId) && isWenMoney(quote.amount) && quote.unavailableReason == null
export const isTaskQuote = quote => isAvailableTaskQuote(quote) || (quote?.state === 'UNAVAILABLE' && text(quote.recommendationId) && quote.quoteId == null && quote.amount == null && text(quote.unavailableReason))
export const taskQuoteText = quote => isAvailableTaskQuote(quote) ? `事项报价 ${formatWenMoney(quote.amount)}` : quote?.state === 'UNAVAILABLE' ? '暂无法报价，请选择其他承办人或稍后重试' : '尚无报价，请刷新推荐'
export const isRecommendedLevel = level => ['HIGH', 'MEDIUM'].includes(level)
export const recommendationLevelText = level => ({ HIGH: '优先推荐', MEDIUM: '可以考虑', LOW: '匹配较低', UNKNOWN: '资料不足' }[level] || '')
const strings = value => Array.isArray(value) && value.every(text)
export const recommendationTaskKey = task => JSON.stringify([task?.id, task?.taskVersion, task?.title, task?.description])
export const parseAssigneeRecommendation = (value, task) => {
  if (!value || Array.isArray(value) || value.taskId !== task?.id || value.taskVersion !== task?.taskVersion ||
      !['READY', 'NO_MATCH', 'NO_CANDIDATES'].includes(value.state) ||
      !Number.isSafeInteger(value.observedAt) || value.observedAt < 0 || !text(value.requirementSummary) ||
      typeof value.candidateSetComplete !== 'boolean' || !strings(value.questions) || value.questions.length !== 0 || !Array.isArray(value.recommendations)) throw new Error('承办推荐返回格式不正确')
  const seen = new Set()
  for (const item of value.recommendations) {
    const agent = item?.agent
    if (!isTaskQuote(item?.quote) || !text(agent?.agentId) || seen.has(agent.agentId) || !text(agent.name) || !strings(agent.abilities) ||
        typeof agent.canOperate !== 'boolean' || typeof agent.boundToMe !== 'boolean' || !text(agent.status) ||
        !['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'].includes(item.recommendationLevel) || !text(item.reason) || !strings(item.gaps) || !Array.isArray(item.evidence) || (item.recommendationLevel !== 'UNKNOWN' && !item.evidence.length) ||
        !item.evidence.every(e => text(e?.id) && text(e.kind) && text(e.label) && text(e.description) && e.available === true)) throw new Error('承办推荐依据未能核对')
    seen.add(agent.agentId)
  }
  if ((value.state === 'READY') !== value.recommendations.some(item => isRecommendedLevel(item.recommendationLevel)) ||
      (value.state === 'NO_CANDIDATES') !== (value.recommendations.length === 0)) throw new Error('承办推荐状态不一致')
  return value
}
