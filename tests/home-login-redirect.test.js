import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { createPinia, setActivePinia } from 'pinia'
import { redirectLoggedInHome } from '../src/router/homeLoginRedirect.js'

Object.defineProperty(global, 'location', { value: window.location, writable: true, configurable: true })
Object.defineProperty(global, 'localStorage', { value: window.localStorage, writable: true, configurable: true })

const destination = Object.freeze({
  query: { source: 'home' },
  hash: '#welcome'
})

function putToken (data, expTime = Date.now() + 60_000) {
  window.localStorage.setItem('api_token', JSON.stringify({ data, expTime }))
}

function expectLanding (rawToken) {
  window.localStorage.setItem('api_token', rawToken)
  expect(redirectLoggedInHome(destination)).to.equal(undefined)
}

describe('home login redirect', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  afterEach(() => {
    global.localStorage = window.localStorage
    window.localStorage.clear()
  })

  it('redirects a valid nonblank local token to Juyi Hall with replace and local navigation state', () => {
    putToken('access-token')

    expect(redirectLoggedInHome(destination)).to.deep.equal({
      path: '/juyiting',
      query: destination.query,
      hash: destination.hash,
      replace: true
    })
  })

  it('keeps expired tokens on landing and clears them', () => {
    putToken('expired-token', Date.now() - 1)

    expect(redirectLoggedInHome(destination)).to.equal(undefined)
    expect(window.localStorage.getItem('api_token')).to.equal(null)
  })

  it('keeps exact-expiry tokens on landing and clears them', () => {
    const originalNow = Date.now
    Date.now = () => 1_000
    try {
      putToken('boundary-token', 1_000)
      expect(redirectLoggedInHome(destination)).to.equal(undefined)
      expect(window.localStorage.getItem('api_token')).to.equal(null)
    } finally {
      Date.now = originalNow
    }
  })

  it('keeps missing, malformed, and invalid token envelopes on landing', () => {
    expect(redirectLoggedInHome(destination)).to.equal(undefined)
    expectLanding('{not-json')
    expectLanding('[]')
    expectLanding(JSON.stringify({ data: 'token' }))
    expectLanding(JSON.stringify({ data: 'token', expTime: null }))
    expectLanding(JSON.stringify({ data: 'token', expTime: '9999999999999' }))
    expectLanding('{"data":"token","expTime":1e999}')
    expectLanding(JSON.stringify({ data: 7, expTime: Date.now() + 60_000 }))
    expectLanding(JSON.stringify({ data: '   ', expTime: Date.now() + 60_000 }))
  })

  it('keeps the landing page when local storage is unavailable', () => {
    global.localStorage = {
      getItem () {
        throw new Error('storage unavailable')
      }
    }

    expect(redirectLoggedInHome(destination)).to.equal(undefined)
  })

  it('attaches the guard only to the home route, leaving demo and OAuth routes public', () => {
    const routes = readFileSync('src/router/index.js', 'utf8')

    const homeRoute = routes.slice(routes.indexOf("path: '/'"), routes.indexOf("path: '/demo'"))
    const demoRoute = routes.slice(routes.indexOf("path: '/demo'"), routes.indexOf("path: '/chat'"))
    const oauthRoute = routes.slice(0, routes.indexOf("path: '/'"))

    expect(homeRoute).to.include('beforeEnter: redirectLoggedInHome')
    expect(demoRoute).not.to.include('beforeEnter: redirectLoggedInHome')
    expect(oauthRoute).not.to.include('beforeEnter: redirectLoggedInHome')
  })
})
