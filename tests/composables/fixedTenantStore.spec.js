import 'fake-indexeddb/auto'
import { expect } from 'chai'
import { build } from 'esbuild'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'
import { basicClaims, fixedRuntime, resourceIdentity, signedToken, verifiedClaims } from '../fixtures/fixed-tenant-identity.mjs'

Object.defineProperty(globalThis, 'indexedDB', { value: window.indexedDB, configurable: true })
const repo = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(new URL('../../package.json', import.meta.url))
let runtime
let store
let originalFetch
const originalLocks = Object.getOwnPropertyDescriptor(window.navigator, 'locks')

const jsonResponse = data => new Response(JSON.stringify(data), { status: 200,
  headers: { 'Content-Type': 'application/json' } })
const response = (data, requestId) => new Response(JSON.stringify({
  protocolVersion: 1, requestId, code: 'E0', msg: 'ok', data
}), { status: 200, headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId } })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

// Compile the actual production call graph with fixed Vite configuration. Do
// not replace store actions with mocks or change the default-env legacy tests.
describe('actual fixed tenant store call graph (offline signed JWT server fixture)', () => {
before(async () => {
  const heldLocks = new Set()
  Object.defineProperty(window.navigator, 'locks', { configurable: true, value: {
    request (name, options, callback) {
      expect(options).to.deep.equal({ mode: 'exclusive', ifAvailable: true })
      if (heldLocks.has(name)) return Promise.resolve(callback(null))
      heldLocks.add(name)
      return Promise.resolve(callback({ name }))
    }
  } })
  const out = await mkdtemp(join(tmpdir(), 'fixed-tenant-store-'))
  const outfile = join(out, 'runtime.mjs')
  await build({ stdin: { resolveDir: repo, contents: `
    export { createPinia, setActivePinia } from 'pinia';
    export { useApiStore, validTenantIdentity, verifyPersistedTenantSession } from './src/stores/api.js';
    export { useGlobalStore } from './src/stores/global.js';
    export { useHttp } from './src/composables/useHttp.js';
    export { fetchHallConversationEvents } from './src/utils/authenticatedSse.js';
    export { browserBusinessNamespace } from './src/utils/tenantBusinessNamespace.js';
    export { bindFixedTenantIdentity } from './src/utils/fixedTenantIdentity.js';
    export { beginTenantAuthorization, commitTenantAuthorization, readTenantSession } from './src/utils/tenantAuthLedger.js';
    export { tenantBrowserTabId } from './src/utils/tenantBrowserTab.js';
  ` }, bundle: true, platform: 'node', format: 'esm', outfile,
  define: { 'import.meta.env': JSON.stringify(fixedRuntime) },
  plugins: [{ name: 'shared-node-packages', setup (compiler) {
    compiler.onResolve({ filter: /^[^./]/ }, args => args.path === 'consola'
      ? undefined : ({ path: require.resolve(args.path), external: true }))
  } }] })
  runtime = await import(pathToFileURL(outfile).href)
})
after(() => {
  if (originalLocks) Object.defineProperty(window.navigator, 'locks', originalLocks)
  else delete window.navigator.locks
})

beforeEach(() => {
  runtime.setActivePinia(runtime.createPinia())
  window.localStorage.clear()
  window.sessionStorage.clear()
  store = runtime.useApiStore()
  originalFetch = global.fetch
})
afterEach(async () => {
  store.clearIdentity()
  // Wait for this store's real queued ledger logout, not one arbitrary tick.
  try { await store.assertTenantTokenCurrent('cleared') } catch (error) {
    expect(error.name).to.equal('AbortError')
  }
  global.fetch = originalFetch
})

async function authorization () {
  const context = { issuer: fixedRuntime.VITE_OAUTH_ISSUER, origin: window.location.origin,
    clientId: 'cyf-local', tabId: await runtime.tenantBrowserTabId(),
    state: randomBytes(32).toString('base64url'), expectedTenant: '1' }
  await runtime.beginTenantAuthorization(context)
  return { context, transaction: { clientId: context.clientId, state: context.state,
    codeVerifier: 'A'.repeat(86), redirectUri: `${window.location.origin}/oauth2/callback`,
    authorizationServer: fixedRuntime.VITE_OAUTH_BASE_URL, expectedTenant: '1' } }
}

function transport (claims = basicClaims(), { identity, profile = { id: 42, jiacn: 'owner-A' } } = {}) {
  const token = signedToken(claims)
  const calls = []
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options })
    if (url === `${fixedRuntime.VITE_OAUTH_BASE_URL}/oauth2/token`) {
      return jsonResponse({ access_token: token, token_type: 'Bearer', expires_in: 300 })
    }
    // The mock server validates the RS256 signature of this exact bearer. The
    // fixture is intentionally offline and is not a real account/issuer login.
    const current = verifiedClaims(options.headers.Authorization.slice('Bearer '.length))
    const requestId = new Headers(options.headers).get('X-Request-Id')
    if (url === `${fixedRuntime.VITE_OAUTH_BASE_URL}/resource`) return response(identity || resourceIdentity(current), requestId)
    if (url === `${fixedRuntime.VITE_API_BASE_URL}/user/my`) return response(profile, requestId)
    throw new Error(`Unexpected offline URL: ${url}`)
  }
  return { token, claims, calls }
}

