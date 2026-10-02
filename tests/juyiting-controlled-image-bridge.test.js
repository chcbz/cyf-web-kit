import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'
import { parseControlledImageBountyCapability, capabilityOffersControlledImageConsent, loadControlledImageBountyCapability } from '../src/composables/juyiting/hallControlledImageBountyCapability.js'
import { createPointAndStartIntentStore } from '../src/composables/juyiting/hallPointAndStartIntent.js'
import { providerConsentAcknowledgement } from '../src/composables/juyiting/hallPointAndStartProviderConsent.js'
import { useHallPointAndStartControlledBridge } from '../src/composables/juyiting/useHallPointAndStartControlledBridge.js'
import { useHallPointAndStart } from '../src/composables/juyiting/useHallPointAndStart.js'
import { pointAndStartRecoveryLane } from '../src/composables/juyiting/hallPointAndStartRecoveryLane.js'
const fixture = JSON.parse(readFileSync(new URL('./fixtures/controlled-image-bridge-v1.json', import.meta.url)))
const copy = value => JSON.parse(JSON.stringify(value))
const memory = () => { const values = new Map(); return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } }
const requirement = () => ({ taskId: 'task_fixture_1', taskVersion: '6', requirementRevision: '3', title: 'fixture', description: null, contentSha256: 'a'.repeat(64), source: 'CREATE' })
const task = () => ({ id: 'task_fixture_1', taskVersion: '6', status: 'open' })
const issue = () => ({ ...copy(fixture.wire.wrapper_receipt.providerConsent), state: 'ISSUED', version: '1' })
const bound = (state = 'BOUND', version = '2') => ({ ...copy(fixture.wire.wrapper_receipt), providerConsent: { ...copy(fixture.wire.wrapper_receipt.providerConsent), state, version } })
const bridge = (overrides = {}) => {
  const storage = overrides.storage || memory(); const scope = ref('tenant\u0000client\u0000owner'); const calls = []; let adopted = 0
  const api = overrides.api || { get: async path => { calls.push(['get', path]); if (path.endsWith('/requirements/current')) return { data: requirement() }; if (path === '/tasks/task_fixture_1') return { data: task() }; if (path.endsWith('/request')) return { data: bound() }; throw new Error(path) }, create: async (path, body, options) => { calls.push(['post', path, copy(body), options.headers['Idempotency-Key']]); return { data: path.endsWith('cost-consents') ? issue() : bound() } } }
  const flow = useHallPointAndStartControlledBridge({ agentApi: api, actorScopeKey: scope, storage, keys: { createAssignmentKey: () => 'fixture_assignment_key', createIssueKey: () => 'fixture_issue_key' }, onBound: overrides.onBound || (async () => { adopted++ }) })
  flow.selectContext({ taskId: 'task_fixture_1', targetAgentId: 'agent_fixture_1' })
  return { storage, scope, calls, flow, adopted: () => adopted }
}
const start = h => h.flow.start({ task: task(), agent: { agentId: 'agent_fixture_1' }, requestedOperations: ['GENERATE_IMAGE'], initialOperation: 'GENERATE_IMAGE', inputRefs: [], providerBinding: { bindingId: 'fixture_binding', bindingEpoch: '1' }, acknowledgement: providerConsentAcknowledgement })
describe('controlled image point-and-start bridge v1', () => {
  it('accepts fixture capability only as explicit consent and identifies unavailable separately', () => {
    const c = parseControlledImageBountyCapability(copy(fixture.wire.capability)); expect(capabilityOffersControlledImageConsent(c, { id: 'task_fixture_1' }, { agentId: 'agent_fixture_1' })).to.equal(true)
    const unavailable = copy(fixture.wire.capability); unavailable.executionAuthorization = { state: 'UNAVAILABLE', paidExecutionAuthorized: false }; unavailable.newStart = { eligible: false, blockingReasons: ['SOURCE_UNAVAILABLE'] }; unavailable.providerBinding = null; unavailable.requestedOperations = []; unavailable.initialOperation = null; unavailable.controlledExecution = { state: 'UNAVAILABLE', transport: null, schemaVersion: null, supportedOperations: [] }
    expect(parseControlledImageBountyCapability(unavailable)?.controlledObservation).to.equal('UNAVAILABLE')
    const legacyAuthorization = copy(fixture.wire.capability); legacyAuthorization.authorization = legacyAuthorization.executionAuthorization; delete legacyAuthorization.executionAuthorization
    expect(parseControlledImageBountyCapability(legacyAuthorization)).to.equal(null)
    const legacySchema = copy(fixture.wire.capability); legacySchema.schemaVersion = 2
    expect(parseControlledImageBountyCapability(legacySchema)).to.equal(null)
    const v2Transport = copy(fixture.wire.capability); v2Transport.controlledExecution.transport = 'PERSONAL_WORKSPACE_CONTROLLED_IMAGE_HTTP_V2'
    expect(parseControlledImageBountyCapability(v2Transport)).to.equal(null)
    const v1ControlledSchema = copy(fixture.wire.capability); v1ControlledSchema.controlledExecution.schemaVersion = 1
    expect(parseControlledImageBountyCapability(v1ControlledSchema)).to.equal(null)
    expect(parseControlledImageBountyCapability(null)).to.equal(null)
  })
  it('performs real fake issue → durable wrapper → bridge → BOUND observation exactly once', async () => {
    const h = bridge(); expect(await start(h)).to.equal(true); expect(h.calls.map(x => x.slice(0, 2))).to.deep.equal([['get', '/tasks/task_fixture_1/requirements/current'], ['get', '/tasks/task_fixture_1'], ['post', '/tasks/task_fixture_1/point-and-start-cost-consents'], ['post', '/tasks/task_fixture_1/point-and-start-controlled-image']])
    const record = createPointAndStartIntentStore({ storage: h.storage, scope: h.scope.value, taskId: 'task_fixture_1' }).read().record
    expect(record.controlledImageBridge.wrapper).to.deep.equal({ ...copy(fixture.wire.wrapper), providerConsent: { consentId: fixture.wire.wrapper.providerConsent.consentId, expectedVersion: '1' } }); expect(record.controlledImageBridge.receipt.providerConsent.state).to.equal('BOUND'); expect(h.adopted()).to.equal(1); h.flow.dispose()
  })
  it('uses the existing read-only assignment projection and bootstrap adoption after BOUND, never /assign', async () => {
    const storage = memory(); const scope = ref('tenant\u0000client\u0000owner'); const calls = []; let attached = 0
    const projection = { schemaVersion: 1, taskId: 'task_fixture_1', targetAgentId: 'agent_fixture_1', requirementRevision: '3', assignmentRevision: '7', taskVersion: '7', grantId: 'grant_fixture_1', grantVersion: '1', grantState: 'ACTIVE', permittedOperations: ['GENERATE_IMAGE'], inputs: [], bootstrapId: 'bootstrap_fixture_1', bootstrapState: 'ADMITTED', stateVersion: '2', initialOperation: 'GENERATE_IMAGE', conversationId: '9007199254740993', initialRequestId: 'initial_fixture_1', currentAssignment: true }
    const api = { get: async path => { calls.push(['get', path]); if (path.endsWith('/requirements/current')) return { data: requirement() }; if (path.endsWith('/assignment-operation')) return { data: projection }; if (path === '/tasks/task_fixture_1') return { data: calls.filter(x => x[1] === '/tasks/task_fixture_1').length === 1 ? task() : { id: 'task_fixture_1', taskVersion: '7', status: 'assigned', assignedAgentId: 'agent_fixture_1' } }; throw new Error(path) }, create: async (path, body, options) => { calls.push(['post', path, options.headers['Idempotency-Key']]); return { data: path.endsWith('cost-consents') ? issue() : bound() } } }
    const ordinary = useHallPointAndStart({ agentApi: api, actorScopeKey: scope, storage, onAdmitted: async () => { attached++; return true } })
    const controlled = useHallPointAndStartControlledBridge({ agentApi: api, actorScopeKey: scope, storage, keys: { createAssignmentKey: () => 'fixture_assignment_key', createIssueKey: () => 'fixture_issue_key' }, onBound: async () => ordinary.checkOriginal('task_fixture_1') }); controlled.selectContext({ taskId: 'task_fixture_1', targetAgentId: 'agent_fixture_1' })
    expect(await controlled.start({ task: task(), agent: { agentId: 'agent_fixture_1' }, requestedOperations: ['GENERATE_IMAGE'], initialOperation: 'GENERATE_IMAGE', inputRefs: [], providerBinding: { bindingId: 'fixture_binding', bindingEpoch: '1' }, acknowledgement: providerConsentAcknowledgement })).to.equal(true)
    expect(attached).to.equal(1); expect(ordinary.state.value.status).to.equal('ATTACHED'); expect(calls.some(x => x[0] === 'post' && x[1].endsWith('/assign'))).to.equal(false); controlled.dispose(); ordinary.dispose()
  })
  it('continues read-only original projection from PREPARING to ADMITTED and adopts without bridge or assign replay', async () => {
    const storage = memory(); const scope = ref('tenant\u0000client\u0000owner'); const calls = []; let attached = 0; let reads = 0
    const preparing = { schemaVersion: 1, taskId: 'task_fixture_1', targetAgentId: 'agent_fixture_1', requirementRevision: '3', assignmentRevision: '7', taskVersion: '7', grantId: 'grant_fixture_1', grantVersion: '1', grantState: 'ACTIVE', permittedOperations: ['GENERATE_IMAGE'], inputs: [], bootstrapId: 'bootstrap_fixture_1', bootstrapState: 'PENDING', stateVersion: '1', initialOperation: 'GENERATE_IMAGE', conversationId: null, initialRequestId: null, currentAssignment: true }
    const admitted = { ...preparing, bootstrapState: 'ADMITTED', stateVersion: '2', conversationId: '9007199254740993', initialRequestId: 'initial_fixture_1' }
    const api = { get: async path => { calls.push(['get', path]); if (path.endsWith('/requirements/current')) return { data: requirement() }; if (path.endsWith('/assignment-operation')) return { data: reads++ === 0 ? preparing : admitted }; if (path === '/tasks/task_fixture_1') return { data: reads < 2 ? task() : { id: 'task_fixture_1', taskVersion: '7', status: 'assigned', assignedAgentId: 'agent_fixture_1' } }; throw new Error(path) }, create: async path => { calls.push(['post', path]); return { data: path.endsWith('cost-consents') ? issue() : bound() } } }
    const ordinary = useHallPointAndStart({ agentApi: api, actorScopeKey: scope, storage, onAdmitted: async () => { attached++; return true } })
    const controlled = useHallPointAndStartControlledBridge({ agentApi: api, actorScopeKey: scope, storage, keys: { createAssignmentKey: () => 'fixture_assignment_key', createIssueKey: () => 'fixture_issue_key' }, onBound: async () => ordinary.observeOriginal('task_fixture_1', cb => { queueMicrotask(cb); return null }) }); controlled.selectContext({ taskId: 'task_fixture_1', targetAgentId: 'agent_fixture_1' })
    expect(await controlled.start({ task: task(), agent: { agentId: 'agent_fixture_1' }, requestedOperations: ['GENERATE_IMAGE'], initialOperation: 'GENERATE_IMAGE', inputRefs: [], providerBinding: { bindingId: 'fixture_binding', bindingEpoch: '1' }, acknowledgement: providerConsentAcknowledgement })).to.equal(true)
    await new Promise(resolve => setTimeout(resolve, 0)); expect(ordinary.state.value.status).to.equal('ATTACHED'); expect(attached).to.equal(1); expect(calls.filter(x => x[0] === 'post' && (x[1].endsWith('/assign') || x[1].endsWith('controlled-image')))).to.have.length(1); controlled.dispose(); ordinary.dispose()
  })
  it('restores durable context for refresh and observes consumed/revoked without reissue', async () => {
    const first = bridge(); await start(first); const calls = []; const h = bridge({ storage: first.storage, api: { get: async path => { calls.push(path); return { data: bound('CONSUMED', '3') } }, create: async () => { throw new Error('no replay') } } }); h.flow.dispose()
    const fresh = useHallPointAndStartControlledBridge({ agentApi: { get: async path => { calls.push(path); return { data: bound('CONSUMED', '3') } }, create: async () => { throw new Error('no replay') } }, actorScopeKey: first.scope, storage: first.storage, onBound: async () => {} })
    const refreshed = await fresh.checkOriginal('task_fixture_1'); expect(refreshed).to.equal(true); expect(calls).to.deep.equal(['/tasks/task_fixture_1/point-and-start-controlled-image/request']); fresh.dispose(); first.flow.dispose()
  })
  it('invalidates a late authoritative read before any issue or bridge POST', async () => {
    let resolve; const h = bridge({ api: { get: async path => path.endsWith('/requirements/current') ? new Promise(done => { resolve = done }) : { data: task() }, create: async () => { throw new Error('must not post') } } })
    const pending = start(h); await Promise.resolve(); h.flow.invalidate(); resolve({ data: requirement() })
    expect(await pending).to.equal(false); expect(h.calls.filter(call => call[0] === 'post')).to.have.length(0); h.flow.dispose()
  })
  it('does not POST bridge when a deferred GET404 arrives after invalidation', async () => {
    const first = bridge(); await start(first); let reject; let posts = 0
    const next = useHallPointAndStartControlledBridge({ agentApi: { get: async () => new Promise((resolve, rejecter) => { reject = rejecter }), create: async () => { posts++; return { data: bound() } } }, actorScopeKey: first.scope, storage: first.storage, onBound: async () => {} })
    const pending = next.resumeOriginal('task_fixture_1'); await Promise.resolve(); next.invalidate(); reject(Object.assign(new Error('missing'), { status: 404 }))
    expect(await pending).to.equal(false); expect(posts).to.equal(0); next.dispose(); first.flow.dispose()
  })
  it('recovers an ACK-lost issued consent through issuer readback before its exact bridge replay', async () => {
    const storage = memory(); const scope = ref('tenant\u0000client\u0000owner'); let stage = 0; const calls = []
    const api = { get: async path => { calls.push(['get', path]); if (path.endsWith('/requirements/current')) return { data: requirement() }; if (path === '/tasks/task_fixture_1') return { data: task() }; if (path.endsWith('cost-consents/request')) return { data: issue() }; throw Object.assign(new Error('missing'), { status: 404 }) }, create: async (path, body, options) => { calls.push(['post', path, options.headers['Idempotency-Key']]); if (path.endsWith('cost-consents') && stage++ === 0) throw new Error('lost ACK'); return { data: bound() } } }
    const a = useHallPointAndStartControlledBridge({ agentApi: api, actorScopeKey: scope, storage, keys: { createAssignmentKey: () => 'fixture_assignment_key', createIssueKey: () => 'fixture_issue_key' } }); a.selectContext({ taskId: 'task_fixture_1', targetAgentId: 'agent_fixture_1' }); expect(await a.start({ task: task(), agent: { agentId: 'agent_fixture_1' }, requestedOperations: ['GENERATE_IMAGE'], initialOperation: 'GENERATE_IMAGE', inputRefs: [], providerBinding: { bindingId: 'fixture_binding', bindingEpoch: '1' }, acknowledgement: providerConsentAcknowledgement })).to.equal(false); a.dispose()
    const b = useHallPointAndStartControlledBridge({ agentApi: api, actorScopeKey: scope, storage, onBound: async () => {} }); const recovered = await b.resumeOriginal('task_fixture_1'); expect(recovered).to.equal(true); expect(calls.filter(x => x[0] === 'post' && x[1].endsWith('controlled-image'))).to.have.length(1); b.dispose()
  })
  it('routes an ACK-lost providerConsent-only shared intent to controlled check/resume, not ordinary recovery', async () => {
    const storage = memory(); const scope = ref('tenant\u0000client\u0000owner'); const calls = []; let bridgePosts = 0
    const issueBody = { schemaVersion: 1, assignmentIdempotencyKey: 'fixture_assignment_key', assignment: copy(fixture.wire.wrapper.assignment), providerBinding: { bindingId: 'fixture_binding', bindingEpoch: '1' }, acknowledgement: providerConsentAcknowledgement }
    const record = { schemaVersion: 1, taskId: 'task_fixture_1', key: 'fixture_assignment_key', body: copy(fixture.wire.wrapper.assignment), postAcknowledged: false, providerConsent: { schemaVersion: 1, issueKey: 'fixture_issue_key', issueBody, receipt: null, revoke: null } }
    expect(createPointAndStartIntentStore({ storage, scope: scope.value, taskId: 'task_fixture_1' }).write(record).state).to.equal('PRESENT')
    const api = { get: async path => { calls.push(['get', path]); if (path.endsWith('cost-consents/request')) return { data: issue() }; throw Object.assign(new Error('missing'), { status: 404 }) }, create: async path => { if (path.endsWith('controlled-image')) bridgePosts++; return { data: bound() } } }
    const flow = useHallPointAndStartControlledBridge({ agentApi: api, actorScopeKey: scope, storage, onBound: async () => {} })
    const state = createPointAndStartIntentStore({ storage, scope: scope.value, taskId: 'task_fixture_1' }).read(); expect(pointAndStartRecoveryLane(state)).to.equal('CONTROLLED')
    expect(await flow.checkOriginal('task_fixture_1')).to.equal(true); expect(bridgePosts).to.equal(0); expect(calls).to.deep.equal([['get', '/tasks/task_fixture_1/point-and-start-cost-consents/request']])
    expect(await flow.resumeOriginal('task_fixture_1')).to.equal(true); expect(bridgePosts).to.equal(1); flow.dispose()
  })
  it('GET404 only explicitly replays persisted wrapper; 503/409 do not', async () => {
    for (const status of [404, 503, 409]) { const first = bridge(); await start(first); let posts = 0; const flow = useHallPointAndStartControlledBridge({ agentApi: { get: async () => { throw Object.assign(new Error('x'), { status }) }, create: async () => { posts++; return { data: bound() } } }, actorScopeKey: first.scope, storage: first.storage, onBound: async () => {} }); expect(await flow.resumeOriginal('task_fixture_1')).to.equal(status === 404); expect(posts).to.equal(status === 404 ? 1 : 0); flow.dispose(); first.flow.dispose() }
  })
  it('treats malformed, 503 as controlled unknown and only explicit 404 undeclared', async () => {
    expect((await loadControlledImageBountyCapability({ agentApi: { get: async () => ({ data: { bad: true } }) }, taskId: 'task_fixture_1', targetAgentId: 'agent_fixture_1' })).controlledObservation).to.equal('MALFORMED')
    expect((await loadControlledImageBountyCapability({ agentApi: { get: async () => { throw Object.assign(new Error('x'), { status: 503 }) } }, taskId: 'task_fixture_1', targetAgentId: 'agent_fixture_1' })).controlledObservation).to.equal('UNKNOWN')
    expect((await loadControlledImageBountyCapability({ agentApi: { get: async () => { throw Object.assign(new Error('x'), { status: 404 }) } }, taskId: 'task_fixture_1', targetAgentId: 'agent_fixture_1' })).controlledObservation).to.equal('UNDECLARED')
  })
})
