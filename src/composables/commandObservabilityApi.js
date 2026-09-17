import { agentApi } from './useHttp.js'

const unwrap = result => {
  const body = result?.data ?? result
  if (!body || typeof body !== 'object' || body.code !== 'E0') {
    const error = new Error('协作运行看板响应无效。')
    error.businessFailure = true
    throw error
  }
  return body.data
}

const get = (path, params, options) => agentApi.get(path, params, { autoLoading: false, ...options }).then(unwrap)

/** Read-only boundary: this client deliberately exposes no mutation operations. */
export const commandObservabilityClient = Object.freeze({
  capabilities: options => get('/internal/command-operations/capabilities', undefined, options),
  metrics: options => get('/internal/command-operations/metrics', undefined, options),
  dlq: ({ afterDeliveryId = '0', limit = '20' } = {}, options) => get('/internal/command-operations/dlq', { afterDeliveryId, limit }, options),
  audit: ({ afterId = '0', limit = '20' } = {}, options) => get('/internal/command-operations/audit', { afterId, limit }, options)
})
