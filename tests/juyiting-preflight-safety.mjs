import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isIP } from 'node:net'

export const MAX_PREFLIGHT_DEADLINE_MS = 5 * 60 * 1000
export const APPROVAL_MANIFEST_SCHEMA = 'juyiting-public-beta-preflight-approval-v1'
export const PREFLIGHT_APPROVAL_SCOPE = Object.freeze([
  'agent-websocket',
  'credentialed-api',
  'oauth-browser-smoke'
])
export const UI_SMOKE_APPROVAL_SCOPE = Object.freeze(['oauth-browser-smoke'])

const APPROVAL_CONFIRM_ENV = 'JUYITING_PREFLIGHT_APPROVE_NON_LOOPBACK'
const APPROVAL_MANIFEST_ENV = 'JUYITING_PREFLIGHT_APPROVAL_MANIFEST'
const APPROVAL_SHA_ENV = 'JUYITING_PREFLIGHT_APPROVAL_MANIFEST_SHA256'
const LOCAL_INSECURE_TLS_ENV = 'JUYITING_ALLOW_INSECURE_LOCAL_TLS'
const DEADLINE_ENV = 'JUYITING_PREFLIGHT_DEADLINE_MS'
const SHA256_PATTERN = /^[a-f0-9]{64}$/i
const URL_PATTERN = /\b(?:https?|wss?):\/\/[^\s"'<>]+/gi

const REQUIREMENTS = {
  preflight: {
    scope: PREFLIGHT_APPROVAL_SCOPE,
    credentials: {
      apiKey: ['JIA_AGENT_API_KEY'],
      agentId: ['JIA_AGENT_WS_AGENT_ID', 'JIA_AGENT_SMOKE_AGENT_ID'],
      username: ['JIA_LOGIN_USER', 'JUYITING_USERNAME'],
      password: ['JIA_LOGIN_PASSWORD', 'JUYITING_PASSWORD'],
      oauthClientId: ['JUYITING_OAUTH_CLIENT_ID'],
      oauthRedirectUri: ['JUYITING_OAUTH_REDIRECT_URI']
    }
  },
  ui: {
    scope: UI_SMOKE_APPROVAL_SCOPE,
    credentials: {
      username: ['JUYITING_USERNAME', 'JIA_LOGIN_USER'],
      password: ['JUYITING_PASSWORD', 'JIA_LOGIN_PASSWORD'],
      oauthClientId: ['JUYITING_OAUTH_CLIENT_ID'],
      oauthRedirectUri: ['JUYITING_OAUTH_REDIRECT_URI']
    }
  }
}

const ownKeysExactly = (value, expected) => (
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
)

const explicitValue = (env, names, label) => {
  for (const name of names) {
    const value = env[name]
    if (typeof value === 'string' && value.trim()) return value
  }
  throw new Error(`Missing required explicit ${label} env: ${names.join(' or ')}`)
}

const optionalValue = (env, names) => {
  for (const name of names) {
    const value = env[name]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

const parseDeadlineMs = (env) => {
  const raw = optionalValue(env, [DEADLINE_ENV]) || String(MAX_PREFLIGHT_DEADLINE_MS)
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0 || value > MAX_PREFLIGHT_DEADLINE_MS) {
    throw new Error(`${DEADLINE_ENV} must be an integer from 1 through ${MAX_PREFLIGHT_DEADLINE_MS}`)
  }
  return value
}

const parseTarget = (raw, label) => {
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${label} target must be a valid URL`)
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${label} target scheme must be http or https`)
  }
  if (url.username || url.password) throw new Error(`${label} target must not contain URL userinfo`)
  if (url.hash) throw new Error(`${label} target must not contain a fragment`)
  if (url.search) throw new Error(`${label} target must not contain a query string`)
  if (url.pathname !== '/') throw new Error(`${label} target must be an origin without a path`)
  return url
}

const normalizedHostname = (url) => url.hostname.replace(/^\[|\]$/g, '').toLowerCase()

export const isLoopbackUrl = (url) => {
  const hostname = normalizedHostname(url)
  if (hostname === 'localhost') return true
  const ipVersion = isIP(hostname)
  if (ipVersion === 4) return hostname.split('.')[0] === '127'
  return ipVersion === 6 && hostname === '::1'
}

