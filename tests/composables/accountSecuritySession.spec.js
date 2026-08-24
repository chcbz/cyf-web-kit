import { expect } from 'chai'
import { createPinia, setActivePinia } from 'pinia'
import { useApiStore } from '../../src/stores/api.js'
import { useGlobalStore } from '../../src/stores/global.js'
import { useMessageStore } from '../../src/stores/message.js'
import { registerIdentityCleanup } from '../../src/utils/identityLifecycle.js'
import { effectScope } from 'vue'
import { useAccountSecuritySession } from '../../src/composables/useAccountSecuritySession.js'

Object.defineProperty(global, 'location', { value: window.location, writable: true, configurable: true })
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

  it('supports caller abort and timeout without clearing identity or starting OAuth', async () => {
    put('api_token', 'current-token')
    const store = useApiStore()
    let fetchCalls = 0
    global.fetch = (_url, options) => new Promise((_resolve, reject) => {
      fetchCalls += 1
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
    })
    const caller = new AbortController()
    const aborted = store.revokeAllSessions({ signal: caller.signal })
    caller.abort(new DOMException('caller stopped', 'AbortError'))
    let abortError
    try { await aborted } catch (error) { abortError = error }
    expect(abortError?.name).to.equal('AbortError')
    expect(useApiStore().token).to.be.a('function')
    expect(window.localStorage.getItem('api_token')).to.not.equal(null)

    let timeoutError
    try { await store.revokeAllSessions({ timeout: 1 }) } catch (error) { timeoutError = error }
    expect(timeoutError?.name).to.equal('TimeoutError')
    expect(fetchCalls).to.equal(2)
    expect(window.localStorage.getItem('api_token')).to.not.equal(null)
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

  it('clears only identity storage, global identity, message state, and registered authenticated work', async () => {
    put('api_token', 'token')
    put('userId', 7)
    put('jiacn', 'hero')
    put('openid', 'openid')
    put('theme', 'dark')
    put('guest-demo', true)
    const globalStore = useGlobalStore()
    const messageStore = useMessageStore()
    globalStore.setUser({ id: 7, jiacn: 'hero', openid: 'openid', username: 'hero' })
    Object.assign(messageStore, { messages: [{ id: 1 }], total: 1, unreadTotal: 1, loading: true, error: 'old', pageNum: 3, statusFilter: 'unread' })
    let stopped = 0
    const unregister = registerIdentityCleanup(() => { stopped += 1 })

    await useApiStore().clearIdentity()
    unregister()

    expect(window.localStorage.getItem('api_token')).to.equal(null)
    expect(window.localStorage.getItem('userId')).to.equal(null)
    expect(window.localStorage.getItem('jiacn')).to.equal(null)
    expect(window.localStorage.getItem('openid')).to.equal(null)
    expect(JSON.parse(window.localStorage.getItem('theme')).data).to.equal('dark')
    expect(JSON.parse(window.localStorage.getItem('guest-demo')).data).to.equal(true)
    expect(globalStore.user.id).to.equal(null)
    expect(messageStore.messages).to.deep.equal([])
    expect(messageStore.unreadTotal).to.equal(0)
    expect(stopped).to.equal(1)
  })

  it('treats completed security cleanup as successful even when router.replace rejects', async () => {
    for (const failure of [null, rejected(401), rejected(409, 'SESSION_EPOCH_CONFLICT')]) {
      let clearCalls = 0
      const session = useAccountSecuritySession({
        router: { replace: async () => { throw new Error('router unavailable') } },
        apiStore: {
          revokeAllSessions: async () => { if (failure) throw failure },
          clearIdentity: async () => { clearCalls += 1 }
        }
      })
      expect(await session.signOutAllDevices()).to.equal(true)
      expect(clearCalls).to.equal(1)
      expect(session.error.value).to.equal('')
    }
  })

  it('retains identity and exposes a retry-safe error for network, server, exhaustion, and unknown conflict', async () => {
    for (const failure of [new Error('network'), rejected(500), rejected(409, 'AUTH_EPOCH_EXHAUSTED'), rejected(409, 'OTHER')]) {
      let clearCalls = 0
      const session = useAccountSecuritySession({
        router: { replace: async () => { throw new Error('must not navigate') } },
        apiStore: { revokeAllSessions: async () => { throw failure }, clearIdentity: async () => { clearCalls += 1 } }
      })
      expect(await session.signOutAllDevices()).to.equal(false)
      expect(clearCalls).to.equal(0)
      expect(session.error.value).to.contain('重试')
      expect(session.busy.value).to.equal(false)
    }
  })
  it('does not navigate after its scope is disposed while a revoke response is pending', async () => {
    let resolveRevoke
    let clearCalls = 0
    let routeCalls = 0
    const scope = effectScope()
    const session = scope.run(() => useAccountSecuritySession({
      router: { replace: async () => { routeCalls += 1 } },
      apiStore: {
        revokeAllSessions: () => new Promise(resolve => { resolveRevoke = resolve }),
        clearIdentity: async () => { clearCalls += 1 }
      }
    }))
    const pending = session.signOutAllDevices()
    scope.stop()
    resolveRevoke()
    expect(await pending).to.equal(true)
    expect(clearCalls).to.equal(1)
    expect(routeCalls).to.equal(0)
  })

})
