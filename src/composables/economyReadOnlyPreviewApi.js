import { agentApi, createApi } from './useHttp.js'

/** Dedicated read-only namespace; never route preview data through legacy economy mutations. */
export const economyReadOnlyPreviewApi = createApi('/economy/preview')

const successCode = code => code === 'E0'

export function readEconomyReadOnlyPreviewPayload (result) {
  const body = result?.data ?? result
  if (!body || typeof body !== 'object') throw new Error('经济预览响应格式无效。')
  if (!Object.prototype.hasOwnProperty.call(body, 'code')) throw new Error('经济预览响应缺少状态码。')
  if (!successCode(body.code)) {
    const error = new Error(body.message || body.msg || `经济预览请求失败：${body.code}`)
    error.code = body.code
    error.businessFailure = true
    throw error
  }
  return body.data
}

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
