// Exact W05 AgentTaskQuoteDTO / AgentTokenEstimateDTO / immutable claim receipt.
export const fundedQuote = (overrides = {}) => ({
  quoteId: 'q-1', taskId: 'funded', agentId: 'explicit-agent', taskVersion: '8',
  priceBookVersion: 'preview-v1', taskInputSha256: 'a'.repeat(64), skillSetSha256: 'b'.repeat(64), modelRouteVersion: 'route-v1',
  estimatedTokens: { input: '1000', cachedInput: '200', output: '300', reasoning: '400' },
  estimatedComputeWen: '10', worstComputeWen: '20', platformFeeWen: '3', grossAllocationWen: '100',
  estimatedAgentPayoutWen: '87', worstAgentPayoutWen: '77', minimumAcceptedPayoutWen: '1', budgetHeadroomWen: '76',
  verifiedSkillMatch: true, advisoryAbilityMatch: true, recommendation: 'RECOMMENDED', reasonCodes: ['BUDGET_COVERED'],
  expiresAt: 9999999999999, ...overrides
})
export const fundedReceipt = (overrides = {}) => ({
  taskId: 'funded', agentId: 'explicit-agent', quoteId: 'q-1', status: 'assigned', taskVersion: '9', claimedAt: 1000, ...overrides
})
