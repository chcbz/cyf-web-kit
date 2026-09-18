import { strict as assert } from 'node:assert'
import { describe, it } from 'mocha'
import { ref } from 'vue'
import { usePersonalWorkspaceExecution } from '../src/composables/usePersonalWorkspaceExecution.js'

const executionView = (overrides = {}) => ({
  executionId: 'exec_1', taskId: 'task_1', runId: 'run_1', conversationId: null,
  targetAgentId: 'agent_1', state: 'QUEUED', grantRevision: 1,
  outputContentMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  inputs: [{ inputRef: 'input_1', fileId: 'file_1', version: 2 }], runtimeCommand: null, ...overrides
})

const timers = () => {
  const scheduled = []
  return {
    scheduled,
    setTimeout: callback => { scheduled.push(callback); return scheduled.length },
    clearTimeout: () => {}
  }
}

describe('personal workspace execution adapter', () => {
  it('uses the real roster, submits one explicit file version, polls it, and asks the user to refresh only after completion', async () => {
    const calls = []
    const timerApi = timers()
    let reads = 0
    const api = { execute: async options => {
      calls.push(options)
      if (options.url === '/roster') return { data: { data: { items: [{ agentId: 'agent_1', name: '已有 Agent', status: 'online' }] } } }
      if (options.url === '/personal-workspace/executions/capabilities') return { data: { allowedMimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], generationEnabled: true } }
      if (options.method === 'POST' && options.url === '/personal-workspace/executions') return { data: executionView() }
      reads += 1
      return { data: executionView({ state: reads === 1 ? 'QUEUED' : 'OUTPUT_COMMITTED' }) }
    } }
    const adapter = usePersonalWorkspaceExecution({ api, identityEpoch: ref('owner-a'), timerApi })

    await adapter.loadAgents()
    await adapter.loadCapabilities()
    assert.equal(adapter.selectAgent('agent_1'), true)
    const created = await adapter.create({ fileId: 'file_1', version: '2', instruction: '保留标题并修改正文', outputContentMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    await Promise.resolve()

    assert.equal(created.executionId, 'exec_1')
    assert.equal(calls[0].url, '/roster')
    assert.deepEqual(calls[0].data, { pageNum: 1, pageSize: 100 })
    assert.equal(calls[1].url, '/personal-workspace/executions/capabilities')
    assert.equal(calls[2].url, '/personal-workspace/executions')
    assert.deepEqual(calls[2].data, {
      conversationId: null, targetAgentId: 'agent_1', taskId: null, instruction: '保留标题并修改正文', outputContentMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', inputs: [{ fileId: 'file_1', version: '2' }]
    })
    assert.ok(calls[2].headers['Idempotency-Key'])
    assert.equal(calls[3].url, '/personal-workspace/executions/exec_1')
    assert.equal(timerApi.scheduled.length, 1)

    timerApi.scheduled[0]()
    await Promise.resolve()
    await Promise.resolve()
    assert.equal(adapter.execution.value.state, 'OUTPUT_COMMITTED')
    assert.match(adapter.completionNotice.value, /刷新文件列表领取成果/)
    assert.match(adapter.completionNotice.value, /文件可用性以本次服务端回执和下载结果为准/)
    adapter.dispose()
  })

  it('sends the current grant revision when requesting revocation and never reports a local revoke as success', async () => {
    const calls = []
    const api = { execute: async options => {
      calls.push(options)
      if (options.url === '/roster') return { data: { items: [{ agentId: 'agent_1', name: '已有 Agent' }] } }
      if (options.url === '/personal-workspace/executions/capabilities') return { data: { allowedMimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], generationEnabled: true } }
      if (options.url.endsWith('/revoke-inputs')) return { data: executionView({ state: 'INPUTS_REVOKED', grantRevision: 2 }) }
      return { data: executionView() }
    } }
    const adapter = usePersonalWorkspaceExecution({ api, identityEpoch: ref('owner-a'), timerApi: { setTimeout: () => null, clearTimeout: () => {} } })
    await adapter.loadAgents()
    await adapter.loadCapabilities()
    adapter.selectAgent('agent_1')
    await adapter.create({ fileId: 'file_1', version: '2', instruction: '处理文件', outputContentMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    await adapter.revokeInputs()

    const revoke = calls.find(call => call.url.endsWith('/revoke-inputs'))
    assert.deepEqual(revoke.data, { expectedGrantRevision: 1 })
    assert.ok(revoke.headers['Idempotency-Key'])
    assert.equal(adapter.execution.value.grantRevision, 2)
    assert.equal(adapter.execution.value.state, 'INPUTS_REVOKED')
    adapter.dispose()
  })
})
