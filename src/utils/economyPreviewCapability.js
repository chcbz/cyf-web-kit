import { economyApi } from '@/composables/useHttp'

const responseBody = result => result?.data ?? result

export const readEconomyCapability = (result) => {
  const body = responseBody(result)
  const code = body?.code
  if (code !== undefined && code !== null && code !== 'E0' && code !== '0' && code !== 0 && code !== '200' && code !== 200) return null
  const capability = body?.data ?? body
  if (!capability || typeof capability !== 'object') return null
  return capability
}

export const isEconomyPreviewCapability = capability => capability?.economyPreviewEnabled === true
export const isSkillMarketplaceCapability = capability => isEconomyPreviewCapability(capability) &&
  capability?.skillMarketplaceEnabled === true && typeof capability?.principalScopeFingerprint === 'string' &&
  Boolean(capability.principalScopeFingerprint.trim())

/**
 * Proposed preview API: GET /economy/capabilities. Missing or malformed data is
 * deliberately disabled; no wallet response or browser identity is a fallback.
 */
export const loadEconomyPreviewCapability = async ({ signal } = {}) =>
  readEconomyCapability(await economyApi.get('/capabilities', undefined, { autoLoading: false, signal }))