async function login (claims = basicClaims(), options) {
  const server = transport(claims, options)
  const { context, transaction } = await authorization()
  expect(await store.exchangeCodeForToken('offline-code', transaction)).to.equal(server.token)
  await store.getUserInfo()
  return { ...server, context, transaction }
}

  it('logs in through central OAuth/resource, then hydrates the local tenant1 profile without a platform bundle', async () => {
    const { token, calls } = await login()
    expect(store.oauthRuntimeConfig()).to.include({ authorizationServer: fixedRuntime.VITE_OAUTH_BASE_URL, expectedTenant: '1' })
    expect(store.hasActiveToken()).to.equal(true)
    expect(store.activeTenantId()).to.equal('1')
    expect(store.tenantIdentity).to.include({ userId: '42', authEpoch: '7', tokenKind: 'user', tenantId: '1' })
    for (const field of ['dataDomainId', 'tenantSessionEpoch', 'membershipRevision', 'clientTenantGrantRevision']) {
      expect(store.tenantIdentity[field]).to.equal(undefined)
    }
    expect(runtime.browserBusinessNamespace(store, runtime.useGlobalStore())).to.match(/^tenant-fixed-v1:/)
    const resource = calls.find(call => call.url.endsWith('/resource'))
    expect(resource.options.cache).to.equal('no-store')
    expect(resource.options.headers.Authorization).to.equal(`Bearer ${token}`)
    expect(calls.find(call => call.url === `${fixedRuntime.VITE_API_BASE_URL}/user/my`).options.cache).to.equal('no-store')
    expect(window.localStorage.getItem('api_token')).to.equal(null)
  })

  it('restores a persisted basic identity through live resource and exact uid/owner profile checks', async () => {
    const { context, token } = await login()
    const snapshot = await runtime.readTenantSession({ ...context, tenantId: '1' })
    runtime.setActivePinia(runtime.createPinia())
    store = runtime.useApiStore()
    expect(await store.verifyTenantSnapshot(snapshot, context, '1')).to.equal(token)
    expect(runtime.useGlobalStore().getUserId).to.equal(42)
    expect(runtime.browserBusinessNamespace(store, runtime.useGlobalStore())).not.to.equal('')
    expect(await runtime.verifyPersistedTenantSession(snapshot.session,
      { clientId: 'cyf-local', expectedTenant: '1', authorizationServer: fixedRuntime.VITE_OAUTH_BASE_URL })).to.equal(true)
  })

  it('does not commit tenant0, wrong issuer/client or machine token candidates', async () => {
    for (const delta of [{ tenant_id: '0' }, { iss: 'https://foreign.example' },
      { client_id: 'foreign-client' }, { token_kind: 'machine' }]) {
      transport(basicClaims(delta))
      const { context, transaction } = await authorization()
      let failure
      try { await store.exchangeCodeForToken('offline-code', transaction) } catch (error) { failure = error }
      expect(failure?.message, JSON.stringify(delta)).to.equal('Tenant identity verification failed')
      expect(store.hasActiveToken()).to.equal(false)
      expect(store.tenantIdentity).to.equal(null)
      expect(await runtime.readTenantSession({ ...context, tenantId: '1' })).to.equal(null)
    }
  })

  it('rejects another profile uid or owner even if the bearer/resource pair agrees', async () => {
    for (const profile of [{ id: 43, jiacn: 'owner-A' }, { id: 42, jiacn: 'owner-B' }]) {
      const server = transport(basicClaims(), { profile })
      const { context, transaction } = await authorization()
      await store.exchangeCodeForToken('offline-code', transaction)
      let failure
      try { await store.getUserInfo() } catch (error) { failure = error }
      expect(failure?.message).to.equal('Tenant user profile mismatch')
      expect(runtime.browserBusinessNamespace(store, runtime.useGlobalStore())).to.equal('')
      // Persisted hydration performs the same check before publishing the token.
      const snapshot = await runtime.readTenantSession({ ...context, tenantId: '1' })
      runtime.setActivePinia(runtime.createPinia())
      store = runtime.useApiStore()
      try { await store.verifyTenantSnapshot(snapshot, context, '1') } catch (error) { failure = error }
      expect(failure?.message).to.equal('Stored tenant profile mismatch')
      expect(store.hasActiveToken()).to.equal(false)
      expect(server.token).to.be.a('string')
    }
  })

  it('does not recover tenant0 or a forged stored account epoch as tenant1', async () => {
    const { context } = await login()
    const snapshot = await runtime.readTenantSession({ ...context, tenantId: '1' })
    for (const changed of [{ tenantId: '0' }, { authEpoch: '8' }, { userId: '43' }]) {
      const candidate = { ...snapshot.session, identity: { ...snapshot.session.identity, ...changed } }
      expect(await runtime.verifyPersistedTenantSession(candidate,
        { clientId: 'cyf-local', expectedTenant: '1', authorizationServer: fixedRuntime.VITE_OAUTH_BASE_URL })).to.equal(false)
    }
  })

  it('does not restart authorization when logout cancels queued token acquisition', async () => {
    await login()
    let authorizations = 0
    store.beginAuthorization = async () => { authorizations += 1 }
    const pending = store.token().catch(error => error)
    store.clearIdentity()
    expect((await pending).name).to.equal('AbortError')
    expect(authorizations).to.equal(0)
    expect(store.hasActiveToken()).to.equal(false)
  })

  it('fences a late resource response after callback logout before any ledger commit', async () => {
    const server = transport()
    const originalTransport = global.fetch
    const wait = deferred()
    const started = deferred()
    let request
    global.fetch = (url, options) => {
      if (!url.endsWith('/resource')) return originalTransport(url, options)
      // Verify the exact signed bearer even though the server response is late.
      verifiedClaims(options.headers.Authorization.slice('Bearer '.length))
      request = options
      started.resolve()
      return wait.promise
    }
    const { context, transaction } = await authorization()
    const pending = store.exchangeCodeForToken('offline-code', transaction).catch(error => error)
    await started.promise
    store.clearIdentity()
    expect(request.signal.aborted).to.equal(true)
    wait.resolve(response(resourceIdentity(server.claims), new Headers(request.headers).get('X-Request-Id')))
    expect((await pending).name).to.equal('AbortError')
    expect(store.hasActiveToken()).to.equal(false)
    expect(store.tenantIdentity).to.equal(null)
    await store.assertTenantTokenCurrent('cleared').catch(() => {})
    expect(await runtime.readTenantSession({ ...context, tenantId: '1' })).to.equal(null)
  })

  it('drops an in-flight HTTP response on logout and never uses the browser HTTP cache', async () => {
    await login()
    const wait = deferred()
    const started = deferred()
    let request
    global.fetch = (_url, options) => { request = options; started.resolve(); return wait.promise }
    const published = []
    const pending = runtime.useHttp().get('/fixed/late', {}, { authStore: store,
      onSuccess: value => published.push(value) }).catch(error => error)
    await started.promise
    expect(request.cache).to.equal('no-store')
    store.clearIdentity()
    expect(request.signal.aborted).to.equal(true)
    wait.resolve(response('old-permission', new Headers(request.headers).get('X-Request-Id')))
    expect((await pending).name).to.equal('AbortError')
    expect(published).to.deep.equal([])
    expect(runtime.browserBusinessNamespace(store, runtime.useGlobalStore())).to.equal('')
  })

  it('cancels old HTTP work when the same uid recovers with a newer auth_epoch', async () => {
    const { context } = await login()
    const originalKey = runtime.browserBusinessNamespace(store, runtime.useGlobalStore())
    const wait = deferred()
    const started = deferred()
    let request
    global.fetch = (_url, options) => { request = options; started.resolve(); return wait.promise }
    const published = []
    const pending = runtime.useHttp().get('/fixed/late-epoch', {}, { authStore: store,
      onSuccess: value => published.push(value) }).catch(error => error)
    await started.promise
    const generation = store.authorizationGeneration
    const server = transport(basicClaims({ auth_epoch: 8 }))
    const next = await authorization()
    const resource = await global.fetch(`${fixedRuntime.VITE_OAUTH_BASE_URL}/resource`,
      { headers: { Authorization: `Bearer ${server.token}`, 'X-Request-Id': crypto.randomUUID() } })
      .then(value => value.json()).then(value => value.data)
    const identity = runtime.bindFixedTenantIdentity(resource, server.token,
      { issuer: context.issuer, clientId: 'cyf-local', tenantId: '1' })
    await runtime.commitTenantAuthorization({ ...next.context, verifiedTenant: '1',
      session: { accessToken: server.token, expiresAt: Date.now() + 300_000, identity } })
    expect(await store.token()).to.equal(server.token)
    expect(store.authorizationGeneration).to.be.greaterThan(generation)
    expect(store.tenantIdentity.authEpoch).to.equal('8')
    expect(runtime.browserBusinessNamespace(store, runtime.useGlobalStore())).not.to.equal(originalKey)
    expect(request.signal.aborted).to.equal(true)
    wait.resolve(response('old-epoch', new Headers(request.headers).get('X-Request-Id')))
    expect((await pending).name).to.equal('AbortError')
    expect(published).to.deep.equal([])
  })

  it('cancels the previous SSE identity at same-user re-login and fences late frames', async () => {
    const { token } = await login()
    let source
    let options
    const opened = await runtime.fetchHallConversationEvents({ apiStore: store, url: '/fixed/events',
      fetchImpl: async (_url, config) => {
        options = config
        return new Response(new ReadableStream({ start: value => { source = value } }), { headers: {
          'Content-Type': 'text/event-stream',
          'X-Request-Id': new Headers(config.headers).get('X-Request-Id')
        } })
      } })
    const reader = opened.body.getReader()
    source.enqueue(new TextEncoder().encode('first'))
    expect(new TextDecoder().decode((await reader.read()).value)).to.equal('first')
    expect(options.cache).to.equal('no-store')
    expect(new Headers(options.headers).get('Authorization')).to.equal(`Bearer ${token}`)
    const late = reader.read().catch(error => ({ error }))
    await login(basicClaims({ auth_epoch: 8 }))
    expect(options.signal.aborted).to.equal(true)
    const ending = await late
    expect(ending.done === true || ending.error?.name === 'AbortError').to.equal(true)
    expect(store.tenantIdentity.authEpoch).to.equal('8')
  })
})
