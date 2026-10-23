import { encodeHttpRequest, decodeHttpResponse } from '../utils/apiEnvelope.js'
import { defineStore, getActivePinia } from 'pinia'
import { useUtilStore } from './util'
import { useGlobalStore } from './global'
import { log } from '../utils/logger.js'
import { createCodeChallenge, createOAuthTransaction, safeAppRelativePath } from '../utils/oauthTransaction.js'
import { rememberOAuthBackNavigation } from '../utils/oauthNavigationHistory.js'
import { registerIdentityCleanup, stopIdentityBoundWork } from '../utils/identityLifecycle.js'
import { cancelReauthentication } from '../utils/reauthentication.js'
import { combineAbortSignals, throwIfAborted } from '../utils/abortSignals.js'
import { tenantBrowserTabId } from '../utils/tenantBrowserTab.js'
import { beginTenantAuthorization, cancelTenantAuthorization, commitTenantAuthorization,
  invalidateTenantView, logoutTenantSession, readTenantSession } from '../utils/tenantAuthLedger.js'
import { bindFixedTenantIdentity, validFixedTenantIdentity } from '../utils/fixedTenantIdentity.js'

const runtimeEnv = import.meta.env ?? {}
const verifiedTenantSessions = new WeakMap()
const pendingTenantLogouts = new WeakMap()

const TENANT_ID_PATTERN = /^(?:0|[1-9][0-9]{0,49})$/

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

function configuredTenant (value) {
  if (value == null || value === '') return null
  if (typeof value !== 'string' || !TENANT_ID_PATTERN.test(value)) {
    throw new Error('Tenant runtime configuration is invalid')
  }
  return value
}

function discardLocalUserIdentity () {
  const pinia = getActivePinia()
  const utilStore = useUtilStore(pinia)
  for (const key of ['api_token', 'userId', 'jiacn', 'openid', 'wxToken']) {
    try {
      utilStore.removeLocalStorage(key)
    } catch {
      // Keep clearing independent fields even if one browser key is unavailable.
    }
  }
  try {
    useGlobalStore(pinia).clearUserIdentity()
  } catch {
    // A stale subject cannot remain visible through the global store.
  }
}

export function tenantSelectionEnabled (mode) {
  if (mode == null || mode === '') return false // Temporary legacy-client compatibility only.
  if (!['fixed', 'selectable'].includes(mode)) {
    throw new Error('Tenant selection mode is invalid')
  }
  return true
}

function tenantIsolationEnabled () {
  return tenantSelectionEnabled(runtimeEnv.VITE_TENANT_SELECTION_MODE)
}

function fixedTenantMode () {
  return runtimeEnv.VITE_TENANT_SELECTION_MODE === 'fixed'
}

function fixedIdentityContext (transaction) {
  return { issuer: runtimeEnv.VITE_OAUTH_ISSUER || transaction.authorizationServer,
    clientId: transaction.clientId, tenantId: configuredTenant(runtimeEnv.VITE_DEFAULT_TENANT_ID) }
}

function verifiedResourceIdentity (resource, accessToken, transaction) {
  return fixedTenantMode()
    ? bindFixedTenantIdentity(resource, accessToken, fixedIdentityContext(transaction))
    : resource
}

function discardVerifiedTenantView (store) {
  verifiedTenantSessions.delete(store)
  store.tenantIdentity = null
  store.authorizationGeneration += 1
  cancelReauthentication(store)
  stopIdentityBoundWork()
  discardLocalUserIdentity()
}

function identityStorageKey ({ clientId, tenantId }) {
  return `cyf.auth.v2:${encodeURIComponent(window.location.origin)}:${encodeURIComponent(clientId)}:${tenantId}`
}

function activeTenantStorageKey (clientId) {
  return `cyf.auth.view.v2:${encodeURIComponent(window.location.origin)}:${encodeURIComponent(clientId)}`
}

async function tenantLedgerContext (clientId, authorizationServer) {
  if (!isNonblankRuntimeString(clientId) || !isNonblankRuntimeString(authorizationServer)) {
    throw new Error('Tenant authentication configuration is invalid')
  }
  return {
    issuer: runtimeEnv.VITE_OAUTH_ISSUER || authorizationServer,
    origin: window.location.origin,
    clientId,
    tabId: await tenantBrowserTabId()
  }
}

