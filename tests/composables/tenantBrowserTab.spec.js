import { expect } from 'chai'
import { createTenantBrowserTabLease } from '../../src/utils/tenantBrowserTab.js'

function storage (data = new Map()) {
  return {
    data,
    getItem: key => data.get(key) || null,
    setItem: (key, value) => data.set(key, value)
  }
}

function locks () {
  const held = new Set()
  return {
    request (name, options, callback) {
      if (options.mode !== 'exclusive' || !options.ifAvailable) throw new Error('Unsafe lock mode')
      if (held.has(name)) return Promise.resolve(callback(null))
      held.add(name)
      return Promise.resolve(callback({ name }))
    }
  }
}

describe('tenant browser tab ID lease', () => {
  it('rotates a duplicated sessionStorage ID while the original tab holds its lock', async () => {
    const sharedLocks = locks()
    const originalStorage = storage()
    const browserCrypto = { randomUUID: () => crypto.randomUUID() }
    const first = createTenantBrowserTabLease({ storage: originalStorage, locks: sharedLocks, cryptoImpl: browserCrypto })
    const idOne = await first()
    const clonedStorage = storage(new Map(originalStorage.data))
    const second = createTenantBrowserTabLease({ storage: clonedStorage, locks: sharedLocks, cryptoImpl: browserCrypto })
    const idTwo = await second()
    expect(idOne).to.match(/^[0-9a-f-]{36}$/i)
    expect(idTwo).not.to.equal(idOne)
    expect(await first()).to.equal(idOne)
    expect(await second()).to.equal(idTwo)
    expect(originalStorage.getItem('cyf.auth.tab.v3')).to.equal(idOne)
    expect(clonedStorage.getItem('cyf.auth.tab.v3')).to.equal(idTwo)
  })

  it('refuses to open tenant identity without exclusive browser lock support', async () => {
    const browserStorage = storage()
    const tabId = createTenantBrowserTabLease({ storage: browserStorage, locks: null,
      cryptoImpl: { randomUUID: () => crypto.randomUUID() } })
    let failure
    try { await tabId() } catch (error) { failure = error }
    expect(failure?.message).to.equal('Secure tenant tab isolation is unavailable')
    expect(browserStorage.data.size).to.equal(0)
  })
})
