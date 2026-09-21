import { expect } from 'chai'
import { describe, it } from 'mocha'
const draft = (overrides = {}) => ({
  draftId: 'draft-1', revision: 1, state: 'EDITING', savedAt: 1, kind: 'CREATE',
  editableFields: { title: '整理案卷', instruction: '固定版本后保存', targetAgentId: 'agent-1', outputMime: 'application/pdf', inputs: [{ fileId: 'file-1', version: 2 }] },
  sourceSummary: {}, submissionRef: null, ...overrides
})
const execution = (overrides = {}) => ({ executionId: 'exec-1', targetAgentId: 'agent-1', state: 'QUEUED', ...overrides })
const receipt = (overrides = {}) => ({ ref: { sourceType: 'PRIVATE_CASE', sourceId: 'case-1' }, execution: execution(), task: null, submittedAt: 2, ...overrides })
const memoryStorage = () => { const map = new Map(); return { getItem: key => map.get(key) || null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) } }

describe('JYT-UX-W03 Hall draft submission and recovery adapter', () => {
  it('persists only a validated DRAFT-v1 create receipt with exact fixed inputs', async () => {
    const calls = []; const api = { execute: async request => { calls.push(request); return { data: draft() } } }
    const { useHallDrafts } = await import('../src/composables/juyiting/useHallDrafts.js')
    const drafts = useHallDrafts({ agentApi: api, keyFactory: () => 'create-key' })
    const saved = await drafts.create({ title: '整理案卷', instruction: '固定版本后保存', targetAgentId: 'agent-1', outputMime: 'application/pdf', inputs: [{ fileId: 'file-1', version: 2 }] })
    expect(saved.draftId).to.equal('draft-1'); expect(calls[0]).to.include({ url: '/hall/drafts', method: 'POST' }); expect(calls[0].headers).to.deep.equal({ 'Idempotency-Key': 'create-key' }); expect(calls[0].data).to.include({ kind: 'CREATE' }); expect(calls[0].data.inputs).to.deep.equal([{ fileId: 'file-1', version: 2 }])
    drafts.dispose()
  })

  it('quotes If-Match, keeps local input on a 412, and asks the user to reload', async () => {
    const calls = []; const api = { execute: async request => { calls.push(request); if (request.method === 'POST') return { data: draft() }; const error = new Error('changed'); error.status = 412; error.code = 'HALL_DRAFT_REVISION_CHANGED'; throw error } }
    const { useHallDrafts } = await import('../src/composables/juyiting/useHallDrafts.js'); const drafts = useHallDrafts({ agentApi: api, keyFactory: () => 'key' })
    await drafts.create({ title: '整理案卷', instruction: '固定版本后保存', targetAgentId: 'agent-1', outputMime: 'application/pdf', inputs: [{ fileId: 'file-1', version: 2 }] }); await drafts.save({ title: '本地新标题', instruction: '不应覆盖', targetAgentId: 'agent-1', outputMime: 'application/pdf', inputs: [{ fileId: 'file-1', version: 2 }] })
    expect(calls[1].headers).to.deep.equal({ 'If-Match': '"1"' }); expect(drafts.draft.value.editableFields.title).to.equal('整理案卷'); expect(drafts.reloadRequired.value).to.equal(true); expect(drafts.error.value).to.match(/本地内容未覆盖/); drafts.dispose()
  })

  it('saves the original non-sensitive key before submit, sends the frozen acknowledgement payload, and opens its real private case', async () => {
    const calls = []; const storage = memoryStorage(); const api = { execute: async request => { calls.push(request); if (request.url === '/hall/drafts') return { data: draft() }; if (request.url.endsWith('/submit')) return { data: receipt() }; if (request.url === '/hall/cases/case-1') return { data: { caseId: 'case-1', title: '整理案卷', revision: 1, executions: [{ revisionNo: 1, parentExecutionId: null, sourceOutputRef: null, execution: execution() }], allowedActions: [], sourceRef: { originRef: 'juyiting' } } }; throw new Error(`unexpected ${request.url}`) } }
    const { useHallDrafts } = await import('../src/composables/juyiting/useHallDrafts.js'); const drafts = useHallDrafts({ agentApi: api, identityScope: 'owner-a', storage, keyFactory: () => 'submit-key' })
    await drafts.create({ title: '整理案卷', instruction: '固定版本后保存', targetAgentId: 'agent-1', outputMime: 'application/pdf', inputs: [{ fileId: 'file-1', version: 2 }] }); const accepted = await drafts.submit({ authorizationAcknowledgement: true })
    expect(accepted.ref).to.deep.equal({ sourceType: 'PRIVATE_CASE', sourceId: 'case-1' }); const submitCall = calls.find(call => call.url.endsWith('/submit')); expect(submitCall.headers).to.deep.equal({ 'Idempotency-Key': 'submit-key' }); expect(submitCall.data).to.deep.equal({ expectedRevision: 1, authorizationAcknowledgement: true }); expect(JSON.stringify(storage)).not.to.include('固定版本后保存'); expect(JSON.stringify(storage)).not.to.include('file-1'); expect(drafts.receipt.value.execution.executionId).to.equal('exec-1')
    drafts.dispose()
  })

  it('does not resend an unknown submit after a 404 reconciliation; it queries only the original key', async () => {
    const calls = []; const storage = memoryStorage(); let submitting = true; const api = { execute: async request => { calls.push(request); if (request.url === '/hall/drafts') return { data: draft() }; if (request.url.endsWith('/submit')) { submitting = false; const error = new Error('lost'); error.status = 503; throw error }; if (request.url === '/hall/submissions/request') { const error = new Error('not found'); error.status = 404; error.code = 'HALL_RESOURCE_NOT_FOUND'; throw error }; throw new Error(`unexpected ${request.url}`) } }
    const { useHallDrafts } = await import('../src/composables/juyiting/useHallDrafts.js'); const first = useHallDrafts({ agentApi: api, identityScope: 'owner-a', storage, keyFactory: () => 'original-key' }); await first.create({ title: '整理案卷', instruction: '不会持久化', targetAgentId: 'agent-1', outputMime: 'application/pdf', inputs: [] }); await first.submit({ authorizationAcknowledgement: true }); expect(submitting).to.equal(false); first.dispose()
    const second = useHallDrafts({ agentApi: api, identityScope: 'owner-a', storage, keyFactory: () => 'new-key' }); await second.reconcileSubmission(); expect(calls.filter(call => call.url.endsWith('/submit')).length).to.equal(1); expect(calls.filter(call => call.url === '/hall/submissions/request').length).to.equal(1); expect(second.unresolvedIntent.value.idempotencyKey).to.equal('original-key'); expect(second.error.value).to.match(/仍可能稍后/); second.dispose()
  })

  it('keeps TASK_CREATE unavailable instead of treating it as a private execution', async () => {
    const api = { execute: async request => { if (request.url === '/hall/drafts') return { data: draft({ kind: 'TASK_CREATE' }) }; const error = new Error('unavailable'); error.status = 422; error.code = 'HALL_SUBMISSION_KIND_UNAVAILABLE'; throw error } }
    const { useHallDrafts } = await import('../src/composables/juyiting/useHallDrafts.js'); const drafts = useHallDrafts({ agentApi: api, identityScope: 'owner-a', storage: memoryStorage(), keyFactory: () => 'task-key' }); await drafts.create({ kind: 'TASK_CREATE', title: '正式张榜', instruction: '不能伪造', targetAgentId: 'agent-1', outputMime: 'application/pdf', inputs: [] }); expect(await drafts.submit({ authorizationAcknowledgement: true })).to.equal(null); expect(drafts.receipt.value).to.equal(null); expect(drafts.error.value).to.match(/原正式入口/); drafts.dispose()
  })
})
