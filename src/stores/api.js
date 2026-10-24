import { encodeHttpRequest, decodeHttpResponse } from '../utils/apiEnvelope.js'
import { defineStore, getActivePinia } from 'pinia'
import { useUtilStore } from './util'
import { useGlobalStore } from './global'
import { createCodeChallenge, createOAuthTransaction, safeAppRelativePath } from '../utils/oauthTransaction.js'
import { rememberOAuthBackNavigation } from '../utils/oauthNavigationHistory.js'
import { registerIdentityCleanup, stopIdentityBoundWork } from '../utils/identityLifecycle.js'
import { cancelReauthentication } from '../utils/reauthentication.js'
import { combineAbortSignals, throwIfAborted } from '../utils/abortSignals.js'

const runtimeEnv = import.meta.env ?? {}
// Bind the hydrated account to the opaque bearer, not to a business region.
const hydratedAccountTokens = new WeakMap()

function discardAccountView (store) {
  hydratedAccountTokens.delete(store)
  store.authorizationGeneration += 1
  store.authorizationStarted = false
  cancelReauthentication(store)
  stopIdentityBoundWork()
  // Another tab may already own the shared token/cache. Do not delete its data.
  useGlobalStore().clearUserIdentity()
}

function isNonblankRuntimeString (value) {
  return typeof value === 'string' && value.trim() !== ''
}

function currentReturnPath () {
  return safeAppRelativePath(`${window.location.pathname}${window.location.search}${window.location.hash}`)
}

function unauthenticatedError () {
  const error = new Error('Authentication is required')
  error.code = 'AUTHENTICATION_REQUIRED'
  return error
}

function revokeError (response, code) {
  const error = new Error('Session revocation failed')
  error.status = response.status
  if (code) error.code = code
  return error
}

async function responseErrorCode (response) {
  try {
    const payload = await response.clone().json()
    return typeof payload?.code === 'string' ? payload.code : null
  } catch {
    return null
  }
}

function createIdentityOperation (apiStore, callerSignal) {
  const authorizationGeneration = apiStore.authorizationGeneration
  const identityController = new AbortController()
  const combined = combineAbortSignals({ signals: [callerSignal, identityController.signal] })
  const unregister = registerIdentityCleanup(() => {
    identityController.abort(new DOMException('Identity cleared', 'AbortError'))
  })
  let cleaned = false

  return {
    signal: combined.signal,
    assertCurrent () {
      throwIfAborted(combined.signal)
      if (authorizationGeneration !== apiStore.authorizationGeneration) {
        throw new DOMException('Identity changed', 'AbortError')
      }
    },
    cleanup () {
      if (cleaned) return
      cleaned = true
      unregister()
      combined.cleanup()
    }
  }
}

function validateTokenResponse (data) {
  if (!data || typeof data.access_token !== 'string' || data.access_token.trim() === '') {
    throw new Error('Token response is missing access_token')
  }
  if (typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer') {
    throw new Error('Token response has an invalid token_type')
  }
  const expiresIn = data.expires_in
  if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error('Token response has an invalid expires_in')
  }
  return { accessToken: data.access_token, expiresIn }
}

