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

  it('clears the prior owner recovery entry when identity scope becomes empty', async () => {
    const storage = memoryStorage()
    const scope = ref('tenant-a\u0000client-a\u0000owner-a')
    const api = { execute: async request => request.url === '/hall/drafts' ? { data: draft() } : Promise.reject(Object.assign(new Error('lost'), { status: 503 })) }
    const { useHallDrafts } = await import('../src/composables/juyiting/useHallDrafts.js')
    const drafts = useHallDrafts({ agentApi: api, identityScope: scope, storage, keyFactory: () => 'original-key' })
    await createSaved(drafts)
    await drafts.submit({ authorizationAcknowledgement: true })
    expect(storage.entries().some(([key]) => key.startsWith('cyf.hall.submission-recovery.v1.') && !key.endsWith('.browser'))).to.equal(true)
    scope.value = ''
    expect(storage.entries().some(([key]) => key.startsWith('cyf.hall.submission-recovery.v1.') && !key.endsWith('.browser'))).to.equal(false)
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
