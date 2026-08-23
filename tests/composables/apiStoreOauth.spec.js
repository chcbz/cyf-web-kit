import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { createPinia, setActivePinia } from 'pinia'
import { useApiStore } from '../../src/stores/api.js'

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
})
