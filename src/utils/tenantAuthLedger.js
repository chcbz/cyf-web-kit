// One object store serializes all auth/view/pending writes across same-origin windows.
const DATABASE_NAME = 'cyf.tenant.auth.v3'
const OBJECT_STORE = 'records'

export class TenantAuthConflict extends Error {
  constructor (code) {
    super(code)
    this.name = 'TenantAuthConflict'
    this.code = code
  }
}

function increment (revision = '0') {
  const next = BigInt(revision) + 1n
  if (next > 9223372036854775807n) throw new TenantAuthConflict('revision_exhausted')
  return next.toString()
}

function openLedger () {
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(OBJECT_STORE)) {
        request.result.createObjectStore(OBJECT_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new TenantAuthConflict('storage_blocked'))
  })
}
async function namespace (parts, cryptoImpl) {
  const digest = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parts)))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function transact (keys, change) {
  const db = await openLedger()
  try {
    return await new Promise((resolve, reject) => {
      let outcome
      let cause
      const tx = db.transaction(OBJECT_STORE, 'readwrite')
      const store = tx.objectStore(OBJECT_STORE)
      const current = {}
      let pending = keys.length
      keys.forEach(key => {
        const request = store.get(key)
        request.onsuccess = () => {
          current[key] = request.result
          if (--pending === 0) {
            try {
              outcome = change(current, store)
            } catch (error) {
              cause = error
              tx.abort()
            }
          }
        }
      })
      tx.oncomplete = () => resolve(outcome)
      tx.onabort = () => reject(cause || tx.error || new TenantAuthConflict('storage_aborted'))
    })
  } finally {
    db.close()
  }
}

export async function tenantAuthKeys ({ issuer, origin, clientId, tabId, state, tenantId = null,
  cryptoImpl = globalThis.crypto }) {
  if (![issuer, origin, clientId, tabId, state].every(value => typeof value === 'string' && value !== '') ||
      !cryptoImpl?.subtle || (tenantId !== null && !/^(?:0|[1-9][0-9]{0,49})$/.test(tenantId))) {
    throw new TenantAuthConflict('invalid_auth_namespace')
  }
  const groupDigest = await namespace([issuer, origin, clientId], cryptoImpl)
  const pendingDigest = await namespace([issuer, origin, clientId, state], cryptoImpl)
  const authDigest = tenantId === null ? null : await namespace([issuer, origin, clientId, tenantId], cryptoImpl)
  return {
    group: `group:${groupDigest}`,
    view: `view:${groupDigest}:${tabId}`,
    pending: `pending:${pendingDigest}`,
    auth: authDigest === null ? null : `auth:${authDigest}`
  }
}

export async function beginTenantAuthorization ({ issuer, origin, clientId, tabId, state,
  expectedTenant = null, cryptoImpl = globalThis.crypto }) {
  const keys = await tenantAuthKeys({ issuer, origin, clientId, tabId, state,
    tenantId: expectedTenant, cryptoImpl })
  const id = cryptoImpl.randomUUID()
  return transact([keys.group, keys.view, keys.pending, ...(keys.auth ? [keys.auth] : [])], (rows, store) => {
    if (rows[keys.pending]?.status === 'PENDING') throw new TenantAuthConflict('duplicate_state')
    const group = rows[keys.group] || { revision: '0' }
    const view = rows[keys.view] || { revision: '0', tenantId: null }
    const auth = keys.auth && (rows[keys.auth] || { revision: '0', session: null })
    const authSetRevision = increment(group.revision)
    const viewRevision = increment(view.revision)
    let authRevision = null
    if (auth) {
      authRevision = increment(auth.revision)
      store.put({ ...auth, revision: authRevision, activeTransactionId: id }, keys.auth)
    }
    const pending = {
      id,
      keys,
      expectedTenant,
      authSetRevision,
      viewRevision,
      authRevision,
      status: 'PENDING'
    }
    store.put({ revision: authSetRevision }, keys.group)
    store.put({ ...view, revision: viewRevision, pendingTransactionId: id }, keys.view)
    store.put(pending, keys.pending)
    return pending
  })
}

