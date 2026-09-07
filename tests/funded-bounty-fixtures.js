// Exact W05 AgentTaskQuoteDTO / AgentTokenEstimateDTO / immutable claim receipt.
export const fundedQuote = (overrides = {}) => ({
  quoteId: 'q-1', taskId: 'funded', agentId: 'explicit-agent', taskVersion: '8',
  priceBookVersion: 'preview-v1', taskInputHash: 'task-hash', skillSetHash: 'skill-hash', modelRouteVersion: 'route-v1',
  estimatedTokens: { input: '1000', cachedInput: '200', output: '300', reasoning: '400' },
  estimatedComputeMicro: '10', worstComputeMicro: '20', platformFeeMicro: '3', grossAllocationMicro: '100',
  estimatedAgentPayoutMicro: '87', worstAgentPayoutMicro: '77', minimumAcceptedPayoutMicro: '1', budgetHeadroomMicro: '76',
  verifiedSkillMatch: true, advisoryAbilityMatch: true, recommendation: 'RECOMMENDED', reasonCodes: ['BUDGET_COVERED'],
  expiresAt: '9999999999999', ...overrides
})
export const fundedReceipt = (overrides = {}) => ({
  taskId: 'funded', agentId: 'explicit-agent', quoteId: 'q-1', status: 'assigned', taskVersion: '9', claimedAt: '1000', ...overrides
})