const assertTargetTransport = (url, label) => {
  if (!isLoopbackUrl(url) && url.protocol !== 'https:') {
    throw new Error(`${label} target must use HTTPS when it is not loopback`)
  }
}

const assertRedirectUri = (raw, frontend) => {
  let redirect
  try {
    redirect = new URL(raw)
  } catch {
    throw new Error('OAuth redirect URI must be a valid explicit URL')
  }
  if (!['http:', 'https:'].includes(redirect.protocol)) {
    throw new Error('OAuth redirect URI scheme must be http or https')
  }
  if (redirect.username || redirect.password) throw new Error('OAuth redirect URI must not contain URL userinfo')
  if (redirect.hash || redirect.search) throw new Error('OAuth redirect URI must not contain a query or fragment')
  if (redirect.origin !== frontend.origin) {
    throw new Error('OAuth redirect URI origin must exactly match the frontend target origin')
  }
  return redirect.href
}

const assertExactScope = (actual, expected) => {
  if (!Array.isArray(actual) || actual.some(item => typeof item !== 'string' || !item)) {
    throw new Error('Approval manifest scope is malformed')
  }
  const unique = new Set(actual)
  if (unique.size !== actual.length) throw new Error('Approval manifest scope is malformed')
  const actualSorted = [...actual].sort()
  const expectedSorted = [...expected].sort()
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    throw new Error('Approval manifest scope does not exactly match the requested operation')
  }
}

const verifyApprovalManifest = async ({ env, targets, scope, readFileImpl, signal }) => {
  if (env[APPROVAL_CONFIRM_ENV] !== 'YES') {
    throw new Error(`Non-loopback targets require exact ${APPROVAL_CONFIRM_ENV}=YES confirmation`)
  }
  const manifestPath = explicitValue(env, [APPROVAL_MANIFEST_ENV], 'approval manifest path')
  const expectedSha = explicitValue(env, [APPROVAL_SHA_ENV], 'approval manifest SHA-256').toLowerCase()
  if (!SHA256_PATTERN.test(expectedSha)) {
    throw new Error(`${APPROVAL_SHA_ENV} must be exactly 64 hexadecimal characters`)
  }

  let bytes
  try {
    bytes = await readFileImpl(manifestPath, signal ? { signal } : undefined)
  } catch {
    if (signal?.aborted) throw signal.reason
    throw new Error('Approval manifest could not be read')
  }
  const actualSha = createHash('sha256').update(bytes).digest('hex')
  if (actualSha !== expectedSha) throw new Error('Approval manifest SHA-256 mismatch')

  let manifest
  try {
    manifest = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error('Approval manifest must contain valid JSON')
  }
  if (!ownKeysExactly(manifest, ['schemaVersion', 'targetOrigins', 'scope'])) {
    throw new Error('Approval manifest has malformed or extra top-level fields')
  }
  if (manifest.schemaVersion !== APPROVAL_MANIFEST_SCHEMA) {
    throw new Error('Approval manifest schema version mismatch')
  }
  if (!ownKeysExactly(manifest.targetOrigins, ['backend', 'frontend'])) {
    throw new Error('Approval manifest targetOrigins is malformed')
  }
  if (manifest.targetOrigins.backend !== targets.backend.origin ||
      manifest.targetOrigins.frontend !== targets.frontend.origin) {
    throw new Error('Approval manifest target origin mismatch')
  }
  assertExactScope(manifest.scope, scope)

  return { path: manifestPath, sha256: actualSha }
}

