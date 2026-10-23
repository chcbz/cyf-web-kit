import { agentApi } from './useHttp.js'

const get = (path, params, options) => agentApi.get(path, params, { autoLoading: false, ...options })

/** Read-only boundary: this client deliberately exposes no mutation operations. */
export const commandObservabilityClient = Object.freeze({
  capabilities: options => get('/internal/command-operations/capabilities', undefined, options),
  metrics: options => get('/internal/command-operations/metrics', undefined, options),
  dlq: ({ afterDeliveryId = '0', limit = '20' } = {}, options) => get('/internal/command-operations/dlq', { afterDeliveryId, limit }, options),
  audit: ({ afterId = '0', limit = '20' } = {}, options) => get('/internal/command-operations/audit', { afterId, limit }, options)
})
