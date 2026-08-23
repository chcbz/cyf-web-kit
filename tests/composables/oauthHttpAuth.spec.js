import { expect } from 'chai'
import { useHttp } from '../../src/composables/useHttp.js'

describe('useHttp authentication boundary', () => {
  let originalFetch

  beforeEach(() => {
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
})
