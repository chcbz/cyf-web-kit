import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { describe as nodeDescribe, it as nodeIt } from 'node:test'

import { runNpmScript, runPreflight } from './juyiting-public-beta-preflight.mjs'
import {
  APPROVAL_MANIFEST_SCHEMA,
  MAX_PREFLIGHT_DEADLINE_MS,
  PREFLIGHT_APPROVAL_SCOPE,
  UI_SMOKE_APPROVAL_SCOPE,
  PreflightTerminationGuard,
  createSafetyContext,
  sanitizeMessage,
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
  })
})
