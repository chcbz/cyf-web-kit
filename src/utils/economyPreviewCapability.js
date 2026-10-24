import { economyApi } from '../composables/useHttp.js'

export const readEconomyCapability = capability =>
  capability && typeof capability === 'object' && !Array.isArray(capability) &&
  ['economyPreviewEnabled', 'skillMarketplaceEnabled', 'principalScopeSha256'].every(key => Object.hasOwn(capability, key)) && typeof capability.economyPreviewEnabled === 'boolean' &&
  typeof capability.skillMarketplaceEnabled === 'boolean' && typeof capability.principalScopeSha256 === 'string' &&
  /^[0-9a-f]{64}$/.test(capability.principalScopeSha256) ? { economyPreviewEnabled: capability.economyPreviewEnabled, skillMarketplaceEnabled: capability.skillMarketplaceEnabled, principalScopeSha256: capability.principalScopeSha256 } : null

export const isEconomyPreviewCapability = capability => readEconomyCapability(capability)?.economyPreviewEnabled === true
export const isSkillMarketplaceCapability = capability => isEconomyPreviewCapability(capability) && capability.skillMarketplaceEnabled === true

/**
 * Proposed preview API: GET /economy/capabilities. Missing or malformed data is
 * deliberately disabled; no wallet response or browser identity is a fallback.
 */
export const loadEconomyPreviewCapability = async ({ signal } = {}) =>
  readEconomyCapability(await economyApi.get('/capabilities', undefined, { autoLoading: false, signal }))
