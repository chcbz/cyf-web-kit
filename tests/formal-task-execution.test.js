import { strict as assert } from 'node:assert'
import { describe, it } from 'mocha'
import { ref } from 'vue'
import { FORMAL_TASK_OUTPUT_MIME_TYPE, useFormalTaskExecution } from '../src/composables/useFormalTaskExecution.js'

const executionRecord = (overrides = {}) => ({
  executionId: 'exec_task_1', taskId: 'task_1', runId: 'run_1', conversationId: 'conversation_1', targetAgentId: 'agent_1',
  state: 'QUEUED', executionMode: 'TASK', businessTaskId: 'task_1', workItemId: 'work_1', workItemState: 'running', grantRevision: 1, outputContentMimeType: FORMAL_TASK_OUTPUT_MIME_TYPE,
  inputs: [{ inputRef: 'input_1', fileId: 'file_1', version: 2 }], runtimeCommand: null, ...overrides
})

const executionMock = () => {
  const createCalls = []
  const state = {
    agents: ref([{ agentId: 'agent_1', name: '吴用' }]), rosterState: ref('ready'), rosterError: ref(''), selectedAgentId: ref(''),
    allowedMimeTypes: ref([FORMAL_TASK_OUTPUT_MIME_TYPE]), inputMimeTypes: ref(['application/pdf']), capabilityState: ref('ready'), capabilityError: ref(''), generationEnabled: ref(true),
    execution: ref(null), receipt: ref(null), executionState: ref('idle'), error: ref(''), completionNotice: ref(''), history: ref([]), historyState: ref('empty'), historyError: ref(''), historyNextCursor: ref(null), unresolvedIntent: ref(null), pending: ref(false),
    loadCapabilities: async () => null, loadAgents: async () => null, loadHistory: async () => [], recover: async () => [],
    selectAgent: agentId => { if (agentId !== 'agent_1') return false; state.selectedAgentId.value = agentId; return true },
    create: async payload => {
      createCalls.push(payload)
      const value = executionRecord({ inputs: payload.inputs.map((input, index) => ({ inputRef: `input_${index}`, fileId: input.fileId, version: Number(input.version) })) })
      state.execution.value = value
      state.receipt.value = value
      return value
    },
    prepareNewRequest: () => true, adoptExecution: value => value, selectHistoryExecution: async () => null, refreshExecution: async () => null, revokeInputs: async () => null, stopPolling: () => {}, reset: () => {}, dispose: () => {}
  }
  return { state, createCalls }
}

describe('formal TASK execution boundary', () => {
  it('refuses incomplete formal scope and sends only exact TASK/PDF inputs after explicit confirmation', async () => {
    const taskId = ref('task_1')
    const conversationId = ref('')
    const targetAgentId = ref('agent_1')
    const conversationConfirmed = ref(false)
    const executionAuthorized = ref(false)
    const mock = executionMock()
    const formal = useFormalTaskExecution({ taskId, conversationId, targetAgentId, conversationConfirmed, executionAuthorized, identityEpoch: ref(1), identityScope: ref('owner_a'), executionFactory: () => mock.state })

    assert.match(formal.readyReason.value, /conversationId/)
    const reasoned = useFormalTaskExecution({ taskId, conversationId, targetAgentId, conversationConfirmed, executionAuthorized, executionAuthorizationReason: ref('请先进入本榜文议事；不会使用其他榜文会话。'), identityEpoch: ref(1), identityScope: ref('owner_a'), executionFactory: () => executionMock().state })
    assert.match(reasoned.readyReason.value, /不会使用其他榜文会话/)
    assert.equal(await formal.begin({ inputs: [{ fileId: 'file_1', version: 2 }], instruction: '请制作正式 PDF', confirmed: true }), null)
    assert.equal(mock.createCalls.length, 0)

    conversationId.value = 'conversation_1'
    conversationConfirmed.value = true
    executionAuthorized.value = true
    await formal.refreshReadiness()
    assert.equal(await formal.begin({ inputs: [{ fileId: 'file_1', version: 2 }], instruction: '请制作正式 PDF', confirmed: false }), null)
    assert.equal(mock.createCalls.length, 0)
    // A corrected confirmation/input must not remain blocked by the prior recoverable error.
    assert.equal(await formal.begin({ inputs: [{ fileId: 'file_1', version: 2 }, { fileId: 'file_1', version: 3 }], instruction: '请制作正式 PDF', confirmed: true }), null)
    assert.equal(mock.createCalls.length, 0)

    const result = await formal.begin({ inputs: [{ fileId: 'file_1', version: 2 }], instruction: '请制作正式 PDF', confirmed: true })
    assert.equal(result?.executionId, 'exec_task_1')
    assert.deepEqual(mock.createCalls, [{
      taskId: 'task_1', conversationId: 'conversation_1',
      inputs: [{ fileId: 'file_1', version: 2 }], instruction: '请制作正式 PDF', outputContentMimeType: 'application/pdf'
    }])
    assert.equal(formal.activeExecution.value?.taskId, 'task_1')
    assert.match(formal.stateText.value, /不表示 Provider 已开始/)
  })

  it('does not display a recovered execution that differs from the confirmed formal scope', async () => {
    const mock = executionMock()
    mock.state.execution.value = executionRecord({ taskId: 'private_task', conversationId: null })
    mock.state.refreshExecution = async () => mock.state.execution.value
    const formal = useFormalTaskExecution({
      taskId: ref('task_1'), conversationId: ref('conversation_1'), targetAgentId: ref('agent_1'), conversationConfirmed: ref(true), executionAuthorized: ref(true),
      identityEpoch: ref(1), identityScope: ref('owner_a'), executionFactory: () => mock.state
    })

    assert.equal(await formal.recoverOriginalRequest(), null)
    assert.equal(formal.activeExecution.value, null)
    assert.match(formal.scopeError.value, /不一致/)

    for (const mismatch of [{ executionMode: 'PRIVATE' }, { businessTaskId: 'other-task' }, { workItemId: null }]) {
      mock.state.execution.value = executionRecord(mismatch)
      assert.equal(await formal.recoverOriginalRequest(), null)
      assert.equal(formal.activeExecution.value, null)
    }
  })
})
