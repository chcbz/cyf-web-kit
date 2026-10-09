const tenantPattern = /^(?:0|[1-9][0-9]{0,49})$/
const accountVersionPattern = /^(?:0|[1-9][0-9]{0,18})$/
const userIdPattern = /^[1-9][0-9]{0,18}$/

export const validIdentityAtom = value => typeof value === 'string' && value.trim() !== '' &&
  !/[\uD800-\uDFFF]/u.test(value) &&
  [...value].every(char => char.codePointAt(0) > 31 && char.codePointAt(0) !== 127)

const withinLong = value => value.length < 19 || value <= '9223372036854775807'
export const validAccountEpoch = value => typeof value === 'string' &&
  accountVersionPattern.test(value) && withinLong(value)
export const validAccountUserId = value => typeof value === 'string' &&
  userIdPattern.test(value) && withinLong(value)

const accountEpoch = value => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value)
  return validAccountEpoch(value) ? value : null
}
const validScopes = scopes => Array.isArray(scopes) && scopes.every(validIdentityAtom)
const scopeKey = scopes => JSON.stringify([...new Set(scopes)].sort())

function validBaseIdentity (identity, { issuer, clientId, tenantId }) {
  return identity != null && typeof identity === 'object' &&
    validIdentityAtom(issuer) && validIdentityAtom(clientId) &&
    typeof tenantId === 'string' && tenantPattern.test(tenantId) &&
    identity.issuer === issuer && identity.clientId === clientId && identity.tenantId === tenantId &&
    validIdentityAtom(identity.subject) && validIdentityAtom(identity.jiacn) && validScopes(identity.scopes)
}

/** Only a verified store may expose this identity to browser recovery keys. */
export function validFixedTenantIdentity (identity, expected) {
  return validBaseIdentity(identity, expected) && identity.tokenKind === 'user' &&
    validAccountUserId(identity.userId) && validAccountEpoch(identity.authEpoch)
}

function compactJwtPayload (token) {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return null
  const json = part => {
    const binary = atob(part.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(binary, character => character.charCodeAt(0))))
  }
  try {
    const header = json(parts[0])
    if (!validIdentityAtom(header?.alg) || header.alg.toLowerCase() === 'none') return null
    const claims = json(parts[1])
    return claims && typeof claims === 'object' && !Array.isArray(claims) ? claims : null
  } catch {
    return null
  }
}

/**
 * Decoding is NOT signature validation or admission. Call only after the trusted
 * /resource endpoint has accepted this exact bearer. Bind its identity to the
 * existing AccountSecurity uid/auth_epoch claims for profile and cache fencing.
 */
export function bindFixedTenantIdentity (resource, accessToken, expected) {
  if (!validBaseIdentity(resource, expected)) return null
  const claims = compactJwtPayload(accessToken)
  if (!claims || claims.token_kind !== 'user' || !validAccountUserId(claims.uid)) return null
  const epoch = accountEpoch(claims.auth_epoch)
  if (epoch === null || claims.iss !== resource.issuer || claims.sub !== resource.subject ||
      claims.client_id !== resource.clientId || claims.tenant_id !== resource.tenantId ||
      claims.jiacn !== resource.jiacn || claims.tenantId != null && claims.tenantId !== claims.tenant_id) return null
  const scopes = claims.scope == null ? [] : typeof claims.scope === 'string'
    ? claims.scope.trim().split(/\s+/) : claims.scope
  if (!validScopes(scopes) || scopeKey(scopes) !== scopeKey(resource.scopes)) return null
  // An enriched /resource response must agree too; never replace a conflicting
  // server user/version with claims decoded from browser storage.
  if (resource.tokenKind != null && resource.tokenKind !== 'user' ||
      resource.userId != null && String(resource.userId) !== claims.uid ||
      resource.authEpoch != null && accountEpoch(resource.authEpoch) !== epoch) return null
  return Object.freeze({ ...resource, tokenKind: 'user', userId: claims.uid, authEpoch: epoch,
    scopes: Object.freeze([...new Set(resource.scopes)].sort()) })
}
