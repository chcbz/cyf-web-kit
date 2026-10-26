import { expect } from 'chai'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { effectScope, ref } from 'vue'
import { useSkillMarket, formatSkillMoney } from '../src/composables/useSkillMarket.js'
import { parseStrictJson, decodeHttpResponse } from '../src/utils/apiEnvelope.js'
import { parseSkillManagement, skillPathSegment, skillPermissionsSha256, utf8Compare } from '../src/utils/skillManagementContract.js'
import { stopIdentityBoundWork } from '../src/utils/identityLifecycle.js'
import { fixtures, fixture, memoryStorage, locks, deferred, apiFixture } from './fixtures/skill-management/helpers.js'
const scopes = []
const make = (extra = {}) => {
  const mock = apiFixture(); const storage = memoryStorage(); const actor = ref('actor-a'); const target = ref({ agentId: 'agt_demo' }); const scope = effectScope(); scopes.push(scope)
  const market = scope.run(() => useSkillMarket({ agentApi: mock.api, enabled: true, actorScopeKey: actor, targetAgent: target, purchaseIdempotencyStorage: storage, operationLocks: locks, ...extra }))
  return { market, mock, storage, actor, target }
}
const prepareInstall = async market => {
  await market.refresh(); const row = market.items.value.find(row => row.skillKey === 'image-edit')
  market.prepare(row, 'INSTALL'); market.setApprovedPermissions(row.skillKey, row.candidate.requiredPermissions)
  await market.requestQuote(row.skillKey); return row.skillKey
}
const responseDefinitions = { SkillListResponse: 'SkillList', QuoteResponse: 'Quote', ChangeResponse: 'SkillChange', ChangeListResponse: 'ChangeList' }
const requestDefinitions = { QuoteRequest: 'QuoteRequestData', CreateChangeRequest: 'CreateChangeData', RetryRequest: 'ChangeActionData', ReconcileRequest: 'ChangeActionData' }

describe('SM-C1 locked fixtures → actual Web parser', () => {
  it('consumes original bytes with their locked SHA-256', () => {
    const source = JSON.parse(readFileSync(new URL('./fixtures/skill-management/source.json', import.meta.url)))
    for (const [suffix, field] of [['schema', 'schemaSha256'], ['examples', 'examplesSha256'], ['behavior', 'behaviorSha256']]) {
      const bytes = readFileSync(new URL(`./fixtures/skill-management/management-contract-v1.${suffix}.json`, import.meta.url))
      expect(createHash('sha256').update(bytes).digest('hex')).to.equal(source[field])
    }
    const freePosition = { ...fixture('accepted-offline-install').data, price: null, orderId: null, fundingStatus: 'NONE',
      authorizationSource: { type: 'POSITION', grantId: 'grant_1', grantRevision: '1', bindingId: '1' } }
    expect(parseSkillManagement('SkillChange', freePosition)).to.deep.equal(freePosition)
    const marketWithoutOrder = { ...freePosition }; delete marketWithoutOrder.authorizationSource
    expect(() => parseSkillManagement('SkillChange', marketWithoutOrder)).to.throw()

  })
  for (const example of fixtures.cases.filter(e => responseDefinitions[e.definition] || requestDefinitions[e.definition] || e.definition === 'HttpError')) {
    it(`${example.name}: ${example.valid ? 'accepts' : 'rejects'} complete shared wire`, () => {
      const execute = () => {
        const raw = JSON.stringify(example.value)
        if (requestDefinitions[example.definition]) {
          const request = parseStrictJson(raw, { integerTokensOnly: true })
          expect(Object.keys(request).sort()).to.deep.equal(['data', 'protocolVersion', 'requestId'])
          if (request.protocolVersion !== 1) throw new Error('protocol')
          return parseSkillManagement(requestDefinitions[example.definition], request.data)
        }
        const value = decodeHttpResponse(raw, { status: example.httpStatus || 200, requestId: example.value.requestId, responseRequestId: example.value.requestId, integerTokensOnly: true }).value
        return parseSkillManagement(responseDefinitions[example.definition], value)
      }
      if (example.definition === 'HttpError') {
        try { execute(); throw new Error('expected HTTP error') } catch (e) { expect(e.code).to.equal(example.value.code); expect(e.data).to.equal(null) }
      } else if (example.valid) expect(execute).not.to.throw()
      else expect(execute).to.throw()
    })
  }
  for (const example of fixtures.rawParserCases) it(`strict raw ${example.name}`, () => expect(() => parseStrictJson(example.raw, { integerTokensOnly: true })).to.throw())
  it('rejects unpaired Unicode and invalid resource segments, without numeric coercion', () => {
    expect(() => parseStrictJson('"\\ud800"', { integerTokensOnly: true })).to.throw()
    for (const id of ['a/b', 'a\\b', 'a?b', 'a#b', 'a\0b']) expect(() => skillPathSegment(id)).to.throw()
    expect(skillPathSegment('a%2fb')).to.equal('a%252fb')
    expect(formatSkillMoney({ amountMinor: '9223372036854775807', currency: 'SILVER' })).to.equal('9223372036854.775807 SILVER')
  })
  it('matches the approved-permissions digest vector and UTF-8 ordering', async () => {
    const vector = fixtures.digestVectors.find(v => v.domain === 'cyf.skill.permissions.v1')
    expect(await skillPermissionsSha256(vector.value)).to.equal(vector.sha256)
    expect(['\u{10000}', '\ue000'].sort(utf8Compare)).to.deep.equal(['\ue000', '\u{10000}'])
  })
})

