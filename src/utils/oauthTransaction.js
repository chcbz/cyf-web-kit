export const OAUTH_TRANSACTION_STORAGE_KEY = 'cyf.oauth.pending.v1'
export const OAUTH_TRANSACTION_TTL_MS = 10 * 60 * 1000
export const OAUTH_RETURN_PATH_MAX_UTF8_BYTES = 2048
export const OAUTH_RETURN_PATH_MAX_DECODE_PASSES = 32

const STATE_BYTES = 32
const VERIFIER_BYTES = 64
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/
const TRANSACTION_FIELDS = Object.freeze([
  'authorizationServer',
  'clientId',
  'codeVerifier',
  'createdAt',
  'expiresAt',
  'redirectUri',
  'returnTo',
  'state',
  'version'
])

export class OAuthTransactionError extends Error {
  constructor (code, message) {
    super(message)
    this.name = 'OAuthTransactionError'
    this.code = code
  }
}

function browserStorage () {
  if (!globalThis.window?.sessionStorage) {
    throw new OAuthTransactionError('storage_unavailable', 'OAuth session storage is unavailable')
  }
  return globalThis.window.sessionStorage
}

function browserCrypto () {
  const crypto = globalThis.window?.crypto || globalThis.crypto
  if (!crypto?.getRandomValues || !crypto?.subtle) {
    throw new OAuthTransactionError('crypto_unavailable', 'Secure browser crypto is unavailable')
  }
  return crypto
}

function base64UrlEncode (bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function randomBase64Url (byteLength, cryptoImpl) {
  const bytes = new Uint8Array(byteLength)
  cryptoImpl.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

function isExpectedRandomValue (value, byteLength) {
  return typeof value === 'string' &&
    value.length === Math.ceil(byteLength * 4 / 3) &&
    BASE64URL_PATTERN.test(value)
}

function containsControlCharacter (value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) return true
  }
  return false
}

function timingSafeEqual (left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false
  let mismatch = 0
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return mismatch === 0
}

function requiredExactString (value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new OAuthTransactionError('invalid_runtime_configuration', 'OAuth runtime configuration is invalid')
  }
  return value
}

function runtimeConfiguration ({ clientId, redirectUri, authorizationServer }) {
  return Object.freeze({
    clientId: requiredExactString(clientId),
    redirectUri: requiredExactString(redirectUri),
    authorizationServer: requiredExactString(authorizationServer)
  })
}

function hasExactTransactionFields (transaction) {
  if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) return false
  const fields = Object.keys(transaction).sort()
  return fields.length === TRANSACTION_FIELDS.length &&
    fields.every((field, index) => field === TRANSACTION_FIELDS[index])
}

function isEpochMilliseconds (value) {
  return Number.isSafeInteger(value) && value >= 0
}

function utf8ByteLength (value) {
  return new TextEncoder().encode(value).byteLength
}

function isBoundedSafeDecodeValue (value) {
  return utf8ByteLength(value) <= OAUTH_RETURN_PATH_MAX_UTF8_BYTES &&
    !value.includes('\\') &&
    !containsControlCharacter(value)
}

function fullyDecodeWithinBudget (value) {
  let decoded = value
  for (let pass = 0; pass < OAUTH_RETURN_PATH_MAX_DECODE_PASSES; pass += 1) {
    if (!isBoundedSafeDecodeValue(decoded)) return null
    if (!decoded.includes('%')) return decoded

    let next
    try {
      next = decodeURIComponent(decoded)
    } catch {
      return null
    }
    if (!isBoundedSafeDecodeValue(next)) return null
    if (next === decoded || !next.includes('%')) return next
    decoded = next
  }
  return null
}

function normalizedSafeAppRelativePath (value) {
  if (typeof value !== 'string' ||
      !value.startsWith('/') ||
      value.startsWith('//') ||
      !isBoundedSafeDecodeValue(value)) return null

  const decoded = fullyDecodeWithinBudget(value)
  if (decoded === null) return null

  try {
    const parsed = new URL(value, 'https://cyf.invalid')
    const decodedParsed = new URL(decoded, 'https://cyf.invalid')
    if (parsed.origin !== 'https://cyf.invalid' || decodedParsed.origin !== 'https://cyf.invalid') return null
    if (decodedParsed.pathname === '/oauth2/callback' || decodedParsed.pathname.startsWith('/oauth2/callback/')) return null
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return null
  }
}

