import { expect } from 'chai'
import { ref } from 'vue'
import { createPointAndStartIntentStore, pointAndStartBody } from '../src/composables/juyiting/hallPointAndStartIntent.js'
import { providerConsentAcknowledgement, providerConsentExtension, providerConsentIssueBody, providerConsentReceipt } from '../src/composables/juyiting/hallPointAndStartProviderConsent.js'
import { useHallPointAndStartCostConsent } from '../src/composables/juyiting/useHallPointAndStartCostConsent.js'
import { useHallPointAndStart } from '../src/composables/juyiting/useHallPointAndStart.js'

const copy = value => JSON.parse(JSON.stringify(value))
const storage = () => { const values = new Map(); return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } }
const assignment = (overrides = {}) => pointAndStartBody({ agentId: 'agent-1', taskVersion: '6', requirementRevision: '3', requestedOperations: ['GENERATE_IMAGE'], initialOperation: 'GENERATE_IMAGE', ...overrides })
const binding = () => ({ bindingId: 'binding-1', bindingEpoch: '9007199254740993' })
const receipt = (overrides = {}) => ({ schemaVersion: 1, consentId: 'consent-1', taskId: 'task-1', targetAgentId: 'agent-1', state: 'ISSUED', version: '1', assignmentIdempotencyKey: 'assignment-key', assignmentBaseHash: 'a'.repeat(64), inputSnapshotDigest: 'b'.repeat(64), providerBinding: binding(), modelId: 'model-1', custody: 'LOCAL_PROFILE', operatorPolicyRevision: 'policy-1', pricingMode: 'UNPRICED_EXTERNAL_ACCOUNT', maxOutboundRequestAttempts: 1, expiresAt: '9007199254740993', ...overrides })
const intent = (overrides = {}) => { const body = assignment(); const issueBody = providerConsentIssueBody({ assignmentIdempotencyKey: 'assignment-key', assignment: body, providerBinding: binding(), acknowledgement: providerConsentAcknowledgement }); return { schemaVersion: 1, taskId: 'task-1', key: 'assignment-key', body, postAcknowledged: false, providerConsent: { schemaVersion: 1, issueKey: 'issue-key', issueBody, receipt: null, revoke: null }, ...overrides } }
const keyFactory = () => ({ createAssignmentKey: () => 'assignment-key', createIssueKey: () => 'issue-key', createRevokeKey: () => 'revoke-key' })
const instances = []
const harness = (overrides = {}) => {
  const memory = overrides.storage || storage(); const scope = overrides.scope || ref('tenant\u0000client\u0000owner'); const calls = []
  let issued = false; let revoked = false
  const api = {
    get: async (path, query, options) => { calls.push(['get', path, options?.headers?.['Idempotency-Key']]); if (!issued) throw Object.assign(new Error('missing'), { status: 404, code: 'PROVIDER_CONSENT_NOT_FOUND' }); return { data: receipt({ state: revoked ? 'REVOKED' : 'ISSUED', version: revoked ? '2' : '1' }) } },
    create: async (path, body, options) => { calls.push(['post', path, copy(body), options.headers['Idempotency-Key']]); if (path.endsWith('/revoke')) { revoked = true; return { data: receipt({ state: 'REVOKED', version: '2' }) } } issued = true; return { data: receipt() } }, ...overrides.api
  }
  const flow = useHallPointAndStartCostConsent({ agentApi: api, actorScopeKey: scope, storage: memory, keys: keyFactory() })
  instances.push(flow)
  return { flow, memory, scope, calls, seed: value => createPointAndStartIntentStore({ storage: memory, scope: scope.value, taskId: 'task-1' }).write(value || intent()) }
}

