import { expect } from 'chai'
import { createHydratedIdentityScope, hasHydratedIdentity, resolveHydratedIdentity } from '../src/utils/identityScope.js'

describe('hydrated identity scope', () => {
  it('preserves string and numeric tenant zero exactly', () => {
    expect(createHydratedIdentityScope({ id: 5, tenantId: '0' }, 'client-a')).to.equal('0\u0000client-a\u00005')
    expect(createHydratedIdentityScope({ id: 5, tenantId: 0 }, 'client-a')).to.equal('0\u0000client-a\u00005')
    expect(hasHydratedIdentity({ id: 5, tenantId: 0 })).to.equal(true)
  })

  it('fails closed for incomplete or unhydrated profiles instead of defaulting a tenant or cached owner', () => {
    expect(createHydratedIdentityScope({ id: 5 }, 'client-a')).to.equal('')
    expect(createHydratedIdentityScope({}, 'client-a')).to.equal('')
    expect(hasHydratedIdentity({ tenantId: '0' })).to.equal(false)
  })

  it('rejects control-character and non-scalar identity parts', () => {
    expect(createHydratedIdentityScope({ id: '5\u0000other', tenantId: '0' }, 'client-a')).to.equal('')
    expect(createHydratedIdentityScope({ id: 5, tenantId: '0\nother' }, 'client-a')).to.equal('')
    expect(createHydratedIdentityScope({ id: 5, tenantId: '0' }, 'client\u007fother')).to.equal('')
    expect(resolveHydratedIdentity({ id: { value: 5 }, openid: 'fallback', tenantId: '0' }).owner).to.equal('')
  })

  it('keeps accounts and tenants in distinct scopes without scanning or copying another scope', () => {
    const accountA = createHydratedIdentityScope({ id: 5, tenantId: '0' }, 'client-a')
    const accountB = createHydratedIdentityScope({ id: 6, tenantId: '0' }, 'client-a')
    const tenantB = createHydratedIdentityScope({ id: 5, tenantId: 'tenant-b' }, 'client-a')
    expect(new Set([accountA, accountB, tenantB]).size).to.equal(3)
  })
})
