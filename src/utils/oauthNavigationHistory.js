import { OAUTH_TRANSACTION_TTL_MS, safeAppRelativePath } from './oauthTransaction.js'

export const OAUTH_HISTORY_STORAGE_KEY = 'cyf.oauth.history.v1'
export const OAUTH_RESUME_STORAGE_KEY = 'cyf.oauth.resume.v1'

const BASE_STATE_KEY = '__cyfOAuthBackBase'
const GUARD_STATE_KEY = '__cyfOAuthBackGuard'
const HISTORY_FIELDS = Object.freeze(['createdAt', 'historyLength', 'previousPath', 'state', 'version'])
const RESUME_FIELDS = Object.freeze(['createdAt', 'previousPath', 'returnTo', 'version'])

function browserStorage () {
  return globalThis.window?.sessionStorage
}

function browserHistory () {
  return globalThis.window?.history
}

function browserEventTarget () {
  return globalThis.window
}

function browserLocation () {
  return globalThis.window?.location
}

function isSafeInteger (value) {
  return Number.isSafeInteger(value) && value >= 0
}

function hasExactFields (value, expectedFields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const fields = Object.keys(value).sort()
  return fields.length === expectedFields.length &&
    fields.every((field, index) => field === expectedFields[index])
}

function exactSafePath (candidate) {
  if (typeof candidate !== 'string') return null
  return safeAppRelativePath(candidate, '') === candidate ? candidate : null
}

function currentAppPath (location) {
  if (!location) return null
  return exactSafePath(`${location.pathname || ''}${location.search || ''}${location.hash || ''}`)
}

function removeStoredValue (storage, key) {
  try {
    storage?.removeItem(key)
  } catch {
    // Login must remain available even when optional history metadata cannot persist.
  }
}

function takeStoredValue (storage, key) {
  let serialized
  try {
    serialized = storage?.getItem(key)
    storage?.removeItem(key)
  } catch {
    return null
  }
  if (!serialized) return null
  try {
    return JSON.parse(serialized)
  } catch {
    return null
  }
}

function readStoredValue (storage, key) {
  let serialized
  try {
    serialized = storage?.getItem(key)
  } catch {
    return null
  }
  if (!serialized) return null
  try {
    return JSON.parse(serialized)
  } catch {
    return null
  }
}

