import { expect } from 'chai'
import { browserBusinessNamespace } from '../../src/utils/tenantBusinessNamespace.js'
import { createHallOnboarding } from '../../src/composables/juyiting/useHallOnboarding.js'
import { createHallSubmissionRecoveryStore } from '../../src/composables/juyiting/useHallDrafts.js'

const identity = Object.freeze({
  issuer: 'https://auth.example', subject: 'uid-42', clientId: 'web', jiacn: 'owner-A',
  tenantId: '1', dataDomainId: 'cyf', tenantSessionEpoch: '2',
  membershipRevision: '3', clientTenantGrantRevision: '4', scopes: ['openid', 'write']
})
const config = { mode: 'selectable', origin: 'https://kit.example',
  issuer: 'https://auth.example', dataDomainId: 'cyf' }

function context (claims = identity, profile = { id: 42, jiacn: 'owner-A' }) {
  const api = { tenantIdentity: claims, oauthClientId: claims?.clientId || 'web',
    hasActiveToken: () => true, activeTenantId: () => api.tenantIdentity?.tenantId,
    baseUrl: 'https://auth.example' }
  return { api, profile: { user: profile, getUserId: profile.id, getJiacn: profile.jiacn } }
}

function memoryStorage () {
  const values = new Map()
  return { getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key) }
}

describe('verified business browser namespace', () => {
  it('never reuses another tenant, client, owner, issuer, origin or domain recovery key', () => {
    const { api, profile } = context()
    const original = browserBusinessNamespace(api, profile, config)
    expect(original).to.match(/^tenant-v2:u[0-9a-f]{32}$/)
    const differences = [
      [context({ ...identity, tenantId: '0' }), config],
      [context({ ...identity, clientId: 'mobile' }), config],
      [context({ ...identity, jiacn: 'owner-B', subject: 'uid-43' }, { id: 43, jiacn: 'owner-B' }), config],
      [context({ ...identity, issuer: 'https://other.example' }), { ...config, issuer: 'https://other.example' }],
      [context({ ...identity, dataDomainId: 'another' }), { ...config, dataDomainId: 'another' }],
      [context(), { ...config, origin: 'https://another.example' }]
    ]
    for (const [actor, options] of differences) {
      expect(browserBusinessNamespace(actor.api, actor.profile, options)).not.to.equal(original)
    }
  })

  it('invalidates persisted recovery when permissions or session epoch change', () => {
    const { api, profile } = context()
    const old = browserBusinessNamespace(api, profile, config)
    for (const changed of [
      { tenantSessionEpoch: '3' }, { membershipRevision: '4' },
      { clientTenantGrantRevision: '5' }, { scopes: ['openid'] }
    ]) {
      api.tenantIdentity = { ...identity, ...changed }
      expect(browserBusinessNamespace(api, profile, config)).not.to.equal(old)
    }
    expect(browserBusinessNamespace({ ...api, tenantIdentity: { ...identity, subject: 'uid\uD800' } }, profile, config)).to.equal('')
    expect(browserBusinessNamespace({ ...api, tenantIdentity: { ...identity, subject: 'uid\uDFFF' } }, profile, config)).to.equal('')
    expect(browserBusinessNamespace({ ...api, tenantIdentity: { ...identity, scopes: ['\uD800'] } }, profile, config)).to.equal('')
    api.tenantIdentity = { ...identity, scopes: ['write', 'openid'] }
    expect(browserBusinessNamespace(api, profile, config)).to.equal(old)
  })

  it('fails closed before /resource and /user/my agree or after logout', () => {
    const { api, profile } = context()
    expect(browserBusinessNamespace({ ...api, tenantIdentity: null }, profile, config)).to.equal('')
    expect(browserBusinessNamespace(api, { ...profile, getJiacn: 'other' }, config)).to.equal('')
    expect(browserBusinessNamespace({ ...api, oauthClientId: 'other' }, profile, config)).to.equal('')
    expect(browserBusinessNamespace({ ...api, activeTenantId: () => '0' }, profile, config)).to.equal('')
    expect(browserBusinessNamespace({ ...api, hasActiveToken: () => false }, profile, config)).to.equal('')
    expect(browserBusinessNamespace({ ...api, tenantIdentity: { ...identity, membershipRevision: null } }, profile, config)).to.equal('')
    expect(browserBusinessNamespace(api, profile, { ...config, dataDomainId: 'other' })).to.equal('')
    expect(browserBusinessNamespace(api, profile, { ...config, issuer: 'https://other.example' })).to.equal('')
    expect(browserBusinessNamespace(api, profile, { ...config, mode: 'selctable' })).to.equal('')
  })

  it('does not reuse an onboarding dismissal across areas, and preserves legacy keys', () => {
    const storage = memoryStorage()
    const { api, profile } = context()
    const first = browserBusinessNamespace(api, profile, config)
    createHallOnboarding({ subject: first, localStorage: storage, sessionStorage: memoryStorage() }).skip()
    expect(createHallOnboarding({ subject: first, localStorage: storage,
      sessionStorage: memoryStorage() }).snapshot().visible).to.equal(false)
    api.tenantIdentity = { ...identity, tenantId: '0' }
    const second = browserBusinessNamespace(api, profile, config)
    expect(createHallOnboarding({ subject: second, localStorage: storage,
      sessionStorage: memoryStorage() }).snapshot().visible).to.equal(true)
    expect(browserBusinessNamespace(api, profile, { mode: undefined })).to.equal('')
    profile.user.tenantId = '0'
    expect(browserBusinessNamespace(api, profile, { mode: undefined })).to.equal('0\u0000web\u000042')
  })

  it('does not reconcile an old-area idempotency key as the new-area request', () => {
    const storage = memoryStorage()
    const { api, profile } = context()
    let scope = browserBusinessNamespace(api, profile, config)
    const recovery = createHallSubmissionRecoveryStore({ storage, scopeKey: () => scope,
      keyFactory: () => 'browser-1' })
    const first = { idempotencyKey: 'area-1-request', draftId: 'draft-1', kind: 'CREATE' }
    expect(recovery.save(first)).to.equal(true)
    expect(recovery.read()?.idempotencyKey).to.equal(first.idempotencyKey)
    api.tenantIdentity = { ...identity, tenantId: '0' }
    scope = browserBusinessNamespace(api, profile, config)
    expect(recovery.read()).to.equal(null)
    const second = { idempotencyKey: 'area-0-request', draftId: 'draft-0', kind: 'CREATE' }
    expect(recovery.save(second)).to.equal(true)
    expect(recovery.read()?.idempotencyKey).to.equal(second.idempotencyKey)
    api.tenantIdentity = identity
    scope = browserBusinessNamespace(api, profile, config)
    expect(recovery.read()?.idempotencyKey).to.equal(first.idempotencyKey)
  })
})