export const useApiStore = defineStore('api', {
  state: () => ({
    baseUrl: runtimeEnv.VITE_API_BASE_URL || '',
    dwzDomain: runtimeEnv.VITE_DWZ_DOMAIN,
    oauthClientId: runtimeEnv.VITE_OAUTH_CLIENT_ID,
    authorizationStarted: false,
    authorizationGeneration: 0
  }),
  actions: {
    oauthRuntimeConfig () {
      return Object.freeze({
        clientId: this.oauthClientId,
        redirectUri: `${window.location.origin}/oauth2/callback`,
        authorizationServer: runtimeEnv.VITE_OAUTH_BASE_URL || this.baseUrl || window.location.origin
      })
    },

    async beginAuthorization (returnTo = currentReturnPath()) {
      if (this.authorizationStarted) return false
      const authorizationGeneration = this.authorizationGeneration
      if (authorizationGeneration !== this.authorizationGeneration) return false
      this.authorizationStarted = true
      try {
        const config = this.oauthRuntimeConfig()
        // Yield once so a synchronous logout can cancel a queued reauthentication
        // before it creates a PKCE transaction.
        await Promise.resolve()
        if (authorizationGeneration !== this.authorizationGeneration || !this.authorizationStarted) return false
        const transaction = await createOAuthTransaction({ returnTo, ...config })
        if (authorizationGeneration !== this.authorizationGeneration || !this.authorizationStarted) return false
        const codeChallenge = await createCodeChallenge(transaction.codeVerifier)
        if (authorizationGeneration !== this.authorizationGeneration || !this.authorizationStarted) return false
        const params = new URLSearchParams({
          response_type: 'code',
          client_id: config.clientId,
          scope: 'openid',
          redirect_uri: config.redirectUri,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
          state: transaction.state
        })
        if (authorizationGeneration !== this.authorizationGeneration || !this.authorizationStarted) return false
        rememberOAuthBackNavigation(transaction.state, { now: transaction.createdAt })
        window.location.replace(`${config.authorizationServer}/oauth2/authorize?${params.toString()}`)
        return true
      } catch (error) {
        if (authorizationGeneration === this.authorizationGeneration) this.authorizationStarted = false
        throw error
      }
    },

    hasActiveToken () {
      return Boolean(useUtilStore().getLocalStorage('api_token'))
    },

    hasCurrentAccount () {
      const bound = hydratedAccountTokens.get(this)
      return Boolean(bound && useUtilStore().getLocalStorage('api_token') === bound)
    },

    assertTokenCurrent (token) {
      if (!token || useUtilStore().getLocalStorage('api_token') !== token) {
        if (hydratedAccountTokens.get(this) === token) discardAccountView(this)
        throw new DOMException('Identity changed', 'AbortError')
      }
    },

    async token () {
      const utilStore = useUtilStore()
      const accessToken = utilStore.getLocalStorage('api_token')
      const bound = hydratedAccountTokens.get(this)
      if (bound && bound !== accessToken) {
        discardAccountView(this)
        // Never send an old view's input using the replacement account's bearer.
        throw new DOMException('Login changed; refresh the page to continue', 'AbortError')
      }
      if (!accessToken) {
        await this.beginAuthorization()
        return null
      }
      return accessToken
    },

    async exchangeCodeForToken (code, transaction, { signal } = {}) {
      if (typeof code !== 'string' || code.trim() === '' ||
          typeof transaction?.codeVerifier !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(transaction.codeVerifier) ||
          !isNonblankRuntimeString(transaction.clientId) ||
          !isNonblankRuntimeString(transaction.redirectUri) ||
          !isNonblankRuntimeString(transaction.authorizationServer)) {
        throw new Error('Invalid authorization transaction')
      }
      const operation = createIdentityOperation(this, signal)
      try {
        operation.assertCurrent()
        const params = new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: transaction.redirectUri,
          client_id: transaction.clientId,
          code_verifier: transaction.codeVerifier
        })
        const response = await fetch(`${transaction.authorizationServer}/oauth2/token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: params,
          signal: operation.signal
        })
        operation.assertCurrent()
        if (!response.ok) throw new Error('Token exchange failed')

        const payload = await response.json()
        operation.assertCurrent()
        const token = validateTokenResponse(payload)
        useUtilStore().setLocalStorage('api_token', token.accessToken, Date.now() + token.expiresIn * 1000)
        return token.accessToken
      } catch (error) {
        operation.assertCurrent()
        throw error
      } finally {
        operation.cleanup()
      }
    },
    clearIdentity () {
      const pinia = getActivePinia()
      hydratedAccountTokens.delete(this)
      this.authorizationGeneration += 1
      this.authorizationStarted = false
      cancelReauthentication(this)
      stopIdentityBoundWork()
      const utilStore = useUtilStore(pinia)
      for (const key of ['api_token', 'userId', 'jiacn', 'openid', 'wxToken']) {
        try {
          utilStore.removeLocalStorage(key)
        } catch {
          // Continue clearing independent identity state even if browser storage is unavailable.
        }
      }
      try {
        useGlobalStore(pinia).clearUserIdentity()
      } catch {
        // Registered identity work and token removal are not rolled back by peripheral state failure.
      }
    },

    async revokeAllSessions ({ signal, timeout = 15_000 } = {}) {
      const token = await this.token()
      if (!token) throw unauthenticatedError()

      const requestSignal = combineAbortSignals({ signals: [signal], timeout })
      try {
        throwIfAborted(requestSignal.signal)
        this.assertTokenCurrent(token)
        const response = await fetch(`${this.baseUrl}/user/me/sessions/revoke-all`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          signal: requestSignal.signal
        })
        this.assertTokenCurrent(token)
        if (response.status === 204) return
        const code = await responseErrorCode(response)
        this.assertTokenCurrent(token)
        throw revokeError(response, code)
      } finally {
        requestSignal.cleanup()
      }
    },

    wxJsToken (url) {
      const utilStore = useUtilStore()
      const globalStore = useGlobalStore()

      const wxJsTokenKey = `wx_js_token_${utilStore.getHashCode(url)}`
      let accessToken = utilStore.getLocalStorage(wxJsTokenKey)
      if (!accessToken) {
        const xhr = new XMLHttpRequest()
        const requestId = crypto.randomUUID()
        xhr.open('POST', `${this.baseUrl}/wx/mp/jsapi/signature?appid=${encodeURIComponent(globalStore.user.appid)}&url=${encodeURIComponent(url)}`, false)
        xhr.setRequestHeader('X-Request-Id', requestId)
        xhr.setRequestHeader('Content-Type', 'application/json')
        xhr.send(JSON.stringify(encodeHttpRequest(null, requestId)))
        const { value: data } = decodeHttpResponse(xhr.responseText, { status: xhr.status, requestId, responseRequestId: xhr.getResponseHeader('X-Request-Id') })
        if (data) {
          accessToken = data
          utilStore.setLocalStorage(wxJsTokenKey, accessToken, new Date().getTime() + 6000000)
        }
      }
      return accessToken
    },

    cleanToken () {
      const utilStore = useUtilStore()
      utilStore.removeLocalStorage('api_token')
    },

    async getUserInfo ({ signal } = {}) {
      const operation = createIdentityOperation(this, signal)
      try {
        operation.assertCurrent()
        const token = await this.token()
        operation.assertCurrent()
        if (!token) throw unauthenticatedError()

        const requestId = crypto.randomUUID()
        const response = await fetch(`${this.baseUrl}/user/my`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}`, 'X-Request-Id': requestId },
          cache: 'no-store',
          signal: operation.signal
        })
        operation.assertCurrent()
        const { value: data } = decodeHttpResponse(await response.text(), { status: response.status, requestId, responseRequestId: response.headers.get('X-Request-Id') })
        operation.assertCurrent()
        this.assertTokenCurrent(token)
        hydratedAccountTokens.set(this, token)
        const globalStore = useGlobalStore()
        globalStore.setUser(data)
        if (data.jiacn) globalStore.setJiacn(data.jiacn)
        if (data.openid) globalStore.setOpenid(data.openid)
        return data
      } catch (error) {
        operation.assertCurrent()
        throw error
      } finally {
        operation.cleanup()
      }
    }
  }
})
