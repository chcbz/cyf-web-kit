import { isWenMoney, formatWenMoney } from '../../utils/wenAmount.js'
// One all-candidate assessment contract; recommendation degree is not a success probability.
const text = value => typeof value === 'string' && value.trim().length > 0
export const isAvailableTaskQuote = quote => quote?.state === 'AVAILABLE' && text(quote.quoteId) && text(quote.recommendationId) && isWenMoney(quote.amount) && quote.unavailableReason == null
export const isTaskQuote = quote => isAvailableTaskQuote(quote) || (quote?.state === 'UNAVAILABLE' && text(quote.recommendationId) && quote.quoteId == null && quote.amount == null && text(quote.unavailableReason))
const unavailableQuoteText = {
  BILLING_ROUTE_MISSING: '暂无法报价：该承办人的计费配置尚未就绪，请选择其他承办人或联系平台。',
  MODEL_PRICE_MISSING: '暂无法报价：模型单价尚未登记，请联系平台。',
  TOKEN_PRICE_MISSING: '暂无法报价：模型用量单价不完整，请联系平台。',
  TOOL_PRICE_MISSING: '暂无法报价：所需收费工具尚未登记单价，请联系平台。',
  QUOTE_AMOUNT_OVERFLOW: '暂无法报价：预估费用超出支持范围，请缩小事项范围或联系平台。'
}
export const taskQuoteText = quote => {
  if (isAvailableTaskQuote(quote)) return `事项报价 ${formatWenMoney(quote.amount)}`
  if (quote?.state === 'UNAVAILABLE') return Object.hasOwn(unavailableQuoteText, quote.unavailableReason)
    ? unavailableQuoteText[quote.unavailableReason] : '暂无法报价：费用信息未就绪，请联系平台核查。'
  return '尚无报价，请刷新推荐'
}
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
