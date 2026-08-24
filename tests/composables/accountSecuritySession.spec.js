import { expect } from 'chai'
import { createPinia, setActivePinia } from 'pinia'
import { useApiStore } from '../../src/stores/api.js'
import { useGlobalStore } from '../../src/stores/global.js'
import { registerIdentityCleanup } from '../../src/utils/identityLifecycle.js'
import { useAccountSecuritySession } from '../../src/composables/useAccountSecuritySession.js'

Object.defineProperty(global, 'localStorage', { value: window.localStorage, writable: true, configurable: true })

const put = (key, value) => window.localStorage.setItem(key, JSON.stringify({ data: value, expTime: Date.now() + 60_000 }))

function rejected (status, code) {
  const error = new Error('request failed')
  error.status = status
  error.code = code
  return error
}

describe('account security session boundary', () => {
  let originalFetch

  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
    window.localStorage.clear()
  })

  it('posts revoke-all with the stored bearer token without starting OAuth', async () => {
    put('api_token', 'current-token')
    const store = useApiStore()
    store.baseUrl = 'https://api.example'
    let beginAuthorizationCalls = 0
    store.beginAuthorization = async () => { beginAuthorizationCalls += 1 }
    let request
    global.fetch = async (url, options) => {
      request = { url, options }
      return new Response(null, { status: 204 })
    }

    await store.revokeAllSessions()

    expect(request.url).to.equal('https://api.example/user/me/sessions/revoke-all')
    expect(request.options).to.deep.include({ method: 'POST' })
    expect(request.options.headers.Authorization).to.equal('Bearer current-token')
    expect(beginAuthorizationCalls).to.equal(0)
  })

  it('preserves the server error code for revoke outcome classification', async () => {
    put('api_token', 'current-token')
    global.fetch = async () => new Response(JSON.stringify({ code: 'SESSION_EPOCH_CONFLICT' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' }
    })

    const result = await Promise.allSettled([useApiStore().revokeAllSessions()])

    expect(result[0].status).to.equal('rejected')
    expect(result[0].reason.status).to.equal(409)
    expect(result[0].reason.code).to.equal('SESSION_EPOCH_CONFLICT')
  })

  it('classifies a missing bearer token without fetching or redirecting', async () => {
    const store = useApiStore()
    let fetchCalls = 0
    let beginAuthorizationCalls = 0
    global.fetch = async () => { fetchCalls += 1 }
    store.beginAuthorization = async () => { beginAuthorizationCalls += 1 }

    const result = await Promise.allSettled([store.revokeAllSessions()])

    expect(result[0].status).to.equal('rejected')
    expect(result[0].reason.code).to.equal('AUTHENTICATION_REQUIRED')
    expect(fetchCalls).to.equal(0)
    expect(beginAuthorizationCalls).to.equal(0)
  })

  it('clears only account identity storage, global identity, and registered authenticated work', () => {
    put('api_token', 'token')
    put('userId', 7)
    put('jiacn', 'hero')
    put('openid', 'openid')
    put('theme', 'dark')
    put('guest-demo', true)
    const globalStore = useGlobalStore()
    globalStore.setUser({ id: 7, jiacn: 'hero', openid: 'openid', username: 'hero' })
    let stopped = 0
    const unregister = registerIdentityCleanup(() => { stopped += 1 })

    useApiStore().clearIdentity()
    unregister()

    expect(window.localStorage.getItem('api_token')).to.equal(null)
    expect(window.localStorage.getItem('userId')).to.equal(null)
    expect(window.localStorage.getItem('jiacn')).to.equal(null)
    expect(window.localStorage.getItem('openid')).to.equal(null)
    expect(JSON.parse(window.localStorage.getItem('theme')).data).to.equal('dark')
    expect(JSON.parse(window.localStorage.getItem('guest-demo')).data).to.equal(true)
    expect(globalStore.user.id).to.equal(null)
    expect(globalStore.user.jiacn).to.equal(null)
    expect(stopped).to.equal(1)
  })

  it('clears and returns home after success, invalid token, or completed concurrent revoke', async () => {
    for (const failure of [null, rejected(401), rejected(409, 'SESSION_EPOCH_CONFLICT')]) {
      let clearCalls = 0
      let messageClearCalls = 0
      const router = { replace: async path => { expect(path).to.equal('/') } }
      const apiStore = {
        revokeAllSessions: async () => { if (failure) throw failure },
        clearIdentity: () => { clearCalls += 1 }
      }
      const messageStore = { clearMessageState: () => { messageClearCalls += 1 } }
      const session = useAccountSecuritySession({ router, apiStore, messageStore })

      expect(await session.signOutAllDevices()).to.equal(true)
      expect(clearCalls).to.equal(1)
      expect(messageClearCalls).to.equal(1)
    }
  })

  it('retains identity and exposes a retry-safe error for network, server, exhaustion, and unknown conflict', async () => {
    for (const failure of [new Error('network'), rejected(500), rejected(409, 'AUTH_EPOCH_EXHAUSTED'), rejected(409, 'OTHER')]) {
      let clearCalls = 0
      const session = useAccountSecuritySession({
        router: { replace: async () => { throw new Error('must not navigate') } },
        apiStore: { revokeAllSessions: async () => { throw failure }, clearIdentity: () => { clearCalls += 1 } },
        messageStore: { clearMessageState: () => { throw new Error('must not clear') } }
      })

      expect(await session.signOutAllDevices()).to.equal(false)
      expect(clearCalls).to.equal(0)
      expect(session.error.value).to.contain('重试')
    }
  })
})
