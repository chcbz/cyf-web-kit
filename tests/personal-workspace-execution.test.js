import { strict as assert } from 'node:assert'
import { describe, it } from 'mocha'
import { ref } from 'vue'
import { usePersonalWorkspaceExecution } from '../src/composables/usePersonalWorkspaceExecution.js'

const flushAsync = () => new Promise(resolve => globalThis.setImmediate(resolve))
const deferred = () => { let resolve; const promise = new Promise(res => { resolve = res }); return { promise, resolve } }

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
  it('uses the real roster, submits explicit pinned file versions, polls it, and asks the user to refresh only after completion', async () => {
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

  it('allows multiple distinct pinned materials for a cross-format delivery without fabricating a result', async () => {
    const calls = []
    const api = { execute: async options => {
      calls.push(options)
      if (options.url === '/roster') return { data: { items: [{ agentId: 'agent_1', name: '已有 Agent' }] } }
      if (options.url === '/personal-workspace/executions/capabilities') return { data: { allowedMimeTypes: ['application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'], generationEnabled: true } }
      return { data: executionView({ outputContentMimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', inputs: [{ inputRef: 'input_1', fileId: 'sheet_1', version: 2 }, { inputRef: 'input_2', fileId: 'brief_1', version: 1 }] }) }
    } }
    const adapter = usePersonalWorkspaceExecution({ api, identityEpoch: ref('owner-a'), timerApi: { setTimeout: () => null, clearTimeout: () => {} } })
    await adapter.loadAgents()
    await adapter.loadCapabilities()
    adapter.selectAgent('agent_1')
    await adapter.create({
      inputs: [{ fileId: 'sheet_1', version: '2' }, { fileId: 'brief_1', version: '1' }],
      instruction: '根据 Excel 和 PDF 制作项目介绍 PPT',
      outputContentMimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    })

    const create = calls.find(call => call.url === '/personal-workspace/executions')
    assert.deepEqual(create.data.inputs, [{ fileId: 'sheet_1', version: '2' }, { fileId: 'brief_1', version: '1' }])
    assert.equal(create.data.outputContentMimeType, 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    adapter.dispose()
  })

  it('keeps a configured PPT output separate from six supported source material formats', async () => {
    const api = { execute: async options => {
      if (options.url === '/personal-workspace/executions/capabilities') return { data: {
        allowedMimeTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
        inputMimeTypes: [
          'image/jpeg', 'image/png', 'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        ], generationEnabled: true
      } }
      return { data: { items: [] } }
    } }
    const adapter = usePersonalWorkspaceExecution({ api, identityEpoch: ref('owner-a') })
    await adapter.loadCapabilities()
    assert.deepEqual(adapter.allowedMimeTypes.value, ['application/vnd.openxmlformats-officedocument.presentationml.presentation'])
    assert.deepEqual(adapter.inputMimeTypes.value, [
      'image/jpeg', 'image/png', 'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ])
    adapter.dispose()
  })

  it('stops polling and renders the server-controlled terminal failure without fabricating a delivery', async () => {
    const timerApi = timers()
    let reads = 0
    const api = { execute: async options => {
      if (options.url === '/roster') return { data: { items: [{ agentId: 'agent_1', name: '已有 Agent' }] } }
      if (options.url === '/personal-workspace/executions/capabilities') return { data: { allowedMimeTypes: ['image/png'], generationEnabled: true } }
      if (options.method === 'POST') return { data: executionView({ outputContentMimeType: 'image/png', inputs: [] }) }
      reads += 1
      return { data: reads === 1
        ? executionView({ outputContentMimeType: 'image/png', inputs: [] })
        : executionView({ outputContentMimeType: 'image/png', inputs: [], state: 'FAILED', failureCode: 'AGENT_DELIVERY_FAILED', failureMessage: 'Agent 未能完成本次交付，请调整需求后重新创建执行。' }) }
    } }
    const adapter = usePersonalWorkspaceExecution({ api, identityEpoch: ref('owner-a'), timerApi })
    await adapter.loadAgents()
    await adapter.loadCapabilities()
    adapter.selectAgent('agent_1')
    await adapter.create({ instruction: '生成一张海报', outputContentMimeType: 'image/png' })
    await flushAsync()
    assert.equal(timerApi.scheduled.length, 1)
    timerApi.scheduled[0]()
    await flushAsync()

    assert.equal(adapter.execution.value.state, 'FAILED')
    assert.equal(adapter.execution.value.failureCode, 'AGENT_DELIVERY_FAILED')
    assert.equal(adapter.error.value, 'Agent 未能完成本次交付，请调整需求后重新创建执行。')
    assert.equal(timerApi.scheduled.length, 1)
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

const memoryStorage = () => {
  const values = new Map()
  return { getItem: key => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) }
}

const readyAdapter = async (api, options = {}) => {
  const adapter = usePersonalWorkspaceExecution({ api, identityEpoch: ref('owner-a'), storage: memoryStorage(), timerApi: { setTimeout: () => null, clearTimeout: () => {} }, ...options })
  await adapter.loadAgents(); await adapter.loadCapabilities(); adapter.selectAgent('agent_1')
  return adapter
}

describe('personal workspace execution receipt and recovery', () => {
  it('programmatically accepts only one rapid submission and keeps the accepted queued receipt', async () => {
    const posted = deferred(); let posts = 0
    const adapter = await readyAdapter({ execute: async options => {
      if (options.url === '/roster') return { data: { items: [{ agentId: 'agent_1', name: '林冲' }] } }
      if (options.url.endsWith('/capabilities')) return { data: { allowedMimeTypes: ['image/png'], generationEnabled: true } }
      if (options.method === 'POST') { posts += 1; return posted.promise }
      return { data: executionView({ outputContentMimeType: 'image/png', inputs: [] }) }
    } })
    const first = adapter.create({ instruction: '生成海报', outputContentMimeType: 'image/png' })
    const second = adapter.create({ instruction: '生成海报', outputContentMimeType: 'image/png' })
    assert.equal(await second, null)
    assert.equal(posts, 1)
    posted.resolve({ data: executionView({ outputContentMimeType: 'image/png', inputs: [] }) })
    await first
    assert.equal(adapter.receipt.value.state, 'QUEUED')
    assert.equal(adapter.pending.value, true)
    adapter.dispose()
  })

  it('reconciles an ambiguous post through its original key without a duplicate post, and keeps 404 honest', async () => {
    const calls = []
    const adapter = await readyAdapter({ execute: async options => {
      calls.push(options)
      if (options.url === '/roster') return { data: { items: [{ agentId: 'agent_1', name: '林冲' }] } }
      if (options.url.endsWith('/capabilities')) return { data: { allowedMimeTypes: ['image/png'], generationEnabled: true } }
      if (options.method === 'POST') throw Object.assign(new Error('network lost'), { status: 503 })
      if (options.url.endsWith('/request')) throw Object.assign(new Error('not found'), { status: 404, code: 'EXECUTION_NOT_FOUND' })
      throw new Error(`unexpected ${options.url}`)
    } })
    assert.equal(await adapter.create({ instruction: '生成海报', outputContentMimeType: 'image/png' }), null)
    assert.equal(calls.filter(call => call.method === 'POST' && call.url === '/personal-workspace/executions').length, 1)
    assert.equal(calls.filter(call => call.url.endsWith('/request')).length, 1)
    assert.equal(adapter.executionState.value, 'unknown')
    assert.match(adapter.error.value, /仍可能稍后被服务端确认/)
    assert.equal(await adapter.create({ instruction: '生成海报', outputContentMimeType: 'image/png' }), null)
    assert.equal(calls.filter(call => call.method === 'POST' && call.url === '/personal-workspace/executions').length, 1)
    assert.equal(adapter.prepareNewRequest(), false)
    adapter.dispose()
  })

  it('reloads server-owned history, adopts the most recent queued execution, and distinguishes empty from failure', async () => {
    const storage = memoryStorage(); const calls = []
    const api = { execute: async options => {
      calls.push(options)
      if (options.url === '/personal-workspace/executions') return { data: { items: [{ executionId: 'pwe_fbdca6bb2b654ee2ad555c576af7d74c', targetAgentId: 'agent_1', state: 'QUEUED', outputContentMimeType: 'image/png', createdAt: 9 }], nextCursor: null } }
      if (options.url.includes('/executions/pwe_fbdca6bb2b654ee2ad555c576af7d74c')) return { data: executionView({ executionId: 'pwe_fbdca6bb2b654ee2ad555c576af7d74c', outputContentMimeType: 'image/png', inputs: [] }) }
      throw new Error(`unexpected ${options.url}`)
    } }
    const adapter = usePersonalWorkspaceExecution({ api, identityEpoch: ref('owner-a'), identityScope: ref('owner-a'), storage, timerApi: { setTimeout: () => null, clearTimeout: () => {} } })
    await adapter.recover(); await flushAsync()
    assert.equal(adapter.historyState.value, 'ready')
    assert.equal(adapter.receipt.value.executionId, 'pwe_fbdca6bb2b654ee2ad555c576af7d74c')
    assert.ok(calls.some(call => call.url === '/personal-workspace/executions' && call.method === 'GET'))
    adapter.dispose()

    const empty = usePersonalWorkspaceExecution({ api: { execute: async () => ({ data: { items: [], nextCursor: null } }) }, identityEpoch: ref('owner-empty'), storage: memoryStorage() })
    await empty.loadHistory()
    assert.equal(empty.historyState.value, 'empty')
    empty.dispose()
    const failed = usePersonalWorkspaceExecution({ api: { execute: async () => { throw new Error('history offline') } }, identityEpoch: ref('owner-failed'), storage: memoryStorage() })
    await failed.loadHistory()
    assert.equal(failed.historyState.value, 'error')
    assert.match(failed.historyError.value, /history offline/)
    failed.dispose()
  })

  it('fences an older history selection response behind a newer selection', async () => {
    const older = deferred(); const newer = deferred()
    const adapter = usePersonalWorkspaceExecution({ api: { execute: options => {
      if (options.url === '/personal-workspace/executions') return Promise.resolve({ data: { items: [
        { executionId: 'exec_new', targetAgentId: 'agent_1', state: 'QUEUED', outputContentMimeType: 'image/png', createdAt: 2 },
        { executionId: 'exec_old', targetAgentId: 'agent_1', state: 'QUEUED', outputContentMimeType: 'image/png', createdAt: 1 }
      ], nextCursor: null } })
      if (options.url.endsWith('/exec_old')) return older.promise
      if (options.url.endsWith('/exec_new')) return newer.promise
      throw new Error(`unexpected ${options.url}`)
    } }, identityEpoch: ref('owner-a'), storage: memoryStorage(), timerApi: { setTimeout: () => null, clearTimeout: () => {} } })
    await adapter.loadHistory()
    const first = adapter.selectHistoryExecution('exec_old')
    const second = adapter.selectHistoryExecution('exec_new')
    newer.resolve({ data: executionView({ executionId: 'exec_new', outputContentMimeType: 'image/png', inputs: [] }) })
    await second
    older.resolve({ data: executionView({ executionId: 'exec_old', outputContentMimeType: 'image/png', inputs: [] }) })
    await first
    assert.equal(adapter.receipt.value.executionId, 'exec_new')
    adapter.dispose()
  })

  it('drops a late history callback after identity scope changes', async () => {
    const scope = ref('owner-a'); const epoch = ref('epoch-a'); const wait = deferred()
    const adapter = usePersonalWorkspaceExecution({ api: { execute: () => wait.promise }, identityEpoch: epoch, identityScope: scope, storage: memoryStorage() })
    const loading = adapter.loadHistory()
    scope.value = 'owner-b'; epoch.value = 'epoch-b'
    wait.resolve({ data: { items: [{ executionId: 'exec_old', targetAgentId: 'agent_1', state: 'QUEUED', outputContentMimeType: 'image/png', createdAt: 1 }], nextCursor: null } })
    await loading
    assert.deepEqual(adapter.history.value, [])
    assert.equal(adapter.historyState.value, 'idle')
    adapter.dispose()
  })
})