describe('frozen provider-consent intent and receipt contract', () => {
  afterEach(() => instances.splice(0).forEach(flow => flow.dispose()))
  it('only accepts the frozen one-image issue shape and at most 16 exact references', () => {
    const refs = Array.from({ length: 16 }, (_, i) => ({ fileId: `f-${i}`, version: 1, purpose: 'REFERENCE' }))
    expect(providerConsentIssueBody({ assignmentIdempotencyKey: 'assignment-key', assignment: assignment({ inputRefs: refs }), providerBinding: binding(), acknowledgement: providerConsentAcknowledgement })?.assignment.inputRefs).to.deep.equal(assignment({ inputRefs: refs }).inputRefs)
    expect(providerConsentIssueBody({ assignmentIdempotencyKey: 'assignment-key', assignment: assignment({ inputRefs: [...refs, { fileId: 'too-many', version: 1, purpose: 'REFERENCE' }] }), providerBinding: binding(), acknowledgement: providerConsentAcknowledgement })).to.equal(null)
    expect(providerConsentIssueBody({ assignmentIdempotencyKey: 'assignment-key', assignment: assignment({ requestedOperations: ['GENERATE_IMAGE', 'EDIT_IMAGE'] }), providerBinding: binding(), acknowledgement: providerConsentAcknowledgement })).to.equal(null)
  })
  for (const [name, mutate] of [
    ['wrong target', value => { value.targetAgentId = 'foreign' }], ['wrong assignment key', value => { value.assignmentIdempotencyKey = 'foreign' }],
    ['wrong hash', value => { value.assignmentBaseHash = 'bad' }], ['wrong epoch', value => { value.providerBinding.bindingEpoch = '2' }],
    ['extra authority', value => { value.providerBinding.authority = 'forbidden' }], ['unknown state', value => { value.state = 'PAID' }]
  ]) it(`rejects ${name} receipts`, () => { const value = receipt(); mutate(value); expect(providerConsentReceipt(value, intent())).to.equal(null) })
  it('accepts each frozen core receipt state without treating it as paid/newStart', () => {
    for (const state of ['ISSUED', 'BOUND', 'RESERVED', 'CONSUMED', 'REVOKED', 'EXPIRED']) {
      expect(providerConsentReceipt(receipt({ state }), intent())?.state).to.equal(state)
    }
  })
  it('allows only the API readonly same-version active-to-expired projection', () => {
    const issued = receipt(); const record = intent({ providerConsent: { ...intent().providerConsent, receipt: issued } })
    const expired = receipt({ state: 'EXPIRED' })
    expect(providerConsentReceipt(expired, record, issued)?.state).to.equal('EXPIRED')
    expect(providerConsentReceipt(receipt({ state: 'EXPIRED', assignmentBaseHash: 'c'.repeat(64) }), record, issued)).to.equal(null)
    const expiredRecord = intent({ providerConsent: { ...intent().providerConsent, receipt: expired } })
    expect(providerConsentReceipt(receipt({ state: 'BOUND', version: '2' }), expiredRecord, expired)).to.equal(null)
    expect(providerConsentReceipt(receipt({ state: 'REVOKED', version: '2' }), expiredRecord, expired)?.state).to.equal('REVOKED')
    expect(providerConsentReceipt(receipt({ state: 'CONSUMED', version: '2' }), expiredRecord, expired)?.state).to.equal('CONSUMED')
    expect(providerConsentReceipt(receipt({ state: 'EXPIRED', version: '2' }), expiredRecord, expired)?.state).to.equal('EXPIRED')
  })
  it('uses BigInt-safe monotonic receipt versions and immutable facts', () => {
    const initial = receipt({ version: '9007199254740993', state: 'BOUND' }); const record = intent({ providerConsent: { ...intent().providerConsent, receipt: initial } })
    expect(providerConsentReceipt(receipt({ version: '9007199254740994', state: 'RESERVED' }), record, initial)?.version).to.equal('9007199254740994')
    expect(providerConsentReceipt(receipt({ version: '9007199254740992' }), record, initial)).to.equal(null)
    expect(providerConsentReceipt(receipt({ operatorPolicyRevision: 'other', version: '2', state: 'BOUND' }), record, initial)).to.equal(null)
  })
  it('rejects issue body acknowledgement and assignment-key/body substitutions', () => {
    const base = intent()
    const wrongAck = copy(base.providerConsent); wrongAck.issueBody.acknowledgement = 'PAID_OK'
    const wrongKey = copy(base.providerConsent); wrongKey.issueBody.assignmentIdempotencyKey = 'foreign-key'
    const wrongBody = copy(base.providerConsent); wrongBody.issueBody.assignment.agentId = 'foreign'
    expect(providerConsentExtension(wrongAck, base)).to.equal(null)
    expect(providerConsentExtension(wrongKey, base)).to.equal(null)
    expect(providerConsentExtension(wrongBody, base)).to.equal(null)
  })
  it('keeps provider extension immutable in the one shared original-intent store', () => {
    const memory = storage(); const first = intent(); const store = createPointAndStartIntentStore({ storage: memory, scope: 'tenant\u0000client\u0000owner', taskId: 'task-1' })
    expect(store.write(first).state).to.equal('PRESENT')
    const changed = copy(first); changed.providerConsent.issueBody.providerBinding.bindingId = 'other'
    expect(store.write(changed).state).to.equal('CORRUPT')
    expect(store.read().record.providerConsent.issueBody.providerBinding.bindingId).to.equal('binding-1')
    expect(providerConsentExtension(first.providerConsent, first)).not.to.equal(null)
  })
  it('requires explicit acknowledgement with zero storage or POST side effects when absent', async () => {
    const h = harness()
    expect(await h.flow.prepareAndIssue({ taskId: 'task-1', assignment: assignment(), providerBinding: binding() })).to.equal(false)
    expect(h.calls).to.deep.equal([])
    expect(h.memory.values.size).to.equal(0)
  })
  it('persists/readbacks assignment and issue keys/bodies before the one issuer POST', async () => {
    const h = harness()
    expect(await h.flow.prepareAndIssue({ taskId: 'task-1', assignment: assignment(), providerBinding: binding(), acknowledgement: providerConsentAcknowledgement })).to.equal(true)
    const saved = createPointAndStartIntentStore({ storage: h.memory, scope: h.scope.value, taskId: 'task-1' }).read().record
    expect(h.calls[0]).to.deep.equal(['post', '/tasks/task-1/point-and-start-cost-consents', saved.providerConsent.issueBody, 'issue-key'])
    expect(saved.key).to.equal('assignment-key'); expect(saved.body).to.deep.equal(assignment()); expect(saved.providerConsent.receipt.state).to.equal('ISSUED')
  })
  it('fails closed on corrupt or unreadable shared storage without an issuer POST', async () => {
    const corrupt = harness(); corrupt.seed(); const name = [...corrupt.memory.values.keys()][0]; corrupt.memory.setItem(name, '{bad')
    expect(await corrupt.flow.prepareAndIssue({ taskId: 'task-1', assignment: assignment(), providerBinding: binding(), acknowledgement: providerConsentAcknowledgement })).to.equal(false)
    expect(corrupt.calls).to.deep.equal([])
    const unavailable = harness({ storage: { getItem: () => null, setItem: () => {} } })
    expect(await unavailable.flow.prepareAndIssue({ taskId: 'task-1', assignment: assignment(), providerBinding: binding(), acknowledgement: providerConsentAcknowledgement })).to.equal(false)
    expect(unavailable.calls).to.deep.equal([])
  })
  it('never overwrites an ordinary original intent with a consent extension', async () => {
    const h = harness(); const ordinary = intent(); delete ordinary.providerConsent; expect(h.seed(ordinary).state).to.equal('PRESENT')
    expect(await h.flow.prepareAndIssue({ taskId: 'task-1', assignment: assignment(), providerBinding: binding(), acknowledgement: providerConsentAcknowledgement })).to.equal(false)
    expect(h.calls).to.deep.equal([]); expect(h.flow.state.value.status).to.equal('ORIGINAL_PENDING')
  })
  it('check only GETs, while explicit resume GET404 replays the same issue body/key', async () => {
    const h = harness(); h.seed(); expect(await h.flow.checkOriginal('task-1')).to.equal(false); expect(h.calls.map(call => call[0])).to.deep.equal(['get'])
    expect(await h.flow.resumeOriginal('task-1')).to.equal(true)
    expect(h.calls.map(call => call[0])).to.deep.equal(['get', 'get', 'post'])
    expect(h.calls[2].slice(2)).to.deep.equal([intent().providerConsent.issueBody, 'issue-key'])
  })
  it('does not replay on network/503/conflict reads and keeps original issue facts', async () => {
    for (const status of [undefined, 503, 409]) {
      const h = harness({ api: { get: async () => { throw Object.assign(new Error('unavailable'), { status }) } } }); h.seed()
      expect(await h.flow.resumeOriginal('task-1')).to.equal(false); expect(h.calls.filter(call => call[0] === 'post')).to.have.length(0)
    }
  })
  it('reads before revoke, persists one revoke key/version, and reuses it after an unknown revoke', async () => {
    let revokeCalls = 0
    const h = harness({ api: { get: async (path, query, options) => { h.calls.push(['get', path, options?.headers?.['Idempotency-Key']]); return { data: receipt() } }, create: async (path, body, options) => { h.calls.push(['post', path, copy(body), options.headers['Idempotency-Key']]); if (path.endsWith('/revoke') && revokeCalls++ === 0) throw new Error('lost ACK'); return { data: receipt({ state: 'REVOKED', version: '2' }) } } } })
    h.seed(intent({ providerConsent: { ...intent().providerConsent, receipt: receipt() } }))
    expect(await h.flow.revokeOriginal('task-1')).to.equal(false)
    const saved = createPointAndStartIntentStore({ storage: h.memory, scope: h.scope.value, taskId: 'task-1' }).read().record
    expect(saved.providerConsent.revoke).to.deep.equal({ key: 'revoke-key', expectedVersion: '1' })
    expect(await h.flow.revokeOriginal('task-1')).to.equal(true)
    expect(h.calls.filter(call => call[1].endsWith('/revoke')).map(call => call[3])).to.deep.equal(['revoke-key', 'revoke-key'])
  })
  it('permits an expired receipt to revoke with its original persisted version', async () => {
    const h = harness({ api: {
      get: async (path, query, options) => { h.calls.push(['get', path, options?.headers?.['Idempotency-Key']]); return { data: receipt({ state: 'EXPIRED' }) } },
      create: async (path, body, options) => { h.calls.push(['post', path, copy(body), options.headers['Idempotency-Key']]); return { data: receipt({ state: 'REVOKED', version: '2' }) } }
    } })
    h.seed(intent({ providerConsent: { ...intent().providerConsent, receipt: receipt({ state: 'EXPIRED' }) } }))
    expect(await h.flow.revokeOriginal('task-1')).to.equal(true)
    expect(h.calls.find(call => call[1].endsWith('/revoke')).slice(2)).to.deep.equal([{ expectedVersion: '1' }, 'revoke-key'])
  })
  it('fences same-identity task and target navigation without deleting the original intent', async () => {
    let resolve; const h = harness({ api: { create: async () => new Promise(done => { resolve = done }) } })
    expect(h.flow.selectContext({ taskId: 'task-1', targetAgentId: 'agent-1' })).to.equal(true)
    const pending = h.flow.prepareAndIssue({ taskId: 'task-1', assignment: assignment(), providerBinding: binding(), acknowledgement: providerConsentAcknowledgement })
    await Promise.resolve()
    expect(h.flow.selectContext({ taskId: 'task-2', targetAgentId: 'agent-2' })).to.equal(true)
    resolve({ data: receipt() })
    expect(await pending).to.equal(false)
    expect(h.flow.state.value.status).to.equal('IDLE')
    expect(h.flow.context.value).to.deep.equal({ taskId: 'task-2', targetAgentId: 'agent-2' })
    expect(createPointAndStartIntentStore({ storage: h.memory, scope: h.scope.value, taskId: 'task-1' }).read().record.providerConsent.receipt).to.equal(null)
  })
  it('fences a late receipt after actor scope changes', async () => {
    let resolve; const scope = ref('tenant\u0000client\u0000owner'); const h = harness({ scope, api: { create: async () => new Promise(done => { resolve = done }) } })
    const pending = h.flow.prepareAndIssue({ taskId: 'task-1', assignment: assignment(), providerBinding: binding(), acknowledgement: providerConsentAcknowledgement }); await Promise.resolve(); scope.value = 'tenant\u0000client\u0000other'; resolve({ data: receipt() })
    expect(await pending).to.equal(false); expect(h.flow.state.value.status).to.equal('IDLE')
  })
  it('does not allow the ordinary point flow to reach /assign when a cost extension exists', async () => {
    const memory = storage(); const scope = ref('tenant\u0000client\u0000owner'); const shared = createPointAndStartIntentStore({ storage: memory, scope: scope.value, taskId: 'task-1' }); expect(shared.write(intent()).state).to.equal('PRESENT')
    const calls = []; const ordinary = useHallPointAndStart({ agentApi: { get: async () => { calls.push('get') }, create: async () => { calls.push('assign') } }, actorScopeKey: scope, storage: memory, isSupported: () => true, canAssign: () => true })
    instances.push(ordinary)
    expect(await ordinary.start({ task: { id: 'task-1' }, agent: { agentId: 'agent-1' }, requestedOperations: ['GENERATE_IMAGE'], initialOperation: 'GENERATE_IMAGE' })).to.equal(false)
    expect(await ordinary.resumeOriginal('task-1')).to.equal(false); expect(calls).to.deep.equal([]); expect(ordinary.state.value.status).to.equal('COST_CONSENT_PENDING')
  })
})
