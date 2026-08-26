import { expect } from 'chai'
import { createPinia, setActivePinia } from 'pinia'
import { useHttp } from '../../src/composables/useHttp.js'
import { useApiStore } from '../../src/stores/api.js'

Object.defineProperty(global, 'location', { value: window.location, writable: true, configurable: true })
Object.defineProperty(global, 'localStorage', { value: window.localStorage, writable: true, configurable: true })

describe('useHttp authentication boundary', () => {
  let originalFetch

  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('never issues an authenticated request when token acquisition returns no token', async () => {
    const store = { token: async () => null }
    let fetchCount = 0
    global.fetch = async () => {
      fetchCount += 1
      return new Response('{}', { status: 200 })
    }

    let failure
    try {
      await useHttp().get('/protected', {}, { authStore: store })
    } catch (error) {
      failure = error
    }

    expect(failure?.message).to.include('Authentication failed')
    expect(fetchCount).to.equal(0)
  })

  it('starts one reauthentication for concurrent 401s and never replays either request', async () => {
    const store = { token: async () => 'expired-token' }
    let cleanCount = 0
    let authorizationCount = 0
    store.cleanToken = () => { cleanCount += 1 }
    store.beginAuthorization = async () => { authorizationCount += 1 }

    let fetchCount = 0
    global.fetch = async () => {
      fetchCount += 1
      return new Response(JSON.stringify({ message: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const results = await Promise.allSettled([
      useHttp().get('/protected/one', {}, { authStore: store }),
      useHttp().get('/protected/two', {}, { authStore: store })
    ])

    expect(results.every(result => result.status === 'rejected')).to.equal(true)
    expect(fetchCount).to.equal(2)
    expect(cleanCount).to.equal(2)
    expect(authorizationCount).to.equal(1)
  })
  it('preserves identity abort while a deferred 401 body is parsing and never starts OAuth', async () => {
    let resolveBody
    const body = new Promise(resolve => { resolveBody = resolve })
    let requestSignal
    let cleanCount = 0
    let authorizationCount = 0
    const store = useApiStore()
    store.authorizationGeneration = 7
    store.token = async () => 'expired-token'
    store.cleanToken = () => { cleanCount += 1 }
    store.beginAuthorization = async () => { authorizationCount += 1 }
    global.fetch = async (_url, options) => {
      requestSignal = options.signal
      return {
        ok: false,
        status: 401,
        clone: () => ({ json: () => body })
      }
    }

    const pending = useHttp().get('/protected/deferred-401', {}, { authStore: store })
    await new Promise(resolve => window.setTimeout(resolve, 0))
    store.clearIdentity()
    const abortReason = requestSignal.reason
    resolveBody({ message: 'unauthorized' })

    let failure
    try { await pending } catch (error) { failure = error }
    expect(failure).to.equal(abortReason)
    expect(failure?.name).to.equal('AbortError')
    expect(cleanCount).to.equal(0)
    expect(authorizationCount).to.equal(0)
  })

})
