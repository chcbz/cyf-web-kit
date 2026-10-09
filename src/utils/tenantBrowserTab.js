// sessionStorage is cloned by some browsers when a tab is duplicated.
// Hold an origin-scoped Web Lock for this document's lifetime to make the
// tab identity exclusive; a duplicate tab must rotate before touching auth.
const TAB_ID_KEY = 'cyf.auth.tab.v3'
const UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

export function createTenantBrowserTabLease ({ storage, locks, cryptoImpl }) {
  let current
  return async function getTabId () {
    if (current) return current
    current = (async () => {
      if (!storage || !locks?.request || !cryptoImpl?.randomUUID) {
        throw new Error('Secure tenant tab isolation is unavailable')
      }
      let candidate = storage.getItem(TAB_ID_KEY)
      for (let attempt = 0; attempt < 8; attempt += 1) {
        if (!UUID_PATTERN.test(candidate || '')) candidate = cryptoImpl.randomUUID()
        let resolveGrant
        let rejectGrant
        const granted = new Promise((resolve, reject) => {
          resolveGrant = resolve
          rejectGrant = reject
        })
        Promise.resolve().then(() => locks.request(`cyf.auth.tab.v3:${candidate}`,
          { mode: 'exclusive', ifAvailable: true }, lock => {
            resolveGrant(Boolean(lock))
            if (lock) return new Promise(() => {}) // Released when this document closes.
          })).catch(rejectGrant)
        if (await granted) {
          storage.setItem(TAB_ID_KEY, candidate)
          return candidate
        }
        candidate = null
      }
      throw new Error('Could not allocate a distinct tenant tab identity')
    })()
    try {
      return await current
    } catch (error) {
      current = null
      throw error
    }
  }
}

let liveTabLease
export async function tenantBrowserTabId () {
  if (!liveTabLease) {
    liveTabLease = createTenantBrowserTabLease({
      storage: window.sessionStorage,
      locks: window.navigator.locks,
      cryptoImpl: window.crypto
    })
  }
  return liveTabLease()
}
