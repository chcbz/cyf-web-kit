import { createHydratedIdentityScope } from './identityScope.js'
import { encodeHallOnboardingSubject } from '../composables/juyiting/useHallOnboarding.js'
import { validFixedTenantIdentity } from './fixedTenantIdentity.js'

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
  issuer = runtimeEnv.VITE_OAUTH_ISSUER || runtimeEnv.VITE_OAUTH_BASE_URL || apiStore?.baseUrl || origin,
  dataDomainId = runtimeEnv.VITE_DATA_DOMAIN_ID || 'cyf',
  tenantId = runtimeEnv.VITE_DEFAULT_TENANT_ID
} = {}) {
  const client = apiStore?.oauthClientId
  if (mode == null || mode === '') {
    // Preserve the existing recovery keys for installations not yet in tenant mode.
    return createHydratedIdentityScope(globalStore?.user, client)
  }
  if (mode !== 'fixed' && mode !== 'selectable') return ''
  const identity = apiStore?.tenantIdentity
  const ownerId = globalStore?.getUserId
  const ownerValid = Number.isSafeInteger(ownerId) && ownerId > 0 ||
    typeof ownerId === 'string' && /^[1-9][0-9]*$/.test(ownerId)
  if (!identity || !ownerValid || !exact(client) || !exact(origin) || !exact(issuer) ||
      !exact(identity.subject) || !exact(identity.jiacn) ||
      !exact(globalStore?.getJiacn) || identity.jiacn !== globalStore.getJiacn ||
      identity.clientId !== client || identity.issuer !== issuer ||
      !tenantPattern.test(identity.tenantId || '') || !Array.isArray(identity.scopes) ||
      !identity.scopes.every(exact)) return ''
  if (mode === 'fixed') {
    if (!validFixedTenantIdentity(identity, { issuer, clientId: client, tenantId }) ||
        identity.userId !== String(ownerId)) return ''
  } else if (!exact(dataDomainId) || identity.dataDomainId !== dataDomainId ||
      !revision(identity.tenantSessionEpoch) || !revision(identity.membershipRevision) ||
      !revision(identity.clientTenantGrantRevision)) return ''
  try {
    if (!apiStore.hasActiveToken() || apiStore.activeTenantId() !== identity.tenantId) return ''
  } catch {
    return ''
  }
  if (mode === 'fixed') {
    // AccountSecurity auth_epoch fences same-user re-login/revocation too. Old
    // platform/tenant-zero recovery records deliberately use a different key.
    const fingerprint = [issuer, origin, client, identity.tenantId, identity.subject,
      identity.jiacn, identity.userId, identity.authEpoch, [...identity.scopes].sort()]
    return `tenant-fixed-v1:${encodeHallOnboardingSubject(JSON.stringify(fingerprint))}`
  }
  // Bind persisted opaque intent/recovery keys to a verified permission fingerprint.
  const fingerprint = [issuer, origin, client, identity.tenantId, dataDomainId,
    identity.subject, identity.jiacn, String(ownerId), identity.tenantSessionEpoch,
    identity.membershipRevision, identity.clientTenantGrantRevision, [...identity.scopes].sort()]
  return `tenant-v2:${encodeHallOnboardingSubject(JSON.stringify(fingerprint))}`
}
