import { expect } from 'chai'
import { ref } from 'vue'
import { useHallBountyFollowup, followupProviderAcknowledgement } from '../src/composables/juyiting/useHallBountyFollowup.js'

const clone = value => JSON.parse(JSON.stringify(value))
const storage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } }
const context = { schemaVersion: 1, conversationId: 'conversation_fixture', conversationGeneration: '7', taskId: 'task_fixture', targetAgentId: 'agent_fixture', taskVersion: '0', assignmentRevision: '0', baselineGrantVersion: '1', requirementRevision: '1' }
const preview = operation => ({ schemaVersion: 3, requestId: 'request_fixture', stepId: 'step_fixture', executionIntentId: 'intent_fixture', ownerPayloadSha256: 'a'.repeat(64), instructionSha256: 'b'.repeat(64), sourceSnapshotSha256: 'c'.repeat(64), conversationGeneration: '7', taskVersion: '0', assignmentRevision: '0', grantVersion: '1', requirementRevision: '1', targetAgentId: 'agent_fixture', operation, sources: [], providerBinding: { bindingId: 'binding_fixture', bindingEpoch: '1' }, modelId: 'model_fixture', custody: 'OPERATOR_TEMPLATE', operatorPolicyRevision: 'policy-r1', pricingMode: 'UNPRICED_EXTERNAL_ACCOUNT', maxOutboundRequestAttempts: 1 })
const issued = operation => ({ schemaVersion: 2, consentId: 'consent_fixture', consentState: 'ISSUED', consentVersion: '1', operationGrantId: 'opgrant_fixture', operationGrantState: 'AUTHORIZED', operationGrantVersion: '1', taskId: 'task_fixture', conversationId: 'conversation_fixture', conversationGeneration: '7', requestId: 'request_fixture', stepId: 'step_fixture', executionIntentId: 'intent_fixture', targetAgentId: 'agent_fixture', operation, ownerPayloadSha256: 'a'.repeat(64), instructionSha256: 'b'.repeat(64), sourceSnapshotSha256: 'c'.repeat(64), providerBinding: { bindingId: 'binding_fixture', bindingEpoch: '1' }, modelId: 'model_fixture', custody: 'OPERATOR_TEMPLATE', operatorPolicyRevision: 'policy-r1', pricingMode: 'UNPRICED_EXTERNAL_ACCOUNT', maxOutboundRequestAttempts: 1, expiresAt: '2099-01-01T00:00:00Z' })
const admitted = () => ({ schemaVersion: 3, requestId: 'request_fixture', userMessageId: 'message_fixture', stepId: 'step_fixture', executionIntentId: 'intent_fixture', consentId: 'consent_fixture', operationGrantId: 'opgrant_fixture', state: 'PLANNING', stateVersion: '0', eventCursor: 'cursor_fixture', statusUrl: '/chat/requests/request_fixture', replay: false })
const response = data => ({ data: { data } })

const lane = ({ api, enabled = true, current = context, state = {} } = {}) => {
  const scope = ref('tenant\u0000client\u0000owner'); const auth = ref(1); const generation = ref(1); const selected = ref({ conversationId: current.conversationId, taskId: current.taskId, targetAgentId: current.targetAgentId })
  const followup = useHallBountyFollowup({ chatApi: api, actorScopeKey: scope, authorizationGeneration: auth,
    getContext: () => selected.value, getContextGeneration: () => generation.value, storage: state.storage || storage(), enabled: () => enabled,
    keys: { createFinalKey: () => 'final-key-0001', createIssueKey: () => 'issue-key-0001' } })
  return { followup, scope, auth, generation, selected, store: state.storage }
}

