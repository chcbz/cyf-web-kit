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
    prepareNewRequest: () => true, adoptExecution: value => value, selectHistoryExecution: async () => null, recoverExecution: async () => null, refreshExecution: async () => null, revokeInputs: async () => null, stopPolling: () => {}, reset: () => {}, dispose: () => {}
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

describe('formal owner input revocation', () => {
  const memory = () => { const values = new Map(); return { getItem: k => values.get(k) || null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) } }
  const setup = (storage, mock = executionMock(), task = ref('task_1'), authorized = ref(false)) => {
    mock.state.execution.value = executionRecord({ grantRevision: 1 })
    const formal = useFormalTaskExecution({ taskId: task, conversationId: ref('conversation_1'), targetAgentId: ref('agent_1'), conversationConfirmed: ref(true), executionAuthorized: authorized, identityEpoch: ref(1), identityScope: ref('owner_a'), executionFactory: () => mock.state, storage })
    return { formal, mock, task }
  }
  it('allows explicit exact execution revocation even when no ready work item exists, without creating a new execution', async () => {
    const { formal, mock } = setup(memory())
    let calls = 0
    mock.state.revokeInputs = async ({ idempotencyKey }) => {
      assert.ok(idempotencyKey.length > 0 && idempotencyKey.length <= 100)
      calls++
      const value = executionRecord({ state: 'INPUTS_REVOKED', grantRevision: 2 })
      mock.state.execution.value = value
      return value
    }
    assert.equal(formal.canRevoke.value, true)
    assert.equal(await formal.revokeOriginal({ confirmed: false }), null)
    assert.equal(calls, 0)
    assert.equal((await formal.revokeOriginal({ confirmed: true })).state, 'INPUTS_REVOKED')
    assert.equal(calls, 1)
    assert.equal(formal.canRevoke.value, false)
    assert.equal(mock.createCalls.length, 0)
    assert.match(formal.stateText.value, /不代表已取消外部调用或免除费用/)
  })
  it('unknown revoke outcome survives remount and never repeats the POST or starts a replacement', async () => {
    const storage = memory()
    const first = setup(storage)
    let calls = 0
    first.mock.state.revokeInputs = async () => { calls++; return null }
    assert.equal(await first.formal.revokeOriginal({ confirmed: true }), null)
    assert.equal(first.formal.canRevoke.value, false)
    const second = setup(storage)
    second.mock.state.revokeInputs = async () => { calls++; return null }
    assert.equal(second.formal.canRevoke.value, false)
    assert.match(second.formal.stateText.value, /原撤销请求结果待核对/)
    assert.equal(await second.formal.revokeOriginal({ confirmed: true }), null)
    assert.equal(calls, 1)
    assert.equal(second.mock.createCalls.length, 0)
    assert.match(second.formal.scopeError.value, /只查询原执行/)
  })
  it('blocks replacement after remount despite ready scope and recovers the exact original revoke target', async () => {
    const storage = memory()
    const first = setup(storage)
    first.mock.state.revokeInputs = async () => null
    await first.formal.revokeOriginal({ confirmed: true })
    const second = setup(storage, executionMock(), ref('task_1'), ref(true))
    second.mock.state.execution.value = executionRecord({ executionId: 'unrelated-history', state: 'FAILED' })
    assert.equal(await second.formal.begin({ inputs: [{ fileId: 'file_1', version: 2 }], instruction: 'no duplicate', confirmed: true }), null)
    assert.equal(second.mock.createCalls.length, 0)
    assert.match(second.formal.readyReason.value, /原撤销请求结果待核对/)
    const reads = []
    second.mock.state.recoverExecution = async id => {
      reads.push(id)
      second.mock.state.execution.value = executionRecord({ state: 'INPUTS_REVOKED', grantRevision: 2 })
      return second.mock.state.execution.value
    }
    assert.equal((await second.formal.recoverOriginalRequest()).state, 'INPUTS_REVOKED')
    assert.deepEqual(reads, ['exec_task_1'])
    assert.doesNotMatch(second.formal.readyReason.value, /原撤销请求结果待核对/)
  })
  it('refuses wrong task and missing durable storage', async () => {
    const { formal, mock, task } = setup(memory())
    let calls = 0
    mock.state.revokeInputs = async () => { calls++; return null }
    task.value = 'other-task'
    assert.equal(formal.canRevoke.value, false)
    assert.equal(await formal.revokeOriginal({ confirmed: true }), null)
    const second = setup(null)
    second.mock.state.revokeInputs = async () => { calls++; return null }
    assert.equal(await second.formal.revokeOriginal({ confirmed: true }), null)
    assert.match(second.formal.scopeError.value, /无法保存/)
    assert.equal(calls, 0)
  })
  it('exact terminal readback clears unknown revocation but unrelated history cannot', async () => {
    const storage = memory(); const { formal, mock } = setup(storage)
    mock.state.revokeInputs = async () => null
    await formal.revokeOriginal({ confirmed: true })
    mock.state.execution.value = executionRecord({ executionId: 'other-exec', state: 'INPUTS_REVOKED' })
    mock.state.execution.value = executionRecord({ grantRevision: 1 })
    assert.equal(formal.canRevoke.value, false)
    mock.state.execution.value = executionRecord({ grantRevision: 2, state: 'INPUTS_REVOKED' })
    const next = setup(storage)
    assert.equal(next.formal.canRevoke.value, true)
  })
})
