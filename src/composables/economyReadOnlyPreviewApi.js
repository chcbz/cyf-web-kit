import { agentApi, createApi } from './useHttp.js'

/** Dedicated read-only namespace; never route preview data through legacy economy mutations. */
export const economyReadOnlyPreviewApi = createApi('/economy/preview')

// Errors are already rejected by the shared HTTP decoder.
export const readEconomyReadOnlyPreviewPayload = result => result

const get = async (path, params, options) => readEconomyReadOnlyPreviewPayload(
  await economyReadOnlyPreviewApi.get(path, params, { autoLoading: false, ...options })
)
const post = async (path, payload, options) => readEconomyReadOnlyPreviewPayload(
  await economyReadOnlyPreviewApi.post(path, payload, { autoLoading: false, ...options })
)

export const economyReadOnlyPreviewClient = Object.freeze({
  capabilities: options => get('/capabilities', undefined, options),
  wallet: options => get('/wallet', undefined, options),
  ledger: ({ cursor, limit = '50' } = {}, options) => get('/ledger', { ...(cursor ? { cursor } : {}), limit }, options),
  catalog: ({ offset = '0', limit = '50' } = {}, options) => get('/skill-products', { offset, limit }, options),
  product: (productId, options) => get(`/skill-products/${encodeURIComponent(productId)}`, undefined, options),
  agentSkills: (agentId, options) => get(`/agents/${encodeURIComponent(agentId)}/skills`, undefined, options),
  hostingPlan: options => get('/hosting-plan', undefined, options),
  hostingLease: (agentId, options) => get(`/agents/${encodeURIComponent(agentId)}/hosting-lease`, undefined, options),
  estimate: (payload, options) => post('/bounty-estimates', payload, options),
  roster: options => agentApi.create('/roster', { pageNum: 1, pageSize: 50 }, { autoLoading: false, ...options })
})
