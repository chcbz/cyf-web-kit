import { expect } from 'chai'
import { describe, it } from 'mocha'
import { ref } from 'vue'

const draft = (overrides = {}) => ({
  draftId: 'draft-1', revision: 1, state: 'EDITING', savedAt: 1, kind: 'CREATE',
  editableFields: { title: '整理案卷', instruction: '固定版本后保存', targetAgentId: 'agent-1', outputMime: 'application/pdf', inputs: [{ fileId: 'file-1', version: 2 }] },
  sourceSummary: {}, submissionRef: null, ...overrides
})
const execution = (overrides = {}) => ({ executionId: 'exec-1', targetAgentId: 'agent-1', state: 'QUEUED', ...overrides })
const receipt = (overrides = {}) => ({ ref: { sourceType: 'PRIVATE_CASE', sourceId: 'case-1' }, execution: execution(), task: null, submittedAt: 2, ...overrides })
const memoryStorage = () => {
  const map = new Map()
  return {
    entries: () => [...map.entries()],
    getItem: key => map.get(key) || null,
    setItem: (key, value) => map.set(key, value),
    removeItem: key => map.delete(key)
  }
}
const fields = { title: '整理案卷', instruction: '固定版本后保存', targetAgentId: 'agent-1', outputMime: 'application/pdf', inputs: [{ fileId: 'file-1', version: 2 }] }
const createSaved = async (adapter, values = fields) => adapter.create(values)

