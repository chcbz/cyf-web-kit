const DEFAULT_SAMPLE_RATE = 0.01
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/
const SENSITIVE_ROUTE_SEGMENT = /(?:authorization|bearer|cookie|password|secret|token|session|credential|api[-_]?key)/i
const OPAQUE_ROUTE_SEGMENT = /^(?:\d+|[0-9a-f]{8,}|[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}|[A-Za-z0-9_-]{32,})$/i
const SAFE_ROUTE_SEGMENTS = new Set([
  'agent', 'map', 'roster', 'tasks', 'search', 'status-counts', 'personas',
  'catalog', 'scenes', 'snapshot', 'chat', 'stream', 'conversation', 'events',
  'user', 'users', 'session', 'sessions', 'oauth2', 'token', 'auth', 'health'
])

let installedEndpoint = null

/**
 * Configures the optional same-origin RUM collector at app startup. Request
 * instrumentation remains inert when no valid endpoint is configured.
 */
export function installRequestRum ({ endpoint } = {}) {
  installedEndpoint = normalizeRumEndpoint(endpoint)
  return Boolean(installedEndpoint)
}

/**
 * Browser-side request timing with a deliberately small, fixed schema. The
 * reporter only receives route, request ID, duration, and a bounded status.
 */
export function recordRequestTiming ({
  endpoint,
  reporter,
  route,
  url,
  requestId,
  durationMs,
  status,
  errorClass,
  sampled = sampleRequestTiming()
} = {}) {
  if (!sampled) return false

  const payload = createRequestTimingPayload({ route, url, requestId, durationMs, status, errorClass })
  if (!payload) return false

  try {
    if (typeof reporter === 'function') {
      Promise.resolve(reporter(payload)).catch(() => {})
      return true
    }

    const rumEndpoint = normalizeRumEndpoint(endpoint) || installedEndpoint
    if (!rumEndpoint) return false
    sendRumPayload(rumEndpoint, payload)
    return true
  } catch {
    // RUM must never affect a business request, including reporter failures.
    return false
  }
}

export function createRequestTimingPayload ({ route, url, requestId, durationMs, status, errorClass } = {}) {
  const normalizedRoute = normalizeRouteTemplate(route || url)
  const normalizedRequestId = normalizeRequestId(requestId)
  if (!normalizedRoute || !normalizedRequestId) return null

  return {
    route: normalizedRoute,
    requestId: normalizedRequestId,
    durationMs: normalizeDuration(durationMs),
    status: normalizeStatus(status, errorClass)
  }
}

export function sampleRequestTiming (sampleRate = DEFAULT_SAMPLE_RATE, random = Math.random) {
  const rate = Number(sampleRate)
  if (!Number.isFinite(rate) || rate <= 0) return false
  if (rate >= 1) return true
  try {
    return random() < rate
  } catch {
    return false
  }
}

export function resolveRequestId (candidate) {
  return normalizeRequestId(candidate) || createRequestId()
}

export function normalizeRequestId (value) {
  const requestId = typeof value === 'string' ? value.trim() : ''
  return REQUEST_ID_PATTERN.test(requestId) ? requestId : null
}

export function normalizeRouteTemplate (input) {
  if (typeof input !== 'string' || !input) return null

  let parsed
  try {
    parsed = new URL(input, 'http://cyf.invalid')
  } catch {
    return null
  }

  if (parsed.username || parsed.password) return null
  const segments = parsed.pathname.split('/').filter(Boolean)
  const normalizedSegments = segments.map(normalizeRouteSegment)
  if (normalizedSegments.some(segment => !segment)) return null
  return normalizedSegments.length ? `/${normalizedSegments.join('/')}` : '/'
}

export function classifyRequestOutcome ({ status, failureClass } = {}) {
  if (failureClass && failureClass !== 'http') return failureClass
  if (Number.isInteger(status)) {
    if (status >= 200 && status < 400) return 'success'
    if (status >= 400 && status < 500) return 'http_4xx'
    if (status >= 500 && status < 600) return 'http_5xx'
    return 'http_other'
  }
  return 'unknown'
}

function createRequestId () {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (typeof uuid === 'string' && REQUEST_ID_PATTERN.test(uuid)) return uuid

  const entropy = Math.random().toString(36).slice(2) + Date.now().toString(36)
  return `web-${entropy}`.slice(0, 128)
}

function normalizeRouteSegment (segment) {
  let decoded
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    return ':redacted'
  }

  if (!decoded || decoded.length > 48 || decoded.includes('@') || SENSITIVE_ROUTE_SEGMENT.test(decoded)) {
    return ':redacted'
  }
  if (/^:[A-Za-z][A-Za-z0-9_-]{0,30}$/.test(decoded)) return decoded
  if (OPAQUE_ROUTE_SEGMENT.test(decoded)) return ':id'
  return SAFE_ROUTE_SEGMENTS.has(decoded) ? decoded : ':segment'
}

function normalizeDuration (durationMs) {
  const duration = Number(durationMs)
  if (!Number.isFinite(duration) || duration < 0) return 0
  return Math.round(Math.min(duration, 24 * 60 * 60 * 1000))
}

function normalizeStatus (status, failureClass) {
  const code = Number(status)
  if (Number.isInteger(code) && code >= 100 && code <= 599) return `${Math.floor(code / 100)}xx`

  return new Set(['network', 'deadline_exceeded', 'cancelled']).has(failureClass)
    ? failureClass
    : failureClass === 'success'
      ? '2xx'
      : failureClass === 'http_4xx'
        ? '4xx'
        : failureClass === 'http_5xx'
          ? '5xx'
          : failureClass === 'http_other'
            ? 'other'
            : 'unknown'
}

function normalizeRumEndpoint (endpoint) {
  if (typeof window === 'undefined' || typeof endpoint !== 'string' || !endpoint) return null
  try {
    const url = new URL(endpoint, window.location.origin)
    if (url.origin !== window.location.origin || url.search || url.hash) return null
    return url.pathname
  } catch {
    return null
  }
}

function sendRumPayload (endpoint, payload) {
  const body = JSON.stringify(payload)
  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }))
    return
  }
  if (typeof fetch === 'function') {
    Promise.resolve(fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'same-origin'
    })).catch(() => {})
  }
}
