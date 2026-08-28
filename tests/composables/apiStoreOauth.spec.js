import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { createPinia, setActivePinia } from 'pinia'
import { useApiStore } from '../../src/stores/api.js'
import { initiateReauthentication } from '../../src/utils/reauthentication.js'

Object.defineProperty(global, 'location', { value: window.location, writable: true, configurable: true })
Object.defineProperty(global, 'localStorage', { value: window.localStorage, writable: true, configurable: true })
Object.defineProperty(global, 'sessionStorage', { value: window.sessionStorage, writable: true, configurable: true })

const transaction = Object.freeze({
  codeVerifier: 'A'.repeat(86),
  returnTo: '/juyiting',
  clientId: 'public-web',
  redirectUri: `${window.location.origin}/oauth2/callback`,
  authorizationServer: 'https://api.example'
})

describe('OAuth API store token exchange', () => {
  let originalFetch

  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    window.sessionStorage.clear()
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
    window.localStorage.clear()
  })

  it('uses the consumed verifier and commits a valid bearer token only after validation', async () => {
    let request
    global.fetch = async (url, config) => {
      request = { url, config }
      return new Response(JSON.stringify({
        access_token: 'access-token',
        token_type: 'Bearer',
        expires_in: 300
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    const store = useApiStore()
    store.baseUrl = 'https://api.example'
    store.oauthClientId = 'public-web'

    expect(await store.exchangeCodeForToken('authorization-code', transaction)).to.equal('access-token')
    expect(request.url).to.equal('https://api.example/oauth2/token')
    expect(request.config.body.get('code_verifier')).to.equal(transaction.codeVerifier)
    expect(request.config.body.get('code')).to.equal('authorization-code')
    expect(request.config.body.get('client_id')).to.equal(transaction.clientId)
    expect(request.config.body.get('redirect_uri')).to.equal(transaction.redirectUri)
    expect(JSON.parse(window.localStorage.getItem('api_token')).data).to.equal('access-token')
  })

  it('rejects invalid token payloads without committing any token', async () => {
    const invalidPayloads = [
      { token_type: 'Bearer', expires_in: 300 },
      { access_token: 'token', token_type: 'MAC', expires_in: 300 },
      { access_token: 'token', token_type: 'Bearer', expires_in: 0 },
      { access_token: 'token', token_type: 'Bearer', expires_in: -1 },
      { access_token: 'token', token_type: 'Bearer', expires_in: '300' },
      { access_token: 'token', token_type: 'Bearer', expires_in: true },
      { access_token: 'token', token_type: 'Bearer', expires_in: null }
    ]

    for (const payload of invalidPayloads) {
      window.localStorage.clear()
      global.fetch = async () => new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
      const store = useApiStore()
      store.baseUrl = 'https://api.example'
      store.oauthClientId = 'public-web'
      let failure
      try {
        await store.exchangeCodeForToken('authorization-code', transaction)
      } catch (error) {
        failure = error
      }
      expect(failure).to.be.instanceOf(Error)
      expect(window.localStorage.getItem('api_token')).to.equal(null)
    }
  })

  it('uses only the consumed transaction values for exchange after callback validation', async () => {
    let request
    global.fetch = async (url, config) => {
      request = { url, config }
      return new Response(JSON.stringify({
        access_token: 'transaction-bound-token',
        token_type: 'bearer',
        expires_in: 60
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    const store = useApiStore()
    store.baseUrl = 'https://changed-after-consume.example'
    store.oauthClientId = 'changed-client'

    await store.exchangeCodeForToken('authorization-code', transaction)

    expect(request.url).to.equal(`${transaction.authorizationServer}/oauth2/token`)
    expect(request.config.body.get('client_id')).to.equal(transaction.clientId)
    expect(request.config.body.get('redirect_uri')).to.equal(transaction.redirectUri)
    expect(JSON.parse(window.localStorage.getItem('api_token')).data).to.equal('transaction-bound-token')
  })

  it('starts authorization once and explicitly returns no token to concurrent callers', async () => {
    const store = useApiStore()
    let authorizationCount = 0
    store.beginAuthorization = async function () {
      if (this.authorizationStarted) return false
      this.authorizationStarted = true
      authorizationCount += 1
      return true
    }

    const results = await Promise.all([store.token(), store.token()])

    expect(results).to.deep.equal([null, null])
    expect(authorizationCount).to.equal(1)
  })

  it('does not retain or log the legacy verifier and refresh-token request parameters', () => {
    const source = readFileSync('src/stores/api.js', 'utf8')
    expect(source).not.to.include('pkce_code_verifier')
    expect(source).not.to.include('access_type')
    expect(source).not.to.match(/log\.(debug|info|warn|error)\([^\n]*(code|verifier|token)/i)
  })

  it('does not commit a deferred token response after identity clear', async () => {
    let resolveToken
    global.fetch = async () => ({
      ok: true,
      json: () => new Promise(resolve => { resolveToken = resolve })
    })
    const store = useApiStore()
    const pending = store.exchangeCodeForToken('authorization-code', transaction)
    await Promise.resolve()
    store.clearIdentity()
    resolveToken({ access_token: 'late-token', token_type: 'Bearer', expires_in: 300 })

    let failure
    try { await pending } catch (error) { failure = error }
    expect(failure?.name).to.equal('AbortError')
    expect(window.localStorage.getItem('api_token')).to.equal(null)
  })

})

function deferred () {
  let resolve
  const promise = new Promise(result => { resolve = result })
  return { promise, resolve }
}

const OAUTH_PENDING_KEY = 'cyf.oauth.pending.v1'
const DIGEST_NOT_STARTED = 'OAUTH_HARNESS_DIGEST_NOT_STARTED'
const AUTH_SETTLED_BEFORE_DIGEST = 'OAUTH_HARNESS_AUTH_SETTLED_BEFORE_DIGEST'
const AUTH_REJECTED_BEFORE_DIGEST = 'OAUTH_HARNESS_AUTH_REJECTED_BEFORE_DIGEST'

function captureOwnBinding (target, key) {
  return {
    target,
    key,
    hadOwn: Object.prototype.hasOwnProperty.call(target, key),
    descriptor: Object.getOwnPropertyDescriptor(target, key),
    value: target[key]
  }
}

function installOwnValue (binding, value) {
  if (binding.descriptor && Object.prototype.hasOwnProperty.call(binding.descriptor, 'value')) {
    Object.defineProperty(binding.target, binding.key, { ...binding.descriptor, value })
    return
  }
  Object.defineProperty(binding.target, binding.key, {
    value,
    writable: true,
    enumerable: binding.descriptor?.enumerable ?? true,
    configurable: true
  })
}

function restoreOwnBinding (binding) {
  if (binding.hadOwn) {
    Object.defineProperty(binding.target, binding.key, binding.descriptor)
  } else {
    delete binding.target[binding.key]
  }
}

function assertOwnBindingRestored (binding) {
  expect(Object.prototype.hasOwnProperty.call(binding.target, binding.key)).to.equal(binding.hadOwn)
  expect(Object.getOwnPropertyDescriptor(binding.target, binding.key)).to.deep.equal(binding.descriptor)
  expect(binding.target[binding.key]).to.equal(binding.value)
}

function installOAuthWindowFacade ({ crypto, onAssign }) {
  const windowBinding = captureOwnBinding(global, 'window')
  const locationBinding = captureOwnBinding(global, 'location')
  const originalWindow = windowBinding.value
  const originalLocation = locationBinding.value
  expect(originalLocation).to.equal(originalWindow.location)
  const realSessionStorage = originalWindow.sessionStorage
  const realLocalStorage = originalWindow.localStorage
  const facadeLocation = {
    href: originalLocation.href,
    origin: originalLocation.origin,
    pathname: originalLocation.pathname,
    search: originalLocation.search,
    hash: originalLocation.hash,
    assign: onAssign
  }
  const facadeWindow = {}
  Object.defineProperties(facadeWindow, {
    location: { value: facadeLocation, enumerable: true },
    crypto: { value: crypto, enumerable: true },
    sessionStorage: { value: realSessionStorage, enumerable: true },
    localStorage: { value: realLocalStorage, enumerable: true }
  })

  installOwnValue(windowBinding, facadeWindow)
  try {
    installOwnValue(locationBinding, facadeLocation)
  } catch (error) {
    restoreOwnBinding(windowBinding)
    throw error
  }

  let locationRestored = false
  let windowRestored = false
  const restoreLocation = () => {
    if (locationRestored) return
    restoreOwnBinding(locationBinding)
    locationRestored = true
  }
  const restoreWindow = () => {
    if (windowRestored) return
    restoreOwnBinding(windowBinding)
    windowRestored = true
  }

  return {
    facadeWindow,
    facadeLocation,
    originalWindow,
    originalLocation,
    realSessionStorage,
    realLocalStorage,
    restore () {
      try {
        restoreLocation()
      } finally {
        restoreWindow()
      }
    },
    assertRestored () {
      assertOwnBindingRestored(locationBinding)
      assertOwnBindingRestored(windowBinding)
    }
  }
}

function installURLSearchParamsConstructionProbe (onConstruct) {
  const binding = captureOwnBinding(global, 'URLSearchParams')
  const RealURLSearchParams = binding.value
  const URLSearchParamsConstructionProbe = class extends RealURLSearchParams {
    constructor (...args) {
      onConstruct()
      super(...args)
    }
  }

  installOwnValue(binding, URLSearchParamsConstructionProbe)
  let restored = false
  return {
    probe: URLSearchParamsConstructionProbe,
    real: RealURLSearchParams,
    restore () {
      if (restored) return
      restoreOwnBinding(binding)
      restored = true
    },
    assertRestored () {
      assertOwnBindingRestored(binding)
    }
  }
}

function oauthHarnessError (code, message, cause) {
  const error = new Error(cause?.message ? `${message}: ${cause.message}` : message)
  error.name = code
  error.code = code
  if (cause !== undefined) error.cause = cause
  return error
}

async function rejectAfterMicrotasks (turns, code) {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve()
  throw oauthHarnessError(code, `Digest did not start within ${turns} microtask turns`)
}

function rejectIfAuthorizationSettles (authorization) {
  return authorization.then(
    result => {
      throw oauthHarnessError(
        AUTH_SETTLED_BEFORE_DIGEST,
        `Authorization settled with ${String(result)} before digest started`
      )
    },
    cause => {
      throw oauthHarnessError(
        AUTH_REJECTED_BEFORE_DIGEST,
        'Authorization rejected before digest started',
        cause
      )
    }
  )
}

async function awaitDigestStarted (digestStarted, authorization) {
  await Promise.race([
    digestStarted.promise,
    rejectIfAuthorizationSettles(authorization),
    rejectAfterMicrotasks(12, DIGEST_NOT_STARTED)
  ])
}

describe('OAuth authorization cancellation', () => {
  const realSessionStorage = window.sessionStorage
  const realLocalStorage = window.localStorage
  let activeAuthorization
  let releaseDigest
  let browserFacade
  let paramsProbe

  beforeEach(() => {
    setActivePinia(createPinia())
    realLocalStorage.clear()
    realSessionStorage.removeItem(OAUTH_PENDING_KEY)
    activeAuthorization = null
    releaseDigest = null
    browserFacade = null
    paramsProbe = null
  })

  afterEach(async () => {
    try {
      releaseDigest?.()
    } finally {
      try {
        if (activeAuthorization) {
          try {
            await activeAuthorization
          } catch {
            // The case assertion owns authorization failures; cleanup only consumes settled work.
          }
        }
      } finally {
        try {
          paramsProbe?.restore()
        } finally {
          try {
            realSessionStorage.removeItem(OAUTH_PENDING_KEY)
          } finally {
            try {
              browserFacade?.restore()
            } finally {
              try {
                paramsProbe?.assertRestored()
                browserFacade?.assertRestored()
              } finally {
                activeAuthorization = null
                releaseDigest = null
                browserFacade = null
                paramsProbe = null
              }
            }
          }
        }
      }
    }
  })

  after(() => {
    expect(realSessionStorage.getItem(OAUTH_PENDING_KEY)).to.equal(null)
  })

  it('cancels queued reauthentication before it creates an OAuth transaction', async () => {
    const store = useApiStore()
    const result = initiateReauthentication(store)
    await store.clearIdentity()

    expect(await result).to.equal(false)
    expect(realSessionStorage.getItem(OAUTH_PENDING_KEY)).to.equal(null)
  })

  it('blocks parameter construction when logout cancels authorization during PKCE digest', async () => {
    const digestStarted = deferred()
    const digestResult = deferred()
    const events = []
    const navigationCalls = []
    let paramsConstructionCount = 0
    const digestBytes = new Uint8Array(32).buffer
    const fakeCrypto = {
      getRandomValues (bytes) {
        bytes.fill(7)
        return bytes
      },
      subtle: {
        digest: async () => {
          events.push('digest-start')
          digestStarted.resolve()
          return digestResult.promise
        }
      }
    }
    releaseDigest = () => digestResult.resolve(digestBytes)
    browserFacade = installOAuthWindowFacade({
      crypto: fakeCrypto,
      onAssign (url) {
        events.push('navigate')
        navigationCalls.push(url)
      }
    })
    paramsProbe = installURLSearchParamsConstructionProbe(() => {
      paramsConstructionCount += 1
      events.push('params-construction')
    })
    expect(global.window).to.equal(browserFacade.facadeWindow)
    expect(global.location).to.equal(browserFacade.facadeLocation)
    expect(global.URLSearchParams).to.equal(paramsProbe.probe)
    expect(browserFacade.realSessionStorage).to.equal(realSessionStorage)
    expect(browserFacade.realLocalStorage).to.equal(realLocalStorage)

    const store = useApiStore()
    store.baseUrl = 'https://api.example'
    store.oauthClientId = 'public-web'
    const initialGeneration = store.authorizationGeneration

    const authorization = store.beginAuthorization('/juyiting')
    activeAuthorization = authorization
    try {
      await awaitDigestStarted(digestStarted, authorization)

      const serializedPending = realSessionStorage.getItem(OAUTH_PENDING_KEY)
      expect(serializedPending).to.be.a('string').and.not.equal('')
      const pending = JSON.parse(serializedPending)
      expect(pending.returnTo).to.equal('/juyiting')
      expect(pending.clientId).to.equal('public-web')
      expect(pending.redirectUri).to.equal('http://localhost/oauth2/callback')
      expect(pending.authorizationServer).to.equal('https://api.example')

      store.clearIdentity()
      events.push('logout')
      const clearedGeneration = store.authorizationGeneration
      expect(clearedGeneration).to.equal(initialGeneration + 1)
      expect(store.authorizationStarted).to.equal(false)

      releaseDigest()
      const result = await authorization
      activeAuthorization = null

      expect(result).to.equal(false)
      expect(store.authorizationStarted).to.equal(false)
      expect(store.authorizationGeneration).to.equal(clearedGeneration)
      expect(paramsConstructionCount).to.equal(0)
      expect(navigationCalls).to.deep.equal([])
      expect(events).to.deep.equal(['digest-start', 'logout'])
    } finally {
      try {
        releaseDigest()
      } finally {
        try {
          await authorization.catch(() => {})
        } finally {
          activeAuthorization = null
          releaseDigest = null
        }
      }
    }
  })

  it('blocks navigation when logout occurs during URLSearchParams construction', async () => {
    const events = []
    const navigationCalls = []
    let paramsConstructionCount = 0
    let pendingDuringParams
    const fakeCrypto = {
      getRandomValues (bytes) {
        bytes.fill(7)
        return bytes
      },
      subtle: {
        async digest () {
          events.push('digest')
          return new Uint8Array(32).buffer
        }
      }
    }
    browserFacade = installOAuthWindowFacade({
      crypto: fakeCrypto,
      onAssign (url) {
        events.push('navigate')
        navigationCalls.push(url)
      }
    })
    expect(global.window).to.equal(browserFacade.facadeWindow)
    expect(global.location).to.equal(browserFacade.facadeLocation)
    expect(browserFacade.realSessionStorage).to.equal(realSessionStorage)
    expect(browserFacade.realLocalStorage).to.equal(realLocalStorage)

    const store = useApiStore()
    store.baseUrl = 'https://api.example'
    store.oauthClientId = 'public-web'
    const initialGeneration = store.authorizationGeneration
    paramsProbe = installURLSearchParamsConstructionProbe(() => {
      paramsConstructionCount += 1
      events.push('params-construction')
      const serializedPending = realSessionStorage.getItem(OAUTH_PENDING_KEY)
      pendingDuringParams = serializedPending ? JSON.parse(serializedPending) : null
      store.clearIdentity()
      events.push('logout')
    })
    expect(global.URLSearchParams).to.equal(paramsProbe.probe)

    const authorization = store.beginAuthorization('/juyiting')
    activeAuthorization = authorization
    try {
      const result = await authorization
      activeAuthorization = null

      expect(pendingDuringParams).to.be.an('object')
      expect(pendingDuringParams.returnTo).to.equal('/juyiting')
      expect(paramsConstructionCount).to.equal(1)
      expect(result).to.equal(false)
      expect(store.authorizationStarted).to.equal(false)
      expect(store.authorizationGeneration).to.equal(initialGeneration + 1)
      expect(navigationCalls).to.deep.equal([])
      expect(events).to.deep.equal(['digest', 'params-construction', 'logout'])
    } finally {
      try {
        await authorization.catch(() => {})
      } finally {
        activeAuthorization = null
      }
    }
  })
})
