import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { describe as nodeDescribe, it as nodeIt } from 'node:test'

import {
  checkAgentWebSocket,
  checkFrontendRoute,
  runNpmScript,
  runPreflight
} from './juyiting-public-beta-preflight.mjs'
import {
  BrowserOriginPolicy,
  CdpSession,
  requestJson,
  runUiSmoke,
  stopChrome,
  waitForChildSpawn
} from './juyiting-public-beta-ui-smoke.mjs'
import {
  APPROVAL_MANIFEST_SCHEMA,
  MAX_PREFLIGHT_DEADLINE_MS,
  PREFLIGHT_APPROVAL_SCOPE,
  PREFLIGHT_CLEANUP_ERROR_CODE,
  UI_SMOKE_APPROVAL_SCOPE,
  PreflightTerminationGuard,
  cleanupFailure,
  completeTrackedCleanup,
  createSafetyContext,
  sanitizeError,
  sanitizeMessage,
  stopProcessTree,
  validateSafetyConfig
} from './juyiting-preflight-safety.mjs'

const localEnv = (overrides = {}) => ({
  JIA_AGENT_API_KEY: 'explicit-agent-api-secret',
  JIA_AGENT_WS_AGENT_ID: 'explicit-agent-id',
  JIA_LOGIN_USER: 'explicit-login-user',
  JIA_LOGIN_PASSWORD: 'explicit-login-password',
  JUYITING_OAUTH_CLIENT_ID: 'explicit-oauth-client',
  JUYITING_OAUTH_REDIRECT_URI: 'https://localhost:8080/oauth2/callback',
  ...overrides
})

const productionEnv = (overrides = {}) => localEnv({
  JIA_BACKEND_URL: 'https://api.example.test',
  JIA_FRONTEND_URL: 'https://app.example.test',
  JUYITING_OAUTH_REDIRECT_URI: 'https://app.example.test/oauth2/callback',
  ...overrides
})

const manifestBytes = (overrides = {}) => Buffer.from(JSON.stringify({
  schemaVersion: APPROVAL_MANIFEST_SCHEMA,
  targetOrigins: {
    backend: 'https://api.example.test',
    frontend: 'https://app.example.test'
  },
  scope: [...PREFLIGHT_APPROVAL_SCOPE],
  ...overrides
}))

const approvedProductionEnv = (bytes, overrides = {}) => productionEnv({
  JUYITING_PREFLIGHT_APPROVE_NON_LOOPBACK: 'YES',
  JUYITING_PREFLIGHT_APPROVAL_MANIFEST: '/caller/approval.json',
  JUYITING_PREFLIGHT_APPROVAL_MANIFEST_SHA256: createHash('sha256').update(bytes).digest('hex'),
  ...overrides
})

const describe = globalThis.describe || nodeDescribe
const it = globalThis.it || nodeIt
const inertTimer = () => ({ unref () {} })

const makeGuard = ({ deadlineMs = 1000, now = Date.now, signalTarget = new EventEmitter() } = {}) => (
  new PreflightTerminationGuard({
    deadlineMs,
    now,
    signalTarget,
    setTimeoutImpl: inertTimer,
    clearTimeoutImpl: () => {}
  })
)

const agentWebSocketConfig = {
  targets: { backend: new URL('https://localhost:10018') },
  credentials: { apiKey: 'key', agentId: 'agent' },
  allowInsecureTls: false
}

const flushMicrotasks = async (count = 4) => {
  for (let index = 0; index < count; index++) await Promise.resolve()
}

const createManualTimers = () => {
  let nextId = 0
  const timers = new Map()
  return {
    setTimeoutFn (callback, delay) {
      const id = ++nextId
      timers.set(id, { callback, delay })
      return id
    },
    clearTimeoutFn (id) { timers.delete(id) },
    runNext () {
      const entry = timers.entries().next().value
      assert.ok(entry, 'expected one pending WebSocket timer')
      const [id, timer] = entry
      timers.delete(id)
      timer.callback()
      return timer.delay
    },
    get delays () { return [...timers.values()].map(timer => timer.delay) }
  }
}

const errorContains = (error, pattern) => pattern.test(error?.message || '') ||
  error?.errors?.some(cause => errorContains(cause, pattern))

class ControlledAgentSocket extends EventEmitter {
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  constructor () {
    super()
    this.readyState = ControlledAgentSocket.OPEN
    this.closeCalls = 0
    this.terminateCalls = 0
    queueMicrotask(() => this.emit('message', Buffer.from('{"type":"connected"}')))
  }
  close () {
    this.closeCalls += 1
    this.readyState = ControlledAgentSocket.CLOSING
  }
  terminate () { this.terminateCalls += 1 }
  confirmClosed () {
    this.readyState = ControlledAgentSocket.CLOSED
    this.emit('close')
  }
}