function storeValue (storage, key, value) {
  if (typeof storage?.setItem !== 'function') return false
  try {
    storage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function isFresh (createdAt, now) {
  return isSafeInteger(createdAt) && isSafeInteger(now) &&
    createdAt <= now && now < createdAt + OAUTH_TRANSACTION_TTL_MS
}

function historyStateObject (state) {
  return state && typeof state === 'object' && !Array.isArray(state) ? state : {}
}

function validPendingHistory (pending, receivedState, history, now) {
  return hasExactFields(pending, HISTORY_FIELDS) && pending.version === 1 &&
    typeof receivedState === 'string' && receivedState === pending.state &&
    typeof pending.state === 'string' && pending.state.trim() !== '' &&
    isFresh(pending.createdAt, now) &&
    (pending.previousPath === null || exactSafePath(pending.previousPath) === pending.previousPath) &&
    isSafeInteger(pending.historyLength) && pending.historyLength >= 2 &&
    isSafeInteger(history?.length) && history.length >= pending.historyLength &&
    typeof history?.go === 'function'
}

function skipDeltaFrom (pending, history) {
  const skipDelta = history.length - pending.historyLength + 1
  return Number.isSafeInteger(skipDelta) && skipDelta >= 1 && skipDelta < history.length
    ? skipDelta
    : null
}

function installFallbackBackGuard (pending, history, eventTarget) {
  const skipDelta = skipDeltaFrom(pending, history)
  if (skipDelta === null ||
      typeof history?.replaceState !== 'function' ||
      typeof history?.pushState !== 'function' ||
      typeof eventTarget?.addEventListener !== 'function' ||
      typeof eventTarget?.removeEventListener !== 'function') {
    return false
  }

  const originalState = historyStateObject(history.state)
  const marker = `${pending.createdAt}:${pending.historyLength}:${history.length}`
  const currentRoute = typeof originalState.current === 'string' ? originalState.current : null
  const currentPosition = Number.isSafeInteger(originalState.position) ? originalState.position : null
  const baseState = {
    ...originalState,
    ...(currentRoute === null ? {} : { forward: currentRoute }),
    [BASE_STATE_KEY]: marker
  }
  const guardState = {
    ...originalState,
    ...(currentRoute === null ? {} : { back: currentRoute, current: currentRoute, forward: null }),
    ...(currentPosition === null ? {} : { position: currentPosition + 1, replaced: false, scroll: null }),
    [GUARD_STATE_KEY]: marker
  }

  const onPopState = event => {
    if (event?.state?.[BASE_STATE_KEY] !== marker) return
    eventTarget.removeEventListener('popstate', onPopState)
    history.go(-skipDelta)
  }

  eventTarget.addEventListener('popstate', onPopState)
  try {
    history.replaceState(baseState, '')
    history.pushState(guardState, '')
    return true
  } catch {
    eventTarget.removeEventListener('popstate', onPopState)
    try {
      history.replaceState(originalState, '')
    } catch {
      // Preserve the original navigation failure; this enhancement remains best-effort.
    }
    return false
  }
}

export function rememberOAuthBackNavigation (state, {
  storage = browserStorage(),
  history = browserHistory(),
  now = Date.now()
} = {}) {
  removeStoredValue(storage, OAUTH_HISTORY_STORAGE_KEY)
  removeStoredValue(storage, OAUTH_RESUME_STORAGE_KEY)
  if (typeof state !== 'string' || state.trim() === '' ||
      !isSafeInteger(now) || !isSafeInteger(history?.length) || history.length < 2) {
    return false
  }

  return storeValue(storage, OAUTH_HISTORY_STORAGE_KEY, {
    version: 1,
    state,
    createdAt: now,
    historyLength: history.length,
    previousPath: exactSafePath(history.state?.back)
  })
}

export async function completeOAuthNavigation (receivedState, returnTo, {
  storage = browserStorage(),
  history = browserHistory(),
  eventTarget = browserEventTarget(),
  now = Date.now(),
  replace
} = {}) {
  const safeReturnTo = exactSafePath(returnTo)
  const pending = takeStoredValue(storage, OAUTH_HISTORY_STORAGE_KEY)
  if (safeReturnTo === null || !validPendingHistory(pending, receivedState, history, now)) {
    if (typeof replace === 'function') await replace(safeReturnTo || '/')
    return false
  }

  const skipDelta = skipDeltaFrom(pending, history)
  if (skipDelta !== null && pending.previousPath !== null &&
      storeValue(storage, OAUTH_RESUME_STORAGE_KEY, {
        version: 1,
        createdAt: now,
        previousPath: pending.previousPath,
        returnTo: safeReturnTo
      })) {
    history.go(-skipDelta)
    return true
  }

  if (typeof replace === 'function') await replace(safeReturnTo)
  return installFallbackBackGuard(pending, history, eventTarget)
}

export function installOAuthNavigationResume ({
  storage = browserStorage(),
  eventTarget = browserEventTarget(),
  location = browserLocation(),
  now = () => Date.now(),
  navigate = path => location?.assign(path)
} = {}) {
  const resume = () => {
    const pending = readStoredValue(storage, OAUTH_RESUME_STORAGE_KEY)
    const currentTime = now()
    if (!hasExactFields(pending, RESUME_FIELDS) || pending.version !== 1 ||
        !isFresh(pending.createdAt, currentTime) ||
        exactSafePath(pending.previousPath) !== pending.previousPath ||
        exactSafePath(pending.returnTo) !== pending.returnTo) {
      removeStoredValue(storage, OAUTH_RESUME_STORAGE_KEY)
      return false
    }
    if (currentAppPath(location) !== pending.previousPath) {
      removeStoredValue(storage, OAUTH_RESUME_STORAGE_KEY)
      return false
    }

    removeStoredValue(storage, OAUTH_RESUME_STORAGE_KEY)
    navigate(pending.returnTo)
    return true
  }

  if (typeof eventTarget?.addEventListener === 'function') {
    eventTarget.addEventListener('pageshow', resume)
  }
  resume()
  return () => eventTarget?.removeEventListener?.('pageshow', resume)
}