describe('JYT-UX-W03 Hall draft submission and recovery adapter', () => {
  it('persists a validated DRAFT-v1 create receipt with exact fixed inputs', async () => {
    const calls = []
    const api = { execute: async request => { calls.push(request); return { data: draft() } } }
    const { useHallDrafts } = await import('../src/composables/juyiting/useHallDrafts.js')
    const drafts = useHallDrafts({ agentApi: api, keyFactory: () => 'create-key' })
    const saved = await createSaved(drafts)
    expect(saved.draftId).to.equal('draft-1')
    expect(calls[0]).to.include({ url: '/hall/drafts', method: 'POST' })
    expect(calls[0].headers).to.deep.equal({ 'Idempotency-Key': 'create-key' })
    expect(calls[0].data).to.include({ kind: 'CREATE' })
    expect(calls[0].data.inputs).to.deep.equal([{ fileId: 'file-1', version: 2 }])
    drafts.dispose()
  })

  it('quotes If-Match, keeps local input on a 412, and asks the user to reload', async () => {
    const calls = []
    const api = { execute: async request => {
      calls.push(request)
      if (request.method === 'POST') return { data: draft() }
      const error = new Error('changed'); error.status = 412; error.code = 'HALL_DRAFT_REVISION_CHANGED'; throw error
    } }
    const { useHallDrafts } = await import('../src/composables/juyiting/useHallDrafts.js')
    const drafts = useHallDrafts({ agentApi: api, keyFactory: () => 'key' })
    await createSaved(drafts)
    await drafts.save({ ...fields, title: '本地新标题', instruction: '不应覆盖' })
    expect(calls[1].headers).to.deep.equal({ 'If-Match': '"1"' })
    expect(drafts.draft.value.editableFields.title).to.equal('整理案卷')
    expect(drafts.reloadRequired.value).to.equal(true)
    expect(drafts.error.value).to.match(/本地内容未覆盖/)
    drafts.dispose()
  })

  it('preserves the W02 discard action and sends its exact revision/key', async () => {
    const calls = []
    const api = { execute: async request => {
      calls.push(request)
      return request.url === '/hall/drafts' ? { data: draft() } : { data: { ...draft(), state: 'DISCARDED' } }
    } }
    const { useHallDrafts } = await import('../src/composables/juyiting/useHallDrafts.js')
    const drafts = useHallDrafts({ agentApi: api, keyFactory: () => 'discard-key' })
    await createSaved(drafts)
    await drafts.discard()
    expect(calls.map(call => call.url)).to.deep.equal(['/hall/drafts', '/hall/drafts/draft-1/discard'])
    expect(calls[1].headers).to.deep.equal({ 'Idempotency-Key': 'discard-key' })
    expect(calls[1].data).to.deep.equal({ expectedRevision: 1 })
    expect(drafts.draft.value).to.equal(null)
    drafts.dispose()
  })

  it('persists only a scope-isolated non-sensitive submit intent, locks the acknowledged draft, and blocks a second POST', async () => {
    const calls = []
    const storage = memoryStorage()
    const api = { execute: async request => {
      calls.push(request)
      if (request.url === '/hall/drafts') return { data: draft() }
      if (request.url.endsWith('/submit')) return { data: receipt() }
      if (request.url === '/hall/cases/case-1') return { data: { caseId: 'case-1', title: '整理案卷', revision: 1, executions: [{ revisionNo: 1, parentExecutionId: null, sourceOutputRef: null, execution: execution() }], allowedActions: [], sourceRef: { originRef: 'juyiting' } } }
      throw new Error(`unexpected ${request.url}`)
    } }
    const { useHallDrafts } = await import('../src/composables/juyiting/useHallDrafts.js')
    const drafts = useHallDrafts({ agentApi: api, identityScope: 'tenant-a\u0000client-a\u0000owner-a', storage, keyFactory: () => 'submit-key' })
    await createSaved(drafts)
    const accepted = await drafts.submit({ authorizationAcknowledgement: true })
    expect(accepted.ref).to.deep.equal({ sourceType: 'PRIVATE_CASE', sourceId: 'case-1' })
    const submitCall = calls.find(call => call.url.endsWith('/submit'))
    expect(submitCall.headers).to.deep.equal({ 'Idempotency-Key': 'submit-key' })
    expect(submitCall.data).to.deep.equal({ expectedRevision: 1, authorizationAcknowledgement: true })
    const stored = storage.entries().map(([, value]) => value).join('\n')
    expect(stored).to.not.include('固定版本后保存')
    expect(stored).to.not.include('file-1')
    expect(drafts.draft.value.state).to.equal('SUBMITTED')
    expect(await drafts.submit({ authorizationAcknowledgement: true })).to.equal(null)
    expect(calls.filter(call => call.url.endsWith('/submit')).length).to.equal(1)
    drafts.dispose()
  })

  it('uses the original key only for unknown submit reconciliation and never crosses account scope', async () => {
    const calls = []
    const storage = memoryStorage()
    const api = { execute: async request => {
      calls.push(request)
      if (request.url === '/hall/drafts') return { data: draft() }
      if (request.url.endsWith('/submit')) { const error = new Error('lost'); error.status = 503; throw error }
      if (request.url === '/hall/submissions/request') { const error = new Error('not found'); error.status = 404; error.code = 'HALL_RESOURCE_NOT_FOUND'; throw error }
      throw new Error(`unexpected ${request.url}`)
    } }
    const { useHallDrafts } = await import('../src/composables/juyiting/useHallDrafts.js')
    const first = useHallDrafts({ agentApi: api, identityScope: 'tenant-a\u0000client-a\u0000owner-a', storage, keyFactory: () => 'original-key' })
    await createSaved(first, { ...fields, instruction: '不会持久化' })
    await first.submit({ authorizationAcknowledgement: true })
    first.dispose()
    const other = useHallDrafts({ agentApi: api, identityScope: 'tenant-a\u0000client-a\u0000owner-b', storage, keyFactory: () => 'new-key' })
    expect(other.submissionRecovery.value).to.equal(null)
    await other.reconcileSubmission()
    expect(calls.filter(call => call.url === '/hall/submissions/request')).to.have.length(0)
    other.dispose()
    const second = useHallDrafts({ agentApi: api, identityScope: 'tenant-a\u0000client-a\u0000owner-a', storage, keyFactory: () => 'new-key' })
    await second.reconcileSubmission()
    expect(calls.filter(call => call.url.endsWith('/submit'))).to.have.length(1)
    expect(calls.filter(call => call.url === '/hall/submissions/request')).to.have.length(1)
    expect(second.unresolvedIntent.value.idempotencyKey).to.equal('original-key')
    expect(second.error.value).to.match(/仍可能稍后/)
    second.dispose()
  })

  it('keeps the unknown original key locked through a rejected reconciliation and reuses it after reauthorization', async () => {
    const calls = []
    const storage = memoryStorage()
    let requestReads = 0
    const api = { execute: async request => {
      calls.push(request)
      if (request.url === '/hall/drafts') return { data: draft() }
      if (request.url.endsWith('/submit')) { const error = new Error('lost'); error.status = 503; throw error }
      if (request.url === '/hall/submissions/request') {
        requestReads += 1
        if (requestReads < 3) { const error = new Error('reauthorize'); error.status = requestReads === 1 ? 401 : 403; throw error }
        return { data: receipt() }
      }
      if (request.url === '/hall/cases/case-1') return { data: { caseId: 'case-1', title: '整理案卷', revision: 1, executions: [], allowedActions: [], sourceRef: { originRef: 'juyiting' } } }
      throw new Error(`unexpected ${request.url}`)
    } }
    const { useHallDrafts } = await import('../src/composables/juyiting/useHallDrafts.js')
    const drafts = useHallDrafts({ agentApi: api, identityScope: 'tenant\u0000client\u0000owner', storage, keyFactory: () => 'original-key' })
    await createSaved(drafts)
    await drafts.submit({ authorizationAcknowledgement: true })
    await drafts.reconcileSubmission()
    expect(drafts.unresolvedIntent.value.idempotencyKey).to.equal('original-key')
    expect(await drafts.submit({ authorizationAcknowledgement: true })).to.equal(null)
    await drafts.reconcileSubmission()
    expect(drafts.unresolvedIntent.value.idempotencyKey).to.equal('original-key')
    await drafts.reconcileSubmission()
    expect(drafts.receipt.value.ref.sourceType).to.equal('PRIVATE_CASE')
    expect(calls.filter(call => call.url.endsWith('/submit'))).to.have.length(1)
    expect(calls.filter(call => call.url === '/hall/submissions/request').map(call => call.headers['Idempotency-Key'])).to.deep.equal(['original-key', 'original-key', 'original-key'])
    drafts.dispose()
  })

  it('hides the prior owner on logout while retaining the isolated unknown key for reauthorization', async () => {
    const storage = memoryStorage()
    const scope = ref('tenant-a\u0000client-a\u0000owner-a')
    const api = { execute: async request => request.url === '/hall/drafts' ? { data: draft() } : Promise.reject(Object.assign(new Error('lost'), { status: 503 })) }
    const { useHallDrafts } = await import('../src/composables/juyiting/useHallDrafts.js')
    const drafts = useHallDrafts({ agentApi: api, identityScope: scope, storage, keyFactory: () => 'original-key' })
    await createSaved(drafts)
    await drafts.submit({ authorizationAcknowledgement: true })
    expect(storage.entries().some(([key]) => key.startsWith('cyf.hall.submission-recovery.v1.') && !key.endsWith('.browser'))).to.equal(true)
    scope.value = ''
    expect(drafts.draft.value).to.equal(null)
    expect(drafts.submissionRecovery.value).to.equal(null)
    expect(storage.entries().some(([key]) => key.startsWith('cyf.hall.submission-recovery.v1.') && !key.endsWith('.browser'))).to.equal(true)
    scope.value = 'tenant-a\u0000client-a\u0000owner-b'
    expect(drafts.submissionRecovery.value).to.equal(null)
    scope.value = 'tenant-a\u0000client-a\u0000owner-a'
    expect(drafts.unresolvedIntent.value.idempotencyKey).to.equal('original-key')
    drafts.dispose()
  })

  it('refuses persistence and submission without a stable owner/client scope', async () => {
    const storage = memoryStorage()
    const api = { execute: async request => request.url === '/hall/drafts' ? { data: draft() } : { data: receipt() } }
    const { useHallDrafts } = await import('../src/composables/juyiting/useHallDrafts.js')
    const drafts = useHallDrafts({ agentApi: api, identityEpoch: ref(7), storage, keyFactory: () => 'key' })
    await createSaved(drafts)
    expect(await drafts.submit({ authorizationAcknowledgement: true })).to.equal(null)
    expect(storage.entries()).to.deep.equal([])
    expect(drafts.error.value).to.match(/隔离标识不可用/)
    drafts.dispose()
  })

  it('accepts the frozen TASK_ACTION receipt shape without mixing it into a private case', async () => {
    const api = { execute: async request => request.url === '/hall/drafts'
      ? { data: draft({ kind: 'TASK_ACTION' }) }
      : { data: receipt({ ref: { sourceType: 'TASK', sourceId: 'task-1' }, execution: execution({ executionId: 'task-exec' }), task: null }) } }
    const { useHallDrafts } = await import('../src/composables/juyiting/useHallDrafts.js')
    const drafts = useHallDrafts({ agentApi: api, identityScope: 'tenant\u0000client\u0000owner', storage: memoryStorage(), keyFactory: () => 'task-action-key' })
    await createSaved(drafts)
    const accepted = await drafts.submit({ authorizationAcknowledgement: true })
    expect(accepted.ref).to.deep.equal({ sourceType: 'TASK', sourceId: 'task-1' })
    expect(drafts.caseView.value).to.equal(null)
    drafts.dispose()
  })

  it('releases deterministic submit failures for correction while retaining only uncertain failures', async () => {
    const storage = memoryStorage()
    const api = { execute: async request => {
      if (request.url === '/hall/drafts') return { data: draft() }
      const error = new Error('unavailable'); error.status = 422; error.code = 'HALL_SUBMISSION_KIND_UNAVAILABLE'; throw error
    } }
    const { useHallDrafts } = await import('../src/composables/juyiting/useHallDrafts.js')
    const drafts = useHallDrafts({ agentApi: api, identityScope: 'tenant\u0000client\u0000owner', storage, keyFactory: () => 'task-key' })
    await createSaved(drafts, { ...fields, title: '正式张榜' })
    expect(await drafts.submit({ authorizationAcknowledgement: true })).to.equal(null)
    expect(drafts.unresolvedIntent.value).to.equal(null)
    expect(drafts.submissionRecovery.value).to.equal(null)
    expect(drafts.draft.value.state).to.equal('EDITING')
    expect(storage.entries().filter(([key]) => key.startsWith('cyf.hall.submission-recovery.v1.') && !key.endsWith('.browser'))).to.deep.equal([])
    expect(drafts.error.value).to.match(/原正式入口/)
    drafts.dispose()
  })

  it('reads only the frozen private-execution results path and preserves fixed output versions', async () => {
    const calls = []
    const results = {
      executionId: 'exec-1', state: 'OUTPUT_COMMITTED', manifestId: 'manifest-1',
      items: [
        { outputId: 'output-1', fileId: 'file-1', fileVersion: 2, mime: 'application/pdf', filename: '结案.pdf', byteLength: 12, sha256: 'a'.repeat(64), availability: 'AVAILABLE' },
        { outputId: 'output-2', fileId: 'file-2', fileVersion: 7, mime: 'text/plain', filename: '缺失.txt', byteLength: 3, sha256: 'b'.repeat(64), availability: 'UNAVAILABLE' }
      ],
      allowedActions: ['VIEW', 'CREATE_REVISION']
    }
    const api = { execute: async request => { calls.push(request); return { data: results } } }
    const { useHallDrafts } = await import('../src/composables/juyiting/useHallDrafts.js')
    const drafts = useHallDrafts({ agentApi: api })
    const loaded = await drafts.loadResults('exec-1')
    expect(loaded.items.map(item => [item.fileId, item.fileVersion, item.availability])).to.deep.equal([
      ['file-1', 2, 'AVAILABLE'], ['file-2', 7, 'UNAVAILABLE']
    ])
    expect(calls).to.have.length(1)
    expect(calls[0]).to.include({ url: '/hall/executions/exec-1/results', method: 'GET' })
    expect(calls[0]).to.not.have.property('params')
    expect(calls[0]).to.not.have.property('data')
    drafts.dispose()
  })

  it('shows an empty result set only for a nonterminal execution and rejects malformed committed output', async () => {
    const responses = [
      { executionId: 'exec-1', state: 'QUEUED', manifestId: null, items: [], allowedActions: [] },
      { executionId: 'exec-1', state: 'OUTPUT_COMMITTED', manifestId: null, items: [], allowedActions: ['VIEW'] },
      { executionId: 'exec-1', state: 'OUTPUT_COMMITTED', manifestId: 'manifest-1', items: [{ outputId: 'output-1', fileId: 'file-1', fileVersion: 2, mime: 'application/pdf', filename: '坏结果.pdf', byteLength: 1, sha256: 'not-a-hash', availability: 'AVAILABLE' }], allowedActions: ['VIEW'] }
    ]
    const api = { execute: async () => ({ data: responses.shift() }) }
    const { useHallDrafts } = await import('../src/composables/juyiting/useHallDrafts.js')
    const drafts = useHallDrafts({ agentApi: api })
    expect((await drafts.loadResults('exec-1')).items).to.deep.equal([])
    expect(drafts.resultsState.value).to.equal('empty')
    expect(await drafts.loadResults('exec-1')).to.equal(null)
    expect(drafts.resultsState.value).to.equal('error')
    expect(drafts.executionResults.value).to.equal(null)
    expect(await drafts.loadResults('exec-1')).to.equal(null)
    expect(drafts.resultsError.value).to.match(/成果回执无效/)
    drafts.dispose()
  })

  it('uses the API cursor limit of 300 rather than an arbitrary ID limit', async () => {
    const cursor = 'x'.repeat(300)
    const calls = []
    const api = { execute: async request => { calls.push(request); return { data: { items: [], nextCursor: null } } } }
    const { useHallDrafts } = await import('../src/composables/juyiting/useHallDrafts.js')
    const drafts = useHallDrafts({ agentApi: api })
    expect(await drafts.list({ cursor })).to.equal(true)
    expect(calls[0].params).to.deep.equal({ cursor })
    expect(await drafts.list({ cursor: `${cursor}x` })).to.equal(false)
    drafts.dispose()
  })
})