describe('juyiting public beta preflight safety', () => {
  it('missing credentials fail before injected network or child/browser spawn calls', async () => {
    let fetchCalls = 0
    let childSpawnCalls = 0
    let browserCalls = 0
    await assert.rejects(
      runPreflight({
        env: {},
        signalTarget: new EventEmitter(),
        setTimeoutImpl: inertTimer,
        clearTimeoutImpl: () => {},
        fetchImpl: async () => { fetchCalls++; throw new Error('must not run') },
        runNpmScriptImpl: async () => { childSpawnCalls++ },
        uiSmokeImpl: async () => { browserCalls++ }
      }),
      /Missing required explicit apiKey env/
    )
    assert.equal(fetchCalls, 0)
    assert.equal(childSpawnCalls, 0)
    assert.equal(browserCalls, 0)
  })

  it('non-loopback targets refuse without exact confirmation and manifest binding', async () => {
    await assert.rejects(
      validateSafetyConfig({ mode: 'preflight', env: productionEnv() }),
      /require exact JUYITING_PREFLIGHT_APPROVE_NON_LOOPBACK=YES/
    )
    await assert.rejects(
      validateSafetyConfig({
        mode: 'preflight',
        env: productionEnv({ JUYITING_PREFLIGHT_APPROVE_NON_LOOPBACK: 'yes' })
      }),
      /require exact JUYITING_PREFLIGHT_APPROVE_NON_LOOPBACK=YES/
    )
  })

  it('non-loopback targets require HTTPS before approval file access', async () => {
    for (const [name, override, pattern] of [
      ['backend', { JIA_BACKEND_URL: 'http://api.example.test' }, /Backend target must use HTTPS/],
      ['frontend', {
        JIA_FRONTEND_URL: 'http://app.example.test',
        JUYITING_OAUTH_REDIRECT_URI: 'http://app.example.test/oauth2/callback'
      }, /Frontend target must use HTTPS/]
    ]) {
      let approvalReads = 0
      const bytes = manifestBytes()
      await assert.rejects(
        validateSafetyConfig({
          mode: 'preflight',
          env: approvedProductionEnv(bytes, override),
          readFileImpl: async () => { approvalReads++; return bytes }
        }),
        pattern,
        name
      )
      assert.equal(approvalReads, 0, name)
    }
  })

  it('exact SHA-bound approval accepts only the frozen origins and scope', async () => {
    const bytes = manifestBytes()
    const expectedSha = createHash('sha256').update(bytes).digest('hex')
    const config = await validateSafetyConfig({
      mode: 'preflight',
      env: approvedProductionEnv(bytes),
      readFileImpl: async path => {
        assert.equal(path, '/caller/approval.json')
        return bytes
      }
    })
    assert.deepEqual(config.targetOrigins, {
      backend: 'https://api.example.test',
      frontend: 'https://app.example.test'
    })
    assert.deepEqual(config.approval, {
      path: '/caller/approval.json',
      sha256: expectedSha
    })
    assert.deepEqual(config.approvalScope, [...PREFLIGHT_APPROVAL_SCOPE])
  })

  it('direct UI smoke approval is bound to the narrower OAuth browser scope', async () => {
    const uiBytes = manifestBytes({ scope: [...UI_SMOKE_APPROVAL_SCOPE] })
    const config = await validateSafetyConfig({
      mode: 'ui',
      env: approvedProductionEnv(uiBytes),
      readFileImpl: async () => uiBytes
    })
    assert.deepEqual(config.approvalScope, [...UI_SMOKE_APPROVAL_SCOPE])

    const preflightBytes = manifestBytes()
    await assert.rejects(
      validateSafetyConfig({
        mode: 'ui',
        env: approvedProductionEnv(preflightBytes),
        readFileImpl: async () => preflightBytes
      }),
      /scope does not exactly match/
    )
  })

  it('approval manifest SHA mismatch refuses before parsing approval content', async () => {
    const bytes = manifestBytes()
    await assert.rejects(
      validateSafetyConfig({
        mode: 'preflight',
        env: approvedProductionEnv(bytes, {
          JUYITING_PREFLIGHT_APPROVAL_MANIFEST_SHA256: '0'.repeat(64)
        }),
        readFileImpl: async () => bytes
      }),
      /SHA-256 mismatch/
    )
  })

  it('approval manifest target mismatch refuses', async () => {
    const bytes = manifestBytes({
      targetOrigins: {
        backend: 'https://other.example.test',
        frontend: 'https://app.example.test'
      }
    })
    await assert.rejects(
      validateSafetyConfig({
        mode: 'preflight',
        env: approvedProductionEnv(bytes),
        readFileImpl: async () => bytes
      }),
      /target origin mismatch/
    )
  })

  it('approval manifest malformed or extra scope refuses', async () => {
    for (const [name, scope] of [
      ['extra', [...PREFLIGHT_APPROVAL_SCOPE, 'deployment']],
      ['missing', ['credentialed-api']],
      ['duplicate', [...PREFLIGHT_APPROVAL_SCOPE, PREFLIGHT_APPROVAL_SCOPE[0]]],
      ['malformed', [...PREFLIGHT_APPROVAL_SCOPE, 7]]
    ]) {
      const bytes = manifestBytes({ scope })
      await assert.rejects(
        validateSafetyConfig({
          mode: 'preflight',
          env: approvedProductionEnv(bytes),
          readFileImpl: async () => bytes
        }),
        /scope/,
        name
      )
    }
  })

  it('approval manifest rejects extra top-level authority', async () => {
    const bytes = manifestBytes({ deployment: true })
    await assert.rejects(
      validateSafetyConfig({
        mode: 'preflight',
        env: approvedProductionEnv(bytes),
        readFileImpl: async () => bytes
      }),
      /malformed or extra top-level fields/
    )
  })

  it('non-loopback targets always reject explicit or inherited insecure TLS', async () => {
    const bytes = manifestBytes()
    for (const override of [
      { JUYITING_ALLOW_INSECURE_LOCAL_TLS: 'YES' },
      { NODE_TLS_REJECT_UNAUTHORIZED: '0' }
    ]) {
      await assert.rejects(
        validateSafetyConfig({
          mode: 'preflight',
          env: approvedProductionEnv(bytes, override),
          readFileImpl: async () => bytes
        }),
        /Insecure TLS is forbidden for non-loopback targets/
      )
    }
  })

  it('explicit loopback credentials allow the local-only path without a manifest', async () => {
    const config = await validateSafetyConfig({
      mode: 'preflight',
      env: localEnv({ JUYITING_ALLOW_INSECURE_LOCAL_TLS: 'YES' })
    })
    assert.equal(config.allLoopback, true)
    assert.equal(config.allowInsecureTls, true)
    assert.equal(config.approval, null)
    assert.equal(config.credentials.agentId, 'explicit-agent-id')
    assert.equal(config.credentials.oauthClientId, 'explicit-oauth-client')
  })

  it('unsafe target URL forms refuse before approval evaluation', async () => {
    for (const [name, override, pattern] of [
      ['userinfo', { JIA_BACKEND_URL: 'https://user:pass@localhost:10018' }, /userinfo/],
      ['fragment', { JIA_BACKEND_URL: 'https://localhost:10018/#unsafe' }, /fragment/],
      ['query', { JIA_BACKEND_URL: 'https://localhost:10018/?token=unsafe' }, /query string/],
      ['scheme', { JIA_BACKEND_URL: 'ftp://localhost:10018' }, /scheme/],
      ['path', { JIA_BACKEND_URL: 'https://localhost:10018/api' }, /without a path/]
    ]) {
      await assert.rejects(
        validateSafetyConfig({ mode: 'preflight', env: localEnv(override) }),
        pattern,
        name
      )
    }
  })

  it('OAuth authorization source does not request offline or refresh grants', () => {
    const source = readFileSync('tests/juyiting-public-beta-ui-smoke.mjs', 'utf8')
    assert.equal(source.includes('access_type'), false)
    assert.equal(source.includes('refresh_token'), false)
  })

  it('credential fallbacks and unconditional TLS disabling are absent', () => {
    const source = [
      readFileSync('tests/juyiting-public-beta-preflight.mjs', 'utf8'),
      readFileSync('tests/juyiting-public-beta-ui-smoke.mjs', 'utf8')
    ].join('\n')
    const removedFallbacks = [
      ['my-secret-api-key-', '123'].join(''),
      ['ch', 'cbz'].join(''),
      ['jiafewnnv', '58ec2379c'].join('')
    ]
    for (const fallback of removedFallbacks) assert.equal(source.includes(fallback), false)
    assert.equal(source.includes("process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'"), false)
    assert.equal(source.includes('rejectUnauthorized: false'), false)
  })

  it('map and sprite validation remain ordered before credentialed network checks', () => {
    const source = readFileSync('tests/juyiting-public-beta-preflight.mjs', 'utf8')
    const mapGate = source.indexOf("await runRecord('validate Juyiting map assets'")
    const spriteGate = source.indexOf("await runRecord('validate Juyiting sprite assets'")
    const firstNetworkCheck = source.indexOf("await runRecord('backend login works'")
    assert.ok(mapGate >= 0)
    assert.ok(spriteGate > mapGate)
    assert.ok(firstNetworkCheck > spriteGate)
  })

  it('asset-child cleanup failure aborts preflight before any credentialed boundary', async () => {
    let npmCalls = 0
    let fetchCalls = 0
    let uiCalls = 0
    await assert.rejects(
      runPreflight({
        env: localEnv(),
        signalTarget: new EventEmitter(),
        setTimeoutImpl: inertTimer,
        clearTimeoutImpl: () => {},
        runNpmScriptImpl: async () => {
          npmCalls++
          throw cleanupFailure(new Error('offline process tree survived'), 'asset cleanup failed')
        },
        fetchImpl: async () => { fetchCalls++; throw new Error('must not fetch') },
        uiSmokeImpl: async () => { uiCalls++ }
      }),
      error => error?.code === PREFLIGHT_CLEANUP_ERROR_CODE
    )
    assert.equal(npmCalls, 1)
    assert.equal(fetchCalls, 0)
    assert.equal(uiCalls, 0)
  })

  it('SIGTERM and deadline state prevent the next guarded boundary', async () => {
    const signalTarget = new EventEmitter()
    const signalGuard = makeGuard({ signalTarget })
    signalTarget.emit('SIGTERM')
    assert.throws(() => signalGuard.beforeBoundary('next login'), /received SIGTERM/)
    await signalGuard.dispose()

    let now = 100
    const deadlineGuard = makeGuard({ deadlineMs: 50, now: () => now })
    deadlineGuard.beforeBoundary('initial local check')
    now = 150
    assert.throws(() => deadlineGuard.beforeBoundary('next token exchange'), /global deadline exceeded/)
    await deadlineGuard.dispose()
  })

  it('global deadline also aborts and bounds a stalled approval-manifest read', async () => {
    const bytes = manifestBytes()
    let approvalReadAborted = false
    const timerHandles = new Set()
    const setRefTimer = (fn, delayMs) => {
      const timer = setTimeout(fn, delayMs)
      const handle = { timer, unref () {} }
      timerHandles.add(handle)
      return handle
    }
    const clearRefTimer = handle => {
      clearTimeout(handle.timer)
      timerHandles.delete(handle)
    }

    await assert.rejects(
      createSafetyContext({
        mode: 'preflight',
        env: approvedProductionEnv(bytes, { JUYITING_PREFLIGHT_DEADLINE_MS: '20' }),
        readFileImpl: async (_path, { signal }) => new Promise((resolvePromise, rejectPromise) => {
          signal.addEventListener('abort', () => {
            approvalReadAborted = true
            rejectPromise(signal.reason)
          }, { once: true })
        }),
        signalTarget: new EventEmitter(),
        setTimeoutImpl: setRefTimer,
        clearTimeoutImpl: clearRefTimer
      }),
      /global deadline exceeded/
    )
    assert.equal(approvalReadAborted, true)
    for (const handle of timerHandles) clearTimeout(handle.timer)
  })

  it('cleanup registered during a termination race is executed and awaited', async () => {
    const guard = makeGuard()
    guard.terminate('global deadline exceeded')

    let releaseCleanup
    let cleaned = false
    guard.trackCleanup(() => new Promise(resolvePromise => {
      releaseCleanup = () => {
        cleaned = true
        resolvePromise()
      }
    }))

    let disposed = false
    const disposing = guard.dispose().then(() => { disposed = true })
    await new Promise(resolvePromise => setImmediate(resolvePromise))
    assert.equal(disposed, false)
    assert.equal(typeof releaseCleanup, 'function')
    releaseCleanup()
    await disposing
    assert.equal(cleaned, true)
  })

  it('tracked cleanup retries after failure while concurrent dispose calls share one in-flight attempt', async () => {
    const guard = makeGuard()
    let attempts = 0
    let releaseRetry
    guard.trackCleanup(() => {
      attempts += 1
      if (attempts === 1) throw new Error('first bounded cleanup failed')
      return new Promise(resolvePromise => { releaseRetry = resolvePromise })
    })

    await guard.terminate('global deadline exceeded')
    assert.equal(attempts, 1)

    const firstDispose = guard.dispose()
    const secondDispose = guard.dispose()
    await flushMicrotasks()
    assert.equal(attempts, 2)
    assert.equal(typeof releaseRetry, 'function')
    releaseRetry()
    await Promise.all([firstDispose, secondDispose])
    assert.equal(attempts, 2)
    assert.equal(guard.cleanups.size, 0)
    assert.equal(guard.pendingCleanups.size, 0)
    assert.equal(guard.cleanupErrors.size, 0)
  })

  it('simultaneous reentrant cleanups share one outer disposal epoch without mutual-await', async () => {
    const guard = makeGuard()
    const calls = [0, 0]
    const returned = [false, false]
    let entrants = 0
    let releaseEntrants
    const bothEntered = new Promise(resolvePromise => { releaseEntrants = resolvePromise })
    for (let index = 0; index < 2; index++) {
      guard.trackCleanup(async () => {
        calls[index] += 1
        entrants += 1
        if (entrants === 2) releaseEntrants()
        await bothEntered
        await guard.dispose()
        returned[index] = true
      })
    }

    let outerSettled = false
    const firstDispose = guard.dispose().finally(() => { outerSettled = true })
    const secondDispose = guard.dispose()
    let timeout
    try {
      await Promise.race([
        Promise.all([firstDispose, secondDispose]),
        new Promise((_resolvePromise, rejectPromise) => {
          timeout = setTimeout(() => rejectPromise(new Error('reentrant disposal exceeded 250ms')), 250)
        })
      ])
    } finally {
      clearTimeout(timeout)
    }
    assert.equal(outerSettled, true)
    assert.deepEqual(calls, [1, 1])
    assert.deepEqual(returned, [true, true])
    assert.equal(guard.cleanups.size, 0)
    assert.equal(guard.pendingCleanups.size, 0)
    assert.equal(guard.pendingCleanupOwners.size, 0)
    assert.equal(guard.cleanupErrors.size, 0)
    assert.equal(guard.activeCleanupEpoch, null)
  })

  it('detached stale cleanup context takes the ordinary retry and fail-closed disposal path', async () => {
    const guard = makeGuard()
    let attempts = 0
    let releaseLate
    let markLateStarted
    let lateDispose
    const lateGate = new Promise(resolvePromise => { releaseLate = resolvePromise })
    const lateStarted = new Promise(resolvePromise => { markLateStarted = resolvePromise })
    guard.trackCleanup(async () => {
      attempts += 1
      if (attempts === 1) {
        lateGate.then(() => {
          lateDispose = guard.dispose()
          markLateStarted()
        })
      }
      throw new Error('persistent detached cleanup failure')
    })

    const firstError = await guard.dispose().then(
      () => null,
      error => error
    )
    assert.equal(firstError?.code, PREFLIGHT_CLEANUP_ERROR_CODE)
    assert.match(firstError.message, /Preflight cleanup failed/)
    assert.equal(attempts, 1)

    releaseLate()
    await lateStarted
    const lateError = await lateDispose.then(
      () => null,
      error => error
    )
    assert.equal(lateError?.code, PREFLIGHT_CLEANUP_ERROR_CODE)
    assert.equal(lateError.message, firstError.message)
    assert.equal(attempts, 2)
    assert.equal(guard.cleanups.size, 1)
    assert.equal(guard.cleanupErrors.size, 1)
    assert.equal(guard.pendingCleanups.size, 0)
    assert.equal(guard.pendingCleanupOwners.size, 0)
    assert.equal(guard.activeCleanupEpoch, null)
  })

  it('termination between npm spawn and cleanup registration still kills the child', async () => {
    const signalTarget = new EventEmitter()
    const guard = makeGuard({ signalTarget })
    let killCalls = 0
    let callback
    const child = {
      exitCode: null,
      signalCode: null,
      killed: false,
      kill (signal) {
        this.killed = true
        this.signalCode = signal
        killCalls++
        queueMicrotask(() => callback(Object.assign(new Error('child terminated'), { code: signal })))
      }
    }
    const execFileImpl = (_file, _args, options, done) => {
      callback = done
      assert.equal(options.detached, process.platform !== 'win32')
      signalTarget.emit('SIGTERM')
      return child
    }

    await assert.rejects(
      runNpmScript('validate:juyiting-map', {
        guard,
        execFileImpl,
        npmExecPath: '/offline/npm-cli.js'
      }),
      /received SIGTERM|child terminated/
    )
    await guard.dispose()
    assert.equal(killCalls, 1)
  })

  it('waits for confirmed CLOSED before succeeding and untracking the credentialed socket', async () => {
    const guard = makeGuard()
    const timers = createManualTimers()
    let socket
    class Socket extends ControlledAgentSocket { constructor (...args) { super(...args); socket = this } }
    const check = checkAgentWebSocket({
      config: agentWebSocketConfig,
      guard,
      timeoutMs: 25,
      WebSocketCtor: Socket,
      ...timers
    })
    let settled = false
    check.then(() => { settled = true }, () => { settled = true })
    await flushMicrotasks()
    assert.equal(socket.closeCalls, 1)
    assert.equal(socket.readyState, Socket.CLOSING)
    assert.equal(settled, false)
    assert.equal(guard.cleanups.size, 1)
    socket.confirmClosed()
    await check
    assert.equal(guard.cleanups.size, 0)
    await guard.dispose()
  })

  it('abort during CLOSING joins tracked cleanup and terminates exactly once', async () => {
    const guard = makeGuard()
    const timers = createManualTimers()
    let socket
    class Socket extends ControlledAgentSocket {
      constructor (...args) { super(...args); socket = this }
      terminate () {
        super.terminate()
        this.readyState = Socket.CLOSED
      }
    }
    const check = checkAgentWebSocket({ config: agentWebSocketConfig, guard, timeoutMs: 25, WebSocketCtor: Socket, ...timers })
    await flushMicrotasks()
    guard.terminate('global deadline exceeded')
    await assert.rejects(check, error => errorContains(error, /stopped by termination\/deadline/))
    await guard.cleanupPromise
    await guard.dispose()
    assert.equal(socket.closeCalls, 1)
    assert.equal(socket.terminateCalls, 1)
    assert.equal(socket.readyState, Socket.CLOSED)
    assert.equal(guard.cleanups.size, 0)
    assert.equal(guard.pendingCleanups.size, 0)
  })

  it('close error uses the same idempotent forced termination path', async () => {
    const guard = makeGuard()
    const timers = createManualTimers()
    let socket
    class Socket extends ControlledAgentSocket {
      constructor (...args) { super(...args); socket = this }
      terminate () {
        super.terminate()
        this.readyState = Socket.CLOSED
      }
    }
    const check = checkAgentWebSocket({ config: agentWebSocketConfig, guard, timeoutMs: 25, WebSocketCtor: Socket, ...timers })
    await flushMicrotasks()
    socket.emit('error', new Error('close exploded'))
    await assert.rejects(check, error => errorContains(error, /close exploded/))
    await guard.dispose()
    assert.equal(socket.closeCalls, 1)
    assert.equal(socket.terminateCalls, 1)
    assert.equal(socket.readyState, Socket.CLOSED)
    assert.equal(guard.cleanups.size, 0)
    assert.equal(guard.pendingCleanups.size, 0)
  })

  it('timeout terminates once and fails even when termination reaches CLOSED', async () => {
    const guard = makeGuard()
    const timers = createManualTimers()
    let socket
    class Socket extends ControlledAgentSocket {
      constructor (...args) { super(...args); socket = this }
      terminate () {
        super.terminate()
        this.readyState = Socket.CLOSED
      }
    }
    const check = checkAgentWebSocket({ config: agentWebSocketConfig, guard, timeoutMs: 25, WebSocketCtor: Socket, ...timers })
    await flushMicrotasks()
    assert.deepEqual(timers.delays, [25])
    assert.equal(timers.runNext(), 25)
    await assert.rejects(check, error => errorContains(error, /terminated fail-closed/))
    await guard.dispose()
    assert.equal(socket.closeCalls, 1)
    assert.equal(socket.terminateCalls, 1)
    assert.equal(socket.readyState, Socket.CLOSED)
    assert.equal(guard.cleanups.size, 0)
    assert.equal(guard.pendingCleanups.size, 0)
  })

  it('terminate throw remains fail-closed while dispose establishes a bounded late-CLOSED wait', async () => {
    const guard = makeGuard()
    const timers = createManualTimers()
    let socket
    class Socket extends ControlledAgentSocket {
      constructor (...args) { super(...args); socket = this }
      terminate () {
        super.terminate()
        throw new Error('terminate exploded')
      }
    }
    const check = checkAgentWebSocket({ config: agentWebSocketConfig, guard, timeoutMs: 25, WebSocketCtor: Socket, ...timers })
    await flushMicrotasks()
    timers.runNext()
    await assert.rejects(check, error => errorContains(error, /terminate exploded/) && errorContains(error, /remained live/))
    assert.equal(socket.closeCalls, 1)
    assert.equal(socket.terminateCalls, 1)

    const disposing = guard.dispose()
    await flushMicrotasks()
    assert.deepEqual(timers.delays, [25])
    socket.confirmClosed()
    await disposing
    assert.equal(socket.terminateCalls, 1)
    assert.equal(guard.cleanups.size, 0)
    assert.equal(guard.pendingCleanups.size, 0)
    assert.equal(socket.listenerCount('close'), 0)
    assert.equal(socket.listenerCount('error'), 0)
    assert.deepEqual(timers.delays, [])
  })

  it('global abort plus a no-op terminate retries cleanup on concurrent dispose and converges on late CLOSED', async () => {
    const guard = makeGuard()
    const timers = createManualTimers()
    let socket
    class Socket extends ControlledAgentSocket { constructor (...args) { super(...args); socket = this } }
    const check = checkAgentWebSocket({ config: agentWebSocketConfig, guard, timeoutMs: 25, WebSocketCtor: Socket, ...timers })
    await flushMicrotasks()

    const terminating = guard.terminate('global deadline exceeded')
    await flushMicrotasks()
    assert.equal(socket.terminateCalls, 1)
    assert.deepEqual(timers.delays, [25])
    timers.runNext()
    await assert.rejects(check, error => errorContains(error, /stopped by termination\/deadline/) && errorContains(error, /remained live/))
    await terminating
    assert.equal(socket.readyState, Socket.CLOSING)
    assert.equal(guard.cleanups.size, 1)

    const firstDispose = guard.dispose()
    const secondDispose = guard.dispose()
    await flushMicrotasks()
    assert.deepEqual(timers.delays, [25])
    assert.equal(socket.terminateCalls, 1)
    socket.confirmClosed()
    await Promise.all([firstDispose, secondDispose])
    assert.equal(socket.readyState, Socket.CLOSED)
    assert.equal(socket.closeCalls, 1)
    assert.equal(socket.terminateCalls, 1)
    assert.equal(guard.cleanups.size, 0)
    assert.equal(guard.pendingCleanups.size, 0)
    assert.equal(guard.cleanupErrors.size, 0)
    assert.equal(socket.listenerCount('close'), 0)
    assert.equal(socket.listenerCount('error'), 0)
    assert.deepEqual(timers.delays, [])
  })

  it('dispose remains bounded and fails closed when a no-op terminate never receives late CLOSED', async () => {
    const guard = makeGuard()
    const timers = createManualTimers()
    let socket
    class Socket extends ControlledAgentSocket { constructor (...args) { super(...args); socket = this } }
    const check = checkAgentWebSocket({ config: agentWebSocketConfig, guard, timeoutMs: 25, WebSocketCtor: Socket, ...timers })
    await flushMicrotasks()
    const terminating = guard.terminate('global deadline exceeded')
    await flushMicrotasks()
    timers.runNext()
    await assert.rejects(check, error => errorContains(error, /remained live/))
    await terminating

    const disposing = guard.dispose()
    await flushMicrotasks()
    assert.deepEqual(timers.delays, [25])
    timers.runNext()
    await assert.rejects(disposing, error => errorContains(error, /Preflight cleanup failed/) && errorContains(error, /remained live/))
    assert.equal(socket.readyState, Socket.CLOSING)
    assert.equal(socket.terminateCalls, 1)
    assert.equal(guard.cleanups.size, 1)
    assert.equal(guard.cleanupErrors.size, 1)
    assert.equal(guard.pendingCleanups.size, 0)
    assert.equal(socket.listenerCount('close'), 0)
    assert.equal(socket.listenerCount('error'), 0)
    assert.deepEqual(timers.delays, [])

    const repeatedDispose = guard.dispose()
    await flushMicrotasks()
    assert.deepEqual(timers.delays, [25])
    timers.runNext()
    await assert.rejects(repeatedDispose, error => errorContains(error, /remained live/))
    assert.equal(socket.readyState, Socket.CLOSING)
    assert.equal(socket.terminateCalls, 1)
    assert.equal(guard.cleanups.size, 1)
    assert.equal(guard.cleanupErrors.size, 1)
    assert.equal(guard.pendingCleanups.size, 0)
    assert.deepEqual(timers.delays, [])
  })

  it('synthetic close while non-CLOSED cannot succeed and forces only one termination', async () => {
    const guard = makeGuard()
    const timers = createManualTimers()
    let socket
    class Socket extends ControlledAgentSocket { constructor (...args) { super(...args); socket = this } }
    const check = checkAgentWebSocket({ config: agentWebSocketConfig, guard, timeoutMs: 25, WebSocketCtor: Socket, ...timers })
    let settled = false
    check.then(() => { settled = true }, () => { settled = true })
    await flushMicrotasks()
    socket.emit('close')
    await flushMicrotasks()
    assert.equal(settled, false)
    assert.equal(socket.readyState, Socket.CLOSING)
    assert.equal(socket.terminateCalls, 1)
    socket.confirmClosed()
    await assert.rejects(check, error => errorContains(error, /without CLOSED readyState/))
    await guard.dispose()
    assert.equal(socket.terminateCalls, 1)
    assert.equal(socket.readyState, Socket.CLOSED)
    assert.equal(guard.cleanups.size, 0)
    assert.equal(guard.pendingCleanups.size, 0)
  })

  it('already-CLOSED socket succeeds without another close or termination attempt', async () => {
    const guard = makeGuard()
    const timers = createManualTimers()
    let socket
    class Socket extends ControlledAgentSocket {
      constructor (...args) {
        super(...args)
        socket = this
        this.once('message', () => { this.readyState = Socket.CLOSED })
      }
    }
    await checkAgentWebSocket({ config: agentWebSocketConfig, guard, timeoutMs: 25, WebSocketCtor: Socket, ...timers })
    assert.equal(socket.closeCalls, 0)
    assert.equal(socket.terminateCalls, 0)
    assert.equal(guard.cleanups.size, 0)
    await guard.dispose()
  })

  it('termination closes tracked WebSocket/CDP and kills tracked Chromium', async () => {
    const signalTarget = new EventEmitter()
    const guard = makeGuard({ signalTarget })
    const cleanup = { ws: 0, cdp: 0, chrome: 0 }
    guard.trackCleanup(() => { cleanup.ws++ })
    guard.trackCleanup(() => { cleanup.cdp++ })
    guard.trackCleanup(() => { cleanup.chrome++ })

    signalTarget.emit('SIGTERM')
    await guard.cleanupPromise
    assert.deepEqual(cleanup, { ws: 1, cdp: 1, chrome: 1 })
    await guard.dispose()
  })

  it('global termination aborts the underlying fetch signal', async () => {
    const guard = makeGuard()
    let observedAbort = false
    const fetchPromise = guard.runFetch(async (_url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        observedAbort = true
        reject(options.signal.reason)
      }, { once: true })
    }), 'https://localhost:10018/login', {}, 'credentialed login', 1000)

    guard.terminate('global deadline exceeded')
    await assert.rejects(fetchPromise)
    assert.equal(observedAbort, true)
    await guard.dispose()
  })

  it('deadline is globally bounded to five minutes', () => {
    assert.equal(MAX_PREFLIGHT_DEADLINE_MS, 300_000)
    assert.throws(() => makeGuard({ deadlineMs: MAX_PREFLIGHT_DEADLINE_MS + 1 }), /at most 300000ms/)
  })

  it('requestJson refuses redirects and response-origin drift before parsing credentialed bodies', async () => {
    const guard = makeGuard()
    const runtime = {
      config: {
        targetOrigins: { backend: 'https://api.example.test' }
      },
      guard,
      requestTimeoutMs: 1000,
      fetchImpl: async (url, options) => {
        assert.equal(url.href, 'https://api.example.test/oauth2/token')
        assert.equal(options.redirect, 'manual')
        assert.equal(options.method, 'POST')
        return {
          ok: true,
          status: 200,
          redirected: false,
          url: 'https://attacker.example/oauth2/token',
          json: async () => ({ access_token: 'must-not-be-read' })
        }
      }
    }
    await assert.rejects(
      requestJson(runtime, 'https://api.example.test/oauth2/token', {
        method: 'POST',
        body: 'credentialed-body',
        redirect: 'follow'
      }),
      /unapproved origin/
    )

    let fetchCalls = 0
    runtime.fetchImpl = async () => { fetchCalls++; throw new Error('must not fetch') }
    await assert.rejects(
      requestJson(runtime, 'https://attacker.example/oauth2/token', {
        method: 'POST', body: 'credentialed-body'
      }),
      /unapproved origin/
    )
    assert.equal(fetchCalls, 0)
    await guard.dispose()
  })

  it('frontend HEAD is manual-only and fails closed on redirects or response-origin drift', async () => {
    const guard = makeGuard()
    const config = {
      targets: { frontend: new URL('https://app.example.test') },
      targetOrigins: { frontend: 'https://app.example.test' }
    }
    let mode = 'redirect'
    const fetchImpl = async (url, options) => {
      assert.equal(url.href, 'https://app.example.test/juyiting')
      assert.equal(options.method, 'HEAD')
      assert.equal(options.redirect, 'manual')
      if (mode === 'redirect') {
        return { status: 302, ok: false, redirected: false, url: url.href }
      }
      return { status: 200, ok: true, redirected: false, url: 'https://attacker.example/juyiting' }
    }
    await assert.rejects(
      checkFrontendRoute({ config, guard, fetchImpl, timeoutMs: 1000 }),
      /refused HTTP redirect 302/
    )
    mode = 'origin'
    await assert.rejects(
      checkFrontendRoute({ config, guard, fetchImpl, timeoutMs: 1000 }),
      /unapproved origin/
    )
    await guard.dispose()
  })

  it('browser origin policy binds navigation, frames, token storage, Bearer traffic, and built API base', () => {
    const token = 'offline-smoke-token'
    const config = {
      targetOrigins: {
        frontend: 'https://app.example.test',
        backend: 'https://api.example.test'
      }
    }
    const policy = new BrowserOriginPolicy(config, token, () => 1000)
    const bearer = { Authorization: `Bearer ${token}` }

    assert.throws(() => policy.inspectPausedRequest({
      resourceType: 'Document',
      request: { url: 'https://frames.example.test/juyiting', headers: {} }
    }), /unapproved origin/)
    assert.throws(() => policy.inspectPausedRequest({
      resourceType: 'XHR',
      request: { url: 'https://app.example.test/api/agent/map', headers: bearer }
    }), /Bearer traffic crossed|API base/)
    assert.throws(() => policy.inspectPausedRequest({
      resourceType: 'XHR',
      request: { url: 'https://attacker.example/collect', headers: bearer }
    }), /Bearer traffic crossed/)

    const corsPreflight = policy.inspectPausedRequest({
      resourceType: 'XHR',
      request: {
        method: 'OPTIONS',
        url: 'https://api.example.test/agent/map',
        headers: { Origin: 'https://app.example.test' }
      }
    })
    assert.deepEqual(corsPreflight, {
      fixture: 'mapAgents',
      suffix: '/agent/map',
      preflight: true
    })
    assert.throws(() => policy.inspectPausedRequest({
      resourceType: 'XHR',
      request: {
        method: 'OPTIONS',
        url: 'https://api.example.test/agent/map',
        headers: { Origin: 'https://attacker.example' }
      }
    }), /approved frontend origin/)

    for (const path of [
      '/agent/map',
      '/agent/scenes/juyiting-main/snapshot',
      '/agent/scenes/juyiting-main/events'
    ]) {
      policy.inspectPausedRequest({
        resourceType: 'XHR',
        request: { url: `https://api.example.test${path}`, headers: bearer }
      })
    }
    policy.assertFrameTree({
      frame: { url: 'https://app.example.test/juyiting?scene-debug=1' },
      childFrames: [{ frame: { url: 'https://app.example.test/frame-helper#embedded' } }]
    })
    assert.throws(() => policy.assertFinalState({
      url: 'https://attacker.example/juyiting',
      isTopFrame: true,
      storageOrigin: 'https://attacker.example',
      apiToken: JSON.stringify({ data: token, expTime: 2000 })
    }), /unapproved origin/)
    assert.throws(() => policy.assertFinalState({
      url: 'https://app.example.test/juyiting',
      isTopFrame: true,
      storageOrigin: 'https://app.example.test',
      apiToken: JSON.stringify({ data: 'wrong-token', expTime: 2000 })
    }), /active smoke token/)
    const finalUrl = policy.assertFinalState({
      url: 'https://app.example.test/juyiting?scene-debug=1',
      isTopFrame: true,
      storageOrigin: 'https://app.example.test',
      apiToken: JSON.stringify({ data: token, expTime: 2000 })
    })
    assert.equal(finalUrl.origin, 'https://app.example.test')
    const bootstrap = policy.tokenBootstrapSource()
    assert.match(bootstrap, /window\.top !== window/)
    assert.match(bootstrap, /location\.origin !== "https:\/\/app\.example\.test"/)
  })

  it('browser origin policy fails when the built API base never reaches every approved backend endpoint', () => {
    const token = 'offline-smoke-token'
    const policy = new BrowserOriginPolicy({
      targetOrigins: {
        frontend: 'https://app.example.test',
        backend: 'https://api.example.test'
      }
    }, token, () => 1000)
    policy.inspectPausedRequest({
      resourceType: 'XHR',
      request: {
        url: 'https://api.example.test/agent/map',
        headers: { authorization: `Bearer ${token}` }
      }
    })
    assert.throws(() => policy.assertFinalState({
      url: 'https://app.example.test/juyiting',
      isTopFrame: true,
      storageOrigin: 'https://app.example.test',
      apiToken: JSON.stringify({ data: token, expTime: 2000 })
    }), /API base was not verified/)
  })

  it('ambient process TLS bypass cannot be hidden by an injected options.env object', async () => {
    const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED
    const bytes = manifestBytes()
    let approvalReads = 0
    try {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
      const env = approvedProductionEnv(bytes)
      delete env.NODE_TLS_REJECT_UNAUTHORIZED
      await assert.rejects(
        validateSafetyConfig({
          mode: 'preflight',
          env,
          readFileImpl: async () => { approvalReads++; return bytes }
        }),
        /ambient process state/
      )
      assert.equal(approvalReads, 0)
    } finally {
      if (previous === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous
    }
  })

  it('direct UI smoke loads third-party CDP support only after the global guard exists', async () => {
    const signalTarget = new EventEmitter()
    let moduleLoads = 0
    let fetchCalls = 0
    await assert.rejects(
      runUiSmoke({
        env: localEnv(),
        signalTarget,
        setTimeoutImpl: inertTimer,
        clearTimeoutImpl: () => {},
        loadWebSocketModuleImpl: async () => {
          moduleLoads++
          signalTarget.emit('SIGTERM')
          return { default: class OfflineWebSocket {} }
        },
        fetchImpl: async () => { fetchCalls++; throw new Error('must not fetch') },
        spawnImpl: () => { throw new Error('must not spawn') }
      }),
      /received SIGTERM/
    )
    assert.equal(moduleLoads, 1)
    assert.equal(fetchCalls, 0)
    const source = readFileSync('tests/juyiting-public-beta-ui-smoke.mjs', 'utf8')
    assert.equal(/import\s+WebSocket\s+from\s+['"]ws['"]/.test(source), false)
  })

  it('process-tree cleanup verifies SIGTERM, escalates to SIGKILL, and reports survivors', async () => {
    let running = true
    const signals = []
    await stopProcessTree({
      child: {},
      label: 'offline child',
      termTimeoutMs: 0,
      killTimeoutMs: 0,
      isRunningImpl: () => running,
      signalImpl: (_child, signal) => {
        signals.push(signal)
        if (signal === 'SIGKILL') running = false
      },
      delayImpl: async () => {}
    })
    assert.deepEqual(signals, ['SIGTERM', 'SIGKILL'])

    await assert.rejects(
      stopProcessTree({
        child: {},
        label: 'stubborn child',
        termTimeoutMs: 0,
        killTimeoutMs: 0,
        isRunningImpl: () => true,
        signalImpl: () => {},
        delayImpl: async () => {}
      }),
      /did not exit after SIGTERM\/SIGKILL/
    )
  })

  it('global guard reports tracked cleanup failures explicitly', async () => {
    const guard = makeGuard()
    guard.trackCleanup(async () => { throw new Error('offline cleanup failure') })
    guard.terminate('global deadline exceeded')
    await assert.rejects(
      guard.dispose(),
      error => error?.code === PREFLIGHT_CLEANUP_ERROR_CODE && /Preflight cleanup failed/.test(error.message)
    )
  })

  it('tracked cleanup cannot be cancelled before asynchronous close finishes', async () => {
    let release
    let untracked = false
    const cleanup = completeTrackedCleanup(
      () => new Promise(resolvePromise => { release = resolvePromise }),
      () => { untracked = true }
    )
    await new Promise(resolvePromise => setImmediate(resolvePromise))
    assert.equal(untracked, false)
    release()
    await cleanup
    assert.equal(untracked, true)

    let failureUntracked = false
    await assert.rejects(
      completeTrackedCleanup(
        async () => { throw new Error('close failed') },
        () => { failureUntracked = true }
      ),
      /close failed/
    )
    assert.equal(failureUntracked, false)
  })

  it('npm child spawn errors are observed and cleanup completes before rejection', async () => {
    const guard = makeGuard()
    const child = new EventEmitter()
    child.exitCode = null
    child.signalCode = null
    const signals = []
    child.kill = signal => {
      signals.push(signal)
      child.signalCode = signal
      child.emit('exit', null, signal)
    }
    const execFileImpl = () => {
      queueMicrotask(() => child.emit('error', new Error('offline spawn error')))
      return child
    }
    await assert.rejects(
      runNpmScript('validate:juyiting-map', {
        guard,
        execFileImpl,
        npmExecPath: '/offline/npm-cli.js'
      }),
      /offline spawn error/
    )
    assert.deepEqual(signals, ['SIGTERM'])
    await guard.dispose()
  })

  it('Chromium spawn/CDP close errors are observed and profile deletion waits for verified tree exit', async () => {
    const guard = makeGuard()
    const runtime = { guard }
    const child = new EventEmitter()
    const spawnWait = waitForChildSpawn(runtime, child, 'offline Chromium spawn')
    child.emit('error', new Error('chromium spawn failed'))
    await assert.rejects(spawnWait, /chromium spawn failed/)

    let socket
    class FakeSocket {
      constructor () {
        socket = this
        this.readyState = 1
        this.events = new EventEmitter()
      }
      addEventListener (name, listener, options) {
        this.events[options?.once ? 'once' : 'on'](name, listener)
      }
      removeEventListener (name, listener) { this.events.off(name, listener) }
      close (code, reason) {
        setImmediate(() => {
          this.readyState = 3
          this.events.emit('close', { code, reason, wasClean: true })
        })
      }
    }
    const cdp = new CdpSession(runtime, 'ws://127.0.0.1/devtools/page/offline', FakeSocket)
    let cdpClosed = false
    const closing = cdp.close().then(() => { cdpClosed = true })
    await Promise.resolve()
    assert.equal(cdpClosed, false)
    await closing
    assert.equal(socket.readyState, 3)

    const cleanupOrder = []
    await stopChrome({ pid: 123, exitCode: null, signalCode: null }, '/owned/offline-profile', {
      stopProcessTreeImpl: async () => { cleanupOrder.push('tree-exited') },
      removeImpl: async () => { cleanupOrder.push('profile-removed') }
    })
    assert.deepEqual(cleanupOrder, ['tree-exited', 'profile-removed'])

    let removeCalls = 0
    await assert.rejects(
      stopChrome({ pid: 123, exitCode: null, signalCode: null }, '/owned/offline-profile', {
        stopProcessTreeImpl: async () => { throw new Error('tree survived') },
        removeImpl: async () => { removeCalls++ }
      }),
      /Chromium cleanup failed/
    )
    assert.equal(removeCalls, 0)
    await guard.dispose()
  })

  it('terminal CDP barrier waits for late handlers and drains late socket errors', async () => {
    const guard = makeGuard()
    const runtime = {
      guard,
      cdpCommandTimeoutMs: 100,
      cdpCloseTimeoutMs: 100
    }
    let socket
    class LateErrorSocket {
      constructor () {
        socket = this
        this.readyState = 0
        this.events = new EventEmitter()
        queueMicrotask(() => {
          this.readyState = 1
          this.events.emit('open')
        })
      }

      addEventListener (name, listener, options) {
        this.events[options?.once ? 'once' : 'on'](name, listener)
      }

      removeEventListener (name, listener) { this.events.off(name, listener) }

      send (payload) {
        const request = JSON.parse(payload)
        setImmediate(() => {
          this.events.emit('message', {
            data: JSON.stringify({ id: request.id, result: { result: { value: null } } })
          })
          if (request.method === 'Runtime.evaluate') {
            setImmediate(() => {
              this.events.emit('message', {
                data: JSON.stringify({
                  method: 'Page.frameNavigated',
                  params: { frame: { url: 'https://attacker.example/late-frame' } }
                })
              })
              this.events.emit('error', new Error('late offline socket error'))
            })
          }
        })
      }

      close (code, reason) {
        setImmediate(() => {
          this.readyState = 3
          this.events.emit('close', { code, reason, wasClean: true })
        })
      }
    }

    const cdp = new CdpSession(runtime, 'ws://127.0.0.1/devtools/page/offline', LateErrorSocket)
    cdp.on('Page.frameNavigated', async () => {
      await new Promise(resolvePromise => setImmediate(resolvePromise))
      throw new Error('late offline handler error')
    })
    await cdp.open()
    await assert.rejects(
      cdp.terminalBarrier(),
      error => {
        const messages = (error instanceof AggregateError ? error.errors : [error])
          .map(candidate => candidate.message)
          .sort()
        assert.deepEqual(messages, [
          'late offline handler error',
          'late offline socket error'
        ])
        return true
      }
    )
    await cdp.close()
    assert.equal(socket.readyState, 3)
    await guard.dispose()
  })

  it('queued remote close delivered during local cleanup cannot inherit local close provenance', async () => {
    const guard = makeGuard()
    const runtime = {
      guard,
      cdpCommandTimeoutMs: 100,
      cdpCloseTimeoutMs: 100
    }
    let socket
    class QueuedRemoteCloseSocket {
      constructor () {
        socket = this
        this.readyState = 0
        this.remoteCloseQueued = false
        this.events = new EventEmitter()
        queueMicrotask(() => {
          this.readyState = 1
          this.events.emit('open')
        })
      }

      addEventListener (name, listener, options) {
        this.events[options?.once ? 'once' : 'on'](name, listener)
      }

      removeEventListener (name, listener) { this.events.off(name, listener) }

      send (payload) {
        const request = JSON.parse(payload)
        setImmediate(() => {
          this.events.emit('message', {
            data: JSON.stringify({ id: request.id, result: { result: { value: null } } })
          })
        })
      }

      queueRemoteClose () {
        this.remoteCloseQueued = true
      }

      close (code, reason) {
        assert.equal(this.remoteCloseQueued, true)
        assert.equal(code, 1000)
        assert.match(reason, /^juyiting-preflight-[a-f0-9]{16}$/)
        setImmediate(() => {
          this.readyState = 3
          this.events.emit('close', {
            code: 1006,
            reason: 'remote failure queued before local close',
            wasClean: false
          })
        })
      }
    }

    const cdp = new CdpSession(runtime, 'ws://127.0.0.1/devtools/page/offline', QueuedRemoteCloseSocket)
    await cdp.open()
    await cdp.terminalBarrier()
    socket.queueRemoteClose()
    await assert.rejects(
      cdp.close(),
      /remote or unproven close was delivered with code 1006/
    )
    assert.equal(socket.readyState, 3)
    await guard.dispose()
  })

  it('process-tree cleanup polling keeps a real Node event loop alive until exit confirmation', () => {
    const safetyModule = new URL('./juyiting-preflight-safety.mjs', import.meta.url).href
    const script = `
      import { waitForProcessTreeExit } from ${JSON.stringify(safetyModule)};
      let checks = 0;
      waitForProcessTreeExit({
        child: {},
        timeoutMs: 200,
        pollMs: 25,
        isRunningImpl: () => ++checks < 2
      }).then(
        () => process.stdout.write('process-tree-confirmed'),
        error => { console.error(error); process.exitCode = 1; }
      );
    `
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
      timeout: 1000
    })
    assert.equal(result.status, 0, result.error?.message || result.stderr)
    assert.equal(result.stdout, 'process-tree-confirmed')
  })

  it('CDP close timeout keeps a real Node event loop alive until explicit failure', () => {
    const uiSmokeModule = new URL('./juyiting-public-beta-ui-smoke.mjs', import.meta.url).href
    const script = `
      import { CdpSession } from ${JSON.stringify(uiSmokeModule)};
      class NeverClosingSocket {
        constructor () { this.readyState = 1; }
        addEventListener () {}
        removeEventListener () {}
        close () {}
      }
      const guard = {
        signal: new AbortController().signal,
        beforeBoundary () {},
        remainingMs () { return 1000; }
      };
      const cdp = new CdpSession({
        guard,
        cdpCommandTimeoutMs: 100,
        cdpCloseTimeoutMs: 25
      }, 'ws://127.0.0.1/devtools/page/offline', NeverClosingSocket);
      cdp.close().then(
        () => { console.error('unexpected close'); process.exitCode = 1; },
        error => process.stdout.write(error.message)
      );
    `
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
      timeout: 1000
    })
    assert.equal(result.status, 0, result.error?.message || result.stderr)
    assert.equal(result.stdout, 'CDP WebSocket did not close within 25ms')
  })

  it('sanitized output removes credential values and secret URL query/fragment data', () => {
    const secret = 'credential-value'
    const sanitized = sanitizeMessage(
      `failed for ${secret} at https://api.example.test/oauth2/callback?code=${secret}#fragment`,
      [secret]
    )
    assert.equal(sanitized.includes(secret), false)
    assert.equal(sanitized.includes('?'), false)
    assert.equal(sanitized.includes('#fragment'), false)
    assert.equal(sanitized, 'failed for [REDACTED] at https://api.example.test/oauth2/callback')
    assert.match(
      sanitizeError(new AggregateError([
        new Error('Chromium process tree survived')
      ], 'cleanup failed')),
      /cleanup failed: Chromium process tree survived/
    )
  })

  it('explicitly completes onboarding before exercising canvas interactions', () => {
    const source = readFileSync('tests/juyiting-public-beta-ui-smoke.mjs', 'utf8')
    const initialDebugIndex = source.indexOf('const initialDebug = await readDebug(cdp)')
    const onboardingIndex = source.indexOf('await completeOnboarding(runtime, cdp)')
    const hotspotIndex = source.indexOf("await centerSceneHotspot(cdp, 'library')")

    assert.ok(source.includes('document.querySelector(".onboarding-overlay .complete-button")'))
    assert.ok(initialDebugIndex >= 0)
    assert.ok(onboardingIndex > initialDebugIndex)
    assert.ok(hotspotIndex > onboardingIndex)
  })

})
