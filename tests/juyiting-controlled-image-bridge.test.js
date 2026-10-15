import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'
import { useHallPointAndStartControlledBridge } from '../src/composables/juyiting/useHallPointAndStartControlledBridge.js'
import { parseControlledImageBountyCapability, capabilityOffersControlledImageConsent } from '../src/composables/juyiting/hallControlledImageBountyCapability.js'
import { createPointAndStartIntentStore } from '../src/composables/juyiting/hallPointAndStartIntent.js'
import { providerConsentIssueBody, providerConsentAcknowledgement } from '../src/composables/juyiting/hallPointAndStartProviderConsent.js'
const fixture = JSON.parse(readFileSync(new URL('./fixtures/controlled-image-bridge-v1.json', import.meta.url)))
const copy = value => JSON.parse(JSON.stringify(value))
const scope = 'tenant\u0000client\u0000owner'
const memory = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } }
const seed = (storage, wrapper = true) => {
  const assignment = copy(fixture.wire.wrapper.assignment)
  const issueBody = providerConsentIssueBody({ assignmentIdempotencyKey: 'fixture_assignment_key', assignment,
    providerBinding: { bindingId: 'fixture_binding', bindingEpoch: '1' }, acknowledgement: providerConsentAcknowledgement })
  const record = { schemaVersion: 1, taskId: 'task_fixture_1', key: 'fixture_assignment_key', body: assignment, postAcknowledged: false,
    providerConsent: { schemaVersion: 1, issueKey: 'fixture_issue_key', issueBody, receipt: { ...copy(fixture.wire.wrapper_receipt.providerConsent), state: "ISSUED", version: "1" }, revoke: null } }
  if (wrapper) record.controlledImageBridge = { schemaVersion: 1, wrapper: copy(fixture.wire.wrapper), receipt: null }
  storage.setItem(`cyf.juyiting.point-and-start.v1.${encodeURIComponent(scope)}.${encodeURIComponent(record.taskId)}`, JSON.stringify(record))
  expect(createPointAndStartIntentStore({ storage, scope, taskId: record.taskId }).read().state).to.equal('PRESENT')
  return record
}
describe('retired controlled image bridge: history GET only', () => {
  it('validates historical capability audit independently from retired writers', () => {
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

  it('direct start cannot create consent, assignment, key or image request', async () => {
    const calls = []; const storage = memory(); const flow = useHallPointAndStartControlledBridge({ actorScopeKey: ref(scope), storage,
      agentApi: { get: async path => calls.push(path), create: async path => calls.push(path) } })
    try { expect(await flow.start({ task: { id: 'task_fixture_1' }, agent: { agentId: 'agent_fixture_1' }, acknowledgement: providerConsentAcknowledgement })).to.equal(false)
      expect(flow.state.value.status).to.equal('RETIRED'); expect(calls).to.deep.equal([])
      expect(createPointAndStartIntentStore({ storage, scope, taskId: 'task_fixture_1' }).read().state).to.equal('ABSENT')
    } finally { flow.dispose() }
  })
  it('explicit resume on historical GET404 never reissues either retired POST', async () => {
    for (const wrapper of [false, true]) {
      const storage = memory(); seed(storage, wrapper); const calls = []
      const flow = useHallPointAndStartControlledBridge({ actorScopeKey: ref(scope), storage, agentApi: {
        get: async path => { calls.push(['GET', path]); throw Object.assign(new Error('gone'), { status: 404 }) },
        create: async path => { calls.push(['POST', path]); throw new Error('must not write') } } })
      try { expect(await flow.resumeOriginal('task_fixture_1')).to.equal(false); expect(calls).to.have.length(1); expect(calls[0][0]).to.equal('GET') }
      finally { flow.dispose() }
    }
  })
  it('retains exact bound history and rejects a foreign receipt without writes', async () => {
    for (const foreign of [false, true]) {
      const storage = memory(); seed(storage); const calls = []; const receipt = copy(fixture.wire.wrapper_receipt)
      if (foreign) receipt.taskId = 'foreign'
      const flow = useHallPointAndStartControlledBridge({ actorScopeKey: ref(scope), storage, agentApi: {
        get: async path => { calls.push(['GET', path]); return (receipt) }, create: async path => calls.push(['POST', path]) } })
      try { expect(await flow.checkOriginal('task_fixture_1')).to.equal(!foreign); expect(calls).to.deep.equal([['GET', '/tasks/task_fixture_1/point-and-start-controlled-image/request']]) }
      finally { flow.dispose() }
    }
  })
})