function queueTenantIdentityClear (store, tenantId, preserveSharedSession = false) {
  const previous = pendingTenantLogouts.get(store)
  const task = Promise.resolve(previous).catch(() => {}).then(async () => {
    const context = await tenantLedgerContext(store.oauthClientId, store.oauthAuthorizationServer())
    return tenantId && !preserveSharedSession
      ? logoutTenantSession({ ...context, tenantId })
      : invalidateTenantView(context)
  })
  pendingTenantLogouts.set(store, task)
  // Keep failure observable to token()/authorization, without an unhandled rejection
  // from the synchronous clearIdentity() call site.
  task.catch(() => {})
  return task

}
function validIdentityAtom (value) {
  return typeof value === 'string' && value.trim() !== '' &&
    !/[\uD800-\uDFFF]/u.test(value) &&
    [...value].every(char => char.codePointAt(0) > 31 && char.codePointAt(0) !== 127)
}

function validRevision (value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,18})$/.test(value)) return false
  return value.length < 19 || value <= '9223372036854775807'
}

export function validTenantIdentity (identity, transaction) {
  if (fixedTenantMode()) {
    const expected = fixedIdentityContext(transaction)
    return transaction.expectedTenant === expected.tenantId && validFixedTenantIdentity(identity, expected)
  }
  const dataDomainId = runtimeEnv.VITE_DATA_DOMAIN_ID || 'cyf'
  if (!identity || typeof identity !== 'object' || identity.clientId !== transaction.clientId ||
      !validIdentityAtom(identity.subject) || !validIdentityAtom(identity.jiacn) ||
      typeof identity.issuer !== 'string' || identity.issuer.trim() === '' ||
      identity.dataDomainId !== dataDomainId ||
      !TENANT_ID_PATTERN.test(identity.tenantId || '') || typeof identity.tenantName !== 'string' ||
      identity.issuer !== (runtimeEnv.VITE_OAUTH_ISSUER || transaction.authorizationServer) ||
      identity.tenantName.trim() === '' || !['NORMAL', 'TEST'].includes(identity.tenantKind) ||
      !validRevision(identity.tenantSessionEpoch) ||
      !validRevision(identity.membershipRevision) ||
      !validRevision(identity.clientTenantGrantRevision) || !Array.isArray(identity.scopes) ||
      !identity.scopes.every(validIdentityAtom)) return false
  return transaction.expectedTenant == null || identity.tenantId === transaction.expectedTenant
}

