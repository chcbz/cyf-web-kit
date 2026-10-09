/** Two real Chromium tabs/IndexedDB transactions; no Vite, OAuth server or shared MySQL. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CdpSession, launchChrome, evaluate, stopChrome } from '../scripts/juyiting/e13/lib/cdp-harness.mjs'

const fixture = pathToFileURL(resolve('tests/fixtures/tenant-auth-cas.html')).href
const source = readFileSync('src/utils/tenantAuthLedger.js', 'utf8')
const tabSource = readFileSync('src/utils/tenantBrowserTab.js', 'utf8')
if (/^import\s/m.test(source)) throw new Error('Standalone browser ledger fixture must not have imports')
if (/^import\s/m.test(tabSource)) throw new Error('Standalone tab lease fixture must not have imports')
const ledger = source.replace(/^export /gm, '')
const lease = tabSource.replace(/^export /gm, '')
let chrome
let main
let other
let profile

async function install (cdp) {
  const capabilities = await evaluate(cdp, '({ secure: isSecureContext, idb: !!indexedDB, crypto: !!crypto.subtle, locks: !!navigator.locks?.request })')
  assert.deepEqual(capabilities, { secure: true, idb: true, crypto: true, locks: true })
  await evaluate(cdp, `${ledger}\nwindow.__tenantSmokeLedger = {
    beginTenantAuthorization, commitTenantAuthorization, cancelTenantAuthorization,
    invalidateTenantView, logoutTenantSession, readTenantSession
  }; true`)
  await evaluate(cdp, `${lease}\nwindow.__tenantTabSmoke = createTenantBrowserTabLease({
    storage: sessionStorage, locks: navigator.locks, cryptoImpl: crypto }); true`)
}

const call = (cdp, method, args) => evaluate(cdp,
  `window.__tenantSmokeLedger.${method}(${JSON.stringify(args)})`)

function candidate (base, tenantId, accessToken) {
  return { ...base, verifiedTenant: tenantId,
    session: { accessToken, expiresAt: Date.now() + 60_000,
      identity: { issuer: base.issuer, clientId: base.clientId, tenantId } } }
}

async function run () {
  ;({ chrome, cdp: main, userDataDir: profile } = await launchChrome({ debugPort: 19489 }))
  await main.send('Page.navigate', { url: fixture })
  await install(main)
  const target = await fetch('http://127.0.0.1:19489/json/new?about:blank', { method: 'PUT' }).then(r => r.json())
  other = new CdpSession(target.webSocketDebuggerUrl)
  await other.open()
  await other.send('Page.enable')
  await other.send('Runtime.enable')
  await other.send('Page.navigate', { url: fixture })
  await install(other)

  const originalTabId = await evaluate(main, 'window.__tenantTabSmoke()')
  await evaluate(other, `sessionStorage.setItem('cyf.auth.tab.v3', ${JSON.stringify(originalTabId)})`)
  const duplicatedTabId = await evaluate(other, 'window.__tenantTabSmoke()')
  assert.notEqual(duplicatedTabId, originalTabId)
  assert.equal(await evaluate(main, 'window.__tenantTabSmoke()'), originalTabId)

  const shared = { issuer: 'https://issuer.example', origin: 'https://app.example', clientId: 'public-web' }
  const first = { ...shared, tabId: 'tab-one', state: 'first', expectedTenant: '1' }
  const cancelled = { ...shared, tabId: 'tab-two', state: 'cancelled', expectedTenant: '1' }
  await call(main, 'beginTenantAuthorization', first)
  await call(main, 'commitTenantAuthorization', candidate(first, '1', 'original'))
  await call(other, 'beginTenantAuthorization', cancelled)
  await call(other, 'invalidateTenantView', cancelled)
  assert.equal(await call(other, 'cancelTenantAuthorization', cancelled), true)
  assert.equal((await call(main, 'readTenantSession', { ...first, tenantId: '1' })).session.accessToken, 'original')

  const unknown = { ...first, state: 'unknown', expectedTenant: null }
  const directed = { ...cancelled, state: 'directed', expectedTenant: '2' }
  await call(main, 'beginTenantAuthorization', unknown)
  await call(other, 'beginTenantAuthorization', directed)
  const stale = await evaluate(main, `window.__tenantSmokeLedger.commitTenantAuthorization(
    ${JSON.stringify(candidate(unknown, '0', 'late'))}).then(() => null, error => error.code)`)
  assert.equal(stale, 'stale_auth_set')
  await call(other, 'commitTenantAuthorization', candidate(directed, '2', 'fresh'))
  assert.equal((await call(other, 'readTenantSession', { ...directed, tenantId: '2' })).session.accessToken, 'fresh')

  await other.send('Page.reload', { ignoreCache: true })
  await install(other)
  assert.equal((await call(other, 'readTenantSession', { ...directed, tenantId: '2' })).session.accessToken, 'fresh')
  await call(other, 'logoutTenantSession', { ...directed, tenantId: '2' })
  assert.equal(await call(other, 'readTenantSession', { ...directed, tenantId: '2' }), null)
  await call(main, 'logoutTenantSession', { ...first, tenantId: '1' })
  assert.equal(await call(main, 'readTenantSession', { ...first, tenantId: '1' }), null)
  console.log(JSON.stringify({ status: 'PASS', browserTabs: 2, realIndexedDb: true,
    localMockOnly: true, scenarios: ['duplicate tab ID', 'cancel', 'stale server selection', 'reload', 'logout'] }))
}

run().catch(error => { console.error(error.stack || error); process.exitCode = 1 })
  .finally(async () => { other?.close(); main?.close(); if (chrome) await stopChrome(chrome, profile) })
