import { generateKeyPairSync, sign, verify } from 'node:crypto'

// Offline fixture keys stay in memory. These are not issued account credentials.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
export const fixedRuntime = Object.freeze({
  VITE_TENANT_SELECTION_MODE: 'fixed', VITE_DEFAULT_TENANT_ID: '1',
  VITE_OAUTH_CLIENT_ID: 'cyf-local', VITE_OAUTH_ISSUER: 'https://auth.fixed.example',
  VITE_OAUTH_BASE_URL: 'https://oauth.fixed.example', VITE_API_BASE_URL: 'https://api.fixed.example'
})

export function basicClaims (overrides = {}) {
  const now = Math.floor(Date.now() / 1000)
  return { iss: fixedRuntime.VITE_OAUTH_ISSUER, sub: 'alice', client_id: 'cyf-local',
    tenant_id: '1', token_kind: 'user', uid: '42', jiacn: 'owner-A', username: 'alice',
    auth_epoch: 7, scope: ['openid', 'write'], iat: now, exp: now + 300, ...overrides }
}

export function signedToken (claims = basicClaims()) {
  const head = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'offline-fixture' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const content = `${head}.${body}`
  return `${content}.${sign('RSA-SHA256', Buffer.from(content), privateKey).toString('base64url')}`
}

export function verifiedClaims (token) {
  const [head, body, signature] = token.split('.')
  if (!verify('RSA-SHA256', Buffer.from(`${head}.${body}`), publicKey, Buffer.from(signature, 'base64url'))) {
    throw new Error('Offline signature verification failed')
  }
  return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
}

export function resourceIdentity (claims = basicClaims()) {
  return { issuer: claims.iss, subject: claims.sub, clientId: claims.client_id,
    tenantId: claims.tenant_id, jiacn: claims.jiacn,
    scopes: typeof claims.scope === 'string' ? claims.scope.split(/\s+/) : claims.scope || [] }
}