export function safeAppRelativePath (candidate, fallback = '/') {
  return normalizedSafeAppRelativePath(candidate) ||
    normalizedSafeAppRelativePath(fallback) ||
    '/'
}

export async function createOAuthTransaction ({
  returnTo = '/',
  clientId,
  redirectUri,
  authorizationServer,
  storage = browserStorage(),
  cryptoImpl = browserCrypto(),
  now = Date.now()
} = {}) {
  const config = runtimeConfiguration({ clientId, redirectUri, authorizationServer })
  if (!isEpochMilliseconds(now) || !Number.isSafeInteger(now + OAUTH_TRANSACTION_TTL_MS)) {
    throw new OAuthTransactionError('invalid_clock', 'OAuth transaction clock is invalid')
  }

  const transaction = {
    version: 1,
    state: randomBase64Url(STATE_BYTES, cryptoImpl),
    codeVerifier: randomBase64Url(VERIFIER_BYTES, cryptoImpl),
    returnTo: safeAppRelativePath(returnTo),
    createdAt: now,
    expiresAt: now + OAUTH_TRANSACTION_TTL_MS,
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    authorizationServer: config.authorizationServer
  }
  storage.setItem(OAUTH_TRANSACTION_STORAGE_KEY, JSON.stringify(transaction))
  return Object.freeze(transaction)
}

export async function createCodeChallenge (codeVerifier, cryptoImpl = browserCrypto()) {
  if (!isExpectedRandomValue(codeVerifier, VERIFIER_BYTES)) {
    throw new OAuthTransactionError('invalid_verifier', 'PKCE verifier is invalid')
  }
  const digest = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
  return base64UrlEncode(new Uint8Array(digest))
}

export function consumeOAuthTransaction (receivedState, {
  clientId,
  redirectUri,
  authorizationServer,
  storage = browserStorage(),
  now = Date.now()
} = {}) {
  const serialized = storage.getItem(OAUTH_TRANSACTION_STORAGE_KEY)
  storage.removeItem(OAUTH_TRANSACTION_STORAGE_KEY)

  if (!serialized) {
    throw new OAuthTransactionError('missing_transaction', 'OAuth transaction was not found')
  }

  const config = runtimeConfiguration({ clientId, redirectUri, authorizationServer })
  let transaction
  try {
    transaction = JSON.parse(serialized)
  } catch {
    throw new OAuthTransactionError('invalid_transaction', 'OAuth transaction is invalid')
  }

  if (!hasExactTransactionFields(transaction) ||
      transaction.version !== 1 ||
      !isExpectedRandomValue(transaction.state, STATE_BYTES) ||
      !isExpectedRandomValue(transaction.codeVerifier, VERIFIER_BYTES) ||
      !isEpochMilliseconds(transaction.createdAt) ||
      !isEpochMilliseconds(transaction.expiresAt) ||
      transaction.expiresAt - transaction.createdAt !== OAUTH_TRANSACTION_TTL_MS ||
      !isEpochMilliseconds(now) ||
      transaction.createdAt > now ||
      safeAppRelativePath(transaction.returnTo, '') !== transaction.returnTo ||
      typeof transaction.clientId !== 'string' || transaction.clientId.trim() === '' ||
      typeof transaction.redirectUri !== 'string' || transaction.redirectUri.trim() === '' ||
      typeof transaction.authorizationServer !== 'string' || transaction.authorizationServer.trim() === '') {
    throw new OAuthTransactionError('invalid_transaction', 'OAuth transaction is invalid')
  }
  if (now >= transaction.expiresAt) {
    throw new OAuthTransactionError('expired_transaction', 'OAuth transaction has expired')
  }
  if (!timingSafeEqual(receivedState, transaction.state)) {
    throw new OAuthTransactionError('state_mismatch', 'OAuth state does not match')
  }
  if (!timingSafeEqual(config.clientId, transaction.clientId) ||
      !timingSafeEqual(config.redirectUri, transaction.redirectUri) ||
      !timingSafeEqual(config.authorizationServer, transaction.authorizationServer)) {
    throw new OAuthTransactionError('configuration_mismatch', 'OAuth runtime configuration does not match')
  }

  return Object.freeze({
    codeVerifier: transaction.codeVerifier,
    returnTo: transaction.returnTo,
    clientId: transaction.clientId,
    redirectUri: transaction.redirectUri,
    authorizationServer: transaction.authorizationServer
  })
}
