import { economyApi } from '@/composables/useHttp'

export const readEconomyCapability = capability =>
  capability && typeof capability === 'object' && !Array.isArray(capability) ? capability : null

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
