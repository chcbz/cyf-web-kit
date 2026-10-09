import { expect } from 'chai'
import { bindFixedTenantIdentity, validFixedTenantIdentity } from '../../src/utils/fixedTenantIdentity.js'
import { browserBusinessNamespace } from '../../src/utils/tenantBusinessNamespace.js'
import { createHallSubmissionRecoveryStore } from '../../src/composables/juyiting/useHallDrafts.js'
import { basicClaims, fixedRuntime, resourceIdentity, signedToken } from '../fixtures/fixed-tenant-identity.mjs'

const expected = { issuer: fixedRuntime.VITE_OAUTH_ISSUER, clientId: 'cyf-local', tenantId: '1' }
const namespaceOptions = { mode: 'fixed', issuer: expected.issuer, tenantId: '1', origin: 'https://kit.fixed.example' }
const bind = (claims = basicClaims(), resource = resourceIdentity(claims)) =>
  bindFixedTenantIdentity(resource, signedToken(claims), expected)
function context (identity = bind(), user = { id: 42, jiacn: 'owner-A' }) {
  return { api: { tenantIdentity: identity, oauthClientId: 'cyf-local',
    hasActiveToken: () => true, activeTenantId: () => '1' },
  global: { user, getUserId: user.id, getJiacn: user.jiacn } }
}

describe('fixed tenant base identity contract (offline signed JWT fixtures)', () => {
  it('binds tenant1 uid/auth_epoch without any domain or platform revisions', () => {
    const identity = bind()
    expect(validFixedTenantIdentity(identity, expected)).to.equal(true)
    expect(identity).to.include({ tenantId: '1', tokenKind: 'user', userId: '42', authEpoch: '7' })
    for (const key of ['dataDomainId', 'tenantSessionEpoch', 'membershipRevision', 'clientTenantGrantRevision']) {
      expect(identity).not.to.have.property(key)
    }
    const { api, global } = context(identity)
    expect(browserBusinessNamespace(api, global, namespaceOptions)).to.match(/^tenant-fixed-v1:u[0-9a-f]{32}$/)
  })

  it('rejects tenant0, a missing tenant, another issuer/client and non-user identities', () => {
    for (const changed of [{ tenant_id: '0' }, { tenant_id: undefined }, { tenant_id: '01' },
      { iss: 'https://foreign.example' }, { client_id: 'foreign-client' },
      { token_kind: 'machine' }, { token_kind: undefined }, { uid: undefined }, { auth_epoch: undefined },
      { uid: '042' }, { auth_epoch: -1 }, { auth_epoch: 9007199254740992 }, { auth_epoch: '9223372036854775808' }]) {
      expect(bind(basicClaims(changed)), JSON.stringify(changed)).to.equal(null)
    }
  })

  it('requires exact resource/bearer agreement for owner, subject, tenant, issuer, client and scopes', () => {
    const resource = resourceIdentity()
    for (const changed of [{ jiacn: 'owner-B' }, { subject: 'bob' }, { tenantId: '0' },
      { issuer: 'https://foreign.example' }, { clientId: 'other' }, { scopes: ['openid'] },
      { tokenKind: 'machine' }, { userId: '43' }, { authEpoch: 8 }]) {
      expect(bind(basicClaims(), { ...resource, ...changed })).to.equal(null)
    }
    expect(bind(basicClaims({ tenantId: '0' }))).to.equal(null)
    expect(bindFixedTenantIdentity(resource, 'old-opaque-tenant0-token', expected)).to.equal(null)
  })

  it('rejects profile owner/uid disagreement, logout, and the wrong active tenant', () => {
    const { api, global } = context()
    for (const actor of [context(bind(), { id: 43, jiacn: 'owner-A' }), context(bind(), { id: 42, jiacn: 'owner-B' })]) {
      expect(browserBusinessNamespace(actor.api, actor.global, namespaceOptions)).to.equal('')
    }
    expect(browserBusinessNamespace({ ...api, hasActiveToken: () => false }, global, namespaceOptions)).to.equal('')
    expect(browserBusinessNamespace({ ...api, activeTenantId: () => '0' }, global, namespaceOptions)).to.equal('')
    expect(browserBusinessNamespace(api, global, { ...namespaceOptions, tenantId: '0' })).to.equal('')
    expect(browserBusinessNamespace({ ...api, oauthClientId: 'other' }, global, namespaceOptions)).to.equal('')
  })

  it('separates same-user auth_epoch/scopes recovery and ignores irrelevant domain revisions', () => {
    const { api, global } = context()
    let scope = browserBusinessNamespace(api, global, namespaceOptions)
    const original = scope
    const values = new Map()
    const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value),
      removeItem: key => values.delete(key) }
    const recovery = createHallSubmissionRecoveryStore({ storage, scopeKey: () => scope, keyFactory: () => 'fixed-browser' })
    expect(recovery.save({ idempotencyKey: 'old-permission', draftId: 'draft-1', kind: 'CREATE' })).to.equal(true)
    api.tenantIdentity = bind(basicClaims({ auth_epoch: 8 }))
    scope = browserBusinessNamespace(api, global, namespaceOptions)
    expect(scope).not.to.equal(original)
    expect(recovery.read()).to.equal(null)
    api.tenantIdentity = bind(basicClaims({ scope: ['openid'] }))
    expect(browserBusinessNamespace(api, global, namespaceOptions)).not.to.equal(original)
    api.tenantIdentity = { ...bind(), dataDomainId: 'unrelated', membershipRevision: '999' }
    expect(browserBusinessNamespace(api, global, namespaceOptions)).to.equal(original)
    api.tenantIdentity = bind(basicClaims({ scope: ['write', 'openid'] }))
    expect(browserBusinessNamespace(api, global, namespaceOptions)).to.equal(original)
  })
})