describe('Hall F1 follow-up schema-3 route', () => {
  it('runs context → preview → explicit acknowledgement → issue → final with exact fresh authority', async () => {
    const calls = []
    const api = {
      get: async path => { calls.push(['GET', path]); if (path.endsWith('/context')) return response(context); throw new Error(path) },
      create: async (path, body, options) => { calls.push(['POST', path, clone(body), options.headers['Idempotency-Key']])
        if (path.endsWith('/preview')) return response(preview('GENERATE_IMAGE'))
        if (path.endsWith('/provider-consents')) return response(issued('GENERATE_IMAGE'))
        if (path.endsWith('/interactions')) return response(admitted())
        throw new Error(path)
      }
    }
    const { followup } = lane({ api })
    expect(await followup.prepareGenerate({ content: '画一只鸟' })).to.equal(true)
    expect(followup.state.value.status).to.equal('PREVIEWED')
    expect(await followup.confirm(followupProviderAcknowledgement)).to.equal(true)
    expect(followup.state.value.status).to.equal('ADMITTED')
    expect(calls.map(call => call.slice(0, 2))).to.deep.equal([
      ['GET', '/conversations/conversation_fixture/interactions/context'],
      ['POST', '/conversations/conversation_fixture/interactions/preview'],
      ['POST', '/conversations/conversation_fixture/interactions/provider-consents'],
      ['POST', '/conversations/conversation_fixture/interactions']
    ])
    const intent = calls[1][2]
    expect(intent).to.deep.include({ schemaVersion: 3, interactionKind: 'EXECUTE', expectedConversationGeneration: '7', expectedTaskVersion: '0', expectedAssignmentRevision: '0', expectedGrantVersion: '1', requirementRevision: '1', replyTo: null, continuationOf: null })
    expect(calls[2][2].expectedPreview).to.deep.equal({ ownerPayloadSha256: 'a'.repeat(64), instructionSha256: 'b'.repeat(64), sourceSnapshotSha256: 'c'.repeat(64), modelId: 'model_fixture', custody: 'OPERATOR_TEMPLATE', operatorPolicyRevision: 'policy-r1' })
    expect(calls[3][2].authority).to.deep.equal({ consentId: 'consent_fixture', expectedConsentVersion: '1', operationGrantId: 'opgrant_fixture', expectedOperationGrantVersion: '1' })
    followup.dispose()
  })

  it('accepts the controlled descriptor grammar for slash-bearing binding and model names', async () => {
    const slashPreview = preview('GENERATE_IMAGE')
    slashPreview.providerBinding.bindingId = 'binding/fixture:one'
    slashPreview.modelId = 'model/revision-1'
    const api = { get: async () => response(context), create: async () => response(slashPreview) }
    const { followup } = lane({ api })
    expect(await followup.prepareGenerate({ content: '画一只鸟' })).to.equal(true)
    expect(followup.state.value.preview.providerBinding.bindingId).to.equal('binding/fixture:one')
    expect(followup.state.value.preview.modelId).to.equal('model/revision-1')
    followup.dispose()
  })

  it('forms EDIT only with nested assetRef and exact producer request/step', async () => {
    const writes = []
    const api = { get: async () => response(context), create: async (path, body) => { writes.push([path, clone(body)]); return response(preview('EDIT_IMAGE')) } }
    const { followup } = lane({ api })
    expect(await followup.prepareEdit({ content: '改为黄昏', assetRef: { assetId: 'asset_fixture', revision: '1' }, continuationOf: { requestId: 'producer_fixture', stepId: 'producer_step_fixture' } })).to.equal(true)
    expect(writes).to.have.length(1)
    expect(writes[0][1].inputRefs).to.deep.equal([{ kind: 'CURRENT_CONVERSATION_ASSET', assetRef: { assetId: 'asset_fixture', revision: '1' } }])
    expect(writes[0][1].continuationOf).to.deep.equal({ requestId: 'producer_fixture', stepId: 'producer_step_fixture' })
    followup.dispose()
  })

  it('fences a late context response before preview and emits zero POSTs', async () => {
    let release; const deferred = new Promise(resolve => { release = resolve }); const calls = []
    const api = { get: async path => { calls.push(['GET', path]); return response(await deferred) }, create: async path => { calls.push(['POST', path]); return response(preview('GENERATE_IMAGE')) } }
    const { followup, generation } = lane({ api })
    const pending = followup.prepareGenerate({ content: '画一只鸟' })
    generation.value++
    release(context)
    expect(await pending).to.equal(false)
    expect(calls).to.deep.equal([['GET', '/conversations/conversation_fixture/interactions/context']])
    followup.dispose()
  })
})
