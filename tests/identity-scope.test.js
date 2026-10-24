import { expect } from 'chai'
import { createHydratedIdentityScope, hasHydratedIdentity, resolveHydratedIdentity } from '../src/utils/identityScope.js'

describe('hydrated identity scope', () => {
  it('uses only the hydrated account and client, without requiring a tenant', () => {
    expect(createHydratedIdentityScope({ id: 5 }, 'client-a')).to.equal('client-a\u00005')
    expect(hasHydratedIdentity({ id: 5 })).to.equal(true)
    expect(createHydratedIdentityScope({ openid: 'wx-5' }, 'client-a')).to.equal('client-a\u0000wx-5')
  })

  it('fails closed for an unhydrated account or missing client', () => {
    expect(createHydratedIdentityScope({ id: 5 }, '')).to.equal('')
    expect(createHydratedIdentityScope({}, 'client-a')).to.equal('')
    expect(hasHydratedIdentity({ tenantId: '0' })).to.equal(false)
  })

  it('rejects control-character and non-scalar identity parts', () => {
    expect(createHydratedIdentityScope({ id: '5\u0000other', tenantId: '0' }, 'client-a')).to.equal('')
    expect(createHydratedIdentityScope({ id: 5 }, 'client\nother')).to.equal('')
    expect(createHydratedIdentityScope({ id: 5, tenantId: '0' }, 'client\u007fother')).to.equal('')
    expect(resolveHydratedIdentity({ id: { value: 5 }, openid: 'fallback', tenantId: '0' }).owner).to.equal('')
  })

  it('keeps accounts and clients distinct, but ignores tenant fields', () => {
    const accountA = createHydratedIdentityScope({ id: 5, tenantId: '0' }, 'client-a')
    const accountB = createHydratedIdentityScope({ id: 6, tenantId: '0' }, 'client-a')
    const tenantB = createHydratedIdentityScope({ id: 5, tenantId: 'tenant-b' }, 'client-a')
    const clientB = createHydratedIdentityScope({ id: 5 }, 'client-b')
    expect(tenantB).to.equal(accountA)
    expect(new Set([accountA, accountB, clientB]).size).to.equal(3)
  })
})