describe('JYT-UX-W05 frozen TASK_CREATE receipt boundaries', () => {
  const formalFields = { title: '正式名目', instruction: '正式简述', targetAgentId: null, outputMime: null, inputs: [] }
  const formalDraft = overrides => draft({ kind: 'TASK_CREATE', editableFields: formalFields, ...overrides })
  const taskReceipt = overrides => receipt({ ref: { sourceType: 'TASK', sourceId: 'task-1' }, execution: null,
    task: { taskId: 'task-1', taskVersion: '9007199254740993' }, ...overrides })
  const make = async handler => {
    const { useHallDrafts } = await import('../src/composables/juyiting/useHallDrafts.js')
    const calls = []
    const storage = memoryStorage()
    let counter = 0
    const model = useHallDrafts({ identityScope: 'tenant\u0000client\u0000owner', storage,
      keyFactory: () => `formal-key-${++counter}`,
      agentApi: { execute: async request => { calls.push(request); return handler(request) } } })
    return { model, calls, storage }
  }

  it('accepts nullable optional DRAFT-v1 fields in saved drafts and recoverable summaries', async () => {
    const nullable = { title: null, instruction: null, targetAgentId: null, outputMime: null, inputs: [] }
    const { model, calls } = await make(request => request.method === 'POST'
      ? formalDraft({ editableFields: nullable })
      : { items: [{ ...formalDraft(), title: null, targetAgentId: null, outputMime: null }], nextCursor: null })
    expect((await model.create({ kind: 'TASK_CREATE' })).editableFields).to.deep.equal(nullable)
    expect(await model.list()).to.equal(true)
    expect(model.summaries.value[0].kind).to.equal('TASK_CREATE')
    expect(calls).to.have.length(2)
    model.dispose()
  })

  it('accepts TASK_CREATE without execution, keeps exact string taskVersion, and never submits twice', async () => {
    const { model, calls, storage } = await make(request => request.url === '/hall/drafts' ? formalDraft() : taskReceipt())
    await model.create({ kind: 'TASK_CREATE', ...formalFields })
    const [accepted, duplicate] = await Promise.all([
      model.submit({ authorizationAcknowledgement: true }), model.submit({ authorizationAcknowledgement: true })
    ])
    expect(accepted.task.taskVersion).to.equal('9007199254740993')
    expect(accepted.execution).to.equal(null)
    expect(duplicate).to.equal(null)
    expect(model.submissionState.value).to.equal('acknowledged')
    expect(model.draft.value.state).to.equal('SUBMITTED')
    expect(model.submissionRecovery.value).to.include({ executionId: null, uncertain: false, kind: 'TASK_CREATE' })
    expect(model.caseView.value).to.equal(null)
    expect(model.executionResults.value).to.equal(null)
    expect(await model.submit({ authorizationAcknowledgement: true })).to.equal(null)
    expect(calls.filter(call => call.url.endsWith('/submit'))).to.have.length(1)
    expect(JSON.stringify(storage.entries())).not.to.match(/正式名目|正式简述|taskVersion|editableFields/)
    model.dispose()
  })

  it('locks invalid task receipts and never confuses private, TASK_ACTION and TASK_CREATE shapes', async () => {
    for (const invalid of [
      taskReceipt({ task: { taskId: 'different-task', taskVersion: '1' } }),
      taskReceipt({ task: { taskId: 'task-1', taskVersion: 1 } }),
      taskReceipt({ task: { taskId: 'task-1', taskVersion: '' } }),
      taskReceipt({ ref: { sourceType: 'PRIVATE_CASE', sourceId: 'task-1' } }),
      taskReceipt({ execution: execution() }),
      taskReceipt({ execution: execution(), task: null }),
      receipt()
    ]) {
      const { model, calls } = await make(request => request.url === '/hall/drafts' ? formalDraft() : invalid)
      await model.create({ kind: 'TASK_CREATE', ...formalFields })
      expect(await model.submit({ authorizationAcknowledgement: true })).to.equal(null)
      expect(model.receipt.value).to.equal(null)
      expect(model.unresolvedIntent.value.kind).to.equal('TASK_CREATE')
      expect(model.submissionState.value).to.equal('unknown')
      expect(await model.submit({ authorizationAcknowledgement: true })).to.equal(null)
      expect(calls.filter(call => call.url.endsWith('/submit'))).to.have.length(1)
      model.dispose()
    }
  })

  it('retains POST503 intent through real identity cleanup and GET401/403, then reads the same task key', async () => {
    const { useHallDrafts } = await import('../src/composables/juyiting/useHallDrafts.js')
    const { stopIdentityBoundWork } = await import('../src/utils/identityLifecycle.js')
    const storage = memoryStorage()
    const epoch = ref(1)
    const calls = []
    let reads = 0
    const model = useHallDrafts({ identityEpoch: epoch, identityScope: 'tenant\u0000client\u0000owner', storage,
      keyFactory: () => 'same-original-task-key', agentApi: { execute: async request => {
        calls.push(request)
        if (request.url === '/hall/drafts') return formalDraft()
        if (request.url.endsWith('/submit')) throw Object.assign(new Error('lost'), { status: 503 })
        if (request.url === '/hall/submissions/request') {
          reads += 1
          if (reads <= 2) {
            stopIdentityBoundWork()
            throw Object.assign(new Error('reauthorize'), { status: reads === 1 ? 401 : 403 })
          }
          return taskReceipt()
        }
        throw new Error(`unexpected ${request.url}`)
      } } })
    await model.create({ kind: 'TASK_CREATE', ...formalFields })
    await model.submit({ authorizationAcknowledgement: true })
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await model.reconcileSubmission()
      expect(model.receipt.value).to.equal(null)
      expect(model.draft.value).to.equal(null)
      epoch.value += 1
      expect(model.unresolvedIntent.value.idempotencyKey).to.equal('same-original-task-key')
      expect(await model.submit({ authorizationAcknowledgement: true })).to.equal(null)
    }
    const accepted = await model.reconcileSubmission()
    expect(accepted.task.taskVersion).to.equal('9007199254740993')
    expect(calls.filter(call => call.url.endsWith('/submit'))).to.have.length(1)
    expect(calls.filter(call => call.url === '/hall/submissions/request').map(call => [call.headers['Idempotency-Key'], call.params, call.data])).to.deep.equal([
      ['same-original-task-key', undefined, undefined], ['same-original-task-key', undefined, undefined], ['same-original-task-key', undefined, undefined]
    ])
    model.dispose()
  })

  it('rechecks the shared scope intent before another retained pane can post', async () => {
    const { useHallDrafts } = await import('../src/composables/juyiting/useHallDrafts.js')
    const storage = memoryStorage()
    const calls = []
    const options = { identityScope: 'owner-client', storage, agentApi: { execute: async request => {
      calls.push(request)
      if (request.url === '/hall/drafts') return formalDraft()
      throw Object.assign(new Error('lost'), { status: 503 })
    } } }
    const first = useHallDrafts({ ...options, keyFactory: () => 'first-key' })
    const second = useHallDrafts({ ...options, keyFactory: () => 'second-key' })
    await first.create({ kind: 'TASK_CREATE', ...formalFields })
    await second.create({ kind: 'TASK_CREATE', ...formalFields })
    await first.submit({ authorizationAcknowledgement: true })
    expect(await second.submit({ authorizationAcknowledgement: true })).to.equal(null)
    expect(second.unresolvedIntent.value.idempotencyKey).to.equal('first-key')
    expect(calls.filter(call => call.url.endsWith('/submit'))).to.have.length(1)
    first.dispose(); second.dispose()
  })

  it('does not let a late reconciliation of an acknowledged task erase another pane\'s newer unknown intent', async () => {
    const { useHallDrafts } = await import('../src/composables/juyiting/useHallDrafts.js')
    const storage = memoryStorage()
    let finishOldRead
    let creates = 0
    const options = { identityScope: 'owner-client', storage, agentApi: { execute: async request => {
      if (request.url === '/hall/drafts') return formalDraft({ draftId: `draft-${++creates}` })
      if (request.url === '/hall/submissions/request') return new Promise(resolve => { finishOldRead = () => resolve(taskReceipt()) })
      if (request.url === '/hall/drafts/draft-1/submit') return taskReceipt()
      throw Object.assign(new Error('new request lost'), { status: 503 })
    } } }
    const first = useHallDrafts({ ...options, keyFactory: () => 'first-key' })
    const second = useHallDrafts({ ...options, keyFactory: () => 'second-key' })
    await first.create({ kind: 'TASK_CREATE', ...formalFields })
    await first.submit({ authorizationAcknowledgement: true })
    const oldRead = first.reconcileSubmission()
    await second.create({ kind: 'TASK_CREATE', ...formalFields })
    await second.submit({ authorizationAcknowledgement: true })
    finishOldRead()
    await oldRead
    expect(first.unresolvedIntent.value.idempotencyKey).to.equal('second-key')
    expect(second.unresolvedIntent.value.idempotencyKey).to.equal('second-key')
    const stored = storage.entries().filter(([key]) => !key.endsWith('.browser')).map(([, value]) => JSON.parse(value))
    expect(stored).to.have.length(1)
    expect(stored[0]).to.include({ idempotencyKey: 'second-key', uncertain: true, draftId: 'draft-2' })
    first.dispose(); second.dispose()
  })

  it('allows explicit correction after original POST422 but not after a refused formal detail read', async () => {
    let submissions = 0
    const { model, calls } = await make(request => {
      if (request.url === '/hall/drafts') return formalDraft()
      if (request.method === 'PUT') return formalDraft({ revision: 2, editableFields: request.data })
      if (request.url.endsWith('/submit')) {
        submissions += 1
        if (submissions === 1) throw Object.assign(new Error('source rejected'), { status: 422 })
        return taskReceipt()
      }
      throw Object.assign(new Error('read denied'), { status: 403 })
    })
    await model.create({ kind: 'TASK_CREATE', ...formalFields })
    await model.submit({ authorizationAcknowledgement: true })
    expect(model.unresolvedIntent.value).to.equal(null)
    expect(model.draft.value.state).to.equal('EDITING')
    await model.save({ ...formalFields, instruction: '修正简述' })
    await model.submit({ authorizationAcknowledgement: true })
    const key = model.submissionRecovery.value.idempotencyKey
    expect(await model.loadFormalTask()).to.equal(null)
    expect(model.draft.value.state).to.equal('SUBMITTED')
    expect(model.submissionRecovery.value.idempotencyKey).to.equal(key)
    expect(await model.submit({ authorizationAcknowledgement: true })).to.equal(null)
    expect(calls.filter(call => call.url.endsWith('/submit')).map(call => call.data.expectedRevision)).to.deep.equal([1, 2])
    expect(new Set(calls.filter(call => call.url.endsWith('/submit')).map(call => call.headers['Idempotency-Key'])).size).to.equal(2)
    expect(calls.at(-1)).to.include({ method: 'GET', url: '/tasks/task-1' })
    model.dispose()
  })
})

