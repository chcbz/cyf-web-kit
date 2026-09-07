import { expect } from 'chai'
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

  it('keeps expired, missing, malformed, and blank tokens on the landing page', () => {
    putToken('expired-token', Date.now() - 1)
    expect(redirectLoggedInHome(destination)).to.equal(undefined)
    expect(window.localStorage.getItem('api_token')).to.equal(null)

    expect(redirectLoggedInHome(destination)).to.equal(undefined)

    window.localStorage.setItem('api_token', '{not-json')
    expect(redirectLoggedInHome(destination)).to.equal(undefined)

    putToken('   ')
    expect(redirectLoggedInHome(destination)).to.equal(undefined)
  })

  it('keeps the landing page when local storage is unavailable', () => {
    global.localStorage = {
      getItem () {
        throw new Error('storage unavailable')
      }
    }

    expect(redirectLoggedInHome(destination)).to.equal(undefined)
  })

  it('attaches the guard only to the home route, leaving demo and OAuth routes public', async () => {
    const { readFile } = await import('node:fs/promises')
    const routes = await readFile('src/router/index.js', 'utf8')

    const homeRoute = routes.slice(routes.indexOf("path: '/'"), routes.indexOf("path: '/demo'"))
    const demoRoute = routes.slice(routes.indexOf("path: '/demo'"), routes.indexOf("path: '/chat'"))
    const oauthRoute = routes.slice(0, routes.indexOf("path: '/'"))

    expect(homeRoute).to.include('beforeEnter: redirectLoggedInHome')
    expect(demoRoute).not.to.include('beforeEnter: redirectLoggedInHome')
    expect(oauthRoute).not.to.include('beforeEnter: redirectLoggedInHome')
  })
})
