import { encodeHallOnboardingSubject } from '../composables/juyiting/useHallOnboarding.js'

const runtimeEnv = import.meta.env ?? {}
const tenantPattern = /^(?:0|[1-9][0-9]{0,49})$/
const revisionPattern = /^(?:0|[1-9][0-9]{0,18})$/
const exact = value => typeof value === 'string' && value.trim() !== '' &&
  !/[\uD800-\uDFFF]/u.test(value) &&
  [...value].every(char => char.codePointAt(0) > 31 && char.codePointAt(0) !== 127)
const revision = value => revisionPattern.test(value) &&
  (value.length < 19 || value <= '9223372036854775807')

/** A browser recovery key is not an authority; the bearer and server ACL remain authoritative. */
export function browserBusinessNamespace (apiStore, globalStore, {
  mode = runtimeEnv.VITE_TENANT_SELECTION_MODE,
  origin = globalThis.location?.origin || globalThis.window?.location?.origin,
  issuer = runtimeEnv.VITE_OAUTH_ISSUER || apiStore?.baseUrl || origin,
  dataDomainId = runtimeEnv.VITE_DATA_DOMAIN_ID || 'cyf'
} = {}) {
  const client = apiStore?.oauthClientId
  if (mode == null || mode === '') {
    // Preserve the existing recovery keys for installations not yet in tenant mode.
    const owner = String(globalStore?.user?.id || globalStore?.user?.openid ||
      globalStore?.getUserId || globalStore?.getOpenid || '').trim()
    const tenant = String(globalStore?.user?.tenantId || globalStore?.user?.tenantCode ||
      globalStore?.user?.tenant || '').trim()
    return owner && exact(client) ? [tenant, client, owner].filter(Boolean).join('\u0000') : ''
  }
  if (mode !== 'fixed' && mode !== 'selectable') return ''
  const identity = apiStore?.tenantIdentity
  const ownerId = globalStore?.getUserId
  const ownerValid = Number.isSafeInteger(ownerId) && ownerId > 0 ||
    typeof ownerId === 'string' && /^[1-9][0-9]*$/.test(ownerId)
  if (!identity || !ownerValid || !exact(client) || !exact(origin) || !exact(issuer) ||
      !exact(dataDomainId) || !exact(identity.subject) || !exact(identity.jiacn) ||
      !exact(globalStore?.getJiacn) || identity.jiacn !== globalStore.getJiacn ||
      identity.clientId !== client || identity.issuer !== issuer ||
      identity.dataDomainId !== dataDomainId || !tenantPattern.test(identity.tenantId || '') ||
      !revision(identity.tenantSessionEpoch) || !revision(identity.membershipRevision) ||
      !revision(identity.clientTenantGrantRevision) || !Array.isArray(identity.scopes) ||
      !identity.scopes.every(exact)) return ''
  try {
    if (!apiStore.hasActiveToken() || apiStore.activeTenantId() !== identity.tenantId) return ''
  } catch {
    return ''
  }
  // Bind persisted opaque intent/recovery keys to a verified permission fingerprint.
  const fingerprint = [issuer, origin, client, identity.tenantId, dataDomainId,
    identity.subject, identity.jiacn, String(ownerId), identity.tenantSessionEpoch,
    identity.membershipRevision, identity.clientTenantGrantRevision, [...identity.scopes].sort()]
  return `tenant-v2:${encodeHallOnboardingSubject(JSON.stringify(fingerprint))}`
}
