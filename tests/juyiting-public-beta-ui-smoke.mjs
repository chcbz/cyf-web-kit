import { spawn } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import {
  applyLocalTlsPolicy,
  assertApprovedHttpUrl,
  cleanupFailure,
  completeTrackedCleanup,
  createSafetyContext,
  credentialValuesFromEnv,
  fetchApprovedOrigin,
  isLoopbackUrl,
  redactUrl,
  sanitizeError,
  stopProcessTree,
  waitForProcessTreeExit
} from './juyiting-preflight-safety.mjs'

const DEBUG_KEY = '__JYTING_SCENE_DEBUG__'
const EXPECTED_MANIFEST_VERSION = 'persona-sheets-v1'
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_CDP_COMMAND_TIMEOUT_MS = 45_000
const GAME_LOOKUP_SOURCE = `
  let juyitingGame = window.__JYTING_GAME__;
  if (!juyitingGame) {
    let component = document.querySelector('.hall-stage')?.__vueParentComponent;
    while (component && !component.setupState?.juyitingGame) component = component.parent;
    juyitingGame = component?.setupState?.juyitingGame;
  }
  if (!juyitingGame) throw new Error('Mounted Juyiting game instance is unavailable');
`
const DEFAULT_CHROME_CANDIDATES = [
  '/usr/local/bin/chromium-headless-smoke',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
]
const SCENE_HOTSPOTS = {
  chat: 'main-seat',
  tasks: 'bounty-board',
  library: 'library-shelf'
}

const REQUIRED_BROWSER_API_PATHS = Object.freeze({
  mapAgents: '/agent/map',
  snapshot: '/agent/scenes/juyiting-main/snapshot',
  events: '/agent/scenes/juyiting-main/events'
})

const headerValue = (headers, name) => {
  const expected = name.toLowerCase()
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === expected) return String(value)
  }
  return ''
}

const httpUrlOrNull = value => {
  try {
    const url = new URL(String(value))
    return ['http:', 'https:'].includes(url.protocol) ? url : null
  } catch {
    return null
  }
}

export class BrowserOriginPolicy {
  constructor (config, token, now = Date.now) {
    this.frontendOrigin = config.targetOrigins.frontend
    this.backendOrigin = config.targetOrigins.backend
    this.token = token
    this.now = now
    this.requiredApiPaths = new Set(Object.values(REQUIRED_BROWSER_API_PATHS))
    this.observedRequiredApiPaths = new Set()
    this.observedBearerOrigins = new Set()
  }

  assertDocumentUrl (value, label = 'browser document') {
    let url
    try {
      url = new URL(String(value))
    } catch {
      throw new Error(`${label} URL is malformed`)
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error(`${label} URL violates browser navigation safety policy`)
    }
    if (url.origin !== this.frontendOrigin) {
      throw new Error(`${label} crossed an unapproved origin`)
    }
    return url
  }

  classifyApiPath (pathname) {
    for (const [fixture, suffix] of Object.entries(REQUIRED_BROWSER_API_PATHS)) {
      if (pathname === suffix || pathname.endsWith(`/api${suffix}`)) return { fixture, suffix }
    }
    return null
  }

  inspectPausedRequest ({ request, resourceType }) {
    const rawUrl = request?.url || ''
    if (resourceType === 'Document') this.assertDocumentUrl(rawUrl, 'browser frame navigation')

    const url = httpUrlOrNull(rawUrl)
    const authorization = headerValue(request?.headers, 'authorization')
    if (authorization) {
      if (!url || url.origin !== this.backendOrigin) {
        throw new Error('Browser Bearer traffic crossed the approved backend origin')
      }
      if (authorization !== `Bearer ${this.token}`) {
        throw new Error('Browser Bearer traffic did not use the approved smoke token')
      }
      this.observedBearerOrigins.add(url.origin)
    }

    if (!url) return null
    const api = this.classifyApiPath(url.pathname)
    if (!api) return null
    if (url.origin !== this.backendOrigin) {
      throw new Error('Built frontend API base does not match the approved backend origin')
    }
    if (request?.method === 'OPTIONS') {
      if (headerValue(request.headers, 'origin') !== this.frontendOrigin) {
        throw new Error('Browser API preflight did not originate from the approved frontend origin')
      }
      return { ...api, preflight: true }
    }
    if (authorization !== `Bearer ${this.token}`) {
      throw new Error('Required browser API request did not carry the approved Bearer token')
    }
    this.observedRequiredApiPaths.add(api.suffix)
    return { ...api, preflight: false }
  }

  assertFrameTree (frameTree) {
    const visit = node => {
      if (!node?.frame) throw new Error('CDP frame tree is malformed')
      this.assertDocumentUrl(node.frame.url, 'browser frame')
      for (const child of node.childFrames || []) visit(child)
    }
    visit(frameTree)
  }

  assertFinalState (state) {
    if (!state?.isTopFrame) throw new Error('Final browser state is not the top frame')
    const finalUrl = this.assertDocumentUrl(state.url, 'final browser navigation')
    if (finalUrl.pathname !== '/juyiting') {
      throw new Error('Final browser navigation left the approved Juyiting route')
    }
    if (state.storageOrigin !== this.frontendOrigin) {
      throw new Error('Token localStorage was read outside the approved frontend origin')
    }
    let stored
    try {
      stored = JSON.parse(state.apiToken || '')
    } catch {
      throw new Error('Approved frontend api_token localStorage is malformed')
    }
    if (stored?.data !== this.token || !Number.isFinite(stored?.expTime) || stored.expTime <= this.now()) {
      throw new Error('Approved frontend api_token localStorage does not contain the active smoke token')
    }
    const missing = [...this.requiredApiPaths].filter(path => !this.observedRequiredApiPaths.has(path))
    if (missing.length) {
      throw new Error(`Built frontend API base was not verified for required paths: ${missing.join(', ')}`)
    }
    if (this.observedBearerOrigins.size !== 1 || !this.observedBearerOrigins.has(this.backendOrigin)) {
      throw new Error('Browser Bearer traffic was not exclusively bound to the approved backend origin')
    }
    return finalUrl
  }

  tokenBootstrapSource () {
    return `(() => {
      if (window.top !== window || location.origin !== ${JSON.stringify(this.frontendOrigin)}) return;
      localStorage.setItem('api_token', ${JSON.stringify(JSON.stringify({
        data: this.token,
        expTime: this.now() + 24 * 60 * 60 * 1000
      }))});
    })();`
  }
}

const parseBoundedTimeout = (raw, fallback, label) => {
  const value = raw === undefined || raw === '' ? fallback : Number(raw)
  if (!Number.isInteger(value) || value <= 0 || value > 60_000) {
    throw new Error(`${label} must be an integer from 1 through 60000`)
  }
  return value
}

