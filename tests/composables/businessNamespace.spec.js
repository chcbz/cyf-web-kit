import { expect } from 'chai'
import { browserBusinessNamespace } from '../../src/utils/businessNamespace.js'
import { createHallSubmissionRecoveryStore } from '../../src/composables/juyiting/useHallDrafts.js'

describe('account business namespace', () => {
  it('works without a tenant and ignores server tenant metadata', () => {
    const api = { oauthClientId: 'web' }
    const profile = { user: { id: 42 } }
    const scope = browserBusinessNamespace(api, profile)
    expect(scope).to.equal('web\u000042')
    for (const tenantId of ['0', '1', null]) {
      expect(browserBusinessNamespace(api, { user: { id: 42, tenantId } })).to.equal(scope)
    }
    expect(browserBusinessNamespace(api, { user: {} })).to.equal('')
    expect(browserBusinessNamespace({}, profile)).to.equal('')
  })

  it('does not restore another account or application submission', () => {
    const storage = new Map()
    const adapter = { getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }
    const api = { oauthClientId: 'web' }
    const profile = { user: { id: 42 } }
    const recovery = createHallSubmissionRecoveryStore({ storage: adapter,
      scopeKey: () => browserBusinessNamespace(api, profile), keyFactory: () => 'browser-1' })
    expect(recovery.save({ idempotencyKey: 'request-1', draftId: 'draft-1', kind: 'CREATE' })).to.equal(true)
    profile.user = { id: 43 }
    expect(recovery.read()).to.equal(null)
    profile.user = { id: 42 }
    api.oauthClientId = 'other-app'
    expect(recovery.read()).to.equal(null)
    api.oauthClientId = 'web'
    expect(recovery.read()?.idempotencyKey).to.equal('request-1')
  })
})
