import 'fake-indexeddb/auto'
import { expect } from 'chai'
// jsdom exposes window separately from Node's globalThis.
Object.defineProperty(globalThis, 'indexedDB', { value: window.indexedDB, configurable: true })
import {
  beginTenantAuthorization,
  cancelTenantAuthorization,
  commitTenantAuthorization,
  invalidateTenantView,
  logoutTenantSession,
  readTenantSession,
  TenantAuthConflict
} from '../../src/utils/tenantAuthLedger.js'

function context (tabId, state, expectedTenant = null) {
  return {
    issuer: 'https://issuer.example',
    origin: `https://${crypto.randomUUID()}.example`,
    clientId: 'public-web',
    tabId,
    state,
    expectedTenant
  }
}

function session (ctx, tenantId, token) {
  return { accessToken: token, expiresAt: Date.now() + 60_000,
    identity: { issuer: ctx.issuer, clientId: ctx.clientId, tenantId } }
}

async function rejectsCode (promise, code) {
  let failure
  try { await promise } catch (error) { failure = error }
  expect(failure).to.be.instanceOf(TenantAuthConflict)
  expect(failure.code).to.equal(code)
}

describe('IndexedDB tenant authentication ledger', () => {
  it('rejects the older same-namespace authorization and keeps a logout tombstone', async () => {
    const first = context('tab-a', 'first', '1')
    const second = { ...first, state: 'second' }
    await beginTenantAuthorization(first)
    await beginTenantAuthorization(second)
    await rejectsCode(commitTenantAuthorization({ ...first, verifiedTenant: '1',
      session: session(first, '1', 'old') }), 'stale_view')
    await commitTenantAuthorization({ ...second, verifiedTenant: '1', session: session(second, '1', 'new') })
    const snapshot = await readTenantSession({ ...second, tenantId: '1' })
    expect(snapshot.session.accessToken).to.equal('new')
    await logoutTenantSession({ ...second, tenantId: '1' })
    expect(await readTenantSession({ ...second, tenantId: '1' })).to.equal(null)
  })

  it('preserves separately selected areas in independent tabs of one client', async () => {
    const one = context('tab-one', 'one', '1')
    const zero = { ...one, tabId: 'tab-zero', state: 'zero', expectedTenant: '0' }
    await beginTenantAuthorization(one)
    await beginTenantAuthorization(zero)
    await commitTenantAuthorization({ ...one, verifiedTenant: '1', session: session(one, '1', 'token-one') })
    await commitTenantAuthorization({ ...zero, verifiedTenant: '0', session: session(zero, '0', 'token-zero') })
    expect((await readTenantSession({ ...one, tenantId: '1' })).session.accessToken).to.equal('token-one')
    expect((await readTenantSession({ ...zero, tenantId: '0' })).session.accessToken).to.equal('token-zero')
  })

  it('rejects a server-selected candidate after another window begins a directed authorization', async () => {
    const unknown = context('tab-unknown', 'unknown')
    const directed = { ...unknown, tabId: 'tab-directed', state: 'directed', expectedTenant: '1' }
    await beginTenantAuthorization(unknown)
    await beginTenantAuthorization(directed)
    await rejectsCode(commitTenantAuthorization({ ...unknown, verifiedTenant: '0',
      session: session(unknown, '0', 'stale') }), 'stale_auth_set')
    await commitTenantAuthorization({ ...directed, verifiedTenant: '1', session: session(directed, '1', 'fresh') })
  })

  it('cancels only its own active transaction without deleting the successor', async () => {
    const first = context('tab-a', 'first', '1')
    const second = { ...first, state: 'second' }
    await beginTenantAuthorization(first)
    await beginTenantAuthorization(second)
    expect(await cancelTenantAuthorization(first)).to.equal(true)
    expect(await cancelTenantAuthorization(first)).to.equal(false)
    await commitTenantAuthorization({ ...second, verifiedTenant: '1', session: session(second, '1', 'survivor') })
    expect((await readTenantSession({ ...second, tenantId: '1' })).session.accessToken).to.equal('survivor')
  })

  it('a cancelled callback clears only its view, not another window\x27s same-tenant session', async () => {
    const live = context('live-tab', 'live', '1')
    const cancelled = { ...live, tabId: 'cancelled-tab', state: 'cancelled' }
    await beginTenantAuthorization(live)
    await commitTenantAuthorization({ ...live, verifiedTenant: '1', session: session(live, '1', 'live-token') })
    await beginTenantAuthorization(cancelled)
    await invalidateTenantView(cancelled)
    expect(await cancelTenantAuthorization(cancelled)).to.equal(true)
    expect(await readTenantSession({ ...cancelled, tenantId: '1' })).to.equal(null)
    expect((await readTenantSession({ ...live, tenantId: '1' })).session.accessToken).to.equal('live-token')
  })

})