export const validateSafetyConfig = async ({
  mode,
  env = process.env,
  readFileImpl = readFile,
  signal
}) => {
  const requirement = REQUIREMENTS[mode]
  if (!requirement) throw new Error(`Unsupported preflight safety mode: ${mode}`)
  const deadlineMs = parseDeadlineMs(env)

  const backend = parseTarget(
    optionalValue(env, ['JIA_BACKEND_URL', 'JUYITING_BACKEND_URL']) || 'https://localhost:10018',
    'Backend'
  )
  const frontend = parseTarget(
    optionalValue(env, ['JIA_FRONTEND_URL', 'JUYITING_FRONTEND_URL']) || 'https://localhost:8080',
    'Frontend'
  )
  assertTargetTransport(backend, 'Backend')
  assertTargetTransport(frontend, 'Frontend')

  const credentials = {}
  for (const [key, names] of Object.entries(requirement.credentials)) {
    credentials[key] = explicitValue(env, names, key)
  }
  credentials.oauthRedirectUri = assertRedirectUri(credentials.oauthRedirectUri, frontend)

  const allLoopback = isLoopbackUrl(backend) && isLoopbackUrl(frontend)
  const localTlsFlag = optionalValue(env, [LOCAL_INSECURE_TLS_ENV])
  if (localTlsFlag && localTlsFlag !== 'YES') {
    throw new Error(`${LOCAL_INSECURE_TLS_ENV} must be unset or exactly YES`)
  }
  const inheritedInsecureTls = env.NODE_TLS_REJECT_UNAUTHORIZED === '0'
  if ((localTlsFlag === 'YES' || inheritedInsecureTls) && !allLoopback) {
    throw new Error('Insecure TLS is forbidden for non-loopback targets')
  }
  if (inheritedInsecureTls && localTlsFlag !== 'YES') {
    throw new Error(`Inherited insecure TLS requires explicit local-only ${LOCAL_INSECURE_TLS_ENV}=YES`)
  }

  const targets = { backend, frontend }
  const approval = allLoopback
    ? null
    : await verifyApprovalManifest({ env, targets, scope: requirement.scope, readFileImpl, signal })

  return {
    mode,
    targets,
    targetOrigins: { backend: backend.origin, frontend: frontend.origin },
    credentials,
    approvalScope: [...requirement.scope],
    approval,
    allLoopback,
    allowInsecureTls: localTlsFlag === 'YES',
    deadlineMs
  }
}

const terminationError = (label, reason) => {
  const error = new Error(`Preflight stopped before ${label}: ${reason}`)
  error.code = 'PREFLIGHT_TERMINATED'
  return error
}

export class PreflightTerminationGuard {
  constructor ({
    deadlineMs,
    signalTarget = process,
    now = Date.now,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout
  }) {
    if (!Number.isInteger(deadlineMs) || deadlineMs <= 0 || deadlineMs > MAX_PREFLIGHT_DEADLINE_MS) {
      throw new Error(`Global preflight deadline must be at most ${MAX_PREFLIGHT_DEADLINE_MS}ms`)
    }
    this.now = now
    this.deadlineAt = now() + deadlineMs
    this.signalTarget = signalTarget
    this.clearTimeoutImpl = clearTimeoutImpl
    this.controller = new AbortController()
    this.terminationReason = ''
    this.cleanups = new Set()
    this.cleanupPromise = Promise.resolve([])
    this.signalHandlers = new Map()

    for (const signal of ['SIGINT', 'SIGTERM']) {
      const handler = () => this.terminate(`received ${signal}`)
      this.signalHandlers.set(signal, handler)
      signalTarget.on(signal, handler)
    }
    this.deadlineTimer = setTimeoutImpl(() => this.terminate('global deadline exceeded'), deadlineMs)
    this.deadlineTimer?.unref?.()
  }

  get signal () {
    return this.controller.signal
  }

  get terminated () {
    return Boolean(this.terminationReason)
  }

  remainingMs () {
    return Math.max(0, this.deadlineAt - this.now())
  }

  beforeBoundary (label) {
    if (!this.terminated && this.remainingMs() <= 0) this.terminate('global deadline exceeded')
    if (this.terminated) throw terminationError(label, this.terminationReason)
  }

  operationSignal (label, timeoutMs) {
    this.beforeBoundary(label)
    const remaining = this.remainingMs()
    const boundedTimeout = Math.max(1, Math.min(timeoutMs, remaining))
    return AbortSignal.any([this.signal, AbortSignal.timeout(boundedTimeout)])
  }