describe('SM-C1 useSkillMarket lifecycle and exactly-once intent', () => {
  afterEach(() => { for (const scope of scopes.splice(0)) scope.stop() })
  it('keeps an accepted confirmation when background refresh starts during operation-lock acquisition', async () => {
    let onLock = () => {}
    const { market, mock } = make({ operationLocks: { request: async (_name, _options, callback) => { onLock(); return callback() } } })
    const key = await prepareInstall(market)
    const response = deferred(); let refreshing
    const originalGet = mock.api.get
    let holdNextRead = true
    mock.api.get = (path, ...args) => {
      if (path.endsWith('/skills') && holdNextRead) { holdNextRead = false; return response.promise }
      return originalGet(path, ...args)
    }
    onLock = () => { onLock = () => {}; refreshing = market.refresh() }
    try {
      const result = await market.submit(key)
      expect(result?.skillChangeId).to.equal(mock.accepted.skillChangeId)
      expect(mock.requests.filter(r => r.method === 'POST' && r.path.endsWith('/skill-changes'))).to.have.length(1)
    } finally { response.resolve(structuredClone(mock.list)); await refreshing }
  })

  it('list → explicit permissions → real quote → INSTALL at sole new write route; 202 is not success', async () => {
    const { market, mock } = make(); const key = await prepareInstall(market)
    expect(market.drafts.value[key].quote).not.to.equal(null)
    const next = await market.submit(key)
    expect(next.status).to.equal('WAITING_AGENT')
    const writes = mock.requests.filter(r => r.method === 'POST')
    expect(writes.map(r => r.path)).to.deep.equal(['/skill-orders/quotes', '/agt_demo/skill-changes'])
    expect(writes[1].data).to.deep.equal(fixture('create-install').data)
    expect(writes[1].options.headers).to.have.keys('Idempotency-Key', 'X-Request-Id')
    expect(market.items.value.find(row => row.skillKey === key).installed).to.equal(null)
  })
  it('lost creation response persists exact body/key/requestId; refresh never POSTs; explicit original replay', async () => {
    const storage = memoryStorage(); const first = make({ purchaseIdempotencyStorage: storage }); const key = await prepareInstall(first.market)
    const originalPost = first.mock.api.post
    first.mock.api.post = async (path, data, options) => { if (path.endsWith('/skill-changes')) { first.mock.requests.push({ method: 'POST', path, data, options }); throw new TypeError('offline') } return originalPost(path, data, options) }
    await first.market.submit(key)
    const original = first.market.pending.value[key]
    expect(original.accepted).to.equal(false)
    first.market.dispose()
    const restored = make({ purchaseIdempotencyStorage: storage }); await restored.market.refresh(); await restored.market.refreshChanges()
    expect(restored.mock.requests.every(r => r.method === 'GET')).to.equal(true)
    expect(restored.market.prepare(restored.mock.installRow, 'INSTALL')).to.equal(null)
    await restored.market.resumeOriginal(key)
    const replay = restored.mock.requests.find(r => r.method === 'POST')
    expect(replay.data).to.deep.equal(original.data)
    expect(replay.options.headers).to.deep.equal({ 'Idempotency-Key': original.key, 'X-Request-Id': original.requestId })
    expect(restored.market.pending.value[key].skillChangeId).to.equal('sc_install')
  })
  it('permission mutation fences late quotes; unchanged projection replacement does not clear draft', async () => {
    const { market, mock } = make(); await market.refresh(); const row = market.items.value.find(r => r.skillKey === 'image-edit')
    market.prepare(row, 'INSTALL'); market.setApprovedPermissions(row.skillKey, row.candidate.requiredPermissions)
    const wait = deferred(); const post = mock.api.post; mock.api.post = async (...args) => { await wait.promise; return post(...args) }
    const pending = market.requestQuote(row.skillKey)
    market.setApprovedPermissions(row.skillKey, [])
    wait.resolve(); await pending
    expect(market.drafts.value[row.skillKey].quote).to.equal(null)
    market.setApprovedPermissions(row.skillKey, row.candidate.requiredPermissions)
    await market.requestQuote(row.skillKey)
    const quote = market.drafts.value[row.skillKey].quote
    await market.refresh()
    expect(market.drafts.value[row.skillKey].quote).to.deep.equal(quote)
    mock.list.agentVersion = '13'; await market.refresh()
    expect(market.drafts.value[row.skillKey].quote).to.equal(null)
  })
  it('identity/Agent switch aborts and rejects late responses, logout does not restart requests', async () => {
    const { market, mock, actor, target } = make(); const wait = deferred(); const get = mock.api.get
    mock.api.get = async (...args) => { await wait.promise; return get(...args) }
    const pending = market.refresh(); actor.value = 'actor-b'; target.value = { agentId: 'other' }
    wait.resolve(); await pending
    expect(market.catalog.value).to.equal(null)
    target.value = { agentId: 'agt_demo' }; await market.refresh()
    const before = mock.requests.length; stopIdentityBoundWork()
    expect(market.catalog.value).to.equal(null); expect(market.available.value).to.equal(false)
    await market.refresh(); expect(mock.requests.length).to.equal(before)
  })
  it('duplicate submit/cross-tab storage readback cannot create a second purchase', async () => {
    const { market, mock, storage } = make(); const key = await prepareInstall(market)
    const wait = deferred(); const post = mock.api.post; mock.api.post = async (...args) => { await wait.promise; return post(...args) }
    const one = market.submit(key); const two = market.submit(key); wait.resolve(); await Promise.all([one, two])
    expect(mock.requests.filter(r => r.path === '/agt_demo/skill-changes')).to.have.length(1)
    const second = make({ purchaseIdempotencyStorage: storage }); await second.market.refresh()
    expect(second.market.prepare(second.mock.installRow, 'INSTALL')).to.equal(null)
  })
  it('FAILED_RETRYABLE uses original change ID + expectedChangeRevision, never quote/purchase again', async () => {
    const { market, mock } = make(); mock.list.items = [mock.list.items[0]]
    mock.list = fixture('skill-list').data
    const row = mock.list.items[0]; const failed = fixture('retryable-upgrade').data
    row.latestChange = failed; row.allowedActions = ['VIEW', 'RETRY']; mock.accepted = { ...failed, status: 'PREPARING', retryAllowed: false, attempt: 2, skillRevision: '9', changeRevision: '4' }
    await market.refresh(); const next = await market.retry(row.skillKey)
    expect(next.skillChangeId).to.equal(failed.skillChangeId)
    expect(mock.requests.filter(r => r.method === 'POST').map(r => r.path)).to.deep.equal(['/agt_demo/skill-changes/sc_demo/retry'])
    expect(mock.requests.find(r => r.method === 'POST').data).to.deep.equal({ expectedChangeRevision: failed.changeRevision })
  })
  it('unknown only reconciles the original change; stale revisions cannot regress newer receipts', async () => {
    const { market, mock } = make(); const row = mock.list.items[0]
    row.latestChange = { ...fixture('accepted-upgrade').data, status: 'RECOVERY_REQUIRED', changeRevision: '4', reasonCode: 'RECEIPT_UNKNOWN' }; row.allowedActions = ['VIEW', 'RECONCILE']
    mock.accepted = { ...row.latestChange, status: 'VERIFYING', changeRevision: '5', reasonCode: null }
    await market.refresh(); await market.reconcile(row.skillKey)
    expect(market.latestChange(market.items.value[0]).changeRevision).to.equal('5')
    await market.refresh()
    expect(market.latestChange(market.items.value[0]).status).to.equal('VERIFYING')
    expect(mock.requests.filter(r => r.method === 'POST').map(r => r.path)).to.deep.equal(['/agt_demo/skill-changes/sc_demo/reconcile'])
  })
  it('expired quote refuses fresh submission; storage failure sends no write', async () => {
    let now = Date.now(); const { market, mock } = make({ now: () => now }); const key = await prepareInstall(market)
    now += 120000; await market.submit(key)
    expect(mock.requests.filter(r => r.path.endsWith('/skill-changes') && r.method === 'POST')).to.have.length(0)
    const denied = make({ purchaseIdempotencyStorage: { get length () { throw new Error('storage denied') } } }); await prepareInstall(denied.market); await denied.market.submit('image-edit')
    expect(denied.mock.requests.filter(r => r.method === 'POST' && r.path.endsWith('/skill-changes'))).to.have.length(0)
  })
  it('quote transport uncertainty retains its original requestId/key/body without changing approved permissions', async () => {
    const { market, mock } = make(); await market.refresh(); const row = market.items.value[0]
    market.prepare(row, 'INSTALL'); market.setApprovedPermissions(row.skillKey, row.candidate.requiredPermissions)
    const post = mock.api.post; let first = true; const seen = []
    mock.api.post = async (...args) => { seen.push(args); if (first) { first = false; throw new TypeError('network') } return post(...args) }
    await market.requestQuote(row.skillKey); await market.requestQuote(row.skillKey)
    expect(seen[1][1]).to.deep.equal(seen[0][1]); expect(seen[1][2].headers).to.deep.equal(seen[0][2].headers)
    expect(market.drafts.value[row.skillKey].quote).not.to.equal(null)
  })
  it('same Agent new object reference does not cancel an outstanding write', async () => {
    const { market, mock, target } = make(); const key = await prepareInstall(market); const wait = deferred(); const post = mock.api.post
    mock.api.post = async (...args) => { await wait.promise; return post(...args) }
    const submitted = market.submit(key); await Promise.resolve(); await Promise.resolve()
    target.value = { agentId: 'agt_demo', name: 'projection supplemented', version: '12' }
    wait.resolve(); const next = await submitted
    expect(next.status).to.equal('WAITING_AGENT'); expect(market.pending.value[key].accepted).to.equal(true)
  })
  it('unknown 503/404/409 creation results retain their original key and never imply a refund or new purchase', async () => {
    for (const [status, code] of [[503, 'SKILL_STATE_UNAVAILABLE'], [404, 'RESOURCE_NOT_FOUND'], [409, 'SKILL_CHANGE_PENDING']]) {
      const { market, mock } = make(); const key = await prepareInstall(market); const post = mock.api.post
      mock.api.post = async (...args) => { if (args[0].endsWith('/skill-changes')) throw Object.assign(new Error(code), { status, code, failureClass: 'http' }); return post(...args) }
      await market.submit(key); const original = JSON.parse(JSON.stringify(market.pending.value[key]))
      await market.refresh(); await market.submit(key)
      expect(market.pending.value[key]).to.deep.equal(original)
      expect(market.prepare(market.items.value[0], 'INSTALL')).to.equal(null)
      expect(market.queryUnknown.value[key]).not.to.equal('')
    }
  })
  it('definite insufficient funds rejects the intent without claiming success, installed facts, or automatic retry', async () => {
    const { market, mock } = make(); const key = await prepareInstall(market); const post = mock.api.post
    mock.api.post = async (...args) => { if (args[0].endsWith('/skill-changes')) throw Object.assign(new Error('资金不足'), { code: 'INSUFFICIENT_FUNDS', status: 422, failureClass: 'http' }); return post(...args) }
    await market.submit(key)
    expect(market.pending.value[key]).to.equal(undefined); expect(market.drafts.value[key].quote).to.equal(null)
    expect(market.error.value).to.equal('资金不足'); expect(market.items.value[0].installed).to.equal(null)
  })
  it('REFUNDED/CAPTURED facts do not permit retry, and UNKNOWN never acquires retry permission', async () => {
    for (const fundingStatus of ['REFUNDED', 'CAPTURED']) {
      const { market, mock } = make(); mock.list = fixture('skill-list').data
      const failed = { ...fixture('retryable-upgrade').data, status: 'FAILED_FINAL', retryAllowed: false, fundingStatus }
      mock.list.items[0].latestChange = failed; mock.list.items[0].allowedActions = ['VIEW']
      await market.refresh(); await market.retry('image-edit')
      expect(mock.requests.filter(r => r.method === 'POST')).to.have.length(0)
      expect(market.latestChange(market.items.value[0]).fundingStatus).to.equal(fundingStatus)
      expect(() => parseSkillManagement('SkillChange', { ...failed, status: 'RECOVERY_REQUIRED', retryAllowed: true })).to.throw()
    }
  })
  it('recovery storage write-readback and unsupported locks block before any business write', async () => {
    const storage = memoryStorage(); const { market, mock } = make({ purchaseIdempotencyStorage: storage }); const key = await prepareInstall(market)
    storage.setItem = () => {}; await market.submit(key)
    expect(mock.requests.filter(r => r.path.endsWith('/skill-changes') && r.method === 'POST')).to.have.length(0)
    expect(market.storageError.value).to.include('无法可靠保存')
    const noLocks = make({ operationLocks: null }); const other = await prepareInstall(noLocks.market); await noLocks.market.submit(other)
    expect(noLocks.mock.requests.filter(r => r.path.endsWith('/skill-changes') && r.method === 'POST')).to.have.length(0)
    expect(noLocks.market.error.value).to.include('跨标签')
  })
  it('malformed state queries are not an empty success and retain last known server facts', async () => {
    const { market, mock } = make(); await market.refresh(); const facts = market.catalog.value
    mock.api.get = async () => ({ items: [] }); await market.refresh()
    expect(market.catalog.value).to.deep.equal(facts); expect(market.error.value).to.include('PROTOCOL_INVALID_SKILL_MANAGEMENT')
  })
  it('receipts for another agent or a different target are rejected with original recovery intent retained', async () => {
    for (const mutation of [{ agentId: 'other' }, { target: { ...fixture('accepted-offline-install').data.target, productVersionId: 'wrong' } }]) {
      const { market, mock } = make(); const key = await prepareInstall(market); mock.accepted = { ...mock.accepted, ...mutation }
      await market.submit(key)
      expect(market.pending.value[key].accepted).to.equal(false)
      expect(market.changes.value).to.have.length(0)
    }
  })

  it('uncertain quote survives reload, restores only by explicit original replay, and never auto-installs', async () => {
    const storage = memoryStorage(); const first = make({ purchaseIdempotencyStorage: storage }); await first.market.refresh()
    const row = first.market.items.value[0]; first.market.prepare(row, 'INSTALL'); first.market.setApprovedPermissions(row.skillKey, row.candidate.requiredPermissions)
    first.mock.api.post = async () => { throw new TypeError('lost quote reply') }
    await first.market.requestQuote(row.skillKey)
    const record = JSON.parse(JSON.stringify(first.market.pending.value[row.skillKey])); expect(record.kind).to.equal('QUOTE')
    first.market.dispose()
    const next = make({ purchaseIdempotencyStorage: storage }); await next.market.refresh()
    expect(next.market.drafts.value).to.deep.equal({}); expect(next.mock.requests.every(r => r.method === 'GET')).to.equal(true)
    const quote = await next.market.resumeOriginal(row.skillKey)
    expect(quote.quoteId).to.equal(fixture('quote-install-response').data.quoteId); expect(next.mock.requests.filter(r => r.method === 'POST')).to.have.length(1)
    const replay = next.mock.requests.find(r => r.method === 'POST')
    expect(replay.data).to.deep.equal(record.data); expect(replay.options.headers).to.deep.equal({ 'Idempotency-Key': record.key, 'X-Request-Id': record.requestId })
    expect(next.market.pending.value[row.skillKey]).to.equal(undefined)
  })
  it('explicitly abandoning a quote never cancels an unknown submitted installation', async () => {
    const { market, mock } = make(); const key = await prepareInstall(market); const post = mock.api.post
    mock.api.post = async (...args) => { if (args[0].endsWith('/skill-changes')) throw new TypeError('lost'); return post(...args) }
    await market.submit(key); const record = JSON.stringify(market.pending.value[key])
    await market.abandonQuote(key)
    expect(JSON.stringify(market.pending.value[key])).to.equal(record)
    expect(market.drafts.value[key].quote).not.to.equal(null)
  })
  it('actor-isolated journals are never replayed by another actor, even for the same Agent', async () => {
    const storage = memoryStorage(); const first = make({ purchaseIdempotencyStorage: storage }); const key = await prepareInstall(first.market)
    first.mock.api.post = async () => { throw new TypeError('lost') }; await first.market.submit(key)
    const other = make({ purchaseIdempotencyStorage: storage, actorScopeKey: 'different-actor' }); await other.market.refresh(); await other.market.resumeOriginal(key)
    expect(other.market.pending.value).to.deep.equal({}); expect(other.mock.requests.filter(r => r.method === 'POST')).to.have.length(0)
    expect(storage.length).to.equal(1)
  })
  it('a genuinely changed actor rejects late write responses and keeps the old actor recovery record', async () => {
    const { market, mock, actor, storage } = make(); const key = await prepareInstall(market); const wait = deferred(); const post = mock.api.post
    let writeOptions
    mock.api.post = async (...args) => { writeOptions = args[2]; await wait.promise; return post(...args) }
    const result = market.submit(key)
    for (let i = 0; i < 10 && !writeOptions; i++) await Promise.resolve()
    actor.value = 'actor-b'; expect(writeOptions.signal.aborted).to.equal(true); wait.resolve(); await result
    expect(market.changes.value).to.have.length(0); expect(market.pending.value).to.deep.equal({}); expect(storage.length).to.equal(1)
  })
  it('covered and paid upgrades bind their real quote, preserve disabled expectation and never synthesize prices', async () => {
    for (const paid of [false, true]) {
      const { market, mock } = make(); mock.list = fixture('skill-list').data; const row = mock.list.items[0]
      row.desiredEnabled = false; row.admissionEnabled = false; row.upgradeEligibility = paid ? 'PAID' : 'COVERED'
      const price = { amountMinor: paid ? '1234567890123456' : '0', currency: 'SILVER' }
      mock.accepted = { ...fixture('accepted-upgrade').data, desiredEnabled: false, price, orderId: paid ? 'order-paid' : null, fundingStatus: paid ? 'HELD' : 'NONE' }
      const post = mock.api.post
      mock.api.post = async (...args) => args[0].endsWith('/quotes') ? { ...fixture('quote-upgrade-response').data, price, coverage: paid ? 'PURCHASE' : 'ENTITLEMENT', entitlementId: paid ? null : 'se_demo', expiresAt: Date.now() + 60000 } : post(...args)
      await market.refresh(); market.prepare(market.items.value[0], 'UPGRADE'); market.setApprovedPermissions(row.skillKey, row.candidate.requiredPermissions); await market.requestQuote(row.skillKey)
      const result = await market.submit(row.skillKey)
      expect(result.desiredEnabled).to.equal(false); expect(result.price).to.deep.equal(price)
      const write = mock.requests.find(r => r.method === 'POST'); expect(write.data.expectedPrice).to.deep.equal(price); expect(write.data.sourceSkillInstallationId).to.equal('si_old')
    }
  })
  it('unknown retry response restores exact original retry key/body/ID instead of a new attempt or purchase', async () => {
    const storage = memoryStorage(); const first = make({ purchaseIdempotencyStorage: storage }); first.mock.list = fixture('skill-list').data
    const failed = fixture('retryable-upgrade').data
    first.mock.list.items[0].latestChange = failed; first.mock.list.items[0].allowedActions = ['VIEW', 'RETRY']
    await first.market.refresh(); first.mock.api.post = async () => { throw new TypeError('lost retry') }; await first.market.retry('image-edit')
    const original = JSON.parse(JSON.stringify(first.market.pending.value['image-edit'])); first.market.dispose()
    const next = make({ purchaseIdempotencyStorage: storage }); next.mock.accepted = { ...failed, status: 'PREPARING', retryAllowed: false, attempt: 2, changeRevision: '4', skillRevision: '9' }
    await next.market.resumeOriginal('image-edit')
    const replay = next.mock.requests.find(r => r.method === 'POST')
    expect(replay.path).to.equal('/agt_demo/skill-changes/sc_demo/retry'); expect(replay.data).to.deep.equal(original.data)
    expect(replay.options.headers).to.deep.equal({ 'Idempotency-Key': original.key, 'X-Request-Id': original.requestId })
    expect(next.market.changes.value[0].attempt).to.equal(2)
  })
  it('terminal receipts and immutable payment/target facts cannot be regressed by newer or stale reads', async () => {
    const { market, mock } = make(); mock.list = fixture('skill-list').data
    const done = { ...fixture('accepted-upgrade').data, status: 'SUCCEEDED', runtimeSynced: true, changeRevision: '8' }
    mock.list.items[0].latestChange = done; await market.refresh()
    mock.accepted = { ...done, status: 'PREPARING', runtimeSynced: false, changeRevision: '9' }; await market.checkOriginal('image-edit')
    expect(market.changes.value[0].status).to.equal('SUCCEEDED'); expect(market.queryUnknown.value['image-edit']).not.to.equal('')
    mock.accepted = { ...done, orderId: 'another-order', changeRevision: '10' }; await market.checkOriginal('image-edit')
    expect(market.changes.value[0].orderId).to.equal(null)
    mock.accepted = { ...done, changeRevision: '7', runtimeSynced: true }; await market.checkOriginal('image-edit')
    expect(market.changes.value[0].changeRevision).to.equal('8')
  })

  it('actual composable consumers exercise all seven routes from the byte-locked behavior contract', async () => {
    const behavior = JSON.parse(readFileSync(new URL('./fixtures/skill-management/management-contract-v1.behavior.json', import.meta.url)))
    const first = make(); const key = await prepareInstall(first.market); await first.market.submit(key); await first.market.refreshChanges(); await first.market.checkOriginal(key)
    const failed = make(); failed.mock.list = fixture('skill-list').data; const row = failed.mock.list.items[0]
    row.latestChange = fixture('retryable-upgrade').data; row.allowedActions = ['VIEW', 'RETRY']
    failed.mock.accepted = { ...row.latestChange, status: 'PREPARING', retryAllowed: false, attempt: 2, changeRevision: '4', skillRevision: '9' }
    await failed.market.refresh(); await failed.market.retry(row.skillKey)
    row.allowedActions = ['VIEW', 'RECONCILE']; await failed.market.refresh(); await failed.market.reconcile(row.skillKey)
    const requests = [...first.mock.requests, ...failed.mock.requests]
    for (const route of behavior.routes) {
      const pattern = new RegExp('^' + route.path.replace(/\{[^}]+\}/g, '[^/]+') + '$')
      const actual = requests.filter(r => r.method === route.method && pattern.test('/agent' + r.path))
      expect(actual.length, route.id).to.be.greaterThan(0)
      for (const request of actual) {
        if (route.idempotencyKeyRequired) {
          expect(request.options.headers['Idempotency-Key']).to.be.a('string')
          expect(() => parseSkillManagement(requestDefinitions[route.requestDefinition], request.data)).not.to.throw()
        } else expect(request.data).to.equal(undefined)
      }
    }
    // This exercises the Web slice only, not the API/DB/Runtime effects of C01–C22.
    expect(behavior.cases).to.have.length(22)
  })
  it('complete history remains ordered and visible without truncating at an old market page size', async () => {
    const { market, mock } = make(); const data = fixture('disabled-api-admission-closed').data
    const records = Array.from({ length: 75 }, (_, i) => ({ ...data, skillChangeId: 'change-' + i, skillRevision: String(i + 1), createdAt: data.createdAt + i }))
    const get = mock.api.get
    mock.api.get = async (...args) => args[0].endsWith('/skill-changes') ? { agentId: 'agt_demo', items: records } : get(...args)
    await market.refreshChanges()
    expect(market.changes.value).to.have.length(75); expect(market.changes.value[0].skillChangeId).to.equal('change-74')
    expect(market.changes.value.at(-1).skillChangeId).to.equal('change-0')
  })
  it('two independent same-actor consumers hold one exclusive lock across persisted intent and dispatch', async () => {
    const storage = memoryStorage(); let tail = Promise.resolve(); let active = 0; let maximum = 0
    const serial = { async request (_name, options, fn) { const before = tail; const release = deferred(); tail = release.promise; await before; if (options.signal.aborted) { release.resolve(); return null } active++; maximum = Math.max(maximum, active); try { return await fn() } finally { active--; release.resolve() } } }
    const first = make({ purchaseIdempotencyStorage: storage, operationLocks: serial }); const second = make({ purchaseIdempotencyStorage: storage, operationLocks: serial })
    const key = await prepareInstall(first.market); await prepareInstall(second.market)
    await Promise.all([first.market.submit(key), second.market.submit(key)])
    expect(maximum).to.equal(1)
    const writes = [...first.mock.requests, ...second.mock.requests].filter(r => r.method === 'POST' && r.path.endsWith('/skill-changes'))
    expect(writes).to.have.length(1)
  })

  it('closing/reopening observation fences prior continuations and duplicate starts without cancelling writes', async () => {
    const { market, mock } = make(); const wait = deferred(); const get = mock.api.get; let reads = 0
    mock.api.get = async (...args) => { if (++reads === 1) await wait.promise; return get(...args) }
    market.setPolling(true); market.setPolling(true)
    expect(reads).to.equal(1)
    market.setPolling(false); market.setPolling(true)
    await new Promise(resolve => setTimeout(resolve, 5)); wait.resolve(); await new Promise(resolve => setTimeout(resolve, 5))
    expect(mock.requests.filter(r => r.path.endsWith('/skill-changes'))).to.have.length(1)
    market.setPolling(false)
    expect(mock.requests.filter(r => r.method === 'POST')).to.have.length(0)
  })
  it('server object-member reordering is not a preparation/quote identity change', async () => {
    const { market, mock } = make(); const key = await prepareInstall(market); const quote = market.drafts.value[key].quote
    mock.list.items[0].candidate = Object.fromEntries(Object.entries(mock.list.items[0].candidate).reverse())
    await market.refresh()
    expect(market.drafts.value[key].quote).to.deep.equal(quote)
  })

  it('stable actor journal survives authentication-generation fencing and a later browser remount', async () => {
    const storage = memoryStorage(); const generation = ref('actor-a:5')
    const first = make({ purchaseIdempotencyStorage: storage, identityKey: generation }); const key = await prepareInstall(first.market)
    first.mock.api.post = async () => { throw new TypeError('lost write') }; await first.market.submit(key)
    const original = JSON.parse(JSON.stringify(first.market.pending.value[key]))
    generation.value = 'actor-a:6'
    expect(first.market.drafts.value).to.deep.equal({}); expect(first.market.pending.value[key]).to.deep.equal(original)
    first.market.dispose()
    const next = make({ purchaseIdempotencyStorage: storage, identityKey: 'actor-a:0' }); await next.market.refresh()
    expect(next.market.pending.value[key]).to.deep.equal(original)
    await next.market.resumeOriginal(key)
    const write = next.mock.requests.find(r => r.method === 'POST')
    expect(write.options.headers['Idempotency-Key']).to.equal(original.key); expect(write.data).to.deep.equal(original.data)
  })

})