export async function verifyPersistedTenantSession (record, transaction, { signal } = {}) {
  if (!record || !validTenantIdentity(record.identity, transaction)) return false
  const requestId = crypto.randomUUID()
  const response = await fetch(`${transaction.authorizationServer}/resource`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${record.accessToken}`, 'Cache-Control': 'no-store', 'X-Request-Id': requestId },
    cache: 'no-store',
    signal
  })
  if (!response.ok) return false
  const { value: resourceIdentity } = decodeHttpResponse(await response.text(), { status: response.status,
    requestId, responseRequestId: response.headers.get('X-Request-Id') })
  const verified = verifiedResourceIdentity(resourceIdentity, record.accessToken, transaction)
  if (!validTenantIdentity(verified, transaction)) return false
  const fields = fixedTenantMode()
    ? ['issuer', 'subject', 'clientId', 'tenantId', 'tokenKind', 'userId', 'authEpoch', 'jiacn']
    : ['issuer', 'subject', 'clientId', 'tenantId', 'dataDomainId',
    'tenantName', 'tenantKind', 'tenantSessionEpoch', 'membershipRevision',
    'clientTenantGrantRevision', 'jiacn']
  return fields.every(field => verified[field] === record.identity[field]) &&
    Array.isArray(verified.scopes) && Array.isArray(record.identity.scopes) &&
    JSON.stringify([...verified.scopes].sort()) === JSON.stringify([...record.identity.scopes].sort())
}

export function validTenantProfile (profile, identity) {
  const id = profile?.id
  return (Number.isSafeInteger(id) && id > 0 ||
    typeof id === 'string' && /^[1-9][0-9]*$/.test(id)) &&
    typeof identity?.jiacn === 'string' && identity.jiacn.trim() !== '' &&
    profile.jiacn === identity.jiacn &&
    (!fixedTenantMode() || identity.tokenKind === 'user' && String(id) === identity.userId)
}

export function visibleTenantIdentity (identity, activeTenantId, hasActiveToken) {
  if (fixedTenantMode()) {
    if (!hasActiveToken || activeTenantId !== configuredTenant(runtimeEnv.VITE_DEFAULT_TENANT_ID) ||
        !validFixedTenantIdentity(identity, { issuer: runtimeEnv.VITE_OAUTH_ISSUER || identity?.issuer,
          clientId: identity?.clientId, tenantId: activeTenantId })) return null
    return identity
  }
  if (!hasActiveToken || identity?.tenantId !== activeTenantId ||
      !TENANT_ID_PATTERN.test(activeTenantId || '') ||
      typeof identity.tenantName !== 'string' || identity.tenantName.trim() === '' ||
      !['NORMAL', 'TEST'].includes(identity.tenantKind)) return null
  return identity
}

/** Only verified /resource claims are exposed to browser business namespaces. */
function tenantViewIdentity (identity) {
  if (fixedTenantMode()) {
    return Object.freeze({ issuer: identity.issuer, subject: identity.subject, clientId: identity.clientId,
      jiacn: identity.jiacn, tenantId: identity.tenantId, tokenKind: identity.tokenKind,
      userId: identity.userId, authEpoch: identity.authEpoch,
      // Display fields are optional; no fabricated domain or permission revisions.
      tenantName: identity.tenantName, tenantKind: identity.tenantKind,
      scopes: Object.freeze([...identity.scopes].sort()) })
  }
  return Object.freeze({
    issuer: identity.issuer,
    subject: identity.subject,
    clientId: identity.clientId,
    jiacn: identity.jiacn,
    tenantId: identity.tenantId,
    dataDomainId: identity.dataDomainId,
    tenantName: identity.tenantName,
    tenantKind: identity.tenantKind,
    tenantSessionEpoch: identity.tenantSessionEpoch,
    membershipRevision: identity.membershipRevision,
    clientTenantGrantRevision: identity.clientTenantGrantRevision,
    scopes: Object.freeze(Array.isArray(identity.scopes) ? [...identity.scopes].sort() : [])
  })
}

export function visibleTenantSessionCurrent (identity, activeTenantId, verified, snapshot, now = Date.now()) {
  return visibleTenantIdentity(identity, activeTenantId, Boolean(verified)) !== null &&
    verified.tenantId === activeTenantId && verified.expiresAt > now &&
    snapshot?.authRevision === verified.authRevision &&
    snapshot?.viewRevision === verified.viewRevision &&
    snapshot?.session?.accessToken === verified.accessToken
}

export const useApiStore = defineStore('api', {
  state: () => ({
    baseUrl: runtimeEnv.VITE_API_BASE_URL || '',
    dwzDomain: runtimeEnv.VITE_DWZ_DOMAIN,
    oauthClientId: runtimeEnv.VITE_OAUTH_CLIENT_ID,
    authorizationStarted: false,
    authorizationGeneration: 0,
    tenantIdentity: null
  }),
  actions: {
    oauthAuthorizationServer () {
      return runtimeEnv.VITE_OAUTH_BASE_URL || this.baseUrl || window.location.origin
    },
    oauthRuntimeConfig () {
      const configured = configuredTenant(runtimeEnv.VITE_DEFAULT_TENANT_ID)
      const fixed = runtimeEnv.VITE_TENANT_SELECTION_MODE === 'fixed'
      if (fixed && configured === null) throw new Error('Fixed tenant mode requires VITE_DEFAULT_TENANT_ID')
      return Object.freeze({
        clientId: this.oauthClientId,
        redirectUri: `${window.location.origin}/oauth2/callback`,
        authorizationServer: this.oauthAuthorizationServer(),
        expectedTenant: fixed ? configured : (this.activeTenantId() || configured),
        // The central chooser deliberately omits the hint; the callback still
        // checks the initiating state, client and authorization server.
        allowUnspecifiedTenant: runtimeEnv.VITE_TENANT_SELECTION_MODE === 'selectable'
      })
    },

    activeTenantId () {
      if (!tenantIsolationEnabled() || !isNonblankRuntimeString(this.oauthClientId)) return null
      const configured = configuredTenant(runtimeEnv.VITE_DEFAULT_TENANT_ID)
      if (runtimeEnv.VITE_TENANT_SELECTION_MODE === 'fixed') return configured
      const selected = window.sessionStorage.getItem(activeTenantStorageKey(this.oauthClientId))
      return TENANT_ID_PATTERN.test(selected || '') ? selected : configured
    },

    hasActiveToken () {
      if (!tenantIsolationEnabled()) return Boolean(useUtilStore().getLocalStorage('api_token'))
      const tenantId = this.activeTenantId()
      const verified = verifiedTenantSessions.get(this)
      return Boolean(tenantId && verified?.tenantId === tenantId &&
        verified.expiresAt > Date.now() && !this.authorizationStarted)
    },

    async abortAuthorizationAttempt (transaction) {
      if (!tenantIsolationEnabled()) return
      // A failed callback belongs to this view. Do not revoke the shared
      // tenant session held by another tab of the same client.
      this.clearIdentity({ preserveSharedSession: true })
      await pendingTenantLogouts.get(this)
      if (transaction?.state) {
        await cancelTenantAuthorization({
          ...(await tenantLedgerContext(transaction.clientId, transaction.authorizationServer)),
          state: transaction.state,
          expectedTenant: transaction.expectedTenant
        })
      }
    },

    async beginAuthorization (returnTo = currentReturnPath(), { chooseArea = false } = {}) {
      if (this.authorizationStarted) return false
      if (chooseArea) {
        if (runtimeEnv.VITE_TENANT_SELECTION_MODE !== 'selectable') {
          throw new Error('Tenant switching is unavailable')
        }
        // Retain the old area's shared session for other tabs while invalidating
        // this tab's view and stopping its outstanding identity-bound work.
        this.clearIdentity({ preserveSharedSession: true })
      }
      const authorizationGeneration = this.authorizationGeneration
      if (authorizationGeneration !== this.authorizationGeneration) return false
      this.authorizationStarted = true
      let ledgerTransaction
      let navigationStarted = false
      try {
        const config = this.oauthRuntimeConfig()
        const authorizationConfig = chooseArea ? { ...config, expectedTenant: null } : config
        if (tenantIsolationEnabled()) await pendingTenantLogouts.get(this)
        // Yield once so a synchronous logout can cancel a queued reauthentication
        // before it creates a PKCE transaction.
        await Promise.resolve()
        if (authorizationGeneration !== this.authorizationGeneration || !this.authorizationStarted) return false
        const transaction = await createOAuthTransaction({ returnTo, ...authorizationConfig })
        if (authorizationGeneration !== this.authorizationGeneration || !this.authorizationStarted) return false
        if (tenantIsolationEnabled()) {
          const candidate = { ...(await tenantLedgerContext(config.clientId, config.authorizationServer)),
            state: transaction.state, expectedTenant: transaction.expectedTenant }
          await beginTenantAuthorization(candidate)
          ledgerTransaction = candidate
          if (authorizationGeneration !== this.authorizationGeneration || !this.authorizationStarted) return false
        }
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
        if (transaction.expectedTenant !== null) params.set('tenant_hint', transaction.expectedTenant)
        if (authorizationGeneration !== this.authorizationGeneration || !this.authorizationStarted) return false
        rememberOAuthBackNavigation(transaction.state, { now: transaction.createdAt })
        window.location.replace(`${config.authorizationServer}/oauth2/authorize?${params.toString()}`)
        navigationStarted = true
        return true
      } catch (error) {
        if (authorizationGeneration === this.authorizationGeneration) this.authorizationStarted = false
        throw error
      } finally {
        if (ledgerTransaction && !navigationStarted) await cancelTenantAuthorization(ledgerTransaction)
      }
    },

    async token () {
      if (tenantIsolationEnabled()) {
        await pendingTenantLogouts.get(this)
        if (this.authorizationStarted) return null
        const tenantId = this.activeTenantId()
        if (tenantId && isNonblankRuntimeString(this.oauthClientId)) {
          const context = await tenantLedgerContext(this.oauthClientId, this.oauthAuthorizationServer())
          const snapshot = await readTenantSession({ ...context, tenantId })
          if (snapshot) return this.verifyTenantSnapshot(snapshot, context, tenantId)
        }
        if (verifiedTenantSessions.has(this) || this.tenantIdentity) discardVerifiedTenantView(this)
        if (window.location.pathname === '/oauth2/callback') return null
        await this.beginAuthorization()
        return null
      }
      const utilStore = useUtilStore()
      const accessToken = utilStore.getLocalStorage('api_token')
      if (!accessToken) {
        await this.beginAuthorization()
        return null
      }
      return accessToken
    },

    async verifyTenantSnapshot (snapshot, context, tenantId) {
      const record = snapshot.session
      const transaction = { clientId: context.clientId,
        authorizationServer: this.oauthAuthorizationServer(), expectedTenant: tenantId }
      if (!validTenantIdentity(record.identity, transaction)) {
        discardVerifiedTenantView(this)
        throw new Error('Stored tenant identity is invalid')
      }
      const previous = verifiedTenantSessions.get(this)
      const identityFingerprint = JSON.stringify(tenantViewIdentity(record.identity))
      if (previous?.tenantId === tenantId && previous.authRevision === snapshot.authRevision &&
          previous.viewRevision === snapshot.viewRevision && previous.accessToken === record.accessToken &&
          previous.expiresAt === record.expiresAt && previous.identityFingerprint === identityFingerprint) return record.accessToken
      // A newer ledger session (including the same uid with a newer auth_epoch)
      // must cancel old work before it can publish a hydrated identity.
      if (previous || this.tenantIdentity) discardVerifiedTenantView(this)
      const operation = createIdentityOperation(this)
      try {
        const valid = await verifyPersistedTenantSession(record, transaction, { signal: operation.signal })
        operation.assertCurrent()
        const fresh = await readTenantSession({ ...context, tenantId })
        operation.assertCurrent()
        if (!fresh || fresh.authRevision !== snapshot.authRevision ||
            fresh.viewRevision !== snapshot.viewRevision ||
            fresh.session.accessToken !== record.accessToken) throw new DOMException('Identity changed', 'AbortError')
        if (!valid) throw new Error('Stored tenant identity verification failed')
        const profileResponse = await fetch(`${this.baseUrl}/user/my`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${record.accessToken}`, 'Cache-Control': 'no-store' },
          cache: 'no-store', signal: operation.signal
        })
        operation.assertCurrent()
        if (!profileResponse.ok) throw new Error('Stored tenant profile verification failed')
        const profile = (await profileResponse.json())?.data
        operation.assertCurrent()
        if (!validTenantProfile(profile, record.identity)) throw new Error('Stored tenant profile mismatch')
        const stillCurrent = await readTenantSession({ ...context, tenantId })
        operation.assertCurrent()
        if (!stillCurrent || stillCurrent.authRevision !== snapshot.authRevision ||
            stillCurrent.viewRevision !== snapshot.viewRevision ||
            stillCurrent.session.accessToken !== record.accessToken) throw new DOMException('Identity changed', 'AbortError')
        discardLocalUserIdentity()
        const globalStore = useGlobalStore()
        verifiedTenantSessions.set(this, {
          tenantId,
          authRevision: snapshot.authRevision,
          viewRevision: snapshot.viewRevision,
          accessToken: record.accessToken,
          expiresAt: record.expiresAt,
          identityFingerprint
        })
        globalStore.setUser(profile)
        globalStore.setJiacn(profile.jiacn)
        if (profile.openid) globalStore.setOpenid(profile.openid)
        this.tenantIdentity = tenantViewIdentity(record.identity)
        return record.accessToken
      } finally {
        operation.cleanup()
      }
    },

    async refreshTenantDisplay () {
      const identity = this.tenantIdentity
      if (!identity) return
      const verified = verifiedTenantSessions.get(this)
      let activeTenantId
      try { activeTenantId = this.activeTenantId() } catch { activeTenantId = null }
      if (!verified || verified.tenantId !== identity.tenantId ||
          verified.expiresAt <= Date.now() || activeTenantId !== verified.tenantId) {
        if (this.tenantIdentity === identity) {
          if (verified?.tenantId === identity.tenantId &&
              verifiedTenantSessions.get(this) === verified) verifiedTenantSessions.delete(this)
          this.tenantIdentity = null
          this.authorizationGeneration += 1
          stopIdentityBoundWork()
          cancelReauthentication(this)
          discardLocalUserIdentity()
        }
        return
      }
      let snapshot
      try {
        await pendingTenantLogouts.get(this)
        const context = await tenantLedgerContext(this.oauthClientId, this.oauthAuthorizationServer())
        snapshot = await readTenantSession({ ...context, tenantId: verified.tenantId })
      } catch {
        // A failed storage read cannot keep a badge claiming a live identity.
        snapshot = null
      }
      if (!visibleTenantSessionCurrent(identity, activeTenantId, verified, snapshot) &&
          this.tenantIdentity === identity && verifiedTenantSessions.get(this) === verified) {
        verifiedTenantSessions.delete(this)
        this.tenantIdentity = null
        this.authorizationGeneration += 1
        cancelReauthentication(this)
        discardLocalUserIdentity()
        stopIdentityBoundWork()
      }
    },

    async assertTenantTokenCurrent (token) {
      if (!tenantIsolationEnabled()) return
      await pendingTenantLogouts.get(this)
      const tenantId = this.activeTenantId()
      const verified = verifiedTenantSessions.get(this)
      if (!tenantId || verified?.tenantId !== tenantId || verified.accessToken !== token) {
        throw new DOMException('Identity changed', 'AbortError')
      }
      const context = await tenantLedgerContext(this.oauthClientId, this.oauthAuthorizationServer())
      const snapshot = await readTenantSession({ ...context, tenantId })
      if (!snapshot || snapshot.authRevision !== verified.authRevision ||
          snapshot.viewRevision !== verified.viewRevision || snapshot.session.accessToken !== token) {
        throw new DOMException('Identity changed', 'AbortError')
      }
    },

    async exchangeCodeForToken (code, transaction, { signal } = {}) {
      if (typeof code !== 'string' || code.trim() === '' ||
          typeof transaction?.codeVerifier !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(transaction.codeVerifier) ||
          !isNonblankRuntimeString(transaction.clientId) ||
          !isNonblankRuntimeString(transaction.redirectUri) ||
          !isNonblankRuntimeString(transaction.authorizationServer)) {
        throw new Error('Invalid authorization transaction')
      }
      if (tenantIsolationEnabled() && !/^[A-Za-z0-9_-]{43}$/.test(transaction.state || '')) {
        throw new Error('Tenant authorization transaction state is missing')
      }
      if (tenantIsolationEnabled() && (verifiedTenantSessions.has(this) || this.tenantIdentity)) {
        discardVerifiedTenantView(this)
      }
      const operation = createIdentityOperation(this, signal)
      try {
        operation.assertCurrent()
        if (tenantIsolationEnabled()) await pendingTenantLogouts.get(this)
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
        if (tenantIsolationEnabled()) {
          const identityRequestId = crypto.randomUUID()
          const identityResponse = await fetch(`${transaction.authorizationServer}/resource`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token.accessToken}`, 'Cache-Control': 'no-store',
              'X-Request-Id': identityRequestId },
            cache: 'no-store',
            signal: operation.signal
          })
          operation.assertCurrent()
          if (!identityResponse.ok) throw new Error('Tenant identity verification failed')
          const { value: resourceIdentity } = decodeHttpResponse(await identityResponse.text(), {
            status: identityResponse.status, requestId: identityRequestId,
            responseRequestId: identityResponse.headers.get('X-Request-Id')
          })
          const identity = verifiedResourceIdentity(resourceIdentity, token.accessToken, transaction)
          operation.assertCurrent()
          if (!validTenantIdentity(identity, transaction)) throw new Error('Tenant identity verification failed')
          const record = Object.freeze({
            accessToken: token.accessToken,
            expiresAt: Date.now() + token.expiresIn * 1000,
            identity
          })
          const context = await tenantLedgerContext(transaction.clientId, transaction.authorizationServer)
          const selectionKey = activeTenantStorageKey(transaction.clientId)
          const previousSelection = window.sessionStorage.getItem(selectionKey)
          // Local storage can fail independently of IndexedDB. Require it to
          // succeed before the shared candidate is ever committed.
          window.sessionStorage.setItem(selectionKey, identity.tenantId)
          let committed
          try {
            operation.assertCurrent()
            committed = await commitTenantAuthorization({ ...context, state: transaction.state,
              verifiedTenant: identity.tenantId, session: record })
          } catch (error) {
            // A failed CAS cannot switch this tab to an uncommitted area.
            if (window.sessionStorage.getItem(selectionKey) === identity.tenantId) {
              if (previousSelection === null) window.sessionStorage.removeItem(selectionKey)
              else window.sessionStorage.setItem(selectionKey, previousSelection)
            }
            throw error
          }
          // IndexedDB's completed readwrite transaction is the durable commit;
          verifiedTenantSessions.set(this, { tenantId: identity.tenantId,
            authRevision: committed.authRevision, viewRevision: committed.viewRevision,
            accessToken: record.accessToken, expiresAt: record.expiresAt,
            identityFingerprint: JSON.stringify(tenantViewIdentity(identity)) })
          this.tenantIdentity = tenantViewIdentity(identity)
        } else {
          useUtilStore().setLocalStorage('api_token', token.accessToken, Date.now() + token.expiresIn * 1000)
        }
        return token.accessToken
      } catch (error) {
        operation.assertCurrent()
        throw error
      } finally {
        operation.cleanup()
      }
    },
    clearIdentity ({ preserveSharedSession = false } = {}) {
      this.authorizationGeneration += 1
      this.authorizationStarted = false
      verifiedTenantSessions.delete(this)
      this.tenantIdentity = null
      cancelReauthentication(this)
      stopIdentityBoundWork()
      let scopedTenant
      try { scopedTenant = this.activeTenantId() } catch { scopedTenant = null }
      if (tenantIsolationEnabled() && isNonblankRuntimeString(this.oauthClientId)) {
        try {
          queueTenantIdentityClear(this, scopedTenant, preserveSharedSession)
        } catch (error) {
          const failed = Promise.reject(error)
          failed.catch(() => {})
          pendingTenantLogouts.set(this, failed)
        }
        try {
          if (scopedTenant) window.localStorage.removeItem(identityStorageKey({ clientId: this.oauthClientId, tenantId: scopedTenant }))
          window.sessionStorage.removeItem(activeTenantStorageKey(this.oauthClientId))
        } catch {
          // The IndexedDB invalidation remains authoritative when legacy storage is unavailable.
        }
      }
      discardLocalUserIdentity()
    },

    async revokeAllSessions ({ signal, timeout = 15_000 } = {}) {
      const token = await this.token()
      if (!token) throw unauthenticatedError()

      const requestSignal = combineAbortSignals({ signals: [signal], timeout })
      try {
        throwIfAborted(requestSignal.signal)
        const response = await fetch(`${this.baseUrl}/user/me/sessions/revoke-all`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          signal: requestSignal.signal
        })
        if (response.status === 204) return
        throw revokeError(response, await responseErrorCode(response))
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
      if (tenantIsolationEnabled()) {
        this.clearIdentity()
        return
      }
      verifiedTenantSessions.delete(this)
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
        await this.assertTenantTokenCurrent(token)
        operation.assertCurrent()
        log.debug('User info retrieved:', data)
        if (tenantIsolationEnabled()) {
          const tenantId = this.activeTenantId()
          const context = await tenantLedgerContext(this.oauthClientId, this.oauthAuthorizationServer())
          const snapshot = await readTenantSession({ ...context, tenantId })
          operation.assertCurrent()
          if (snapshot?.session?.accessToken !== token || !validTenantProfile(data, snapshot.session.identity)) {
            throw new Error('Tenant user profile mismatch')
          }
        }
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
