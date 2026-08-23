import { defineStore } from 'pinia'
import { useUtilStore } from './util'
import { useGlobalStore } from './global'
import { log } from '../utils/logger.js'
import { createCodeChallenge, createOAuthTransaction, safeAppRelativePath } from '../utils/oauthTransaction.js'

const runtimeEnv = import.meta.env ?? {}

function isNonblankRuntimeString (value) {
  return typeof value === 'string' && value.trim() !== ''
}

function currentReturnPath () {
  return safeAppRelativePath(`${window.location.pathname}${window.location.search}${window.location.hash}`)
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
    authorizationStarted: false
  }),
  actions: {
    oauthRuntimeConfig () {
      return Object.freeze({
        clientId: this.oauthClientId,
        redirectUri: `${window.location.origin}/oauth2/callback`,
        authorizationServer: this.baseUrl || window.location.origin
      })
    },

    async beginAuthorization (returnTo = currentReturnPath()) {
      if (this.authorizationStarted) return false
      this.authorizationStarted = true
      try {
        const config = this.oauthRuntimeConfig()
        const transaction = await createOAuthTransaction({ returnTo, ...config })
        const codeChallenge = await createCodeChallenge(transaction.codeVerifier)
        const params = new URLSearchParams({
          response_type: 'code',
          client_id: config.clientId,
          scope: 'openid',
          redirect_uri: config.redirectUri,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
          state: transaction.state
        })
        window.location.assign(`${config.authorizationServer}/oauth2/authorize?${params.toString()}`)
        return true
      } catch (error) {
        this.authorizationStarted = false
        throw error
      }
    },

    async token () {
      const utilStore = useUtilStore()
      const accessToken = utilStore.getLocalStorage('api_token')
      if (!accessToken) {
        await this.beginAuthorization()
        return null
      }
      return accessToken
    },

    async exchangeCodeForToken (code, transaction) {
      if (typeof code !== 'string' || code.trim() === '' ||
          typeof transaction?.codeVerifier !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(transaction.codeVerifier) ||
          !isNonblankRuntimeString(transaction.clientId) ||
          !isNonblankRuntimeString(transaction.redirectUri) ||
          !isNonblankRuntimeString(transaction.authorizationServer)) {
        throw new Error('Invalid authorization transaction')
      }
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
        body: params
      })
      if (!response.ok) throw new Error('Token exchange failed')

      const token = validateTokenResponse(await response.json())
      const utilStore = useUtilStore()
      utilStore.setLocalStorage('api_token', token.accessToken, Date.now() + token.expiresIn * 1000)
      return token.accessToken
    },
    wxJsToken (url) {
      const utilStore = useUtilStore()
      const globalStore = useGlobalStore()

      const wxJsTokenKey = `wx_js_token_${utilStore.getHashCode(url)}`
      let accessToken = utilStore.getLocalStorage(wxJsTokenKey)
      if (!accessToken) {
        const xhr = new XMLHttpRequest()
        xhr.open('GET', `${this.baseUrl}/wx/mp/jsapi/signature?appid=${globalStore.user.appid}&url=${url}`, false)
        xhr.setRequestHeader('Content-Type', 'application/json')
        xhr.send(null)
        const data = JSON.parse(xhr.responseText)
        if (data && data.data) {
          accessToken = data.data
          utilStore.setLocalStorage(wxJsTokenKey, accessToken, new Date().getTime() + 6000000)
        }
      }
      return accessToken
    },

    cleanToken () {
      const utilStore = useUtilStore()
      utilStore.removeLocalStorage('api_token')
    },

    async getUserInfo () {
      const token = await this.token()
      if (!token) throw new Error('Authentication is required')
      const globalStore = useGlobalStore()

      const response = await fetch(`${this.baseUrl}/user/my`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (!response.ok) throw new Error('Failed to get user info')

      const result = await response.json()
      log.debug('User info retrieved:', result)
      const data = result.data
      globalStore.setUser(data)
      if (data.jiacn) {
        globalStore.setJiacn(data.jiacn)
      }
      if (data.openid) {
        globalStore.setOpenid(data.openid)
      }
      return data
    }
  }
})