export async function commitTenantAuthorization ({ issuer, origin, clientId, tabId, state,
  verifiedTenant, session, cryptoImpl = globalThis.crypto }) {
  const keys = await tenantAuthKeys({ issuer, origin, clientId, tabId, state,
    tenantId: verifiedTenant, cryptoImpl })
  if (!session || session.identity?.issuer !== issuer || session.identity?.clientId !== clientId ||
      session.identity?.tenantId !== verifiedTenant || !Number.isSafeInteger(session.expiresAt)) {
    throw new TenantAuthConflict('invalid_candidate')
  }
  return transact([keys.group, keys.view, keys.pending, keys.auth], (rows, store) => {
    const pending = rows[keys.pending]
    const group = rows[keys.group]
    const view = rows[keys.view]
    const auth = rows[keys.auth] || { revision: '0', session: null }
    if (!pending || pending.status !== 'PENDING' || pending.keys.group !== keys.group ||
        pending.keys.view !== keys.view || pending.expectedTenant !== null &&
        pending.expectedTenant !== verifiedTenant || view?.revision !== pending.viewRevision) {
      throw new TenantAuthConflict('stale_view')
    }
    if (pending.expectedTenant === null) {
      if (group?.revision !== pending.authSetRevision) throw new TenantAuthConflict('stale_auth_set')
    } else if (auth.revision !== pending.authRevision || auth.activeTransactionId !== pending.id) {
      throw new TenantAuthConflict('stale_authorization')
    }
    const authRevision = increment(auth.revision)
    const authSetRevision = increment(group.revision)
    const viewRevision = increment(view.revision)
    store.put({ ...auth, revision: authRevision, activeTransactionId: null,
      committedTransactionId: pending.id, session }, keys.auth)
    store.put({ revision: authSetRevision }, keys.group)
    store.put({ revision: viewRevision, tenantId: verifiedTenant, pendingTransactionId: null }, keys.view)
    store.put({ id: pending.id, status: 'COMMITTED' }, keys.pending)
    return { authRevision, authSetRevision, viewRevision, tenantId: verifiedTenant }
  })
}

export async function cancelTenantAuthorization ({ issuer, origin, clientId, tabId, state,
  expectedTenant = null, cryptoImpl = globalThis.crypto }) {
  const keys = await tenantAuthKeys({ issuer, origin, clientId, tabId, state,
    tenantId: expectedTenant, cryptoImpl })
  return transact([keys.group, keys.view, keys.pending, ...(keys.auth ? [keys.auth] : [])], (rows, store) => {
    const pending = rows[keys.pending]
    if (!pending || pending.status !== 'PENDING' || pending.keys.group !== keys.group ||
        pending.keys.view !== keys.view || pending.expectedTenant !== expectedTenant) return false
    const group = rows[keys.group]
    const view = rows[keys.view]
    store.put({ revision: increment(group.revision) }, keys.group)
    if (view.revision === pending.viewRevision) {
      store.put({ revision: increment(view.revision), tenantId: null, pendingTransactionId: null }, keys.view)
    }
    if (keys.auth) {
      const auth = rows[keys.auth]
      if (auth?.activeTransactionId === pending.id) {
        store.put({ ...auth, revision: increment(auth.revision), activeTransactionId: null }, keys.auth)
      }
    }
    store.put({ id: pending.id, status: 'CANCELLED' }, keys.pending)
    return true
  })
}

export async function invalidateTenantView ({ issuer, origin, clientId, tabId,
  cryptoImpl = globalThis.crypto }) {
  const keys = await tenantAuthKeys({ issuer, origin, clientId, tabId,
    state: `clear:${cryptoImpl.randomUUID()}`, cryptoImpl })
  return transact([keys.group, keys.view], (rows, store) => {
    const group = rows[keys.group] || { revision: '0' }
    const view = rows[keys.view] || { revision: '0', tenantId: null }
    store.put({ revision: increment(group.revision) }, keys.group)
    store.put({ revision: increment(view.revision), tenantId: null,
      pendingTransactionId: null }, keys.view)
    return true
  })
}

export async function logoutTenantSession ({ issuer, origin, clientId, tabId, tenantId,
  cryptoImpl = globalThis.crypto }) {
  const keys = await tenantAuthKeys({ issuer, origin, clientId, tabId,
    state: `logout:${cryptoImpl.randomUUID()}`, tenantId, cryptoImpl })
  return transact([keys.group, keys.view, keys.auth], (rows, store) => {
    const group = rows[keys.group] || { revision: '0' }
    const view = rows[keys.view] || { revision: '0', tenantId: null }
    const auth = rows[keys.auth] || { revision: '0', session: null }
    const authRevision = increment(auth.revision)
    const viewRevision = increment(view.revision)
    store.put({ revision: increment(group.revision) }, keys.group)
    store.put({ ...auth, revision: authRevision, session: null,
      activeTransactionId: null, committedTransactionId: null }, keys.auth)
    store.put({ revision: viewRevision, pendingTransactionId: null,
      tenantId: view.tenantId === tenantId ? null : view.tenantId }, keys.view)
    return { authRevision, viewRevision }
  })
}

export async function readTenantSession ({ issuer, origin, clientId, tabId, tenantId,
  cryptoImpl = globalThis.crypto }) {
  const keys = await tenantAuthKeys({ issuer, origin, clientId, tabId,
    state: 'read', tenantId, cryptoImpl })
  return transact([keys.view, keys.auth], rows => {
    const view = rows[keys.view]
    const auth = rows[keys.auth]
    if (view?.tenantId !== tenantId || view.pendingTransactionId || !auth?.session ||
        auth.session.expiresAt <= Date.now()) return null
    return { session: auth.session, authRevision: auth.revision, viewRevision: view.revision }
  })
}