  runPromise (promise, label) {
    const source = Promise.resolve(promise)
    try {
      this.beforeBoundary(label)
    } catch (error) {
      source.catch(() => {})
      return Promise.reject(error)
    }
    let onAbort
    const aborted = new Promise((_resolvePromise, rejectPromise) => {
      onAbort = () => rejectPromise(this.signal.reason || terminationError(label, this.terminationReason))
      if (this.signal.aborted) onAbort()
      else this.signal.addEventListener('abort', onAbort, { once: true })
    })
    return Promise.race([source, aborted]).finally(() => {
      this.signal.removeEventListener('abort', onAbort)
    })
  }

  runFetch (fetchImpl, url, options, label, timeoutMs) {
    const boundarySignal = this.operationSignal(label, timeoutMs)
    const signal = options?.signal
      ? AbortSignal.any([boundarySignal, options.signal])
      : boundarySignal
    this.beforeBoundary(label)
    return fetchImpl(url, { ...(options || {}), signal })
  }

  trackCleanup (cleanup) {
    let active = true
    let invoked = false
    const run = () => {
      if (!active || invoked) return undefined
      invoked = true
      return cleanup()
    }
    this.cleanups.add(run)
    if (this.terminated) {
      const lateCleanup = Promise.resolve().then(run)
      this.cleanupPromise = Promise.allSettled([this.cleanupPromise, lateCleanup])
    }
    return () => {
      active = false
      this.cleanups.delete(run)
    }
  }

  terminate (reason) {
    if (this.terminated) return this.cleanupPromise
    this.terminationReason = reason
    this.controller.abort(terminationError('active operation', reason))
    const cleanups = [...this.cleanups]
    this.cleanupPromise = Promise.allSettled(cleanups.map(cleanup => Promise.resolve().then(cleanup)))
    return this.cleanupPromise
  }

  async dispose () {
    if (this.deadlineTimer) this.clearTimeoutImpl(this.deadlineTimer)
    for (const [signal, handler] of this.signalHandlers) this.signalTarget.off(signal, handler)
    this.signalHandlers.clear()
    let pendingCleanup
    do {
      pendingCleanup = this.cleanupPromise
      await pendingCleanup
    } while (pendingCleanup !== this.cleanupPromise)
  }
}

export const createSafetyContext = async ({
  mode,
  env = process.env,
  readFileImpl = readFile,
  signalTarget = process,
  now = Date.now,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout
}) => {
  const deadlineMs = parseDeadlineMs(env)
  const guard = new PreflightTerminationGuard({
    deadlineMs,
    signalTarget,
    now,
    setTimeoutImpl,
    clearTimeoutImpl
  })
  try {
    const config = await guard.runPromise(
      validateSafetyConfig({ mode, env, readFileImpl, signal: guard.signal }),
      'safety configuration validation'
    )
    return { config, guard, env }
  } catch (error) {
    await guard.dispose()
    throw error
  }
}

export const applyLocalTlsPolicy = (context) => {
  const { config, env } = context
  const previous = env.NODE_TLS_REJECT_UNAUTHORIZED
  if (config.allowInsecureTls) env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  return () => {
    if (previous === undefined) delete env.NODE_TLS_REJECT_UNAUTHORIZED
    else env.NODE_TLS_REJECT_UNAUTHORIZED = previous
  }
}

export const redactUrl = (value) => {
  try {
    const url = new URL(String(value))
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return '[REDACTED_URL]'
    return `${url.origin}${url.pathname}`
  } catch {
    return '[REDACTED_URL]'
  }
}

export const credentialValuesFromEnv = (env = process.env) => [
  env.JIA_AGENT_API_KEY,
  env.JIA_LOGIN_PASSWORD,
  env.JUYITING_PASSWORD,
  env.JIA_LOGIN_USER,
  env.JUYITING_USERNAME,
  env.JIA_AGENT_WS_AGENT_ID,
  env.JIA_AGENT_SMOKE_AGENT_ID,
  env.JUYITING_OAUTH_CLIENT_ID
].filter(value => typeof value === 'string' && value.length >= 3)

export const sanitizeMessage = (value, secrets = []) => {
  let message = String(value ?? '')
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join('[REDACTED]')
    const encoded = encodeURIComponent(secret || '')
    if (encoded) message = message.split(encoded).join('[REDACTED]')
  }
  return message.replace(URL_PATTERN, match => redactUrl(match))
}

export const sanitizeError = (error, secrets = []) => sanitizeMessage(error?.message || error, secrets)
