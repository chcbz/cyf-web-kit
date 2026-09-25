import { expect } from 'chai'
import {
  completeOAuthNavigation,
  installOAuthNavigationResume,
  OAUTH_HISTORY_STORAGE_KEY,
  OAUTH_RESUME_STORAGE_KEY,
  rememberOAuthBackNavigation
} from '../../src/utils/oauthNavigationHistory.js'

function memoryStorage () {
  const values = new Map()
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  }
}

function eventTarget () {
  const listeners = new Map()
  return {
    addEventListener (type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(listener)
    },
    removeEventListener (type, listener) {
      listeners.get(type)?.delete(listener)
    },
    dispatch (type, event = {}) {
      for (const listener of [...(listeners.get(type) || [])]) listener(event)
    },
    listenerCount: type => listeners.get(type)?.size || 0
  }
}

function fakeHistory ({ length, state }) {
  return {
    length,
    state,
    replacedState: null,
    pushedState: null,
    goCalls: [],
    replaceState (nextState) {
      this.state = nextState
      this.replacedState = nextState
    },
    pushState (nextState) {
      this.state = nextState
      this.pushedState = nextState
      this.length += 1
    },
    go (delta) {
      this.goCalls.push(delta)
    }
  }
}

describe('OAuth navigation history', () => {
  it('returns through the pre-login app page and resumes Juyi Hall with auth entries pruned', async () => {
    const storage = memoryStorage()
    const callbackEvents = eventTarget()
    const history = fakeHistory({
      length: 2,
      state: { back: '/', current: '/juyiting', forward: null, position: 1, replaced: false, scroll: null }
    })

    expect(rememberOAuthBackNavigation('oauth-state', { storage, history, now: 100 })).to.equal(true)
    expect(JSON.parse(storage.getItem(OAUTH_HISTORY_STORAGE_KEY))).to.deep.equal({
      version: 1,
      state: 'oauth-state',
      createdAt: 100,
      historyLength: 2,
      previousPath: '/'
    })

    // The login form added one browser entry before the callback returned.
    history.length = 3
    history.state = { back: null, current: '/oauth2/callback', position: 2 }
    const replacements = []

    expect(await completeOAuthNavigation('oauth-state', '/juyiting', {
      storage,
      history,
      eventTarget: callbackEvents,
      now: 200,
      replace: path => replacements.push(path)
    })).to.equal(true)
    expect(replacements).to.deep.equal([])
    expect(history.goCalls).to.deep.equal([-2])
    expect(JSON.parse(storage.getItem(OAUTH_RESUME_STORAGE_KEY))).to.deep.equal({
      version: 1,
      createdAt: 200,
      previousPath: '/',
      returnTo: '/juyiting'
    })

    const previousPageEvents = eventTarget()
    const navigations = []
    installOAuthNavigationResume({
      storage,
      eventTarget: previousPageEvents,
      location: { pathname: '/', search: '', hash: '' },
      now: () => 201,
      navigate: path => navigations.push(path)
    })

    // Assigning from the older entry truncates the login/callback entries and
    // creates the final /juyiting entry immediately after the original page.
    expect(navigations).to.deep.equal(['/juyiting'])
    expect(storage.getItem(OAUTH_RESUME_STORAGE_KEY)).to.equal(null)
    expect(previousPageEvents.listenerCount('pageshow')).to.equal(1)
  })

  it('derives the traversal distance from every entry added by the authorization flow', async () => {
    const storage = memoryStorage()
    const history = fakeHistory({ length: 4, state: { back: '/demo', current: '/juyiting', position: 3 } })
    rememberOAuthBackNavigation('oauth-state', { storage, history, now: 100 })

    history.length = 7
    expect(await completeOAuthNavigation('oauth-state', '/juyiting', {
      storage,
      history,
      eventTarget: eventTarget(),
      now: 200,
      replace: async () => {}
    })).to.equal(true)
    expect(history.goCalls).to.deep.equal([-4])
  })

  it('falls back to an in-app back guard when the previous entry is not a known app route', async () => {
    const storage = memoryStorage()
    const target = eventTarget()
    const history = fakeHistory({ length: 2, state: { back: null, current: '/juyiting', position: 1 } })
    rememberOAuthBackNavigation('oauth-state', { storage, history, now: 100 })

    history.length = 3
    history.state = { current: '/juyiting', position: 2 }
    const replacements = []
    expect(await completeOAuthNavigation('oauth-state', '/juyiting', {
      storage,
      history,
      eventTarget: target,
      now: 200,
      replace: path => replacements.push(path)
    })).to.equal(true)
    expect(replacements).to.deep.equal(['/juyiting'])
    expect(target.listenerCount('popstate')).to.equal(1)

    target.dispatch('popstate', { state: history.replacedState })
    expect(history.goCalls).to.deep.equal([-2])
    expect(target.listenerCount('popstate')).to.equal(0)
  })

  it('does not alter history without a previous entry or with stale or mismatched metadata', async () => {
    const singleEntryStorage = memoryStorage()
    const singleEntryHistory = fakeHistory({ length: 1, state: { current: '/juyiting', position: 0 } })
    expect(rememberOAuthBackNavigation('oauth-state', {
      storage: singleEntryStorage,
      history: singleEntryHistory,
      now: 100
    })).to.equal(false)

    for (const { receivedState, now } of [
      { receivedState: 'different-state', now: 200 },
      { receivedState: 'oauth-state', now: 10 * 60 * 1000 + 100 }
    ]) {
      const storage = memoryStorage()
      const target = eventTarget()
      const history = fakeHistory({ length: 2, state: { back: '/', current: '/juyiting', position: 1 } })
      rememberOAuthBackNavigation('oauth-state', { storage, history, now: 100 })
      const replacements = []

      expect(await completeOAuthNavigation(receivedState, '/juyiting', {
        storage,
        history,
        eventTarget: target,
        now,
        replace: path => replacements.push(path)
      })).to.equal(false)
      expect(replacements).to.deep.equal(['/juyiting'])
      expect(storage.getItem(OAUTH_HISTORY_STORAGE_KEY)).to.equal(null)
      expect(storage.getItem(OAUTH_RESUME_STORAGE_KEY)).to.equal(null)
      expect(history.replacedState).to.equal(null)
      expect(history.pushedState).to.equal(null)
      expect(history.goCalls).to.deep.equal([])
    }
  })
})