describe('JYT-UX-W05 field-level DRAFT-v1 limits', () => {
  it('rejects 201-character titles locally before create or CAS replacement and keeps the saved draft', async () => {
    const calls = []
    const { useHallDrafts } = await import('../src/composables/juyiting/useHallDrafts.js')
    const model = useHallDrafts({ agentApi: { execute: async request => { calls.push(request); return draft() } } })
    try {
      expect(await model.create({ ...fields, title: '长'.repeat(201) })).to.equal(null)
      expect(calls).to.have.length(0)
      await model.create(fields)
      expect(await model.save({ ...fields, title: '长'.repeat(201) })).to.equal(null)
      expect(calls).to.have.length(1)
      expect(model.draft.value.editableFields.title).to.equal(fields.title)
      expect(model.error.value).to.include('最多200字')
    } finally { model.dispose() }
  })

  it('loads and saves legitimate 16001–20000-character instructions with exact CAS and Unicode code-point title limits', async () => {
    for (const length of [16001, 20000]) {
      const calls = []
      const body = { ...fields, title: '📄'.repeat(200), instruction: '文'.repeat(length) }
      const { useHallDrafts } = await import('../src/composables/juyiting/useHallDrafts.js')
      const model = useHallDrafts({ agentApi: { execute: async request => {
        calls.push(request)
        return draft({ revision: request.method === 'PUT' ? 2 : 1, editableFields: body })
      } } })
      try {
        expect((await model.load('draft-1')).editableFields.instruction).to.equal(body.instruction)
        expect((await model.save(body)).revision).to.equal(2)
        expect(calls[1].data).to.deep.equal(body)
        expect(calls[1].headers).to.deep.equal({ 'If-Match': '"1"' })
        expect(await model.save({ ...body, instruction: '文'.repeat(20001) })).to.equal(null)
        expect(await model.save({ ...body, outputMime: 'x'.repeat(161) })).to.equal(null)
        expect(calls).to.have.length(2)
      } finally { model.dispose() }
    }
  })

  it('serializes unselected agent and MIME as null, not invalid optional exact empty strings', async () => {
    const calls = []
    const { useHallDrafts } = await import('../src/composables/juyiting/useHallDrafts.js')
    const model = useHallDrafts({ agentApi: { execute: async request => {
      calls.push(request)
      return draft({ editableFields: { title: '', instruction: '', targetAgentId: null, outputMime: null, inputs: [] } })
    } } })
    try {
      await model.create({ title: '', instruction: '', targetAgentId: '', outputMime: '', inputs: [] })
      expect(calls[0].data).to.include({ targetAgentId: null, outputMime: null })
    } finally { model.dispose() }
  })
})