const guardedDelay = async (runtime, durationMs, label) => {
  runtime.guard.beforeBoundary(label)
  await delay(Math.min(durationMs, runtime.guard.remainingMs()), undefined, { signal: runtime.guard.signal })
  runtime.guard.beforeBoundary(label)
}

const resolveOAuthLocation = (runtime, location) => {
  if (!location) return ''
  let url
  try {
    url = new URL(location, runtime.config.targets.backend)
  } catch {
    throw new Error('OAuth redirect location is malformed')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error('OAuth redirect location violates URL safety policy')
  }
  const redirect = new URL(runtime.config.credentials.oauthRedirectUri)
  if (![runtime.config.targets.backend.origin, redirect.origin].includes(url.origin)) {
    throw new Error('OAuth redirect location crossed an unapproved origin')
  }
  return url.href
}

class CookieJar {
  constructor () {
    this.cookies = new Map()
  }

  store (response) {
    const setCookie = response.headers.getSetCookie?.() || []
    for (const cookie of setCookie) {
      const [pair] = cookie.split(';')
      const index = pair.indexOf('=')
      if (index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1))
    }
  }

  header () {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ')
  }
}

export const requestJson = async (
  runtime,
  url,
  options = {},
  label = 'credentialed JSON request',
  expectedOrigin = runtime.config.targetOrigins.backend
) => {
  const response = await fetchApprovedOrigin({
    guard: runtime.guard,
    fetchImpl: runtime.fetchImpl,
    url,
    options,
    label,
    timeoutMs: runtime.requestTimeoutMs,
    expectedOrigin
  })
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}`)
  return response.json()
}

const base64Url = (buffer) => buffer
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '')

const fetchWithCookies = async (runtime, jar, url, options = {}, label) => {
  runtime.guard.beforeBoundary(label)
  const headers = new Headers(options.headers || {})
  const cookie = jar.header()
  if (cookie) headers.set('Cookie', cookie)
  const response = await fetchApprovedOrigin({
    guard: runtime.guard,
    fetchImpl: runtime.fetchImpl,
    url,
    options: { ...options, headers },
    label,
    timeoutMs: runtime.requestTimeoutMs,
    expectedOrigin: runtime.config.targetOrigins.backend,
    rejectRedirectStatus: false
  })
  jar.store(response)
  return response
}

const getToken = async (runtime) => {
  const jar = new CookieJar()
  const codeVerifier = base64Url(randomBytes(48))
  const codeChallenge = base64Url(createHash('sha256').update(codeVerifier).digest())
  const redirectUri = runtime.config.credentials.oauthRedirectUri
  const authorizeUrl = new URL('/oauth2/authorize', runtime.config.targets.backend)
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: runtime.config.credentials.oauthClientId,
    scope: 'openid',
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state: '/juyiting'
  }).toString()

  runtime.guard.beforeBoundary('credentialed OAuth authorization request')
  await fetchWithCookies(runtime, jar, authorizeUrl, {}, 'credentialed OAuth authorization request')
  runtime.guard.beforeBoundary('credentialed OAuth login submission')
  const loginResponse = await fetchWithCookies(runtime, jar, new URL('/login', runtime.config.targets.backend), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      loginType: 'password',
      username: runtime.config.credentials.username,
      password: runtime.config.credentials.password,
      redirect_uri: ''
    })
  }, 'credentialed OAuth login submission')

  let nextUrl = resolveOAuthLocation(runtime, loginResponse.headers.get('location')) || authorizeUrl.href
  let code = ''
  const expectedRedirect = new URL(redirectUri)
  for (let i = 0; i < 8 && nextUrl; i++) {
    runtime.guard.beforeBoundary('credentialed OAuth redirect follow')
    const parsedNext = new URL(nextUrl)
    if (parsedNext.origin === expectedRedirect.origin && parsedNext.pathname === expectedRedirect.pathname) {
      code = parsedNext.searchParams.get('code') || ''
      break
    }
    const response = await fetchWithCookies(
      runtime,
      jar,
      parsedNext,
      {},
      'credentialed OAuth redirect follow'
    )
    nextUrl = resolveOAuthLocation(runtime, response.headers.get('location'))
  }
  if (!code) throw new Error('OAuth authorization code was not returned')

  runtime.guard.beforeBoundary('credentialed OAuth token exchange')
  const data = await requestJson(runtime, new URL('/oauth2/token', runtime.config.targets.backend), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: runtime.config.credentials.oauthClientId,
      code_verifier: codeVerifier
    })
  }, 'credentialed OAuth token exchange')
  if (!data.access_token) throw new Error('OAuth token response did not include access_token')
  return data.access_token
}

const pathExists = async (path) => {
  try {
    const { access } = await import('node:fs/promises')
    await access(path)
    return true
  } catch {
    return false
  }
}

const findChrome = async (runtime) => {
  const candidates = [runtime.env.CHROME_PATH, ...DEFAULT_CHROME_CANDIDATES].filter(Boolean)
  for (const candidate of candidates) {
    runtime.guard.beforeBoundary('Chromium executable lookup')
    if (await runtime.guard.runPromise(pathExists(candidate), 'Chromium executable lookup')) return candidate
  }
  throw new Error('Chrome or Edge executable not found. Set CHROME_PATH to run UI smoke.')
}

const waitForJson = async (runtime, url, expectedOrigin, timeoutMs = 15000) => {
  const deadlineAt = Date.now() + Math.min(timeoutMs, runtime.guard.remainingMs())
  let lastError
  while (Date.now() < deadlineAt) {
    runtime.guard.beforeBoundary('Chromium DevTools polling request')
    try {
      return await requestJson(
        runtime,
        url,
        {},
        'Chromium DevTools polling request',
        expectedOrigin
      )
    } catch (error) {
      if (runtime.guard.terminated) throw error
      lastError = error
      await guardedDelay(runtime, 250, 'Chromium DevTools polling delay')
    }
  }
  throw lastError || new Error('Timed out waiting for Chromium DevTools JSON')
}

export class CdpSession {
  constructor (runtime, webSocketUrl, WebSocketCtor) {
    runtime.guard.beforeBoundary('Chromium DevTools WebSocket connection')
    this.runtime = runtime
    this.nextId = 1
    this.pending = new Map()
    this.events = []
    this.handlers = new Map()
    this.pendingHandlers = new Set()
    this.handlerErrors = []
    this.socketErrors = []
    this.activityVersion = 0
    this.opened = false
    this.closing = false
    this.closed = false
    this.ws = new WebSocketCtor(webSocketUrl)
    this.onSocketError = error => {
      if (!this.opened) return
      this.recordSocketError(error, 'CDP WebSocket emitted an error')
    }
    this.onSocketClose = () => {
      if (!this.opened || this.closing) return
      this.recordSocketError(new Error('CDP WebSocket closed unexpectedly'))
    }
    this.ws.addEventListener('error', this.onSocketError)
    this.ws.addEventListener('close', this.onSocketClose)
  }

  async open () {
    this.runtime.guard.beforeBoundary('Chromium DevTools WebSocket open')
    await new Promise((resolvePromise, rejectPromise) => {
      const cleanup = () => {
        this.runtime.guard.signal.removeEventListener('abort', onAbort)
        this.ws.removeEventListener?.('open', onOpen)
        this.ws.removeEventListener?.('error', onOpenError)
        this.ws.removeEventListener?.('close', onOpenClose)
      }
      const fail = error => {
        cleanup()
        rejectPromise(error)
      }
      const onAbort = () => fail(new Error('CDP open stopped by termination/deadline'))
      const onOpen = () => {
        this.opened = true
        cleanup()
        resolvePromise()
      }
      const onOpenError = error => fail(this.normalizeSocketError(error, 'CDP WebSocket open failed'))
      const onOpenClose = () => fail(new Error('CDP WebSocket closed before opening'))
      this.runtime.guard.signal.addEventListener('abort', onAbort, { once: true })
      this.ws.addEventListener('open', onOpen, { once: true })
      this.ws.addEventListener('error', onOpenError, { once: true })
      this.ws.addEventListener('close', onOpenClose, { once: true })
    })
    this.ws.addEventListener('message', event => {
      let message
      try {
        message = JSON.parse(event.data)
      } catch (error) {
        this.recordSocketError(error, 'CDP WebSocket delivered malformed JSON')
        return
      }
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject, timer } = this.pending.get(message.id)
        this.pending.delete(message.id)
        clearTimeout(timer)
        if (message.error) reject(new Error(message.error.message))
        else resolve(message.result || {})
      } else if (message.method) {
        this.events.push(message)
        const handler = this.handlers.get(message.method)
        if (handler) {
          this.activityVersion++
          const task = Promise.resolve().then(() => handler(message.params || {}))
          this.pendingHandlers.add(task)
          task.catch(error => {
            this.handlerErrors.push(error instanceof Error ? error : new Error(String(error)))
          }).finally(() => {
            this.pendingHandlers.delete(task)
          })
        }
      }
    })
  }

  on (method, handler) {
    this.handlers.set(method, handler)
  }

  normalizeSocketError (error, fallback) {
    if (error instanceof Error) return error
    if (error?.error instanceof Error) return error.error
    return new Error(fallback)
  }

  recordSocketError (error, fallback = 'CDP WebSocket failed') {
    this.activityVersion++
    this.socketErrors.push(this.normalizeSocketError(error, fallback))
  }

  throwHandlerErrors () {
    const error = this.handlerErrors.shift()
    if (error) throw error
  }

  throwTerminalErrors () {
    const errors = [
      ...this.handlerErrors.splice(0),
      ...this.socketErrors.splice(0)
    ]
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) throw new AggregateError(errors, 'CDP terminal state reported errors')
  }

  async waitForTrackedHandlers ({ guarded = true } = {}) {
    while (true) {
      if (guarded) this.runtime.guard.beforeBoundary('CDP tracked handler barrier')
      const observedVersion = this.activityVersion
      if (this.pendingHandlers.size) {
        await Promise.allSettled([...this.pendingHandlers])
      }
      await new Promise(resolvePromise => setImmediate(resolvePromise))
      if (!this.pendingHandlers.size && this.activityVersion === observedVersion) return
    }
  }

  async terminalBarrier () {
    this.runtime.guard.beforeBoundary('CDP terminal session barrier')
    await this.send('Runtime.evaluate', {
      expression: 'void 0',
      returnByValue: true,
      awaitPromise: true
    })
    await this.waitForTrackedHandlers()
    this.throwTerminalErrors()
  }

  send (method, params = {}) {
    this.runtime.guard.beforeBoundary(`CDP ${method}`)
    const id = this.nextId++
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolvePromise, rejectPromise) => {
      const timeoutMs = Math.max(1, Math.min(
        this.runtime.cdpCommandTimeoutMs,
        this.runtime.guard.remainingMs()
      ))
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) rejectPromise(new Error(`${method} timed out`))
      }, timeoutMs)
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer })
    })
  }

  close () {
    if (this.closePromise) return this.closePromise
    this.closing = true
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer)
      reject(new Error('CDP session closed'))
    }
    this.pending.clear()
    const socketClosePromise = new Promise((resolvePromise, rejectPromise) => {
      if (this.ws.readyState === 3) {
        resolvePromise()
        return
      }
      let timer
      let settled = false
      const finish = error => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.ws.removeEventListener?.('close', onClose)
        this.ws.removeEventListener?.('error', onError)
        if (error) rejectPromise(error)
        else resolvePromise()
      }
      const onClose = () => finish()
      const onError = error => finish(error instanceof Error ? error : new Error('CDP WebSocket close failed'))
      this.ws.addEventListener('close', onClose, { once: true })
      this.ws.addEventListener('error', onError, { once: true })
      const closeTimeoutMs = this.runtime.cdpCloseTimeoutMs || 3000
      timer = setTimeout(() => finish(new Error(`CDP WebSocket did not close within ${closeTimeoutMs}ms`)), closeTimeoutMs)
      try {
        this.ws.close()
      } catch (error) {
        finish(error)
      }
    })
    this.closePromise = socketClosePromise.then(async () => {
      this.closed = true
      await this.waitForTrackedHandlers({ guarded: false })
      this.throwTerminalErrors()
    }).finally(() => {
      this.ws.removeEventListener?.('error', this.onSocketError)
      this.ws.removeEventListener?.('close', this.onSocketClose)
    })
    return this.closePromise
  }
}

const waitForExpression = async (runtime, cdp, expression, timeoutMs = 20000) => {
  const deadlineAt = Date.now() + Math.min(timeoutMs, runtime.guard.remainingMs())
  let lastValue
  while (Date.now() < deadlineAt) {
    runtime.guard.beforeBoundary('CDP expression polling')
    cdp.throwHandlerErrors()
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    })
    lastValue = result.result?.value
    if (lastValue) return lastValue
    await guardedDelay(runtime, 500, 'CDP expression polling delay')
  }
  throw new Error(`Timed out waiting for expression. Last value: ${JSON.stringify(lastValue)}`)
}

const evaluate = async (cdp, expression) => {
  cdp.throwHandlerErrors()
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime.evaluate failed')
  return result.result?.value
}

const fulfillJson = (runtime, cdp, requestId, status, value) => cdp.send('Fetch.fulfillRequest', {
  requestId,
  responseCode: status,
  responseHeaders: [
    { name: 'Content-Type', value: 'application/json; charset=utf-8' },
    { name: 'Access-Control-Allow-Origin', value: runtime.config.targets.frontend.origin },
    { name: 'Access-Control-Allow-Headers', value: 'Authorization, Content-Type' }
  ],
  body: Buffer.from(JSON.stringify(value)).toString('base64')
})

const fulfillSse = (runtime, cdp, requestId, body) => cdp.send('Fetch.fulfillRequest', {
  requestId,
  responseCode: 200,
  responseHeaders: [
    { name: 'Content-Type', value: 'text/event-stream; charset=utf-8' },
    { name: 'Cache-Control', value: 'no-cache' },
    { name: 'Access-Control-Allow-Origin', value: runtime.config.targets.frontend.origin },
    { name: 'Access-Control-Allow-Headers', value: 'Authorization, Content-Type' }
  ],
  body: Buffer.from(body).toString('base64')
})

const fulfillCorsPreflight = (runtime, cdp, requestId) => cdp.send('Fetch.fulfillRequest', {
  requestId,
  responseCode: 204,
  responseHeaders: [
    { name: 'Access-Control-Allow-Origin', value: runtime.config.targets.frontend.origin },
    { name: 'Access-Control-Allow-Headers', value: 'Authorization, Content-Type' },
    { name: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' }
  ]
})

const debugExpression = predicate => `(() => {
  const debug = window[${JSON.stringify(DEBUG_KEY)}];
  return Boolean(debug && (${predicate}));
})()`

const refreshDebugExpression = `(() => {
  ${GAME_LOOKUP_SOURCE}
  return juyitingGame.getSceneDebugSnapshot();
})()`

const readDebug = async cdp => {
  await evaluate(cdp, refreshDebugExpression)
  return evaluate(cdp, `window[${JSON.stringify(DEBUG_KEY)}]`)
}

const sameTransform = (left, right, tolerance = 1e-6) => (
  Math.abs(left.zoom - right.zoom) <= tolerance &&
  Math.abs(left.offsetX - right.offsetX) <= tolerance &&
  Math.abs(left.offsetY - right.offsetY) <= tolerance
)

const centerWorld = camera => ({
  x: (camera.viewport.width / 2 - camera.offsetX) / camera.zoom,
  y: (camera.viewport.height / 2 - camera.offsetY) / camera.zoom
})

const sceneFixtures = () => {
  const startedAt = Date.now() - 30_000
  const expectedArrivalAt = Date.now() + 90_000
  const state = {
    agentId: 'agent-songjiang',
    personaCode: 'songjiang',
    behavior: 'moving_to_discussion',
    originRegionId: 'main-seat',
    targetRegionId: 'council-table',
    relatedType: 'discussion',
    relatedId: 'ui-smoke-discussion',
    phase: 'moving',
    stateVersion: 1,
    startedAt,
    expectedArrivalAt,
    expiresAt: expectedArrivalAt + 300_000
  }
  return {
    mapAgents: {
      status: 200,
      code: 'E0',
      msg: 'ok',
      data: [{
        agentId: state.agentId,
        personaCode: state.personaCode,
        name: 'Songjiang',
        status: 'online'
      }]
    },
    snapshot: {
      status: 200,
      code: 'E0',
      msg: 'ok',
      data: {
        sceneId: 'juyiting-main',
        sceneVersion: 128,
        generatedAt: Date.now(),
        agents: [{ agentId: state.agentId, personaCode: state.personaCode, status: 'online' }],
        states: [state]
      }
    },
    event: {
      sceneVersion: 129,
      eventType: 'agent-scene-state-updated',
      state: {
        ...state,
        stateVersion: 2,
        relatedId: 'ui-smoke-discussion-update',
        startedAt: Date.now(),
        expectedArrivalAt: Date.now() + 120_000
      },
      occurredAt: Date.now()
    }
  }
}

export const waitForChildSpawn = async (runtime, child, label = 'child process spawn') => {
  runtime.guard.beforeBoundary(label)
  await runtime.guard.runPromise(new Promise((resolvePromise, rejectPromise) => {
    if (!child?.once) {
      rejectPromise(new Error(`${label} did not return an observable child process`))
      return
    }
    const onSpawn = () => {
      child.removeListener?.('error', onError)
      resolvePromise()
    }
    const onError = error => {
      child.removeListener?.('spawn', onSpawn)
      rejectPromise(error)
    }
    child.once('spawn', onSpawn)
    child.once('error', onError)
  }), label)
}

const waitForTaskkill = child => new Promise((resolvePromise, rejectPromise) => {
  const onError = error => {
    child.removeListener?.('exit', onExit)
    rejectPromise(error)
  }
  const onExit = code => {
    child.removeListener?.('error', onError)
    if (code === 0) resolvePromise()
    else rejectPromise(new Error(`taskkill exited with code ${code}`))
  }
  child.once('error', onError)
  child.once('exit', onExit)
})

export const stopChrome = async (chrome, userDataDir, options = {}) => {
  const spawnImpl = options.spawnImpl || spawn
  const removeImpl = options.removeImpl || rm
  const stopProcessTreeImpl = options.stopProcessTreeImpl || stopProcessTree
  const waitForProcessTreeExitImpl = options.waitForProcessTreeExitImpl || waitForProcessTreeExit
  const errors = []
  let chromeStopped = !chrome

  if (chrome) {
    try {
      if (process.platform === 'win32' && chrome.pid) {
        const taskkill = spawnImpl('taskkill', ['/pid', String(chrome.pid), '/t', '/f'], {
          stdio: 'ignore',
          windowsHide: true
        })
        await waitForTaskkill(taskkill)
        await waitForProcessTreeExitImpl({ child: chrome, label: 'Chromium', timeoutMs: 3000 })
      } else {
        await stopProcessTreeImpl({
          child: chrome,
          label: 'Chromium',
          termTimeoutMs: 1500,
          killTimeoutMs: 1500
        })
      }
      chromeStopped = true
    } catch (error) {
      errors.push(error)
    }
  }

  if (userDataDir && chromeStopped) {
    let removed = false
    for (let attempt = 0; attempt < 5 && !removed; attempt++) {
      try {
        await removeImpl(userDataDir, { recursive: true, force: true })
        removed = true
      } catch (error) {
        if (attempt === 4) errors.push(new Error(`Temporary browser profile cleanup failed: ${error.message}`))
        else await delay(500)
      }
    }
  } else if (userDataDir && !chromeStopped) {
    errors.push(new Error('Temporary browser profile was retained because the Chromium process tree is still alive'))
  }

  if (errors.length) throw new AggregateError(errors, 'Chromium cleanup failed')
}

const clickSceneHotspot = async (cdp, hotspotId) => {
  const objectName = SCENE_HOTSPOTS[hotspotId]
  if (!objectName) throw new Error(`Unknown scene hotspot: ${hotspotId}`)
  const point = await evaluate(cdp, `(() => {
    ${GAME_LOOKUP_SOURCE}
    const canvas = document.querySelector('.melon-layer canvas');
    const rect = canvas?.getBoundingClientRect();
    const viewport = juyitingGame.getSceneDebugSnapshot?.().camera?.viewport;
    const area = juyitingGame._hallScene?._hitProvider?.().hotspots
      .find(item => item.id === ${JSON.stringify(objectName)});
    if (!canvas || !rect?.width || !rect?.height || !viewport?.width || !viewport?.height || !area?.bounds) return null;
    const { x, y, width, height } = area.bounds;
    const containsVisible = candidate => (
      candidate.x >= 0 && candidate.x <= viewport.width &&
      candidate.y >= 0 && candidate.y <= viewport.height &&
      area.contains(candidate)
    );
    let viewportPoint = { x: x + width / 2, y: y + height / 2 };
    if (!containsVisible(viewportPoint)) {
      const stepX = Math.max(1, width / 20);
      const stepY = Math.max(1, height / 20);
      viewportPoint = null;
      for (let candidateY = y + stepY / 2; !viewportPoint && candidateY < y + height; candidateY += stepY) {
        for (let candidateX = x + stepX / 2; candidateX < x + width; candidateX += stepX) {
          const candidate = { x: candidateX, y: candidateY };
          if (containsVisible(candidate)) {
            viewportPoint = candidate;
            break;
          }
        }
      }
    }
    if (!viewportPoint) return null;
    const scale = Math.max(rect.width / viewport.width, rect.height / viewport.height);
    const offsetX = (rect.width - viewport.width * scale) / 2;
    const offsetY = (rect.height - viewport.height * scale) / 2;
    return {
      x: rect.left + offsetX + viewportPoint.x * scale,
      y: rect.top + offsetY + viewportPoint.y * scale
    };
  })()`)
  if (!point) throw new Error(`Scene hotspot ${hotspotId} has no clickable canvas point`)
  const dispatched = await evaluate(cdp, `(() => {
    const canvas = document.querySelector('.melon-layer canvas');
    if (!canvas) return false;
    const options = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0 };
    canvas.dispatchEvent(new PointerEvent('pointerdown', { ...options, buttons: 1, clientX: ${point.x}, clientY: ${point.y} }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...options, buttons: 0, clientX: ${point.x}, clientY: ${point.y} }));
    return true;
  })()`)
  if (!dispatched) throw new Error(`Scene hotspot ${hotspotId} canvas is unavailable`)
}

const centerSceneHotspot = async (cdp, hotspotId) => {
  const objectName = SCENE_HOTSPOTS[hotspotId]
  if (!objectName) throw new Error(`Unknown scene hotspot: ${hotspotId}`)
  const centered = await evaluate(cdp, `(() => {
    ${GAME_LOOKUP_SOURCE}
    const viewport = juyitingGame.getSceneDebugSnapshot?.().camera?.viewport;
    const area = juyitingGame._hallScene?._hitProvider?.().hotspots
      .find(item => item.id === ${JSON.stringify(objectName)});
    if (!viewport?.width || !viewport?.height || !area?.bounds) return false;
    const target = { x: area.bounds.x + area.bounds.width / 2, y: area.bounds.y + area.bounds.height / 2 };
    juyitingGame.panBy?.(viewport.width / 2 - target.x, viewport.height / 2 - target.y);
    return true;
  })()`)
  if (!centered) throw new Error(`Scene hotspot ${hotspotId} cannot be centered`)
}

const closePanel = `
(() => {
  const close = document.querySelector('.panel-close');
  if (!close) return true;
  close.click();
  return true;
})()
`

export const runUiSmoke = async (options = {}) => {
  const env = options.env || options.safetyContext?.env || process.env
  const requestTimeoutMs = parseBoundedTimeout(
    env.JUYITING_UI_REQUEST_TIMEOUT_MS,
    DEFAULT_REQUEST_TIMEOUT_MS,
    'JUYITING_UI_REQUEST_TIMEOUT_MS'
  )
  const cdpCommandTimeoutMs = parseBoundedTimeout(
    env.JUYITING_CDP_COMMAND_TIMEOUT_MS,
    DEFAULT_CDP_COMMAND_TIMEOUT_MS,
    'JUYITING_CDP_COMMAND_TIMEOUT_MS'
  )
  const ownsSafetyContext = !options.safetyContext
  const context = options.safetyContext || await createSafetyContext({
    mode: 'ui',
    env,
    readFileImpl: options.readFileImpl,
    signalTarget: options.signalTarget,
    now: options.now,
    setTimeoutImpl: options.setTimeoutImpl,
    clearTimeoutImpl: options.clearTimeoutImpl
  })
  const { config, guard } = context
  const restoreTls = ownsSafetyContext ? applyLocalTlsPolicy(context) : () => {}
  const runtime = {
    config,
    guard,
    env,
    fetchImpl: options.fetchImpl || globalThis.fetch,
    requestTimeoutMs,
    cdpCommandTimeoutMs
  }
  const spawnImpl = options.spawnImpl || spawn
  let chrome
  let cdp
  let userDataDir
  let untrackChrome = () => {}
  let untrackCdp = () => {}
  let stopTrackedChrome = async () => {}
  let token = ''
  let runError
  let finalUrl = ''
  const cleanupErrors = []

  try {
    const loadWebSocketModuleImpl = options.loadWebSocketModuleImpl || (() => import('ws'))
    const WebSocketCtor = options.WebSocketCtor || (
      await guard.runPromise(
        Promise.resolve().then(() => loadWebSocketModuleImpl()),
        'CDP WebSocket module load'
      )
    ).default
    guard.beforeBoundary('credentialed OAuth authorization flow')
    token = await getToken(runtime)
    const browserPolicy = new BrowserOriginPolicy(config, token)
    const chromePath = await findChrome(runtime)
    userDataDir = await guard.runPromise(
      mkdtemp(join(tmpdir(), 'juyiting-ui-smoke-')),
      'temporary browser profile creation'
    )
    const debugPort = 9333 + Math.floor(Math.random() * 1000)
    const cdpHttpOrigin = `http://127.0.0.1:${debugPort}`
    const chromeArgs = [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      ...(config.allowInsecureTls ? ['--ignore-certificate-errors'] : []),
      '--window-size=1440,900',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      'about:blank'
    ]
    guard.beforeBoundary('Chromium browser spawn')
    chrome = spawnImpl(chromePath, chromeArgs, {
      stdio: 'ignore',
      detached: process.platform !== 'win32'
    })
    let stopPromise
    stopTrackedChrome = () => {
      if (!stopPromise) stopPromise = stopChrome(chrome, userDataDir, { spawnImpl })
      return stopPromise
    }
    untrackChrome = guard.trackCleanup(stopTrackedChrome)
    await waitForChildSpawn(runtime, chrome, 'Chromium browser spawn')

    const version = await waitForJson(runtime, `${cdpHttpOrigin}/json/version`, cdpHttpOrigin)
    const target = await requestJson(
      runtime,
      `${cdpHttpOrigin}/json/new?about:blank`,
      { method: 'PUT' },
      'Chromium DevTools target creation request',
      cdpHttpOrigin
    )
    const webSocketUrl = target.webSocketDebuggerUrl || version.webSocketDebuggerUrl
    let parsedWebSocketUrl
    try {
      parsedWebSocketUrl = new URL(webSocketUrl)
    } catch {
      throw new Error('Chromium DevTools WebSocket URL is malformed')
    }
    if (!['ws:', 'wss:'].includes(parsedWebSocketUrl.protocol) ||
        parsedWebSocketUrl.username || parsedWebSocketUrl.password || parsedWebSocketUrl.hash ||
        !isLoopbackUrl(parsedWebSocketUrl)) {
      throw new Error('Chromium DevTools WebSocket URL is not a safe loopback target')
    }
    cdp = new CdpSession(runtime, parsedWebSocketUrl, WebSocketCtor)
    const closeTrackedCdp = () => cdp.close()
    untrackCdp = guard.trackCleanup(closeTrackedCdp)
    await cdp.open()
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Network.enable')
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })

    const fixtures = sceneFixtures()
    let pendingSseRequestId = null
    let sseDelivered = false
    let failRequiredSprite = false
    cdp.on('Page.frameNavigated', ({ frame }) => {
      browserPolicy.assertDocumentUrl(frame?.url, 'browser frame navigation')
    })
    cdp.on('Fetch.requestPaused', async params => {
      const { requestId, request } = params
      const url = request?.url || ''
      try {
        const apiRequest = browserPolicy.inspectPausedRequest(params)
        if (apiRequest?.preflight) {
          await fulfillCorsPreflight(runtime, cdp, requestId)
          return
        }
        if (apiRequest?.fixture === 'mapAgents') {
          await fulfillJson(runtime, cdp, requestId, 200, fixtures.mapAgents)
          return
        }
        if (apiRequest?.fixture === 'snapshot') {
          await fulfillJson(runtime, cdp, requestId, 200, fixtures.snapshot)
          return
        }
        if (apiRequest?.fixture === 'events') {
          if (!sseDelivered && !pendingSseRequestId) {
            pendingSseRequestId = requestId
            return
          }
          await fulfillJson(runtime, cdp, requestId, 503, {
            status: 503,
            code: 'SCENE_EVENTS_DISABLED',
            msg: 'Scene event stream is disabled'
          })
          return
        }
        if (url.includes('/juyiting/sprites/persona-sheets-v1/songjiang-8-direction-v3.webp') && failRequiredSprite) {
          await cdp.send('Fetch.fulfillRequest', {
            requestId,
            responseCode: 404,
            responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }],
            body: Buffer.from('required sprite intentionally unavailable').toString('base64')
          })
          return
        }
        await cdp.send('Fetch.continueRequest', { requestId })
      } catch (error) {
        try {
          await cdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' })
        } catch (failError) {
          throw new AggregateError([error, failError], 'Unsafe browser request was blocked but CDP cleanup failed')
        }
        throw error
      }
    })
    await cdp.send('Fetch.enable', {
      patterns: [{ urlPattern: '*', requestStage: 'Request' }]
    })


    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: browserPolicy.tokenBootstrapSource()
    })

    guard.beforeBoundary('credentialed browser navigation')
    const pageUrl = new URL('/juyiting?transition=none&scene-debug=1', config.targets.frontend)
    await cdp.send('Page.navigate', { url: pageUrl.href })
    await waitForExpression(runtime, cdp, 'Boolean(document.querySelector(".juyi-page"))')
    await waitForExpression(runtime, cdp, '(document.body.innerText || "").includes("聚义厅")')
    await waitForExpression(runtime, cdp, 'Boolean(document.querySelector(".hall-board.is-melon-ready .melon-layer canvas"))')
    await waitForExpression(runtime, cdp, 'Boolean(document.querySelector(".hall-board.is-melon-ready .melon-layer canvas"))')
    try {
      await waitForExpression(runtime, cdp, debugExpression(`
        debug.ready === true &&
        debug.map?.tmxLoaded === true &&
        debug.map?.movementReady === true &&
        debug.simulation?.ready === true &&
        debug.sprites?.manifestReady === true &&
        debug.backend?.snapshotReady === true &&
        debug.input?.interactionLocked === false
      `))
    } catch (error) {
      const pausedUrls = cdp.events
        .filter(event => event.method === 'Fetch.requestPaused')
        .map(event => redactUrl(event.params?.request?.url))
      throw new Error(`${error.message}. Debug: ${JSON.stringify(await readDebug(cdp))}. Paused: ${JSON.stringify(pausedUrls)}`)
    }

    const initialDebug = await readDebug(cdp)
    if (initialDebug.sprites.manifestVersion !== EXPECTED_MANIFEST_VERSION ||
      initialDebug.sprites.requiredMissingCount !== 0 ||
      initialDebug.sprites.optionalMissingCount !== 0 ||
      initialDebug.sprites.placeholderCount !== 0) {
      throw new Error(`Unexpected sprite readiness: ${JSON.stringify(initialDebug.sprites)}`)
    }
    const songjiang = initialDebug.agents.find(agent => agent.personaCode === 'songjiang')
    if (!songjiang || !songjiang.spriteLoaded || songjiang.placeholder) {
      const diagnostic = await evaluate(cdp, `(() => {
        ${GAME_LOOKUP_SOURCE}
        let hallComponent = component;
        while (hallComponent && !hallComponent.setupState?.hallSceneState) hallComponent = hallComponent.parent;
        const setup = hallComponent?.setupState || {};
        const unref = value => value?.__v_isRef ? value.value : value;
        const latestSnapshot = unref(setup.hallBackendSceneState?.latestSnapshot) || null;
        return {
          engine: juyitingGame._movementEngine?.snapshots?.() || [],
          queue: setup.hallCommandQueue?.snapshot?.() || [],
          blocked: unref(setup.hallSceneState?.blockedStates) || [],
          sceneVersion: unref(setup.hallSceneState?.sceneVersion) ?? null,
          latestSnapshot,
          latestKeys: latestSnapshot ? Object.keys(latestSnapshot) : [],
          latestSceneId: latestSnapshot?.sceneId || null,
          latestSceneVersion: latestSnapshot?.sceneVersion ?? null,
          latestStateCount: Array.isArray(latestSnapshot?.states) ? latestSnapshot.states.length : -1,
          latestState: latestSnapshot?.states?.[0] || null,
          backendStarted: setup.backendSceneStarted?.value ?? setup.backendSceneStarted ?? null,
          backendWarnings: setup.hallBackendSceneState?.warnings?.value || setup.hallBackendSceneState?.warnings || []
        };
      })()`)
      const runtimeErrors = cdp.events
        .filter(event => ['Runtime.exceptionThrown', 'Log.entryAdded'].includes(event.method))
        .slice(-10)
      throw new Error(`Songjiang simulation snapshot is unavailable: ${JSON.stringify({
        agents: initialDebug.agents,
        diagnostic,
        runtimeErrors
      })}`)
    }
    if (String(initialDebug.backend.sceneVersion) !== '128') {
      throw new Error(`Initial scene cursor was not reconstructed: ${JSON.stringify(initialDebug.backend)}`)
    }

    const sceneState = await evaluate(cdp, `(() => {
      const stage = document.querySelector('.hall-stage');
      return {
        hasStage: Boolean(stage),
        hasCanvas: Boolean(document.querySelector('.melon-layer canvas')),
        hasMapWorld: Boolean(document.querySelector('.map-world')),
        hasHallRoom: Boolean(document.querySelector('.hall-room')),
        hasAgentToken: Boolean(document.querySelector('.agent-token'))
      };
    })()`)
    if (!sceneState.hasStage || !sceneState.hasCanvas || sceneState.hasMapWorld || sceneState.hasHallRoom || sceneState.hasAgentToken) {
      throw new Error(`Unexpected Juyiting scene DOM state: ${JSON.stringify(sceneState)}`)
    }

    const sseDeadline = Date.now() + 10_000
    while (!pendingSseRequestId && Date.now() < sseDeadline) {
      cdp.throwHandlerErrors()
      await guardedDelay(runtime, 100, 'Scene SSE polling delay')
    }
    if (!pendingSseRequestId) throw new Error('Scene SSE request was not opened')
    const sseRequestId = pendingSseRequestId
    pendingSseRequestId = null
    sseDelivered = true
    await fulfillSse(runtime, cdp, sseRequestId,
      `id:129\nevent:agent-scene-state-updated\ndata:${JSON.stringify(fixtures.event)}\n\n`)
    await waitForExpression(runtime, cdp, debugExpression('String(debug.backend?.sceneVersion) === \'129\''))

    try {
      await waitForExpression(runtime, cdp, `(() => {
        ${GAME_LOOKUP_SOURCE}
        return Boolean(juyitingGame._hallScene?._inputController && juyitingGame.getCameraSnapshot?.());
      })()`)
    } catch (error) {
      const inputDiagnostic = await evaluate(cdp, `(() => {
        ${GAME_LOOKUP_SOURCE}
        const scene = juyitingGame._hallScene;
        const canvas = scene?._canvasElement?.();
        return {
          destroyed: scene?._destroyed,
          sceneBuilt: scene?._sceneBuilt,
          hasCamera: Boolean(scene?._cameraController),
          hasInput: Boolean(scene?._inputController),
          hasCanvas: Boolean(canvas),
          canvasConnected: Boolean(canvas?.isConnected),
          viewport: scene?._viewportSize?.()
        };
      })()`)
      throw new Error(`${error.message}. Input: ${JSON.stringify(inputDiagnostic)}`)
    }

    const beforeWheel = (await readDebug(cdp)).camera
    const canvasCenter = await evaluate(cdp, `(() => {
      ${GAME_LOOKUP_SOURCE}
      const canvas = juyitingGame._hallScene?._canvasElement?.();
      const bounds = canvas.getBoundingClientRect();
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    })()`)
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: canvasCenter.x, y: canvasCenter.y, deltaX: 0, deltaY: -120
    })
    const wheelDispatch = await evaluate(cdp, `(() => {
      ${GAME_LOOKUP_SOURCE}
      const canvas = juyitingGame._hallScene?._canvasElement?.();
      const event = new WheelEvent('wheel', {
        bubbles: true, cancelable: true, deltaY: -120, deltaMode: 0,
        clientX: ${canvasCenter.x}, clientY: ${canvasCenter.y}
      });
      const dispatchResult = canvas.dispatchEvent(event);
      return { dispatchResult, defaultPrevented: event.defaultPrevented };
    })()`)
    const wheelDiagnostic = await evaluate(cdp, `(() => {
      ${GAME_LOOKUP_SOURCE}
      return {
        camera: juyitingGame.getCameraSnapshot?.(),
        input: juyitingGame.getInputSnapshot?.(),
        hasController: Boolean(juyitingGame._hallScene?._inputController),
        canvasConnected: Boolean(juyitingGame._hallScene?._canvasElement?.()?.isConnected)
      };
    })()`)
    if (!wheelDiagnostic.hasController) {
      throw new Error(`Input controller unavailable during wheel smoke: ${JSON.stringify(wheelDiagnostic)}`)
    }
    if (sameTransform(beforeWheel, wheelDiagnostic.camera?.transform || {})) {
      const runtimeErrors = cdp.events
        .filter(event => event.method === 'Runtime.exceptionThrown')
        .slice(-5)
      throw new Error(`Wheel input did not change camera transform: ${JSON.stringify({
        wheelDispatch,
        wheelDiagnostic,
        runtimeErrors
      })}`)
    }
    await waitForExpression(runtime, cdp, `(() => {
      ${GAME_LOOKUP_SOURCE}
      const transform = juyitingGame.getCameraSnapshot?.()?.transform;
      juyitingGame.getSceneDebugSnapshot?.();
      return Boolean(transform && (
        Math.abs(transform.zoom - ${beforeWheel.zoom}) > 1e-6 ||
        Math.abs(transform.offsetX - ${beforeWheel.offsetX}) > 1e-6 ||
        Math.abs(transform.offsetY - ${beforeWheel.offsetY}) > 1e-6
      ));
    })()`)

    const beforeDrag = (await readDebug(cdp)).camera
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: canvasCenter.x, y: canvasCenter.y, button: 'left', buttons: 1, clickCount: 1
    })
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: canvasCenter.x + 40, y: canvasCenter.y + 24, button: 'left', buttons: 1
    })
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: canvasCenter.x + 40, y: canvasCenter.y + 24,
      button: 'left', buttons: 0, clickCount: 1
    })
    await waitForExpression(runtime, cdp, debugExpression(`
      Math.abs(debug.camera.offsetX - ${beforeDrag.offsetX}) > 1e-6 ||
      Math.abs(debug.camera.offsetY - ${beforeDrag.offsetY}) > 1e-6
    `))

    const beforeOrientation = (await readDebug(cdp)).camera
    const orientationDebug = await evaluate(cdp, `(() => {
      ${GAME_LOOKUP_SOURCE}
      const debug = window[${JSON.stringify(DEBUG_KEY)}];
      juyitingGame.resizeViewport({
        width: debug.camera.viewport.height,
        height: debug.camera.viewport.width,
        kind: 'orientation',
        orientationChanged: true
      });
      return window[${JSON.stringify(DEBUG_KEY)}];
    })()`)
    const focusBefore = centerWorld(beforeOrientation)
    const focusAfter = centerWorld(orientationDebug.camera)
    if (Math.hypot(focusAfter.x - focusBefore.x, focusAfter.y - focusBefore.y) > 2) {
      throw new Error(`Orientation resize lost camera focus: ${JSON.stringify({ focusBefore, focusAfter })}`)
    }

    const initialState = await evaluate(cdp, `(() => {
      const text = document.body.innerText || '';
      return {
        hasMojibake: /�|鑱|钘|鎮|楠|涓|鍘/.test(text),
        text: text.slice(0, 2000)
      };
    })()`)
    if (initialState.hasMojibake) {
      throw new Error(`Page contains mojibake-like text: ${initialState.text}`)
    }

    await evaluate(cdp, `(() => {
      ${GAME_LOOKUP_SOURCE}
      return juyitingGame.resetToMainHall?.();
    })()`)
    await centerSceneHotspot(cdp, 'library')
    const beforePanel = (await readDebug(cdp)).camera
    await clickSceneHotspot(cdp, 'library')
    await waitForExpression(runtime, cdp, 'Boolean(document.querySelector(".panel-library"))')
    const panelDebug = await readDebug(cdp)
    if (!panelDebug.input.interactionLocked || !sameTransform(beforePanel, panelDebug.camera)) {
      throw new Error(`Panel opening changed the camera transform: ${JSON.stringify({ beforePanel, after: panelDebug.camera })}`)
    }
    await evaluate(cdp, closePanel)
    await waitForExpression(runtime, cdp, '!document.querySelector(".panel-overlay")')

    await centerSceneHotspot(cdp, 'tasks')
    await clickSceneHotspot(cdp, 'tasks')
    await waitForExpression(runtime, cdp, 'Boolean(document.querySelector(".panel-tasks"))')
    await evaluate(cdp, closePanel)
    await waitForExpression(runtime, cdp, '!document.querySelector(".panel-overlay")')

    await centerSceneHotspot(cdp, 'chat')
    await clickSceneHotspot(cdp, 'chat')
    await waitForExpression(runtime, cdp, 'Boolean(document.querySelector(".panel-chat"))')

    const interactionState = await evaluate(cdp, `(() => {
      const text = document.body.innerText || '';
      return {
        url: location.href,
        containsCoordination: text.includes('协同会办'),
        text: text.slice(0, 2000)
      };
    })()`)
    if (interactionState.containsCoordination) {
      throw new Error(`Low-value actions are visible: ${JSON.stringify(interactionState)}`)
    }

    await cdp.send('Page.reload', { ignoreCache: true })
    await waitForExpression(runtime, cdp, debugExpression(`
      debug.ready === true && debug.map?.movementReady === true && debug.simulation?.ready === true
    `))
    const recovery = await waitForExpression(runtime, cdp, `(() => {
      ${GAME_LOOKUP_SOURCE}
      const agent = juyitingGame._movementEngine?.snapshots?.()
        .find(candidate => candidate.personaCode === 'songjiang');
      const home = juyitingGame.getMovementRuntime?.()?.slots
        ?.find(slot => slot.kind === 'home' && slot.personaCode === 'songjiang');
      if (!agent || !home) return false;
      const distance = Math.hypot(agent.x - home.point.x, agent.y - home.point.y);
      return distance > 0 ? { distance, phase: agent.phase, stateVersion: agent.stateVersion } : false;
    })()`)
    if (!(recovery.distance > 0)) {
      throw new Error(`Refresh did not reconstruct nonzero movement progress: ${JSON.stringify(recovery)}`)
    }

    failRequiredSprite = true
    pendingSseRequestId = null
    await cdp.send('Page.reload', { ignoreCache: true })
    await waitForExpression(runtime, cdp, debugExpression(`
      debug.ready === true &&
      debug.degraded === true &&
      debug.map?.movementReady === true &&
      debug.sprites?.requiredMissingCount === 1
    `))
    const degradedBeforeTransform = (await readDebug(cdp)).camera
    const degradedAfterTransform = await evaluate(cdp, `(() => {
      ${GAME_LOOKUP_SOURCE}
      juyitingGame.zoomBy(0.2);
      return juyitingGame.getCameraSnapshot?.()?.transform;
    })()`)
    if (sameTransform(degradedBeforeTransform, degradedAfterTransform)) {
      throw new Error('Map transform stopped operating after required sprite degradation')
    }

    const { frameTree } = await cdp.send('Page.getFrameTree')
    browserPolicy.assertFrameTree(frameTree)
    const finalSecurityState = await evaluate(cdp, `(() => ({
      url: location.href,
      isTopFrame: window.top === window,
      storageOrigin: location.origin,
      apiToken: localStorage.getItem('api_token')
    }))()`)
    finalUrl = browserPolicy.assertFinalState(finalSecurityState).href
    await cdp.terminalBarrier()
  } catch (error) {
    runError = new Error(sanitizeError(error, [...Object.values(config.credentials), token]))
  } finally {
    if (cdp) {
      try {
        await completeTrackedCleanup(() => cdp.close(), untrackCdp)
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    if (chrome && userDataDir) {
      try {
        await completeTrackedCleanup(stopTrackedChrome, untrackChrome)
      } catch (error) {
        cleanupErrors.push(error)
      }
    } else if (userDataDir) {
      try {
        await rm(userDataDir, { recursive: true, force: true })
      } catch (error) {
        cleanupErrors.push(new Error(`Temporary browser profile cleanup failed: ${error.message}`))
      }
    }
    token = ''
    restoreTls()
    if (ownsSafetyContext) {
      try {
        await guard.dispose()
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
  }

  if (runError && cleanupErrors.length) {
    throw cleanupFailure([runError, ...cleanupErrors], 'UI smoke failed and cleanup was incomplete')
  }
  if (runError) throw runError
  if (cleanupErrors.length) throw cleanupFailure(cleanupErrors, 'UI smoke cleanup was incomplete')

  console.log('聚义厅 UI smoke 验证通过')
  console.log(JSON.stringify({
    targets: config.targetOrigins,
    finalUrl: redactUrl(finalUrl)
  }, null, 2))
}

const isMainModule = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false

if (isMainModule) {
  runUiSmoke().catch(error => {
    console.error(sanitizeError(error, credentialValuesFromEnv(process.env)))
    process.exitCode = 1
  })
}
