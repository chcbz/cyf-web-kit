import { expect } from 'chai'
import { ref } from 'vue'
import { useHallBountyFollowup, followupProviderAcknowledgement } from '../src/composables/juyiting/useHallBountyFollowup.js'

const storage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } }
const response = data => ({ data: { data } })
const context = { schemaVersion: 1, conversationId: 'conversation_fixture', conversationGeneration: '7', taskId: 'task_fixture', targetAgentId: 'agent_fixture', taskVersion: '0', assignmentRevision: '0', baselineGrantVersion: '1', requirementRevision: '1' }
const preview = { schemaVersion: 3, requestId: 'request_fixture', stepId: 'step_fixture', executionIntentId: 'intent_fixture', ownerPayloadSha256: 'a'.repeat(64), instructionSha256: 'b'.repeat(64), sourceSnapshotSha256: 'c'.repeat(64), conversationGeneration: '7', taskVersion: '0', assignmentRevision: '0', grantVersion: '1', requirementRevision: '1', targetAgentId: 'agent_fixture', operation: 'GENERATE_IMAGE', sources: [], providerBinding: { bindingId: 'binding_fixture', bindingEpoch: '1' }, modelId: 'model_fixture', custody: 'OPERATOR_TEMPLATE', operatorPolicyRevision: 'policy-r1', pricingMode: 'UNPRICED_EXTERNAL_ACCOUNT', maxOutboundRequestAttempts: 1 }
const issued = { schemaVersion: 2, consentId: 'consent_fixture', consentState: 'ISSUED', consentVersion: '1', operationGrantId: 'opgrant_fixture', operationGrantState: 'AUTHORIZED', operationGrantVersion: '1', taskId: 'task_fixture', conversationId: 'conversation_fixture', conversationGeneration: '7', requestId: 'request_fixture', stepId: 'step_fixture', executionIntentId: 'intent_fixture', targetAgentId: 'agent_fixture', operation: 'GENERATE_IMAGE', ownerPayloadSha256: 'a'.repeat(64), instructionSha256: 'b'.repeat(64), sourceSnapshotSha256: 'c'.repeat(64), providerBinding: { bindingId: 'binding_fixture', bindingEpoch: '1' }, modelId: 'model_fixture', custody: 'OPERATOR_TEMPLATE', operatorPolicyRevision: 'policy-r1', pricingMode: 'UNPRICED_EXTERNAL_ACCOUNT', maxOutboundRequestAttempts: 1, expiresAt: '2099-01-01T00:00:00Z' }
const admitted = { schemaVersion: 3, requestId: 'request_fixture', userMessageId: 'message_fixture', stepId: 'step_fixture', executionIntentId: 'intent_fixture', consentId: 'consent_fixture', operationGrantId: 'opgrant_fixture', state: 'PLANNING', stateVersion: '0', eventCursor: 'cursor_fixture', statusUrl: '/chat/requests/request_fixture', replay: false }
const createLane = (api, cache) => {
  const scope = ref('tenant\u0000client\u0000owner'); const auth = ref(1); const generation = ref(1); const current = ref({ conversationId: 'conversation_fixture', taskId: 'task_fixture', targetAgentId: 'agent_fixture' })
  return useHallBountyFollowup({ chatApi: api, actorScopeKey: scope, authorizationGeneration: auth, getContext: () => current.value, getContextGeneration: () => generation.value, storage: cache, enabled: () => true, keys: { createFinalKey: () => 'final-key-0001', createIssueKey: () => 'issue-key-0001' } })
}

describe('Hall F1 original-key recovery', () => {
  it('recovers an ACK-lost final only through issue/final GETs and never POSTs', async () => {
    const cache = storage(); const seedApi = { get: async () => response(context), create: async path => path.endsWith('/preview') ? response(preview) : path.endsWith('/provider-consents') ? response(issued) : (() => { throw new TypeError('lost final ACK') })() }
    const seeded = createLane(seedApi, cache)
    expect(await seeded.prepareGenerate({ content: '画一只鸟' })).to.equal(true)
    expect(await seeded.confirm(followupProviderAcknowledgement)).to.equal(false)
    const finalKey = seeded.state.value.record.finalKey
    seeded.dispose()
    const calls = []; const recoveryApi = { get: async (path, _body, options) => { calls.push([path, options.headers['Idempotency-Key']]); if (path.endsWith('/request')) return response(admitted); return response(issued) }, create: async () => { throw new Error('must not POST during recovery') } }
    const recovered = createLane(recoveryApi, cache)
    expect(await recovered.checkOriginal(finalKey)).to.equal(true)
    expect(calls).to.deep.equal([['/conversations/conversation_fixture/interactions/request', finalKey]])
    recovered.dispose()
  })

  it('treats 404 original-key recovery as unknown with zero POST and no fresh key', async () => {
    const cache = storage(); const seedApi = { get: async () => response(context), create: async path => response(path.endsWith('/preview') ? preview : issued) }
    const seeded = createLane(seedApi, cache)
    expect(await seeded.prepareGenerate({ content: '画一只鸟' })).to.equal(true)
    const finalKey = seeded.state.value.record.finalKey
    seeded.dispose()
    const calls = []; const api = { get: async path => { calls.push(path); throw Object.assign(new Error('not found'), { status: 404 }) }, create: async () => { throw new Error('must not POST') } }
    const recovered = createLane(api, cache)
    expect(await recovered.checkOriginal(finalKey)).to.equal(false)
    expect(calls).to.deep.equal(['/conversations/conversation_fixture/interactions/provider-consents/request'])
    expect(recovered.state.value.status).to.equal('UNKNOWN')
    recovered.dispose()
  })
})
