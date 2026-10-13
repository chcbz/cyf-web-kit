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
  it('reads historical storage but cannot create or mutate a consent intent', () => {
    const memory = storage(); const first = intent(); const store = createPointAndStartIntentStore({ storage: memory, scope: 'tenant\u0000client\u0000owner', taskId: 'task-1' })
    expect(store.write(first).state).to.equal('UNAVAILABLE')
    const name = `cyf.juyiting.point-and-start.v1.${encodeURIComponent('tenant\u0000client\u0000owner')}.task-1`
    memory.setItem(name, JSON.stringify(first)); expect(store.read().state).to.equal('PRESENT')
    const changed = copy(first); changed.providerConsent.issueBody.providerBinding.bindingId = 'other'
    expect(store.write(changed).state).to.equal('UNAVAILABLE')
    expect(store.read().record.providerConsent.issueBody.providerBinding.bindingId).to.equal('binding-1')
  })
  it('direct issue and revoke remain retired even with explicit historical acknowledgement', async () => {
    const h = harness()
    expect(await h.flow.prepareAndIssue({ taskId: 'task-1', assignment: assignment(), providerBinding: binding(), acknowledgement: providerConsentAcknowledgement })).to.equal(false)
    expect(await h.flow.revokeOriginal('task-1')).to.equal(false)
    expect(h.calls).to.deep.equal([]); expect(h.memory.values.size).to.equal(0)
  })
  it('history GET404 and 503 never authorize exact-key issue replay', async () => {
    for (const status of [404, 503]) {
      const h = harness({ api: { get: async () => { throw Object.assign(new Error('unavailable'), { status }) }, create: async () => { throw new Error('forbidden-write') } } })
      const name = `cyf.juyiting.point-and-start.v1.${encodeURIComponent(h.scope.value)}.task-1`
      h.memory.setItem(name, JSON.stringify(intent()))
      expect(await h.flow.resumeOriginal('task-1')).to.equal(false)
      expect(h.flow.state.value.status).to.equal('UNKNOWN')
      expect(h.memory.getItem(name)).to.equal(JSON.stringify(intent()))
    }
  })
  it('reads exact historical receipts without changing their stored key/body or permitting foreign identity', async () => {
    const h = harness({ api: { get: async () => ({ data: receipt() }) } })
    const name = `cyf.juyiting.point-and-start.v1.${encodeURIComponent(h.scope.value)}.task-1`
    h.memory.setItem(name, JSON.stringify(intent())); expect(await h.flow.checkOriginal('task-1')).to.equal(true)
    expect(h.flow.state.value.receipt.state).to.equal('ISSUED'); expect(h.memory.getItem(name)).to.equal(JSON.stringify(intent()))
    h.scope.value = 'tenant\u0000client\u0000foreign'; expect(await h.flow.resumeOriginal('task-1')).to.equal(false)
  })
})
